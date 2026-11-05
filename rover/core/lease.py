"""The three leases that gate every motion: brain (0G decision), proof (TEE signature), money (paid move)."""

import threading
import time
from dataclasses import dataclass, field

MONEY_HEARTBEAT_S = 1.0


@dataclass
class MoneyLease:
    quote_id: str | None = None
    paid: int = 0
    used: int = 0
    txs: list = field(default_factory=list)
    heartbeat_at: float = 0.0

    def ok(self, now: float | None = None) -> bool:
        now = time.monotonic() if now is None else now
        return self.paid - self.used >= 1 and now - self.heartbeat_at < MONEY_HEARTBEAT_S


@dataclass
class Leases:
    brain: bool = False
    proof: bool = False
    money: MoneyLease = field(default_factory=MoneyLease)
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def set_paid(self, quote_id: str, paid: int, txs: list) -> None:
        with self.lock:
            if quote_id != self.money.quote_id:
                raise ValueError("payment for a different quote")
            # Running total from the storefront: never moves backwards.
            if paid > self.money.paid:
                self.money.paid = paid
                self.money.txs = list(txs)

    def money_heartbeat(self, quote_id: str) -> None:
        with self.lock:
            if quote_id != self.money.quote_id:
                raise ValueError("heartbeat for a different quote")
            self.money.heartbeat_at = time.monotonic()

    def use_move(self) -> bool:
        with self.lock:
            if not self.money.ok():
                return False
            self.money.used += 1
            return True

    def refund_move(self) -> None:
        """The MCU refused the skill before anything moved: the paid move is still owed."""
        with self.lock:
            self.money.used -= 1

    def all_ok(self, moving: bool) -> tuple[bool, str | None]:
        with self.lock:
            if not self.brain:
                return False, "0G?"
            if not self.proof:
                return False, "!TEE"
            if moving and time.monotonic() - self.money.heartbeat_at >= MONEY_HEARTBEAT_S:
                return False, "402"
            return True, None

    def snapshot(self) -> dict:
        with self.lock:
            return {"brain": self.brain, "proof": self.proof, "money_ok": self.money.ok(),
                    "paid": self.money.paid, "used": self.money.used, "quote_id": self.money.quote_id}
# 2026-11-06T02:32:00
# 2026-11-06T22:13:33
