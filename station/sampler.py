"""Reads the MCU once a second, builds the signed reading and motion, and keeps a signed sample every 10 s for 24 h."""
import threading
import time
from collections import deque

from . import config
from .bridge import BridgeError, Mcu, McuState
from .sign import Signer


def light_pct_x100(raw: int) -> int:
    # The LM393 module's AO falls as light rises (confirmed): 0 = as dark as under a cup, 10000 = a torch.
    raw = max(config.LIGHT_BRIGHT, min(config.LIGHT_DARK, raw))
    return (config.LIGHT_DARK - raw) * 10000 // (config.LIGHT_DARK - config.LIGHT_BRIGHT)


class Sampler:
    def __init__(self, mcu: Mcu, signer: Signer):
        self.mcu, self.signer = mcu, signer
        self.state: McuState | None = None
        self.read_at = 0.0  # wall time of the last good MCU read
        self.error: str | None = None
        self.seq = 0
        self.history: deque[dict] = deque(maxlen=config.HISTORY_KEEP)
        self._lock = threading.Lock()
        self._next_history = 0.0

    def fresh_problem(self) -> str | None:
        """Why a reading can't be sold right now, or None."""
        s = self.state
        if s is None:
            return self.error or "no reading yet"
        if time.time() - self.read_at > config.FRESH_MS / 1000:
            return f"the station has not answered for {time.time() - self.read_at:.0f} s ({self.error})"
        if not s.ok_aht:
            return "temperature/humidity sensor (AHT20) not reading"
        if not s.ok_bmp:
            return "second temperature sensor (BMP280) not reading"
        if s.sample_age_ms > config.FRESH_MS:
            return f"the last good sample is {s.sample_age_ms} ms old"
        return None

    def _body(self, s: McuState, t_ms: int) -> dict:
        self.seq += 1
        return {"v": 1, "station": config.STATION_ID, "seq": self.seq, "t_ms": t_ms}

    def reading(self) -> dict:
        with self._lock:
            s, t_ms = self.state, int(self.read_at * 1000)
            return self.signer.sign({
                **self._body(s, t_ms),
                "t_aht_cc": s.t_aht_cc, "rh_cpct": s.rh_cpct, "t_bmp_cc": s.t_bmp_cc,
                "p_pa": s.p_pa if s.ok_press else None,
                "light_raw": s.light_raw, "light_pct_x100": light_pct_x100(s.light_raw),
                "motion_count": s.motion_count, "motion_last_ms_ago": self._motion_ago(s),
                "temp_agree": abs(s.t_aht_cc - s.t_bmp_cc) <= config.TEMP_AGREE_CC,
            })

    def motion(self) -> dict:
        with self._lock:
            s, t_ms = self.state, int(self.read_at * 1000)
            return self.signer.sign({**self._body(s, t_ms), "motion_count": s.motion_count,
                                     "motion_last_ms_ago": self._motion_ago(s)})

    @staticmethod
    def _motion_ago(s: McuState) -> int | None:
        return s.uptime_ms - s.motion_last_ms if s.motion_count else None

    def history_since(self, minutes: int) -> list[dict]:
        cutoff = int(time.time() * 1000) - minutes * 60_000
        with self._lock:
            return [h for h in self.history if h["t_ms"] >= cutoff]

    def tick(self) -> None:
        try:
            s = self.mcu.state()
        except BridgeError as e:
            self.error = str(e)
            return
        with self._lock:
            self.state, self.read_at, self.error = s, time.time(), None
        if time.time() >= self._next_history and self.fresh_problem() is None:
            self._next_history = time.time() + config.HISTORY_EVERY_S
            sample = self.reading()
            with self._lock:
                self.history.append(sample)

    def run(self, stop: threading.Event) -> None:
        while not stop.is_set():
            started = time.time()
            self.tick()
            stop.wait(max(0.0, config.POLL_S - (time.time() - started)))


# Sampler: read AHT20 (temp+humidity), BMP280 (pressure), PIR count, LDR light.
# LDR scaled: 0=covered (ADC 758 under cup), 100=torch (ADC 30).
# Pressure: faulty element on this BMP280 — judged on its own baseline.
# Each reading includes a monotonic sequence number and ISO timestamp.
LIGHT_DARK_ADC = 758
LIGHT_BRIGHT_ADC = 30
def light_pct(adc: int) -> int:
    clamped = max(LIGHT_BRIGHT_ADC, min(LIGHT_DARK_ADC, adc))
    return int(100 * (LIGHT_DARK_ADC - clamped) / (LIGHT_DARK_ADC - LIGHT_BRIGHT_ADC))
