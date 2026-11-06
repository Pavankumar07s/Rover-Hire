// Plain words for a checkpoint: what kind of step it was, a one-line headline, and what the rover did.
import type { DecisionRecord } from "@0xBs/zg/browser";

type Step = { cmd?: string; args?: unknown[]; stop_reason?: string | null; stopped_by?: string | null; dist_mm?: number; yaw_change_cdeg?: number };
type Result = Step & { n?: number; steps?: Step[]; direction?: string; direction_by?: string; blocked?: boolean; leg_cm?: number; path_mm?: number; need_mm?: number;
  sweep?: boolean; views?: unknown[] };
type Executed = { skill?: string; args?: unknown[]; stop_reason?: string | null; refunded?: boolean; moved?: boolean; error?: string; result?: Result | null };

export type Kind = "move" | "photo" | "pause";

const SKILLS: Record<string, string> = {
  approach: "Approach the parcel", orbit_leg: "Orbit the parcel", turn: "Turn", photo: "Take a photo", back_off: "Back away from the parcel",
  scan: "Look all the way round",
  face_view: "Face a view from the scan", explore: "Explore", stop: "Stop",
};

const cm = (mm: number) => `${Math.round(mm / 10)} cm`;
const deg = (cdeg: number) => `${Math.abs(Math.round(cdeg / 100))}°`;

export const skillLabel = (skill: string | undefined): string => (skill ? SKILLS[skill] ?? skill : "No decision");

export function kindOf(r: DecisionRecord): Kind {
  if (r.photo) return "photo";
  if (r.safe_stop || !r.executed) return "pause";
  return "move";
}

/** Why the rover stayed still, for a reader who does not know the rover's codes. */
export function pauseText(stop: { reason: string; detail?: string }): string {
  const d = stop.detail ?? "";
  if (stop.reason === "402") return "Waiting for payment: the next move was not paid yet, so the rover stayed still.";
  if (stop.reason === "!TEE") return "The decision's TEE signature did not check out, so the rover would not act on it.";
  if (stop.reason === "BAT") return "The motor battery was too low to drive, so the rover ended the mission instead of asking 0G again.";
  const notAllowed = /^skill '(\w+)' not allowed/.exec(d);
  if (notAllowed) return `0G chose “${skillLabel(notAllowed[1]).toLowerCase()}”, which the mission rules don't allow at this point, so the rover asked again.`;
  if (d.startsWith("turn without a target")) return "0G asked to turn without saying towards what, so the rover asked again.";
  if (d.startsWith("turn: parcel already centred")) return "0G asked for a turn of under 3°, but the parcel was already centred, so the rover asked again.";
  if (d.startsWith("orbit must go")) return "0G picked the other way round the parcel; the rover asked again.";
  if (d.includes("above the floor")) return "0G's box was above the floor, so it was not the parcel; the rover asked again.";
  const crop = /^photo: crop shows (.+), not #(\w+)/.exec(d);
  if (crop) return `The rover refused the photo: a close-up of the box 0G picked shows ${crop[1]}, not #${crop[2]}, so it is not the parcel.`;
  if (d.startsWith("photo: crop check failed")) return "The rover refused the photo: the number check on a close-up of the box did not complete.";
  if (d.startsWith("photo: parcel fills the frame")) return "The rover refused the photo: the parcel filled the frame and was cut off, so it should back away first.";
  if (/^photo: #\w+ not readable/.test(d)) return `The rover refused the photo: 0G could not read the parcel's number in it.`;
  if (d.startsWith("photo:")) return `The rover refused the photo: ${d.slice(6).trim()}.`;
  if (d.startsWith("request failed")) return "0G did not answer in time, so the rover asked again.";
  return `The rover did not accept 0G's answer${d ? `: ${d}` : ""}.`;
}

/** What the rover did with the decision, from the record's `executed` block. */
export function didText(executed: unknown): string | null {
  const e = executed as Executed | null;
  if (!e) return null;
  if (e.moved === false) {
    const why = /refused: (\w+)/.exec(e.error ?? "")?.[1];
    const reason = why === "low_battery" ? " because the motor battery was too low" : why ? ` (${why.replace("_", " ")})` : "";
    return `The motor controller refused “${skillLabel(e.skill).toLowerCase()}”${reason}, so nothing moved and the move was refunded.`;
  }
  const r: Result = e.result ?? {};
  const steps: Step[] = Array.isArray(r.steps) ? r.steps : r.cmd ? [r] : [];
  const drove = steps.filter((s) => s.cmd?.startsWith("drive")).reduce((a, s) => a + (s.dist_mm ?? 0), 0);
  const turned = steps.filter((s) => s.cmd === "turn_deg").reduce((a, s) => a + (s.yaw_change_cdeg ?? 0), 0);
  const braked = steps.find((s) => s.stopped_by)?.stopped_by;
  let text: string;
  switch (e.skill) {
    case "photo": text = r.n ? `Took photo ${r.n}.` : "Took a photo."; break;
    case "approach": text = `Drove ${cm(drove)} towards the parcel.`; break;
    case "back_off": text = `Backed away ${cm(Math.abs(drove))} so the whole parcel is in view.`; break;
    case "orbit_leg":
      text = r.blocked ? `Started round the parcel to the ${r.direction}, but only ${cm(r.path_mm ?? 0)} was clear (${cm(r.need_mm ?? 0)} needed), so it turned back.`
        : `Went ${r.leg_cm} cm round the parcel to the ${r.direction}${r.path_mm && r.path_mm > 0 ? `, after checking ${cm(r.path_mm)} was clear ahead` : ""}.`;
      break;
    case "scan": text = r.sweep ? `Lost the parcel while going round, so looked 90° to each side, taking ${r.views?.length ?? steps.length} views.`
      : `Turned all the way round, taking ${steps.length + 1} views.`; break;
    case "face_view": text = `Turned ${deg(turned)} to face view ${e.args?.[0]} of the scan.`; break;
    case "explore": text = `Turned ${deg(turned)} and drove ${cm(drove)} to explore.`; break;
    case "turn": text = `Turned ${deg(turned)} ${turned >= 0 ? "left" : "right"}.`; break;
    default: text = `${skillLabel(e.skill)}${e.stop_reason ? ` (${e.stop_reason})` : ""}.`;
  }
  if (braked) text += ` The safety reflex braked (${braked}).`;
  return text;
}

/** The one line a step is summed up by. */
export function headline(r: DecisionRecord): string {
  if (r.safe_stop?.reason === "BAT") return "Ended: motor battery low";
  if (r.safe_stop) return r.safe_stop.reason === "402" ? "Paused: waiting for payment" : r.safe_stop.reason === "!TEE" ? "Paused: proof missing" : "Paused: asked 0G again";
  const photo = r.photo as { n: number } | null;
  if (photo) return `Took photo ${photo.n}`;
  const d = r.decision as (DecisionRecord["decision"] & { orbit?: string }) | null;
  if (d?.skill === "orbit_leg") return `Orbit ${(r.executed as Executed | null)?.result?.direction ?? d.orbit ?? ""}`.trim();
  return skillLabel(d?.skill);
}
