// The buyer's x402 payer with its spending rules (HANDOFF §11): per-payment cap, pay only the quoted payTo and
// the exact agreed amount, mission budget, per-merchant limit, human-approval threshold. Every decision → HCS.
import { chainOf, CHAINS, FACILITATORS, facilitatorTxSince, ledgerPayment, NETWORK, USDC, usdcString, type HcsLog } from "@0xBs/hedera";
import { x402Client } from "@x402/core/client";
import { decodePaymentResponseHeader, wrapFetchWithPayment } from "@x402/fetch";
import { createClientHederaSigner, PrivateKey as X402Key } from "@x402/hedera";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { createKeyPairSignerFromBytes, getBase58Encoder } from "@solana/kit";
import { privateKeyToAccount } from "viem/accounts";
import { confirmElsewhere, landedElsewhere } from "./landed.js";

/** x402 signs with its own SDK copy (2.85.0, pinned by @x402/hedera), not the Agent Kit's 2.86.2, so it parses the key. */
function x402Key(raw: string) {
  const hex = raw.trim().replace(/^0x/, "");
  return /^[0-9a-fA-F]{64}$/.test(hex) ? X402Key.fromStringECDSA(hex) : X402Key.fromStringDer(hex);
}

export interface Limits {
  capPerPayment: string; // x402 spend control, e.g. "$0.20"
  budget: bigint; // whole mission, USDC atomic
  perMerchant: bigint;
  approvalThreshold: bigint; // above this a human would have to approve; demo payments stay below
}

export interface Expectation {
  kind: "move" | "photo" | "reading" | "motion" | "history";
  merchant: string;
  payTo: string;
  amount: string;
  network?: string; // where it is paid: Hedera when left out; Base Sepolia or Solana devnet (Phase 14)
}

export interface PayResult {
  ok: boolean;
  status: number | null;
  tx: string | null;
  refused: string | null;
  error?: string; // why the seller answered 402 to a signed payment, or why the request failed on the way
  lost?: boolean; // paid, but the reply was lost on the way (confirmed later from the seller's record and the ledger)
  ms: number;
  response: Response | null;
}

export class Payer {
  spent = 0n;
  /** The last entry written to the HCS spending log: its topic, seq and transaction, for a receipt to link to. */
  lastLog: { topic: string; seq: number; txId: string; decision: string } | null = null;
  private perMerchant = new Map<string, bigint>();
  private pending: Expectation | null = null;
  private refusal: string | null = null;
  private payFetch: ReturnType<typeof wrapFetchWithPayment>;
  private client: x402Client;
  private signed: { network: string; payload: unknown } | null = null; // the payment signed for the request in flight
  private addresses: { base?: string; solana?: string } = {}; // this buyer on Base and Solana

  constructor(private buyerId: string, keyRaw: string, private limits: Limits, private log: HcsLog | null) {
    const client = this.client = new x402Client()
      .register(NETWORK, new ExactHederaScheme(createClientHederaSigner(buyerId, x402Key(keyRaw), { network: NETWORK })))
      .setSpendControls({ maxAmountPerPayment: limits.capPerPayment })
      .registerPolicy((_v, reqs) => {
        // Every option the seller offers is weighed; it counts as refused only when none passes (a 402 now offers several chains).
        const why = (r: (typeof reqs)[number]): string | null => {
          const e = this.pending;
          const want = chainOf(e?.network ?? NETWORK); // only the chain asked for, and never a network outside CHAINS (no mainnet)
          return !e ? "no payment expected"
            : !want || r.network !== want.network || r.asset !== want.usdc ? `not USDC on ${want?.label ?? e.network}`
            : r.payTo !== e.payTo ? `policy: payTo ${r.payTo} is not the quoted ${e.payTo}`
            : r.amount !== e.amount ? `policy: amount ${usdcString(r.amount)} is not the agreed ${usdcString(e.amount)} USDC`
            : null;
        };
        const ok = reqs.filter((r) => !why(r));
        this.refusal = ok.length ? null : reqs.map(why).find((w) => w && !w.startsWith("not USDC on")) ?? why(reqs[0]!) ?? "no acceptable payment option";
        return ok;
      })
      .onBeforePaymentCreation(async ({ selectedRequirements: r }) => {
        const amount = BigInt(r.amount);
        const merchant = this.perMerchant.get(r.payTo) ?? 0n;
        const why = this.spent + amount > limits.budget
          ? `mission budget: spent ${usdcString(this.spent)} + ${usdcString(amount)} > ${usdcString(limits.budget)} USDC`
          : merchant + amount > limits.perMerchant ? `per-merchant limit ${usdcString(limits.perMerchant)} USDC for ${r.payTo}`
          : amount > limits.approvalThreshold ? `needs human approval: ${usdcString(amount)} > ${usdcString(limits.approvalThreshold)} USDC`
          : null;
        if (why) {
          this.refusal = why;
          return { abort: true, reason: why };
        }
      })
      .onAfterPaymentCreation(async ({ paymentPayload }) => {
        this.signed = { network: paymentPayload.accepted.network, payload: paymentPayload.payload };
      })
      .onPaymentResponse(async ({ settleResponse, requirements }) => {
        if (!settleResponse?.success) return;
        const amount = BigInt(requirements.amount);
        this.spent += amount;
        this.perMerchant.set(requirements.payTo, (this.perMerchant.get(requirements.payTo) ?? 0n) + amount);
      });
    this.payFetch = wrapFetchWithPayment(fetch, client);
  }

  /** One paid request (POST for the rover, GET for a station). Refusals never reach the network; an unclear settle is checked on the ledger. */
  async pay(url: string, expect: Expectation, method: "POST" | "GET" = "POST"): Promise<PayResult> {
    const t0 = performance.now();
    const since = Date.now() / 1000;
    this.pending = expect;
    this.refusal = null;
    this.signed = null;
    let response: Response | null = null;
    let refused: string | null = null;
    let lost = null as string | null; // the request failed on the way (network, timeout): not a refusal, may be tried again
    try {
      response = await this.payFetch(url, { method, signal: AbortSignal.timeout(60_000) });
    } catch (e) {
      const policy = this.refusal as string | null; // set by the policy hook during payFetch
      const msg = (e as Error).message;
      if (policy) refused = policy;
      else if (msg.includes("rejected by spendControls")) refused = `spend control: the seller asked more than the ${this.limits.capPerPayment} per-payment cap`;
      // Only options this payer cannot sign at all (another network, a mainnet): the x402 client drops them before the policy runs.
      else if (msg.includes("No network/scheme registered")) refused = `not USDC on ${chainOf(expect.network ?? NETWORK)?.label ?? expect.network}: the seller offers nothing this buyer can pay there`;
      else lost = msg;
    } finally {
      this.pending = null;
    }
    const network = expect.network ?? NETWORK;
    // Base or Solana, signed but no clear answer: read the chain itself before calling it unpaid, so a retry never pays twice.
    const signed = this.lastSigned(); // set by the hook during payFetch
    if (network !== NETWORK && signed && (lost || !response || response.status >= 400)) {
      const why = (lost ?? (response ? `HTTP ${response.status}` : "no answer")).slice(0, 200);
      const buyer = this.addressOn(network);
      const refused402 = !lost && response?.status === 402; // the seller says the settle failed; no answer at all may still land
      const landed = buyer ? await landedElsewhere(network, signed.payload, { buyer, payTo: expect.payTo, amount: expect.amount, sinceSec: since }, refused402) : null;
      if (landed) await this.record({ decision: "paid", reason: `settled on ${chainOf(network)?.label} although the seller answered ${why}`,
                                      merchant: expect.merchant, kind: expect.kind, amount: expect.amount, tx: landed, network });
      return { ok: false, status: response?.status ?? null, tx: landed, refused: null, error: why, lost: !!landed,
               ms: Math.round(performance.now() - t0), response, ...(response ? reason402(response) : {}) };
    }
    // Lost on the way, or a proxy's error page (5xx): whether it settled is read later from the seller's record (confirm).
    if (lost || (response && response.status >= 500))
      return { ok: false, status: response?.status ?? null, tx: null, refused: null, error: (lost ?? `HTTP ${response!.status}`).slice(0, 200),
               ms: Math.round(performance.now() - t0), response };
    const header = response?.headers.get("payment-response");
    const settle = header ? decodePaymentResponseHeader(header) : null;
    const tx = settle?.success ? settle.transaction : null;
    const ms = Math.round(performance.now() - t0);
    const on = network === NETWORK ? {} : { network }; // Hedera entries keep their old shape; others name their chain
    if (tx) await this.record({ decision: "paid", reason: null, merchant: expect.merchant, kind: expect.kind, amount: expect.amount, tx, ...on });
    else if (refused) await this.record({ decision: "refused", reason: refused.slice(0, 200), merchant: expect.merchant, kind: expect.kind, amount: expect.amount, tx: null, ...on });
    else if (response && response.status >= 400 && network !== NETWORK) {
      // Base or Solana with nothing signed (refused before paying): nothing can have moved.
      return { ok: false, status: response.status, tx: null, refused: null, ms, response, ...reason402(response) };
    } else if (response && response.status >= 400) {
      // Paid-looking failure (e.g. facilitator switched or settle failed): did money move anyway?
      const landed = await this.landedSince(since);
      if (landed) await this.record({ decision: "paid", reason: `settled on the ledger despite HTTP ${response.status}`, merchant: expect.merchant,
                                      kind: expect.kind, amount: expect.amount, tx: landed });
      return { ok: false, status: response.status, tx: landed, refused: null, ms, response, ...reason402(response) };
    }
    return { ok: !!tx, status: response?.status ?? null, tx, refused, ms, response };
  }

  /** A payment whose reply was lost: true only if its chain shows exactly this buyer paying the expected amount to payTo. */
  async confirm(tx: string, expect: Expectation): Promise<boolean> {
    const network = expect.network ?? NETWORK;
    let ok: boolean;
    if (network === NETWORK) {
      const t = await ledgerPayment(tx).catch(() => null);
      const moved = (account: string, amount: bigint) => (t?.usdc ?? []).some((x) => x.account === account && x.amount === amount);
      ok = t?.result === "SUCCESS" && moved(this.buyerId, -BigInt(expect.amount)) && moved(expect.payTo, BigInt(expect.amount));
    } else {
      const buyer = this.addressOn(network);
      ok = !!buyer && await confirmElsewhere(network, tx, { buyer, payTo: expect.payTo, amount: expect.amount });
    }
    if (ok) await this.record({ decision: "paid", reason: "the seller's reply was lost on the way; confirmed from its record and the ledger",
                                merchant: expect.merchant, kind: expect.kind, amount: expect.amount, tx, ...(network === NETWORK ? {} : { network }) });
    return ok;
  }

  /** This buyer's address on a network: its Hedera account, or the Base / Solana address added by addChains. */
  addressOn(network: string): string | null {
    return network === NETWORK ? this.buyerId : network === CHAINS.base.network ? this.addresses.base ?? null
      : network === CHAINS.solana.network ? this.addresses.solana ?? null : null;
  }

  async landedSince(sinceSec: number): Promise<string | null> {
    for (const f of FACILITATORS) {
      const t = await facilitatorTxSince(this.buyerId, f.feePayer, sinceSec - 5).catch(() => null);
      if (t) return t.transaction_id as string;
    }
    return null;
  }

  private lastSigned() {
    return this.signed;
  }

  /** Lets this payer also sign on Base Sepolia and Solana devnet, with the keys of the local wallet (~/.0xbs/wallet.json). */
  async addChains(keys: { evm?: string; solana?: string }): Promise<this> {
    if (keys.evm) {
      const account = privateKeyToAccount(keys.evm as `0x${string}`);
      this.client.register(CHAINS.base.network, new ExactEvmScheme(account));
      this.addresses.base = account.address;
    }
    if (keys.solana) {
      const bytes = new Uint8Array(getBase58Encoder().encode(keys.solana));
      if (bytes.length === 64) {
        const signer = await createKeyPairSignerFromBytes(bytes);
        this.client.register(CHAINS.solana.network, new ExactSvmScheme(signer));
        this.addresses.solana = signer.address;
      }
    }
    return this;
  }

  async record(entry: Record<string, unknown>): Promise<void> {
    if (!this.log) return;
    const r = await this.log.log(entry).catch((e) => void console.error(`HCS spending log: ${(e as Error).message}`));
    if (r) this.lastLog = { topic: this.log.topicId, seq: r.seq, txId: r.txId, decision: String(entry.decision) };
  }
}

/** The x402 v2 PAYMENT-REQUIRED header carries the reason a signed payment was not accepted. */
function reason402(response: Response): { error?: string } {
  const header = response.status === 402 ? response.headers.get("payment-required") : null;
  if (!header) return {};
  try {
    const error = JSON.parse(Buffer.from(header, "base64").toString("utf8")).error;
    return error ? { error: String(error).slice(0, 200) } : {};
  } catch {
    return {};
  }
}
