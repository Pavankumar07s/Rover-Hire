#!/bin/sh
# One-time, on the board: sudo ~/0xbs-rover/rover/tools/install_services.sh
set -e
cp /home/arduino/0xbs-rover/rover/systemd/rover.service /home/arduino/0xbs-rover/rover/systemd/rover-keepalive.service /etc/systemd/system/
# Operator tools (camera_cal, skill_test) must stop the service that owns the camera and the Bridge.
RULE=/etc/sudoers.d/40-0xbs-rover
echo 'arduino ALL=(root) NOPASSWD: /usr/bin/systemctl stop rover.service, /usr/bin/systemctl start rover.service, /usr/bin/systemctl restart rover.service' > "$RULE.tmp"
chmod 440 "$RULE.tmp"
/usr/sbin/visudo -cf "$RULE.tmp"
mv "$RULE.tmp" "$RULE"
systemctl daemon-reload
systemctl enable --now rover-keepalive.service rover.service
sh /home/arduino/0xbs-rover/rover/tools/install_usb_host.sh
systemctl --no-pager --lines=0 status rover-keepalive.service rover.service
