"""Signed station data (plan D17): EIP-191 over the canonical JSON (plan §3.4) without "sig"."""
import json

from eth_account import Account
from eth_account.messages import encode_defunct


def check_no_floats(o, path="$") -> None:
    if isinstance(o, float):
        raise TypeError(f"float at {path}: station data holds integers only (D10)")
    if isinstance(o, dict):
        for k, v in o.items():
            check_no_floats(v, f"{path}.{k}")
    elif isinstance(o, (list, tuple)):
        for i, v in enumerate(o):
            check_no_floats(v, f"{path}[{i}]")


def canonical(o) -> str:
    check_no_floats(o)
    return json.dumps(o, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


class Signer:
    def __init__(self, private_key: str):
        self._account = Account.from_key(private_key)
        self.address = self._account.address

    def sign(self, body: dict) -> dict:
        body = {**body, "signer": self.address}
        sig = self._account.sign_message(encode_defunct(text=canonical(body))).signature.hex()
        return {**body, "sig": sig if sig.startswith("0x") else "0x" + sig}


def recover(signed: dict) -> str:
    body = {k: v for k, v in signed.items() if k != "sig"}
    return Account.recover_message(encode_defunct(text=canonical(body)), signature=signed["sig"])
