"""Our own TEE check for every 0G decision (HANDOFF §6.4): on-chain signer, provider signature, EIP-191 recovery.
Private mode omits tee_verified by design, so nothing here trusts the router's or the SDK's verdict."""

import json
import time

import requests
from eth_abi import decode, encode
from eth_account import Account
from eth_account.messages import encode_defunct
from eth_utils import keccak

RPC_URL = "https://evmrpc.0g.ai"
INFERENCE_SERVING = "0x47340d900bdFec2BD393c626E12ea0656F938d84"  # mainnet, chain 16661
SIG_PREFIX = "zg-sig-v1/e2ee-ct:"
SIG_TIMEOUT_S = 2.0  # P3, 75 fetches: median 0.1 s, p99 1.2 s, max 3.7 s (cold); the plan keeps 2 s while p99 < 2 s
SIG_TRIES = 2
SERVICE_FIELDS = ("provider", "serviceType", "url", "inputPrice", "outputPrice", "updatedAt", "model",
                  "verifiability", "additionalInfo", "teeSignerAddress", "teeSignerAcknowledged")
SERVICE_TUPLE = "(address,string,string,uint256,uint256,uint256,string,string,string,address,bool)"


class ProofError(RuntimeError):
    """The decision is not proven. `proof` is the record's proof block as far as it got."""

    def __init__(self, reason: str, proof: dict, fetch_ms: list | None = None):
        super().__init__(reason)
        self.proof = proof
        self.fetch_ms = fetch_ms or []


def read_service(provider: str, session: requests.Session) -> dict:
    data = keccak(text="getService(address)")[:4] + encode(["address"], [provider])
    r = session.post(RPC_URL, timeout=10, json={"jsonrpc": "2.0", "id": 1, "method": "eth_call",
                                                "params": [{"to": INFERENCE_SERVING, "data": "0x" + data.hex()}, "latest"]})
    r.raise_for_status()
    (svc,) = decode([SERVICE_TUPLE], bytes.fromhex(r.json()["result"][2:]))
    return dict(zip(SERVICE_FIELDS, svc))


def empty_proof() -> dict:
    return {"signed_text": None, "signature": None, "signer": None, "signer_onchain": None, "acknowledged": None,
            "verifiability": None, "target_separated": None, "verified": False}


class Prover:
    def __init__(self, provider: str):
        self.provider = provider
        self.session = requests.Session()
        self.service = None

    def load_service(self) -> dict:
        """Read once per mission; verify() retries it while it has never succeeded (P3 internet-cut test)."""
        svc = read_service(self.provider, self.session)
        info = json.loads(svc["additionalInfo"] or "{}")
        self.service = {"url": svc["url"], "model": svc["model"], "verifiability": svc["verifiability"],
                        "signer_onchain": svc["teeSignerAddress"], "acknowledged": svc["teeSignerAcknowledged"],
                        "target_separated": info.get("TargetSeparated")}
        # Warm the keep-alive connection to the provider so the first signature fetch is not a cold one.
        try:
            self.session.get(svc["url"], timeout=SIG_TIMEOUT_S * 2)
        except requests.RequestException:
            pass
        return self.service

    def _proof_base(self) -> dict:
        p = empty_proof()
        if self.service:
            p.update({k: self.service[k] for k in ("signer_onchain", "acknowledged", "verifiability", "target_separated")})
        return p

    def verify(self, chat_id: str, corrupt_signature: bool = False) -> tuple[dict, list]:
        """Returns (proof, fetch_ms per attempt). Raises ProofError with the partial proof on any failure."""
        proof, fetch_ms = self._proof_base(), []
        if self.service is None:
            try:
                self.load_service()
            except Exception as e:
                raise ProofError(f"on-chain service unreadable: {type(e).__name__}", proof)
            proof = self._proof_base()
        svc = self.service
        # Never additionalInfo.TargetTeeAddress (SDK issue #100); only the acknowledged on-chain signer.
        if not (svc["acknowledged"] is True and svc["verifiability"] == "TeeML" and svc["target_separated"] is False):
            raise ProofError("on-chain service is not an acknowledged, non-separated TeeML signer", proof)
        if not chat_id:
            raise ProofError("no chat id", proof)
        sig = None
        for _ in range(SIG_TRIES):
            t0 = time.monotonic()
            try:
                r = self.session.get(f"{svc['url']}/v1/proxy/signature/{chat_id}", params={"model": svc["model"]},
                                     timeout=SIG_TIMEOUT_S)
                fetch_ms.append(round((time.monotonic() - t0) * 1000))
                if r.status_code == 200:
                    sig = r.json()
                    break
            except (requests.RequestException, ValueError):
                fetch_ms.append(round((time.monotonic() - t0) * 1000))
        if not sig or "text" not in sig or "signature" not in sig:
            raise ProofError("signature fetch failed", proof, fetch_ms)
        text, signature = sig["text"], sig["signature"]
        if corrupt_signature:
            signature = signature[:-4] + ("0000" if signature[-4:] != "0000" else "1111")
        proof.update({"signed_text": text, "signature": signature})
        try:
            proof["signer"] = Account.recover_message(encode_defunct(text=text), signature=signature)
        except Exception as e:
            raise ProofError(f"signature does not recover: {type(e).__name__}", proof, fetch_ms)
        proof["verified"] = text.startswith(SIG_PREFIX) and proof["signer"].lower() == svc["signer_onchain"].lower()
        if not proof["verified"]:
            raise ProofError("signature does not recover to the on-chain signer", proof, fetch_ms)
        return proof, fetch_ms
# 2026-11-06T06:02:00
# 2026-11-06T22:19:28


# InferenceServing contract on 0G mainnet (chain 16661).
# getService(provider) returns: url, model, teeSignerAddress,
# teeSignerAcknowledged, verifiability, additionalInfo.
# We require: teeSignerAcknowledged==true, verifiability=='TeeML',
# additionalInfo.TargetSeparated==false.
INFERENCE_SERVING = "0x47340d900bdFec2BD393c626E12ea0656F938d84"
ZG_RPC = "https://evmrpc.0g.ai"
PROOF_FETCH_TIMEOUT_S = 2
PROOF_FETCH_RETRIES = 1
