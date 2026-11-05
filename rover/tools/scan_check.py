"""P6 operator tool: scans outside a mission. The rover turns a full circle in place and 0G picks a view from the
sheet; --face turns to it, and --rounds N also drives each explore leg and scans again, until 0G faces a view or N
scans are done. Stop rover.service first (this tool owns the Bridge and the camera). On the UNO Q:
    cd ~/0xbs-rover && venv/bin/python -m rover.tools.scan_check --scene "#3 behind the rover" --expect-view 5 --face
Appends to evidence/P6/scan/scans.jsonl and records.jsonl; saves each sheet and the frame after facing.
"""

import argparse
import json
import time
from datetime import datetime, timezone
from pathlib import Path

from rover.core.bridge import McuWorker
from rover.core.camera import Camera, load_settings
from rover.core.mission import explore_views
from rover.core.config import settings
from rover.core.main import push_calibration
from rover.core.skills import Skills
from rover.zg.brain import PROVIDER, Brain, now_ms, parcel_number, scan_json
from rover.zg.checkpoint import checkpoint_fields
from rover.zg.prompt import MISSION, SCAN_PICKS, SCAN_VIEWS
from rover.zg.proof import Prover
from rover.zg.records import Chain

EVIDENCE = Path.home() / "0xbs-rover" / "evidence" / "P6" / "scan"


def scan_once(a, stamp, n, skills, camera, brain, prover, chain):
    t0 = time.monotonic()
    scan = skills.scan(SCAN_VIEWS)
    scan_s = round(time.monotonic() - t0, 1)
    views = scan.pop("views")
    if len(views) != SCAN_VIEWS:
        raise SystemExit(f"scan stopped after {len(views)} views: {scan['steps'][-1]}")
    sheet = camera.sheet([v["frame"] for v in views])
    (EVIDENCE / f"{stamp}_{n}_sheet.jpg").write_bytes(sheet)
    sonar = [v["sonar_mm"] for v in views]
    rules = {"number": parcel_number(MISSION), "explore_views": explore_views(sonar)}
    fields, timings = checkpoint_fields(brain, prover, sheet, now_ms(), 0.0,
                                        lambda nonce: scan_json(nonce, 0, sonar, rules["explore_views"]),
                                        allowed=list(SCAN_PICKS), scan=rules)
    record = chain.append(fields)
    with open(EVIDENCE / "records.jsonl", "a") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
    row = {"round": n, "scan_s": scan_s, "explore_views": rules["explore_views"], "raw_response": record["raw_response"], "yaws_deg": [round(v["yaw_cdeg"] / 100) for v in views], "sonar_mm": sonar,
           "decision": record["decision"], "safe_stop": record["safe_stop"], "verified": record["proof"]["verified"],
           "latency_ms": record["latency_ms"], "sig_fetch_ms": timings["sig_fetch_ms"],
           "billing_usd_micro": record["billing_usd_micro"], "sheet_bytes": len(sheet)}
    return row, record["decision"] or {}, views


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--scene", required=True)
    p.add_argument("--expect-view", type=int, help="the view that shows #3, or 0 when it is not there")
    p.add_argument("--face", action="store_true", help="turn to the view 0G picked (no driving)")
    p.add_argument("--rounds", type=int, default=1, help="drive each explore leg and scan again, up to this many scans")
    a = p.parse_args()

    s = settings()
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    camera = Camera(s.camera_device).start()
    worker = McuWorker(on_connect=push_calibration, require_kick=False).start()
    brain, prover = Brain(s.zg_api_key), Prover(PROVIDER)
    brain.warm()
    prover.load_service()
    rounds, found = [], None
    try:
        while camera.latest()[2] < 30 or not worker.connected:
            time.sleep(0.2)
        print(json.dumps({"camera_calibration": camera.autocalibrate()}), flush=True)
        worker.call("imu_cal", timeout=10)
        skills = Skills(worker, camera, lambda: (True, None), load_settings()["hfov_deg"])
        chain = Chain(f"scan-{stamp}")
        for n in range(1, a.rounds + 1):
            row, decision, views = scan_once(a, stamp, n, skills, camera, brain, prover, chain)
            rounds.append(row)
            print(json.dumps(row), flush=True)
            yaw = views[decision["view"] - 1]["yaw_cdeg"] if decision else None
            if decision.get("skill") == "face_view":
                found = decision["view"]
                if a.face or a.rounds > 1:
                    row["faced"] = skills.face_view(yaw)
                    time.sleep(0.5)
                    (EVIDENCE / f"{stamp}_{n}_faced.jpg").write_bytes(camera.jpeg_small()[0])
                break
            if decision.get("skill") != "explore" or n == a.rounds:
                break
            row["explored"] = skills.explore(yaw)
            print(json.dumps({"explored": row["explored"]}), flush=True)
    finally:
        try:
            worker.call("stop")
        except Exception:
            pass
        worker.stop()
        camera.stop()
    last = rounds[-1]["decision"] if rounds else None
    expected = None
    if a.expect_view is not None and last:
        want = ("face_view", a.expect_view) if a.expect_view else ("explore", last.get("view"))
        expected = (last.get("skill"), last.get("view")) == want
    summary = {"at": stamp, "scene": a.scene, "expect_view": a.expect_view, "pass": expected, "found_view": found,
               "rounds": rounds}
    with open(EVIDENCE / "scans.jsonl", "a") as f:
        f.write(json.dumps(summary) + "\n")
    print(json.dumps({k: v for k, v in summary.items() if k != "rounds"}))


if __name__ == "__main__":
    main()
