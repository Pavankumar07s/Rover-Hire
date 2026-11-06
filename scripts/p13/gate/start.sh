#!/bin/sh
# Phase 13 gate, rover side: the test receiver (127.0.0.1:8790) and a Cloudflare quick tunnel to it. Prints the URL.
cd "$(dirname "$0")/.." || exit 1
set -a; . ./gate.env; set +a
setsid nohup python3 gate/hb_receiver.py 8790 > gate/receiver.log 2>&1 < /dev/null & echo $! > gate/receiver.pid
setsid nohup bin/cloudflared tunnel --no-autoupdate --url http://127.0.0.1:8790 > gate/tunnel.log 2>&1 < /dev/null & echo $! > gate/tunnel.pid
for i in $(seq 1 30); do
  u=$(grep -o "https://[a-z0-9-]*\.trycloudflare\.com" gate/tunnel.log | head -1); [ -n "$u" ] && break; sleep 1
done
echo "$u" > gate/tunnel.url; echo "tunnel: $u"
