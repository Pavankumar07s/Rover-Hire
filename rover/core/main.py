"""Rover service entry point: python -m rover.core.main"""

import asyncio
import logging
import os
import threading
import time
from pathlib import Path

from aiohttp import web

from rover.zg.brain import PROVIDER, Brain
from rover.zg.proof import Prover
from rover.zg.zglog import ZgLog

from . import calibration
from .api import Rover, build_app
from .bridge import McuWorker
from .camera import Camera, load_settings
from .config import settings
from .lease import Leases
from .skills import Skills

KICK_S = 0.1
log = logging.getLogger("rover")


def filter_stderr(drop: bytes = b"Corrupt JPEG data") -> None:
    """The C310's MJPEG makes libjpeg print one warning per frame; keep everything else."""
    read_fd, write_fd = os.pipe()
    real = os.dup(2)
    os.dup2(write_fd, 2)
    os.close(write_fd)

    def pump():
        with os.fdopen(read_fd, "rb", 0) as src:
            for line in iter(src.readline, b""):
                if drop not in line:
                    os.write(real, line)

    threading.Thread(target=pump, name="stderr", daemon=True).start()


def push_calibration(mcu) -> None:
    mcu.set_cal(calibration.load())
    mcu.face("ready")
    log.info("calibration pushed: %s", calibration.load())


def calibrate_when_streaming(camera: Camera) -> None:
    while camera.latest()[2] < 30:
        time.sleep(0.5)
    try:
        camera.autocalibrate()
    except Exception as e:
        log.warning("camera calibration failed, keeping camera.json values: %s", e)


async def kick_forever(worker: McuWorker) -> None:
    while True:
        worker.kick()
        await asyncio.sleep(KICK_S)


def main() -> None:
    filter_stderr()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    s = settings()
    worker = McuWorker(on_connect=push_calibration).start()
    camera = Camera(s.camera_device).start()
    threading.Thread(target=calibrate_when_streaming, args=(camera,), name="camera-cal", daemon=True).start()
    leases = Leases()
    skills = Skills(worker, camera, lambda: leases.all_ok(moving=True), load_settings()["hfov_deg"])
    brain = Brain(s.zg_api_key) if s.zg_api_key else None
    if brain:
        brain.warm()
    zglog = ZgLog(s.zg_log_url, s.zg_log_token, Path.home() / "0xbs-rover" / "zglog-spool").start() if s.zg_log_url and s.zg_log_token else None
    rover = Rover(s, worker, camera, leases, skills=skills, brain=brain, prover=Prover(PROVIDER), zglog=zglog)
    app = build_app(rover)

    async def start_kicker(app):
        app["kicker"] = asyncio.create_task(kick_forever(worker))

    async def stop_all(app):
        app["kicker"].cancel()
        worker.submit("stop")
        camera.stop()
        worker.stop()

    app.on_startup.append(start_kicker)
    app.on_cleanup.append(stop_all)
    log.info("rover service on :%d (test mode %s)", s.port, s.test_mode)
    web.run_app(app, port=s.port, access_log=None, print=None)


if __name__ == "__main__":
    main()
# 2026-11-06T03:56:00
# 2026-11-06T22:51:25
