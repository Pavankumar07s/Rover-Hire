// Real P3 records (108, written by Python on the UNO Q) and their frames, shared by the tests.
import { existsSync, readFileSync } from "node:fs";
import type { DecisionRecord } from "../dist/index.js";

const ROOT = new URL("../../../", import.meta.url);
export const records: DecisionRecord[] = readFileSync(new URL("rover/tests/fixtures/p3_records.jsonl", ROOT), "utf8")
  .trim().split("\n").map((l) => JSON.parse(l));

export function episodes(): DecisionRecord[][] {
  const by = new Map<string, DecisionRecord[]>();
  for (const r of records) by.set(r.episode_id, [...(by.get(r.episode_id) ?? []), r]);
  return [...by.values()];
}

export function frame(sha: string): Buffer | null {
  const path = new URL(`prior-work/evidence/P3/frames/${sha}.jpg`, ROOT);
  return existsSync(path) ? readFileSync(path) : null;
}

export const abiJson = JSON.parse(readFileSync(new URL("contracts/episode-log/abi.json", ROOT), "utf8"));
