#!/usr/bin/env bash
# Phase 13 poor-network test: slow down and drop the laptop's internet traffic, but not its local Wi-Fi (the rover, the
# hotspot), so the shop -> rover money heartbeat stays local as in the real hybrid setup.
#   sudo scripts/p13/netem.sh on 300ms 2%    sudo scripts/p13/netem.sh off    scripts/p13/netem.sh show
set -euo pipefail
DEV=$(ip route get 1.1.1.1 | grep -oP 'dev \K\S+')
LAN=$(ip -4 route | awk -v d="$DEV" '$0 ~ ("dev " d) && /proto kernel/ {print $1; exit}')
case "${1:-show}" in
  on)
    DELAY=${2:-300ms} LOSS=${3:-2%}
    tc qdisc del dev "$DEV" root 2>/dev/null || true
    tc qdisc add dev "$DEV" root handle 1: prio bands 3 priomap 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0
    tc qdisc add dev "$DEV" parent 1:3 handle 30: netem delay "$DELAY" loss "$LOSS"
    tc filter add dev "$DEV" parent 1: protocol ip prio 1 u32 match ip dst "$LAN" flowid 1:1
    tc filter add dev "$DEV" parent 1: protocol ipv6 prio 2 u32 match ip6 dst fe80::/10 flowid 1:1
    tc filter add dev "$DEV" parent 1: protocol ip prio 3 u32 match ip dst 0.0.0.0/0 flowid 1:3
    tc filter add dev "$DEV" parent 1: protocol ipv6 prio 4 u32 match ip6 dst ::/0 flowid 1:3
    echo "netem ON on $DEV: internet traffic +$DELAY and $LOSS loss; local $LAN untouched" ;;
  off)
    tc qdisc del dev "$DEV" root 2>/dev/null || true
    echo "netem OFF on $DEV" ;;
  show)
    tc qdisc show dev "$DEV"; tc filter show dev "$DEV" ;;
  *) echo "usage: netem.sh on [delay] [loss] | off | show"; exit 2 ;;
esac
