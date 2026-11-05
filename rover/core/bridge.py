"""Owns the single Bridge connection: serialized calls, heartbeats, cached state."""

import concurrent.futures
import logging
import queue
import threading
import time

from .mcu import McuError, connect

HEARTBEAT_S = 0.1
STATE_S = 0.05
KICK_TIMEOUT_S = 0.3

log = logging.getLogger("rover.bridge")


class McuWorker:
    """Heartbeats only while the owner keeps calling kick(), so a hung service also stops the motors."""

    def __init__(self, connect_fn=connect, require_kick=True, on_connect=None):
        self._connect = connect_fn
        self._on_connect = on_connect
        self._require_kick = require_kick
        self._jobs = queue.Queue()
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self._state = None
        self._state_at = 0.0
        self._kicked_at = 0.0
        self.connected = False
        self._thread = threading.Thread(target=self._run, name="mcu", daemon=True)

    def start(self):
        self._thread.start()
        return self

    def stop(self):
        self._stop.set()
        self._thread.join(timeout=2)

    def kick(self):
        self._kicked_at = time.monotonic()

    def submit(self, method, *args):
        future = concurrent.futures.Future()
        self._jobs.put((future, method, args))
        return future

    def call(self, method, *args, timeout=6.0):
        return self.submit(method, *args).result(timeout)

    def latest_state(self):
        with self._lock:
            return self._state, self._state_at

    def _alive(self, now):
        return not self._require_kick or now - self._kicked_at < KICK_TIMEOUT_S

    def _run(self):
        mcu, seq, next_hb, next_state, last_ms = None, 0, 0.0, 0.0, -1
        while not self._stop.is_set():
            if mcu is None:
                try:
                    mcu = self._connect()
                    if self._on_connect:
                        self._on_connect(mcu)
                    self.connected = True
                    log.info("bridge connected")
                except Exception as e:
                    # A failed calibration push leaves a half-open link: start again, or `connected` stays False on a
                    # working MCU (after one flash, set_cal timed out once, the link ran on and /status said not connected).
                    self.connected = False
                    mcu = None
                    log.warning("bridge connect failed: %s", e)
                    time.sleep(1.0)
                    continue
            try:
                now = time.monotonic()
                if now >= next_hb and self._alive(now):
                    mcu.heartbeat(seq)
                    seq += 1
                    next_hb = now + HEARTBEAT_S
                if now >= next_state:
                    st = mcu.state()
                    if st["ms"] < last_ms and self._on_connect:
                        log.warning("MCU restarted; pushing calibration again")
                        self._on_connect(mcu)
                    last_ms = st["ms"]
                    with self._lock:
                        self._state, self._state_at = st, now
                    next_state = now + STATE_S
                try:
                    future, method, args = self._jobs.get(timeout=0.005)
                except queue.Empty:
                    continue
                if future.set_running_or_notify_cancel():
                    try:
                        future.set_result(getattr(mcu, method)(*args))
                    except McuError as e:
                        future.set_exception(e)
                    except Exception as e:
                        future.set_exception(e)
                        raise
            except Exception as e:
                log.error("bridge failure, reconnecting: %s", e)
                self.connected = False
                mcu = None
                time.sleep(0.5)
# 2026-11-06T02:05:00
# 2026-11-06T22:11:11
