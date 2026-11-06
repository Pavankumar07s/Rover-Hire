"""Phase 13 go/no-go gate, rover side: receives the money-style heartbeat through the tunnel and records every arrival.
Standard library only; listens on 127.0.0.1 so only the tunnel reaches it. On the rover, from ~/0xbs-rover-p13:
    GATE_TOKEN=... python3 hb_receiver.py [port]
The verdict comes from evaluate.py, which also counts heartbeats that never arrived at the start or the end.
"""
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PERIOD_MS, LATE_MS, GAP_MAX_MS = 250, 500, 700  # the shop's heartbeat; the rover's money lease lapses after 1 s
TOKEN = os.environ["GATE_TOKEN"]
LOG = Path(__file__).resolve().parent / "arrivals.jsonl"
arrivals, lock = [], threading.Lock()


def stats():
    with lock:
        a = list(arrivals)
    gaps = [round((b["t"] - x["t"]) * 1000) for x, b in zip(a, a[1:])]
    out = {"received": len(a), "seconds": round(a[-1]["t"] - a[0]["t"], 1) if len(a) > 1 else 0,
           "missing_seq": (a[-1]["seq"] - a[0]["seq"] + 1 - len(a)) if a else 0}
    if gaps:
        s = sorted(gaps)
        out.update(gap_median_ms=s[len(s) // 2], gap_p99_ms=s[int(len(s) * 0.99)], gap_max_ms=s[-1],
                   late=sum(g > LATE_MS for g in gaps), over_700=sum(g > GAP_MAX_MS for g in gaps),
                   late_pct=round(100 * sum(g > LATE_MS for g in gaps) / len(gaps), 2))
    return out


class Handler(BaseHTTPRequestHandler):
    def _reply(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _authorised(self):
        return self.headers.get("X-Gate-Token") == TOKEN

    def do_POST(self):
        if self.path != "/hb" or not self._authorised():
            return self._reply(403, {"ok": False})
        t = time.monotonic()
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        row = {"t": t, "seq": int(body.get("seq", -1)), "sent_ms": body.get("sent_ms")}
        with lock:
            arrivals.append(row)
        with open(LOG, "a") as f:
            f.write(json.dumps(row) + "\n")
        self._reply(200, {"ok": True})

    def do_GET(self):
        if self.path == "/stats" and self._authorised():
            return self._reply(200, stats())
        if self.path == "/reset" and self._authorised():
            with lock:
                arrivals.clear()
            return self._reply(200, {"ok": True})
        self._reply(403, {"ok": False})

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8790
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
