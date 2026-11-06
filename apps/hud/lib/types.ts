// The one snapshot the HUD server streams to the page, a few times a second. Lists are newest first; `seen` is when
// the server first saw a row (0 for rows already there when it picked the mission up), so new rows can be marked.

export interface Mcu {
  mode_name: string;
  stop_name: string | null;
  yaw_cdeg: number;
  sonar_mm: number;
  batt_mv: number;
  face: number;
}

export interface Leases {
  brain: boolean;
  proof: boolean;
  money_ok: boolean;
  paid: number;
  used: number;
}

export interface Checkpoint {
  seq: number;
  request_id: string | null;
  skill: string | null;
  see: string | null;
  reason: string | null;
  safe_stop: string | null;
  stop_detail: string | null;
  verified: boolean;
  latency_ms: number | null;
  photo: number | null;
  seen: number;
}

export interface Payment {
  kind: "move" | "photo";
  n: number;
  tx: string;
  link: string;
  seen: number;
}

export interface Segment {
  index: number;
  first_seq: number;
  last_seq: number;
  root: string | null; // null while zg-log is still uploading it
  anchor: string | null; // Galileo tx
  seen: number;
}

export interface Photo {
  n: number;
  root: string | null; // on 0G Storage once uploaded
  seen: number;
}

/** One of the mission's messages on a Hedera topic, in plain words. */
export interface TopicMessage {
  role: "shop" | "buyer" | "audit";
  topic: string;
  seq: number;
  ts: string; // consensus timestamp
  text: string;
  link: string;
  seen: number;
}

export interface Snapshot {
  at: number;
  rover: "online" | "offline";
  mcu: Mcu | null;
  leases: Leases | null;
  live: boolean; // a mission is running on the rover now
  mission: { quote_id: string; mission: string; photos_wanted: number; started_ms: number | null } | null;
  photos: Photo[];
  prices: { move: string; photo: string } | null; // USDC
  movesPaid: number;
  photosPaid: number;
  payments: Payment[];
  records: Checkpoint[];
  checkpoints: number;
  segments: Segment[];
  ended: string | null; // Galileo tx that closed the episode
  topics: { name: string; topic: string; seq: number | null }[];
  messages: TopicMessage[];
}
// 2026-11-06T19:30:00
