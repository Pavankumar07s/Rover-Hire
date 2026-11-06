#!/bin/sh
# Phase 13: switch between local (the stable setup, the default) and hybrid (anyone's Claude can hire the rover
# through the remote MCP). The stable services are never stopped or restarted in either direction.
# Usage: mode.sh local | hybrid | toggle | status | install
DIR=$(cd "$(dirname "$0")" && pwd)
set -a; . "$DIR/.env"; set +a
note() { echo "$1"; notify-send "Rover for Hire" "$1" 2>/dev/null || true; }
render_remote() { curl -s -m 20 "$RENDER_URL/health" | grep -q '"remote_access":true'; }
case "$1" in
  install)
    cp "$DIR"/systemd/p13-edge.service "$DIR"/systemd/p13-tunnel.service ~/.config/systemd/user/ && systemctl --user daemon-reload
    mkdir -p ~/.local/share/applications && rm -f ~/.local/share/applications/rover-remote-access.desktop  # old name, cached by GNOME with an old path
    sed "s|@MODE@|$DIR/mode.sh|" "$DIR/rover-remote-access.desktop" > ~/.local/share/applications/rover-for-hire-remote.desktop
    echo "installed p13-edge, p13-tunnel (never enabled at boot) and the launcher \"Rover: remote access\"" ;;
  hybrid)
    systemctl --user start p13-tunnel
    if render_remote; then note "Remote access ON: anyone with a key can hire the rover. Your local MCP still works."
    else note "Remote access NOT confirmed by $RENDER_URL. Run: mode.sh status"; exit 1; fi ;;
  local)
    curl -s -m 20 -X DELETE -H "x-p13-owner-key: $P13_OWNER_KEY" "$RENDER_URL/owner/tunnel" > /dev/null || true
    systemctl --user stop p13-tunnel p13-edge
    note "Remote access OFF: only your local MCP can hire the rover." ;;
  toggle)
    if systemctl --user -q is-active p13-tunnel; then "$0" local; else "$0" hybrid; fi ;;
  status)
    for u in p13-edge p13-tunnel rover-shop-a rover-shop-b rover-zglog rover-hud rover-replay; do
      printf '%-14s %s\n' "$u" "$(systemctl --user is-active "$u")"
    done
    echo "render: $(curl -s -m 20 "$RENDER_URL/health")" ;;
  *) echo "usage: mode.sh local | hybrid | toggle | status | install"; exit 2 ;;
esac
