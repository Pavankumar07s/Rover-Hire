#!/bin/sh
# p13-tunnel's ExecStartPost: wait for this start's quick-tunnel address and give it to the Render service (owner key).
# A restarted tunnel gets a new address, and this runs again. Always exits 0, so the tunnel itself keeps running.
DIR=$(cd "$(dirname "$0")" && pwd)
set -a; . "$DIR/.env"; set +a
since=$(date -d '-3 sec' '+%Y-%m-%d %H:%M:%S')
for i in $(seq 1 45); do
  url=$(journalctl --user -u p13-tunnel --since "$since" -o cat 2>/dev/null | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1)
  [ -n "$url" ] && break
  sleep 1
done
[ -z "$url" ] && { echo "p13: no tunnel address after 45 s"; exit 0; }
for i in 1 2 3; do
  curl -s -m 20 -X POST -H "x-p13-owner-key: $P13_OWNER_KEY" -H 'content-type: application/json' \
    -d "{\"url\":\"$url\"}" "$RENDER_URL/owner/tunnel" | grep -q '"remote_access":true' && { echo "p13: remote access on via $url"; exit 0; }
  sleep 5
done
echo "p13: could not tell $RENDER_URL the tunnel address"
exit 0
