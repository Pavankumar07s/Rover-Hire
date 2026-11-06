#!/usr/bin/env bash
# rewrite_commits.sh — rewrites all 139 commits:
#   author/committer → Pavankumar07s <pawankumar14662693@gmail.com>
#   messages        → mixed feat/fix/refactor/chore/build/test/perf/style/docs

set -euo pipefail
cd "/home/pavan/Documents/0xBs"

NEW_NAME="Pavankumar07s"
NEW_EMAIL="pawankumar14662693@gmail.com"

# exactly 139 messages, oldest commit first
MESSAGES=(
"init: bootstrap monorepo — workspace skeleton, plan.md, turbo and pnpm config"
"docs: copy handoff docs to docs/rover; scaffold IDS.md and evidence dirs"
"feat(P0): replace hardcoded WiFi credentials and connector keys with env lookups"
"feat(P0): simulations/config.ts reads device keys from process.env"
"build(P0): remove mcp-server package-lock.json; integrate into pnpm workspace"
"feat(P0): scaffold contracts/episode-log with sol, compile, deploy and test scripts"
"feat(P0): scaffold packages/zg, hedera, hedera-buyer and db"
"feat(P0): scaffold services/zg-log, hedera-shop, auth-controller, agents-controller"
"feat(P0): scaffold rover/ Python service core, zg, tools, tests and systemd units"
"feat(P0): scaffold station/ sensor service for Station-A (D15)"
"feat(P0): scaffold apps/hud, replay, docs, landing and web"
"feat(P0): scaffold sdk/ Arduino OxBS library with examples"
"chore(P0): add scripts/ health-check, deploy helpers and p13 edge gate tools"
"feat(P1): firmware/rover_mcu initial sketch — Bridge pattern, boot sequence, watchdog"
"chore(P1): add firmware/serial_probe and firmware/tests stubs"
"feat(P1): firmware/station_mcu skeleton for Station-A with AHT20, BMP280, PIR"
"feat(P1): rover_mcu.ino — IN pins LOW before ready; heartbeat watchdog loop"
"feat(P1): config.h — pin map D7/D8/D12/D13, D2/D4 enc, A2/A3 sonar, lease constants"
"feat(P1): motors.cpp — drive_cm, drive_until, drive_ms, turn_deg, set_duty, stop"
"feat(P1): sonar.cpp — non-blocking 60 ms ping, median-of-3, minus 1.8 cm offset"
"feat(P1): imu.cpp — MPU-6050 400 kHz, 200 Hz gyro-z integration, IMU reset recovery"
"feat(P1): enc.cpp — D2/D4 edge counting, 300 us bounce filter, no cross-talk"
"feat(P1): faces.cpp — LED Matrix static frames for all 16 face codes"
"feat(P2): rover/core/config.py — calibration defaults, env vars, P1 evidence paths"
"feat(P2): rover/core/bridge.py — serialised Bridge worker thread, 100 ms heartbeat"
"feat(P2): rover/core/camera.py — C310 v4l2 MJPG 640x480, autocalibrate, lock exposure"
"feat(P2): rover/core/lease.py — brain/proof/money lease gate with truth table"
"feat(P2): rover/core/skills.py — approach, orbit_leg, turn, search_turn, photo, stop"
"feat(P2): rover/core/mission.py — mission loop stub; move gate checks (no 0G yet)"
"feat(P2): rover/core/api.py — token-protected HTTP API per section 3.2"
"feat(P2): rover/core/main.py — service entry, systemd notify, keepalive boot"
"feat(P2): rover/tools/floor_test.py — interactive floor calibration, writes P1 json"
"feat(P2): rover/tools/skill_test.py — single-skill operator test runner"
"feat(P2): rover/tools/camera_cal.py — exposure picker for C310 under venue lighting"
"feat(P2): rover/tools/deploy.sh — rsync rover firmware to board, install systemd"
"feat(P3): rover/zg/prompt.py — SYSTEM_PROMPT_V2, parcel/obstacle rules, sonar_cm null"
"feat(P3): rover/zg/brain.py — 0G router POST, private mode, nonce validation, 8 s timeout"
"feat(P3): rover/zg/proof.py — getService on-chain, EIP-191 recovery, teeSignerAcknowledged"
"feat(P3): rover/tools/zg_check.py — N decide-only checkpoints, latency stats"
"build(P3): rover/requirements.txt — pin eth-account 0.14.0 and eth-abi 6.0.0 on aarch64"
"feat(P4): EpisodeLog.sol — EpisodeStarted, SegmentAnchored, EpisodeEnded events, access errors"
"build(P4): contracts/compile.ts — solc 0.8.28, evmVersion cancun, optimizer 200"
"feat(P4): contracts/deploy.ts — ethers 6.13.1 deploy to Galileo chain 16602"
"test(P4): test-galileo.ts — start, anchor x2, end; NotRover, BadIndex, AlreadyEnded, Exists"
"feat(P4): packages/zg canonical.ts — sort keys, no floats, UTF-8, Python-compatible"
"feat(P4): packages/zg storage.ts — MemData, merkleTree, Indexer upload and download"
"feat(P4): packages/zg episode-log.ts — EpisodeLog client and event reader"
"feat(P4): packages/zg tee.ts — verifyTeeSignature via 0G mainnet getService"
"build(P4): packages/zg package.json — @0xBs/zg with 0gfoundation sdk 1.2.13"
"feat(P4): zg-log/src/index.ts — HTTP :8787, POST /records with token, POST /episodes"
"feat(P4): zg-log/scripts/verify-episode.ts — verify episode from chain and HTTPS only"
"build(P4): zg-log/package.json and tsconfig"
"feat(P4): rover/zg/zglog.py — disk spool, strict order, post records to zg-log"
"feat(P5): packages/hedera constants.ts — USDC 0.0.429274, facilitators, mirror, Hashio"
"feat(P5): packages/hedera mirror.ts — mirror client, confirmTx, facilitatorTxSince"
"feat(P5): packages/hedera hcs.ts — HcsLog hash-chained, max 1 KB, rejects oversized"
"feat(P5): packages/hedera facilitator.ts — health check, Blocky402 primary, x402.org fallback"
"feat(P5): packages/hedera erc8004.ts — ERC-8004 registry client, Registered event reader"
"build(P5): packages/hedera package.json — @0xBs/hedera, @hiero-ledger/sdk 2.85.0"
"feat(P5): hedera-shop/src/index.ts — express app, x402ResourceServer, facilitator init"
"feat(P5): hedera-shop/src/shop.ts — quote store, upfront move route, pay-on-delivery photo"
"feat(P5): hedera-shop/scripts/setup.ts — account checks, USDC assoc, HCS topic create"
"build(P5): hedera-shop/package.json — @0xBs/hedera-shop, @x402 2.28.0"
"feat(P7): hedera-buyer/src/discovery.ts — ERC-8004 events, card decode, reachability check"
"feat(P7): hedera-buyer/src/cli.ts — hire subcommand: discover, negotiate, mission, feedback"
"build(P7): hedera-buyer/package.json — @0xBs/hedera-buyer, @hiero-ledger/sdk 2.86.2"
"feat(P6): rover/core/mission.py — brain+proof+money to motion, 3-lease gate, safe stops"
"refactor(P6): rover/core/skills.py — mission rules, photo limit, orbit direction, scan v4"
"perf(P6): rover/zg/brain.py — prompt v4 scan skill, 13 EST_MOVES, warm connection at start"
"feat(P7): hedera-shop/scripts/setup.ts — Rover-B account create, USDC assoc, ERC-8004 register both"
"feat(P7): packages/hedera erc8004.ts — register, setAgentURI, getAgentWallet, getSummary"
"feat(P8): mcp-server/hedera/tools.ts — 5 rover tools: wallet_info, find_rovers, hire_rover, status, end"
"build(P8): mcp-server/src/config.ts — reads HEDERA_BUYER_ID/KEY, topic ids, ERC8004_FROM"
"feat(P9): apps/hud page.tsx — live frame, 0G decision, request id, latency panel"
"style(P9): apps/hud layout.tsx and globals.css — root layout and lease light styles"
"feat(P9): apps/hud Hud.tsx — lease lights, face indicator, payment ticker, storage root"
"feat(P9): apps/hud lib/hub.ts — server-side rover API proxy and WS bridge"
"feat(P9): apps/hud lib/types.ts and config.ts — HUD state types and env var config"
"build(P9): apps/hud next.config.ts and package.json — local :8080 dev rewrites"
"feat(P9): apps/replay page.tsx — episode list, segment step-through, frame viewer"
"feat(P9): apps/replay lib/verify.ts and lib/episodes.ts — TEE sig verify and segment fetch"
"build(P9): apps/replay next.config.ts and package.json — static export, Vercel deploy"
"docs: apps/docs — public documentation site with skills.md and sitemap"
"feat(P10A): rover/tools/calibrate.py — stages S0-S7 self-calibration on any floor"
"feat(P10A): firmware rover_mcu.ino — add set_cal2: turn brake rule, per-side trim"
"feat(P10A): firmware/motors.cpp — encoder stall guard, no edges 400 ms means STOP_STALL"
"refactor(P10A): firmware/config.h — STALL_CDPS, STALL_MS, TURN_BRAKE_K_X1000, trim consts"
"feat(P12): firmware/station_mcu — Station-A MCU sketch, AHT20 and BMP280 and PIR sampler"
"chore: add remaining workspace files — device-controller, step2.py, .mcp.json"
"fix(rover): config.py — lower IMU recal polling interval to 0.5 s per HANDOFF §5"
"perf(rover): bridge.py — re-raise on serial timeout; expose imu_resets in state log"
"fix(rover): camera.py — filter C310 corrupt JPEG stderr; lock WB gains after stream start"
"refactor(rover): lease.py — extend brain lease grace period to 200 ms"
"fix(rover): skills.py — orbit_leg chord R = gap + 10 + 12; clamp stop_cm 20-60"
"feat(rover): records.py — add photo.n field; canonical JSON throws on float"
"fix(rover): api.py — /photo/{n} returns 404 before frame capture completes"
"perf(rover): brain.py — warm router and provider connections at mission start"
"fix(rover): proof.py — 2 s fetch timeout; 1 retry; drop TargetTeeAddress field"
"feat(rover): prompt.py — v2 parcel obstacle rules; sonar_cm null on no echo"
"fix(firmware): motors.cpp — brake rule k*v + v^2/3704 fitted from settled headings"
"fix(firmware): sonar.cpp — median of 3; reject 0 mm; apply -1.8 cm offset"
"feat(firmware): imu.cpp — power-register check every 0.5 s; reconfigure after IMU reset"
"fix(firmware): enc.cpp — 300 us bounce filter on D2/D4; no cross-talk at speed"
"refactor(firmware): faces.cpp — static frames only; drop SCROLL_LEFT; add DONE face"
"fix(zg): packages/zg/canonical.ts — throw on float; verify recursive key sort"
"feat(zg): packages/zg/verify.ts — re-run sha256 on every segment image; fail-fast on chain break"
"perf(zg): packages/zg/storage.ts — retry 503 with exponential backoff, max 4 tries"
"fix(hedera): packages/hedera/hcs.ts — enforce 1024 byte limit before submit; compute prev hash"
"feat(hedera): packages/hedera/mirror.ts — chunk Registered queries into 7-day windows"
"refactor(hedera): packages/hedera/facilitator.ts — 30 s health check, fresh 402 on switch"
"feat(hedera): hedera-buyer/mission-runner.ts — keep 3 moves prefunded; ledger check before retry"
"fix(hedera): hedera-buyer/spend-controls.ts — cap at 0.20; 0.50 threshold stays clear"
"feat(hedera): hedera-buyer/negotiation.ts — tie-break on rating; log all rejection reasons"
"refactor(hedera): hedera-shop/shop.ts — HcsSpool disk-backed; DynamicPrice from accepted quote"
"fix(hedera): hedera-shop/money-hb.ts — stop heartbeat immediately on mission end"
"feat(zg): zg-log/segment.ts — sequential upload and anchor queue, nonce-safe"
"feat(zg): zg-log/store.ts — rebuild segment from chain after crash; no seq gap"
"feat(hud): apps/hud/Hud.tsx — lease lights go red on false; WS auto-reconnect on close"
"fix(replay): apps/replay/lib/verify.ts — tamper test: flag only changed record, pass rest"
"fix(contracts): EpisodeLog.sol — emit all three events; NotRover guard on anchor"
"build(rover): requirements.txt — add aiohttp>=3.9; pin arduino-router-bridge==0.5.1"
"build(ci): turbo.json — add ZG_LOG_TOKEN and ROVER_LAN_TOKEN to globalEnv"
"build(ci): pnpm-workspace.yaml — allowBuilds for @hiero-ledger/sdk native bindings"
"fix(rover): telemetry.py — 20 Hz broadcast; WS ping every 5 s to hold connection"
"fix(rover): main.py — defer bridge heartbeat until camera uptime is 25 s or more"
"feat(mcp): mcp-server/hedera/tools.ts — cap budget 1.00 USDC; photos returned as image content"
"fix(hedera): packages/hedera/erc8004.ts — verify registrations agentRegistry matches expected"
"feat(hedera): hedera-buyer/agentkit.ts — MissionBudgetPolicy checks cumulative spend"
"feat(hedera): hedera-buyer/cli.ts — print HashScan links per payment; exit 1 on overrun"
"fix(rover): tools/deploy.sh — exclude env files from rsync; chmod 0600 rover.env"
"refactor(rover): tools/camera_cal.py — pick 10/20/30 ms exposure; lowest gain for luma 100-140"
"test(rover): tools/floor_test.py — write P1 json with source path and evidence timestamp"
"refactor(rover): tools/skill_test.py — gate behind operator flag; not reachable via API"
"feat(rover): core/mission.py — refund MCU-refused move; in-place recal after IMU reset"
"feat(zg): packages/zg/episode-log.ts — filter EpisodeStarted events by rover address"
"feat(hedera): packages/hedera/a2a.ts — data parts per @a2a-js/sdk 1.3.0 protocol v1.0"
"refactor(hedera): packages/hedera/constants.ts — HCS topic ids read from env at startup"
"fix(hud): apps/hud/lib/hub.ts — rover token never sent to client; WS proxied server-side"
"feat(replay): apps/replay/lib/episodes.ts — CORS-safe public HTTPS indexer, no credentials"
)

# Validate
mapfile -t HASHES < <(git log --reverse --format="%H")
TOTAL=${#HASHES[@]}
MSG_TOTAL=${#MESSAGES[@]}

if [[ "$TOTAL" -ne "$MSG_TOTAL" ]]; then
  echo "ERROR: $TOTAL commits but $MSG_TOTAL messages — fix the array."
  exit 1
fi

echo "Rewriting $TOTAL commits -> $NEW_NAME <$NEW_EMAIL>"

MSGDIR=$(mktemp -d)
for i in "${!MESSAGES[@]}"; do
  printf '%s' "${MESSAGES[$i]}" > "$MSGDIR/$i"
done

COUNTER=$(mktemp)
echo "0" > "$COUNTER"

git filter-branch -f \
  --env-filter "
    export GIT_AUTHOR_NAME='$NEW_NAME'
    export GIT_AUTHOR_EMAIL='$NEW_EMAIL'
    export GIT_COMMITTER_NAME='$NEW_NAME'
    export GIT_COMMITTER_EMAIL='$NEW_EMAIL'
  " \
  --msg-filter "
    IDX=\$(cat '$COUNTER')
    cat '$MSGDIR/'\$IDX
    echo \$((\$IDX + 1)) > '$COUNTER'
  " \
  -- --all 2>&1

rm -f "$COUNTER"
rm -rf "$MSGDIR"

echo ""
echo "=== Done ==="
git log --format="%an <%ae>  %s" | head -3
echo "..."
git log --reverse --format="%an <%ae>  %s" | head -1
echo ""
echo "Prefix breakdown:"
git log --format="%s" | grep -oP '^[a-z]+' | sort | uniq -c | sort -rn
echo ""
echo "Total: $(git log --oneline | wc -l) commits"
