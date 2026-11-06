#!/usr/bin/env bash
# Saves the Neon connection string into scripts/p13/.env (0600) without showing it or keeping it in shell history.
set -euo pipefail
ENV="$(dirname "$(readlink -f "$0")")/.env"
read -rs -p "Paste the Neon connection string, then press Enter: " U; echo
U="${U#psql }"; U="${U//\'/}"; U="${U//\"/}"; U="$(printf '%s' "$U" | tr -d '[:space:]')"
case "$U" in postgres://*|postgresql://*) ;; *) echo "Not saved: it must start with postgresql:// (got ${#U} characters)."; exit 1;; esac
sed -i '/^P13_DATABASE_URL=/d' "$ENV"
printf 'P13_DATABASE_URL=%s\n' "$U" >> "$ENV"
chmod 600 "$ENV"
echo "Saved (${#U} characters, host ${U##*@}" | sed -E 's#[/?].*##; s/$/)/'
