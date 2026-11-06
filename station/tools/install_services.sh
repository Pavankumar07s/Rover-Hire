#!/bin/sh
# One-time, on the board: sudo ~/0xbs-station/station/tools/install_services.sh
set -e
cp /home/arduino/0xbs-station/station/systemd/station.service /home/arduino/0xbs-station/station/systemd/station-keepalive.service /etc/systemd/system/
# Deploys restart the service without a password, and only this service.
RULE=/etc/sudoers.d/40-0xbs-station
echo 'arduino ALL=(root) NOPASSWD: /usr/bin/systemctl stop station.service, /usr/bin/systemctl start station.service, /usr/bin/systemctl restart station.service' > "$RULE.tmp"
chmod 440 "$RULE.tmp"
/usr/sbin/visudo -cf "$RULE.tmp"
mv "$RULE.tmp" "$RULE"
systemctl daemon-reload
systemctl enable --now station-keepalive.service station.service
systemctl --no-pager --lines=0 status station-keepalive.service station.service
