import assert from "node:assert/strict";
import { test } from "node:test";

process.env.P13_EDGE_KEY = "k".repeat(32);
const { route } = await import("./edge.mjs");
const key = { "x-p13-edge-key": "k".repeat(32) };

test("public shop routes pass, to the right shop", () => {
  assert.deepEqual(route("GET", "/rover-a/.well-known/agent-card.json", {}), [8402, "/.well-known/agent-card.json"]);
  assert.deepEqual(route("POST", "/rover-b/a2a/jsonrpc", {}), [8403, "/a2a/jsonrpc"]);
  assert.deepEqual(route("GET", "/rover-a/missions/a-1234abcd/status", {}), [8402, "/missions/a-1234abcd/status"]);
  assert.deepEqual(route("POST", "/rover-a/missions/a-1234abcd/move", {}), [8402, "/missions/a-1234abcd/move"]);
  assert.deepEqual(route("POST", "/rover-a/missions/a-1234abcd/photo/5", {}), [8402, "/missions/a-1234abcd/photo/5"]);
});

test("start and end need the key, because quote ids are public", () => {
  for (const op of ["start", "end"]) {
    assert.equal(route("POST", `/rover-a/missions/a-1234abcd/${op}`, {}), 403);
    assert.equal(route("POST", `/rover-a/missions/a-1234abcd/${op}`, { "x-p13-edge-key": "k".repeat(31) + "x" }), 403);
    assert.deepEqual(route("POST", `/rover-a/missions/a-1234abcd/${op}`, key), [8402, `/missions/a-1234abcd/${op}`]);
  }
});

test("zg-log is read-only and keeps the query", () => {
  assert.deepEqual(route("GET", "/zg/records?episode_id=a-1234abcd&last=500", {}), [8787, "/records?episode_id=a-1234abcd&last=500"]);
  assert.equal(route("POST", "/zg/records", key), 404);
  assert.equal(route("POST", "/zg/episodes", key), 404);
});

test("everything else is 404", () => {
  for (const [m, p] of [["GET", "/"], ["GET", "/hud"], ["GET", "/rover-a/missions/a-1234abcd/end"], ["GET", "/rover-c/health"],
    ["POST", "/rover-a/missions/a-1234abcd/photo/0"], ["POST", "/rover-a/missions/not-a-quote/move"],
    ["GET", "/rover-a/%2e%2e/%2e%2e/etc/passwd"], ["DELETE", "/rover-a/health"], ["GET", "/rover-a/admin"]]) {
    assert.equal(route(m, p, key), 404, `${m} ${p}`);
  }
});

test("Station-A: its info, health and three paid reads pass; nothing else of it does", () => {
  for (const p of ["/station/info", "/station/reading", "/station/motion", "/health"])
    assert.deepEqual(route("GET", `/station-a${p}`, {}), [8404, p]);
  assert.deepEqual(route("GET", "/station-a/station/history?minutes=5", {}), [8404, "/station/history?minutes=5"]);
  for (const [m, p] of [["POST", "/station/reading"], ["GET", "/station/other"], ["GET", "/missions/a-1234abcd/status"], ["GET", "/"]])
    assert.equal(route(m, `/station-a${p}`, {}), 404);
});
