import {
  Router,
  type Request as ExpressRequest,
  type Router as ExpressRouter,
} from "express";
import { createFacilitatorConfig } from "@coinbase/x402";
import { HTTPFacilitatorClient } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { prisma } from "@0xBs/db";
import { apiKeyMatches } from "../../lib/api-key.js";
import { verifyPassword } from "../../lib/password.js";
import { getPrice } from "../../services/get-price.js";
import { getResult } from "../../services/get-result.js";
import { toParamDefs, validateParamValues } from "../../lib/params.js";

const facilitator = new HTTPFacilitatorClient(
  createFacilitatorConfig(
    process.env.CDP_API_KEY_ID,
    process.env.CDP_API_KEY_SECRET,
  ),
);
const PUBLIC_URL = process.env.PUBLIC_URL;

/** Absolute origin for x402 `resource`. Accepts a host with or without scheme. */
function publicOrigin(req: ExpressRequest): string {
  const raw = (PUBLIC_URL ?? "").trim().replace(/\/$/, "");
  if (raw) {
    return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  }
  const host = req.get("x-forwarded-host") ?? req.get("host") ?? "localhost";
  const proto =
    (req.get("x-forwarded-proto") ?? req.protocol ?? "http").split(",")[0];
  return `${proto}://${host}`;
}

// USDC-only. USDC is a 6-decimal token on every one of these networks, so a
// single atomic `amount` is valid across the whole family.
//
// `walletChain` on the device/service is the address FAMILY (EVM `0x…` vs
// Solana base58). One EVM address is valid on every EVM network below, and one
// Solana address on every Solana network — so a single configured wallet can
// accept on ALL networks in its family. We advertise one `accepts` entry per
// network (both testnets AND mainnets) and let the paying agent choose
// whichever chain it holds funds on.
//
// Networks + assets are limited to what the Coinbase (CDP) facilitator settles:
//   Base, Base Sepolia, Polygon, Arbitrum, World, World Sepolia, Solana,
//   Solana Devnet.  (See docs.cdp.coinbase.com/x402/seller/facilitator)
type WalletChain = "BASE" | "SOLANA";
type NetworkOption = {
  network: string;
  asset: string; // USDC contract (EVM) / mint (Solana)
  extra: Record<string, unknown>; // EIP-712 domain for EVM EIP-3009 signing
};

// EVM USDC signs EIP-3009 with the token's OWN EIP-712 domain, so `name` must
// match what the contract reports — not the ticker. Circle's mainnet USDC
// deployments are named "USD Coin"; only the testnet tokens are named "USDC".
// Advertising the wrong name makes the buyer sign a correctly-formed signature
// over the wrong digest, which the facilitator rejects as `invalid_payload`.
const USD_COIN_EXTRA = { name: "USD Coin", version: "2" };
const USDC_EXTRA = { name: "USDC", version: "2" };
// Solana USDC is an SPL token — no EIP-712 domain.
const SOLANA_USDC_EXTRA = { name: "USDC" };

// Every USDC network a wallet of each family can be paid on — testnets AND
// mainnets, all advertised together.
const NETWORKS: Record<WalletChain, NetworkOption[]> = {
  BASE: [
    // ── Mainnets ──
    // Base
    {
      network: "eip155:8453",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      extra: USD_COIN_EXTRA,
    },
    // Polygon PoS (native USDC)
    {
      network: "eip155:137",
      asset: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
      extra: USD_COIN_EXTRA,
    },
    // Arbitrum One
    {
      network: "eip155:42161",
      asset: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      extra: USD_COIN_EXTRA,
    },
    // World Chain — this deployment reports "USDC", unlike the other mainnets.
    {
      network: "eip155:480",
      asset: "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1",
      extra: USDC_EXTRA,
    },
    // ── Testnets ──
    // Base Sepolia
    {
      network: "eip155:84532",
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      extra: USDC_EXTRA,
    },
    // World Chain Sepolia
    {
      network: "eip155:4801",
      asset: "0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88",
      extra: USDC_EXTRA,
    },
  ],
  SOLANA: [
    // Solana mainnet
    {
      network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      extra: SOLANA_USDC_EXTRA,
    },
    // Solana Devnet
    {
      network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
      asset: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
      extra: SOLANA_USDC_EXTRA,
    },
  ],
};

/** All USDC networks a wallet of the given family can be paid on. */
function networksFor(chain: WalletChain): NetworkOption[] {
  const raw = (
    process.env.X402_NETWORKS ??
    (process.env.NODE_ENV === "production" ? "mainnet" : "all")
  ).toLowerCase();
  const mode = raw === "testnet" || raw === "mainnet" ? raw : "all";
  const testnets = new Set([
    "eip155:84532",
    "eip155:4801",
    "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  ]);
  return NETWORKS[chain].filter((n) => {
    const isTest = testnets.has(n.network);
    if (mode === "all") return true;
    return mode === "testnet" ? isTest : !isTest;
  });
}

// ── x402 v1 (standard x402-fetch / x402-axios) compatibility ────────────────
// External agents use the public `x402` package (x402-fetch / x402-axios). That
// client speaks x402 **v1**, which differs from the `@x402/*` v2 stack the CDP
// facilitator uses on two axes we must translate at the HTTP edge:
//   • networks are NAME STRINGS ("base", "solana") — NOT CAIP-2 ("eip155:8453")
//   • the requirement's atomic amount field is `maxAmountRequired` — NOT `amount`
//   • the 402 is a JSON BODY `{ x402Version, accepts }` — NOT a PAYMENT-REQUIRED
//     header; payment comes back in `X-PAYMENT`; settlement goes out in
//     `X-PAYMENT-RESPONSE`.
// We keep the v2 CDP facilitator (settlement is proven) and only translate the
// wire shapes the external client sees.
//
// v1's network enum has NO entry for World or Arbitrum, so those CAIP-2 networks
// simply can't be advertised to a v1 client and are dropped from the v1 accepts.
const CAIP2_TO_V1_NETWORK: Record<string, string> = {
  "eip155:8453": "base",
  "eip155:84532": "base-sepolia",
  "eip155:137": "polygon",
  "eip155:80002": "polygon-amoy",
  "eip155:43114": "avalanche",
  "eip155:43113": "avalanche-fuji",
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "solana",
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1": "solana-devnet",
};
const V1_TO_CAIP2_NETWORK: Record<string, string> = Object.fromEntries(
  Object.entries(CAIP2_TO_V1_NETWORK).map(([caip2, name]) => [name, caip2]),
);

// Solana `exact` needs a fee payer (Solana charges gas). The facilitator
// sponsors it, and advertises its fee-payer address via getSupported(). We
// inject that address as `extra.feePayer` on Solana requirements and the buyer
// builds the transaction with it as the fee payer.
//
// IMPORTANT: the facilitator ROTATES its sponsoring fee payer, so this value is
// only valid for a short window. Caching it for the whole process lifetime
// causes the agent to build a transaction whose fee payer no longer matches the
// one the facilitator expects at verify/settle — surfacing as
// `invalid_exact_solana_fee_payer_mismatch` ("expected <new>, got <stale>").
// Cache with a short TTL (and never cache a failed/empty lookup) so the quote
// always advertises a fee payer that is still valid when the buyer pays.
const FEE_PAYER_TTL_MS = 30_000;
let supportedCache:
  | Awaited<ReturnType<typeof facilitator.getSupported>>
  | undefined;
let supportedCacheAt = 0;
let supportedInflight:
  | Promise<Awaited<ReturnType<typeof facilitator.getSupported>>>
  | undefined;

async function getSupportedFresh() {
  if (supportedCache && Date.now() - supportedCacheAt <= FEE_PAYER_TTL_MS) {
    return supportedCache;
  }
  if (!supportedInflight) {
    supportedInflight = facilitator
      .getSupported()
      .then((value) => {
        supportedCache = value;
        supportedCacheAt = Date.now();
        return value;
      })
      .finally(() => {
        supportedInflight = undefined;
      });
  }
  return supportedInflight;
}

async function solanaFeePayer(network: string): Promise<string | undefined> {
  try {
    const supported = await getSupportedFresh();
    // Prefer a signer advertised for this exact network…
    const signer = supported.signers?.[network]?.[0];
    if (signer) return signer;
    // …otherwise fall back to a matching kind's extra.feePayer.
    const kind = supported.kinds?.find(
      (k) => k.network === network && k.scheme === "exact",
    );
    return (kind?.extra as { feePayer?: string } | undefined)?.feePayer;
  } catch {
    // Don't poison the cache on a failed lookup — leave the previous (possibly
    // undefined) value so the next request re-fetches.
    return undefined;
  }
}

const quoteRouter: ExpressRouter = Router();

const QUOTE_TTL_MS = 60_000;
const quoteCache = new Map<string, { amount: string; at: number }>();

function quoteCacheKey(
  connectorId: string,
  serviceId: string,
  params: unknown,
): string {
  return `${connectorId}:${serviceId}:${JSON.stringify(params ?? {})}`;
}

function getAllHeaders(req: ExpressRequest): Record<string, string> {
  return Object.fromEntries(
    Object.entries(req.headers).map(([name, value]) => [
      name.toLowerCase(),
      Array.isArray(value) ? value.join(",") : (value ?? ""),
    ]),
  );
}

function encodeHeader(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

// The device replies over MQTT with a transport envelope that includes internal
// fields the agent must NEVER see (the raw `api_key`, `type`, `reqId`, `price`,
// `service_id`). Return only the meaningful `result` payload; if the device
// didn't wrap its answer in `result`, fall back to the envelope minus the
// sensitive keys.
function sanitizeDeviceResult(reply: unknown): unknown {
  if (reply == null || typeof reply !== "object") return reply;
  const env = reply as Record<string, unknown>;
  if ("result" in env) return env.result;
  const { api_key, type, reqId, service_id, price, ...rest } = env;
  void api_key;
  void type;
  void reqId;
  void service_id;
  void price;
  return rest;
}

// Normalise a thrown facilitator error (VerifyError / SettleError / anything)
// into an agent-facing { reason, message }. The facilitator attaches
// `invalidReason` (short code) and `invalidMessage`/`errorMessage` (detail,
// e.g. "recipient has no token account" / "transaction would fail on-chain").
function facilitatorError(
  err: unknown,
  fallback: string,
): { reason: string; message: string | undefined } {
  const e = err as {
    invalidReason?: string;
    errorReason?: string;
    invalidMessage?: string;
    errorMessage?: string;
    message?: string;
  };
  return {
    reason: e?.invalidReason ?? e?.errorReason ?? fallback,
    message: e?.invalidMessage ?? e?.errorMessage ?? e?.message,
  };
}

// USDC has 6 decimals on every network we support. Convert a human price
// (number, "1.5", or "$100") into an atomic-unit string ("1500000").
const USDC_DECIMALS = 6;
function usdToAtomicUsdc(price: unknown): string {
  const raw =
    typeof price === "number" ? price.toString() : String(price ?? "").trim();
  const cleaned = raw.replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) {
    throw new Error(`Invalid price from device: ${JSON.stringify(price)}`);
  }
  const [whole, frac = ""] = cleaned.split(".");
  const fracPadded = (frac + "0".repeat(USDC_DECIMALS)).slice(0, USDC_DECIMALS);
  const atomic = BigInt(whole + fracPadded);
  return atomic.toString();
}

function decodeHeader<T>(value: string): T {
  if (value.length > 16_384) {
    throw new Error("Payment header too large");
  }

  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error("Invalid Base64");
  }

  return JSON.parse(Buffer.from(value, "base64").toString("utf8")) as T;
}

// Minimal base58 (Bitcoin alphabet) encoder — just enough to render a 32-byte
// Solana pubkey as its canonical address. Avoids pulling in bs58/@solana/kit.
const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Encode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i]!;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j]! << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "1".repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) out += BASE58_ALPHABET[digits[i]!];
  return out;
}

// Read a compact-u16 (Solana "short vec" length prefix) from `buf` at `offset`.
// Returns the decoded value and the number of bytes it consumed.
function readCompactU16(buf: Buffer, offset: number): [number, number] {
  let value = 0;
  let len = 0;
  for (;;) {
    if (len >= 3 || offset + len >= buf.length) break;
    const byte = buf[offset + len]!;
    value |= (byte & 0x7f) << (len * 7);
    len++;
    if ((byte & 0x80) === 0) break;
  }
  return [value, len];
}

// Extract the FEE PAYER from a signed Solana wire transaction (base64). The fee
// payer is ALWAYS the first static account key of the message. Handles both
// legacy and v0 messages. We need this because the CDP facilitator rejects a
// Solana payment whose signed fee payer differs from `requirements.extra.
// feePayer` — and with x402 v1 the buyer's fee payer isn't echoed in the JSON
// payload (only inside this signed tx), so we recover it here and verify/settle
// against exactly what the buyer used (defeating fee-payer rotation).
function solanaTxFeePayer(base64Tx: string): string | undefined {
  try {
    const buf = Buffer.from(base64Tx, "base64");
    let o = 0;
    const [sigCount, sigLen] = readCompactU16(buf, o);
    o += sigLen + sigCount * 64; // skip all 64-byte signatures
    // v0 messages prefix a version byte with the high bit set (0x80 | version).
    if ((buf[o]! & 0x80) !== 0) o += 1;
    o += 3; // message header: numRequiredSignatures, numReadonlySigned, numReadonlyUnsigned
    const [, keysLen] = readCompactU16(buf, o);
    o += keysLen; // skip the account-count prefix; keys follow immediately
    const feePayerBytes = buf.subarray(o, o + 32);
    if (feePayerBytes.length !== 32) return undefined;
    return base58Encode(new Uint8Array(feePayerBytes));
  } catch {
    return undefined;
  }
}

quoteRouter.post("/device/:deviceId/service/:serviceId", async (req, res) => {
  try {
    const { deviceId, serviceId } = req.params as {
      deviceId: string;
      serviceId: string;
    };
    const idempotencyKey =
      typeof req.headers["idempotency-key"] === "string"
        ? req.headers["idempotency-key"].trim()
        : typeof req.headers["x-idempotency-key"] === "string"
          ? req.headers["x-idempotency-key"].trim()
          : "";

    if (idempotencyKey) {
      const replay = await prisma.payment.findUnique({
        where: {
          deviceId_idempotencyKey: { deviceId, idempotencyKey },
        },
        select: { result: true, transaction: true, network: true, payer: true },
      });
      if (replay) {
        const settlementV1 = {
          success: true,
          transaction: replay.transaction,
          network: CAIP2_TO_V1_NETWORK[replay.network] ?? replay.network,
          payer: replay.payer,
        };
        res.setHeader("X-PAYMENT-RESPONSE", encodeHeader(settlementV1));
        res.setHeader("PAYMENT-RESPONSE", encodeHeader({
          ...settlementV1,
          network: replay.network,
        }));
        return res.json(replay.result);
      }
    }

    const row = await prisma.device.findUnique({
      where: { id: deviceId },
      select: {
        connectorId: true,
        apiKeyHash: true,
        services: {
          where: { id: serviceId },
          select: {
            title: true,
            description: true,
            parameters: true,
            recipientWallet: true,
            walletChain: true,
            serviceType: true,
            passwordProtected: true,
            globallyDiscoverable: true,
            accessUsername: true,
            accessPasswordHash: true,
          },
        },
      },
    });
    if (!row) {
      return res.status(404).json({ error: "Device not found" });
    }
    const device = row;
    const service = row.services[0];
    if (!service) {
      return res.status(404).json({ error: "Service not found" });
    }

    if (!service.globallyDiscoverable) {
      const deviceKey =
        (req.headers["x-device-key"] as string | undefined) ??
        (typeof req.body?.deviceKey === "string" ? req.body.deviceKey : undefined);
      if (!deviceKey || !apiKeyMatches(deviceKey, device.apiKeyHash)) {
        return res.status(404).json({ error: "Service not found" });
      }
    }

    const parsedParams = validateParamValues(
      toParamDefs(service.parameters),
      req.body?.params,
    );
    if (!parsedParams.ok) {
      return res.status(400).json({ error: parsedParams.error });
    }
    const params = parsedParams.values;

    // Password-protected services require a username + password on EVERY call
    // (free or paid), supplied either in the JSON body ({ username, password })
    // or via the `x-access-username` / `x-access-password` headers.
    if (service.passwordProtected) {
      const suppliedUser =
        (typeof req.body?.username === "string" ? req.body.username : undefined) ??
        (req.headers["x-access-username"] as string | undefined);
      const suppliedPass =
        (typeof req.body?.password === "string" ? req.body.password : undefined) ??
        (req.headers["x-access-password"] as string | undefined);

      const okUser =
        !service.accessUsername || suppliedUser === service.accessUsername;
      const okPass =
        !!service.accessPasswordHash &&
        typeof suppliedPass === "string" &&
        verifyPassword(suppliedPass, service.accessPasswordHash);

      if (!okUser || !okPass) {
        return res.status(401).json({
          error:
            "This service is password protected. Provide a valid username and password (body { username, password } or x-access-username / x-access-password headers).",
        });
      }
    }

    // The service owns its type, wallet + chain.
    const serviceType = service.serviceType;
    const recipientWallet = service.recipientWallet;
    const walletChain = service.walletChain as WalletChain;
    // The device's stored API key (hash). Passed to the device over MQTT so it
    // can authenticate the command it receives.
    const apiKey = device.apiKeyHash;
    // The PRIVATE connector id — the MQTT transport identity. All device
    // commands are routed on d/<connectorId>/…; the public deviceId never
    // touches MQTT.
    const connectorId = device.connectorId;

    // Free services skip payment entirely and return the result directly.
    if (serviceType === "FREE") {
      const device_response = await getResult(
        connectorId,
        serviceId,
        params,
        apiKey,
      );
      return res.status(201).json(sanitizeDeviceResult(device_response));
    }

    // Paid services must have a payout wallet configured somewhere.
    if (!recipientWallet) {
      return res
        .status(409)
        .json({ error: "Service has no recipient wallet configured" });
    }

    // `req.originalUrl` is just a path, so resolve it against PUBLIC_URL to
    // build the absolute resource URL. Production MUST set PUBLIC_URL so a
    // forged Host header cannot poison the x402 resource.
    if (!PUBLIC_URL && process.env.NODE_ENV === "production") {
      return res.status(500).json({ error: "PUBLIC_URL is not configured" });
    }
    let resourceUrl: string;
    try {
      resourceUrl = new URL(req.originalUrl, `${publicOrigin(req)}/`).toString();
    } catch {
      return res.status(500).json({
        error: "PUBLIC_URL is not a valid origin",
        detail: "Set PUBLIC_URL to https://device-controller.0xbs.org (no trailing path)",
      });
    }

    const headersEarly = getAllHeaders(req);
    const paymentIncoming =
      headersEarly["x-payment"] ?? headersEarly["payment-signature"];

    const cacheKey = quoteCacheKey(connectorId, serviceId, params);
    const cached = quoteCache.get(cacheKey);
    let amount: string;
    if (
      paymentIncoming &&
      cached &&
      Date.now() - cached.at < QUOTE_TTL_MS
    ) {
      amount = cached.amount;
    } else {
      const quote = await getPrice(connectorId, serviceId, params, apiKey);
      amount = usdToAtomicUsdc(quote?.price ?? quote);
      quoteCache.set(cacheKey, { amount, at: Date.now() });
    }

    if (amount === "0") {
      return res.status(409).json({
        error: "Paid service quoted $0 — refusing to issue a free 402",
      });
    }

    // One payment requirement per network the wallet's family can settle on.
    // The agent will choose exactly one of these to pay with. Solana entries
    // are enriched with the facilitator's sponsoring fee payer.
    //
    // `accepts` is the INTERNAL v2 shape (CAIP-2 network + `amount`) that the
    // CDP facilitator's verify/settle understands. We NEVER put this on the
    // wire directly — external agents speak v1, so we advertise `acceptsV1`
    // (network NAMES + `maxAmountRequired`) instead, and translate the chosen
    // one back to v2 before hitting the facilitator.
    const accepts = await Promise.all(
      networksFor(walletChain).map(async (n) => {
        const isSolana = n.network.startsWith("solana:");
        const feePayer = isSolana ? await solanaFeePayer(n.network) : undefined;
        return {
          scheme: "exact",
          network: n.network,
          amount,
          asset: n.asset,
          payTo: recipientWallet,
          maxTimeoutSeconds: 300,
          extra: feePayer ? { ...n.extra, feePayer } : n.extra,
        };
      }),
    );

    // The standard x402 v1 requirement shape (what x402-fetch / x402-axios
    // parse). Networks with no v1 name (World, Arbitrum) are dropped since a v1
    // client literally can't express them.
    const acceptsV1 = accepts.flatMap((a) => {
      const v1Network = CAIP2_TO_V1_NETWORK[a.network];
      if (!v1Network) return [];
      return [
        {
          scheme: a.scheme,
          network: v1Network,
          maxAmountRequired: a.amount,
          resource: resourceUrl,
          description: service.description ?? service.title ?? "Device service",
          mimeType: "application/json",
          payTo: a.payTo,
          maxTimeoutSeconds: a.maxTimeoutSeconds,
          asset: a.asset,
          extra: a.extra,
        },
      ];
    });

    // Standard x402 v1 402 payload: it lives in the RESPONSE BODY (not a
    // header), as `{ x402Version, accepts }`.
    const paymentRequiredBody = {
      x402Version: 1,
      error: "X-PAYMENT header is required",
      accepts: acceptsV1,
    };

    // The same offer in v2 form, carried in the `PAYMENT-REQUIRED` header.
    //
    // A v2 client (`@x402/*`) can already READ the v1 body — but its scheme
    // implementations refuse to SIGN against a v1 requirement ("Unsupported
    // x402Version: 1"), so advertising v1 alone leaves them unable to pay at
    // all. Publishing both dialects lets each client use the one it can sign:
    // v1 clients read the body and ignore the header, v2 clients prefer the
    // header. This is also the only way to offer the networks v1 has no name
    // for (World, Arbitrum), since it carries CAIP-2 ids as-is.
    const paymentRequiredV2 = {
      x402Version: 2,
      error: "PAYMENT-SIGNATURE header is required",
      resource: {
        url: resourceUrl,
        description: service.description ?? service.title ?? "Device service",
        mimeType: "application/json",
      },
      accepts,
    };

    // Set on every 402 below, not just the first, so a client retrying after a
    // rejected payment can still read the requirements.
    res.setHeader("PAYMENT-REQUIRED", encodeHeader(paymentRequiredV2));
    res.setHeader(
      "Access-Control-Expose-Headers",
      "PAYMENT-REQUIRED,PAYMENT-RESPONSE,X-PAYMENT-RESPONSE",
    );

    // v1 clients send the payment in `X-PAYMENT`, v2 clients in
    // `PAYMENT-SIGNATURE` — which is also the legacy header the original
    // in-repo agent used, so one lookup covers both.
    const headers = getAllHeaders(req);
    const paymentSignature = headers["x-payment"] ?? headers["payment-signature"];

    if (!paymentSignature) {
      res.setHeader("Cache-Control", "no-store");
      return res.status(402).json(paymentRequiredBody);
    }

    // Either dialect can arrive here:
    //   v1 → { x402Version: 1, scheme, network(NAME), payload }
    //   v2 → { x402Version: 2, accepted: <requirement>, payload }
    // v1 names the chosen network at the top level; v2 echoes back the whole
    // requirement it selected under `accepted`.
    type PaymentPayloadEither = {
      x402Version?: number;
      scheme?: string;
      network?: string;
      accepted?: { network?: string };
      payload: Record<string, unknown>;
    };
    let decoded: PaymentPayloadEither;

    try {
      decoded = decodeHeader<PaymentPayloadEither>(paymentSignature);
    } catch {
      return res.status(402).json({
        ...paymentRequiredBody,
        error: "Invalid payment header",
      });
    }

    const paidWithV2 = decoded.x402Version === 2 || decoded.accepted != null;

    // Only the CHOICE of network is taken from the client; the requirement used
    // for verify/settle is always looked up from our own `accepts` below. A
    // client therefore cannot dictate a cheaper amount or a different payout
    // address by editing the `accepted` object it sends back.
    const chosenNetwork = paidWithV2
      ? decoded.accepted?.network
      : decoded.network
        ? V1_TO_CAIP2_NETWORK[decoded.network]
        : undefined;

    const matched = chosenNetwork
      ? accepts.find((a) => a.network === chosenNetwork)
      : undefined;

    if (!matched) {
      return res.status(402).json({
        ...paymentRequiredBody,
        error: "Payment offered on an unsupported network",
      });
    }

    // Solana fee-payer rotation defense. The CDP facilitator sponsors (and
    // ROTATES) the Solana fee payer, so the value we advertised in this 402 may
    // differ from the one the buyer actually signed with (they may have fetched
    // an earlier 402). With x402 v1 the buyer's fee payer is NOT echoed in the
    // JSON payload — it lives only inside the signed transaction — so we decode
    // it out of the tx and verify/settle against THAT, matching what the buyer
    // used instead of a freshly-rotated value (`..._fee_payer_mismatch`).
    let chosen = matched;
    if (chosen.network.startsWith("solana:")) {
      const signedTx = (
        decoded.payload as { transaction?: string } | undefined
      )?.transaction;
      const signedFeePayer = signedTx ? solanaTxFeePayer(signedTx) : undefined;
      if (signedFeePayer) {
        chosen = {
          ...chosen,
          extra: { ...chosen.extra, feePayer: signedFeePayer },
        };
      }
    }

    // Hand the facilitator a v2 PaymentPayload regardless of which dialect the
    // client used: { x402Version, accepted: <v2 requirements>, payload }. The
    // inner `payload` (EIP-3009 authorization on EVM, signed tx on Solana) is
    // scheme-identical between v1 and v2, so it passes through untouched.
    const paymentPayload: PaymentPayload = {
      x402Version: 2,
      accepted: chosen as PaymentRequirements,
      payload: decoded.payload,
    };

    // Verify the payment before executing the API. The facilitator THROWS a
    // VerifyError on an invalid payment (it doesn't return isValid:false), and
    // its `invalidReason`/`invalidMessage` carry the actionable detail — e.g.
    // the recipient has no USDC token account, or insufficient funds. Surface
    // that to the agent instead of a blind 502.
    let verification;
    try {
      verification = await facilitator.verify(
        paymentPayload,
        chosen as PaymentRequirements,
      );
    } catch (err) {
      const { reason, message } = facilitatorError(err, "Payment verification failed");
      return res
        .status(402)
        .json({ ...paymentRequiredBody, error: reason, detail: message });
    }

    if (!verification.isValid) {
      const reason = verification.invalidReason ?? "Invalid payment";
      return res.status(402).json({
        ...paymentRequiredBody,
        error: reason,
        detail: verification.invalidMessage,
      });
    }

    // Actuate only after the payment verifies, settle only after the device
    // replies. A timeout then does not take the buyer's USDC.
    let result: unknown;
    try {
      result = sanitizeDeviceResult(
        await getResult(connectorId, serviceId, params, apiKey),
      );
    } catch (err) {
      console.error("[quote] device failed after verified payment:", err);
      return res.status(502).json({
        error: "Device did not complete the call; payment was not settled",
        detail: err instanceof Error ? err.message : String(err),
      });
    }

    let settlement;
    try {
      settlement = await facilitator.settle(
        paymentPayload,
        chosen as PaymentRequirements,
      );
    } catch (err) {
      const { reason, message } = facilitatorError(err, "Settlement failed");
      return res.status(402).json({
        ...paymentRequiredBody,
        error: reason,
        detail: message,
      });
    }

    if (!settlement.success) {
      return res.status(402).json({
        ...paymentRequiredBody,
        error: settlement.errorReason ?? "Settlement failed",
        detail: settlement.errorMessage,
      });
    }

    const settlementV1 = {
      success: settlement.success,
      transaction: settlement.transaction,
      network: CAIP2_TO_V1_NETWORK[chosen.network] ?? chosen.network,
      payer: (settlement as { payer?: string }).payer,
    };
    res.setHeader("X-PAYMENT-RESPONSE", encodeHeader(settlementV1));
    if (paidWithV2) {
      res.setHeader(
        "PAYMENT-RESPONSE",
        encodeHeader({ ...settlementV1, network: chosen.network }),
      );
    }
    res.setHeader("Cache-Control", "private");

    await prisma.payment
      .create({
        data: {
          deviceId,
          serviceId,
          network: chosen.network,
          transaction: settlement.transaction,
          amount,
          payer: settlementV1.payer ?? null,
          idempotencyKey: idempotencyKey || null,
          result: result as object,
        },
      })
      .catch((err) => console.error("[quote] failed to persist payment:", err));

    return res.json(result);
  } catch (err) {
    // Fail closed—never make the endpoint free when pricing fails.
    console.error("[quote] payment processing failed:", err);
    const { reason, message } = facilitatorError(err, "Payment processing failed");
    return res.status(502).json({
      error: reason,
      detail: message,
    });
  }
});

export { quoteRouter };
