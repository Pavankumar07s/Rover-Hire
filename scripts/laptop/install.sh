#!/usr/bin/env bash
# The laptop side of Rover for Hire as systemd user services: zg-log (:8787), Rover-A's shop (:8402), Rover-B's shop
# (:8403), Station-A's shop (:8404), the HUD (:8080) and a local copy of the replay site (:3005). They start at boot (linger: before anyone logs in) and restart 3 s after any stop, so a
# crash or a sudden power-off needs nothing done by hand. Logs: journalctl --user -u 'rover-*' -f
# Usage: scripts/laptop/install.sh               build, write the units, (re)start everything
#        scripts/laptop/install.sh --uninstall   stop and remove them
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
UNITS="$HOME/.config/systemd/user"
NODE="$(command -v node)"
PYTHON="$(command -v python3)"
SERVICES=(rover-zglog rover-shop-a rover-shop-b rover-shop-s rover-hud rover-replay)

if [ "${1:-}" = "--uninstall" ]; then
  systemctl --user disable --now rover-laptop.target "${SERVICES[@]}" 2>/dev/null || true
  for s in "${SERVICES[@]}"; do rm -f "$UNITS/$s.service"; done
  rm -f "$UNITS/rover-laptop.target"
  systemctl --user daemon-reload
  echo "removed the rover services"
  exit 0
fi

# A copy started by hand would hold the port, and the service would fail and restart forever.
for port in 8787 8402 8403 8404 8080 3005; do
  pid=$(ss -ltnpH "sport = :$port" | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2 || true)
  if [ -n "$pid" ] && ! grep -q 'rover-' "/proc/$pid/cgroup" 2>/dev/null; then
    echo "port $port is held by pid $pid ($(tr '\0' ' ' < "/proc/$pid/cmdline" | cut -c1-80)): stop it first" >&2
    exit 1
  fi
done

(cd "$ROOT" && pnpm --filter "@0xBs/zg-log..." --filter "@0xBs/hedera-shop..." --filter "hud..." --filter "replay..." build)

mkdir -p "$UNITS"
unit() {  # name, description, working dir, environment ("" for none), command
  local name=$1 desc=$2 dir=$3 env=$4
  shift 4
  {
    echo "[Unit]"
    echo "Description=Rover for Hire: $desc"
    echo "PartOf=rover-laptop.target"
    echo "StartLimitIntervalSec=0"
    echo
    echo "[Service]"
    echo "WorkingDirectory=$dir"
    [ -n "$env" ] && echo "Environment=$env"
    echo "ExecStart=$*"
    echo "Restart=always"
    echo "RestartSec=3"
    echo
    echo "[Install]"
    echo "WantedBy=rover-laptop.target"
  } > "$UNITS/$name.service"
}
unit rover-zglog "zg-log, the 0G Storage and EpisodeLog writer (:8787)" "$ROOT/services/zg-log" "" "$NODE $ROOT/services/zg-log/dist/index.js"
unit rover-shop-a "Rover-A's shop (:8402)" "$ROOT/services/hedera-shop" "SELLER=a" "$NODE $ROOT/services/hedera-shop/dist/index.js"
unit rover-shop-b "Rover-B's shop, simulated (:8403)" "$ROOT/services/hedera-shop" "SELLER=b" "$NODE $ROOT/services/hedera-shop/dist/index.js"
unit rover-shop-s "Station-A's shop, the sensor station (:8404)" "$ROOT/services/hedera-shop" "SELLER=s" "$NODE $ROOT/services/hedera-shop/dist/index.js"
unit rover-hud "the live HUD (http://127.0.0.1:8080)" "$ROOT/apps/hud" "" \
  "$NODE $ROOT/apps/hud/node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 8080"
unit rover-replay "the replay site, a local copy of the static export (http://127.0.0.1:3005)" "$ROOT/apps/replay" "" \
  "$PYTHON $ROOT/scripts/laptop/replay_server.py 3005 $ROOT/apps/replay/out"
cat > "$UNITS/rover-laptop.target" <<EOF
[Unit]
Description=Rover for Hire: the laptop services (zg-log, the three shops, the HUD, the replay site)

[Install]
WantedBy=default.target
EOF

[ "$(loginctl show-user "$USER" -p Linger --value)" = yes ] || loginctl enable-linger "$USER"
systemctl --user daemon-reload
systemctl --user enable rover-laptop.target "${SERVICES[@]}" >/dev/null 2>&1
systemctl --user restart rover-laptop.target

for i in $(seq 1 30); do
  up=0
  curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8787/health && up=$((up + 1))
  curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8402/health && up=$((up + 1))
  curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8403/health && up=$((up + 1))
  curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8404/health && up=$((up + 1))
  curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/ && up=$((up + 1))
  curl -sf -o /dev/null --max-time 2 http://127.0.0.1:3005/ && up=$((up + 1))
  [ $up -eq 6 ] && break
  sleep 1
done
systemctl --user --no-pager list-units 'rover-*' --all
[ $up -eq 6 ] && echo "all six answer; they start at boot and restart after any stop" || { echo "only $up of 6 answer: journalctl --user -u 'rover-*'" >&2; exit 1; }
