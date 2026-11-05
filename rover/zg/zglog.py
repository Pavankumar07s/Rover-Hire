"""Ships episodes, decision records and their frames to zg-log strictly in order, from a disk spool that
survives a restart of either side. A conflict reply stops shipping instead of skipping: nothing is lost silently."""

import base64
import json
import threading
import time
from pathlib import Path

import requests

RETRY_S = (1, 2, 5, 10)


class ZgLog:
    def __init__(self, url: str, token: str, spool_dir: Path):
        self.url = url.rstrip("/")
        self.session = requests.Session()
        self.session.headers.update({"X-ZG-Log-Token": token})
        spool_dir.mkdir(parents=True, exist_ok=True)
        self._ops = spool_dir / "spool.jsonl"
        self._done = spool_dir / "spool.done"
        self._lock = threading.Lock()
        self._wake = threading.Event()
        self.halted = None  # reason, after a conflict reply
        self.last_error = None
        self.retries = 0
        self._thread = threading.Thread(target=self._run, name="zglog", daemon=True)

    def start(self):
        self._thread.start()
        return self

    def episode(self, episode_id: str, mission: str, **extra) -> None:
        self._spool({"op": "start", "body": {"episode_id": episode_id, "mission": mission, **extra}})

    def record(self, record: dict, jpeg: bytes) -> None:
        self._spool({"op": "record", "body": {"record": record, "image_b64": base64.b64encode(jpeg).decode()}})

    def photo(self, episode_id: str, n: int, jpeg: bytes) -> None:
        """The full photo after its record: zg-log checks it against the record's sha256 and stores it on 0G."""
        self._spool({"op": "photo", "body": {"episode_id": episode_id, "n": n, "image_b64": base64.b64encode(jpeg).decode()}})

    def end(self, episode_id: str) -> None:
        self._spool({"op": "end", "episode_id": episode_id})

    def pending(self) -> int:
        with self._lock:
            return len(self._read_ops()) - self._read_done()

    def wait_drained(self, timeout_s: float) -> bool:
        end = time.monotonic() + timeout_s
        while time.monotonic() < end:
            if self.pending() == 0 or self.halted:
                return self.pending() == 0
            time.sleep(0.2)
        return False

    def _spool(self, op: dict) -> None:
        with self._lock:
            with open(self._ops, "a") as f:
                f.write(json.dumps(op, ensure_ascii=False) + "\n")
        self._wake.set()

    def _read_ops(self) -> list:
        return self._ops.read_text().splitlines() if self._ops.exists() else []

    def _read_done(self) -> int:
        return int(self._done.read_text() or 0) if self._done.exists() else 0

    def _post(self, op: dict) -> requests.Response:
        if op["op"] == "start":
            return self.session.post(f"{self.url}/episodes", json=op["body"], timeout=10)
        if op["op"] == "record":
            return self.session.post(f"{self.url}/records", json=op["body"], timeout=15)
        if op["op"] == "photo":
            return self.session.post(f"{self.url}/photos", json=op["body"], timeout=15)
        return self.session.post(f"{self.url}/episodes/{op['episode_id']}/end", timeout=10)

    def _run(self) -> None:
        attempt = 0
        while not self.halted:
            with self._lock:
                ops, done = self._read_ops(), self._read_done()
                if done >= len(ops) and ops:
                    self._ops.unlink()
                    self._done.unlink(missing_ok=True)
                    ops, done = [], 0
            if done >= len(ops):
                self._wake.wait(1.0)
                self._wake.clear()
                continue
            try:
                r = self._post(json.loads(ops[done]))
            except requests.RequestException as e:
                r, self.last_error = None, f"{type(e).__name__}"
            if r is not None and r.status_code in (200, 201, 202):
                with self._lock:
                    self._done.write_text(str(done + 1))
                attempt = 0
                continue
            if r is not None and r.status_code in (400, 401, 404, 409):
                self.halted = f"HTTP {r.status_code}: {r.text[:200]}"
                break
            if r is not None:
                self.last_error = f"HTTP {r.status_code}"
            self.retries += 1
            time.sleep(RETRY_S[min(attempt, len(RETRY_S) - 1)])
            attempt += 1
# 2026-11-06T10:32:00
