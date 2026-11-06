#!/bin/sh
# One-time, on the board: sudo sh ~/0xbs-rover/rover/tools/install_usb_host.sh
# Copies the watcher out of the install folder, so it keeps working whichever folder the rover runs from.
set -e
HERE="$(dirname "$(readlink -f "$0")")"
install -m 755 "$HERE/../systemd/usb-host.sh" /usr/local/bin/rover-usb-host
install -m 644 "$HERE/../systemd/rover-usb-host.service" /etc/systemd/system/rover-usb-host.service
systemctl daemon-reload
systemctl enable --now rover-usb-host.service
systemctl --no-pager --lines=0 status rover-usb-host.service
echo "USB-C role now: $(cat /sys/class/usb_role/4e00000.usb-role-switch/role)"
