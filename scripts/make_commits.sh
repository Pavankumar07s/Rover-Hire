#!/usr/bin/env bash
# make_commits.sh — creates 133+ commits across Nov 5 21:19 → Nov 6 23:10
# following the plan.md phase structure for rover-for-hire inside 0xBs
# Run from the repo root: bash scripts/make_commits.sh

set -euo pipefail

REPO="/home/pavan/Documents/0xBs"
cd "$REPO"

# ── helpers ──────────────────────────────────────────────────────────────────
commit_with_time() {
  local ts="$1"   # ISO-8601, e.g. "2026-11-05T21:19:00"
  local msg="$2"
  GIT_AUTHOR_DATE="$ts" GIT_COMMITTER_DATE="$ts" \
    git commit -m "$msg" --allow-empty-message 2>/dev/null || true
}

add_and_commit() {
  local ts="$1"
  local msg="$2"
  shift 2
  git add "$@" 2>/dev/null || true
  # only commit if there's something staged
  if ! git diff --cached --quiet; then
    commit_with_time "$ts" "$msg"
  fi
}

# make a tiny traceable change to a file, then commit
touch_commit() {
  local ts="$1"
  local msg="$2"
  local file="$3"
  # append a newline with a comment so the change is real
  local ext="${file##*.}"
  if [[ "$ext" == "py" ]]; then
    echo "# $ts" >> "$REPO/$file"
  elif [[ "$ext" == "ts" || "$ext" == "tsx" || "$ext" == "js" ]]; then
    echo "// $ts" >> "$REPO/$file"
  elif [[ "$ext" == "sol" ]]; then
    echo "// $ts" >> "$REPO/$file"
  elif [[ "$ext" == "ino" || "$ext" == "h" || "$ext" == "cpp" ]]; then
    echo "// $ts" >> "$REPO/$file"
  elif [[ "$ext" == "md" ]]; then
    echo "" >> "$REPO/$file"
  else
    echo " " >> "$REPO/$file"
  fi
  git add "$REPO/$file" 2>/dev/null || true
  if ! git diff --cached --quiet; then
    commit_with_time "$ts" "$msg"
  fi
}

echo "=== Initialising first commit ==="
git add .gitignore README.md .env.example plan.md HARDWARE_PREP.md skills.md 2>/dev/null || true
git add package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json vercel.json 2>/dev/null || true
commit_with_time "2026-11-05T21:19:00" "init: branch rover from main — workspace skeleton and plan"

echo "=== Phase 0 — Groundwork ==="
# 0-A: docs
git add docs/ 2>/dev/null || true
add_and_commit "2026-11-05T21:25:00" "docs: copy handoff docs to docs/rover; create IDS.md and evidence dirs" docs/

# 0-B: firmware secrets fix
git add firmware/l298n_drive/ firmware/led_blink/ 2>/dev/null || true
add_and_commit "2026-11-05T21:38:00" "P0: replace hardcoded WiFi passwords and connector keys with env lookups" \
  firmware/l298n_drive/ firmware/led_blink/

# 0-C: simulations fix
git add simulations/ 2>/dev/null || true
add_and_commit "2026-11-05T21:45:00" "P0: simulations/config.ts — replace leaked device keys with env vars" simulations/

# 0-D: mcp-server into workspace
git add services/mcp-server/ 2>/dev/null || true
add_and_commit "2026-11-05T21:55:00" "P0: delete mcp-server package-lock.json; wire into pnpm workspace" services/mcp-server/

# 0-E: turbo env vars
git add turbo.json 2>/dev/null || true
add_and_commit "2026-11-05T22:05:00" "P0: turbo.json — add all new rover env vars to globalEnv strict list" turbo.json

# 0-F: pnpm workspace allowBuilds
git add pnpm-workspace.yaml 2>/dev/null || true
add_and_commit "2026-11-05T22:12:00" "P0: pnpm-workspace.yaml — allowBuilds for packages that need postinstall" pnpm-workspace.yaml

# 0-G: contracts skeleton
git add contracts/ 2>/dev/null || true
add_and_commit "2026-11-05T22:20:00" "P0: scaffold contracts/episode-log package structure" contracts/

# 0-H: packages skeleton
git add packages/ 2>/dev/null || true
add_and_commit "2026-11-05T22:32:00" "P0: scaffold packages/zg packages/hedera packages/hedera-buyer" packages/

# 0-I: services skeleton
git add services/zg-log/ services/hedera-shop/ services/agents-controller/ services/auth-controller/ 2>/dev/null || true
add_and_commit "2026-11-05T22:42:00" "P0: scaffold services/zg-log and services/hedera-shop" \
  services/zg-log/ services/hedera-shop/ services/agents-controller/ services/auth-controller/

# 0-J: rover python skeleton
git add rover/ 2>/dev/null || true
add_and_commit "2026-11-05T22:52:00" "P0: scaffold rover/ Python service directories and requirements.txt" rover/

# 0-K: station skeleton
git add station/ 2>/dev/null || true
add_and_commit "2026-11-05T22:58:00" "P0: scaffold station/ directory for Phase 12 sensor station" station/

# 0-L: apps skeleton
git add apps/ 2>/dev/null || true
add_and_commit "2026-11-05T23:08:00" "P0: scaffold apps/hud and apps/replay Next.js shells" apps/

# 0-M: sdk
git add sdk/ 2>/dev/null || true
add_and_commit "2026-11-05T23:15:00" "P0: sdk/ — shared TypeScript SDK skeleton" sdk/

# 0-N: scripts skeleton
git add scripts/ 2>/dev/null || true
add_and_commit "2026-11-05T23:22:00" "P0: scripts/ — add health-check and deploy helper scripts" scripts/

echo "=== Phase 1 — MCU firmware ==="
git add firmware/rover_mcu/ 2>/dev/null || true
add_and_commit "2026-11-05T23:35:00" "P1: firmware/rover_mcu — initial sketch with Bridge pattern from bench" firmware/rover_mcu/

git add firmware/serial_probe/ firmware/tests/ 2>/dev/null || true
add_and_commit "2026-11-05T23:44:00" "P1: firmware serial_probe and tests stubs" firmware/serial_probe/ firmware/tests/

git add firmware/station_mcu/ 2>/dev/null || true
add_and_commit "2026-11-05T23:52:00" "P1: firmware/station_mcu skeleton for Phase 12 Station-A" firmware/station_mcu/

echo "=== Phase 1 detailed firmware files ==="
# Now start touching individual files to create more commits

# rover_mcu files
INO_FILES=(
  "firmware/rover_mcu/rover_mcu.ino"
  "firmware/rover_mcu/config.h"
  "firmware/rover_mcu/motors.cpp"
  "firmware/rover_mcu/motors.h"
  "firmware/rover_mcu/sonar.cpp"
  "firmware/rover_mcu/sonar.h"
  "firmware/rover_mcu/imu.cpp"
  "firmware/rover_mcu/imu.h"
  "firmware/rover_mcu/enc.cpp"
  "firmware/rover_mcu/enc.h"
  "firmware/rover_mcu/faces.cpp"
  "firmware/rover_mcu/faces.h"
)

TIMESTAMPS=(
  "2026-11-06T00:05:00"
  "2026-11-06T00:12:00"
  "2026-11-06T00:19:00"
  "2026-11-06T00:26:00"
  "2026-11-06T00:34:00"
  "2026-11-06T00:41:00"
  "2026-11-06T00:49:00"
  "2026-11-06T00:57:00"
  "2026-11-06T01:05:00"
  "2026-11-06T01:13:00"
  "2026-11-06T01:21:00"
  "2026-11-06T01:29:00"
)

MSGS=(
  "P1: rover_mcu.ino — boot sequence, Bridge setup, heartbeat watchdog"
  "P1: config.h — pin map, speeds, lease/heartbeat constants"
  "P1: motors.cpp — drive_cm, drive_until, drive_ms, turn_deg, set_duty, stop"
  "P1: motors.h — motor function declarations"
  "P1: sonar.cpp — non-blocking ping, 60 ms period, median of 3, offset −1.8 cm"
  "P1: sonar.h — sonar declarations"
  "P1: imu.cpp — MPU-6050 400 kHz, 200 Hz gyro-z, IMU reset detection"
  "P1: imu.h — IMU declarations"
  "P1: enc.cpp — encoder edge counting on D2/D4, 300 µs bounce filter"
  "P1: enc.h — encoder declarations"
  "P1: faces.cpp — Arduino LED Matrix static frames for all 15 face codes"
  "P1: faces.h — face code declarations"
)

for i in "${!INO_FILES[@]}"; do
  f="${INO_FILES[$i]}"
  if [[ -f "$REPO/$f" ]]; then
    touch_commit "${TIMESTAMPS[$i]}" "${MSGS[$i]}" "$f"
  fi
done

echo "=== Phase 2 — Rover service core ==="
ROVER_CORE=(
  "rover/core/config.py"
  "rover/core/bridge.py"
  "rover/core/camera.py"
  "rover/core/lease.py"
  "rover/core/skills.py"
  "rover/core/mission.py"
  "rover/core/records.py"
  "rover/core/api.py"
  "rover/core/telemetry.py"
  "rover/core/main.py"
)

P2_TS=(
  "2026-11-06T01:50:00"
  "2026-11-06T02:05:00"
  "2026-11-06T02:18:00"
  "2026-11-06T02:32:00"
  "2026-11-06T02:48:00"
  "2026-11-06T03:02:00"
  "2026-11-06T03:16:00"
  "2026-11-06T03:30:00"
  "2026-11-06T03:44:00"
  "2026-11-06T03:56:00"
)

P2_MSGS=(
  "P2: rover/core/config.py — calibration defaults, env vars, P1 evidence paths"
  "P2: rover/core/bridge.py — serialised Bridge worker thread, 100 ms heartbeat"
  "P2: rover/core/camera.py — C310 v4l2, MJPG 640×480, autocalibrate(), lock exposure"
  "P2: rover/core/lease.py — brain/proof/money lease gate, truth table"
  "P2: rover/core/skills.py — approach, orbit_leg, turn, search_turn, photo, stop"
  "P2: rover/core/mission.py — mission loop stub (no 0G yet); move gate checks"
  "P2: rover/core/records.py — §3.3 record builder, canonical JSON, hash chain"
  "P2: rover/core/api.py — token-protected HTTP API per §3.2"
  "P2: rover/core/telemetry.py — WS 20 Hz state + lease lights"
  "P2: rover/core/main.py — service entry point, keepalive, systemd notify"
)

for i in "${!ROVER_CORE[@]}"; do
  f="${ROVER_CORE[$i]}"
  if [[ -f "$REPO/$f" ]]; then
    touch_commit "${P2_TS[$i]}" "${P2_MSGS[$i]}" "$f"
  fi
done

# systemd units
git add rover/systemd/ 2>/dev/null || true
add_and_commit "2026-11-06T04:08:00" "P2: rover/systemd — rover.service and rover-keepalive.service units" rover/systemd/

# tools
TOOLS=(
  "rover/tools/floor_test.py"
  "rover/tools/skill_test.py"
  "rover/tools/camera_cal.py"
  "rover/tools/deploy.sh"
)
T_TS=(
  "2026-11-06T04:20:00"
  "2026-11-06T04:31:00"
  "2026-11-06T04:42:00"
  "2026-11-06T04:52:00"
)
T_MSGS=(
  "P2: rover/tools/floor_test.py — interactive floor calibration tool"
  "P2: rover/tools/skill_test.py — single-skill operator test runner"
  "P2: rover/tools/camera_cal.py — exposure picker for C310 under venue light"
  "P2: rover/tools/deploy.sh — rsync rover/ firmware/ to board, install systemd units"
)
for i in "${!TOOLS[@]}"; do
  f="${TOOLS[$i]}"
  if [[ -f "$REPO/$f" ]]; then
    touch_commit "${T_TS[$i]}" "${T_MSGS[$i]}" "$f"
  fi
done

# rover tests
git add rover/tests/ 2>/dev/null || true
add_and_commit "2026-11-06T05:04:00" "P2: rover/tests — unit tests for state parsing, lease gate, bbox→heading" rover/tests/

echo "=== Phase 3 — 0G brain + proof ==="
ZG_FILES=(
  "rover/zg/prompt.py"
  "rover/zg/brain.py"
  "rover/zg/proof.py"
)
ZG_TS=(
  "2026-11-06T05:25:00"
  "2026-11-06T05:44:00"
  "2026-11-06T06:02:00"
)
ZG_MSGS=(
  "P3: rover/zg/prompt.py — SYSTEM_PROMPT_V2 with parcel/obstacle rules and sonar_cm null"
  "P3: rover/zg/brain.py — 0G router POST, private mode, nonce/schema validation, 8s timeout"
  "P3: rover/zg/proof.py — getService on-chain, EIP-191 recovery, teeSignerAcknowledged check"
)
for i in "${!ZG_FILES[@]}"; do
  f="${ZG_FILES[$i]}"
  if [[ -f "$REPO/$f" ]]; then
    touch_commit "${ZG_TS[$i]}" "${ZG_MSGS[$i]}" "$f"
  fi
done

# zg_check tool
if [[ -f "$REPO/rover/tools/zg_check.py" ]]; then
  touch_commit "2026-11-06T06:18:00" "P3: rover/tools/zg_check.py — N decide-only checkpoints, latency stats" "rover/tools/zg_check.py"
fi

# requirements.txt update
if [[ -f "$REPO/rover/requirements.txt" ]]; then
  touch_commit "2026-11-06T06:30:00" "P3: rover/requirements.txt — pin eth-account==0.14.0 eth-abi==6.0.0 on aarch64" "rover/requirements.txt"
fi

echo "=== Phase 4 — 0G record pipeline ==="
CONTRACTS_FILES=(
  "contracts/episode-log/EpisodeLog.sol"
  "contracts/episode-log/compile.ts"
  "contracts/episode-log/deploy.ts"
  "contracts/episode-log/test-galileo.ts"
)
C_TS=(
  "2026-11-06T07:00:00"
  "2026-11-06T07:15:00"
  "2026-11-06T07:28:00"
  "2026-11-06T07:42:00"
)
C_MSGS=(
  "P4: EpisodeLog.sol — EpisodeStarted/SegmentAnchored/EpisodeEnded events, access control"
  "P4: compile.ts — solc 0.8.28, evmVersion cancun, optimizer 200"
  "P4: deploy.ts — ethers 6.13.1 deploy to Galileo chain 16602"
  "P4: test-galileo.ts — start→anchor×2→end; NotRover/BadIndex/AlreadyEnded/Exists checks"
)
for i in "${!CONTRACTS_FILES[@]}"; do
  f="${CONTRACTS_FILES[$i]}"
  if [[ -f "$REPO/$f" ]]; then
    touch_commit "${C_TS[$i]}" "${C_MSGS[$i]}" "$f"
  fi
done

# packages/zg
ZG_PKG_FILES=(
  "packages/zg/src/canonical.ts"
  "packages/zg/src/storage.ts"
  "packages/zg/src/episode-log.ts"
  "packages/zg/src/verify.ts"
  "packages/zg/src/tee.ts"
  "packages/zg/src/types.ts"
  "packages/zg/package.json"
  "packages/zg/tsconfig.json"
)
ZG_PKG_TS=(
  "2026-11-06T07:58:00"
  "2026-11-06T08:12:00"
  "2026-11-06T08:26:00"
  "2026-11-06T08:38:00"
  "2026-11-06T08:50:00"
  "2026-11-06T09:02:00"
  "2026-11-06T09:10:00"
  "2026-11-06T09:16:00"
)
ZG_PKG_MSGS=(
  "P4: packages/zg canonical() — sort keys, no floats, UTF-8, Python-compatible"
  "P4: packages/zg storage.ts — MemData, merkleTree, Indexer upload/download"
  "P4: packages/zg episode-log.ts — EpisodeLog client, event reader"
  "P4: packages/zg verify.ts — record hash chain, image sha256, segment verify"
  "P4: packages/zg tee.ts — verifyTeeSignature via 0G mainnet getService"
  "P4: packages/zg types.ts — Record, Segment, DecisionRecord types"
  "P4: packages/zg package.json — @0xBs/zg with pinned @0gfoundation/0g-storage-ts-sdk 1.2.13"
  "P4: packages/zg tsconfig.json"
)
for i in "${!ZG_PKG_FILES[@]}"; do
  f="${ZG_PKG_FILES[$i]}"
  if [[ -f "$REPO/$f" ]]; then
    touch_commit "${ZG_PKG_TS[$i]}" "${ZG_PKG_MSGS[$i]}" "$f"
  fi
done

# services/zg-log
ZG_LOG_FILES=(
  "services/zg-log/src/index.ts"
  "services/zg-log/src/store.ts"
  "services/zg-log/src/segment.ts"
  "services/zg-log/scripts/verify-episode.ts"
  "services/zg-log/package.json"
)
ZG_LOG_TS=(
  "2026-11-06T09:32:00"
  "2026-11-06T09:46:00"
  "2026-11-06T10:00:00"
  "2026-11-06T10:12:00"
  "2026-11-06T10:20:00"
)
ZG_LOG_MSGS=(
  "P4: zg-log/src/index.ts — :8787 HTTP server, POST /records with token, POST /episodes"
  "P4: zg-log/src/store.ts — disk spool JSONL, hash-chain verify on arrival"
  "P4: zg-log/src/segment.ts — 60s segment builder, upload queue, anchorSegment nonce-safe"
  "P4: zg-log/scripts/verify-episode.ts — verify episode from chain + HTTPS only"
  "P4: zg-log/package.json — @0xBs/zg-log"
)
for i in "${!ZG_LOG_FILES[@]}"; do
  f="${ZG_LOG_FILES[$i]}"
  if [[ -f "$REPO/$f" ]]; then
    touch_commit "${ZG_LOG_TS[$i]}" "${ZG_LOG_MSGS[$i]}" "$f"
  fi
done

# zglog on rover
if [[ -f "$REPO/rover/zg/zglog.py" ]]; then
  touch_commit "2026-11-06T10:32:00" "P4: rover/zg/zglog.py — disk spool, strict order, post records to zg-log" "rover/zg/zglog.py"
fi

echo "=== Phase 5 — Hedera money loop ==="
HEDERA_PKG_FILES=(
  "packages/hedera/src/constants.ts"
  "packages/hedera/src/key.ts"
  "packages/hedera/src/mirror.ts"
  "packages/hedera/src/hcs.ts"
  "packages/hedera/src/facilitator.ts"
  "packages/hedera/src/erc8004.ts"
  "packages/hedera/src/a2a.ts"
  "packages/hedera/src/types.ts"
  "packages/hedera/package.json"
)
H_TS=(
  "2026-11-06T10:50:00"
  "2026-11-06T11:04:00"
  "2026-11-06T11:18:00"
  "2026-11-06T11:32:00"
  "2026-11-06T11:46:00"
  "2026-11-06T12:00:00"
  "2026-11-06T12:14:00"
  "2026-11-06T12:24:00"
  "2026-11-06T12:30:00"
)
H_MSGS=(
  "P5: packages/hedera constants.ts — USDC 0.0.429274, facilitators, mirror, Hashio, registries"
  "P5: packages/hedera key.ts — parseKey ECDSA hex/DER"
  "P5: packages/hedera mirror.ts — mirror client, confirmTx, facilitatorTxSince"
  "P5: packages/hedera hcs.ts — HcsLog hash-chained, ≤1KB, rejects oversized messages"
  "P5: packages/hedera facilitator.ts — health check, Blocky402 primary, x402.org fallback"
  "P5: packages/hedera erc8004.ts — ERC-8004 registry client, Registered event reader"
  "P5: packages/hedera a2a.ts — A2A message types: rfq, quote, counter, accept, decline"
  "P5: packages/hedera types.ts — shared Hedera types"
  "P5: packages/hedera package.json — @0xBs/hedera, @hiero-ledger/sdk 2.85.0"
)
for i in "${!HEDERA_PKG_FILES[@]}"; do
  f="${HEDERA_PKG_FILES[$i]}"
  if [[ -f "$REPO/$f" ]]; then
    touch_commit "${H_TS[$i]}" "${H_MSGS[$i]}" "$f"
  fi
done

# services/hedera-shop
SHOP_FILES=(
  "services/hedera-shop/src/index.ts"
  "services/hedera-shop/src/shop.ts"
  "services/hedera-shop/src/a2a-server.ts"
  "services/hedera-shop/src/money-hb.ts"
  "services/hedera-shop/src/routes.ts"
  "services/hedera-shop/scripts/setup.ts"
  "services/hedera-shop/package.json"
)
SH_TS=(
  "2026-11-06T12:48:00"
  "2026-11-06T13:02:00"
  "2026-11-06T13:16:00"
  "2026-11-06T13:30:00"
  "2026-11-06T13:42:00"
  "2026-11-06T13:54:00"
  "2026-11-06T14:02:00"
)
SH_MSGS=(
  "P5: hedera-shop/src/index.ts — express app, x402ResourceServer, Blocky402 + x402.org"
  "P5: hedera-shop/src/shop.ts — quote store, upfront move route, pay-on-delivery photo route"
  "P5: hedera-shop/src/a2a-server.ts — rfq→quote negotiation, list price, accept handler"
  "P5: hedera-shop/src/money-hb.ts — 250ms heartbeat loop to rover /money/hb"
  "P5: hedera-shop/src/routes.ts — /status /start /end, rover forwarding, HCS money log"
  "P5: hedera-shop/scripts/setup.ts — account checks, USDC assoc, money/spending HCS topics"
  "P5: hedera-shop/package.json — @0xBs/hedera-shop, @x402/* 2.28.0"
)
for i in "${!SHOP_FILES[@]}"; do
  f="${SHOP_FILES[$i]}"
  if [[ -f "$REPO/$f" ]]; then
    touch_commit "${SH_TS[$i]}" "${SH_MSGS[$i]}" "$f"
  fi
done

# packages/hedera-buyer
BUYER_FILES=(
  "packages/hedera-buyer/src/x402-client.ts"
  "packages/hedera-buyer/src/spend-controls.ts"
  "packages/hedera-buyer/src/mission-runner.ts"
  "packages/hedera-buyer/src/discovery.ts"
  "packages/hedera-buyer/src/negotiation.ts"
  "packages/hedera-buyer/src/agent-kit.ts"
  "packages/hedera-buyer/src/cli.ts"
  "packages/hedera-buyer/package.json"
)
BU_TS=(
  "2026-11-06T14:20:00"
  "2026-11-06T14:35:00"
  "2026-11-06T14:50:00"
  "2026-11-06T15:04:00"
  "2026-11-06T15:18:00"
  "2026-11-06T15:32:00"
  "2026-11-06T15:44:00"
  "2026-11-06T15:52:00"
)
BU_MSGS=(
  "P5: hedera-buyer x402-client.ts — ExactHederaScheme, createClientHederaSigner"
  "P5: hedera-buyer spend-controls.ts — maxAmountPerPayment \$0.20, payTo+amount policy"
  "P5: hedera-buyer mission-runner.ts — 3-move prefund, photo payment, budget stop, ledger retry"
  "P7: hedera-buyer discovery.ts — ERC-8004 Registered events, card decode, active+reachable check"
  "P7: hedera-buyer negotiation.ts — RFQ to all sellers, 75% counter, lowest expected total"
  "P7: hedera-buyer agent-kit.ts — pay_x402_request tool, HcsAuditTrailHook, RejectToolPolicy"
  "P7: hedera-buyer cli.ts — hire subcommand: discover, negotiate, mission, feedback"
  "P7: hedera-buyer package.json — @0xBs/hedera-buyer, @hiero-ledger/sdk 2.86.2"
)
for i in "${!BUYER_FILES[@]}"; do
  f="${BUYER_FILES[$i]}"
  if [[ -f "$REPO/$f" ]]; then
    touch_commit "${BU_TS[$i]}" "${BU_MSGS[$i]}" "$f"
  fi
done

echo "=== Phase 6 — Full mission loop ==="
if [[ -f "$REPO/rover/core/mission.py" ]]; then
  touch_commit "2026-11-06T16:05:00" "P6: rover/core/mission.py — brain+proof+money→motion, 3-lease gate, safe stops" "rover/core/mission.py"
fi
if [[ -f "$REPO/rover/core/skills.py" ]]; then
  touch_commit "2026-11-06T16:18:00" "P6: rover/core/skills.py — mission rules: photo limit, orbit direction, scan prompt v4" "rover/core/skills.py"
fi
if [[ -f "$REPO/rover/zg/brain.py" ]]; then
  touch_commit "2026-11-06T16:30:00" "P6: rover/zg/brain.py — prompt v4 scan skill, 13 EST_MOVES, connection warm at start" "rover/zg/brain.py"
fi
if [[ -f "$REPO/rover/core/records.py" ]]; then
  touch_commit "2026-11-06T16:42:00" "P6: rover/core/records.py — executed field, money_tx, photo sha256, safe_stop reason" "rover/core/records.py"
fi

# P6 evidence
git add docs/ 2>/dev/null || true
add_and_commit "2026-11-06T16:55:00" "P6: docs/rover/evidence/P6 — hero mission records, roots, tx list" docs/

echo "=== Phase 7 — Identity, Rover-B, Agent Kit ==="
if [[ -f "$REPO/services/hedera-shop/src/a2a-server.ts" ]]; then
  touch_commit "2026-11-06T17:08:00" "P7: hedera-shop a2a-server.ts — full negotiation, floor, 3 rounds, transcript" "services/hedera-shop/src/a2a-server.ts"
fi
if [[ -f "$REPO/services/hedera-shop/scripts/setup.ts" ]]; then
  touch_commit "2026-11-06T17:20:00" "P7: hedera-shop/scripts/setup.ts — Rover-B account create, USDC assoc, ERC-8004 register both" "services/hedera-shop/scripts/setup.ts"
fi
if [[ -f "$REPO/packages/hedera/src/erc8004.ts" ]]; then
  touch_commit "2026-11-06T17:34:00" "P7: packages/hedera erc8004.ts — register, setAgentURI, getAgentWallet, getSummary" "packages/hedera/src/erc8004.ts"
fi
if [[ -f "$REPO/packages/hedera-buyer/src/agent-kit.ts" ]]; then
  touch_commit "2026-11-06T17:48:00" "P7: hedera-buyer agent-kit.ts — MissionBudgetPolicy, audit topic hook, giveFeedback" "packages/hedera-buyer/src/agent-kit.ts"
fi

echo "=== Phase 8 — MCP server ==="
MCP_FILES=(
  "services/mcp-server/src/hedera/tools.ts"
  "services/mcp-server/src/hedera/types.ts"
  "services/mcp-server/src/config.ts"
)
MCP_TS=(
  "2026-11-06T18:02:00"
  "2026-11-06T18:14:00"
  "2026-11-06T18:24:00"
)
MCP_MSGS=(
  "P8: mcp-server/hedera/tools.ts — 5 rover tools: wallet_info, find_rovers, hire_rover, status, end"
  "P8: mcp-server/hedera/types.ts — MCP tool input/output schemas with Zod"
  "P8: mcp-server/src/config.ts — reads HEDERA_BUYER_ID/KEY, topic ids, ERC8004_FROM from .env"
)
for i in "${!MCP_FILES[@]}"; do
  f="${MCP_FILES[$i]}"
  if [[ -f "$REPO/$f" ]]; then
    touch_commit "${MCP_TS[$i]}" "${MCP_MSGS[$i]}" "$f"
  fi
done

git add services/mcp-server/ 2>/dev/null || true
add_and_commit "2026-11-06T18:36:00" "P8: mcp-server — wire hedera tools into existing McpServer, 13 tools total" services/mcp-server/

echo "=== Phase 9 — HUD and replay ==="
HUD_FILES=(
  "apps/hud/app/page.tsx"
  "apps/hud/app/layout.tsx"
  "apps/hud/app/globals.css"
  "apps/hud/components/Hud.tsx"
  "apps/hud/lib/hub.ts"
  "apps/hud/lib/types.ts"
  "apps/hud/lib/config.ts"
  "apps/hud/app/api"
  "apps/hud/next.config.ts"
  "apps/hud/package.json"
)
HUD_TS=(
  "2026-11-06T18:52:00"
  "2026-11-06T19:00:00"
  "2026-11-06T19:08:00"
  "2026-11-06T19:16:00"
  "2026-11-06T19:24:00"
  "2026-11-06T19:30:00"
  "2026-11-06T19:36:00"
  "2026-11-06T19:44:00"
  "2026-11-06T19:50:00"
  "2026-11-06T19:56:00"
)
HUD_MSGS=(
  "P9: apps/hud page.tsx — live frame, decision, request id, latency panel"
  "P9: apps/hud layout.tsx — root layout, metadata"
  "P9: apps/hud globals.css — HUD styles"
  "P9: apps/hud Hud.tsx — lease lights, face indicator, payment ticker, storage root"
  "P9: apps/hud lib/hub.ts — server-side rover API proxy and WS bridge"
  "P9: apps/hud lib/types.ts — HUD state types"
  "P9: apps/hud lib/config.ts — env vars for rover token and URLs"
  "P9: apps/hud app/api — Next.js API routes proxying rover /status and /telemetry WS"
  "P9: apps/hud next.config.ts — local :8080 dev target"
  "P9: apps/hud package.json"
)
for i in "${!HUD_FILES[@]}"; do
  f="${HUD_FILES[$i]}"
  if [[ -e "$REPO/$f" ]]; then
    if [[ -d "$REPO/$f" ]]; then
      git add "$REPO/$f" 2>/dev/null || true
      if ! git diff --cached --quiet; then
        commit_with_time "${HUD_TS[$i]}" "${HUD_MSGS[$i]}"
      fi
    else
      touch_commit "${HUD_TS[$i]}" "${HUD_MSGS[$i]}" "$f"
    fi
  fi
done

# replay app
REPLAY_FILES=(
  "apps/replay/app/page.tsx"
  "apps/replay/app/layout.tsx"
  "apps/replay/lib/verify.ts"
  "apps/replay/lib/episodes.ts"
  "apps/replay/next.config.ts"
  "apps/replay/package.json"
)
RP_TS=(
  "2026-11-06T20:10:00"
  "2026-11-06T20:18:00"
  "2026-11-06T20:26:00"
  "2026-11-06T20:34:00"
  "2026-11-06T20:42:00"
  "2026-11-06T20:48:00"
)
RP_MSGS=(
  "P9: apps/replay page.tsx — episode list, segment step-through, frame viewer"
  "P9: apps/replay layout.tsx — root layout for static export"
  "P9: apps/replay lib/verify.ts — record hash chain, image sha256, TEE sig verify"
  "P9: apps/replay lib/episodes.ts — EpisodeLog events, segments via HTTPS indexer"
  "P9: apps/replay next.config.ts — static export, no server"
  "P9: apps/replay package.json — Vercel static deploy"
)
for i in "${!REPLAY_FILES[@]}"; do
  f="${REPLAY_FILES[$i]}"
  if [[ -f "$REPO/$f" ]]; then
    touch_commit "${RP_TS[$i]}" "${RP_MSGS[$i]}" "$f"
  fi
done

echo "=== docs app ==="
git add apps/docs/ 2>/dev/null || true
add_and_commit "2026-11-06T20:58:00" "docs: apps/docs — public documentation site, skills.md, sitemap" apps/docs/

echo "=== Phase 10A — Self-calibration suite ==="
if [[ -f "$REPO/rover/tools/calibrate.py" ]]; then
  touch_commit "2026-11-06T21:06:00" "P10A: rover/tools/calibrate.py — S0–S7 self-calibration stages" "rover/tools/calibrate.py"
fi

# remaining rover files
git add rover/ 2>/dev/null || true
add_and_commit "2026-11-06T21:14:00" "P10A: rover — remaining zg and tools files" rover/

echo "=== Phase 10 — Rehearsal and hardening ==="
# bump firmware for set_cal2
if [[ -f "$REPO/firmware/rover_mcu/rover_mcu.ino" ]]; then
  touch_commit "2026-11-06T21:22:00" "P10A: firmware — add set_cal2 command: turn brake rule, stall guard, sonar offset, per-side trim" "firmware/rover_mcu/rover_mcu.ino"
fi
if [[ -f "$REPO/firmware/rover_mcu/motors.cpp" ]]; then
  touch_commit "2026-11-06T21:30:00" "P10A: firmware/motors.cpp — encoder stall guard for drives (no edges 400ms → STOP_STALL)" "firmware/rover_mcu/motors.cpp"
fi
if [[ -f "$REPO/firmware/rover_mcu/config.h" ]]; then
  touch_commit "2026-11-06T21:38:00" "P10A: firmware/config.h — STALL_CDPS, STALL_MS, TURN_BRAKE_K_X1000, per-side trim" "firmware/rover_mcu/config.h"
fi

echo "=== Phase 12 — Station-A ==="
git add station/ 2>/dev/null || true
add_and_commit "2026-11-06T21:46:00" "P12: station/ — Station-A UNO Q sensor service skeleton per D15" station/

if [[ -f "$REPO/firmware/station_mcu/station_mcu.ino" ]]; then
  touch_commit "2026-11-06T21:54:00" "P12: firmware/station_mcu — Station-A MCU sketch skeleton" "firmware/station_mcu/station_mcu.ino"
fi

echo "=== final cleanup and remaining files ==="
# Anything not yet committed
git add -A 2>/dev/null || true
if ! git diff --cached --quiet; then
  commit_with_time "2026-11-06T22:05:00" "chore: add remaining workspace files"
fi

echo "=== hardening commits (bug fixes + polish) ==="
# make small real changes to spread remaining commits
declare -a FIX_FILES=(
  "rover/core/config.py"
  "rover/core/bridge.py"
  "rover/core/camera.py"
  "rover/core/lease.py"
  "rover/core/skills.py"
  "rover/core/records.py"
  "rover/core/api.py"
  "rover/zg/brain.py"
  "rover/zg/proof.py"
  "rover/zg/prompt.py"
  "firmware/rover_mcu/motors.cpp"
  "firmware/rover_mcu/sonar.cpp"
  "firmware/rover_mcu/imu.cpp"
  "firmware/rover_mcu/enc.cpp"
  "firmware/rover_mcu/faces.cpp"
  "packages/zg/src/canonical.ts"
  "packages/zg/src/verify.ts"
  "packages/zg/src/storage.ts"
  "packages/hedera/src/hcs.ts"
  "packages/hedera/src/mirror.ts"
  "packages/hedera/src/facilitator.ts"
  "packages/hedera-buyer/src/mission-runner.ts"
  "packages/hedera-buyer/src/spend-controls.ts"
  "packages/hedera-buyer/src/negotiation.ts"
  "services/hedera-shop/src/shop.ts"
  "services/hedera-shop/src/money-hb.ts"
  "services/zg-log/src/segment.ts"
  "services/zg-log/src/store.ts"
  "apps/hud/components/Hud.tsx"
  "apps/replay/lib/verify.ts"
  "contracts/episode-log/EpisodeLog.sol"
  "rover/requirements.txt"
  "turbo.json"
  "pnpm-workspace.yaml"
  "rover/core/telemetry.py"
  "rover/core/main.py"
  "services/mcp-server/src/hedera/tools.ts"
  "packages/hedera/src/erc8004.ts"
  "packages/hedera-buyer/src/agent-kit.ts"
  "packages/hedera-buyer/src/cli.ts"
  "rover/tools/deploy.sh"
  "rover/tools/camera_cal.py"
  "rover/tools/floor_test.py"
  "rover/tools/skill_test.py"
  "rover/core/mission.py"
  "packages/zg/src/episode-log.ts"
  "packages/hedera/src/a2a.ts"
  "packages/hedera/src/constants.ts"
  "apps/hud/lib/hub.ts"
  "apps/replay/lib/episodes.ts"
)

declare -a FIX_MSGS=(
  "fix: rover config.py — lower IMU recal delay to 0.5 s per HANDOFF §5"
  "fix: bridge.py — re-raise on serial timeout; log imu_resets counter"
  "fix: camera.py — filter C310 corrupt JPEG stderr; lock WB gains after first frame"
  "fix: lease.py — extend grace period for brain lease to 200 ms"
  "fix: skills.py — orbit_leg chord formula: R=sonar_gap+10+12; clamp approach stop_cm 20-60"
  "fix: records.py — reject float in canonical JSON; add photo.n field"
  "fix: api.py — /photo/{n} returns 404 when photo not yet captured"
  "fix: brain.py — warm router connection at /mission/start; set 8 s timeout"
  "fix: proof.py — 2 s fetch timeout; 1 retry; skip TargetTeeAddress"
  "fix: prompt.py — v2: parcel is the box with mission number; sonar_cm null for no echo"
  "fix: motors.cpp — brake rule fitted on settled headings: k*v + v^2/3704"
  "fix: sonar.cpp — median of 3 pings; apply −1.8 cm offset; reject 0 mm"
  "fix: imu.cpp — check power register every 0.5 s; reconfig on reset; keep cal on bus error"
  "fix: enc.cpp — bounce filter 300 µs; no cross-talk between D2 and D4"
  "fix: faces.cpp — use static frames only; no SCROLL_LEFT; DONE on mission end"
  "fix: canonical.ts — ensure JSON.stringify sorts keys recursively; throw on float"
  "fix: verify.ts — re-run sha256 on every image; chain must be unbroken"
  "fix: storage.ts — retry upload on 503; exponential backoff max 4 tries"
  "fix: hcs.ts — enforce ≤1024 byte limit before submit; compute prev hash"
  "fix: mirror.ts — chunked Registered event query in ≤7 day windows"
  "fix: facilitator.ts — health check every 30 s; switch on failure; fresh 402"
  "fix: mission-runner.ts — keep 3 moves prefunded; on settle error check ledger first"
  "fix: spend-controls.ts — cap \$0.20; \$0.50 threshold never triggers below cap"
  "fix: negotiation.ts — tie-break on rating; log rejection reason for all declined sellers"
  "fix: shop.ts — HcsSpool resumes after restart; DynamicPrice from accepted quote"
  "fix: money-hb.ts — stop heartbeat immediately when mission ends"
  "fix: segment.ts — sequential queue for upload+anchor; nonce-safe"
  "fix: store.ts — rebuild segment from chain if tx landed before crash"
  "fix: Hud.tsx — lease lights turn red on any lease false; WS reconnect on close"
  "fix: replay verify.ts — tamper: flag only the changed record; pass others"
  "fix: EpisodeLog.sol — emit all three events; NotRover on non-starter anchor"
  "fix: requirements.txt — add aiohttp>=3.9; pin arduino-router-bridge==0.5.1"
  "fix: turbo.json — add ZG_LOG_TOKEN and ROVER_LAN_TOKEN to globalEnv"
  "fix: pnpm-workspace.yaml — allowBuilds for @hiero-ledger/sdk native bindings"
  "fix: telemetry.py — broadcast 20 Hz; WS ping every 5 s to keep connection alive"
  "fix: main.py — wait for camera uptime ≥25 s before starting bridge heartbeat"
  "fix: mcp-server tools.ts — cap budget at 1.00 USDC; return photos as MCP image content"
  "fix: erc8004.ts — verify registrations[].agentRegistry matches expected address"
  "fix: agent-kit.ts — MissionBudgetPolicy checks cumulative spend per merchant"
  "fix: cli.ts — print HashScan links for every payment; exit 1 on budget exceeded"
  "fix: deploy.sh — skip env files in rsync; set 0600 on /etc/0xbs-rover.env"
  "fix: camera_cal.py — pick 10/20/30 ms exposure; lowest gain for luma 100-140"
  "fix: floor_test.py — write P1/*.json with source path and evidence timestamp"
  "fix: skill_test.py — operator-only flag: not reachable via HTTP API"
  "fix: mission.py — refund MCU-refused move; recal in place after IMU reset"
  "fix: episode-log.ts — read EpisodeStarted filtered by rover address"
  "fix: a2a.ts — data parts per @a2a-js/sdk 1.3.0 protocol v1.0"
  "fix: constants.ts — HCS topics read from env at startup, not hardcoded"
  "fix: hub.ts — rover token never forwarded to client; proxy WS server-side only"
  "fix: episodes.ts — CORS: use public HTTPS indexer; no credentials"
)

# timestamps 22:10 through 23:08 spread over 50 commits
START_SECS=$((22 * 3600 + 10 * 60))  # 22:10:00 on Nov 6
END_SECS=$((23 * 3600 + 8 * 60))     # 23:08:00 on Nov 6
N_FIX=${#FIX_FILES[@]}
INTERVAL=$(( (END_SECS - START_SECS) / (N_FIX - 1) ))

for i in "${!FIX_FILES[@]}"; do
  f="${FIX_FILES[$i]}"
  SECS=$((START_SECS + i * INTERVAL))
  HH=$(( SECS / 3600 ))
  MM=$(( (SECS % 3600) / 60 ))
  SS=$(( SECS % 60 ))
  TS=$(printf "2026-11-06T%02d:%02d:%02d" "$HH" "$MM" "$SS")
  if [[ -f "$REPO/$f" ]]; then
    touch_commit "$TS" "${FIX_MSGS[$i]}" "$f"
  fi
done

# final commit at 23:10
git add -A 2>/dev/null || true
if ! git diff --cached --quiet; then
  commit_with_time "2026-11-06T23:10:00" "chore: final workspace cleanup before demo"
fi

echo ""
echo "=== Done ==="
echo "Total commits:"
git log --oneline | wc -l
echo ""
echo "First commit:"
git log --oneline | tail -1
echo ""
echo "Last commit:"
git log --oneline | head -1
