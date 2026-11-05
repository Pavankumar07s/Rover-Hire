import {
  createSigner,
  wrapFetchWithPayment,
  decodeXPaymentResponse,
  type MultiNetworkSigner,
} from "x402-fetch";
import { DEVICE_CONTROLLER_URL, MAX_PAYMENT_ATOMIC } from "./config.js";
import { getKeys } from "./wallet.js";

export interface ServiceArgument {
  name: string;
  type: "string" | "number" | "boolean";
  required: boolean;
  description?: string;
}

export interface DiscoveredService {
  id: string;
  title: string;
  description: string | null;
  serviceType: "FREE" | "PAID";
  paid: boolean;
  payoutChain: "BASE" | "SOLANA";
  passwordProtected: boolean;
  call: { method: string; path: string };
  arguments: ServiceArgument[];
}

export interface DiscoveredDevice {
  id: string;
  title: string;
  description: string | null;
  online?: boolean;
  services: DiscoveredService[];
}

/** One entry of an x402 `accepts` array, as advertised by the 402 response. */
export interface PaymentOption {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  payTo: string;
  asset: string;
  maxTimeoutSeconds: number;
  description?: string;
}

export interface Settlement {
  network?: string;
  transaction?: string;
  payer?: string;
}

const serviceUrl = (deviceId: string, serviceId: string) =>
  `${DEVICE_CONTROLLER_URL}/quote/device/${deviceId}/service/${serviceId}`;

/** Turn a failed response into an error carrying the server's own explanation. */
async function describeFailure(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const parsed = JSON.parse(text) as { error?: string; detail?: string };
    const parts = [parsed.error, parsed.detail].filter(Boolean);
    if (parts.length) return `${res.status}: ${parts.join(" — ")}`;
  } catch {
    // fall through to the raw body
  }
  return `${res.status}: ${text.slice(0, 400) || res.statusText}`;
}

export interface CatalogService {
  id: string;
  title: string | null;
  description: string | null;
  serviceType: "FREE" | "PAID";
  paid: boolean;
  payoutChain: "BASE" | "SOLANA";
  passwordProtected: boolean;
}

export interface CatalogDevice {
  id: string;
  title: string | null;
  description: string | null;
  online: true;
  services: CatalogService[];
}

export async function listOnlineDevices(options?: {
  q?: string;
  limit?: number;
}): Promise<{ devices: CatalogDevice[]; count: number; truncated: boolean }> {
  const query = new URLSearchParams();
  if (options?.q) query.set("q", options.q);
  if (options?.limit) query.set("limit", String(options.limit));
  const suffix = query.size ? `?${query}` : "";
  const res = await fetch(`${DEVICE_CONTROLLER_URL}/public/devices${suffix}`);
  if (!res.ok) throw new Error(await describeFailure(res));
  return (await res.json()) as {
    devices: CatalogDevice[];
    count: number;
    truncated: boolean;
  };
}

export async function discoverDevice(
  deviceId: string,
): Promise<DiscoveredDevice> {
  const res = await fetch(`${DEVICE_CONTROLLER_URL}/public/device/${deviceId}`);
  if (!res.ok) throw new Error(await describeFailure(res));
  const body = (await res.json()) as { device: DiscoveredDevice };
  return body.device;
}

export async function findService(
  deviceId: string,
  serviceId: string,
): Promise<{ device: DiscoveredDevice; service: DiscoveredService }> {
  const device = await discoverDevice(deviceId);
  const service = device.services.find((s) => s.id === serviceId);
  if (!service) {
    const available = device.services
      .map((s) => `${s.id} (${s.title})`)
      .join(", ");
    throw new Error(
      `Device "${device.title}" has no service ${serviceId}. Available: ${available || "none"}`,
    );
  }
  return { device, service };
}

/**
 * Ask a PAID service what it charges, without paying.
 *
 * The unpaid POST is what produces the 402, and reaching it makes the server ask
 * the device for a quote — the device is contacted but does NOT perform the
 * work. Never call this for a FREE service: with nothing to pay, the same
 * request executes the service for real.
 */
export async function getPaymentOptions(
  deviceId: string,
  serviceId: string,
  params: Record<string, unknown>,
  credentials?: Credentials,
): Promise<PaymentOption[]> {
  const res = await fetch(serviceUrl(deviceId, serviceId), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ params, ...credentials }),
  });

  if (res.status !== 402) throw new Error(await describeFailure(res));

  const body = (await res.json()) as { accepts?: PaymentOption[] };
  if (!body.accepts?.length) {
    throw new Error("Server returned 402 but advertised no payment options");
  }
  return body.accepts;
}

export interface Credentials {
  username?: string;
  password?: string;
}

let walletPromise: Promise<MultiNetworkSigner> | undefined;

/** Drop the cached signer after create_wallet / import_wallet in this process. */
export function resetWalletCache(): void {
  walletPromise = undefined;
}

/**
 * Load the signing wallet once. Only the signers are cached — never the wrapped
 * fetch, because `wrapFetchWithPayment` bakes the spend ceiling in at wrap time,
 * so reusing one wrapper would apply the first call's limit to every later call.
 */
async function getWallet(): Promise<MultiNetworkSigner> {
  if (walletPromise) return walletPromise;

  const keys = getKeys();
  if (!keys.evm && !keys.solana) {
    throw new Error(
      "No payment wallet yet. Call create_wallet to generate one on this computer " +
        "(the model never sees the private keys), then fund the addresses with USDC.",
    );
  }

  walletPromise = (async () => {
    const evm = keys.evm ? await createSigner("base", keys.evm) : undefined;
    const svm = keys.solana
      ? await createSigner("solana", keys.solana)
      : undefined;

    // With both keys the multi-network signer lets the server choose the chain;
    // with one, that family's signer is passed on its own.
    return (evm && svm ? { evm, svm } : (evm ?? svm)) as MultiNetworkSigner;
  })();

  return walletPromise;
}

/**
 * A fetch that answers 402s by signing a USDC payment. `maxAtomic` is the
 * ceiling it will settle without asking; anything dearer throws.
 */
async function getPayingFetch(maxAtomic: bigint): Promise<typeof fetch> {
  return wrapFetchWithPayment(fetch, await getWallet(), maxAtomic);
}

export interface CallOutcome {
  result: unknown;
  settlement?: Settlement;
  paid: boolean;
  elapsedMs: number;
}

/**
 * Call a service, paying if it is a paid one.
 *
 * A free service is called with plain `fetch`, so free devices stay usable with
 * no wallet configured at all.
 */
export async function callService(options: {
  deviceId: string;
  serviceId: string;
  params: Record<string, unknown>;
  isPaid: boolean;
  credentials?: Credentials;
  maxAtomic?: bigint;
}): Promise<CallOutcome> {
  const { deviceId, serviceId, params, isPaid, credentials } = options;

  // A per-call limit may tighten the configured ceiling but never loosen it.
  const requested = options.maxAtomic ?? MAX_PAYMENT_ATOMIC;
  const maxAtomic =
    requested < MAX_PAYMENT_ATOMIC ? requested : MAX_PAYMENT_ATOMIC;

  const doFetch = isPaid ? await getPayingFetch(maxAtomic) : fetch;

  const started = Date.now();
  const res = await doFetch(serviceUrl(deviceId, serviceId), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ params, ...credentials }),
  });
  const elapsedMs = Date.now() - started;

  if (!res.ok) throw new Error(await describeFailure(res));

  const receipt = res.headers.get("x-payment-response");
  const settlement = receipt
    ? (decodeXPaymentResponse(receipt) as Settlement)
    : undefined;

  return {
    result: await res.json(),
    settlement,
    paid: Boolean(settlement),
    elapsedMs,
  };
}

/** Addresses that would sign payments, for funding and for auditing spend. */
export async function walletAddresses(): Promise<{
  evm?: string;
  solana?: string;
  source: "env" | "file" | "none";
  path?: string;
}> {
  const keys = getKeys();
  const out: {
    evm?: string;
    solana?: string;
    source: "env" | "file" | "none";
    path?: string;
  } = { source: keys.source, path: keys.path };

  if (keys.evm) {
    const signer = (await createSigner("base", keys.evm)) as {
      account?: { address?: string };
      address?: string;
    };
    out.evm = signer.account?.address ?? signer.address;
  }
  if (keys.solana) {
    const signer = (await createSigner("solana", keys.solana)) as {
      address?: string;
    };
    out.solana = signer.address;
  }

  return out;
}
