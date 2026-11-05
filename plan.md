# plan.md — Rover for Hire inside 0xBs (Hedera ↔ 0G ↔ UNO Q rover)

Status: plan v1.1, 5 Nov 2026 (decisions confirmed by you). Nothing below is built yet.

**Sources of truth.** The `handoff/` folder in `~/Desktop/ETHGlobal/handoff`. `HANDOFF.md` wins on facts, settings and wiring. `IMPLEMENTATION_PLAN.md` wins on scope and cuts, except where this file overrides it (§1.2). `bench/` is API reference only: read it, never copy it.

---

## 0. Ground rules (apply to every phase)

1. **No mock data, no stubs.** Every test runs against real systems: the real rover, 0G mainnet compute, Galileo testnet, Hedera testnet, and the real facilitators. Unit tests of pure functions may only use fixtures captured from real runs, stored with their source noted.
2. **No guessed values in the product path.** Any value that isn't in HANDOFF (cm/s, turn duty, camera field of view, segment period…) is measured in a test step first. It is then written to config with the evidence file that produced it.
3. **"No pay, no move. No brain, no move. No proof, no move."** Motion is enabled only when all three leases hold. There is **no `MONEY_LEASE=stub`**: the motion loop is first switched on in Phase 6, with real Hedera payments. A failure never produces a cached, default or local decision.
4. **Secrets only in env files** that git ignores (`.env`, `/etc/0xbs-rover.env`, mode 0600). Never print, log or commit them, and never pass them through a model or MCP tool argument.
5. **Code style.**
   - Comments are minimal: one short line, only where the code can't say it (hardware quirks, protocol traps). No banners or docblocks.
   - Hedera code and 0G code live in separate packages (§2) and never import each other. Only the rover mission loop, the HUD and the replay page see both.
6. **Commits.**
   - Small commits, one per task, under the user's own git identity.
   - **No AI author or `Co-Authored-By` trailer.**
   - Each phase ends with a commit plus the tag `rover-p<N>`, only after its evidence is saved.
7. **Definition of done for a phase:**
   - every acceptance test in that phase ran on real systems and passed;
   - its evidence file exists under `prior-work/evidence/`, holding commands, raw numbers, tx ids / roots / request ids, and PASS/FAIL per check, with no keys;
   - `pnpm build` is green for every package touched;
   - existing 0xBs Base/Solana behaviour is unchanged (P0 smoke test re-run).

### 0.1 Decisions taken

| # | Decision |
|---|---|
| D1 | No MuJoCo sim body. Rover-B is a quote-only simulated seller, labelled as such everywhere. |
| D2 | One paid **move** = one checkpoint's motion: at most 50 cm of driving, one turn, or one `orbit_leg`. `photo` and `stop` use no move. |
| D3 | Photos are pay-on-delivery: `POST /missions/:q/photo/:n` uses the x402 `authorization` flow, so a failed photo costs nothing. |
| D4 | Buyer choices are deterministic rules (price, rating, budget), each logged with its reason. |
| D5 | **Prices.**<br>Rover-A: asks $0.02 per move + $0.08 per photo; floor $0.015 + $0.05.<br>Rover-B: asks $0.03 + $0.10.<br>The buyer counters A at $0.015 + $0.06.<br>Budgets: hero mission $0.80; `402`-beat run $0.25.<br>Limits: cap $0.20 per payment; approval threshold $0.50 per payment. With the cap below the threshold, the threshold never triggers, as intended. |
| D6 | Code lives inside the 0xBs monorepo, on branch `rover`. |
| D7 | The buyer is **Claude Desktop through the 0xBs MCP server**. A human starts a mission with one tool call. After that, every payment happens autonomously in the background: no per-payment approval. |
| D8 | **Hedera and 0G are the targets and must work end to end.** The rover storefront settles on Hedera testnet only. Paying the rover in Base/Solana is later work (§6.7). The existing 0xBs Base/Solana device path keeps working, and P0 re-tests it. |
| D9 | Rover-B's floor = its list price: it holds firm. The buyer's counter rule is **75 % of list**, which gives exactly $0.015 + $0.06 for A. |
| D10 | Decision records contain **no floating-point numbers**: only integers in fixed units, strings, booleans, null, arrays and objects. Python and TypeScript then hash the same canonical JSON byte for byte (§3.4). |
| D11 | No visual tracker. `approach` turns to the heading 0G's bounding box implies, then holds heading with the IMU and stops on sonar. The next checkpoint re-asks 0G. |
| D12 | ERC-8004 agents, HCS topics and the `EpisodeLog` contract are created fresh in this repo's setup scripts. Bench IDs are not reused. |
| D13 | The network is the phone hotspot "Pavan A52s 5g" (5 GHz), not a separate router (5 Nov). Its measured RTT, 31.6 ms average with the keep-alive and telemetry on, is accepted against the 30 ms target. The money lease (1 s) and the 0G decision (~3.4 s) tolerate it. |
| D14 | ~~A second (spare) UNO Q is used for simulation only: powered on, with no motors, sensors, camera or other IoT parts connected (user, 5 Nov).~~ **Replaced by D15 (6 Nov):** the spare UNO Q becomes the sensor station Station-A, Phase 12 §12.1. |

### 0.2 What this plan fixes in 0xBs (needed for the new flow) vs defers

**Fixed in P0** (needed for a public repo and the new flow):
- live API keys of old 0xBs devices (there is no ESP32 any more; only the UNO Q) and a Wi-Fi password committed in `firmware/*.ino` and `simulations/config.ts`;
- `services/mcp-server` built outside the pnpm workspace (it has its own `package-lock.json`), so it can't depend on the new workspace packages;
- `turbo.json` strict env mode doesn't list the new variables.

**Deferred** (they affect only Base/Solana or other parts, not the Hedera/0G/rover flow), listed in §6:
- device-controller moves the device before settling;
- device-controller running on Vercel serverless;
- CRUD logic duplicated across web, device-controller and auth;
- the `walletChain` switch bug;
- MCP has no `Idempotency-Key` on Base/Solana calls;
- `import_wallet` passes a key through the model;
- ESP32 SDK issues (overlapping commands, insecure TLS);
- auth rate-limit keying;
- broken simulation scripts;
- unused `status` topic;
- gateway issues;
- the unmerged `feat/x402-directory-discovery` branch.

The new Hedera storefront uses the `upfront` flow (settle before the handler runs), so the actuate-before-settle bug can't occur on the rover path.

---

## 1. Architecture

### 1.1 System

```
CLAUDE DESKTOP (laptop) ──stdio──► services/mcp-server  (existing Base/Solana tools + new Hedera rover tools)
                                        │ uses packages/hedera-buyer (discovery, A2A, x402 client, Agent Kit, mission runner)
                                        ▼
   ERC-8004 (Hashio/mirror) ◄── discovery        A2A + x402 ──► services/hedera-shop  (Rover-A :8402, Rover-B :8403)
   HCS spending topic  ◄── buyer                                   │ facilitator Blocky402 → fallback x402.org (Hedera testnet, USDC 0.0.429274)
                                                                   │ HCS money topic, money heartbeat 250 ms
                                                                   ▼  LAN, X-Rover-Token
UNO Q "RoverA" Linux: rover/  (Python, systemd)  :8700 HTTP + WS /telemetry
   core: bridge · camera · lease (brain/proof/money) · skills · mission loop · records · api
   zg:   brain (0G router, private mode) · proof (on-chain signer + EIP-191)
   │ Bridge RPC (msgpack over /var/run/arduino-router.sock)           │ records (LAN, token)
   ▼                                                                   ▼
UNO Q MCU: firmware/rover_mcu  (100 Hz, leases, heartbeat watchdog,   services/zg-log (laptop :8787)
   stop-only reflexes, motors, IMU, sonar, encoders, LED faces)          60 s segments → 0G Storage (Galileo) → EpisodeLog.anchorSegment
                                                                       apps/replay (public, static): EpisodeLog events → segments → re-verify signatures
                                                                       apps/hud (local): frame, decision, leases, payments, roots
```

### 1.2 Overrides of IMPLEMENTATION_PLAN

| Item | Override |
|---|---|
| Separate `rover-for-hire` repo | Lives in the 0xBs monorepo (D6) |
| CLI buyer agent | Claude Desktop via MCP (D7); the same `hedera-buyer` package also has a CLI, used by the phase tests |
| `MONEY_LEASE=stub` before Hedera | Removed. Hedera comes before the motion loop |
| Hardhat for EpisodeLog | `solc` 0.8.28 + `ethers` 6.13.1 compile/deploy scripts (the bench-proven path on Galileo) |
| H-hour schedule | Replaced by the phase order below; each phase must pass before the next starts |

### 1.3 Processes, hosts and ports

| Process | Host | Port | Auth |
|---|---|---|---|
| `firmware/rover_mcu` | UNO Q MCU | Bridge RPC | — |
| `rover` service | UNO Q Linux | `:8700` HTTP + WS | `X-Rover-Token` (`ROVER_LAN_TOKEN`) |
| `rover-keepalive` | UNO Q Linux | — | systemd unit, root (`ping -i 0.05` to the gateway) |
| `zg-log` | laptop | `:8787` | `X-Log-Token` (`ZG_LOG_TOKEN`) on writes |
| `hedera-shop` Rover-A | laptop | `:8402` | public x402/A2A; calls the rover with its token |
| `hedera-shop` Rover-B | laptop | `:8403` | public; no rover behind it (D1) |
| `mcp-server` | laptop (spawned by Claude Desktop) | stdio | keys from `services/mcp-server/.env` |
| `apps/hud` | laptop | `:8080` | local only; the rover token stays server-side |
| `apps/replay` | public static host | — | none (read-only chain + storage) |

---

## 2. Repository layout (new and changed)

```
0xBs/
  plan.md                         this file
  docs/rover/                     HANDOFF.md ARCHITECTURE.md IMPLEMENTATION_PLAN.md PRIOR_ART.md (copied from handoff/; STATUS.md and ACCOUNTS_AND_IDS.md moved to prior-work/ on 7 Nov)
    IDS.md                        every ID/address/topic/agent created by the setup scripts (public only)
    evidence/                     evidence made at the event (the pre-event P0…P13 folders are in prior-work/evidence/)
  firmware/rover_mcu/             MCU sketch: rover_mcu.ino, config.h, motors.*, sonar.*, imu.*, enc.*, faces.*
  firmware/l298n_drive, led_blink secrets moved to secrets.h (gitignored) + secrets.example.h  [P0 fix]
  rover/                          Python on the UNO Q (not a pnpm package)
    core/   config.py bridge.py camera.py lease.py skills.py mission.py records.py api.py telemetry.py main.py
    zg/     prompt.py brain.py proof.py          ← all 0G code on the rover
    tools/  floor_test.py skill_test.py zg_check.py deploy.sh
    tests/  unittest (pure logic, real-run fixtures)
    systemd/ rover.service rover-keepalive.service
    requirements.txt
  contracts/episode-log/          @0xBs/episode-log: EpisodeLog.sol, compile.ts, deploy.ts, abi.json, test-galileo.ts   ← 0G
  packages/zg/                    @0xBs/zg: canonical JSON, record/segment types + verify, storage, EpisodeLog client, TEE signature verify   ← 0G
  services/zg-log/                @0xBs/zg-log: records → segments → 0G Storage → EpisodeLog   ← 0G
  packages/hedera/                @0xBs/hedera: constants, key parsing, mirror client, HCS hash-chained log, facilitator health, ERC-8004 client, A2A message types, agent card   ← Hedera
  services/hedera-shop/           @0xBs/hedera-shop: x402 storefront + A2A seller + money heartbeat + HCS money log; scripts/setup.ts   ← Hedera
  packages/hedera-buyer/          @0xBs/hedera-buyer: discovery, negotiation, x402 client + spend controls, Agent Kit tool/hook/policies, mission runner, CLI   ← Hedera
  services/mcp-server/src/hedera/ new rover tools that call @0xBs/hedera-buyer (existing tools untouched)
  apps/hud/                       local Next.js HUD
  apps/replay/                    public Next.js static export
```

Pinned versions (the tested ones from `prior-work/ACCOUNTS_AND_IDS.md`, confirmed published on npm on 5 Nov):

| Package | Version | Used in |
|---|---|---|
| `@x402/core`, `@x402/express`, `@x402/fetch`, `@x402/hedera` | 2.28.0 | hedera-shop, hedera-buyer |
| `@hiero-ledger/sdk` | 2.85.0 in hedera-shop / `packages/hedera`; **2.86.2** in hedera-buyer (Agent Kit peer) | never pass SDK objects across packages |
| `@hashgraph/hedera-agent-kit` | 4.1.1 | hedera-buyer |
| `@a2a-js/sdk` | 1.3.0 | hedera-shop, hedera-buyer |
| `@0gfoundation/0g-storage-ts-sdk` | 1.2.13 | packages/zg |
| `ethers` | 6.13.1 | packages/zg, episode-log, hedera (ERC-8004), replay |
| `solc` | 0.8.28 | episode-log |
| `zod` | 3.25.76 | hedera-buyer, mcp-server |
| Python (board) | `arduino-router-bridge` 0.5.1; apt `python3-opencv` (4.10.0 present), `python3-requests`; `aiohttp`, `eth-account`, `eth-abi` (or `web3`): exact versions frozen in P2/P3 after the ARM64 install test | rover/ |

Existing device-controller stays on `@x402/* ^2.22`. It is a separate package, so there is no conflict.

---

## 3. Interfaces and data formats

### 3.1 MCU Bridge functions (`firmware/rover_mcu`)

Commands return `0` when accepted, or a refusal code: 10 no heartbeat · 11 IMU not calibrated · 12 not calibrated · 13 low battery · 14 bad argument · 20 not moving.

| Function | Thread | Args → return | Behaviour |
|---|---|---|---|
| `drive_cm` | provide_safe | `(cm ±1…200, speed_pct 0=cruise, lease_ms) → code` | Kick-start, then cruise. Stops when the distance is reached (encoders if `mm_per_edge` > 0, else time from `cruise_mm_s`), on lease end, heartbeat loss, reflex, battery or IMU fault |
| `drive_until` | provide_safe | `(max_cm 1…200, stop_mm 100…2000, lease_ms) → code` | Forward at cruise; stops (`stop_reason` 8 `sonar`) when the fresh sonar median ≤ `stop_mm`, else at `max_cm` like `drive_cm`. Used by `approach` (P2) |
| `drive_ms` | provide_safe | `(ms ≤5000, speed_pct, lease_ms) → code` | Fixed-time straight drive (cruise calibration) |
| `turn_deg` | provide_safe | `(deg ±1…360, lease_ms) → code` | + = left (CCW, positive yaw). Brakes when remaining < `0.055 s × rate + rate² / 3704` (fitted on settled headings, 5 Nov; P1 row 8) |
| `set_duty` | provide_safe | `(l_pct, r_pct, lease_ms) → code` | Raw −100…100, no kick; floor tests only. Needs heartbeat + battery, not calibration |
| `lease` | provide_safe | `(lease_ms) → code` | Extends the current motion's lease (≤1500 ms) without restarting it |
| `stop` | provide_safe | `() → code` | Brake, then coast |
| `heartbeat` | provide | `(seq) → seq` | Stamps `millis()`; motion stops ≤ 310 ms after the last one |
| `state` | provide_safe | `() → CSV` | `ms,mode,stop_reason,refusal,start_ms,halt_ms,hb_ms,lease_until_ms,yaw_cdeg,rate_cdps,sonar_mm,sonar_raw_mm,batt_mv,enc_l,enc_r,dist_mm,face,flags,pings,batt_now_mv,batt_min_mv,imu_resets,imu_bus_errors` (integers; parsed by `rover/core/mcu.py`; fits the 256-byte RPC buffer) |
| `face` | provide_safe | `(code) → code` | 0 idle · 1 ready · 2 thinking · 3 moving · 10 `0G?` · 11 `!TEE` · 12 `402` · 13 `STOP` · 14 `DONE` · 15 `BAT` |
| `imu_cal` | provide_safe | `() → bias×100` | ≈1.2 s still; refuses (−999999) while moving or if the chip reads all zeros |
| `set_cal` | provide_safe | `(cruise_pct, cruise_mm_s, batt_mv, kick_pct, kick_ms, floor_pct, turn_pct, kp_x10, brake_ms, mm_per_edge_x100) → code` | From `rover/core/calibration.json` (P1 values + sources). Distance/turn motion refused until set |
| `set_cutoff` | provide_safe | `(mv 5000…9000) → code` | Battery cutoff (default 7000) |
| `info` | provide_safe | `() → text` | Build stamp, IMU id, calibration flag, cutoff |

**Hard rules** (HANDOFF §5, §9 and the bench):
- **No `pinMode()` on D5/D6.**
- + = forward on both sides.
- Pins: IN1–IN4 on D7/D8/D12/D13. Encoders on D2/D4 (CHANGE, bounce filter ≥300 µs). Sonar TRIG A2, ECHO A3 via CHANGE interrupt with `micros()`, non-blocking, a ping every 60 ms, median of 3, −1.8 cm (P1). MPU-6050 on `Wire` at 400 kHz, 200 Hz gyro-z integration; right turn = negative yaw. Battery `adc × 10290/1023` mV (3 × 1k divider, full scale measured against the charger's 8.4 V).
- Reflex: brake at `120 mm + v × 0.4 s`, only while driving forward.
- Motion is refused until `imu_cal` and `set_cal` have run and a heartbeat has arrived.
- The IMU power register is checked every 0.5 s. A chip that reset itself (it wakes up asleep and reads zeros) is reconfigured, marked uncalibrated (motion stops) and counted in `imu_resets`. A failed read of that register is only counted in `imu_bus_errors`; calibration is kept.
- Motion is refused while `batt_mv` < 7000, because the L298N's 78M05 regulator needs ≥ 7 V in (HANDOFF §9). Face `BAT`. This replaces the multimeter check.

### 3.2 Rover HTTP API (`:8700`, header `X-Rover-Token`)

| Call | Body / reply |
|---|---|
| `POST /mission/start` | `{episode_id, quote_id, mission, photos_wanted}` → `{ok}`. Calls `imu_cal` and starts the loop |
| `POST /mission/end` | `{quote_id}` → final record, stop, `DONE` face |
| `POST /money` | `{quote_id, paid, txs:[…]}`. `paid` is a running total, so the call is idempotent |
| `POST /money/hb` | `{quote_id, seq}` |
| `GET /status` | `{state, face, quote_id, episode_id, used, paid, money_ok, brain_ok, proof_ok, photos:[{n, sha256, seq}], last_request_id, last_record_hash}` |
| `GET /photo/{n}` | `image/jpeg` (full 640×480 frame) or 404 |
| `WS /telemetry` | 20 Hz `state` + lease lights. Also the HUD feed |

There is deliberately **no** `/move` endpoint on the rover: only the mission loop moves it.

### 3.3 Decision record (one per checkpoint; D10: integers only)

```
{ v:1, episode_id, seq, prev_hash, t_frame_ms, t_sent_ms, t_reply_ms, latency_ms,
  img_sha256, sensors_json,                      ← the exact sensor string sent to 0G
  prompt_version:"v1", allowed_skills:[…], nonce, nonce_echoed,
  model:"0gm-1.0-35b-a3b", provider, request_id, chat_id, billing_usd_micro,
  raw_response,                                  ← exact content string from the model
  decision:{see, skill, target:[x1,y1,x2,y2]|null, stop_cm:int|null, reason},
  proof:{signed_text, signature, signer, signer_onchain, acknowledged, verifiability, target_separated, verified},
  leases:{brain, proof, money},
  executed:{skill, args, result, stop_reason} | null, safe_stop:{reason}|null,
  quote_id, move_index|null, money_tx|null, photo:{n, sha256}|null,
  hash }                                         ← sha256(canonical JSON without "hash")
```

**Segment:** `{v:1, episode_id, segment_index, prev_segment_root, first_seq, last_seq, records:[…], images:{sha256: base64}}`.

### 3.4 Canonical JSON (shared by Python and TypeScript)

Keys sorted recursively, separators `,` and `:` (no spaces), UTF-8 without ASCII escaping, no floats (rejected by both encoders).
- Python: `json.dumps(o, sort_keys=True, separators=(",",":"), ensure_ascii=False)`
- TS: `packages/zg` `canonical()`

P4 includes a cross-language test on real records.

### 3.5 HCS messages (≤ 1 KB, hash-chained with `prev` = sha256 of the previous message string)

| Topic (submit key) | Message |
|---|---|
| Rover money (Rover-A) | `{v, type: quote\|move\|photo\|end, quote_id, seq, prev, tx, amount, payer, request_id, seg_root, photo_sha}` |
| Buyer spending (buyer) | `{v, seq, prev, decision: paid\|refused, reason, merchant, amount, tx}` |
| Agent Kit audit (buyer) | the hook's own format + one negotiation summary `{offers, chosen, rejected_because, transcript_sha256}` |

### 3.6 A2A (`@a2a-js/sdk` 1.3.0, protocol v1.0, JSON-RPC, data parts)

`rfq{task:"parcel-inspection", photos, area}` → `quote{quote_id, price_move, price_photo, currency:"USDC", network:"hedera:testnet", payTo, valid_until, round}` → `counter{…}` → `quote{meetsOffer|final}` → `accept` → `accepted{x402:{start, move, photo, status, end}}` / `decline`.

Prices are atomic USDC strings.

### 3.7 ERC-8004 agent card (on-chain `data:` URI, registration-v1)

`name, description, services:[{name:"A2A", endpoint:<shop>/.well-known/agent-card.json, version:"1.0"}, {name:"x402", endpoint:<shop>/missions/{quoteId}/move}], x402Support:true, active:true, x402:{network:"hedera:testnet", asset:"0.0.429274", payTo:<own account>, price:{move, photo}, body:"arduino-uno-q"|"simulated"}, skills:["parcel-inspection"], supportedTrust:["reputation"], registrations:[{agentId, agentRegistry:"eip155:296:0x8004A818BFB912233c491871b3d84c89A494BD9e"}]`

### 3.8 New MCP tools (Claude Desktop)

| Tool | Spends? | Does |
|---|---|---|
| `hedera_wallet_info` | no | Buyer account id, HBAR + USDC balances (mirror), cap/budget defaults. Never shows a key |
| `find_rovers` | no | ERC-8004 discovery + card checks + reputation summary + storefront reachability |
| `hire_rover` | yes, autonomously | `{mission, photos, budgetUsdc}` → negotiate, choose, accept, start. Returns `missionId` at once; payments continue in the background |
| `rover_mission_status` | no | State, spend vs budget, every payment with a HashScan link, 0G request ids and segment roots, paid photos returned as **image content** |
| `end_rover_mission` | no | Ends the mission early. Feedback follows the D4 rule |

---

## 4. Phases

Each phase lists **Goal → Tasks → Acceptance tests → Evidence**. A phase starts only when the previous phase's tests all pass.

### Phase 0 — Groundwork and the required 0xBs fixes

**Goal:** a clean, buildable monorepo branch that can go public; accounts funded; board prepared.

**Tasks**
1. Branch `rover` from `main`. Enable pnpm 10.28.0 with `corepack enable`, or `npx pnpm@10.28.0` as the Vercel configs do (pnpm isn't installed on the laptop). Node v24.22.1 is installed: confirm every package builds and runs on it, which is checked in the acceptance tests.
2. Copy the handoff docs (not `bench/`) to `docs/rover/`. Create `docs/rover/IDS.md` and `prior-work/evidence/`.
3. **Secrets fix** (no ESP32 is used any more; only the UNO Q):
   - In the 0xBs console, delete the three old devices whose keys are in git:
     - the ESP32 car (public id `be0ef5c7…`, connector `3b7f9aa5…`);
     - the LED board (connector `8e10c33f…`);
     - the "Example Sensor Hub" used by `simulations/` (public id `48484243…`, connector `ecf00f12…`).
   - Deleting a device also deletes its EMQX broker user, so the leaked keys stop working.
   - Replace the literals in `firmware/l298n_drive`, `firmware/led_blink` and `simulations/config.ts` with placeholders or env lookups.
   - Purging the strings from git history is optional once the keys are dead. It needs a force-push, so it's your call.
4. **MCP server into the workspace:** delete `services/mcp-server/package-lock.json` and install through the root `pnpm install`. Check that `turbo run build --filter=@0xbBs/mcp-server` produces `dist/index.js`.
5. **turbo.json:** add every new env var name from §5 to `globalEnv`. Strict mode filters any variable that isn't listed.
6. Run `pnpm install`. For each "ignored build script" warning, allow only the packages whose code actually fails without it (`allowBuilds` in `pnpm-workspace.yaml`), and record why.
7. **Accounts (real balances via the mirror node, Galileo RPC and the 0G dashboard):**
   - the buyer (USDC, HBAR ≥ 10) and Rover-A (HBAR ≥ 10; then ≈2.06), both pre-event accounts listed in PRIOR_WORK.md;
   - the Galileo wallet (≥ 0.4 test 0G);
   - 0G mainnet compute ≥ $1.
   - Top up wherever short.
8. **Board:**
   - Disk (measured 5 Nov): `/home/arduino` is its own 18 GB partition with 17 GB free, and the venv, service, records and photos all live there. The root partition has 1.7 GB free and only takes apt packages; `sudo apt clean` frees another 330 MB there if needed.
   - Fit the heatsink.
   - Confirm the `arduino` user is in `arduino-router` (already true on 5 Nov).
   - Confirm there's no App Lab default app.

**Acceptance tests**
- `pnpm build` is green for the whole workspace.
- An MQTT connect to the EMQX broker with each leaked connectorId + key is refused as not authorized.
- `git grep -E "bs_[0-9a-f]{40}|YOUR_WIFI_PASSWORD"` on the branch finds nothing. The history is checked too, if you chose the purge.
- `curl` to the device-controller `/public/devices` returns 200.
- An MCP stdio smoke script (real MCP client → `dist/index.js`) lists the 8 existing tools; `payment_wallet_info` and `list_online_devices` return without error. This is the Base/Solana regression baseline.
- The balances table is filled from live queries.
- On the board: `/home/arduino` has ≥ 10 GB free, root ≥ 1.5 GB, and `id` shows `arduino-router`.

**Evidence:** `P0/summary.md` with the build log tail, the grep result, the MCP smoke output and the balances.

---

### Phase 1 — MCU firmware (`firmware/rover_mcu`)

**Goal:** a safe, calibrated body. Every motion stops on lease end, heartbeat loss or a sonar reflex.

**Tasks**
1. Write the sketch per §3.1, split into `motors`, `sonar`, `imu`, `enc` and `faces` files, using the Bridge pattern proven in `bench/unoq3/motor_test.ino`.
2. LED faces with `Arduino_LED_Matrix`, static frames only (no `SCROLL_LEFT`). First step: confirm the library ships with the `arduino:zephyr` 1.0.0 core on the board (`arduino-cli lib list --all`). If it doesn't, use the matrix API the core provides; decide by compiling a test frame.
3. Boot: setup drives IN pins LOW and ENA/ENB to 0 first, then shows face `ready` once the Bridge is up. Operating rule: the motor kill switch stays OFF until `ready` (the sketch starts about 29.5 s after power-on).
4. Write `rover/tools/floor_test.py`, interactive like the bench. It calls the Bridge directly and writes `P1/*.json`.
5. Flash on the board: `arduino-cli compile -b arduino:zephyr:unoq:wait_linux_boot=yes --upload firmware/rover_mcu`.

**Acceptance tests** (real floor, the venue-like surface you have, PTFE tape on the rear tyres)

| # | Test | Pass |
|---|---|---|
| 0 | Wiring re-check with the new firmware (wheels in the air; the left pair was already fixed by swapping wires) | `set_duty(+,+)` turns all four forward; a spin turns the sides opposite ways |
| 1 | Cold boot, kill switch ON from power-up (wheels in the air) | No wheel moves before `ready`; the sketch reaches `ready` |
| 2 | Heartbeat loss during `set_duty(45,45,1500)` | Stops ≤ 310 ms after the last heartbeat: the 300 ms timeout plus the 10 ms control tick (measured from `state`) |
| 3 | Lease end: `set_duty(45,45,500)` with heartbeats running | Stops at 500 ms ± 30 |
| 4 | **Sonar static** (closes the 20–100 cm gap): a large flat box/wall at 15, 20, 30, 40, 60, 100 cm (tape-measured), 60 pings each | 0 lost echoes; median of 3 within ±2 cm of the tape after the −1.0 cm offset. If a fixed offset fails, fit a line and record it |
| 5 | Calibrate cruise: 3 × 2 s at the cruise duty, tape-measured | Records `cruise_mm_s` and battery mV. Repeat at a lower battery charge and record the duty scaling |
| 6 | Kick-start / floor duty on the ground | Lowest duty that starts all four from standstill, recorded; kick 70 % for 100 ms works every time in 10 starts |
| 7 | `drive_cm(50)` × 5 | Each lands 50 ± 8 cm; heading drift < 5° |
| 8 | `turn_deg(+90)` × 5 and `turn_deg(-90)` × 5 | Each 85–95° (IMU, cross-checked against a floor tile line); turn duty recorded |
| 9 | Reflex: drive at cruise toward a wall; separately a hand at 20 cm | Stops with gap ≥ 120 mm; never touches |
| 10 | Tape wear: 20 turns | Tape intact; turn 20 still within 85–95° |
| 11 | Encoders, if mounted (`P1/enc.json`) | Hand turn gives 2 × slots edges ±15 %; both count at speed; no cross-talk. If not mounted, `drive_cm` stays time-based and the evidence says so |
| 12 | Thermal: 15 min of mixed driving with the heatsink | Board < 80 °C; L298N touch-safe; no reset |
| 13 | Low-battery cutoff (no multimeter, so the L298N 5 V pin isn't measured) | With a test flag raising the cutoff above the present reading, every motion command is refused and the face shows `BAT`; with the flag off, motion works. Battery mV is logged on every run from here on |

**Evidence:** `P1/` with every JSON file, the calibration table (these values go into `rover/core/config.py` defaults with the evidence path) and photos of the setup.

---

### Phase 2 — Rover service core (`rover/core`, no 0G yet)

**Goal:** the Linux side runs as a service, keeps the Wi-Fi awake, streams telemetry, drives skills through MCU leases, and exposes the token-protected API.

**Tasks**
1. **Venv on the board:** `~/0xbs-rover/venv` with `--system-site-packages` (apt `python3-opencv`, `python3-requests`). pip installs `arduino-router-bridge==0.5.1` and `aiohttp`, or apt `python3-aiohttp` if trixie has it; choose by testing. Freeze `requirements.txt` from what actually works on aarch64.
2. `rover/tools/deploy.sh`: rsync `rover/` and `firmware/` to the board; install the systemd units; never copies env files.
3. `bridge.py`: one worker thread owns the `Bridge()` connection, since its thread-safety isn't documented, so all calls are serialized. Heartbeat every 100 ms; reconnect on error (the MCU stops by itself within 300 ms).
4. `camera.py`:
   - open the C310 by its `/dev/v4l/by-id/…` path (found on the board in this phase) with `CAP_V4L2`, MJPG 640×480;
   - latest-frame thread; 512 px q70 JPEG for 0G, full frame for photos;
   - start once uptime ≥ 25 s; reopen on a read failure;
   - lock exposure, gain and white balance and set 50 Hz power-line frequency, using control names read from `v4l2-ctl -l` on the board. The C310 ignores controls written before its stream starts, so they are written after the first frame with each auto mode toggled (P2 probe);
   - `rover/tools/camera_cal.py exposure` picks a flicker-free exposure (10/20/30 ms) and the lowest gain for luma 100–140, and fixed R/B gains matching the camera's own auto white balance (the C310 has no tint control). **As built (5 Nov):** the same measurement runs automatically as `Camera.autocalibrate()` (~5–8 s) at service start and every `/mission/start`, then stays locked for the mission; P4 frames had been dark (luma 22) under bulb light with noon values;
   - filter the C310 "Corrupt JPEG data" stderr line.
5. `telemetry.py`: WS 20 Hz. `rover-keepalive.service`: `ping -i 0.05 <gateway>` as root.
6. `lease.py`: brain / proof / money lease state. The money part is pure accounting (`paid − used ≥ 1` and last money heartbeat < 1 s); the rover has no Hedera code.
7. `skills.py`, using the measured calibration:
   - `approach(bbox, stop_cm)`: turn to the bbox heading using the camera horizontal FOV measured in this phase (pinhole model); `drive_until` stops at `stop_cm` (clamped 20–60) plus a measured lead, or after 50 cm (D2). Heading hold stays off (P1); the next checkpoint re-aims (D11).
   - `orbit_leg()`: a chord of the circle around the target centred on the rover's pivot (12 cm behind the front edge): left 72° → leg `2 R sin 18°` with R = sonar gap + 10 cm + 12 cm (≈ 32 cm from a 30 cm gap) → turn in until the net heading change is −36° by the IMU. The sim's fixed 30 cm leg assumed a pivot under the camera (P2).
   - `turn(bbox)`: turn to centre the bbox.
   - `search_turn()`: left 45°.
   - `photo()`: full frame JPEG + sha256.
   - `stop()`.
   - Each motion command uses `lease_ms ≤ 1500`, renewed every 500 ms only while the lease gate returns OK.
8. `api.py` per §3.2: token check; mission endpoints wired to state, with no loop yet.
9. Unit tests (stdlib `unittest`, laptop and board): state parsing, lease gate truth table, bbox→heading maths. Fixtures come from real `state` strings and real frames captured in this phase.
10. `rover/tools/skill_test.py`: an operator tool that runs one named skill with explicit arguments, for the tests below only. It isn't exposed over the API.

**Acceptance tests**

| Test | Pass |
|---|---|
| systemd: power-cycle the board | `rover.service` and `rover-keepalive.service` active; restart after `kill -9`; runs as `arduino` with the `arduino-router` group |
| Camera under the service, 10 min | ≥ 25 fps, 0 read failures; survives the USB reset at ~21 s; exposure locked: `v4l2-ctl` readback equals `camera.json` at start and end, and the luma of a static scene stays within ±5 % (a locked camera follows the room light; only auto exposure would hide a change) |
| Camera HFOV | Measured with a target at a known angle; value recorded |
| Wi-Fi with the keep-alive on the phone hotspot (D13) | Laptop → rover RTT measured over 2 min and recorded (bench 19 ms; target < 30 ms; 31.6 ms accepted by D13) |
| Telemetry | 20 Hz ± 1 received on the laptop for 5 min |
| API auth | No/wrong token → 401 on every route |
| Service-level heartbeat | Stop the service mid-`set_duty` (operator tool) → MCU stops ≤ 300 ms |
| Skills on the floor (operator tool) | `approach` toward a box from 100 cm with a bbox from a real frame stops at stop_cm ±3 cm or at the 50 cm cap; `orbit_leg` ends facing the box at 0.50–0.62 m (5 tries); `search_turn` 45 ± 5°; `photo` returns a JPEG whose sha256 matches |
| Unit tests | All pass on laptop and board |

**Evidence:** `P2/`.

---

### Phase 3 — 0G brain + proof on the rover (`rover/zg`, decide-only)

**Goal:** real webcam frames → 0G mainnet → a validated decision with our own TEE proof check, measured from the UNO Q itself. No motion yet.

**Tasks**
1. `prompt.py`: SYSTEM_PROMPT_V1 **verbatim** from HANDOFF §6.3; the mission sentence; allowed skills `approach, orbit_leg, turn, photo, search_turn, stop`. **As built:** the rover uses **v2** = v1 + two sentences (the parcel is the box showing the mission's number, everything else is an obstacle; `sonar_cm` is null when the sonar hears nothing), approved 5 Nov after v1 failed every live blocked scene (P3 summary).
2. `brain.py`:
   - Request exactly as HANDOFF §6.2: `POST https://router-api.0g.ai/v1/chat/completions`.
   - Headers: `Authorization: Bearer $ZG_API_KEY`, `X-0G-Provider-Trust-Mode: private`.
   - Body: `temperature 0`, `max_tokens 200`, `response_format json_object`, `chat_template_kwargs.enable_thinking false`, `verify_tee true`.
   - Sensors JSON `{mission, sonar_cm, wheel_cm, yaw_deg, battery_v, photos_taken, last_actions, allowed_skills, nonce}`; 512 px q70 frame as a data URL; keep-alive session.
   - Validate the reply:
     - HTTP 200;
     - `x_0g_trace.provider` equals the pinned provider (`PROVIDER` in `rover/zg/brain.py`; the address is in `docs/rover/IDS.md`);
     - JSON parses;
     - schema (`see` str, `skill` in the allowed list, `target` null or 4 ints 0–1000, `stop_cm` number or null, `reason` str);
     - nonce echoed;
     - `approach`/`turn` require a target;
     - frame < 6 s old.
   - Capture `request_id`, `chat_id` (header `ZG-Res-Key`, else body `id`) and `billing.total_cost_usd_micro`.
   - Request timeout set from the measured latency (see tests); any failure → `0G?`. **As built:** 8 s (P3 max 7.1 s); router and provider connections warmed at mission start; `sonar_cm` null for no echo.
3. `proof.py`:
   - `getService(provider)` on InferenceServing `0x47340d900bdFec2BD393c626E12ea0656F938d84` (chain 16661, RPC `https://evmrpc.0g.ai`), read once per mission (retried at the next proof check until it succeeds; P3 internet-cut test).
   - Require `teeSignerAcknowledged == true`, `verifiability == "TeeML"` and `additionalInfo.TargetSeparated == false`. Never use `TargetTeeAddress`.
   - `GET {service.url}/v1/proxy/signature/{chat_id}?model={service.model}` with a 2 s timeout and 1 retry.
   - Require that the text starts with `zg-sig-v1/e2ee-ct:` and that EIP-191 recovery equals the on-chain `teeSignerAddress`.
   - Store `text` + `signature` (they expire after 20 min). Any failure → `!TEE`.
   - Library: `eth-account` + `eth-abi`, or `web3`. Pick whichever installs and runs on aarch64 Python 3.13 in this phase, and pin it. **Pinned:** `eth-account==0.14.0`, `eth-abi==6.0.0` (eth_call over plain JSON-RPC, no web3).
4. `records.py`: build the §3.3 record, canonical JSON (§3.4), hash chain. The float check raises.
5. Test-only fault switches, read only when `ROVER_TEST_MODE=1` and written into every record they touch:
   - corrupt the signature before recovery;
   - expect the wrong nonce.
6. `rover/tools/zg_check.py`: N decide-only checkpoints on the live camera + live sonar; writes the records and the latency stats.

**Acceptance tests** (on the UNO Q, its own Wi-Fi with keep-alive, real scenes: parcels labelled #1 and #3, a bag, an empty floor)

| Test | Pass |
|---|---|
| Install on aarch64 | All Python deps install in the venv under `/home/arduino`; root partition still ≥ 1.5 GB free |
| 4 real scenes × 3 runs: #3 visible > 40 cm; #3 at 20–40 cm; bag blocking; empty floor | 12/12 expected skill (approach / photo / orbit_leg / search_turn); 12/12 proof verified; 12/12 nonce echoed; target bbox drawn on the saved frame looks right |
| Latency from the board (≥ 30 calls) | Decision median/p90/max and signature-fetch distribution recorded. If fetch p99 > 2 s, raise the timeout to the measured p99 + 0.5 s and record it (the bench saw one 5.28 s fetch) |
| Internet cut at the router mid-run | Next checkpoint → `SAFE_STOP{0G?}`, face `0G?`, 3 tries then 5 s back-off; no decision invented |
| Fault switch: corrupted signature | `SAFE_STOP{!TEE}`; record shows `verified:false` and the test flag |
| Fault switch: wrong nonce | Decision rejected, safe stop |
| Private mode + a TeeTLS model name | 503 `no_provider_for_trust_mode` → `0G?` |
| Records | `unittest` re-verifies the hash chain of every record produced here |

**Evidence:** `P3/`: records JSONL, frames, the latency table, the negative-test outputs. These records are the real fixtures for P4.

---

### Phase 4 — 0G record pipeline (`contracts/episode-log`, `packages/zg`, `services/zg-log`)

**Goal:** every decision record and image lands on 0G Storage in 60 s segments, anchored in `EpisodeLog` on Galileo, and verifiable from the chain alone.

**Tasks**
1. `EpisodeLog.sol`, rewritten from the spec in HANDOFF §7 and ARCHITECTURE §4:
   - events `EpisodeStarted` / `SegmentAnchored` / `EpisodeEnded`;
   - errors `Exists`, `NotRover`, `AlreadyEnded`, `BadIndex`; only the starter may anchor or end.
   - `compile.ts`: solc 0.8.28, `evmVersion: cancun`, optimizer 200. `deploy.ts`: ethers 6.13.1 to chain 16602.
   - Address written to `IDS.md` and the env files.
2. `packages/zg`, using the API calls proven in `bench/zg_storage_test.mjs`:
   - `canonical()` and `recordHash()`; record and segment verify (chain, hashes, image sha256);
   - storage `upload(bytes)` via `MemData` → `merkleTree()` → `Indexer.upload(file, RPC, signer)`; download via `Indexer.download`/`downloadToBlob` and via `GET {indexer}/file?root=`;
   - EpisodeLog client and event reader;
   - `verifyTeeSignature(text, sig, provider)` reading `getService` from 0G mainnet.
3. `services/zg-log` on `:8787`:
   - `POST /episodes {episode_id, mission}` → `startEpisode(id, missionURI)` with `missionURI` = `data:application/json;base64,{quote_id, mission, photos_wanted, seller_agent_id}`;
   - `POST /records` (token): verify the hash chain on arrival; append to `data/<episode>.jsonl`, which survives restarts;
   - every 60 s and at end: build the segment → upload → `anchorSegment`, all in one sequential queue (nonce-safe);
   - `POST /episodes/:id/end` → last segment → `endEpisode(id, finalRoot, safeStops, decisions)`;
   - `GET /segments`, `GET /health`.
4. Rover `records.py` posts each record to zg-log with a local buffer and retries in order. **As built:** `rover/zg/zglog.py` (disk spool, strict order, halts on a conflict instead of skipping); zg-log ends an episode only after every record is anchored and rebuilds a step from the chain if its tx landed before a crash; `services/zg-log/scripts/verify-episode.ts` verifies an episode from the chain and HTTPS alone.

**Acceptance tests**

| Test | Pass |
|---|---|
| Contract on Galileo (`test-galileo.ts`) | start → anchor ×2 → end confirmed. A stranger's anchor reverts **specifically** `NotRover`; wrong index → `BadIndex`; after end → `AlreadyEnded`; a second start → `Exists`. Gas recorded |
| Cross-language canonical JSON | Every P3 record: Python hash == TS hash, byte for byte |
| Live run: 3 min of decide-only checkpoints on the rover | ≥ 3 segments anchored; each downloaded over HTTPS `/file?root=` passes verify (records chain, image sha256s, `prev_segment_root` links); events read back match |
| Segment size vs time | Upload time measured for real segment sizes (with real frames). It must finish within the 60 s period; otherwise change the period, record the decision and re-test |
| Crash safety | Kill zg-log mid-run, restart: no gap in `seq`; the rover buffer drains in order |
| Cost per mission | Galileo spend recorded |

**Evidence:** `P4/`: the contract address, tx hashes, roots, timings, explorer links.

---

### Phase 5 — Hedera money loop (`packages/hedera`, `services/hedera-shop`, `packages/hedera-buyer` core, rover money lease)

**Goal:** real USDC payments on Hedera testnet move the rover's money lease, upfront for moves and pay-on-success for photos, with spending controls, HCS logs and facilitator failover. The motion loop is still off; the rover only counts money in this phase.

**Tasks**
1. **`packages/hedera`**, using the calls proven in `bench/hedera_x402_test.mjs`:
   - constants (USDC `0.0.429274`, facilitators, mirror, Hashio, registries);
   - `parseKey` (ECDSA hex or DER); mirror client; `confirmTx`; `facilitatorTxSince` (ledger check before any retry);
   - `HcsLog` (hash-chained, rejects > 1 KB); `facilitatorHealth` (`GET /supported`, `hedera:testnet` exact v2 + fee payer).
2. **`services/hedera-shop`** (config `SELLER=a|b`):
   - `x402ResourceServer(HTTPFacilitatorClient)` + `ExactHederaScheme` + `paymentMiddleware`, with routes:
     - `POST /missions/:q/start` (free);
     - `POST /missions/:q/move` (`paymentFlow: "upfront"`, `DynamicPrice` = the accepted quote's move price, `payTo` = own account);
     - `POST /missions/:q/photo/:n` (default authorization flow; the handler fetches the rover's `GET /photo/{n}`: 200 + JPEG, or 5xx);
     - `GET /missions/:q/status`; `POST /missions/:q/end`.
   - A2A server, minimal in this phase: agent card, `rfq` → list-price quote, `accept`. Quotes are stored per `quoteId`.
   - `onAfterSettle` → rover `POST /money` (running total) + an HCS money message. `onSettleFailure` → no lease.
   - Money heartbeat `POST /money/hb` every 250 ms while the mission is active.
   - Facilitator: Blocky402 primary, x402.org fallback, health check every 30 s; on failure, switch and answer the next request with a fresh 402.
3. **`services/hedera-shop/scripts/setup.ts`, part 1:** check both accounts; USDC association; create the rover money topic (submit key Rover-A) and the buyer spending topic (submit key buyer); write `IDS.md`.
4. **`packages/hedera-buyer`, core:**
   - `x402Client` with `ExactHederaScheme(createClientHederaSigner(...))` (`PrivateKey` from `@x402/hedera`);
   - `setSpendControls({maxAmountPerPayment: "$0.20"})`;
   - `registerPolicy`: `payTo` == the chosen seller **and** amount == the agreed price;
   - `onBeforePaymentCreation`: mission budget, per-merchant limit, $0.50 threshold → abort with reason;
   - `onPaymentResponse` → buyer spending topic;
   - mission runner: keep 3 moves paid ahead (`paid − used < 3` from `/status`, polled every 500 ms); pay ready photos; on a settle error, check the ledger before any retry; stop on budget, end, or a max-duration config;
   - CLI: `hedera-buyer mission --seller <url> --photos N --budget X` (the same code the MCP tool will call).
5. **Rover:** `/money` and `/money/hb` update the money lease; `/status` reports `paid`, `used` and `money_ok`. **As built:** the shop initializes each facilitator itself and only fails over to a synced one; the HCS money log is a disk spool (`HcsSpool`) resumed after a restart; `SHOP_TEST_MODE` + `TEST_X402_PAYTO` exist only for the policy test.

**Acceptance tests** (real testnet + the real rover service; the bench showed ≈1.3 s per paid move)

| Test | Pass |
|---|---|
| Unpaid `/move` | 402; `PAYMENT-REQUIRED` decodes to `exact`, `hedera:testnet`, asset `0.0.429274`, payTo Rover-A, `extra.feePayer`, `paymentFlow:"upfront"` |
| Buyer CLI pays 3 moves | 3 settled txs (HashScan links, buyer −, Rover-A +, fee paid by the facilitator); rover `/status` `paid=3`; 3 HCS money messages, chain intact |
| Photo that doesn't exist (`/photo/99`) | Rover 404 → handler 5xx → **not charged** (USDC balance unchanged on the mirror) |
| Money heartbeat | Stop the shop → rover `money_ok` false within 1 s |
| Cap / policy / budget | $0.50 price → refused by `maxAmountPerPayment`; wrong `payTo` → refused by policy; budget $0.05 at $0.015/move → stops exactly at 3 moves |
| Facilitator failover | Make Blocky402 unreachable from the laptop (`/etc/hosts` entry for its host) → health check switches → a fresh 402 → paid via x402.org fee payer `0.0.9185802` |
| Buyer spending topic | Paid and refused entries present, chain intact |

**Evidence:** `P5/`: tx ids, HashScan links, topic ids, timings.

---

### Phase 6 — Full mission loop: brain + proof + money → motion

**Goal:** the walking rover. Every move is a verified 0G decision covered by a settled payment, recorded and anchored.

**Tasks**
1. `rover/core/mission.py` (HANDOFF §5, IMPLEMENTATION_PLAN §3.3):
   ```
   loop while mission active:
     frame (≤ 6 s), state, nonce → brain → fail: SAFE_STOP 0G? (3 tries, then 5 s)
     proof → fail: SAFE_STOP !TEE
     skill moves? → money lease (paid − used ≥ 1, hb < 1 s) → fail: SAFE_STOP 402, wait
     used += 1 at skill start (D2); execute with MCU leases renewed only while all three leases hold
     photo skill → photo n ready (sha256)
     record → zg-log
   ```
   Never reuse a decision across checkpoints. `last_actions` = the last 3 skills.
   **As built (5 Nov):** mission rules limit `allowed_skills`, and 0G still chooses:
   - no second photo from the same side (`photo_refused` tells 0G why);
   - after the first photo, no approach right after an orbit, nor without a sonar echo within 1 m;
   - an orbit keeps its direction unless its last leg was blocked.

   Prompt v4 replaces `search_turn` with `scan`: 12 views on one sheet, and 0G names the view whose number it reads, or a view with room to explore. Orbit legs check their path. After an IMU reset the rover recalibrates in place, and a move the MCU refuses is refunded. `EST_MOVES` = 13 (`prior-work/evidence/P6/summary.md`).
2. Shop `/start` → rover `/mission/start` + zg-log `/episodes`. Shop `/end` → rover `/mission/end` → zg-log end.
3. Buyer CLI runs the full mission against Rover-A with list prices (negotiation comes in P7).

**Acceptance tests** (real floor scene: parcels #1 and #3, a bag; kill switch in hand)

| Test | Pass |
|---|---|
| 3-photo mission, buyer CLI, budget $0.80 | Ends with 3 paid photos; every move preceded by a settled tx; record count = checkpoints; segments anchored; the photo JPEG sha256 delivered to the buyer == record `photo.sha256` |
| 5-photo hero mission | Same, 5 photos; mission time recorded (the plan expects 60–90 s) |
| `402` beat: budget $0.25 | Rover freezes with face `402`; already-paid photos delivered; no motion without money |
| `0G?` beat: internet cut | Safe stop within one checkpoint; resumes after the link returns, with a fresh decision |
| `!TEE` beat (test switch) | Safe stop; no motion |
| Reflex beat: hand in front | Stop; the next checkpoint re-asks |
| Moved parcel | The rover re-asks and re-plans (record shows a new target/skill) |
| Counting | `used` never exceeds `paid`; 0 moves without a lease in any record |

**Evidence:** `P6/`: full records, roots, tx list, video clips of each beat. `EST_MOVES` for D4 = the median moves per 5-photo mission measured here.

---

### Phase 7 — Identity, negotiation, Rover-B, Agent Kit

**Goal:** the buyer finds sellers on ERC-8004, negotiates over A2A, pays through an Agent Kit tool with audit and policies, and leaves feedback with proof of payment.

**Tasks**
1. **Setup part 2:**
   - Create Rover-B's **own** account from the buyer (`AccountCreateTransaction` with an ECDSA alias, as bench `setup` did) and associate USDC. The key goes to Rover-B's env file (0600), never printed.
   - Register Rover-A and Rover-B in IdentityRegistry `0x8004A818…D9e` with the §3.7 cards (each from its own key, so `agentWallet` = its payTo), then `setAgentURI` with `registrations`.
   - Gas limit 1.2 × estimate. Record the agentIds and the registration timestamp in `IDS.md`.
2. **Shop:**
   - full negotiation: counter → meets the floor → `meetsOffer`; else meet halfway, never below the floor; final after 3 rounds;
   - card extension `x402-hedera` with payTo;
   - Rover-B instance on `:8403`, B list = floor (D9), no `ROVER_URL`, so `/start` → 503 "simulated seller, no body";
   - transcript returned in the A2A context.
3. **Buyer:**
   - Discovery: `Registered` events from the mirror node in ≤ 7-day windows from `ERC8004_FROM` (chunked, so older registrations still work); decode the cards (`data:` and `https:` only).
   - Checks: `registrations` match the agentId + registry; `getAgentWallet` == the payTo account's EVM address; active; `hedera:testnet`; skill `parcel-inspection`; storefront reachable.
   - Reputation via `getSummary(agentId, clients, "starred", "")`.
   - Negotiation: RFQ to all valid sellers; counter at 75 % of list; accept the lowest expected total `price_move × EST_MOVES + price_photo × photos` within budget (tie → higher rating); decline the others with logged reasons.
   - Transcript sha256 + summary → audit topic via Agent Kit `submit_topic_message_tool`.
4. **Agent Kit** (`hedera-buyer`, `@hiero-ledger/sdk` 2.86.2):
   - custom tool `pay_x402_request` (extends `BaseTool`) wrapping each paid call;
   - `HcsAuditTrailHook(['pay_x402_request', 'submit_topic_message_tool'], auditTopic)`;
   - `RejectToolPolicy(['transfer_hbar_tool', 'transfer_fungible_token_tool'])`;
   - `MissionBudgetPolicy` (extends `AbstractPolicy`).
   - Read topic ids from `humanMessage` or the mirror (`raw` SDK objects don't survive JSON).
5. **Feedback after the mission:** `giveFeedback(A, score, 0, "starred", "inspection", endpoint, feedbackURI, keccak(file))`, with score = round(100 × paid photos ÷ wanted photos) and `proofOfPayment` = the last photo tx. It's an 8–12 s write, so it runs after `/end`, never in the loop.

**Acceptance tests**

| Test | Pass |
|---|---|
| Discovery | The buyer finds A and B from chain events alone; both cards verify; agentWallet == payTo for each (now different accounts) |
| Permissions (staticCall from real accounts) | Buyer edits A's card → "Not authorized"; A rates itself → "Self-feedback not allowed" |
| Negotiation | A accepts $0.015 + $0.06; B ends at list, "final"; chosen A; B's rejection reason logged; summary on the audit topic |
| Bait-and-switch | Run the shop once with `PRICE_FACTOR_TEST=1.5` (test flag, logged) → the buyer refuses before signing |
| Agent Kit | Every payment appears in the audit topic via the hook; a raw HBAR transfer attempt is blocked; overspend blocked by `MissionBudgetPolicy` |
| Full hero mission with discovery + negotiation | Completes with no keyboard input after start; feedback tx with proof of payment; `readFeedback`/`getSummary` read it back |

**As built (5 Nov):**
- ERC-8004 agents for Rover-A and Rover-B, Rover-B's account and the audit topic (pre-event ids in PRIOR_WORK.md; the event ids in `docs/rover/IDS.md`).
- The cards point at `http://localhost:8402/8403`.
- Rover-B is the storefront without `ROVER_URL`: A2A only, `/missions/*` → 503.
- Agent Kit 4.1.1 runs on SDK 2.86.2, while x402 keeps its pinned 2.85.0.
- The buyer CLI `hedera-buyer hire` does discovery, negotiation, the audit summary, the mission through `pay_x402_request`, and feedback.
- All acceptance tests passed (`prior-work/evidence/P7/summary.md`).

**Evidence:** `P7/`.

---

### Phase 8 — Claude Desktop integration (`services/mcp-server`)

**Goal:** you type the mission in Claude Desktop; everything after the one tool call is autonomous.

**Tasks**
1. `src/hedera/tools.ts`: register the §3.8 tools on the existing `McpServer`, calling `@0xBs/hedera-buyer`. The missions registry lives in process. Photos go to `~/.0xbs/missions/<id>/photo_<n>.jpg` and are returned as MCP image content.
2. `src/config.ts` reads `HEDERA_BUYER_ID/KEY`, topic ids and `ERC8004_FROM` from the package `.env`. Nothing secret ever appears in tool output.
3. Tool descriptions say plainly that `hire_rover` spends USDC autonomously up to the given budget.
4. Add `0xbs-devices` to `~/.config/Claude/claude_desktop_config.json` (it currently has no MCP servers), pointing at the absolute path of `services/mcp-server/dist/index.js`. Fully restart Claude Desktop.

**Acceptance tests**

| Test | Pass |
|---|---|
| Stdio smoke (real MCP client script) | 13 tools listed (8 existing + 5 new); `hedera_wallet_info` shows the right account; `find_rovers` returns A and B |
| Claude Desktop, prompt: "Find rovers and hire one to inspect parcel #3, 5 photos, budget $0.80" | One tool approval by you, then the mission runs to the end; `rover_mission_status` shows payments with HashScan links, roots and the photos as images |
| Long mission | Status polling works for the whole mission (no MCP timeout, because `hire_rover` returns at once) |
| Regression | The existing Base/Solana tools still work (P0 smoke re-run) |

**As built (5 Nov):**
- The tools are in `services/mcp-server/src/hedera/` and call `@0xBs/hedera-buyer`'s `hire()`, the same code as `hedera-buyer hire`.
- The server reads the buyer's `.env` in place, and mission budgets are capped at 1.00 USDC.
- zg-log serves `GET /records` for request ids.
- Claude Desktop ran a full mission from one prompt and one approval; all acceptance tests passed (`prior-work/evidence/P8/summary.md`).

**Evidence:** `P8/`: screenshots, the tool outputs.

---

### Phase 9 — HUD and public replay page (`apps/hud`, `apps/replay`)

**Goal:** a judge can watch a live run and later re-verify every decision from the public chain and storage, with no team server.

**Tasks**
1. **`apps/hud`** (local, `:8080`):
   - live frame, 0G decision (see / skill / reason), request id, latency;
   - three lease lights + face;
   - payment ticker (HashScan); latest storage root; HCS sequence.
   - The rover token is used only server-side (a Next.js route proxies the rover API and WS).
2. **`apps/replay`** (static export, deployed as a new Vercel project rooted at `apps/replay`):
   - Inputs: EpisodeLog address + rover address (the Galileo signer used by zg-log).
   - List episodes from `EpisodeStarted` filtered by rover.
   - Load segments over HTTPS `/file?root=`, then verify the record hashes, the chain and the image sha256s.
   - For each decision: `ethers.verifyMessage(text, signature)` == the on-chain `teeSignerAddress` read live from 0G mainnet `getService`. Badge "Private · TeeML · sealed · signature ✓".
   - Step through frames; link each move to its HashScan tx and each segment to chainscan.

**Acceptance tests**

| Test | Pass |
|---|---|
| HUD during a real mission | All panels update; lease lights follow the beats |
| Replay, deployed URL, opened on another network | Every record of the P6/P7 hero episode verifies; badges shown; links resolve |
| Tamper test | Verifier run on a real downloaded segment with one byte changed → that record fails, the others pass |
| CORS | Galileo RPC, 0G mainnet RPC, indexer and signature endpoint calls succeed from the deployed origin |

**Evidence:** `P9/`: the replay URL, screenshots.

---

### Phase 10 — Rehearsal and hardening

**Tasks and tests**
- 5 full hero runs from Claude Desktop on the phone hotspot (D13); **≥ 4 clean**. Log each run's time, moves, spend, safe stops and roots.
- Film every failure beat (`402`, `0G?`, `!TEE`, reflex, moved parcel).
- Battery: runs per charge, recorded. Power bank rundown with the full service running, recorded.
- Thermal with the heatsink over 5 back-to-back runs.
- Venue checklist (IMPLEMENTATION_PLAN §7.5 kit list); 0G provider and facilitator health check script for H0; re-run `camera_cal exposure` under the venue lighting.
- Run the self-calibration suite (Phase 10A) on the venue floor before the first run, and `--check` between runs.
- Optional, only if all of the above is green: "Schedule C" pipelining (next frame at ~60 % of the leg), with its own before/after measurement.

**Evidence:** `P10/`: the run table, clips.

---

### Phase 10A — Self-calibration suite (`rover/tools/calibrate.py`)

**Why:** the calibration is a hand-measured table from 5 Nov, and it can't tell when the floor changes. On 6 Nov, damp tiles after rain made the stock rubber tyres grip much harder. The same 85 % turn power that turned at 154°/s on 5 Nov reached only 81–106°/s, and 4 of 13 turns in one mission hummed in place for 12 s. The venue floor is unknown, and taping the rear tyres changes the grip again.

**Goal:** one command, run on any new floor (the venue on the morning of 7 Nov), that does the following:
- measures everything the rover's motion depends on, using only its own sensors: the IMU, the sonar, the wheel encoders, the battery sense and the camera;
- writes `rover/core/calibration.json` with the evidence behind every value;
- gives a pass/fail verdict.

No tape measure is needed; it is only an optional cross-check.

**Prerequisites**
1. **Wheel encoders mounted on both sides** (D2/D4). `enc.cpp` already counts edges; today `mm_per_edge_x100` = 0, so distance is time-based.
2. **Firmware:** every value the suite fits becomes settable at run time, so no reflash is needed. A new `set_cal2` command holds them, because `set_cal` is close to the 256-byte RPC limit:
   - the turn brake rule `TURN_BRAKE_K_X1000` / `TURN_BRAKE_Q_DIV`;
   - `TURN_KICK_PCT`;
   - `STALL_CDPS` / `STALL_MS`;
   - `REFLEX_BASE_MM`;
   - the sonar offset;
   - a per-side trim (% added to the slower side), for a gearbox that is stiffer than its partner.
3. **Firmware:** an encoder stall guard for drives (no edges for 400 ms while driving → `STOP_STALL`), like the turn stall guard (150de62). The yaw rate at the moment of braking is reported in `state`, so the suite can fit the brake rule.
4. **A setup the rover checks itself:** a flat target (a wall or a big box) 1.0–2.0 m straight ahead, with 50 cm clear all round. For S6b, a round target (a bucket) 45 cm ahead with about 1.6 m clear round it. The suite checks the target with the sonar before it moves, and refuses if it isn't there.

**Stages.** Every stage logs a JSONL line. A stage that fails stops the suite, and nothing is written to `calibration.json`. The suite also stops at once and writes nothing on any of these:
- an unplanned reflex stop;
- an IMU reset;
- the battery under 7.4 V;
- the board over 75 °C;
- the kill switch.

| Stage | Measures | How (sensors) | Pass / sets |
|---|---|---|---|
| S0 Preflight (no motion) | Firmware build, heartbeat, battery at rest, IMU, sonar, encoders, camera, board temperature, free space | 60 pings at the target; IMU bias and drift over 3 s (same limits as `steady_imu_cal`); encoders still at 0 | Battery ≥ 7.8 V (warn under), sonar 0 dropouts and spread ≤ 10 mm, IMU bias ≤ 5°/s and drift ≤ 0.5°/s, target 1.0–2.0 m |
| S1 Wiring, direction and free speed | Each side drives, the encoders sit on the right sides, spins go the right way; each side's free-running speed (stiff gearbox or bad contact) | 0.3 s pulses at 60 %: left side only, right side only, both, spin each way; encoder counts per side + IMU yaw sign. Then, wheels in the air, each side alone at 38 / 75 / 100 % for 2 s: encoder speed per side, plus the battery dip (`rover/tools/wheels_check.py`) | Names a dead or swapped motor, a dead or swapped encoder, or a reversed side. A side more than 10 % slower than the other at the same power is named, with the hint: less current too = a bad contact (front-left, 6 Nov), more current = a stiff gearbox (right side, 5–6 Nov) |
| S2 Power under load | Pack and wiring health | Battery low point at 30 / 60 / 100 % for 1 s, compared with the stored baseline | Sag at 100 % ≤ 0.8 V and low point ≥ cutoff + 0.3 V; a much larger sag than baseline flags a weak pack or a loose contact (the 6 Nov 0 V reading) |
| S3 Floor grip | The lowest power that starts a drive and a spin each way, and keeps a drive rolling | Ramp from 20 % in 5 % steps of 400 ms. Encoders show the wheels turn, IMU and sonar show the body moves: wheels turning while the body stays still = slipping | Sets `kick_pct`, `floor_pct`, `turn_pct` (start + 15 %, max 100) and `TURN_KICK_PCT`; warns "floor too grippy: tape the rear tyres or use the demo mat" when a spin needs more than 85 % to start |
| S4 Straight drive | `cruise_mm_s`, `mm_per_edge` per side, heading drift, `kp_x10`, a per-side trim, wheel slip | 3 × `drive_ms` at cruise towards the target: true distance from the sonar change (offset-free); edges per mm; IMU drift at kp 0 / 15 / 30; then `drive_cm(-20)` checked by the sonar | 3 drives agree within 5 %; drift < 3° per 50 cm with the chosen kp and per-side trim (the trim evens out a side that is stiffer at every speed); back-off 20 ± 3 cm |
| S5 Braking and sonar lead | Stopping distance at cruise, the reflex gap | `drive_until` with stop_mm 400, then 600, final gap vs asked; one reflex stop towards the target | Fits `sonar_lead_*` (used by `approach`); reflex gap ≥ 120 mm |
| S6 Turns | The brake rule for this floor | 15 / 30 / 45 / 90 / 135 / 180° each way × 2: yaw rate at braking + coast after braking; least-squares fit of coast = K × rate + rate² / Q | Then 10 random turns of 10–180° land within ±3° without a correction, with no stall |
| S6b Orbit circle (sonar only, no encoders needed) | The point the rover spins around, `pivot_behind_front_mm`, on this floor with these tyres. It sets the size of the circle an `orbit_leg` drives | A **round** target (a bucket, ~25–30 cm across) 45 cm ahead: a square box echoes only when a face is square to the sonar (6 Nov test: seen after 2 of 10 legs) with about 1.6 m clear all round. Its own command, `calibrate orbit --go`, because the setup differs. The mission's real `orbit_leg` code runs the legs. 5 legs at the current value; after each leg the sonar reads the gap straight ahead, and sweeps ±10° only when it misses (fewer turns: the L298N heats). Then 5 legs at a second value (100 mm more when the gap shrank, 100 mm less when it grew), the value where the gap stays flat is interpolated, and 5 more legs check it | Gap change ≤ 3 cm per leg over 5 legs; sets `pivot_behind_front_mm`. Why: the 120 mm fitted on 5 Nov with taped rear tyres (the rover spun near its front axle) made bare-rubber orbits spiral in 4–17 cm per leg on 6 Nov (one mission: 4 back-offs, photo 2 too close). Taping the tyres at the venue moves this point again. First test (6 Nov, square box): no inward spiral with 120 or 200 mm (+2.2 and +2.5 cm per leg on the 2 legs seen), so the value stays 120 until a round-target run; each leg turned 1–3° short of 36° |
| S7 Camera | Exposure, gain, white balance under this light; horizontal field of view | The camera's own start-up calibration (the one every mission runs) checks the light. Then 4 turns of 10° by the IMU (left, back, right, back); the middle of the picture before each turn is found in the picture after it (OpenCV template matching, sub-pixel). The middle, not the whole frame: a turn moves the edges of a picture about 20 % more than its middle. The lens sits in front of the point the rover spins round, so it swings sideways in a turn and a near wall moves further than the turn (8 % at 1.5 m); the sonar's distance to the wall corrects this | hfov within ±1.5° of 43.1° (else store the new value and warn); the 4 turns must agree within 1.5°, and a plain view with nothing to match fails. Exposure is not stored: every mission measures it again at its start |
| S8 Short soak (optional, `--soak`) | Stability over mixed motion | 3 min of turns and short drives | No stall, no IMU reset, battery low point recorded, board < 75 °C |

**Output**
- All stages pass: the new values go into `calibration.json`, and each `sources` entry gives the date, a place label (`--place venue`), the stage and the numbers.
- Any stage fails: the values go to `calibration.candidate.json` with the verdict, and `calibration.json` is left as it is.
- `--apply` (added 7 Nov): each stage that passes is written to `calibration.json` at once, then the next stage runs on it; a failed stage stops the run and keeps what passed before it. Its own numbers go to the candidate, for the record. A backup of the file from before the run's first write goes into the evidence folder.
- **At the venue**, on top of the full run made at home: `calibrate check --place venue --go` (under 1 min), then `calibrate run --stages S0,S3,S6 --apply --place venue --go` (about 4 min). The floor changes the grip (S3) and how far a turn coasts (S6); the rest belongs to the rover. Add S4 if `check`'s 30 cm drive is off by more than 3 cm (a smooth floor rolls further after a stop).
- Evidence goes to `evidence/CAL/<date>-<place>/`: one JSONL file per stage, plus `summary.md` with a table of value, old, new and evidence.
- The suite owns the motor bridge: it stops `rover.service` itself and starts it again at the end, and the service pushes the new calibration on start.
- A `--check` mode (S0, S1 pulses, 4 turns, 1 drive, under 1 min, writes nothing) to run between missions.
- `scripts/event-check.mjs` gains a row for the calibration's date and place, with a warning when it wasn't made today.
- Safety:
  - the suite asks for the operator's "go" once at the start and prints the space it needs;
  - every motion runs under the usual lease and heartbeat;
  - it never drives towards anything closer than 60 cm.

**Acceptance tests**

| Test | Pass |
|---|---|
| Two floors (tiles and a carpet or mat), then each floor's own calibration | The values differ between floors. On each floor: 10 random turns within ±3°, 5 × `drive_cm(50)` within ±3 cm (encoders, checked by the sonar), no stall |
| Same floor twice | Values within ±5 % of each other |
| Fault injection: one motor wire off; one encoder off; the IMU touched mid-run; the battery under the limit | S1 names the side; S1 names the encoder; the suite stops and writes nothing; S0 fails |
| Time | Full suite ≤ 5 min; `--check` < 1 min; one command over ssh |

**Evidence:** `CAL/`: per-floor stage logs and summaries.

---

**Status: ✅ done, 7 Nov 2026 (branch `p10a-cal`, merged into `rover`).** Guide: `docs/rover/CALIBRATION.md`.
- **Built:** `rover/tools/calibrate.py` (`run` S0–S7 with `--stages` and `--apply`, `check`, `wheels`, `orbit` for S6b), and
  `rover/tools/venue_cal.py`, the one command for the venue: S3, a 5-minute rest, S6. Firmware: `set_cal3` (turn brake K/Q,
  reflex base, sonar offset, side trim), `halt_info`, and the battery-sense safeguard (`batt.cpp`: the median of the last
  second; a reading under 4 V held out for 2 s). The board's `rover-usb-host` service keeps the camera's USB port in host
  mode. `deploy.sh` keeps the board's calibration.
- **Tested on the floor (home, 7 Nov):** S3 passed (a drive starts at 45 %; 45° turns finish at 65 % → turn power 80 %,
  kick 60 %, floor 25 %). S6 fitted K 44 / Q 659520 (rms 0.49° over 12 turns); the 6 check turns then landed within 1.6°,
  where the old rule landed 1–5° short. `wheels` passed on 7 Nov. The battery safeguard passed a wire-pull test.
- **Changed on the way:** S3 finds the turn power with real turns (a slow duty ramp held the wheels stalled for 6 s and
  spun nothing); S6 is one pass of 12 turns with 4 s rests and 6 checks (the L298N faded twice after ~30 turns); S4
  refuses to fit a wild overshoot (on a hot driver 30 cm drives went 43.8 cm). Drives are not re-measured at the venue:
  the encoders measure them (7 Nov, by tape: 30.0, 40.3 and 50.0 cm).
- **Not run on the floor:** S0's sonar rule (spread ≤ 10 mm) is too strict for this sonar at 1–2 m (single pings wander
  ~70 mm on a flat wall); S1, S2, S5, S7 and the S6b orbit were built and unit-tested but not run, and are not needed at
  the venue. The fix for heat is hardware: a fan or heatsink on the L298N.

### Phase 11 — Docs and submission

**Tasks**
- **README rover section:**
  - setup, architecture, the payment flow, and the HCS/ERC-8004/A2A roles;
  - the 0G proof note: "Private mode omits tee_verified by design; we verify every signature ourselves per 0G's independent-verification steps";
  - every contract address, agent id, topic id, README tx id, storage root and request id example;
  - `pcverify -gateway router-api.0g.ai` output;
  - related work (Paybot, Hands Unchained, RTP) and honest claims (Rover-B simulated; TEE = TeeML sealed inference).
- `AI_USAGE.md` (per file), `PRIOR_WORK.md` (accurate), `HARDWARE_PREP.md`, library licences.
- Video < 3 min: first 75 s the 0G loop, then payments on HashScan, beats, replay.
- Submission: "Finalist and Partner Prizes", partners 0G + Hedera, live demo link = the replay page, contract addresses, contacts.

---

### Phase 12 — Sensor station Station-A (second UNO Q, Hedera only)

**Why:** a second real body selling a different product (signed sensor data) through the same Hedera path: ERC-8004 discovery, x402 pay-on-success, spending controls and HCS logs. It shows the marketplace isn't rover-specific.

**Priority:** it runs alongside P10/P11 and never delays them. If behind, it is cut first, before item 1 of §7.

#### 12.1 Decisions (added 6 Nov)

| # | Decision |
|---|---|
| D15 | **Replaces D14.** The second UNO Q becomes **Station-A**, a sensor station that sells signed readings over x402 on Hedera testnet.<br>It targets the Hedera prize only: no 0G in its path, and it never shares hardware, wires or services with the rover.<br>Sensors: AHT20+BMP280 (temperature, humidity, pressure, plus a second temperature for a cross-check), LM393 LDR (relative light), HC-SR501 PIR (motion).<br>No breadboard. |
| D16 | **Fixed list prices, no negotiation:** `reading` $0.001; `motion` $0.0005; `history` $0.0002 per minute (1–60 min).<br>All are pay-on-success (x402 `authorization` flow), so a failed read costs nothing.<br>Buyer limits: $0.02 per station payment and $0.05 per MCP call. |
| D17 | **Every reading is signed on the station** with its own secp256k1 key: EIP-191 over the canonical JSON (§3.4). The signer address is in Station-A's ERC-8004 card.<br>The buyer rejects a reading that doesn't recover to that address, is older than 10 s, or has a `seq` that didn't increase.<br>Readings are integers only (D10). Light is a relative LDR level, never presented as lux. |

#### 12.2 Hardware (ordered on robu.in 6 Nov, ₹385, next-day delivery)

| Part | Gives |
|---|---|
| AHT20+BMP280 module **with soldering pin** (SKU R263951) | temperature ±0.3 °C and RH ±2 % (AHT20); pressure plus a second temperature (BMP280) |
| LM393 LDR module, 4-pin (VCC GND DO AO) | relative light on AO |
| HC-SR501 PIR | motion events |
| Male-to-female jumpers, 20 cm | the 10 wires below (the male-to-male pack is a spare) |

#### 12.3 Wiring (no breadboard; every sensor has its own pins; UNO Q datasheet ABX00162)

Hold the board with USB-C on the left:
- the top row (JDIGITAL), left to right: SCL SDA AREF GND D13…D8 | D7…D0;
- the bottom row (JANALOG), left to right: BOOT IOREF RESET 3V3 5V GND GND VIN | A0…A5.

| Sensor pin | UNO Q pin | Header pin | Wire |
|---|---|---|---|
| AHT20+BMP280 VIN | 3V3 | JANALOG 4 | red |
| AHT20+BMP280 GND | GND | JANALOG 6 | black |
| AHT20+BMP280 SDA | D20 / SDA (`Wire`, I2C2) | JDIGITAL 17 | blue |
| AHT20+BMP280 SCL | D21 / SCL | JDIGITAL 18 | yellow |
| PIR VCC | 5V | JANALOG 5 | orange |
| PIR GND | GND | JANALOG 7 | brown |
| PIR OUT (middle pin) | D2 | JDIGITAL 3 | green |
| LDR VCC | IOREF (the 3.3 V net, a few mA only) | JANALOG 2 | purple |
| LDR GND | GND (next to AREF) | JDIGITAL 15 | grey |
| LDR AO | A0 | JANALOG 9 | white |
| LDR DO | — | not connected | — |

Rules:
- **Only the PIR is on 5 V.** A0 must stay ≤ 3.3 V, and the module's I2C pull-ups must go to 3.3 V.
- **No I2C on A4/A5:** that port doesn't work in the current core (ArduinoCore-zephyr issue #301).
- **Keep the sensors ≥ 15 cm from the board.** The QRB2210 runs at 46–72 °C.
- **PIR settings:** jumper on H, time knob fully anticlockwise (≈3 s), 60 s warm-up.
- **Power:** a USB-C 5 V / 3 A wall charger, never the rover's bank.
- **No shared wires:** each sensor has its own GND.

#### 12.4 Processes and ports

| Process | Host | Port | Auth |
|---|---|---|---|
| `firmware/station_mcu` | UNO Q #2 MCU | Bridge RPC | — |
| `station` service | UNO Q #2 Linux, hostname `stationa` | `:8710` HTTP | `X-Station-Token` (`STATION_LAN_TOKEN`) |
| `station-keepalive` | UNO Q #2 Linux | — | the same unit as `rover-keepalive` |
| `hedera-shop` Station-A | laptop | `:8404` | public x402 + agent card; calls the station with its token |

New folders and files:
- `firmware/station_mcu/`: `station_mcu.ino`, `config.h`, `aht20.*`, `bmp280.*`, `pir.*`. Raw `Wire` register reads, no third-party libraries.
- `station/`: Python on UNO Q #2 (not a pnpm package): `bridge.py`, `sampler.py`, `sign.py`, `api.py`, `main.py`, `config.py`, `tools/station_check.py`, `systemd/station.service`.
- `services/hedera-shop/src/station.ts` (`SELLER=s`) and `scripts/setup-p12.ts` ← Hedera.
- `packages/hedera-buyer/src/sensors.ts` and the CLI `hedera-buyer sensor` ← Hedera.
- `services/mcp-server/src/hedera/`: the 3 sensor tools.

#### 12.5 Interfaces

**MCU Bridge:** `station_state()` returns integers only: `{t_aht_cc, rh_cpct, t_bmp_cc, p_pa, light_raw, motion_count, motion_last_ms, i2c_err, ok_aht, ok_bmp, uptime_ms}`.
- **As built (6 Nov):** it returns them as one comma-separated string in that order (like the rover's `state`), plus a 12th field `sample_ms`, the MCU time of the last sample where both I2C sensors read well. Linux uses it to prove a reading is less than 3 s old. A second call, `i2c_scan()`, lists the I2C addresses that answer, for the wiring check. A third, `bmp_info()`, reports the BMP280's chip id, registers and raw bytes.
- **Station-A's pressure is faulty (6 Nov).** The module's BMP280 (chip id 0x58 at 0x77) gives a good temperature, but its pressure ADC is stuck at full scale (raw 0xFFFFC at ×16 oversampling with the filter, 0xFFFF0 at ×1 without it), so the element is broken. Pavan chose to go on without it. A 13th field `ok_press` says whether pressure is valid (`p_pa` is 0 when it isn't). A bad pressure is not an I2C error, and the BMP280's temperature still cross-checks the AHT20. A working module switches pressure on by itself.
- First readings (6 Nov): I2C scan 0x38 + 0x77; AHT20 29.15 °C / 71.3 % RH, BMP280 29.47 °C (0.32 °C apart); light 442–509; 30 reads with `i2c_err` 0 and a sample age of at most 1.0 s.
- Units: centi-°C, centi-%RH, Pa, raw ADC counts.
- The MCU samples the I2C sensors once a second and counts PIR rising edges on D2 by interrupt.
- A failed I2C read sets `ok_*` false and increments `i2c_err`. It never serves an old value as a fresh one.

**Station HTTP API (`:8710`, `X-Station-Token`):**

| Call | Reply |
|---|---|
| `GET /reading` | the latest signed reading, or 503 if a sensor failed or the data is more than 3 s old |
| `GET /motion` | signed `{motion_count, motion_last_ms_ago, …}` |
| `GET /history?minutes=N` | signed samples, one per 10 s, from a 24 h ring buffer (N = 1–60) |
| `GET /health` | sensor flags, `i2c_err`, board temperature, uptime, signer address |

**Signed reading** (canonical JSON, §3.4):

```
{ v:1, station:"station-a", seq, t_ms, t_aht_cc, rh_cpct, t_bmp_cc, p_pa,
  light_raw, light_pct_x100, motion_count, motion_last_ms_ago,
  temp_agree,                 ← |t_aht_cc − t_bmp_cc| ≤ 150
  signer, sig }               ← EIP-191 over the canonical JSON without "sig"
```

**Storefront (`hedera-shop`, `SELLER=s`, `:8404`):**
- `GET /station/info`: free. Sensors, units, prices and the signer address.
- `GET /station/reading`, `GET /station/motion` and `GET /station/history?minutes=N`:
  - x402 `exact` on `hedera:testnet`, USDC `0.0.429274`, payTo Station-A;
  - the default `authorization` flow (pay-on-success);
  - `DynamicPrice` for history.
- `onAfterSettle` → an HCS station sales message `{v, seq, prev, type: reading|motion|history, tx, amount, payer, reading_hash}`.

**ERC-8004 card** (the §3.7 shape), with:
- `skills: ["climate-reading", "light-level", "motion-events"]`;
- `x402.price: {reading, motion, history_per_min}` and `x402.body: "arduino-uno-q"`;
- `signer: <station EVM address>`;
- `units: {temp: "centi-°C", rh: "centi-%RH", pressure: "Pa", light: "relative (LDR, uncalibrated)"}`.

**New MCP tools:**

| Tool | Spends? | Does |
|---|---|---|
| `find_sensors` | no | ERC-8004 discovery of stations (skill `climate-reading`), card checks (agentWallet = payTo, `signer` present, `hedera:testnet`), list prices, storefront reachability |
| `buy_sensor_reading` | yes, one payment ≤ $0.02 | `{kind: "reading"\|"motion"}` → pay, verify the signature and freshness (D17), return the values with units and a HashScan link |
| `buy_sensor_history` | yes, one payment ≤ $0.02 | `{minutes: 1–60}` → pay, verify every sample's signature, return the series with min/max/average and a HashScan link |

#### 12.6 Tasks

1. **Board prep (UNO Q #2):**
   - hostname `stationa`; the P0 task 8 checks (disk, `arduino-router` group, no App Lab default app);
   - Wi-Fi on the D13 hotspot, with the rover's 20 Hz keep-alive unit installed as `station-keepalive`.
2. **`firmware/station_mcu`:** raw `Wire` reads with no libraries, because Zephyr-core compatibility is unproven.
   - AHT20 at 0x38: calibration check (status bit 3, `0xBE 0x08 0x00` if unset); trigger `0xAC 0x33 0x00`; wait 80 ms; read 7 bytes; check CRC-8.
   - BMP280: chip id 0x58; read the trim registers; Bosch integer compensation (int32 temperature, int64 pressure). The address (0x76 or 0x77) comes from an I2C scan and is written to `config.h` with that scan output.
   - LDR: `analogRead(A0)`.
   - PIR: rising-edge interrupt on D2.
   - Bridge `station_state()` per 12.5.
3. **`station/` service** (Python, systemd, `User=arduino`, `SupplementaryGroups=arduino-router`):
   - a 1 Hz sampler and a 24 h ring buffer (one sample per 10 s);
   - a signer using `eth-account`, with the key from `/etc/0xbs-station.env` (mode 0600, never logged);
   - the 12.5 API.
   - `light_pct_x100` maps between the dark and bright counts measured in acceptance test 2, written to `config.py` with that evidence (ground rule 2).
4. **Hedera setup** (`services/hedera-shop/scripts/setup-p12.ts`):
   - create Station-A's own account from the buyer (as Rover-B in P7) and associate USDC;
   - create the station sales topic (submit key Station-A);
   - register Station-A in IdentityRegistry `0x8004A818…D9e` with the 12.5 card, then `setAgentURI` with `registrations`;
   - write every id to `IDS.md`.
5. **Storefront `SELLER=s`** (`src/station.ts`, reusing `payments.ts` for facilitator choice, failover and the HCS spool):
   - the 12.5 routes;
   - the handler answers 5xx whenever the station answers 503 or can't be reached, so a failed read is never charged.
6. **Buyer** (`packages/hedera-buyer/src/sensors.ts`):
   - discovery reuses `discovery.ts`, filtered on `climate-reading`;
   - card checks: agentWallet == payTo, `signer` present;
   - payments through `payer.ts` with the D16 limits;
   - after each payment: the D17 checks plus physical-range checks;
   - paid and refused entries go to the buyer spending topic;
   - CLI: `hedera-buyer sensor reading|motion|history --minutes N`.
7. **MCP tools:** `find_sensors`, `buy_sensor_reading` and `buy_sensor_history`.
   - The descriptions say plainly that the buy tools spend USDC: one capped payment per call.
   - The P8 tool count goes from 13 to 16.
8. **Optional, only if everything above is green:** after a rover hero mission, the buyer buys one station reading and adds it to the mission report as "conditions at inspection time".

**As built (6 Nov), tasks 4–7:**
- **Setup:** `node scripts/setup-p12.ts <stable buyer .env>` made Station-A's account, its sales topic and its ERC-8004 agent (pre-event ids in PRIOR_WORK.md; remade at the event, see `docs/rover/IDS.md`). All five checks passed (owner, agentWallet = payTo, card payTo, card signer, registrations). The ids are in `IDS.md`, the run in `P12/setup.json`. A copy of `.env.s` is in `~/0xbs-backups/` (0600).
- **Shop:** `SELLER=s node dist/index.js` in `services/hedera-shop`. A bad `minutes` gets a 400 before any payment is asked.
- **Payments code is shared:** `payments.ts` now takes the routes and an "on settled" step from each seller, so the rover shop and the station shop use the same facilitator choice and failover. The rover's prices moved into `shop.ts` unchanged. A rover mission still has to run on this code before the merge.
- **The "seq went up" rule, as built:** the station's `seq` starts again at 1 when its service restarts. So the buyer compares `(t_ms, seq)`: a value is new if its `t_ms` is later, or the same `t_ms` with a higher `seq`. Inside one run both only go up; after a restart `t_ms` is later. Tested: seq 13 after a restart was taken, after seq 81 before it.
- **A spend-cap refusal is a refusal:** x402 checks its own cap before our policy runs and throws. The payer now reports that as "refused" and logs it to the spending topic, not as a lost request.
- **MCP:** the three tools are on the local server only (`registerSensorTools` in `index.ts`), never on the remote one. One sensor call runs at a time, and none while a rover mission is running, so the buyer's HCS chain has one writer.

#### 12.7 Acceptance tests (real sensors, real testnet)

| Test | Pass |
|---|---|
| I2C scan + 10 min of sampling at 1 Hz | AHT20 at 0x38 and BMP280 at 0x76/0x77 found; 600/600 samples; `i2c_err` = 0 |
| Physics | Breath on the AHT20 → RH up ≥ 10 points within 10 s, back down within 5 min. Hand over the LDR → light changes by ≥ 50 % of its range. A wave at the PIR → `motion_count` +1 within 1 s. Over 10 min: \|t_aht − t_bmp\| ≤ 1.5 °C and pressure within 850–1080 hPa |
| Sensor fault | SDA wire pulled → `/reading` 503 within 3 s and `ok_aht` false; recovers when the wire is back |
| Signature | The `/reading` signature recovers to the station address; one changed byte → it fails |
| Unpaid `/station/reading` | 402; `PAYMENT-REQUIRED` decodes to `exact`, `hedera:testnet`, `0.0.429274`, payTo Station-A, amount 1000 |
| Buyer CLI buys a reading, motion and 10 min of history | 3 settled txs (HashScan); history price = 10 × 200 atomic; 3 HCS sales messages, chain intact; every signature verified |
| Failed read | Station service stopped → shop 5xx → the buyer's USDC is unchanged on the mirror |
| Limits | Shop price raised to $0.05 with the P7 test flag → the buyer refuses before signing |
| Discovery | `find_sensors` finds Station-A from chain events alone; `find_rovers` still marks only Rover-A and Rover-B as usable rovers (it lists every agent on the shared registry; Station-A must not pass the rover checks) |
| Claude Desktop | "What's the temperature and humidity at the station?" → one approval → paid, verified values and a HashScan link. The rover tools pass the P8 smoke test |
| Soak | 30 min, buying once a minute: no I2C error, board < 75 °C, keep-alive RTT as in D13 |

#### 12.8 Environment variables (add to §5 and to `turbo.json` `globalEnv`)

| Where | Variables |
|---|---|
| Board #2 `/etc/0xbs-station.env` | `STATION_SIGNER_KEY`, `STATION_LAN_TOKEN` |
| `services/hedera-shop/.env.s` | `SELLER=s`, `PORT=8404`, `HEDERA_STATION_ID`, `HEDERA_STATION_KEY`, `HCS_STATION_TOPIC`, `STATION_URL`, `STATION_LAN_TOKEN`, `STATION_SIGNER_ADDRESS`, `PUBLIC_URL`, prices |

**As built (6 Nov):** the board's file is `/home/arduino/0xbs-station/station.env` (0600) with `STATION_PRIVATE_KEY` and `STATION_LAN_TOKEN`. `.env.s` has `STATION_URL`, `STATION_LAN_TOKEN`, `STATION_SIGNER`, `HEDERA_STATION_ID`, `HEDERA_STATION_KEY`, `HCS_SALES_TOPIC`, `SHOP_NAME`, `PORT`, `PRICE_READING`, `PRICE_MOTION`, `PRICE_HISTORY_PER_MIN` and `ERC8004_AGENT_ID`. `SELLER=s` is given on the command line. The MCP limits are `STATION_MAX_PAYMENT_USDC` (0.02) and `STATION_CALL_BUDGET_USDC` (0.05).
| `services/mcp-server/.env` | `STATION_MAX_PAYMENT_USDC`, `STATION_CALL_BUDGET_USDC` |
| Setup scripts | `HEDERA_STATION_*` |

#### 12.9 Honest claims (README)

- Light is a relative LDR level, not lux.
- On mainnet the facilitator's fee (≈0.014 HBAR per settle) is larger than a $0.001 reading. Per-reading prices are a testnet demo; history bundles are the realistic product.

#### 12.10 Status

| # | Task | Owner | Note |
|---|---|---|---|
| 30 | Parts arrive | Pavan | Ordered 6 Nov, ₹385, next-day delivery ✅ |
| 31 | Wire per 12.3 and photograph it for `P12/` | Pavan | 10 wires ✅ (photo marked done by Pavan, 7 Nov) |
| 32 | Prepare board #2 (hostname, keep-alive, router group) | Pavan + Claude | ✅ `stationa`, keep-alive, SSH from the laptop works (7 Nov) |
| 33 | Build tasks 2–7 | Claude | Done 6 Nov on branch `p12-station`. A rover mission on that code passed 7 Nov (3/3 photos, `prior-work/evidence/P12/premerge_mission_7nov`), then it was **merged into `rover` on 7 Nov (3a6924e; undo tag `pre-p12-merge` = c2411f7)**. Render redeployed by hand; `rover-shop-s` now runs from the main folder |
| 34 | Run the acceptance tests and save the evidence | Pavan + Claude | ✅ 7 Nov: all of §12.7, `P12/station_tests_7nov.md`; light scale 758 (dark) to 30 (bright); tag `rover-p12` |

**Evidence:** `P12/`: the scan output, sample logs, physics clips, a photo of the wiring, tx ids, the topic id, the agent id and MCP screenshots. Tag `rover-p12`.

### Phase 13 — Hybrid remote MCP: anyone's Claude can hire the rover (branch `p13-remote`)

**Why:** anyone adds one link to Claude Desktop as a custom connector, or to another MCP client that supports remote servers, and hires Rover-A. The rover's safety link stays on the local WiFi, so a poor network only makes a mission slower.

**What changed (6 Nov):** the first design put the shop in the cloud. Its go/no-go gate failed: from free Render, the money heartbeat had a longest gap of 709 ms and 2.25 % of gaps over 500 ms (13.7). So in the hybrid **only the MCP server is in the cloud**. The shop, the 0G logger, the HUD and the rover stay at the booth, exactly as today.

**Priority:** an extra, never a risk. The event demo is the stable setup unless the hybrid passes every test in 13.6. One command (or one click) switches between the two (13.2).

#### 13.1 Decisions (added 6 Nov)

| # | Decision |
|---|---|
| D18 | **Separate and reversible.** Phase 13 lives on branch `p13-remote`, in its own folder `../0xBs-p13` (a git worktree), and in the private repo `Pavankumar07s/rover-for-hire`. Branch `rover`, the main folder that runs the five laptop services, the rover board and the firmware never change for Phase 13. Tag `pre-p13` (536e815) marks the last good state. |
| D19 | **Hosting: one free Render web service, `rover-for-hire`, kept awake by UptimeRobot** (a check every 5 min). From render.com/docs/free, read 6 Nov: 750 free hours a month per workspace, shared by all free services; no disk, files lost on restart; Render can restart a free service at any time. So there is one service. **As built (6 Nov):** Render allows only one free Postgres per workspace, and that slot is already used by another project (`sewasetu-db`, which expires 7 Nov). So the state lives in a free **Neon** Postgres instead: Singapore (AWS ap-southeast-1), 0.5 GB, no expiry. Its address is `P13_DATABASE_URL`, in `scripts/p13/.env` (saved with `scripts/p13/set-db-url.sh`) and in Render's settings. Secrets go only into Render's environment settings (ground rule 4). |
| D20 | **Only the MCP server is remote.** The shop's 250 ms money heartbeat to the rover stays on the local WiFi in every mode. Across the internet go only: Claude ↔ the MCP server, and the MCP's buyer → the shop, once per move or photo (a slow call means a slower move, never a lapse). |
| D21 | **Two modes, one switch, and the stable shop is never touched.** **Local** (the default) is exactly today. **Hybrid** adds two Phase 13 pieces on the laptop: `p13-edge`, a filter in front of the stable shops (D22), and `p13-tunnel`, which exposes only that filter. The stable shops, zg-log, HUD and rover run unchanged in both modes, and the local Claude Desktop MCP works in both. (Changed 6 Nov after reading the code: the shop writes its own `PUBLIC_URL`, `http://localhost:8402`, into its agent card and mission links. Making that public would push local missions over the internet. So the remote buyer translates `localhost:8402` to the tunnel's address instead, and the shop needs no copy and no change.) |
| D22 | **Remote protections, in `p13-edge`.** Through the tunnel, `/rover-a/*` reaches shop A (:8402) and `/rover-b/*` reaches the Rover-B sim (:8403), but only on the public routes: the A2A card and negotiation, `GET /missions/:q/status`, and the paid `POST /missions/:q/move` and `/photo/:n`. `POST /missions/:q/start` and `/end` also need the server key `P13_EDGE_KEY`, held only by the laptop and Render, because quote ids are public on the live page. `/zg/*` gives read-only `GET` access to zg-log, for the report. Everything else gets 404. One mission at a time is already enforced: the rover answers "a mission is already active" and the shop passes that to the buyer. |
| D23 | **Remote money and identity are separate from the stable ones.** The remote MCP pays from its own buyer account, with the usual per-payment and per-mission caps and a daily cap for the whole server (testnet USDC). Access needs a key per user (a bearer token, or OAuth if Claude's connector asks for it). Remote buyers find the rover through a separate ERC-8004 agent whose card points at a stable Render address, `/rover-a`, which forwards to the laptop's current tunnel. Rover-A's and Rover-B's cards never change. |

#### 13.2 The switch

| | Local (stable, default) | Hybrid |
|---|---|---|
| Shops, zg-log, HUD, rover | the stable ones | the same stable ones, untouched |
| `p13-edge` + `p13-tunnel` | off | on; public routes only (D22) |
| Your local Claude Desktop MCP | works | works |
| Remote connector | answers "rover offline: the owner switched remote access off" | can hire the rover |

- **One command:** `scripts/p13/mode.sh local|hybrid|status` on the laptop. `hybrid` starts `p13-edge` and `p13-tunnel`, then tells the Render service the tunnel's address (owner key). `local` tells Render that remote access is off, then stops both.
- **One click:** a desktop launcher, "Rover: remote access", runs `mode.sh` to toggle and shows a notification with the new mode.
- **If the script itself breaks,** one line does `local` by hand: `systemctl --user stop p13-tunnel p13-edge`. Both Phase 13 parts are systemd user units that are never enabled at boot, and nothing stable was stopped, so nothing needs starting again.
- **A laptop reboot always comes back local:** only the stable units start at boot.
- **Choosing which MCP your own Claude uses:** keep both installed. In a chat, switch on either the remote connector or the local `0xbs` server in the tools menu, not both, so Claude never picks between two sets of the same tools. Turning the remote connector off is enough to use only your local MCP.
- **Giving up on Phase 13:** `mode.sh local`, remove the connector, suspend the Render service. Everything is then exactly the stable setup.

#### 13.3 Cloud service (`https://rover-for-hire.onrender.com`)

| Path | Does |
|---|---|
| `/mcp` | the MCP server over Streamable HTTP: the P8 tools, the key check, the caps (D23) |
| `/owner/tunnel` | `mode.sh` sets or clears the laptop tunnel's address here (owner key). The remote buyer sends its shop calls there: `http://localhost:8402` becomes `<tunnel>/rover-a`, `:8403` becomes `<tunnel>/rover-b`, and zg-log's address becomes `<tunnel>/zg`. It adds `P13_EDGE_KEY` to those calls only. |
| `/health` | what UptimeRobot checks every 5 min |

The remote buyer keeps the same mission files as the local one (`mission.json`, the photos, `report.md`). Render has no disk that lasts, so every file is also copied into the Neon Postgres and copied back when the service starts (D19). A copy that fails (Neon unreachable) is tried again every 30 s until it lands. `/health` shows `copy: postgres` while this is working. The tunnel's address is kept there too, so a restart doesn't switch remote access off. The daily cap is read from the mission files themselves: a running mission holds its whole budget, and a finished one only what it spent, so unused budget is released when a mission ends (changed 6 Nov evening, after the first two remote missions had booked 1.80 of 2.00 while spending 0.705).

**What a restart can't do:** a mission that is running when the service restarts can't carry on. Its payments stop, so the rover stops by itself within the money lease, and the mission shows "interrupted". That is the same rule the local MCP has always had when Claude Desktop restarts. Everything already paid for (moves, photos, records on 0G) stays.

#### 13.4 Tasks

1. **`mcp-server` over HTTP:** add Streamable HTTP next to stdio (stdio stays the default, so the local entry is unchanged), the per-user key, the daily cap and state in Postgres.
2. **`p13-edge`:** the D22 filter (Node, standard library), listening on 127.0.0.1; a `p13-edge` systemd user unit, not enabled at boot.
3. **Laptop tunnel:** `cloudflared` in the Phase 13 folder, run by a `p13-tunnel` systemd user unit that is not enabled at boot, pointing only at `p13-edge`. The HUD, the shops' other routes and the rest of the laptop are never exposed.
4. **Render:** `/mcp`, `/owner/tunnel`, `/health`; the Neon Postgres (D19); the UptimeRobot monitor.
5. **Chain setup for remote** (`scripts/p13/setup.ts`): the remote buyer account and its USDC, and the remote agent registration pointing at `/rover-a`. Check first that a second agent can name Rover-A's account as its wallet; if not, the remote MCP is given the storefront address directly. Every id goes to `IDS.md` under a Phase 13 heading. **As built (6 Nov):** no second registration was needed. The remote server reads Rover-A's card as it is and sends its `localhost` storefront address through the tunnel (13.3), so that card never changes. The remote buyer is made by `services/hedera-shop/scripts/setup-p13-buyer.ts`.
6. **`mode.sh` and the desktop launcher.**
7. **Optional, only if 1–6 pass 13.6:** a "list your device" page on the replay site. It builds an ERC-8004 card and the owner signs the registration with their own wallet. Hosting other people's storefronts is after the event.

#### 13.5 What a poor network does in hybrid mode

| Link | On a poor network |
|---|---|
| someone's Claude ↔ `/mcp` | tool calls take longer |
| remote buyer → shop, once per move or photo (through Render and the tunnel) | each payment takes longer, so moves come slower; "no pay, no move" still holds |
| rover → 0G, once per step | slower steps; a timeout is a pause, and the mission carries on |
| zg-log → 0G Storage | the record lags; the upload self-repair restarts a stuck upload |
| **shop → rover heartbeat, 4 a second** | **local WiFi, unaffected** |

A very poor network can make a mission run into its time limit. A reply lost after a payment settled can at most mean one move paid early, never an unpaid move. The tests check exactly how the code behaves here.

#### 13.6 Acceptance tests (real rover, real networks)

| Test | Pass |
|---|---|
| Switch | `mode.sh hybrid` → a remote mission; `mode.sh local` → a local mission like the 6 Nov runs; after `local`, no `p13-edge` or `p13-tunnel` process is running, the stable units never restarted, and the connector says the rover is offline |
| One click | the launcher toggles the mode and the notification shows it |
| Remote mission | from the connector on another network (a phone hotspot that isn't the rover's): 5/5 photos; every decision TEE-verified, every payment settled, every step anchored; the replay verifies it |
| Poor network | on the laptop, `tc netem` adds 300 ms and 2 % loss for a whole remote mission → it completes, every move paid before it ran, nothing lost, only slower. Then 800 ms and 5 % loss, to find where it breaks, and write that down |
| Security | from the internet: `start`/`end` without `P13_EDGE_KEY` → 403; paths outside D22 → 404; non-GET to `/zg` → 404; the HUD and the laptop's other ports aren't reachable |
| Busy | a remote hire while a local mission runs → "rover busy"; the local mission isn't disturbed |
| Caps | over the per-mission cap, and past the daily cap → refused before signing |
| Render restart | restarted mid-mission → the rover stops by itself (no payment, no move) and the mission shows "interrupted"; after the restart, every paid photo, every finished mission's report, the remote-access switch and the day's cap total are all still there |
| Stays awake | 24 h with UptimeRobot: no sleep page; the dashboard shows about 24 instance hours used |
| Isolation | after remote missions: Rover-A's card unchanged; the local buyer account sent nothing |
| Reboot | laptop rebooted in hybrid mode → comes back local |

#### 13.7 Gate history (6 Nov)

The first design (the shop in the cloud) was gated on the money heartbeat crossing the internet: `prior-work/evidence/P13/gate_7nov.md`. From free Render, 10 min: 2,394/2,396 heartbeats, longest gap 709 ms, 2.25 % over 500 ms. The rule was under 700 ms and at most 1 %, so it was a no-go, and that is why the hybrid keeps the heartbeat local. The test receiver on the rover (`~/0xbs-rover-p13`) and the sender on Render (`scripts/p13/gate`) stay as evidence; the hybrid doesn't need anything on the rover.

#### 13.8 Status

| # | Task | Owner | Note |
|---|---|---|---|
| 35 | Decide to build the hybrid (after the video and public-repo items are safe) | Pavan | ✅ Decided 6 Nov |
| 36 | Render free account, UptimeRobot free account | Pavan | ✅ Done 6 Nov: `rover-for-hire.onrender.com` is live; the UptimeRobot monitor goes on `/health` |
| 37 | Heartbeat gate for the cloud-shop design | Pavan + Claude | ✅ Done 6 Nov: no-go (13.7), so the hybrid |
| 38 | Tasks 1–6 | Claude | 6 Nov: the HTTP server, keys, daily cap, edge, tunnel unit, `mode.sh`, launcher and remote buyer are built. Render has been live since 18:57 (401 without a key; 5 tools; remote buyer). Then: remote `find_rovers` ✓ Rover-A/B through the tunnel; the 13.6 security probes pass. Fixed before the first remote mission: saved missions were reloaded on every request (a running mission would have shown "interrupted"); missions are now per user key; a busy refusal no longer counts against the cap. The Neon copy passed a real test: a failed copy is retried, a restart on an empty disk restores every file byte for byte, and the tunnel and cap total survive |
| 39 | Acceptance tests 13.6 | Pavan + Claude | 6 Nov evening, from ChatGPT through Render (`prior-work/evidence/P13/remote_missions_7nov.md`). **Passed:** remote mission (5/5 in 172 s, 14 moves, 0.51 USDC, verify-episode pass), security probes, Render restart (switch, files and cap survive), isolation (stable buyer sent nothing), and two 25 s outages made on purpose. Fixed on the way: a blip ended the buyer; a photo whose reply was lost was miscounted; the cap counted budgets, not spend; ChatGPT ended a mission by itself on a pause; a 3 s storefront timeout on a weak network. **One click and switch-back (20:53):** the launcher switched to local and the notification said so; Render went `remote_access: false`; remote `find_rovers` showed both rovers unusable; no Phase 13 process was left; the stable units did not restart. The local Claude Desktop mission after it (stable buyer, all 19 payments settled) was stopped by Pavan at 1 of 3 photos because the wheels could not turn on a floor still damp from the evening rain. The wheels-up test afterwards was clean (8 stretches, no stops, dips 170–227 mV, battery 8.41 → 8.36 V), and every wheel turned fine. **6 Nov (`prior-work/evidence/P13/hybrid_tests_7nov.md`):** local mission on the merged code ✅; caps on Render live ✅; busy ✅ (safe; a 502 HTML page was replaced by a readable 409, d4d0e7e); Render restart mid-mission ✅ (the interrupted mission is now ended on the shop, 2289df7; the cap and the status use the shop's paid count, b1889c4); poor network ✅ at 300 ms/2 %, and 800 ms/5 % is the breaking point (time limit with 1/3, every payment settled, record complete). Reboot ✅ (laptop back local; Render drops a dead tunnel after 3 failed checks, 6dd66a6, flipped at 11:16:10). UptimeRobot is set up (Pavan). **Still to do:** read the 24 h awake result on 7 Nov |
| 40 | List-your-device page (task 7) | Claude | optional |
| 41 | Merge Phase 13 into `rover` | Claude | ✅ 6 Nov 23:20, no conflicts. Before it: tag `pre-hybrid-merge`. Checks: build 3/3, edge tests 4/4, and a read-only smoke test of the local stdio MCP (13 tools, the stable buyer, ✓ Rover-A and ✓ Rover-B through the local shops). Remote access stays off until the launcher is clicked. **Undo:** `git reset --hard pre-hybrid-merge`, then `pnpm install --frozen-lockfile && pnpm turbo run build --filter=@0xbBs/mcp-server...`, then restart Claude Desktop. **Done 6 Nov:** Claude Desktop restarted on the merged build; the `0xBs-p13` worktree retired (`git worktree remove`), with the p13 units, the launcher (new file name `rover-for-hire-remote.desktop`) and the gitignored `scripts/p13/.env`, `.env.buyer` and `bin/cloudflared` now in the main folder; Render switched to branch `rover` (ff4c149 live). **Render no longer deploys on push** since the repo was recreated: trigger each deploy through the API, and put the buildFilter back after any repo reconnect. 6 Nov: the local mission on the merged code passed (5/5 in 149.9 s, 15 moves, verify-episode pass; `prior-work/evidence/P13/hybrid_tests_7nov.md`) |
| 42 | Delete the gate-test leftover `~/0xbs-rover-p13` on the UNO Q | Claude | ✅ Deleted 6 Nov 10:1x (37 MB: bin, gate, gate.env), after checking that nothing ran from it; `~/0xbs-rover` untouched. Before: The hybrid doesn't use it and never touches the UNO Q. First check that nothing runs from it, then `rm -rf ~/0xbs-rover-p13`. `~/0xbs-rover` is never touched |

## 5. Environment variables (names only; values in gitignored env files)

| Where | Variables |
|---|---|
| Board `/etc/0xbs-rover.env` | `ZG_API_KEY`, `ZG_NETWORK=mainnet`, `ROVER_LAN_TOKEN`, `ZG_LOG_URL`, `ZG_LOG_TOKEN`, `ROVER_TEST_MODE` (unset in demos) |
| `services/zg-log/.env` | `ZG_PRIVATE_KEY`, `EPISODE_LOG_ADDRESS`, `ZG_LOG_TOKEN`, `PORT=8787` |
| `contracts/episode-log/.env` | `ZG_PRIVATE_KEY` |
| `services/hedera-shop/.env.a` | `SELLER=a`, `PORT=8402`, `HEDERA_ROVER_ID`, `HEDERA_ROVER_KEY`, `HCS_MONEY_TOPIC`, `ROVER_URL`, `ROVER_LAN_TOKEN`, `ZG_LOG_URL`, `PUBLIC_URL`, prices/floors |
| `services/hedera-shop/.env.b` | `SELLER=b`, `PORT=8403`, `HEDERA_ROVER_B_ID`, `HEDERA_ROVER_B_KEY`, `PUBLIC_URL`, prices |
| `services/mcp-server/.env` | existing vars + `HEDERA_BUYER_ID`, `HEDERA_BUYER_KEY`, `HCS_SPEND_TOPIC`, `AGENTKIT_AUDIT_TOPIC`, `ERC8004_FROM`, `EST_MOVES` |
| Station board `/home/arduino/0xbs-station/station.env` (Phase 12) | `STATION_PRIVATE_KEY`, `STATION_LAN_TOKEN` |
| `services/hedera-shop/.env.s` (Phase 12) | `HEDERA_STATION_ID`, `HEDERA_STATION_KEY`, `HCS_SALES_TOPIC`, `STATION_URL`, `STATION_LAN_TOKEN`, `STATION_SIGNER`, `ERC8004_AGENT_ID`, `SHOP_NAME`, `PORT=8404`, `PRICE_READING`, `PRICE_MOTION`, `PRICE_HISTORY_PER_MIN`; `SELLER=s` comes from the `rover-shop-s` unit |
| MCP server process (Phase 12) | `STATION_MAX_PAYMENT_USDC` (default 0.02), `STATION_CALL_BUDGET_USDC` (default 0.05) |
| Setup scripts | `HEDERA_BUYER_*`, `HEDERA_ROVER_*`, `HEDERA_ROVER_B_*`; `setup-p12.ts` takes the stable buyer's env file as its argument |

All of these names are added to `turbo.json` `globalEnv` in P0. The Phase 12 names that run on the laptop are in its `globalPassThroughEnv`; the station board's are not, because the board runs Python, outside turbo.

---

## 6. Deferred work (after the rover flow ships)

1. device-controller: settle before actuating, or lock the payment nonce (Base/Solana double-move with one payment).
2. device-controller off Vercel serverless; Redis for presence, caches and rate limits.
3. One CRUD implementation (web currently writes Prisma directly); web service edit; `walletChain` switch validation.
4. MCP: `Idempotency-Key` on Base/Solana calls; remove `import_wallet`'s key-through-model path.
5. ESP32 SDK: busy flag / no nested handlers, reqId dedupe, TLS verification on by default.
6. auth-controller rate limiting by real client IP; simulations scripts; `status` topic; x402-gateway CDP auth header and `PAY_TO`.
7. Rover storefront also accepts Base/Solana (register EVM/SVM schemes with the CDP facilitator), after Hedera + 0G work end to end (D8).
8. Optional: list the rover in the 0xBs console and `/public/devices`.

## 7. Cut order if behind (from IMPLEMENTATION_PLAN §6)

1. Agent Kit tool + hook (keep the x402 hooks → HCS).
2. A2A counter-offer.
3. ERC-8004 feedback.
4. Rover-B.
5. Browser signature re-check on the replay page.
6. Orbit.
7. 5 photos → 3.
8. Buyer spending topic.

**Never cut:**
- a 0G decision driving every motion, with our own proof check;
- a request id per decision on 0G Storage, anchored in EpisodeLog;
- the safe stop;
- leases + watchdog + kill switch;
- at least one autonomous x402 payment settled on Hedera;
- the README tx id.

## 8. Known gaps from the pre-event evidence, and where each is closed

| Gap (found 5 Nov) | Closed in |
|---|---|
| Sonar never validated at 20–100 cm (final bench run 4/6 FAIL; 30 cm never clean) | P1 test 4 |
| IMU gravity check FAILED under its original criterion (0.891 g) | Heading uses only the gyro; P1 tests 7–8 validate turns directly |
| Encoders untested; `bench/unoq3/motor_test.py:140` still flips the left side | P1 test 11 uses the new firmware/tool, not the stale bench script |
| Bench proof check didn't enforce TeeML / TargetSeparated or pin the provider | P3 `proof.py` / `brain.py` |
| One 5.28 s signature fetch vs the 2 s timeout | P3 latency test sets the timeout from data |
| 0G only tested on generated images, never from the UNO Q | P3 |
| ERC-8004 → A2A endpoint resolution mocked to localhost; card said A2A 0.3.0 | P7 (real card URLs, version "1.0") |
| Both bench agents shared one account | P7 (Rover-B's own account) |
| Segments with full-size images never uploaded | P4 size/time test |
| Money lease never run on hardware | P5–P6 |
| EpisodeLog ids can be squatted | Episode ids are random 32 bytes; replay filters by rover address (P9) |
| L298N 5 V under stall unmeasured (no multimeter) | Not measured; mitigated by the 7.0 V motion cutoff on A0 (P1 test 13) |

## 9. What is left (status on 6 Nov 2026)

**Where things stand (6 Nov 2026, 15:05).** The whole flow works end to end on the real rover and the real networks, and it has been rehearsed. On 6 Nov afternoon five 5-photo missions on unchanged code were all clean: 25 of 25 photos, including a start facing away and a different box (#1). After three small changes the best runs are:
- **5 photos:** 136.8 s, 15 moves, 0.525 USDC;
- **3 photos:** 86.4 s, 12 moves, 0.36 USDC, no pauses.

The three changes were photos 30° apart, a first approach checked against 0G's reading, and a quick 90° look each side when the parcel is lost mid-orbit. Every decision is TEE-verified, every payment settled, every step anchored on 0G. Rover-A's ERC-8004 rating is 89/100 from 41 reviews.

The software that reached this: rover code b5700f5, prompt v6.1, firmware flashed from 7bd19c1, zg-log with the upload self-repair, which recovered a rejected 0G storage payment on its own in one run. Full story and tables: `prior-work/evidence/P10/runs.md`. Phases P0–P8 are tagged; P9 is built and live-tested; P10 is rehearsed.

**Submission deadline: Sat 7 Nov 2026, 09:00 IST.**

Owner: **Pavan** = needs hands, a password, a decision or an OK; **Claude** = code and docs, run on request.

**ETHGlobal's finalist rules (mail of 6 Nov), all four required:**
1. **Live deployment** anyone can open (a video or slides don't count): https://rover-replay.vercel.app. Checked 6 Nov: it fully verified the best pre-event run (10/10 segments, 46/46 TEE signatures, 34/34 moves paid first, 51/51 steps). The hiring itself needs the physical rover, so the live link is the public record and re-checker of every real mission.
2. **Demo video** on the project page: 2–4 minutes, at least 720p, **audio without music** (the script now says voice-over only).
3. **Every required field** of the submission form.
4. **Public GitHub repository** (see 9.1).

### 9.1 Before the repo goes public (must do)

| # | Task | Owner | Note |
|---|---|---|---|
| 1 | Delete the two old 0xBs device keys (ESP32 car `3b7f9aa5…`, LED board `8e10c33f…`) from the prod EMQX broker, then re-run `services/device-controller/scripts/check-broker-auth.mjs` | Pavan | Deferred since 5 Nov |
| 2 | Scan the repo and its whole history for secrets | Claude | Before any push ✅ Done 6 Nov: whole history scrubbed (5 bs_ keys, the hotspot password, the seed password), all versions re-scanned |
| 3 | Push the `rover` branch and the tags to GitHub | Pavan's OK | Today nothing of the rover work is on any remote ✅ Done 6 Nov: github.com/Pavankumar07s/rover-for-hire (private), clean rewritten history |

### 9.2 Hardware

| # | Task | Owner | Note |
|---|---|---|---|
| 4 | Solder the front-left motor wires (motor tabs + the L298N left output) | Pavan | It drew ~30 % less current on 6 Nov; the contact comes and goes |
| 5 | Make the UNO Q header wiring solid (battery-sense divider, gyro power, shared GND) | Pavan | A loose shared wire caused false battery readings and gyro resets on 6 Nov |
| 6 | A drop of oil on the left gearboxes | Pavan | Drives pull 2–3.5° left since only the right side was oiled ✅ Done 6 Nov 05:30, plus run-in |
| 7 | Mount the wheel encoders | Pavan | When they arrive; needed for 10A |
| 8 | Event kit: spare TT motor, 5 A fuses, adhesive PTFE + PVC tape, soldering iron, 2S charger, full power bank | Pavan | See HARDWARE_PREP "Packing" |

### 9.3 Calibration

| # | Task | Owner | Note |
|---|---|---|---|
| 9 | Build the self-calibration suite (Phase 10A, `rover/tools/calibrate.py`) and its firmware prerequisites (per-side trim and turn brake K/Q in `set_cal2`, encoder stall guard) | Claude | ✅ Done 7 Nov (see Phase 10A status). At the venue: `venue_cal --go --place venue` |
| 10 | On the venue floor: tape on or off, then the turn power, the start push and the cruise speed | Pavan + Claude | `venue_cal --go --place venue` (S3, rest, S6, about 9 min) |

Today's calibration (bare rubber, dry tiles): `turn_pct` 75, `turn_kick_pct` 85, stalled turns retried at 85 % then 100 %, `cruise_mm_s` 475 with `drive_lag_ms` 40. A wiped (damp) floor needed 85 % with a 100 % kick.

### 9.4 Replay site and the architecture diagrams

| # | Task | Owner | Note |
|---|---|---|---|
| 11 | Check the replay still verifies the newest missions (records now hold stall stops, turn boosts, `gap_from`) | Claude | |
| 12 | Plain wording on the replay for "stalled" and "boosted" steps | Claude | |
| 13 | ~~Deploy the replay site with the architecture pages~~ | done | **Live since 6 Nov** (Pavan's OK): rover-replay.vercel.app/architecture/, /architecture/hedera/, /architecture/0g/, full-screen …/present/, /deck/. Env files kept out with `.vercelignore` |
| 14 | Swap the README's text sketch for `docs/rover/media/rover-hire-architecture.gif` | Pavan's OK | **Put on hold by Pavan, 6 Nov** ✅ Done 6 Nov: README rewritten with the pixel banner and the GIF |
| 14b | ✅ Done 6 Nov 23:09. Watch a real running mission on the public **/live** page (rover-replay.vercel.app/live/, live since 6 Nov): the new mission appears, payments tick in, batches load and re-check as they are anchored | Pavan + Claude | Built from public data only (Hedera mirror, Galileo, 0G Storage); tested on a finished mission with `?mission=` (5/5, 37 moves, 0.855 USDC, 10/10 batches re-checked) and the idle view. The HUD stays the booth screen on the laptop. In that live run, the page showed the mission 9 s after the HUD, payments matched the HUD within one move, all 5 batches re-checked about a minute behind, then it went back to idle with the replay link |
| 15 | The P9 checks still open: the deployed replay opened on another network (phone data); then tag `rover-p9` | Pavan + Claude | Chain, storage and mirror calls from the deployed origin work (checked 6 Nov on /live and the replay); only the other-network check is left |
| 16 | Sharper logos: swap the poster cut-outs in `apps/replay/public/brand/` for the original SVGs | Pavan (files) | Optional |
| 16b | Station-A on the website: its own sales page, its own architecture board, and a place in the hero animation | Claude | ✅ Done 7 Nov, deployed at Pavan's OK (rover-replay-bl3jnhv54, code e04a5b4). **`/station/`** reads Station-A's sales topic on the Hedera mirror and checks it in the browser: each sale carries the hash of the one before, and each payment must have settled and paid Station-A exactly the price (46 sales, 0.048 USDC on the day). **`/architecture/station/`** (+ full screen, + a deck slide) tells its story in 8 steps: find on ERC-8004, 402, pay 0.001 USDC, the station reads and signs, charged only on success, the sale on HCS, the signature checked, anyone can check. The ERC-8004 boxes list Station-A's agent; the home page has an "Also for hire" section; the Hire page says its 3 tools are on the owner's laptop only. **The hero:** the agent finds Rover-A + Station-A, takes the rover's 5 photos, then pays Station-A for one signed room reading ("OK 5 photos + reading"); the hero text names Station-A and ChatGPT. Station-A is not in the menu (Pavan) |

Ready now: `docs/rover/media/rover-hire-deck.pdf` (poster, whole system, Hedera, 0G) and the three GIFs `rover-hire-architecture.gif`, `rover-hire-hedera.gif`, `rover-hire-0g.gif`.

### 9.5 Rehearsal (Phase 10)

| # | Task | Owner | Note |
|---|---|---|---|
| 17 | Five full runs from Claude Desktop (budget 1.00 USDC), at least 4 clean, logged in a run table as `prior-work/evidence/P10/` | Pavan + Claude | ✅ Done 6 Nov: five 5-photo runs on frozen code 6b578d2, **5 of 5 clean, 25/25 photos** (one starting facing away, one on a different box "#1"), 169–323 s, 19–36 moves, 0.585–0.84 USDC; table and tuning notes in `prior-work/evidence/P10/runs.md` |
| 18 | Missions per motor-pack charge; power bank life with the full service; heat over back-to-back runs | Pavan + Claude | Partly measured 6 Nov: about a dozen missions on one charge took the motor pack from 8.505 V to 8.472 V at rest (lowest under load 7.77 V). Power bank life and heat still to measure |
| 19 | Film the failure beats for the video: `402` (tiny budget), `0G?` (phone data off), `BAT` (motor battery off) | Pavan | |

### 9.6 Video and submission

| # | Task | Owner | Note |
|---|---|---|---|
| 20 | Record the real footage in `docs/rover/VIDEO_SCRIPT.md` (one full mission: floor camera + Claude Desktop + HUD; HashScan, Galileo and replay pages) and edit to under 3 minutes | Pavan | The GIFs can help with the titles |
| 21 | ETHGlobal submission form: partner prizes (0G Physical AI, Hedera x402), repo link, video, live demo (the replay site), contract addresses | Pavan | Deadline 7 Nov 09:00 IST |

### 9.7 Docs

| # | Task | Owner | Note |
|---|---|---|---|
| 22 | HARDWARE_PREP: tape off and today's calibration, the turn boost, the drive start-up, the power-up and shutdown order, the 6 Nov wiring lessons (sense wire, fuse cable) | Claude | |
| 23 | Confirm AI_USAGE.md is accurate (any hand-written code or plan docs?) | Pavan | |
| 24 | README: optionally tell the story of one good mission from the event (5/5, review 100/100) | Claude | |
| 25 | PRIOR_WORK chapter 4, during the event | Claude | |

### 9.8 Optional software

| # | Task | Owner | Note |
|---|---|---|---|
| 26 | Battery-sense safeguard in the firmware: a reading under ~4 V is "sense lost" (hold the last good value up to 2 s, flag it), not "battery low" | Claude | Built 7 Nov on `p10a-cal` (`firmware/rover_mcu/batt.cpp`): the battery level is now the median of the last second, not the mean, so the single 4–6 V readings of a loose wire (2–8 per mission on 7 Nov) don't move it; a reading under 4 V is held out for 2 s (state flag 32, `batt_drops` in `info`), after that it is real (switch off, pack out). `batt_min_mv` still shows every dip, so a loose wire stays visible. Host test `firmware/tests/test_batt.cpp` replays 7 Nov's dips (the old mean fails it). To flash |
| 27 | Boot-time USB fix on the board: switch the port back to host if it boots as a device | Claude (Pavan runs one `sudo` install) | Built 7 Nov: `rover-usb-host.service` checks the port's role every 2 s and sets `device` back to `host` (logged as `rover-usb-host`). Install once: `sudo sh ~/0xbs-rover/rover/tools/install_usb_host.sh`. To plug the board into a computer as a USB device, stop it first |
| 28 | Fewer refused 0G answers (6–12 per mission, ~2.5 s each; mostly a photo right after a photo, or a turn to a parcel already centred): a prompt bench on recorded frames | Claude | Tried 6 Nov: v6.2 halved them on the bench but not live, and added "stop" answers, so v6.1 stays (`prior-work/evidence/P10/prompt_v6_2/`). With the 30° rule the last runs had 0–3 such pauses |
| 29 | Restart Claude Desktop so it loads the power-cut-safe mission files | Pavan ✅ Done 6 Nov (on the merged build) |

### 9.9 Operating the rover (keep doing)

- **Start:** motor switch off → power bank into the hub's power-in first, wait 5 s → hub into the UNO Q → wait for the "ready" face → check the camera (HUD or `node scripts/event-check.mjs`) → motor switch on. Plugging everything at once made the board restart six times and come up without the camera.
- **Stop:** motor switch off → `ssh -t arduino@rovera.local sudo poweroff` → wait ~15 s → unplug.
- **Readings:** motor battery ≈ 0 V means the kill switch is off; ≈ 2.25 V means the pack is not plugged in.
- **Laptop:** zg-log, both shops, the HUD and the local replay are systemd user services (`scripts/laptop/install.sh`); they start at boot and restart after a crash. Logs: `journalctl --user -u 'rover-*'`.

### 9.10 Sensor station Station-A (Phase 12, Hedera only)

Items 30–34 live in §12.10: parts arrive (ordered 6 Nov), wiring, board prep, build, acceptance tests. Phase 12 never delays the rover work and is the first thing cut if time runs short. **✅ Complete 7 Nov: merged into `rover`, tag `rover-p12`.**

### 9.11 Hybrid remote MCP (Phase 13, branch `p13-remote`)

Items 35–40 live in §13.8. Everything is in the separate folder `../0xBs-p13` and the private repo `Pavankumar07s/rover-for-hire`. The rover is never changed. `scripts/p13/mode.sh local`, or the desktop launcher, brings back today's setup in one step.
