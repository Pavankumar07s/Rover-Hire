#!/bin/sh
# The UNO Q's USB-C port must stay a USB host: the camera hangs off the hub on it. Once the port turned itself to
# "device" 4 s after the camera came up at boot, and the camera was gone until the role was set back by hand.
# To plug the board into a computer as a USB device, stop this first: sudo systemctl stop rover-usb-host
ROLE="${USB_ROLE_FILE:-/sys/class/usb_role/4e00000.usb-role-switch/role}"
while true; do
  if [ "$(cat "$ROLE" 2>/dev/null)" = device ]; then
    echo host > "$ROLE" && logger -t rover-usb-host "the USB-C port had turned to device mode: set back to host"
  fi
  sleep "${USB_ROLE_CHECK_S:-2}"
done
