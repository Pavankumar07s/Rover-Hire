"""P3 operator tool: decide-only 0G checkpoints on the live camera and sonar. No motion.
Stop rover.service first (this tool owns the camera). On the UNO Q:
    cd ~/0xbs-rover && venv/bin/python -m rover.tools.zg_check --scene "parcel ahead" --expect approach --n 3
Writes evidence/P3/records.jsonl (hash-chained per episode), stats.jsonl and frames/.
"""

import argparse
import json
import statistics
import time
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np

from rover.core.camera import Camera
from rover.core.config import settings
from rover.core.mcu import connect
from rover.zg.brain import MODEL, PROVIDER, Brain, now_ms, sensors_json
from rover.zg.checkpoint import FAULTS, run_checkpoint
from rover.zg.proof import Prover
from rover.zg.prompt import MISSION
from rover.zg.records import Chain
from rover.zg.zglog import ZgLog

EVIDENCE = Path.home() / "0xbs-rover" / "evidence" / "P3"
BACKOFF_AFTER, BACKOFF_S = 3, 5.0


def save_frames(jpeg: bytes, sha: str, target) -> None:
    frames = EVIDENCE / "frames"
    frames.mkdir(parents=True, exist_ok=True)
    (frames / f"{sha}.jpg").write_bytes(jpeg)
    if target:
        img = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
        h, w = img.shape[:2]
        x1, y1, x2, y2 = target
        cv2.rectangle(img, (x1 * w // 1000, y1 * h // 1000), (x2 * w // 1000, y2 * h // 1000), (0, 0, 255), 2)
        cv2.imwrite(str(frames / f"{sha}_bbox.jpg"), img)


def pct(values, p):
    s = sorted(values)
    return s[min(len(s) - 1, round(p / 100 * (len(s) - 1)))] if s else None


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--scene", required=True)
    p.add_argument("--expect", help="skill the scene should produce")
    p.add_argument("--n", type=int, default=1)
    p.add_argument("--interval", type=float, default=1.0)
    p.add_argument("--fault", choices=FAULTS)
    p.add_argument("--model", default=MODEL, help="another model name, for the private-mode refusal test")
    p.add_argument("--zglog", action="store_true", help="ship the episode to zg-log (ZG_LOG_URL, ZG_LOG_TOKEN)")
    p.add_argument("--zglog-wait", type=float, default=120.0, help="seconds to wait for the spool to drain at the end")
    a = p.parse_args()

    global EVIDENCE
    if a.zglog:
        EVIDENCE = EVIDENCE.parent / "P4"
    s = settings()
    if not s.zg_api_key:
        raise SystemExit("ZG_API_KEY is not set in ~/0xbs-rover/rover.env")
    if a.fault and not s.test_mode:
        raise SystemExit("fault switches need ROVER_TEST_MODE=1")
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    camera = Camera(s.camera_device).start()
    mcu = connect()
    brain, prover = Brain(s.zg_api_key), Prover(PROVIDER)
    brain.warm()
    try:
        service = prover.load_service()
    except Exception as e:
        service = {"error": f"{type(e).__name__}: {e}"}
    episode = ("p4-" if a.zglog else "p3-") + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    chain = Chain(episode)
    zglog = None
    if a.zglog:
        if not (s.zg_log_url and s.zg_log_token):
            raise SystemExit("ZG_LOG_URL and ZG_LOG_TOKEN must be set in ~/0xbs-rover/rover.env")
        zglog = ZgLog(s.zg_log_url, s.zg_log_token, EVIDENCE.parent / "zglog-spool").start()
        zglog.episode(episode, MISSION)
    print(json.dumps({"episode": episode, "service": service}))
    rows, fails = [], 0
    try:
        while camera.latest()[2] < 30:
            time.sleep(0.2)
        print(json.dumps({"camera_calibration": camera.autocalibrate()}))
        for _ in range(a.n):
            mcu.face("thinking")
            shot = camera.jpeg_small()
            if shot is None:
                raise SystemExit("no fresh camera frame")
            jpeg, at, _ = shot
            age = time.monotonic() - at
            st = mcu.state()
            record, timings = run_checkpoint(
                brain, prover, chain, jpeg, now_ms() - round(age * 1000), age,
                lambda nonce: sensors_json(nonce, st["sonar_mm"], 0, 0, st["batt_mv"], 0, []),
                fault=a.fault, model=a.model)
            stop = record["safe_stop"]
            mcu.face(stop["reason"] if stop else "ready")
            decision = record["decision"] or {}
            save_frames(jpeg, record["img_sha256"], decision.get("target"))
            with open(EVIDENCE / "records.jsonl", "a") as f:
                f.write(json.dumps(record, ensure_ascii=False) + "\n")
            if zglog:
                zglog.record(record, jpeg)
            row = {"episode": episode, "seq": record["seq"], "scene": a.scene, "expect": a.expect,
                   "skill": decision.get("skill"), "see": decision.get("see"), "target": decision.get("target"),
                   "sonar_mm": st["sonar_mm"], "latency_ms": record["latency_ms"], "sig_fetch_ms": timings["sig_fetch_ms"],
                   "verified": record["proof"]["verified"], "nonce_echoed": record["nonce_echoed"],
                   "safe_stop": stop, "billing_usd_micro": record["billing_usd_micro"], "fault": a.fault, "model": a.model}
            row["match"] = a.expect is None or row["skill"] == a.expect
            rows.append(row)
            with open(EVIDENCE / "stats.jsonl", "a") as f:
                f.write(json.dumps(row, ensure_ascii=False) + "\n")
            print(json.dumps(row, ensure_ascii=False))
            fails = fails + 1 if stop else 0
            if fails >= BACKOFF_AFTER:
                time.sleep(BACKOFF_S)
                fails = 0
            time.sleep(a.interval)
    finally:
        camera.stop()
        if zglog:
            zglog.end(episode)
            drained = zglog.wait_drained(a.zglog_wait)
            print(json.dumps({"zglog_drained": drained, "pending": zglog.pending(), "halted": zglog.halted,
                              "retries": zglog.retries, "last_error": zglog.last_error}))
    lat = [r["latency_ms"] for r in rows if r["latency_ms"] is not None]
    fetch = [ms for r in rows for ms in r["sig_fetch_ms"]]
    print(json.dumps({
        "episode": episode, "n": len(rows), "decided": sum(1 for r in rows if r["skill"]),
        "verified": sum(1 for r in rows if r["verified"]), "nonce_echoed": sum(1 for r in rows if r["nonce_echoed"]),
        "expected": sum(1 for r in rows if r["match"]) if a.expect else None,
        "latency_ms": {"median": statistics.median(lat) if lat else None, "p90": pct(lat, 90), "max": max(lat, default=None)},
        "sig_fetch_ms": {"median": statistics.median(fetch) if fetch else None, "p90": pct(fetch, 90), "max": max(fetch, default=None)},
        "billing_usd_micro": sum(r["billing_usd_micro"] or 0 for r in rows),
    }))


if __name__ == "__main__":
    main()
# 2026-11-06T06:18:00
