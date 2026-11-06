"""Phase 13 gate verdict from the rover's arrival log and the sender's count. Heartbeat k leaves the sender k x 250 ms
after the first, so heartbeats that never arrived at the start or the end count as a gap too.
    python3 evaluate.py <arrivals.jsonl> <sent>
"""
import json
import sys

PERIOD_MS, LATE_MS, GAP_MAX_MS = 250, 500, 700

rows = [json.loads(line) for line in open(sys.argv[1])]
sent = int(sys.argv[2])
start = max(i for i, r in enumerate(rows) if r["seq"] == 0)  # the log keeps every run; the last one starts at seq 0
run = rows[start:]
gaps = [round((b["t"] - a["t"]) * 1000) for a, b in zip(run, run[1:])]
leading = run[0]["seq"] * PERIOD_MS
trailing = (sent - 1 - run[-1]["seq"]) * PERIOD_MS
worst = max(gaps + [leading, trailing])
late = sum(g > LATE_MS for g in gaps) + (leading > LATE_MS) + (trailing > LATE_MS)
s = sorted(gaps)
out = {"sent": sent, "received": len(run), "missing": sent - len(run), "gap_median_ms": s[len(s) // 2],
       "gap_p99_ms": s[int(len(s) * 0.99)], "worst_gap_ms": worst, "leading_ms": leading, "trailing_ms": trailing,
       "late_pct": round(100 * late / max(1, sent), 2),
       "big_gaps": [(b["seq"], g) for (a, b), g in zip(zip(run, run[1:]), gaps) if g > LATE_MS][:10]}
out["pass"] = worst <= GAP_MAX_MS and out["late_pct"] <= 1.0
print(json.dumps(out))
