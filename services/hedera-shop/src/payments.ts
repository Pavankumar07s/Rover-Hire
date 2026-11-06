// x402: one resource server per Hedera facilitator, the active one chosen by a health check every 30 s.
// A signed payment names one facilitator's fee payer, so after a switch the buyer gets a fresh 402 and signs again.
// Base Sepolia and Solana devnet (Phase 14) settle through x402.org from every server: the first facilitator that
// supports a network handles it, so Hedera keeps the active one.
import { CHAINS, facilitatorHealth, FACILITATORS, NETWORK, settledAnyway, type Health } from "@0xBs/hedera";
import { HTTPFacilitatorClient, x402ResourceServer, type HTTPTransportContext, type RoutesConfig } from "@x402/core/server";
import { paymentMiddleware } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { ExactHederaScheme } from "@x402/hedera/exact/server";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import type { NextFunction, Request, Response } from "express";
import { OncePerPayment } from "./once.js";

// The routes and what happens once a payment settles come from each shop: the rover's in shop.ts, Station-A's in station.ts.
export interface SettledPayment {
  facilitator: string;
  network: string; // CAIP-2: hedera:testnet, eip155:84532 or the Solana devnet
  path: string;
  amount: string;
  tx: string;
  payer: string;
  paymentHeader?: string; // ties the settlement to the response the handler sent for it
}

const HEALTH_S = 30;

/** A Hedera facilitator that says it supports only Hedera, so Base and Solana always go to x402.org (Blocky402 also lists
 *  the Solana devnet; the first facilitator listing a network wins, and the shop's records name x402.org for them). */
class HederaOnly extends HTTPFacilitatorClient {
  override async getSupported() {
    const s = await super.getSupported();
    return { ...s, kinds: s.kinds.filter((k) => k.network === NETWORK),
             signers: Object.fromEntries(Object.entries(s.signers ?? {}).filter(([k]) => k.startsWith("hedera:"))) };
  }
}

type Settle = HTTPFacilitatorClient["settle"];

/** x402.org for Base Sepolia and Solana devnet, checked against the chain before a payment counts as unpaid. A facilitator
 *  can answer "failed" or "pending" for a transfer that lands anyway (it timed out, or its node was rate-limited while it
 *  confirmed); answering 402 then would keep the money and deliver nothing. So the shop reads the chain itself: landed,
 *  it is a settled payment like any other; not landed, it stays a failure. Hedera is untouched. */
export class ConfirmOnChain extends HTTPFacilitatorClient {
  waitMs = 30_000;

  protected upstream(...args: Parameters<Settle>): ReturnType<Settle> {
    return super.settle(...args);
  }

  override async settle(...[payload, req]: Parameters<Settle>): ReturnType<Settle> {
    const other = req.network === CHAINS.base.network || req.network === CHAINS.solana.network;
    let r: Awaited<ReturnType<Settle>> | null = null;
    let thrown: unknown = null;
    try {
      r = await this.upstream(payload, req);
      if (r.success || !other) return r;
    } catch (e) {
      if (!other) throw e;
      thrown = e;
    }
    const why = r ? `${r.errorReason ?? "failed"}${r.errorMessage ? ` (${r.errorMessage.slice(0, 80)})` : ""}` : (thrown as Error).message;
    const tx = await settledAnyway(req.network, { payload: payload.payload, signature: r?.transaction || undefined, payTo: req.payTo, amount: req.amount },
                                   this.waitMs);
    if (!tx) {
      if (thrown) throw thrown;
      return r!;
    }
    const auth = (payload.payload as { authorization?: { from?: string } }).authorization;
    console.warn(`settle on ${req.network} said ${why}, but the payment landed: ${tx}`);
    return { success: true, transaction: tx, network: req.network, payer: r?.payer || auth?.from || "" };
  }
}

export class Payments {
  active = 0;
  health: (Health & { name: string })[] = [];
  private middlewares: ((req: Request, res: Response, next: NextFunction) => Promise<void>)[];
  private servers: x402ResourceServer[] = [];
  private ready: boolean[] = FACILITATORS.map(() => false);
  private once: OncePerPayment;

  /** `usedFile` keeps the payments already settled, so a restart still refuses them. */
  constructor(routes: () => RoutesConfig, onSettled: (s: SettledPayment) => Promise<void>, usedFile: string) {
    this.once = new OncePerPayment(usedFile);
    const OTHER = FACILITATORS.find((f) => f.name === "x402.org")!; // settles Base Sepolia and Solana devnet too
    this.middlewares = FACILITATORS.map((f) => {
      const clients = f === OTHER ? [new ConfirmOnChain({ url: f.url, timeoutMs: 30_000 })]
        : [new HederaOnly({ url: f.url, timeoutMs: 30_000 }), new ConfirmOnChain({ url: OTHER.url, timeoutMs: 30_000 })];
      const server = new x402ResourceServer(clients).register(NETWORK, new ExactHederaScheme())
        .register(CHAINS.base.network, new ExactEvmScheme()).register(CHAINS.solana.network, new ExactSvmScheme());
      server.onAfterSettle(async (ctx) => {
        const request = (ctx.transportContext as HTTPTransportContext | undefined)?.request;
        this.once.settled(request?.paymentHeader);
        const network = ctx.requirements.network;
        await onSettled({ facilitator: network === NETWORK ? f.name : OTHER.name, network, path: request?.path ?? "",
                          amount: ctx.requirements.amount, tx: ctx.result.transaction,
                          payer: ctx.result.payer ?? "", paymentHeader: request?.paymentHeader });
      });
      const via = (network?: string) => (!network || network === NETWORK ? f.name : OTHER.name);
      server.onSettleFailure(async (ctx) => console.error(`settle failed on ${ctx.requirements?.network} via ${via(ctx.requirements?.network)}: ${ctx.error.message}`));
      // A refused verification answers the buyer with a new 402; log why, since nothing else records it.
      server.onVerifyFailure(async (ctx) => console.error(`verify failed via ${f.name}: ${ctx.error.message}`));
      server.onAfterVerify(async (ctx) => {
        if (!ctx.result.isValid) console.error(`verify invalid via ${f.name}: ${ctx.result.invalidReason ?? "no reason given"}`);
      });
      this.servers.push(server);
      // Synced by ensureReady() instead of on start, so a facilitator that is down at boot cannot take the shop down.
      return paymentMiddleware(routes(), server, undefined, undefined, false);
    });
  }

  middleware = (req: Request, res: Response, next: NextFunction) =>
    this.once.middleware(req, res, () => void this.middlewares[this.active]!(req, res, next));

  facilitator(): string {
    return FACILITATORS[this.active]!.name;
  }

  /** Fetches the facilitator's supported kinds once; false if it is unreachable. */
  private async ensureReady(i: number): Promise<boolean> {
    if (this.ready[i]) return true;
    try {
      await this.servers[i]!.initialize();
      this.ready[i] = true;
    } catch (e) {
      console.warn(`facilitator ${FACILITATORS[i]!.name} not ready: ${(e as Error).message}`);
    }
    return this.ready[i]!;
  }

  async check(): Promise<void> {
    this.health = await Promise.all(FACILITATORS.map(async (f) => ({ name: f.name, ...(await facilitatorHealth(f)) })));
    if (this.health[this.active]!.ok && (await this.ensureReady(this.active))) return;
    for (let i = 0; i < FACILITATORS.length; i++) {
      if (i === this.active || !this.health[i]!.ok || !(await this.ensureReady(i))) continue;
      console.warn(`facilitator ${this.facilitator()} unhealthy (${this.health[this.active]!.error ?? "not ready"}); switching to ${FACILITATORS[i]!.name}`);
      this.active = i;
      return;
    }
  }

  /** Resolves once the active facilitator is synced, then re-checks every 30 s. */
  async start(): Promise<void> {
    await this.check();
    setInterval(() => void this.check(), HEALTH_S * 1000);
  }
}


// A Base or Solana settle that returns failed/pending is checked on-chain
// before answering 402, so a lost reply never causes a double charge.
// Station-A accepts USDC on Hedera testnet, Base Sepolia, and Solana devnet.
export type Chain = "hedera:testnet" | "eip155:84532" | "solana:devnet";
export async function confirmSettle(txId: string, chain: Chain): Promise<boolean> {
  if (chain === "hedera:testnet") return confirmHederaTx(txId);
  if (chain.startsWith("eip155:")) return confirmEvmTx(txId, chain);
  return confirmSolanaTx(txId);
}
