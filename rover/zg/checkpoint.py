"""One checkpoint: ask 0G, prove the answer, write the record. Never raises; a failure becomes a safe stop."""

import hashlib
import json

from .brain import MODEL, BrainError, Brain, new_nonce
from .prompt import PROMPT_VERSION, SCAN_PROMPT_VERSION, SKILLS, SWEEP_PROMPT_VERSION, SWEEP_VIEWS
from .proof import ProofError, Prover, empty_proof

FAULTS = ("corrupt_signature", "wrong_nonce")


def run_checkpoint(brain: Brain, prover: Prover, chain, jpeg: bytes, t_frame_ms: int, frame_age_s: float,
                   make_sensors, fault: str | None = None, model: str = MODEL) -> tuple[dict, dict]:
    """Decide-only checkpoint: (sealed record, timings)."""
    fields, timings = checkpoint_fields(brain, prover, jpeg, t_frame_ms, frame_age_s, make_sensors, fault, model)
    return chain.append(fields), timings


def checkpoint_fields(brain: Brain, prover: Prover, jpeg: bytes, t_frame_ms: int, frame_age_s: float,
                      make_sensors, fault: str | None = None, model: str = MODEL, allowed=SKILLS,
                      orbit: str | None = None, scan: dict | None = None, number: str | None = None) -> tuple[dict, dict]:
    """Ask 0G and prove the answer; the record fields, not yet sealed, so the mission can add what it executed.
    make_sensors(nonce) -> sensors JSON string. scan: the rules for a scan's sheet of views; number: the parcel's,
    which a photo must name (Brain.decide)."""
    nonce = new_nonce()
    sensors = make_sensors(nonce)
    expect = new_nonce() if fault == "wrong_nonce" else None
    timings = {"sig_fetch_ms": []}
    fields = {
        "t_frame_ms": t_frame_ms, "t_sent_ms": None, "t_reply_ms": None, "latency_ms": None,
        "img_sha256": hashlib.sha256(jpeg).hexdigest(), "sensors_json": sensors,
        "prompt_version": PROMPT_VERSION if scan is None else SWEEP_PROMPT_VERSION if scan.get("views") == SWEEP_VIEWS else SCAN_PROMPT_VERSION, "allowed_skills": list(allowed), "nonce": nonce, "nonce_echoed": False,
        "model": model, "provider": None, "request_id": None, "chat_id": None, "billing_usd_micro": None,
        "raw_response": None, "decision": None, "proof": empty_proof(),
        "leases": {"brain": False, "proof": False, "money": False},
        "executed": None, "safe_stop": None, "quote_id": None, "move_index": None, "money_tx": None, "photo": None,
    }
    if fault:
        fields["test_fault"] = fault
    try:
        info = brain.decide(jpeg, frame_age_s, sensors, nonce, expect_nonce=expect, model=model, allowed=allowed,
                            orbit=orbit, scan=scan, number=number)
    except BrainError as e:
        info = e.info
        _copy_reply(fields, info, nonce)
        fields["safe_stop"] = {"reason": "0G?", "detail": str(e)}
        return fields, timings
    _copy_reply(fields, info, nonce)
    fields["decision"] = info["decision"]
    fields["leases"]["brain"] = True
    try:
        fields["proof"], timings["sig_fetch_ms"] = prover.verify(info["chat_id"], corrupt_signature=fault == "corrupt_signature")
        fields["leases"]["proof"] = True
    except ProofError as e:
        fields["proof"], timings["sig_fetch_ms"] = e.proof, e.fetch_ms
        fields["safe_stop"] = {"reason": "!TEE", "detail": str(e)}
    return fields, timings


def _copy_reply(fields: dict, info: dict, nonce: str) -> None:
    for k in ("t_sent_ms", "t_reply_ms", "provider", "request_id", "chat_id", "billing_usd_micro", "raw_response"):
        if k in info:
            fields[k] = info[k]
    if fields["t_sent_ms"] is not None and fields["t_reply_ms"] is not None:
        fields["latency_ms"] = fields["t_reply_ms"] - fields["t_sent_ms"]
    try:
        fields["nonce_echoed"] = json.loads(info.get("raw_response") or "").get("nonce") == nonce
    except (ValueError, AttributeError):
        fields["nonce_echoed"] = False
