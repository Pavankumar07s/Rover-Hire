"""Decision records (plan §3.3): canonical JSON (§3.4), integers only (D10), sha256 hash chain."""

import hashlib
import json

GENESIS = "0" * 64


def check_no_floats(o, path="$") -> None:
    if isinstance(o, float):
        raise TypeError(f"float at {path}: records hold integers only (D10)")
    if isinstance(o, dict):
        for k, v in o.items():
            check_no_floats(v, f"{path}.{k}")
    elif isinstance(o, (list, tuple)):
        for i, v in enumerate(o):
            check_no_floats(v, f"{path}[{i}]")


def canonical(o) -> bytes:
    check_no_floats(o)
    return json.dumps(o, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def record_hash(record: dict) -> str:
    return hashlib.sha256(canonical({k: v for k, v in record.items() if k != "hash"})).hexdigest()


def verify_chain(records) -> None:
    """Raises ValueError at the first record whose hash, link or sequence is wrong."""
    prev, episode = GENESIS, None
    for i, r in enumerate(records):
        episode = episode or r["episode_id"]
        if r["episode_id"] != episode or r["seq"] != i or r["prev_hash"] != prev:
            raise ValueError(f"record {i}: broken link")
        if record_hash(r) != r["hash"]:
            raise ValueError(f"record {i}: hash mismatch")
        prev = r["hash"]


class Chain:
    def __init__(self, episode_id: str):
        self.episode_id = episode_id
        self.seq = 0
        self.prev = GENESIS

    def append(self, fields: dict) -> dict:
        record = {"v": 1, "episode_id": self.episode_id, "seq": self.seq, "prev_hash": self.prev, **fields}
        record["hash"] = record_hash(record)
        self.seq += 1
        self.prev = record["hash"]
        return record
