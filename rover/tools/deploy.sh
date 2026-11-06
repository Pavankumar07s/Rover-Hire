#!/usr/bin/env bash
# Copies rover/ and firmware/rover_mcu to the UNO Q and prepares the venv. Never copies env files.
# Usage: rover/tools/deploy.sh [--flash] [--with-calibration]   (ROVER_HOST defaults to rovera.local; ROVER_DIR to
# 0xbs-rover, a folder in the board's home: a phase in progress installs next to the working rover, e.g.
# ROVER_DIR=0xbs-rover-p10a)
# The board's calibration (calibration.json, camera.json and their candidates) belongs to the board: the suite measured
# it on the floor there. It is kept across a deploy; --with-calibration sends the repo's copies instead
# (a deploy replaced rover/ and wiped the S3 values the suite had just applied).
set -euo pipefail
HOST="${ROVER_HOST:-rovera.local}"
DIR="${ROVER_DIR:-0xbs-rover}"
[[ "$DIR" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "ROVER_DIR must be a plain folder name" >&2; exit 1; }
FLASH=0
KEEP=1
for arg in "$@"; do
  case "$arg" in
    --flash) FLASH=1 ;;
    --with-calibration) KEEP=0 ;;
    *) echo "unknown option: $arg" >&2; exit 1 ;;
  esac
done
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=6 "arduino@$HOST")
CAL_FILES="rover/core/calibration.json rover/core/camera.json rover/core/calibration.candidate.json rover/core/camera.candidate.json"

if [ "$KEEP" = 1 ]; then
  "${SSH[@]}" "cd ~ && mkdir -p $DIR && cd $DIR && rm -rf .kept && mkdir .kept \
    && for f in $CAL_FILES; do if [ -f \$f ]; then mkdir -p .kept/\$(dirname \$f) && cp -p \$f .kept/\$f; fi; done"
fi
"${SSH[@]}" "mkdir -p ~/$DIR/firmware ~/$DIR/evidence && rm -rf ~/$DIR/rover ~/$DIR/firmware/rover_mcu"
tar -C "$ROOT" --exclude='__pycache__' --exclude='.env*' --exclude='*.env' -cf - rover firmware/rover_mcu \
  | "${SSH[@]}" "tar -C ~/$DIR -xf -"
if [ "$KEEP" = 1 ]; then
  "${SSH[@]}" "cd ~/$DIR && for f in $CAL_FILES; do if [ -f .kept/\$f ]; then cp -p .kept/\$f \$f && echo kept the board\\'s \$f; fi; done; rm -rf .kept"
fi

"${SSH[@]}" "cd ~/$DIR && { [ -x venv/bin/python ] || python3 -m venv --system-site-packages venv; } \
  && venv/bin/pip install -q -r rover/requirements.txt && echo deployed to \$(hostname):~/$DIR"

if [ "$FLASH" = 1 ]; then
  "${SSH[@]}" "cd ~/$DIR && arduino-cli compile -b arduino:zephyr:unoq:wait_linux_boot=yes --upload firmware/rover_mcu"
fi
 
 


# Never copy env files: --exclude '.env' --exclude '*.env' --exclude '0xbs-rover.env'
# After deploy, ensure the board's env file has mode 0600:
#   ssh arduino@rover.local 'chmod 0600 /etc/0xbs-rover.env'
# deploy.sh --with-calibration sends the repo's calibration.json to the board
# (default: board's own calibration.json is preserved).
