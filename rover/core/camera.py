"""Latest-frame grabber for the C310. Exposure and white balance are measured for the current light by
autocalibrate() (service start, every mission start) and stay locked in between."""

import json
import logging
import subprocess
import threading
import time
from pathlib import Path

import cv2
import numpy as np

CAMERA_FILE = Path(__file__).with_name("camera.json")
SMALL_WIDTH = 512
SMALL_QUALITY = 70
SHEET_TILE_WIDTH, SHEET_COLUMNS = SMALL_WIDTH, 4  # a scan's 12 views as 4 x 3 on one JPEG, each as sharp as a 0G frame
FULL_QUALITY = 90
MIN_UPTIME_S = 25  # the C310 gets one USB reset at ~21 s uptime on every boot
EXPOSURES = (300, 200, 100)  # 30/20/10 ms: whole mains half-cycles at 50 Hz, so no flicker banding
LUMA_LO, LUMA_TARGET, LUMA_HI, CLIP_MAX = 100, 120, 140, 0.02
WB_TEMPERATURE = 2900
AWB_SETTLE_FRAMES = 90
SETTLE_FRAMES = 6  # controls written while streaming take effect within a few frames (P2 probe)

log = logging.getLogger("rover.camera")


def load_settings(path: Path = CAMERA_FILE) -> dict:
    return json.loads(path.read_text())["values"]


def uptime_s() -> float:
    return float(Path("/proc/uptime").read_text().split()[0])


def apply_controls(device: str, s: dict) -> None:
    """Call only while streaming: the C310 ignores controls written before its stream starts (P2 probe).
    Each auto mode is toggled so the manual value is really written, then the values it unlocks."""
    controls = [
        ("auto_exposure", 3),
        ("white_balance_automatic", 1),
        ("exposure_dynamic_framerate", 1),
        ("auto_exposure", 1),
        ("exposure_dynamic_framerate", 0),
        ("exposure_time_absolute", s["exposure_time_absolute"]),
        ("gain", s["gain"]),
        ("white_balance_automatic", 0),
        ("white_balance_temperature", s["white_balance_temperature"]),
        ("power_line_frequency", s["power_line_frequency"]),
    ]
    for name, value in controls:
        subprocess.run(["v4l2-ctl", "-d", device, "-c", f"{name}={value}"], check=True, capture_output=True)


def set_controls(device: str, **values) -> None:
    subprocess.run(["v4l2-ctl", "-d", device, "-c", ",".join(f"{k}={v}" for k, v in values.items())],
                   check=True, capture_output=True)


def read_controls(device: str, names) -> dict:
    out = subprocess.run(["v4l2-ctl", "-d", device, "-C", ",".join(names)], check=True, capture_output=True,
                         text=True).stdout
    # Menu controls read back as "1 (Manual Mode)".
    return {k.strip(): int(v.split()[0]) for k, v in (line.split(":", 1) for line in out.splitlines() if ":" in line)}


def wb_matrix(s: dict):
    """Fixed R and B gains on top of the manual temperature: the C310 has no tint control (P2 calibration)."""
    gr, gb = s.get("wb_gain_r", 1.0), s.get("wb_gain_b", 1.0)
    return None if gr == gb == 1.0 else np.diag([gb, 1.0, gr]).astype(np.float32)


def balance(frame, wb):
    return frame if wb is None else cv2.transform(frame, wb)


def crop_box(jpeg: bytes, box: list[int], margin: float = 0.15, side: int = 512) -> bytes:
    """The part of a JPEG inside a 0-1000 box, with a margin, scaled so its long side is `side` (the photo check)."""
    img = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("not a JPEG")
    h, w = img.shape[:2]
    x1, y1, x2, y2 = box
    mx, my = (x2 - x1) * margin, (y2 - y1) * margin
    left, right = max(0, round((x1 - mx) * w / 1000)), min(w, round((x2 + mx) * w / 1000))
    top, bottom = max(0, round((y1 - my) * h / 1000)), min(h, round((y2 + my) * h / 1000))
    if right - left < 8 or bottom - top < 8:
        raise ValueError("box too small to crop")
    part = img[top:bottom, left:right]
    scale = side / max(part.shape[:2])
    part = cv2.resize(part, (round(part.shape[1] * scale), round(part.shape[0] * scale)),
                      interpolation=cv2.INTER_CUBIC if scale > 1 else cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", part, [cv2.IMWRITE_JPEG_QUALITY, 90])
    if not ok:
        raise RuntimeError("crop did not encode")
    return buf.tobytes()


def luma(frame) -> float:
    """Mean brightness 0-255 of a BGR frame."""
    return float(cv2.mean(cv2.cvtColor(cv2.resize(frame, (160, 120)), cv2.COLOR_BGR2GRAY))[0])


def colour_ratios(frames) -> tuple[float, float]:
    """R/G and B/G over pixels that are neither black nor clipped."""
    f = np.mean(np.stack([cv2.resize(x, (160, 120)) for x in frames]).astype(np.float32), axis=0)
    keep = (f.min(axis=2) > 15) & (f.max(axis=2) < 240)
    b, g, r = (float(f[..., i][keep].mean()) for i in range(3))
    return r / g, b / g


class Camera:
    def __init__(self, device: str, settings: dict | None = None):
        self.device = device
        self.settings = settings or load_settings()
        self._wb = wb_matrix(self.settings)
        self.calibration = None
        self._lock = threading.Lock()
        self._frame = None
        self._frame_at = 0.0
        self._seq = 0
        self._stop = threading.Event()
        self.opens = 0
        self.read_failures = 0
        self._thread = threading.Thread(target=self._run, name="camera", daemon=True)

    def start(self):
        self._thread.start()
        return self

    def stop(self):
        self._stop.set()
        self._thread.join(timeout=3)

    def _open(self):
        cap = cv2.VideoCapture(self.device, cv2.CAP_V4L2)
        if not cap.isOpened():
            return None
        cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.settings["width"])
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.settings["height"])
        cap.set(cv2.CAP_PROP_FPS, self.settings["fps"])
        ok, _ = cap.read()
        if not ok:
            cap.release()
            return None
        apply_controls(self.device, self.settings)
        self.opens += 1
        return cap

    def _run(self):
        while not self._stop.is_set() and uptime_s() < MIN_UPTIME_S:
            time.sleep(0.5)
        cap = None
        while not self._stop.is_set():
            if cap is None:
                try:
                    cap = self._open()
                except Exception as e:
                    log.warning("camera open failed: %s", e)
                    cap = None
                if cap is None:
                    time.sleep(1.0)
                    continue
            ok, frame = cap.read()
            if not ok or frame is None:
                self.read_failures += 1
                cap.release()
                cap = None
                continue
            with self._lock:
                self._frame, self._frame_at = frame, time.monotonic()
                self._seq += 1
        if cap is not None:
            cap.release()

    def latest(self):
        with self._lock:
            return self._frame, self._frame_at, self._seq

    def _frames(self, n: int, skip: int = SETTLE_FRAMES, timeout_s: float = 5.0) -> list:
        """n new frames, after skipping the ones taken before the last control change settled."""
        start, out, last = self.latest()[2], [], None
        end = time.monotonic() + timeout_s
        while len(out) < n:
            if time.monotonic() > end:
                raise RuntimeError("camera stopped delivering frames")
            frame, _, seq = self.latest()
            if seq > start + skip and seq != last:
                out.append(frame)
                last = seq
            time.sleep(0.005)
        return out

    def _measure(self, **controls) -> dict:
        set_controls(self.device, **controls)
        frames = self._frames(4)
        gray = [cv2.cvtColor(cv2.resize(f, (160, 120)), cv2.COLOR_BGR2GRAY) for f in frames]
        return {**controls, "luma": round(sum(luma(f) for f in frames) / len(frames), 1),
                "clip": round(float(np.mean([(g >= 250).mean() for g in gray])), 4)}

    def autocalibrate(self) -> dict:
        """~8 s with the rover still: the longest flicker-free exposure that does not clip at gain 0, then the
        gain that brings luma into 100-140, then fixed R/B gains matching the camera's own auto white balance."""
        t0 = time.monotonic()
        trials = []
        exposure = EXPOSURES[-1]
        for e in EXPOSURES:
            m = self._measure(exposure_time_absolute=e, gain=0)
            trials.append(m)
            if m["luma"] <= LUMA_HI and m["clip"] <= CLIP_MAX:
                exposure = e
                break
        lo, hi, best = 0, 255, trials[-1] if trials[-1]["exposure_time_absolute"] == exposure else None
        for _ in range(8):
            if best and LUMA_LO <= best["luma"] <= LUMA_HI and best["clip"] <= CLIP_MAX or lo > hi:
                break
            m = self._measure(exposure_time_absolute=exposure, gain=(lo + hi) // 2)
            trials.append(m)
            if m["luma"] < LUMA_LO:
                lo = m["gain"] + 1
            else:
                hi = m["gain"] - 1
            if m["clip"] <= CLIP_MAX and (best is None or abs(m["luma"] - LUMA_TARGET) < abs(best["luma"] - LUMA_TARGET)):
                best = m
        set_controls(self.device, exposure_time_absolute=exposure, gain=best["gain"])
        set_controls(self.device, white_balance_automatic=1)
        awb_rg, awb_bg = colour_ratios(self._frames(5, skip=AWB_SETTLE_FRAMES))
        set_controls(self.device, white_balance_automatic=0)
        set_controls(self.device, white_balance_temperature=WB_TEMPERATURE)
        rg, bg = colour_ratios(self._frames(5, skip=10))
        self.settings = {**self.settings, "exposure_time_absolute": exposure, "gain": best["gain"],
                         "white_balance_temperature": WB_TEMPERATURE,
                         "wb_gain_r": round(awb_rg / rg, 3), "wb_gain_b": round(awb_bg / bg, 3)}
        self._wb = wb_matrix(self.settings)
        self.calibration = {"exposure_time_absolute": exposure, "gain": best["gain"], "luma": best["luma"],
                            "wb_gain_r": self.settings["wb_gain_r"], "wb_gain_b": self.settings["wb_gain_b"],
                            "seconds": round(time.monotonic() - t0, 1), "trials": len(trials), "at": time.time()}
        log.info("camera calibrated: %s", self.calibration)
        return self.calibration

    def jpeg_small(self, max_age_s: float = 6.0):
        frame, at, seq = self.latest()
        if frame is None or time.monotonic() - at > max_age_s:
            return None
        h, w = frame.shape[:2]
        small = cv2.resize(frame, (SMALL_WIDTH, int(h * SMALL_WIDTH / w)), interpolation=cv2.INTER_AREA)
        ok, buf = cv2.imencode(".jpg", balance(small, self._wb), [cv2.IMWRITE_JPEG_QUALITY, SMALL_QUALITY])
        return (buf.tobytes(), at, seq) if ok else None

    def jpeg_pair(self, max_age_s: float = 6.0):
        """(512 px q70 for 0G, full frame q90 for a photo) of the same frame, so a photo is exactly what 0G judged."""
        frame, at, seq = self.latest()
        if frame is None or time.monotonic() - at > max_age_s:
            return None
        h, w = frame.shape[:2]
        small = cv2.resize(frame, (SMALL_WIDTH, int(h * SMALL_WIDTH / w)), interpolation=cv2.INTER_AREA)
        ok_s, small_buf = cv2.imencode(".jpg", balance(small, self._wb), [cv2.IMWRITE_JPEG_QUALITY, SMALL_QUALITY])
        ok_f, full_buf = cv2.imencode(".jpg", balance(frame, self._wb), [cv2.IMWRITE_JPEG_QUALITY, FULL_QUALITY])
        return (small_buf.tobytes(), full_buf.tobytes(), at, seq) if ok_s and ok_f else None

    def sheet(self, frames: list) -> bytes:
        """A scan's views on one JPEG, numbered 1..n in reading order, white-balanced like the 0G frame."""
        tiles = []
        for n, frame in enumerate(frames, 1):
            h, w = frame.shape[:2]
            tile = cv2.resize(frame, (SHEET_TILE_WIDTH, h * SHEET_TILE_WIDTH // w), interpolation=cv2.INTER_AREA)
            tile = cv2.copyMakeBorder(balance(tile, self._wb), 3, 3, 3, 3, cv2.BORDER_CONSTANT, value=(255, 255, 255))
            cv2.rectangle(tile, (3, 3), (60, 60), (0, 0, 0), -1)
            cv2.putText(tile, str(n), (14, 50), cv2.FONT_HERSHEY_SIMPLEX, 1.5, (255, 255, 255), 3)
            tiles.append(tile)
        tiles += [np.full_like(tiles[0], 255)] * (-len(tiles) % SHEET_COLUMNS)  # a 7-view sweep leaves a short last row
        rows = [np.hstack(tiles[i:i + SHEET_COLUMNS]) for i in range(0, len(tiles), SHEET_COLUMNS)]
        ok, buf = cv2.imencode(".jpg", np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, SMALL_QUALITY])
        if not ok:
            raise RuntimeError("scan sheet did not encode")
        return buf.tobytes()

    def jpeg_full(self, max_age_s: float = 1.0):
        frame, at, seq = self.latest()
        if frame is None or time.monotonic() - at > max_age_s:
            return None
        ok, buf = cv2.imencode(".jpg", balance(frame, self._wb), [cv2.IMWRITE_JPEG_QUALITY, FULL_QUALITY])
        return (buf.tobytes(), at, seq) if ok else None
# 2026-11-06T02:18:00
# 2026-11-06T22:12:22
