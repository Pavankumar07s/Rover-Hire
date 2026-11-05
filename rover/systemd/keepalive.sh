#!/bin/sh
# 20 packets/s to the gateway keeps the UNO Q radio awake (HANDOFF §9: avg 91 ms -> 19 ms).
while true; do
  gw=$(ip -4 route show default | awk '{print $3; exit}')
  if [ -n "$gw" ]; then ping -i 0.05 -q -w 60 "$gw" > /dev/null 2>&1; else sleep 1; fi
done
