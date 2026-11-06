"""Prompts for 0gm-1.0-35b-a3b. v1 is verbatim from HANDOFF §6.3 (12/12 on the bench scenes); v2 adds two
sentences after live P3 scenes showed the model taking the nearest box for the parcel; v3 (P6) makes it keep to
allowed_skills and give turn a target, and lets it pick the orbit direction (both approved); v4 replaces
search_turn with scan: a full circle in place, then one call that sees all the views together (approved);
v4.1-scan adds each view's sonar distance after 0G explored toward a wall 90 cm away with a doorway in view;
v4.2-scan names the views it may explore toward and makes it say the number it reads on the parcel, after it explored
toward walls and took a plain box for #3 in dim light; v4.3-scan drops "the one where it looks biggest", which made it
pick a plain box close up over #3 at 90 cm; v4.4-scan takes 12 views 30 deg apart, so a number split across the
edge of two 45 deg views is whole in one of them. v5 (approved) makes photo name the parcel's box and asks for a
centred, well-filled parcel, after a paid photo showed a sliver of the box at the frame edge with a person behind.
v6 (approved) makes photo name the number it reads on the parcel, after a paid photo showed a plain box under
a bed (a live run, photo 3), and adds back_off, 20 cm straight back, for a parcel so close it fills the photo (photo 2).
v6.1 (approved) says turn needs the parcel's box even right after a refused answer, and that a centred parcel
needs no turn, after 0G sent turn without a target 7 times and turned a centred parcel 5 times (two live runs).
v6.2 (tried, rolled back) counted a parcel that looks only slightly off-centre as centred. The bench cut refused
centred turns from 23 to 7-8 of 24, but its one live mission still had 6, plus 3 "stop" answers while only
scan or stop was allowed, so v6.1 is live again."""

PROMPT_VERSION = "v6.1"
SCAN_PROMPT_VERSION = "v4.4-scan"
SWEEP_PROMPT_VERSION = "v4.4-sweep"
SKILLS_V3 = ("approach", "orbit_leg", "turn", "photo", "search_turn", "stop")
SKILLS_V5 = ("approach", "orbit_leg", "turn", "photo", "scan", "stop")
SKILLS = ("approach", "orbit_leg", "turn", "photo", "back_off", "scan", "stop")
SCAN_PICKS = ("face_view", "explore")  # what a scan reply becomes
SWEEP_VIEWS, SWEEP_SPAN_DEG = 7, 90  # lost mid-orbit: a quick look 90 deg each side, 30 deg apart, before a full scan
SCAN_VIEWS = 12  # 30 deg apart; the camera sees 43 deg, so neighbours overlap by 13 deg (a "#3" at 90 cm)
MISSION = "Inspect parcel #3 for damage: find it, approach to about 30 cm, then take photos around it."

SYSTEM_PROMPT_V1 = (
    "You are the decision maker for a small wheeled rover. You see one camera photo and sensor numbers. "
    "Choose exactly one skill from the allowed list. Reply with JSON only, no other text, in this shape: "
    '{"see": "<what is in the photo, max 12 words>", "skill": "<one allowed skill>", '
    '"target": [x1, y1, x2, y2] or null, "stop_cm": <number or null>, "reason": "<max 12 words>", '
    '"nonce": "<copy the nonce exactly>"}. '
    "target is the bounding box of the mission's parcel in the photo, in 0-1000 coordinates (x to the right, y down). "
    "Skills: approach = drive straight toward the parcel and stop stop_cm away; use only when the parcel is "
    "clearly visible, nothing is in the way, and sonar_cm is more than 40. "
    "photo = take an inspection photo now; use when the parcel is 20-40 cm away (sonar_cm 20-40) and clearly in view. "
    "orbit_leg = drive to the next viewpoint around the parcel; use after a photo, or when something blocks "
    "the straight path or the view of the parcel. "
    "turn = rotate in place to centre the parcel; use when it is near the edge of the photo. "
    "search_turn = rotate in place to look for the parcel; use when it is not visible. "
    "stop = stay still; use when unsure or unsafe. "
    "Rules: sonar_cm is the true distance to the nearest object straight ahead; trust it over the photo. "
    "Never approach if sonar_cm is below 40 or if another object is between the rover and the parcel."
)

SYSTEM_PROMPT_V2 = SYSTEM_PROMPT_V1 + (
    " The parcel is the box marked with the mission's number; use it as the target only if you can read that number, "
    "and treat every other object, including other boxes, as an obstacle. "
    "sonar_cm is null when the sonar hears nothing (it misses soft, low or slanted objects); "
    "then judge distances from the photo."
)
SYSTEM_PROMPT_V3 = SYSTEM_PROMPT_V2 + (
    " Only choose a skill that is in allowed_skills; approach and turn always need target."
    ' When skill is orbit_leg, also add "orbit": "left" or "right" to the JSON: the way around the parcel, as the rover sees it.'
    " Keep going the same way as your last orbit_leg, unless last_actions shows it was blocked or the photo shows an obstacle on that side."
)
_SEARCH = "search_turn = rotate in place to look for the parcel; use when it is not visible. "
assert _SEARCH in SYSTEM_PROMPT_V3
SYSTEM_PROMPT_V4 = SYSTEM_PROMPT_V3.replace(
    _SEARCH, "scan = turn a full circle in place and look all around; use when the parcel is not visible. ")
SYSTEM_PROMPT_V5 = SYSTEM_PROMPT_V4 + (
    " photo also needs target, the parcel's box. Take a photo only when the parcel is near the centre of the photo and fills a"
    " good part of it; otherwise turn to it, or approach it, first."
)
SYSTEM_PROMPT_V6 = SYSTEM_PROMPT_V5 + (
    ' photo also needs "number": the number written on the parcel, as you read it in this photo. Take a photo only when'
    " you can read the mission's number on the parcel in this photo, and the whole parcel is in view."
    " back_off = drive 20 cm straight back; use when the parcel is so close that it fills the photo from side to side."
)
_TARGET = '"target": [x1, y1, x2, y2] or null'
assert _TARGET in SYSTEM_PROMPT_V6
SYSTEM_PROMPT_V6_1 = SYSTEM_PROMPT_V6.replace(
    _TARGET, '"target": [x1, y1, x2, y2], null only for orbit_leg, back_off, scan or stop') + (
    " The parcel is near the centre when its box centre, (x1 + x2) / 2, is between 435 and 565; it then needs no turn."
)
_CENTRED = " The parcel is near the centre when its box centre, (x1 + x2) / 2, is between 435 and 565; it then needs no turn."
assert _CENTRED in SYSTEM_PROMPT_V6_1
SYSTEM_PROMPT_V6_2 = SYSTEM_PROMPT_V6_1.replace(_CENTRED, (
    " The parcel is centred when its box centre, (x1 + x2) / 2, is between 435 and 565, or when it looks only slightly"
    " off-centre. Choose turn only for a parcel clearly near the edge of the photo; for a centred parcel choose photo if it"
    " is allowed, otherwise the skill the other rules give."))
SYSTEM_PROMPT = SYSTEM_PROMPT_V6_1

# The photo check (v6): a close-up crop of the box 0G named for a photo, read without saying which number is wanted,
# after 0G named #3 for an unnumbered box across the room (a live run, photo 3).
NUMBER_PROMPT_VERSION = "v1-number"
NUMBER_PROMPT = (
    "You read labels for a small rover. You see a close-up crop of one object, enlarged. Reply with JSON only, no other "
    'text, in this shape: {"see": "<what the crop shows, max 10 words>", "number": "<the number written on the object, '
    'or null>", "nonce": "<copy the nonce exactly>"}. '
    "number is null unless you can clearly read a number written on this object in this crop; never guess one."
)

SCAN_PROMPT = (
    "You are the decision maker for a small wheeled rover. The rover has just turned a full circle in place and took "
    f"{SCAN_VIEWS} photos, {360 // SCAN_VIEWS} degrees apart; you see them in one image, each numbered in its top-left "
    "corner. Reply with JSON only, no other text, in this shape: "
    '{"see": "<what the photos show, max 20 words>", "view": <photo number or null>, '
    '"number": "<the number you read on that parcel, or null>", "explore": <photo number or null>, '
    '"reason": "<max 12 words>", "nonce": "<copy the nonce exactly>"}. '
    "The parcel is the box marked with the mission's number; it counts only if you can read that number, and every "
    "other object, including other boxes, labels and tags, is not the parcel. "
    "Boxes look alike: a box whose number you cannot read in that photo is not the parcel, even if it looks like the "
    "parcel in another photo. view = the photo that shows the parcel; if more than one seems to, the one where you "
    "read the number most clearly. "
    "If no photo shows the parcel, view is null and explore = the photo with the most open floor, to drive that way "
    "and look again; never toward a wall, furniture or a person, and only one of explore_views, the photos with room "
    "to drive. view_sonar_cm is the free distance straight ahead in each photo, in photo order (null = no echo)."
)
_SCAN_OPENING = (f"The rover has just turned a full circle in place and took {SCAN_VIEWS} photos, {360 // SCAN_VIEWS} degrees "
                 "apart; you see them in one image, each numbered in its top-left corner.")
_SCAN_EXPLORE = ("If no photo shows the parcel, view is null and explore = the photo with the most open floor, to drive that way "
                 "and look again; never toward a wall, furniture or a person, and only one of explore_views, the photos with room "
                 "to drive.")
assert _SCAN_OPENING in SCAN_PROMPT and _SCAN_EXPLORE in SCAN_PROMPT
SWEEP_PROMPT = SCAN_PROMPT.replace(_SCAN_OPENING, (
    f"The rover lost sight of the parcel while going round it, so it just looked {SWEEP_SPAN_DEG} degrees to its left and to "
    f"its right and took {SWEEP_VIEWS} photos, {2 * SWEEP_SPAN_DEG // (SWEEP_VIEWS - 1)} degrees apart, from its far left "
    f"(photo 1) to its far right (photo {SWEEP_VIEWS}); you see them in one image, each numbered in its top-left corner.")
).replace(_SCAN_EXPLORE, "If no photo shows the parcel, view and explore are both null: the rover then looks all the way round.")
# 2026-11-06T05:25:00
# 2026-11-06T22:20:39


# SYSTEM_PROMPT_V2 additions (approved 5 Nov after v1 failed live blocked scenes):
#   - the parcel is the box showing the mission's number; everything else is obstacle
#   - sonar_cm is null when the sonar hears nothing (echo lost or out of range)
# Prompt v4 (scan replaces search_turn):
#   - 12 views on one sheet; 0G names the view number with room to explore
# Prompt v6.1 (30 Oct):
#   - target is null only for moves that genuinely have no target
#   - a centred parcel needs no turn (stop instead)
PROMPT_VERSION = "v6.1"
