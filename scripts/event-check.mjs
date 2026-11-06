#!/usr/bin/env node
// Event-morning check (plan P10): is everything the rover needs up, funded and answering? Read-only, costs nothing,
// moves nothing. Reads ids and the rover token from the existing env files and never prints a secret.
// Usage: node scripts/event-check.mjs        Exit code 1 when anything must be fixed before a demo.
import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FACILITATORS, facilitatorHealth, mirror, USDC } from "../packages/hedera/dist/index.js";
import { GALILEO, MAINNET, readTeeService } from "../packages/zg/dist/browser.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODEL = "0gm-1.0-35b-a3b";
const ROUTER = "https://router-api.0g.ai/v1/models";
const LOCAL = { zgLog: "http://127.0.0.1:8787", shopA: "http://127.0.0.1:8402", shopB: "http://127.0.0.1:8403", hud: "http://127.0.0.1:8080" };

function env(rel) {
  const file = path.join(ROOT, rel);
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}
const shopA = env("services/hedera-shop/.env.a");
const shopB = env("services/hedera-shop/.env.b");
const buyer = env("packages/hedera-buyer/.env");

const timed = async (fn) => {
  const t0 = performance.now();
  const value = await fn();
  return { value, ms: Math.round(performance.now() - t0) };
};
const json = async (url, opts = {}) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? 8000), headers: opts.headers });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};
const ok = (text) => ({ level: "ok", text });
const warn = (text) => ({ level: "warn", text });
const fail = (text) => ({ level: "fail", text });
const info = (text) => ({ level: "info", text });

const MARK = { ok: "\x1b[32m✓\x1b[0m", warn: "\x1b[33m!\x1b[0m", fail: "\x1b[31m✗\x1b[0m", info: "·" };
const tally = { warn: 0, fail: 0 };

async function section(title, checks) {
  console.log(`\n${title}`);
  const results = await Promise.all(checks.map((c) => c().catch((e) => fail(`${c.what ?? "check"} failed: ${e.message}`))));
  for (const r of results.flat()) {
    if (r.level in tally) tally[r.level]++;
    console.log(`  ${MARK[r.level]} ${r.text}`);
  }
}
const named = (what, fn) => Object.assign(fn, { what });

// ---------- 0G: the brain and the record ----------

const zg = [
  named("0G router", async () => {
    const { value, ms } = await timed(() => json(ROUTER));
    const listed = (value.data ?? value).some((m) => m.id === MODEL);
    return listed ? ok(`0G serves the rover's model ${MODEL} (router answered in ${ms} ms)`)
                  : fail(`0G's router no longer lists ${MODEL}: the rover cannot decide anything`);
  }),
  named("TEE signer", async () => {
    const s = await readTeeService();
    const good = s.acknowledged && s.verifiability === "TeeML" && s.targetSeparated === false;
    return good ? ok(`The model's TEE signer is registered on 0G mainnet: ${s.signerOnchain} (TeeML, acknowledged)`)
                : fail(`0G mainnet no longer shows an acknowledged TeeML signer for provider ${MAINNET.provider}: proofs will fail`);
  }),
  named("zg-log", async () => {
    const h = await json(`${LOCAL.zgLog}/health`, { timeoutMs: 4000 });
    const bal = Number(h.balance0G);
    const lines = [h.queue === 0 ? ok("zg-log is up, with nothing waiting to upload") : warn(`zg-log is up, but ${h.queue} uploads are still waiting`)];
    // A mission costs about 0.01 test 0G (P4: 0.0084 for 3.3 min).
    lines.push(bal >= 0.1 ? ok(`zg-log's Galileo wallet holds ${bal.toFixed(3)} test 0G (a mission uses about 0.01)`)
      : bal >= 0.02 ? warn(`zg-log's Galileo wallet is low: ${bal.toFixed(3)} test 0G. Claim the Galileo faucet`)
      : fail(`zg-log's Galileo wallet is nearly empty: ${bal.toFixed(4)} test 0G. Missions cannot be stored`));
    const rpc = await fetch(GALILEO.rpc, { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [h.contract, "latest"] }) }).then((r) => r.json());
    lines.push(rpc.result && rpc.result.length > 2 ? ok(`Galileo answers, and the EpisodeLog contract is there (${h.contract})`)
                                                    : fail(`Galileo shows no EpisodeLog code at ${h.contract}`));
    return lines;
  }),
  named("0G Storage", async () => {
    const eps = await json(`${LOCAL.zgLog}/segments`, { timeoutMs: 4000 });
    const last = eps.filter((e) => e.started && e.segments?.length).sort((a, b) => b.started.block - a.started.block)[0];
    if (!last) return info("0G Storage not checked: zg-log has no stored segment yet");
    const seg = last.segments.at(-1);
    const { value, ms } = await timed(async () => {
      const r = await fetch(`${GALILEO.indexer}/file?root=${seg.root}`, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (await r.arrayBuffer()).byteLength;
    });
    return value === seg.bytes ? ok(`0G Storage answers: the last stored segment came back whole in ${(ms / 1000).toFixed(1)} s`)
                               : warn(`0G Storage returned ${value} bytes for a ${seg.bytes}-byte segment`);
  }),
  named("0G spend", async () => {
    const dir = path.join(ROOT, "services/zg-log/data");
    const today = new Date().toDateString();
    let all = 0, now = 0, calls = 0;
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".jsonl"))) {
      for (const line of readFileSync(path.join(dir, f), "utf8").split("\n")) {
        if (!line) continue;
        const r = JSON.parse(line);
        const usd = r.billing_usd_micro ?? 0;
        all += usd;
        calls++;
        if (new Date(r.t_frame_ms).toDateString() === today) now += usd;
      }
    }
    return info(`0G decisions so far cost $${(all / 1e6).toFixed(3)} over ${calls} checkpoints ($${(now / 1e6).toFixed(3)} today; photo number checks not counted). Keep at least $1 of 0G credit`);
  }),
];

// ---------- Hedera: the money ----------

async function account(role, id, { hbarMin, usdcMin }) {
  if (!id) return warn(`${role}: no account id in its env file`);
  const a = await mirror(`/api/v1/accounts/${id}`);
  if (!a) return fail(`${role} ${id} does not exist on the mirror node`);
  const hbar = a.balance.balance / 1e8;
  const usdcRow = a.balance.tokens.find((t) => t.token_id === USDC);
  const usdc = usdcRow ? usdcRow.balance / 1e6 : null;
  const words = `${role} ${id}: ${hbar.toFixed(2)} HBAR${usdc != null ? `, ${usdc.toFixed(2)} USDC` : ""}`;
  if (hbar < hbarMin / 4 || (usdcMin && (usdc ?? 0) < usdcMin / 2)) return fail(`${words}. Top up before a mission`);
  if (hbar < hbarMin || (usdcMin && (usdc ?? 0) < usdcMin)) return warn(`${words}. Getting low`);
  return ok(words);
}

const hedera = [
  named("mirror", async () => {
    const { ms } = await timed(() => mirror("/api/v1/network/nodes?limit=1"));
    return ok(`Hedera's mirror node answers (${ms} ms)`);
  }),
  // Plan §7: keep 10 HBAR on the buyer and Rover-A; a mission budget is at most 1 USDC.
  named("buyer", () => account("Buyer", buyer.HEDERA_BUYER_ID, { hbarMin: 10, usdcMin: 2 })),
  named("Rover-A", () => account("Rover-A", shopA.HEDERA_ROVER_ID, { hbarMin: 10 })),
  named("Rover-B", () => account("Rover-B (simulated)", shopB.HEDERA_ROVER_ID, { hbarMin: 1 })),
  named("facilitators", async () => {
    const hs = await Promise.all(FACILITATORS.map(async (f) => ({ f, h: await facilitatorHealth(f) })));
    const up = hs.filter((x) => x.h.ok);
    return hs.map(({ f, h }) => h.ok ? ok(`${f.name} settles hedera:testnet payments (fee payer ${h.feePayer}, ${h.ms} ms)`)
      : (up.length ? warn : fail)(`${f.name} is not usable: ${h.error}${up.length ? `. The shop will use ${up[0].f.name}` : ". No payment can settle"}`));
  }),
  named("topics", async () => {
    const topics = [["Rover-A's payments", shopA.HCS_MONEY_TOPIC], ["Buyer's spending", buyer.HCS_SPEND_TOPIC], ["Negotiation audit", buyer.AUDIT_TOPIC]];
    return Promise.all(topics.map(async ([name, id]) => {
      if (!id) return warn(`${name} topic: no id in the env file`);
      const t = await mirror(`/api/v1/topics/${id}`);
      if (!t || t.deleted) return fail(`${name} topic ${id} is missing`);
      const m = await mirror(`/api/v1/topics/${id}/messages?order=desc&limit=1`);
      return ok(`${name} topic ${id} is there (latest message ${m?.messages?.[0]?.sequence_number ?? "none"})`);
    }));
  }),
];

// ---------- the laptop ----------

const laptop = [
  named("shop A", async () => {
    const h = await json(`${LOCAL.shopA}/health`, { timeoutMs: 4000 });
    return h.pay_to === shopA.HEDERA_ROVER_ID ? ok(`Rover-A's shop is up, paid to ${h.pay_to} through ${h.facilitator}`)
                                              : fail(`Rover-A's shop pays to ${h.pay_to}, not Rover-A's ${shopA.HEDERA_ROVER_ID}`);
  }),
  named("shop B", async () => {
    const h = await json(`${LOCAL.shopB}/health`, { timeoutMs: 4000 }).catch(() => null);
    return h?.ok ? ok("Rover-B's shop is up (simulated, it only quotes)")
                 : warn("Rover-B's shop is not running: Claude will find one rover only. Start it with SELLER=b");
  }),
  named("MCP", async () => {
    const cfg = path.join(homedir(), ".config/Claude/claude_desktop_config.json");
    const entry = existsSync(cfg) ? JSON.parse(readFileSync(cfg, "utf8")).mcpServers?.["0xbs-devices"] : null;
    if (!entry) return fail("Claude Desktop has no 0xbs-devices MCP server in its config");
    const dist = path.join(ROOT, "services/mcp-server/dist/index.js");
    if (!existsSync(dist)) return fail("The MCP server is not built: run its build first");
    const newest = (dir) => readdirSync(dir, { withFileTypes: true }).reduce((t, e) =>
      Math.max(t, e.isDirectory() ? newest(path.join(dir, e.name)) : statSync(path.join(dir, e.name)).mtimeMs), 0);
    const stale = newest(path.join(ROOT, "services/mcp-server/src")) > statSync(dist).mtimeMs;
    return stale ? warn("Claude Desktop's MCP server has newer source than its build: rebuild it, then restart Claude Desktop")
                 : ok("Claude Desktop runs the 0xBs MCP server, and its build is up to date");
  }),
  named("HUD", async () => {
    const r = await fetch(`${LOCAL.hud}/`, { signal: AbortSignal.timeout(3000) }).catch(() => null);
    return r?.ok ? ok("The HUD is up at http://127.0.0.1:8080")
                 : warn("The HUD is not running: systemctl --user restart rover-hud (or scripts/laptop/install.sh)");
  }),
  named("replay", async () => {
    const r = await fetch("http://127.0.0.1:3005/", { signal: AbortSignal.timeout(3000) }).catch(() => null);
    return r?.ok ? ok("The local replay site is up at http://127.0.0.1:3005 (the public one is rover-replay.vercel.app)")
                 : warn("The local replay site is not running: systemctl --user restart rover-replay (or scripts/laptop/install.sh)");
  }),
  named("autostart", async () => {
    const enabled = await new Promise((resolve) => execFile("systemctl", ["--user", "is-enabled", "rover-laptop.target"],
      (err, stdout) => resolve(!err && stdout.trim() === "enabled")));
    return enabled ? ok("zg-log, both shops, the HUD and the local replay site start at boot and restart after a crash (systemd user services)")
                   : warn("The laptop services won't come back after a reboot: run scripts/laptop/install.sh");
  }),
];

// ---------- the rover ----------

function onBoard(host, script) {
  return new Promise((resolve) => execFile("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5", `arduino@${host}`, script],
    { timeout: 25000 }, (err, stdout) => resolve(err ? null : stdout.trim().split("\n"))));
}

async function rover() {
  const url = shopA.ROVER_URL;
  if (!url || !shopA.ROVER_LAN_TOKEN) return [fail("No ROVER_URL or rover token in services/hedera-shop/.env.a")];
  const s = await json(`${url}/status`, { headers: { "X-Rover-Token": shopA.ROVER_LAN_TOKEN }, timeoutMs: 6000 }).catch((e) => e);
  if (s instanceof Error) return [fail(`The rover does not answer at ${url} (${s.message}). Is it powered, and on the hotspot?`)];
  const out = [s.state === "idle" ? ok("The rover answers and is idle, ready for a mission")
                                  : warn(`The rover is busy (${s.state}): a mission is still running`)];
  const mcu = s.mcu;
  if (!s.mcu_connected || !mcu) out.push(fail("The rover's motor board (MCU) is not connected"));
  else {
    const v = mcu.batt_mv / 1000;
    // flags: 2 = IMU ok, 16 = motor battery above the 7.0 V cutoff (rover/core/mcu.py)
    out.push(!(mcu.flags & 16) ? fail(`The motor battery is off or flat (${v.toFixed(2)} V): no move will run`)
      : v < 7.6 ? warn(`The motor battery reads ${v.toFixed(2)} V: charge it soon (full is about 8.3 V)`)
      : ok(`The motor battery reads ${v.toFixed(2)} V`));
    out.push(mcu.flags & 2 ? ok("The IMU is calibrated and reading") : warn("The IMU is not calibrated: the next mission start calibrates it"));
    // A loose gyro supply wire shows up here first (42 resets, 61 failed reads); the counts start at the MCU's boot.
    out.push(mcu.imu_resets || mcu.imu_bus_errors
      ? warn(`The gyro reset ${mcu.imu_resets} times and failed ${mcu.imu_bus_errors} reads since the motor board started: check its power and I2C wires`)
      : ok("The gyro has not reset or failed a read since the motor board started"));
  }
  const cam = s.camera;
  out.push(cam?.frame_age_ms != null && cam.frame_age_ms < 1000 ? ok(`The camera is streaming (brightness ${cam.luma})`)
                                                               : fail("The camera has no fresh frame"));
  if (s.zglog_pending) out.push(warn(`The rover still has ${s.zglog_pending} records to send to zg-log`));

  const host = new URL(url).hostname;
  const board = await onBoard(host, [
    "systemctl is-active rover.service",
    "cd ~/0xbs-rover && venv/bin/python -c 'from rover.zg.prompt import PROMPT_VERSION; print(PROMPT_VERSION)'",
    `venv/bin/python -c 'import requests,time;t=time.time();r=requests.get("${ROUTER}",timeout=8);print(r.status_code,round((time.time()-t)*1000))'`,
    "cat /sys/class/thermal/thermal_zone0/temp",
    "df -BM --output=avail / | tail -1",
    `venv/bin/python -c 'import json;s=json.load(open("rover/core/calibration.json")).get("suite") or {};print(json.dumps([s.get("date"),s.get("place")]))'`,
  ].join("; "));
  if (!board) return [...out, warn(`Could not ssh into arduino@${host}, so the board itself was not checked`)];
  const [service, prompt, router, temp, disk, calib] = board;
  out.push(service === "active" ? ok(`rover.service is running, on prompt ${prompt}`) : fail(`rover.service is ${service}`));
  const [code, ms] = (router ?? "").split(" ");
  out.push(code === "200" ? ok(`The rover reaches 0G's router itself (${ms} ms over the hotspot)`)
                          : fail("The rover cannot reach 0G's router: check the hotspot's mobile data"));
  const c = Number(temp) / 1000;
  out.push(c < 70 ? ok(`The board is at ${c.toFixed(0)} °C`) : warn(`The board is hot: ${c.toFixed(0)} °C. Let it cool between runs`));
  const freeMb = parseInt(disk, 10);
  out.push(freeMb > 500 ? ok(`${(freeMb / 1024).toFixed(1)} GB free on the board`) : warn(`Only ${freeMb} MB free on the board`));
  // Plan 10A: calibrate on the floor you demo on, the same morning (rover/tools/calibrate.py run --place <place> --go).
  const [calDate, calPlace] = (() => { try { return JSON.parse(calib); } catch { return [null, null]; } })();
  const today = new Date().toISOString().slice(0, 10);  // UTC, like the suite (the board runs on UTC)
  out.push(!calDate ? warn("The rover was never calibrated by the suite: run rover.tools.calibrate run --place <here> --go on this floor")
    : calDate !== today ? warn(`The rover's calibration is from ${calDate} (${calPlace}), not today: run the suite on this floor`)
    : ok(`The rover was calibrated today (${calPlace})`));
  return out;
}

console.log(`Rover for Hire: event check, ${new Date().toLocaleString()}`);
await section("0G: the brain and the record", zg);
await section("Hedera: the money", hedera);
await section("This laptop", laptop);
await section("The rover", [named("rover", rover)]);
console.log(tally.fail ? `\n\x1b[31mNot ready:\x1b[0m ${tally.fail} to fix, ${tally.warn} to watch. Fix every ✗ before a demo.`
  : `\n\x1b[32mReady.\x1b[0m ${tally.warn ? `${tally.warn} warning${tally.warn > 1 ? "s" : ""} to watch.` : "Nothing to fix."}`);
process.exit(tally.fail ? 1 : 0);
