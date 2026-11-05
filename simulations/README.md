# Simulations

Local scripts to test MQTT (EMQX) without any real ESP32 hardware.

## Prerequisites

EMQX running locally (started earlier with Docker):

```bash
docker run -d --name emqx -p 1883:1883 -p 8083:8083 -p 18083:18083 emqx/emqx:latest
```

Install deps once (from this folder):

```bash
pnpm install --ignore-workspace
```

## Try it: one message, server → device

Open **two terminals**, both in this `simulations/` folder.

**Terminal 1 — the fake device (listens):**

```bash
pnpm listen
```

**Terminal 2 — the fake server (sends one command):**

```bash
pnpm send
```

Terminal 1 should instantly print the command. That message travelled:
`sender → EMQX → listener`. That is the whole idea of MQTT.

## Files

- `config.ts` — broker URL + topic names + IDs (shared).
- `esp.ts` — fake device; subscribes to `d/<connectorId>/cmd` and replies.
- `sender.ts` — publishes one command to `d/<connectorId>/cmd` and exits.
- `agent.ts` — x402 buyer that calls a service via the device-controller.

## Public device id vs private connector id

A device now has two identifiers:

- **`DEVICE_ID`** (public) — shared with agents; appears in the callable URL and
  in public discovery (`GET /public/device/:deviceId`).
- **`CONNECTOR_ID`** (private) — the MQTT transport identity. All topics are
  `d/<connectorId>/…`, and the device connects with `clientId = connectorId`.
  **Never share it.** Set it via the `CONNECTOR_ID` env var (or the default in
  `config.ts`, which points at the test device's connector id).
