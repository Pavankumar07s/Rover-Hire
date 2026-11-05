# 0xBS device services — x402 skill for AI agents

This document teaches an AI agent how to **discover and call a physical device /
service** exposed by 0xBS. Drop it into agent context (a skill / tool doc) or
fetch it at **`/skills.md`**.

0xBS is a **machine-payable control plane for physical AI**: MCU-class hardware
(ESP32, sensors, robotics, UAVs) becomes a globally addressable x402 endpoint.
Agents prompt in natural language, settle USDC, and receive actuation or
telemetry. The microcontroller does not hold a wallet.

Everything works with **standard, off-the-shelf x402 tooling** (`x402-fetch`,
`x402-axios`, Coinbase AgentKit, MCP x402 tools). No custom SDK on the agent
side. If your agent already pays x402 endpoints, it already knows how to call
this system — supply `deviceId` + `serviceId` + `params`.

---

## Identifiers you will see

| ID | Visibility | Purpose |
|---|---|---|
| **`deviceId`** (public) | **Shared with everyone.** Appears in the callable URL and in discovery. | Address a device from an agent. |
| **`serviceId`** (public) | Shared. Returned by discovery. | Address a specific capability on a device. |
| **`connectorId`** (PRIVATE) | **NEVER shared. Never returned by any public/agent route.** | Server↔device MQTT transport identity (ESP32 / IoT). |

> ⚠️ **Do not ask for, log, or share the `connectorId`.** It is a device secret used
> only for the private MQTT link between the server and the hardware. Agents never
> need it and never see it — knowing a public `deviceId` is enough to *call* a device,
> but can never be used to talk to its transport directly.

---

## TL;DR

1. **See what is online** (no wallet, no auth, no device id):

   ```
   GET {DEVICE_CONTROLLER_URL}/public/devices
   ```

   Returns currently connected devices that opted into public discovery.

2. **Discover** what a device offers (no wallet, no auth):

   ```
   GET {DEVICE_CONTROLLER_URL}/public/device/{deviceId}
   ```

   Returns the device name, description, and **every public service** with its full
   argument schema (name, type, required, description), whether it's **free or
   paid**, and whether it's **password protected**.

3. **Call** a service:

   ```
   POST {DEVICE_CONTROLLER_URL}/quote/device/{deviceId}/service/{serviceId}
   Content-Type: application/json

   { "params": { ...arguments from discovery... } }
   ```

   - **FREE service** → returns the device result directly (`201`). Any HTTP client
     works (plain ChatGPT/Claude with an HTTP tool, `curl`, `fetch`). No wallet.
   - **PAID service** → returns `402 Payment Required` (standard x402). Wrap your
     HTTP client with **any x402 adapter**; it pays USDC and retries automatically.
   - **PASSWORD-PROTECTED service** → also send credentials (see §4).

---

## 1. Discover a device and its services

```
GET {DEVICE_CONTROLLER_URL}/public/device/{deviceId}
```

Unauthenticated, CORS-open. Example response:

```jsonc
{
  "device": {
    "id": "f7d0d122-…",             // public deviceId
    "title": "Warehouse HVAC gateway",
    "description": "Controls per-room climate on floors 1–8",
    "services": [
      {
        "id": "455e8ec1-…",          // serviceId
        "title": "Set room temperature",
        "description": "Sets the target temperature for a room",
        "serviceType": "PAID",       // FREE | PAID
        "paid": true,
        "payoutChain": "BASE",       // payout wallet family (BASE | SOLANA)
        "passwordProtected": false,
        "call": { "method": "POST", "path": "/quote/device/f7d0d122-…/service/455e8ec1-…" },
        "arguments": [
          { "name": "room",  "type": "string", "required": true,  "description": "Room number" },
          { "name": "floor", "type": "string", "required": true,  "description": "Floor number" },
          { "name": "celsius", "type": "number", "required": false, "description": "Target °C (default 21)" }
        ]
      }
    ]
  }
}
```

- **All services are listed** — free, paid, open, and password-protected — so the
  agent knows the full menu. Password-protected ones are flagged; you must supply
  credentials to actually call them (§4).
- Build your `params` object from each service's `arguments` (respect `type` and
  `required`). Never returned here: `connectorId`, API keys, wallet addresses,
  password hashes.

---

## 2. Call a FREE service — no wallet needed (works in normal ChatGPT / Claude)

```bash
curl -X POST "$DEVICE_CONTROLLER_URL/quote/device/$DEVICE_ID/service/$SERVICE_ID" \
  -H "content-type: application/json" \
  -d '{"params":{"room":"100","floor":"5"}}'
```

Returns `201` with the raw device result. Any tool that can POST works — a Custom
GPT Action, a Claude HTTP tool, `fetch`, `curl`.

```ts
const res = await fetch(
  `${DEVICE_CONTROLLER_URL}/quote/device/${deviceId}/service/${serviceId}`,
  { method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ params: { room: "100", floor: "5" } }) },
);
const result = await res.json();
```

---

## 3. Call a PAID service — standard x402 (use ANY x402 adapter)

An unauthenticated call to a paid service returns a `402` carrying **both**
generations of the x402 protocol, so either kind of adapter can pay:

| Adapter | Reads requirements from | Sends payment in | Networks it can reach |
| --- | --- | --- | --- |
| v1 (`x402-fetch`, `x402-axios`, AgentKit) | the JSON body below | `X-PAYMENT` | Base, Polygon, Solana |
| v2 (`@x402/*`) | the `PAYMENT-REQUIRED` header | `PAYMENT-SIGNATURE` | all of the above plus Arbitrum, World Chain |

Both dialects are advertised on every `402`. A v2 client *can* read the v1 body,
but its scheme implementations refuse to sign against a v1 requirement, which is
why the header is published alongside it.

The body is standard x402 v1:

```jsonc
// HTTP 402 Payment Required
{
  "x402Version": 1,
  "error": "X-PAYMENT header is required",
  "accepts": [
    {
      "scheme": "exact",
      "network": "base",              // v1 name: base | base-sepolia | polygon | solana | solana-devnet
      "maxAmountRequired": "1000000", // atomic USDC (6 decimals) → 1.0 USDC
      "resource": "https://…/quote/device/…/service/…",
      "payTo": "0x… / base58…",
      "asset": "0x… / mint…",
      "maxTimeoutSeconds": 300,
      "extra": { "name": "USDC", "version": "2" }
    }
  ]
}
```

Hand this to an x402 adapter — it signs the USDC payment, adds `X-PAYMENT`, and
retries. On success you get the raw device result plus an `X-PAYMENT-RESPONSE`
header (base64 settlement receipt). A v2 payer additionally gets
`PAYMENT-RESPONSE`, identical except the network is the CAIP-2 id it paid on.

Only the *choice* of network is taken from the payer; the amount, asset and
payout address always come from the server's own requirement, so a client can't
propose cheaper terms by editing the requirement it echoes back.

### 3a. `x402-fetch`

```ts
import {
  createSigner, wrapFetchWithPayment, decodeXPaymentResponse,
  type MultiNetworkSigner,
} from "x402-fetch";

const evm = await createSigner("base", process.env.AGENT_EVM_PRIVATE_KEY!);    // 0x… hex
const svm = await createSigner("solana", process.env.AGENT_SOLANA_PRIVATE_KEY!); // base58
const wallet = { evm, svm } as MultiNetworkSigner;

const fetchWithPay = wrapFetchWithPayment(fetch, wallet, 1_000_000n); // cap: 1 USDC

const res = await fetchWithPay(
  `${DEVICE_CONTROLLER_URL}/quote/device/${deviceId}/service/${serviceId}`,
  { method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ params: { room: "100", floor: "5" } }) },
);

const xpr = res.headers.get("x-payment-response");
if (xpr) console.log("settled:", decodeXPaymentResponse(xpr));
console.log("result:", await res.json());
```

> A complete, runnable buyer lives at `simulations/agent.ts`.

### 3b. `x402-axios`

```ts
import axios from "axios";
import { withPaymentInterceptor } from "x402-axios";
const client = withPaymentInterceptor(axios.create(), wallet /* same signer */);
const { data } = await client.post(
  `${DEVICE_CONTROLLER_URL}/quote/device/${deviceId}/service/${serviceId}`,
  { params: { room: "100", floor: "5" } },
);
```

### 3c. Coinbase AgentKit / LangChain / any x402 tool

Give the agent a funded wallet + the x402 tool, then point it at the URL. The tool
handles `402 → pay → retry`. The model only supplies `deviceId`, `serviceId`, `params`.

---

## 4. Call a PASSWORD-PROTECTED service

Discovery marks these with `"passwordProtected": true`. To call one you must supply
a **username + password** (issued by the device owner) on every request, in addition
to any payment. Two equivalent ways:

**In the JSON body:**

```jsonc
{
  "username": "agent-alice",
  "password": "s3cr3t",
  "params": { "room": "100", "floor": "5" }
}
```

**Or via headers:**

```
x-access-username: agent-alice
x-access-password: s3cr3t
```

- Wrong/missing credentials → `401` (`This service is password protected …`).
- This works alongside x402: for a **paid + protected** service, send credentials
  *and* let the x402 adapter pay. With `x402-fetch`/`x402-axios`, put the
  credentials in the request body (or headers) — the adapter preserves them across
  the pay-and-retry.
- Free + protected services just need the credentials (no wallet).

---

## 5. Payment facts

- **Asset:** USDC only, 6 decimals, on every supported network.
- **Networks:** v1 names are `base`, `base-sepolia`, `polygon`, `solana`,
  `solana-devnet`. The v2 advertisement uses CAIP-2 ids and additionally reaches
  Arbitrum (`eip155:42161`) and World Chain (`eip155:480`, `eip155:4801`), which
  v1 has no names for. `accepts` lists one entry per network the service's wallet
  family supports; the agent picks whichever chain it holds funds on.
- **Amount:** `maxAmountRequired` is atomic USDC. `1000000` = `1.00 USDC`. The device
  sets the price per request (it can depend on `params`).
- **Wallet families:** one EVM `0x…` key covers all EVM networks; one Solana base58
  key covers all Solana networks. Provide either or both.
- **Settlement:** on success the `X-PAYMENT-RESPONSE` header holds a base64 receipt —
  decode with `decodeXPaymentResponse` → `{ network, transaction, payer }`.

---

## 6. Errors an agent should handle

| Status | Meaning | Action |
|---|---|---|
| `402` (with `accepts`) | payment required | let the x402 adapter pay + retry |
| `402` `{ error, detail }` | payment verify/settle failed | show `detail` (e.g. insufficient funds, recipient has no USDC token account) |
| `401` password protected | missing/invalid access credentials | supply `username` + `password` (§4) |
| `404` Device/Service not found | bad `deviceId`/`serviceId` | re-run discovery (§1) |
| `409` no recipient wallet | paid service misconfigured by the owner | not fixable by the agent |
| `502` `{ error, detail }` | pricing / processing failed server-side | retry later |

---

## 7. Integrating into existing infra — quick recipes

- **Plain ChatGPT / Claude (discovery + free services):** add an HTTP tool / Custom
  GPT Action for `GET /public/device/{deviceId}` and `POST /quote/device/{deviceId}/service/{serviceId}`.
- **ChatGPT / Claude paying for services:** the model **cannot** sign payments itself.
  Put an **x402-enabled wrapper** between the model and the endpoint:
  - **Claude Desktop / API:** expose an **MCP tool** whose handler is the `x402-fetch`
    snippet in §3a (holds the wallet key), input `{ deviceId, serviceId, params, username?, password? }`.
  - **ChatGPT:** expose a **Custom GPT Action** whose backend runs the same wrapper.
- **Existing autonomous agent (AgentKit / LangChain / custom):** it already has an
  x402 tool + wallet — give it discovery + the call URL.

The whole surface is intentionally **standard x402 + plain JSON**, so any current or
future x402 client works without changes here.
