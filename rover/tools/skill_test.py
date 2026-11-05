"""P2 operator tool: runs one skill with explicit arguments. Not reachable over the API.
Stop rover.service first (this tool owns the Bridge and the camera). On the UNO Q:
    cd ~/0xbs-rover && venv/bin/python -m rover.tools.skill_test <skill> [options]
Every run appends one JSON line to evidence/P2/skills.jsonl.
"""

import argparse
import hashlib
import json
import signal
import time
from datetime import datetime, timezone
from pathlib import Path

from rover.core.bridge import McuWorker
from rover.core.camera import Camera, load_settings
from rover.core.config import settings
from rover.core.main import push_calibration
from rover.core.skills import Skills
from rover.zg.brain import Brain, BrainError, new_nonce, scan_json
from rover.zg.prompt import SCAN_VIEWS, SWEEP_SPAN_DEG, SWEEP_VIEWS

EVIDENCE = Path.home() / "0xbs-rover" / "evidence" / "P2"
STATE_KEYS = ("yaw_cdeg", "sonar_mm", "batt_mv", "batt_min_mv", "stop_name", "imu_resets", "imu_bus_errors")


def stamp():
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")


def save_jpeg(jpeg, name):
    path = EVIDENCE / "frames" / f"{name}_{stamp()}.jpg"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(jpeg)
    return path


def run(a, worker, camera):
    fails_at = time.monotonic() + a.gate_fail_after if a.gate_fail_after is not None else None

    def gate():
        if fails_at is not None and time.monotonic() >= fails_at:
            return False, "operator gate cut"
        return True, None

    skills = Skills(worker, camera, gate, load_settings()["hfov_deg"])
    if a.skill == "frame":
        shot = camera.jpeg_full()
        return {"file": str(save_jpeg(shot[0], "frame")), "frame_seq": shot[2]}
    if a.skill == "photo":
        r = skills.photo()
        path = save_jpeg(r.pop("jpeg"), "photo")
        r.update(file=str(path), file_sha256=hashlib.sha256(path.read_bytes()).hexdigest())
        r["sha256_match"] = r["sha256"] == r["file_sha256"]
        return r
    worker.call("imu_cal", timeout=10)
    if a.skill == "approach":
        return skills.approach([int(v) for v in a.bbox.split(",")], a.stop_cm)
    if a.skill == "orbit":
        return skills.orbit_leg(a.orbit)
    if a.skill == "back_off":
        return skills.back_off()
    if a.skill == "scan":
        r = skills.scan(SCAN_VIEWS)
        views = r.pop("views")
        r["views"] = [{k: v[k] for k in ("yaw_cdeg", "sonar_mm")} for v in views]
        if len(views) == SCAN_VIEWS:
            r["file"] = str(save_jpeg(camera.sheet([v["frame"] for v in views]), "scan"))
        return r
    if a.skill == "sweep":
        r = skills.sweep(SWEEP_VIEWS, SWEEP_SPAN_DEG)
        views = r.pop("views")
        r["views"] = [{k: v[k] for k in ("yaw_cdeg", "sonar_mm")} for v in views]
        if len(views) == SWEEP_VIEWS:
            sheet = camera.sheet([v["frame"] for v in views])
            r["file"] = str(save_jpeg(sheet, "sweep"))
            if a.ask:  # a real 0G call on the sheet, then face the view it picks
                nonce = new_nonce()
                sensors = scan_json(nonce, 0, [v["sonar_mm"] for v in views], [], f"Inspect parcel #{a.number} for damage")
                try:
                    info = Brain(settings().zg_api_key).decide(sheet, 0.0, sensors, nonce, allowed=["face_view"],
                                                               scan={"number": a.number, "views": SWEEP_VIEWS, "explore_views": []})
                    r["decision"] = info["decision"]
                    r["face"] = skills.face_view(views[info["decision"]["view"] - 1]["yaw_cdeg"])
                except BrainError as e:
                    r["decision"] = f"refused: {e}"
        return r
    if a.skill == "turn":
        return skills.turn(a.deg)
    if a.skill == "drive":
        return skills._run("drive_cm", a.cm, 0, 1500)
    if a.skill == "until":
        return skills._run("drive_until", a.cm, a.stop_mm, 1500)
    raise SystemExit(f"unknown skill {a.skill}")


def interrupt(signum, frame):
    raise KeyboardInterrupt


def main():
    signal.signal(signal.SIGTERM, interrupt)
    p = argparse.ArgumentParser()
    p.add_argument("skill", choices=("frame", "photo", "approach", "orbit", "back_off", "scan", "sweep", "turn", "drive", "until"))
    p.add_argument("--ask", action="store_true", help="sweep: ask 0G which view shows the parcel, then face it")
    p.add_argument("--number", default="3", help="sweep --ask: the parcel's number")
    p.add_argument("--bbox", help="x1,y1,x2,y2 in 0-1000 from a real frame")
    p.add_argument("--stop-cm", type=int, default=30)
    p.add_argument("--deg", type=int, default=0)
    p.add_argument("--cm", type=int, default=30)
    p.add_argument("--orbit", choices=("left", "right"), default="left")
    p.add_argument("--stop-mm", type=int, default=300, help="until: sonar distance that ends the drive")
    p.add_argument("--gate-fail-after", type=float, default=None, help="seconds until the lease gate reports a failure")
    p.add_argument("--remark", default="")
    a = p.parse_args()
    if a.skill == "approach" and not a.bbox:
        p.error("approach needs --bbox")

    camera = Camera(settings().camera_device).start()
    worker = McuWorker(on_connect=push_calibration, require_kick=False).start()
    try:
        # 30 frames: the controls written after the first frame take a few frames to settle.
        while camera.latest()[2] < 30 or not worker.connected:
            time.sleep(0.2)
        if a.skill in ("frame", "photo"):
            camera.autocalibrate()
        before = worker.call("state")
        result = run(a, worker, camera)
        time.sleep(0.3)
        after = worker.call("state")
    finally:
        try:
            worker.call("stop")
        except Exception:
            pass
        worker.stop()
        camera.stop()
    row = {"skill": a.skill, "at": datetime.now(timezone.utc).isoformat(),
           "args": {k: v for k, v in vars(a).items() if k not in ("skill", "remark") and v is not None},
           "before": {k: before[k] for k in STATE_KEYS}, "after": {k: after[k] for k in STATE_KEYS},
           "result": result, "remark": a.remark}
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    with open(EVIDENCE / "skills.jsonl", "a") as f:
        f.write(json.dumps(row) + "\n")
    print(json.dumps(row, indent=1))


if __name__ == "__main__":
    main()
# 2026-11-06T04:31:00
# 2026-11-06T23:00:53
