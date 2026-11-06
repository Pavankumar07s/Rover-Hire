"""Station-A soak (plan §12.7): one paid reading a minute through the real buyer CLI, plus the station's health and the
Wi-Fi round trip, for N minutes. Pass: every buy paid and verified, i2c_err never rises, board < 75 °C.
Run on the laptop from the repo root:  python3 station/tools/soak.py [minutes]
Writes docs/rover/evidence/P12/soak_<time>.jsonl and a summary .json next to it; never prints the station token."""
import json
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ENV = dict(l.split("=", 1) for l in (ROOT / "services/hedera-shop/.env.s").read_text().split() if "=" in l)
URL, TOKEN = ENV["STATION_URL"].rstrip("/"), ENV["STATION_LAN_TOKEN"]
HOST = re.sub(r"^https?://([^:/]+).*$", r"\1", URL)
CLI = ROOT / "packages/hedera-buyer/dist/cli.js"
minutes = int(sys.argv[1]) if len(sys.argv) > 1 else 30


def health():
    try:
        req = urllib.request.Request(URL + "/health", headers={"X-Station-Token": TOKEN})
        with urllib.request.urlopen(req, timeout=4) as r:
            return json.loads(r.read())
    except Exception as e:
        return {"error": str(e)[:120]}


def rtt():
    out = subprocess.run(["ping", "-c", "10", "-i", "0.3", "-W", "2", HOST], capture_output=True, text=True).stdout
    m = re.search(r"= ([\d.]+)/([\d.]+)/([\d.]+)/", out)
    lost = re.search(r"(\d+)% packet loss", out)
    return {"min_ms": float(m[1]), "avg_ms": float(m[2]), "max_ms": float(m[3])} if m else None, int(lost[1]) if lost else 100


def buy():
    p = subprocess.run(["node", str(CLI), "sensor", "reading"], capture_output=True, text=True, timeout=120)
    try:
        r = json.loads(p.stdout)
        return {"ok": r["ok"], "tx": r["tx"], "problems": r["problems"], "error": r["error"], "refused": r["refused"],
                "ms": r["ms"], "t_aht_cc": (r.get("value") or {}).get("t_aht_cc"), "rh_cpct": (r.get("value") or {}).get("rh_cpct")}
    except Exception:
        return {"ok": False, "error": (p.stderr or p.stdout)[-200:]}


stamp = time.strftime("%Y%m%d_%H%M%S")
log_path = ROOT / "docs/rover/evidence/P12" / f"soak_{stamp}.jsonl"
rows = []
h0 = health()
with log_path.open("w") as log:
    for i in range(minutes):
        t0 = time.time()
        h = health()
        rt, lost = rtt()
        row = {"minute": i + 1, "at": time.strftime("%H:%M:%S"), "buy": buy(),
               "i2c_err": h.get("i2c_err"), "board_c": (h.get("board_temp_mc") or 0) / 1000, "station_ok": h.get("ok"),
               "problem": h.get("problem"), "rtt": rt, "ping_lost_pct": lost}
        rows.append(row)
        log.write(json.dumps(row) + "\n")
        log.flush()
        b = row["buy"]
        print(f"{row['at']} min {i + 1}: buy {'ok' if b.get('ok') else 'FAIL ' + str(b.get('error') or b.get('problems'))[:60]}, "
              f"i2c_err {row['i2c_err']}, board {row['board_c']} C, rtt avg {rt and rt['avg_ms']} ms, lost {lost} %", flush=True)
        time.sleep(max(0, 60 - (time.time() - t0)))

h1 = health()
paid = [r for r in rows if r["buy"].get("ok")]
avgs = sorted(r["rtt"]["avg_ms"] for r in rows if r["rtt"])
summary = {
    "minutes": minutes, "buys": len(rows), "paid_and_verified": len(paid),
    "i2c_err_start": h0.get("i2c_err"), "i2c_err_end": h1.get("i2c_err"),
    "board_c_max": max(r["board_c"] for r in rows),
    "rtt_avg_ms_median": avgs[len(avgs) // 2] if avgs else None, "rtt_max_ms": max((r["rtt"]["max_ms"] for r in rows if r["rtt"]), default=None),
    "ping_lost_pct_max": max(r["ping_lost_pct"] for r in rows),
    "spent_usdc": round(len(paid) * 0.001, 3),
}
summary["pass"] = (summary["paid_and_verified"] == minutes and summary["i2c_err_end"] == summary["i2c_err_start"]
                   and summary["board_c_max"] < 75)
log_path.with_suffix(".json").write_text(json.dumps(summary, indent=1) + "\n")
print(json.dumps(summary))
