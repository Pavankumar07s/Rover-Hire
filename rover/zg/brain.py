"""One 0G decision: a camera frame and sensor numbers in, a validated JSON decision out (HANDOFF §6.2)."""

import base64
import json
import re
import secrets
import time

import requests

from .prompt import MISSION, NUMBER_PROMPT, SCAN_PROMPT, SCAN_VIEWS, SKILLS, SWEEP_PROMPT, SWEEP_SPAN_DEG, SWEEP_VIEWS, SYSTEM_PROMPT

ROUTER_URL = "https://router-api.0g.ai/v1/chat/completions"
MODEL = "0gm-1.0-35b-a3b"
PROVIDER = "0xf4FB8d2bD856e672b5f9848b0eD235A20079B250"  # 0G's provider for 0GM-1.0-35B-A3B, the only TeeML vision model
DECIDE_TIMEOUT_S = 8.0  # P3, 75 calls from the board: median 2.7 s, p99 5.9 s, max 7.1 s (a cold first call)
SCAN_TIMEOUT_S = 15.0  # a scan sheet took 5.4-6.4 s (P6); the rover stands still while it waits
MODELS_URL = "https://router-api.0g.ai/v1/models"
FRAME_MAX_AGE_S = 6.0


class BrainError(RuntimeError):
    """No usable decision. `info` keeps whatever came back, for the record."""

    def __init__(self, reason: str, info: dict | None = None):
        super().__init__(reason)
        self.info = info or {}


def now_ms() -> int:
    return int(time.time() * 1000)


def new_nonce() -> str:
    return secrets.token_hex(4)


def sensors_json(nonce, sonar_mm, wheel_cm, yaw_deg, battery_mv, photos_taken, last_actions, mission=MISSION, allowed=SKILLS,
                 **extra) -> str:
    sensors = {
        "mission": mission,
        # No echo is unknown, not far: soft or slanted objects return nothing (P3), so never invent a distance.
        "sonar_cm": round(sonar_mm / 10) if sonar_mm >= 0 else None,
        "wheel_cm": wheel_cm,
        "yaw_deg": yaw_deg,
        "battery_v": round(battery_mv / 1000, 1),
        "photos_taken": photos_taken,
        "last_actions": list(last_actions),
        "allowed_skills": list(allowed),
        **extra,
        "nonce": nonce,
    }
    return json.dumps(sensors, separators=(",", ":"))


def parcel_number(mission: str) -> str | None:
    m = re.search(r"#\s*(\w+)", mission)
    return m.group(1) if m else None


def scan_json(nonce, photos_taken, view_sonar_mm, explore_views, mission=MISSION) -> str:
    sonar = [round(mm / 10) if mm >= 0 else None for mm in view_sonar_mm]
    return json.dumps({"mission": mission, "photos_taken": photos_taken, "view_sonar_cm": sonar,
                       "explore_views": list(explore_views), "nonce": nonce}, separators=(",", ":"))


def _whole(v, lo=None, hi=None):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or (isinstance(v, float) and not v.is_integer()):
        raise ValueError(f"{v!r} is not a whole number")
    v = int(v)
    if (lo is not None and v < lo) or (hi is not None and v > hi):
        raise ValueError(f"{v} outside {lo}..{hi}")
    return v


def _reply(content: str, nonce: str) -> dict:
    try:
        d = json.loads(content)
    except ValueError:
        raise BrainError("reply is not JSON")
    if not isinstance(d, dict):
        raise BrainError("reply is not a JSON object")
    if d.get("nonce") != nonce:
        raise BrainError("nonce not echoed")
    if not isinstance(d.get("see"), str) or not isinstance(d.get("reason"), str):
        raise BrainError("see and reason must be strings")
    return d


def validate_number(content: str, nonce: str) -> str | None:
    """The number a crop shows, or None when 0G read none."""
    try:
        d = json.loads(content)
    except ValueError:
        raise BrainError("reply is not JSON")
    if not isinstance(d, dict):
        raise BrainError("reply is not a JSON object")
    if d.get("nonce") != nonce:
        raise BrainError("nonce not echoed")
    n = d.get("number")
    if n is None or (isinstance(n, str) and n.strip().lower() in ("", "null", "none")):
        return None
    if isinstance(n, bool) or not isinstance(n, (str, int)):
        raise BrainError("number must be text or null")
    return str(n).strip()


def validate_scan(content: str, nonce: str, number: str | None = None, explore_views=None, views: int = SCAN_VIEWS) -> dict:
    """A scan reply: face the view that shows the parcel, else explore toward an open one. A parcel view must come
    with the number 0G reads on it, matching the mission's; explore must be one of explore_views."""
    d = _reply(content, nonce)
    picks = {}
    for key in ("view", "explore"):
        if d.get(key) is not None:
            try:
                picks[key] = _whole(d[key], 1, views)
            except ValueError as e:
                raise BrainError(f"{key}: {e}")
    if not picks:
        raise BrainError(f"sweep: parcel not within {SWEEP_SPAN_DEG} deg either side; full scan next" if views == SWEEP_VIEWS
                         else "scan reply names no photo")
    if "view" in picks:
        read = str(d.get("number") or "").strip().lstrip("#").strip()
        if number is not None and read != number:
            raise BrainError(f"view {picks['view']}: read {read or 'no number'!r}, not #{number}")
        return {"see": d["see"], "skill": "face_view", "view": picks["view"], "number": read, "reason": d["reason"]}
    if explore_views is not None and picks["explore"] not in explore_views:
        raise BrainError(f"explore {picks['explore']} not in explore_views {list(explore_views)}")
    return {"see": d["see"], "skill": "explore", "view": picks["explore"], "reason": d["reason"]}


# A photo counts only with the parcel near the centre and big enough (v5): a live run paid for a sliver at the frame edge.
PHOTO_CENTRE = (250, 750)  # the box centre within the middle half of the frame (0-1000)
PHOTO_MIN_WIDTH = 200  # at least a fifth of the frame wide
PHOTO_EDGE = 10  # a box this close to both side edges is wider than the frame
# A parcel stands on the floor, so its box reaches the lower part of the frame: real approach and photo targets ended at
# 600-1000 (33 episodes); every one ending above 550 was a wall marker or nothing (two live runs).
FLOOR_Y2 = 550


def photo_framing(target: list[int], back_off: bool = True) -> str | None:
    """Why this box is not a photo yet, or None; short enough for last_actions. back_off: whether one is allowed now."""
    x1, y1, x2, y2 = target
    centre, width = (x1 + x2) // 2, x2 - x1
    # The edge first: a parcel cut off by the frame edge is narrow because of the edge, and needs a turn, not an approach.
    if not PHOTO_CENTRE[0] <= centre <= PHOTO_CENTRE[1]:
        return f"photo: parcel at the {'left' if centre < 500 else 'right'} edge; turn to it first"
    if width < PHOTO_MIN_WIDTH:
        return "photo: parcel too small in frame; approach first"
    # Touching both sides, the photo shows part of one face (a live run, photo 2: the "3" alone; 9 of 67 photos so far).
    # Touching three edges, it is cut off too (a live run, photo 2: half the "#3"; another run, photos 2-3: no number), but
    # only worth refusing when it can back off: just after one, with a wall behind, the side was lost (a live run, seq 8-9).
    edges = (x1 <= PHOTO_EDGE, y1 <= PHOTO_EDGE, x2 >= 1000 - PHOTO_EDGE, y2 >= 1000 - PHOTO_EDGE)
    if (edges[0] and edges[2]) or (back_off and sum(edges) >= 3):
        return "photo: parcel fills the frame; back_off first"
    return None


def same_number(read, wanted: str) -> bool:
    """The number 0G read on the parcel against the mission's: 3, "3" and "#3" are the same."""
    return read is not None and str(read).strip().lstrip("#").strip().lower() == str(wanted).strip().lower()


def validate(content: str, nonce: str, allowed=SKILLS, orbit: str | None = None, framing: bool = True,
             number: str | None = None) -> dict:
    """number: the mission's parcel number; a photo must name it as read in the frame (v6)."""
    d = _reply(content, nonce)
    skill = d.get("skill")
    if skill not in allowed:
        raise BrainError(f"skill {skill!r} not allowed")
    target, stop_cm = d.get("target"), d.get("stop_cm")
    try:
        if target is not None:
            if not isinstance(target, list) or len(target) != 4:
                raise ValueError("target must be 4 numbers")
            target = [_whole(v, 0, 1000) for v in target]
        if stop_cm is not None:
            if isinstance(stop_cm, bool) or not isinstance(stop_cm, (int, float)):
                raise ValueError("stop_cm must be a number")
            stop_cm = round(stop_cm)
    except ValueError as e:
        raise BrainError(str(e))
    if skill in ("approach", "turn") and target is None:
        raise BrainError(f"{skill} without a target")
    if skill == "photo" and framing:
        if target is None:
            raise BrainError("photo without a target")
        why = photo_framing(target, back_off="back_off" in allowed)
        if why:
            raise BrainError(why)
    if skill in ("approach", "photo") and framing and target[3] < FLOOR_Y2:
        raise BrainError(f"{skill}: that is above the floor, not a parcel")
    # A photo of a box whose number 0G cannot read may be another box (a live run, photo 3: a plain box under a bed).
    if skill == "photo" and number is not None and not same_number(d.get("number"), number):
        raise BrainError(f"photo: #{number} not readable in this photo")
    decision = {"see": d["see"], "skill": skill, "target": target, "stop_cm": stop_cm, "reason": d["reason"]}
    if skill == "photo" and number is not None:
        decision["number"] = str(d["number"])
    if skill == "orbit_leg":
        if d.get("orbit") not in ("left", "right", None):
            raise BrainError(f"orbit must be left or right, not {d.get('orbit')!r}")
        if orbit and d.get("orbit") not in (orbit, None):
            raise BrainError(f"orbit must go {orbit}")
        decision["orbit"] = d.get("orbit")
    return decision


class Brain:
    def __init__(self, api_key: str, timeout_s: float = DECIDE_TIMEOUT_S):
        if not api_key:
            raise BrainError("ZG_API_KEY is not set")
        self.timeout_s = timeout_s
        self.session = requests.Session()  # keep-alive
        self.session.headers.update({"Authorization": f"Bearer {api_key}", "Content-Type": "application/json",
                                     "X-0G-Provider-Trust-Mode": "private"})

    def warm(self) -> None:
        """Open the keep-alive connection before the first decision; cold calls were the only slow ones."""
        try:
            self.session.get(MODELS_URL, timeout=self.timeout_s)
        except requests.RequestException:
            pass

    def decide(self, jpeg: bytes, frame_age_s: float, sensors: str, nonce: str, expect_nonce: str | None = None,
               model: str = MODEL, allowed=SKILLS, orbit: str | None = None, scan: dict | None = None,
               number: str | None = None) -> dict:
        """scan: {"number", "explore_views"} when the jpeg is a scan's sheet of views; number: the parcel's, for photos."""
        if frame_age_s > FRAME_MAX_AGE_S:
            raise BrainError(f"frame is {frame_age_s:.1f} s old")
        prompt = SYSTEM_PROMPT if scan is None else SWEEP_PROMPT if scan.get("views") == SWEEP_VIEWS else SCAN_PROMPT
        info = self._ask(prompt,
                         ("Scan. " if scan is not None else "Checkpoint. ") + "Sensors: " + sensors, jpeg, model,
                         max(self.timeout_s, SCAN_TIMEOUT_S) if scan is not None else self.timeout_s)
        try:
            info["decision"] = (validate_scan(info["raw_response"], expect_nonce or nonce, **scan) if scan is not None
                                else validate(info["raw_response"], expect_nonce or nonce, allowed, orbit, number=number))
        except BrainError as e:
            raise BrainError(str(e), info)
        return info

    def read_number(self, jpeg: bytes, nonce: str, model: str = MODEL) -> dict:
        """The number on the object in a crop (the photo check), asked without saying which number is wanted."""
        info = self._ask(NUMBER_PROMPT, f"Crop. nonce: {nonce}", jpeg, model, self.timeout_s)
        try:
            info["number"] = validate_number(info["raw_response"], nonce)
        except BrainError as e:
            raise BrainError(str(e), info)
        return info

    def _ask(self, system: str, text: str, jpeg: bytes, model: str, timeout_s: float) -> dict:
        """One private-mode call with one image: the reply, its ids and timings. Raises BrainError carrying them."""
        body = {
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": [
                    {"type": "text", "text": text},
                    {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(jpeg).decode()}},
                ]},
            ],
            "temperature": 0,
            "max_tokens": 200,
            "response_format": {"type": "json_object"},
            "chat_template_kwargs": {"enable_thinking": False},
            "verify_tee": True,
        }
        info = {"t_sent_ms": now_ms()}
        try:
            r = self.session.post(ROUTER_URL, data=json.dumps(body, separators=(",", ":")), timeout=timeout_s)
        except requests.RequestException as e:
            info["t_reply_ms"] = now_ms()
            raise BrainError(f"request failed: {type(e).__name__}", info)
        info["t_reply_ms"] = now_ms()
        if r.status_code != 200:
            raise BrainError(f"HTTP {r.status_code}: {r.text[:160]}", info)
        try:
            j = r.json()
            content = j["choices"][0]["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError):
            raise BrainError("malformed router reply", info)
        trace = j.get("x_0g_trace") or {}
        billing = (trace.get("billing") or {}).get("total_cost_usd_micro")
        info.update({
            "provider": trace.get("provider"),
            "request_id": trace.get("request_id"),
            "chat_id": r.headers.get("ZG-Res-Key") or j.get("id"),
            "billing_usd_micro": int(billing) if billing is not None else None,
            "raw_response": content,
        })
        if str(info["provider"]).lower() != PROVIDER.lower():
            raise BrainError(f"unexpected provider {info['provider']}", info)
        return info
# 2026-11-06T05:44:00
# 2026-11-06T16:30:00
# 2026-11-06T22:18:17
