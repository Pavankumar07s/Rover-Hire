"""Creates Station-A's signing key and LAN token once, on the board, in ~/0xbs-station/station.env (0600).
Prints only the public signer address. Never overwrites an existing file.  venv/bin/python -m station.tools.new_identity"""
import os
import secrets
import sys
from pathlib import Path

from eth_account import Account

path = Path.home() / "0xbs-station" / "station.env"
if path.exists():
    sys.exit(f"{path} exists already; signer {Account.from_key(dict(l.split('=', 1) for l in path.read_text().split() if '=' in l)['STATION_PRIVATE_KEY']).address}")
key = "0x" + secrets.token_hex(32)
token = secrets.token_urlsafe(32)
fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
os.write(fd, f"STATION_PRIVATE_KEY={key}\nSTATION_LAN_TOKEN={token}\n".encode())
os.close(fd)
print(f"created {path} (0600); signer {Account.from_key(key).address}")
