#!/bin/sh
# Build OxBS.zip for Arduino IDE: Sketch → Include Library → Add .ZIP Library.
# No .git, no __MACOSX, no AppleDouble (._) files.
set -e
ROOT="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

mkdir -p "$STAGE/OxBS"
cp "$ROOT/library.properties" "$ROOT/keywords.txt" "$ROOT/README.md" "$STAGE/OxBS/"
cp -R "$ROOT/src" "$ROOT/examples" "$STAGE/OxBS/"

# macOS zip otherwise writes __MACOSX and ._* resource forks that Arduino cannot extract.
export COPYFILE_DISABLE=1
rm -f "$ROOT/OxBS.zip"
(
  cd "$STAGE"
  zip -r -X "$ROOT/OxBS.zip" OxBS -x "*.DS_Store"
)

echo "wrote $ROOT/OxBS.zip"
