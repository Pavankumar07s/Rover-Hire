#!/bin/sh
# Phase 13 gate, rover side: stop the test receiver and the tunnel (by their saved PIDs).
cd "$(dirname "$0")" || exit 1
for f in tunnel.pid receiver.pid; do [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null; rm -f "$f"; done
echo stopped
