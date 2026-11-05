"""P2 camera calibration. Stop rover.service first (it owns the camera and the Bridge). On the UNO Q:
    cd ~/0xbs-rover && venv/bin/python -m rover.tools.camera_cal exposure
    cd ~/0xbs-rover && venv/bin/python -m rover.tools.camera_cal hfov   (saves the wall frame; then again with
        --distance-cm --spacing-cm --x-left --x-right --sonar-mm to record the result)
Results go to evidence/P2/camera_<cmd>.json; copy the chosen values into rover/core/camera.json.
"""

import argparse
import json
import math
import statistics
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np

from rover.core.camera import Camera, apply_controls, balance, colour_ratios, load_settings, luma, read_controls, set_controls
from rover.core.config import settings

EVIDENCE = Path.home() / "0xbs-rover" / "evidence" / "P2"
EXPOSURES = (100, 200, 300)  # 10/20/30 ms: whole mains half-cycles at 50 Hz, so no flicker banding
GAINS = (0, 32, 64, 96, 128, 160, 192, 224, 255)
TEMPS = range(2800, 6600, 100)
AWB_SETTLE_FRAMES = 120
LUMA_LO, LUMA_HI, CLIP_MAX = 100, 140, 0.02


def save(name, result):
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    result = {"at": datetime.now(timezone.utc).isoformat(), **result}
    (EVIDENCE / f"camera_{name}.json").write_text(json.dumps(result, indent=1))
    print(json.dumps(result, indent=1))


def open_raw(device, s):
    cap = cv2.VideoCapture(device, cv2.CAP_V4L2)
    if not cap.isOpened():
        raise SystemExit("camera busy or missing: stop rover.service first")
    cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, s["width"])
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, s["height"])
    cap.set(cv2.CAP_PROP_FPS, s["fps"])
    cap.read()
    apply_controls(device, s)
    frames(cap, 1, skip=60)
    return cap


def frames(cap, n, skip=8):
    for _ in range(skip):
        cap.read()
    out = []
    while len(out) < n:
        ok, f = cap.read()
        if ok and f is not None:
            out.append(f)
    return out


def measure(cap, n=4):
    fs = frames(cap, n)
    gray = [cv2.cvtColor(f, cv2.COLOR_BGR2GRAY) for f in fs]
    return {
        "luma": round(statistics.mean(luma(f) for f in fs), 1),
        "clip": round(statistics.mean(float((g >= 250).mean()) for g in gray), 4),
        "frames": fs,
    }


def cmd_exposure(a):
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    device = settings().camera_device
    s = dict(load_settings())
    cap = open_raw(device, s)
    sweep = []
    for exp in EXPOSURES:
        for gain in GAINS:
            set_controls(device, exposure_time_absolute=exp, gain=gain)
            m = measure(cap)
            sweep.append({"exposure": exp, "gain": gain, "luma": m["luma"], "clip": m["clip"]})
            print(sweep[-1])
    inside = [x for x in sweep if LUMA_LO <= x["luma"] <= LUMA_HI and x["clip"] <= CLIP_MAX]
    if inside:
        best = min(inside, key=lambda x: (x["gain"], x["exposure"]))
        rule = f"lowest gain (photos are taken stopped), then shorter exposure, with luma {LUMA_LO}-{LUMA_HI} and clip <= {CLIP_MAX}"
    else:
        best = min((x for x in sweep if x["clip"] <= CLIP_MAX), key=lambda x: abs(x["luma"] - 120))
        rule = "no setting reached the luma window; closest to luma 120 without clipping"
    set_controls(device, exposure_time_absolute=best["exposure"], gain=best["gain"])

    set_controls(device, white_balance_automatic=1)
    awb_rg, awb_bg = colour_ratios(frames(cap, 5, skip=AWB_SETTLE_FRAMES))
    set_controls(device, white_balance_automatic=0)
    wb = []
    for t in TEMPS:
        set_controls(device, white_balance_temperature=t)
        rg, bg = colour_ratios(frames(cap, 3, skip=10))
        err = abs(math.log(rg / awb_rg)) + abs(math.log(bg / awb_bg))
        wb.append({"temp": t, "error": round(err, 4), "r_g": round(rg, 3), "b_g": round(bg, 3)})
    temp = min(wb, key=lambda x: x["error"])["temp"]
    set_controls(device, white_balance_temperature=temp)
    rg, bg = colour_ratios(frames(cap, 5, skip=10))
    gain_r, gain_b = round(awb_rg / rg, 3), round(awb_bg / bg, 3)
    wb_mat = np.diag([gain_b, 1.0, gain_r]).astype(np.float32)

    t0 = time.monotonic()
    lumas = [luma(f) for f in frames(cap, 300, skip=10)]
    fps = 300 / (time.monotonic() - t0)
    balanced = [balance(f, wb_mat) for f in frames(cap, 5)]
    after_rg, after_bg = colour_ratios(balanced)
    ok, jpg = cv2.imencode(".jpg", balanced[-1], [cv2.IMWRITE_JPEG_QUALITY, 90])
    (EVIDENCE / "camera_exposure.jpg").write_bytes(jpg.tobytes())
    readback = read_controls(device, ["auto_exposure", "exposure_time_absolute", "gain",
                                      "white_balance_automatic", "white_balance_temperature", "power_line_frequency"])
    cap.release()
    save("exposure", {
        "chosen": {"exposure_time_absolute": best["exposure"], "gain": best["gain"], "white_balance_temperature": temp,
                   "wb_gain_r": gain_r, "wb_gain_b": gain_b},
        "rule": rule,
        "wb_rule": "manual temperature whose R/G and B/G best match the camera's own auto white balance, settled in this scene",
        "awb": {"r_g": round(awb_rg, 3), "b_g": round(awb_bg, 3)},
        "after_gains": {"r_g": round(after_rg, 3), "b_g": round(after_bg, 3)},
        "check_300_frames": {"fps": round(fps, 2), "luma_mean": round(statistics.mean(lumas), 1),
                             "luma_min": round(min(lumas), 1), "luma_max": round(max(lumas), 1)},
        "readback": readback,
        "sweep": sweep,
        "wb_sweep": wb,
    })


def cmd_hfov(a):
    """Two marks on a flat wall facing the camera, spacing S apart, lens at distance D:
    pinhole x = cx + f * X / D, so f = D * (x_right - x_left) / S whatever cx is."""
    from rover.core.mcu import connect

    s = load_settings()
    path = EVIDENCE / "frames" / "hfov_wall.jpg"
    if a.x_left is None or a.x_right is None:
        camera = Camera(settings().camera_device).start()
        try:
            while camera.latest()[0] is None:
                time.sleep(0.2)
            time.sleep(1.0)
            path.parent.mkdir(parents=True, exist_ok=True)
            cv2.imwrite(str(path), camera.latest()[0])
        finally:
            camera.stop()
        sonar = connect().state()["sonar_mm"]
        print(json.dumps({"frame": str(path), "sonar_mm": sonar}))
        return
    f = a.distance_cm * (a.x_right - a.x_left) / a.spacing_cm
    hfov = math.degrees(2 * math.atan(s["width"] / 2 / f))
    save("hfov", {
        "method": "two wall marks at a measured spacing, lens-to-wall distance by tape; pinhole on a fronto-parallel plane",
        "frame": str(path), "distance_cm": a.distance_cm, "spacing_cm": a.spacing_cm,
        "x_left_px": a.x_left, "x_right_px": a.x_right, "sonar_mm": a.sonar_mm,
        "focal_px": round(f, 1), "hfov_deg": round(hfov, 1),
    })


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("exposure")
    h = sub.add_parser("hfov")
    h.add_argument("--distance-cm", type=float)
    h.add_argument("--spacing-cm", type=float)
    h.add_argument("--x-left", type=float, help="pixel column of the left mark in frames/hfov_wall.jpg")
    h.add_argument("--x-right", type=float)
    h.add_argument("--sonar-mm", type=int)
    a = p.parse_args()
    {"exposure": cmd_exposure, "hfov": cmd_hfov}[a.cmd](a)


if __name__ == "__main__":
    main()
# 2026-11-06T04:42:00
# 2026-11-06T22:58:31
