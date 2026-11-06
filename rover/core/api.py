"""Rover LAN API (:8700). Every route needs X-Rover-Token. There is deliberately no move endpoint."""

import asyncio
import hmac
import time

from aiohttp import WSMsgType, web

from rover.zg.brain import parcel_number

from .camera import luma
from .mcu import FLAG_BATTERY
from .mission import ImuNotSteady, Mission, steady_imu_cal

TELEMETRY_S = 0.05
STATE_FIELDS = ("ms", "mode_name", "stop_name", "refusal_name", "start_ms", "halt_ms", "hb_ms", "yaw_cdeg",
                "rate_cdps", "sonar_mm", "dist_mm", "batt_mv", "batt_min_mv", "face", "flags", "imu_resets", "imu_bus_errors")


class Rover:
    """Mission state shared by the API and, from P6, the mission loop."""

    def __init__(self, settings, worker, camera, leases, skills=None, brain=None, prover=None, zglog=None):
        self.settings = settings
        self.worker = worker
        self.camera = camera
        self.leases = leases
        self.skills = skills
        self.brain = brain
        self.prover = prover
        self.zglog = zglog
        self.runner = None
        self.mission = None
        self.photos = {}
        self.last_request_id = None
        self.last_record_hash = None
        self.started_at = time.monotonic()

    def status(self) -> dict:
        st, at = self.worker.latest_state()
        frame, frame_at, frame_seq = self.camera.latest()
        now = time.monotonic()
        return {
            "state": "mission" if self.mission else "idle",
            "mission": self.mission,
            "mcu_connected": self.worker.connected,
            "mcu": {k: st[k] for k in STATE_FIELDS} if st else None,
            "mcu_state_age_ms": round((now - at) * 1000) if st else None,
            "camera": {"frame_seq": frame_seq, "frame_age_ms": round((now - frame_at) * 1000) if frame_seq else None,
                       "luma": round(luma(frame), 1) if frame is not None else None,
                       "calibration": self.camera.calibration,
                       "opens": self.camera.opens, "read_failures": self.camera.read_failures},
            "leases": self.leases.snapshot(),
            "progress": self.runner.status() if self.runner else None,
            "zglog_pending": self.zglog.pending() if self.zglog else None,
            "photos": [{"n": n, "sha256": p["sha256"], "seq": p["seq"]} for n, p in sorted(self.photos.items())],
            "last_request_id": self.last_request_id,
            "last_record_hash": self.last_record_hash,
        }


@web.middleware
async def require_token(request, handler):
    supplied = request.headers.get("X-Rover-Token", "")
    if not hmac.compare_digest(supplied, request.app["rover"].settings.lan_token):
        raise web.HTTPUnauthorized(text="bad or missing X-Rover-Token")
    return await handler(request)


async def body(request) -> dict:
    try:
        data = await request.json()
    except Exception:
        raise web.HTTPBadRequest(text="JSON body required")
    if not isinstance(data, dict):
        raise web.HTTPBadRequest(text="JSON object required")
    return data


async def get_status(request):
    return web.json_response(request.app["rover"].status())


async def get_photo(request):
    rover = request.app["rover"]
    photo = rover.photos.get(int(request.match_info["n"]))
    if photo is None:
        raise web.HTTPNotFound(text="no such photo")
    return web.Response(body=photo["jpeg"], content_type="image/jpeg", headers={"X-Photo-Sha256": photo["sha256"]})


async def get_frame(request):
    shot = await asyncio.to_thread(request.app["rover"].camera.jpeg_full)
    if shot is None:
        raise web.HTTPServiceUnavailable(text="no fresh camera frame")
    jpeg, _, seq = shot
    return web.Response(body=jpeg, content_type="image/jpeg", headers={"X-Frame-Seq": str(seq)})


async def post_mission_start(request):
    rover, data = request.app["rover"], await body(request)
    for key in ("episode_id", "quote_id", "mission", "photos_wanted"):
        if key not in data:
            raise web.HTTPBadRequest(text=f"missing {key}")
    if rover.mission is not None:
        raise web.HTTPConflict(text="a mission is already active")
    # The parcel is known only by its number (#1, #2, #3 on the day; decoys carry other numbers or none).
    if not parcel_number(data["mission"]):
        raise web.HTTPBadRequest(text="the mission must name the parcel's number, e.g. 'Inspect parcel #1'")
    if rover.brain is None or rover.skills is None:
        raise web.HTTPServiceUnavailable(text="no 0G brain (ZG_API_KEY) on this rover")
    # Refuse before anything is paid when the rover cannot drive (a live run: 0.0 V, every move refused for 200 s).
    st = await asyncio.to_thread(rover.worker.call, "state")
    if not st["flags"] & FLAG_BATTERY:
        rover.worker.submit("face", "BAT")  # the reason shows on the rover too
        raise web.HTTPServiceUnavailable(text=f"rover not ready: the motor battery reads {st['batt_mv'] / 1000:.1f} V, too low "
                                              "to drive; switch it on or charge it")
    # The rover is standing still at mission start: measure the light, zero the gyro, read the TEE signer once.
    try:
        calibration = await asyncio.to_thread(rover.camera.autocalibrate)
    except Exception as e:
        calibration = {"error": str(e)}
    try:
        imu = await asyncio.to_thread(steady_imu_cal, rover.worker)
        tee = await asyncio.to_thread(rover.prover.load_service)
    except ImuNotSteady as e:
        raise web.HTTPServiceUnavailable(text=f"rover not ready: {e}")
    except Exception as e:
        raise web.HTTPServiceUnavailable(text=f"mission start failed: {e}")
    rover.mission = {k: data[k] for k in ("episode_id", "quote_id", "mission", "photos_wanted")}
    rover.photos = {}
    with rover.leases.lock:
        rover.leases.money.quote_id = data["quote_id"]
        rover.leases.money.paid = rover.leases.money.used = 0
        rover.leases.money.txs = []
    if rover.zglog:
        rover.zglog.episode(data["episode_id"], data["mission"], quote_id=data["quote_id"], photos_wanted=data["photos_wanted"])
    rover.runner = Mission(rover, rover.mission).start()
    return web.json_response({"ok": True, "mission": rover.mission, "camera_calibration": calibration, "imu": imu,
                              "tee_signer": tee["signer_onchain"]})


async def post_mission_end(request):
    rover, data = request.app["rover"], await body(request)
    if not rover.mission or data.get("quote_id") != rover.mission["quote_id"]:
        raise web.HTTPConflict(text="no matching active mission")
    if rover.runner:
        await asyncio.to_thread(rover.runner.stop)
    rover.worker.submit("stop")
    rover.worker.submit("face", "DONE")
    progress = rover.runner.status() if rover.runner else None
    if rover.zglog:
        rover.zglog.end(rover.mission["episode_id"])
    ended, rover.mission = rover.mission, None
    return web.json_response({"ok": True, "ended": ended, "progress": progress})


async def post_money(request):
    rover, data = request.app["rover"], await body(request)
    try:
        rover.leases.set_paid(data.get("quote_id"), int(data.get("paid", 0)), data.get("txs", []))
    except ValueError as e:
        raise web.HTTPConflict(text=str(e))
    return web.json_response(rover.leases.snapshot())


async def post_money_hb(request):
    rover, data = request.app["rover"], await body(request)
    try:
        rover.leases.money_heartbeat(data.get("quote_id"))
    except ValueError as e:
        raise web.HTTPConflict(text=str(e))
    return web.json_response({"ok": True})


async def post_test_duty(request):
    """Test mode only: a raw duty pulse for the P2 service-heartbeat test."""
    rover, data = request.app["rover"], await body(request)
    fut = rover.worker.submit("set_duty", int(data["l"]), int(data["r"]), int(data["lease_ms"]))
    await asyncio.wrap_future(fut)
    return web.json_response({"ok": True})


async def post_test_fault(request):
    """Test mode only: make the next checkpoints fail on purpose (plan P6 !TEE beat)."""
    rover, data = request.app["rover"], await body(request)
    fault = data.get("fault")
    if fault not in (None, "corrupt_signature", "wrong_nonce"):
        raise web.HTTPBadRequest(text="fault must be null, corrupt_signature or wrong_nonce")
    if not rover.runner:
        raise web.HTTPConflict(text="no mission running")
    rover.runner.fault = fault
    return web.json_response({"ok": True, "fault": fault})


async def telemetry(request):
    rover = request.app["rover"]
    ws = web.WebSocketResponse(heartbeat=5)
    await ws.prepare(request)

    async def drain():
        async for msg in ws:
            if msg.type in (WSMsgType.CLOSE, WSMsgType.ERROR):
                break

    reader = asyncio.create_task(drain())
    loop = asyncio.get_running_loop()
    next_at = loop.time()
    try:
        while not ws.closed:
            st, _ = rover.worker.latest_state()
            await ws.send_json({"t": time.time(), "mcu": {k: st[k] for k in STATE_FIELDS} if st else None,
                                "leases": rover.leases.snapshot(), "mission": bool(rover.mission)})
            next_at = max(next_at + TELEMETRY_S, loop.time() - TELEMETRY_S)
            await asyncio.sleep(max(0.0, next_at - loop.time()))
    except ConnectionResetError:
        pass
    finally:
        reader.cancel()
    return ws


def build_app(rover: Rover) -> web.Application:
    app = web.Application(middlewares=[require_token])
    app["rover"] = rover
    app.router.add_get("/status", get_status)
    app.router.add_get("/photo/{n:\\d+}", get_photo)
    app.router.add_get("/frame", get_frame)
    app.router.add_post("/mission/start", post_mission_start)
    app.router.add_post("/mission/end", post_mission_end)
    app.router.add_post("/money", post_money)
    app.router.add_post("/money/hb", post_money_hb)
    app.router.add_get("/telemetry", telemetry)
    if rover.settings.test_mode:
        app.router.add_post("/test/duty", post_test_duty)
        app.router.add_post("/test/fault", post_test_fault)
    return app
# 2026-11-06T03:30:00
# 2026-11-06T22:17:06


# /photo/{n}: return 404 when the photo has not been captured yet.
# The photo is only available after the mission loop has executed a photo skill
# and the sha256 has been recorded.
# GET /status includes photos:[{n, sha256, seq}] to let the shop poll readiness.
def _photo_ready(self, n: int) -> bool:
    return n in self._state.photos
