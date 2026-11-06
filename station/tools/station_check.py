"""Guided hands-on acceptance tests for Station-A (plan §12.7), run on the laptop over the LAN.
  python3 station/tools/station_check.py physics   breath on the AHT20, hand over the LDR, wave at the PIR
  python3 station/tools/station_check.py fault     pull the SDA wire, then put it back
  python3 station/tools/station_check.py watch [s] live humidity, light and motion twice a second (default 90 s)
Reads STATION_URL and STATION_LAN_TOKEN from services/hedera-shop/.env.s and never prints the token.
Writes every poll to docs/rover/evidence/P12/<test>_<time>.jsonl."""
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ENV = dict(l.split("=", 1) for l in (ROOT / "services/hedera-shop/.env.s").read_text().split() if "=" in l)
URL, TOKEN = ENV["STATION_URL"].rstrip("/"), ENV["STATION_LAN_TOKEN"]
LOG = None


def get(path):
    req = urllib.request.Request(URL + path, headers={"X-Station-Token": TOKEN})
    try:
        with urllib.request.urlopen(req, timeout=2) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:200]
    except Exception as e:
        return 0, str(e)[:200]


def poll(path="/reading"):
    st, body = get(path)
    LOG.write(json.dumps({"at_ms": int(time.time() * 1000), "path": path, "status": st, "body": body}) + "\n")
    LOG.flush()
    return st, body


def wait_for(test, limit_s, every=0.25):
    t0 = time.time()
    while time.time() - t0 < limit_s:
        st, r = poll()
        if st == 200 and test(r):
            return time.time() - t0, r
        time.sleep(every)
    return None, None


def baseline(key, n=8):
    vals = []
    while len(vals) < n:
        st, r = poll()
        if st == 200:
            vals.append(r[key])
        time.sleep(0.5)
    return sum(vals) // len(vals)


def prompt(msg):
    input(f"\n>>> {msg}  [press Enter, then do it]")


def physics():
    out = {}
    print("Hands off the sensors for a few seconds while the baseline is read...")
    rh0, light0, motion0 = baseline("rh_cpct"), baseline("light_raw"), poll()[1]["motion_count"]
    print(f"baseline: RH {rh0 / 100:.2f} %, light_raw {light0}, motion_count {motion0}")

    prompt("BREATHE slowly on the AHT20+BMP280 board (from about 2 cm) for 3 seconds")
    dt, r = wait_for(lambda r: r["rh_cpct"] >= rh0 + 1000, 20)
    out["breath_rh_up_10pts_s"] = None if dt is None else round(dt, 1)
    print("RH +10 points: not within 20 s" if dt is None else "RH +10 points: after %.1f s (RH %.2f %%)" % (dt, r["rh_cpct"] / 100))
    if dt is not None:
        print("Now step away; waiting for RH to come back within 2 points of the baseline (up to 5 min)...")
        dt2, _ = wait_for(lambda r: r["rh_cpct"] <= rh0 + 200, 300, every=1)
        out["breath_rh_back_s"] = None if dt2 is None else round(dt2, 1)
        print("RH back: not within 5 min" if dt2 is None else "RH back: after %.0f s" % dt2)

    prompt("COVER the light sensor (LDR) fully with your hand and keep it covered")
    time.sleep(3)
    dark = baseline("light_raw", 4)
    prompt("UNCOVER it and shine a phone torch on it from about 5 cm")
    time.sleep(3)
    bright = baseline("light_raw", 4)
    out.update({"light_raw_room": light0, "light_raw_covered": dark, "light_raw_torch": bright,
                "light_change_pct_of_adc": round(abs(dark - bright) * 100 / 1023, 1),
                "ao_falls_as_light_rises": bright < light0 < dark})
    print(f"light_raw: room {light0}, covered {dark}, torch {bright} -> change {out['light_change_pct_of_adc']} % of the ADC range; "
          f"AO falls as light rises: {out['ao_falls_as_light_rises']}")

    print("\nKeep still for 10 s so the PIR settles (its hold time is about 3 s)...")
    time.sleep(10)
    m0 = poll()[1]["motion_count"]
    prompt("WAVE your hand once in front of the PIR (about 30 cm away)")
    dt, r = wait_for(lambda r: r["motion_count"] > m0, 10, every=0.1)
    out["pir_count_up_s"] = None if dt is None else round(dt, 2)
    print("motion_count +1: not within 10 s" if dt is None else "motion_count +1: after %.2f s (count %d)" % (dt, r["motion_count"]))
    return out


def fault():
    st, h = poll("/health")
    print(f"before: /health ok={h['ok'] if st == 200 else st}, i2c_err {h['i2c_err'] if st == 200 else '?'}")
    prompt("PULL the SDA wire (blue) off the sensor module")
    t0 = time.time()
    while time.time() - t0 < 15:
        st, body = poll()
        if st == 503:
            break
        time.sleep(0.2)
    t503 = time.time() - t0 if st == 503 else None
    _, h = poll("/health")
    out = {"reading_503_s": None if t503 is None else round(t503, 1), "problem": body if st == 503 else None,
           "health_while_pulled": h}
    print("/reading 503: not within 15 s" if t503 is None else "/reading 503: after %.1f s: %s" % (t503, body))
    print(f"/health: ok={h.get('ok')}, sensors={h.get('sensors')}, i2c_err={h.get('i2c_err')}")
    prompt("PUT the SDA wire back")
    t0 = time.time()
    while time.time() - t0 < 30:
        st, _ = poll()
        if st == 200:
            break
        time.sleep(0.2)
    out["recovered_s"] = round(time.time() - t0, 1) if st == 200 else None
    _, out["health_after"] = poll("/health")
    print("recovered: not within 30 s" if out["recovered_s"] is None else "recovered: after %s s" % out["recovered_s"])
    return out


def watch(seconds):
    t0 = time.time()
    while time.time() - t0 < seconds:
        st, r = poll()
        if st == 200:
            print(f"{time.time() - t0:5.1f}s  RH {r['rh_cpct'] / 100:6.2f} %  T {r['t_aht_cc'] / 100:5.2f} C  "
                  f"light_raw {r['light_raw']:4d} (light {r['light_pct_x100'] // 100:3d} %)  motion_count {r['motion_count']}", flush=True)
        else:
            print(f"{time.time() - t0:5.1f}s  station {st}: {r}", flush=True)
        time.sleep(0.5)
    return {"watched_s": seconds}


if __name__ == "__main__":
    test = sys.argv[1] if len(sys.argv) > 1 else ""
    if test not in ("physics", "fault", "watch"):
        sys.exit(__doc__)
    path = ROOT / "docs/rover/evidence/P12" / f"{test}_{time.strftime('%Y%m%d_%H%M%S')}.jsonl"
    LOG = path.open("w")
    result = physics() if test == "physics" else fault() if test == "fault" else watch(float(sys.argv[2]) if len(sys.argv) > 2 else 90)
    (path.with_suffix(".json")).write_text(json.dumps(result, indent=1) + "\n")
    print(f"\nresult: {json.dumps(result)}\nlog: {path}")
