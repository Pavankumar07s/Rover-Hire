import "dotenv/config";
import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import deviceRouter from "./routes/devices/index.js";
import publicRouter from "./routes/public/index.js";
import { requireAuth } from "./middlewares/require-auth.js";
import {
  requestLogger,
  notFoundHandler,
  errorHandler,
  registerProcessErrorHandlers,
} from "./middlewares/error-handler.js";
import { quoteRouter } from "./routes/quote/index.js";
import { getMqttClient } from "./lib/mqtt.js";
import { rateLimit } from "./lib/rate-limit.js";

registerProcessErrorHandlers();

// Open the broker connection at boot so the first device call doesn't pay for
// the connect (and TLS handshake, on a remote broker).
getMqttClient();

const app: Express = express();
const PORT = process.env.PORT ?? 4001;
const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:3000";

app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(requestLogger);

app.get("/health", (_req, res) => {
  res.status(200).json({ message: "All Good !!!" });
});

// Everything else under /devices (and nested /services) requires auth.
app.use("/devices", requireAuth, deviceRouter);

// Public, unauthenticated discovery for agents (CORS open to any origin). Only
// exposes non-sensitive fields — never the connectorId / API key / wallet.
app.use("/public", cors({ origin: "*" }), publicRouter);

// The callable x402 endpoint. Open to any origin so agents can pay + call.
app.use("/quote", cors({ origin: "*" }), rateLimit({ windowMs: 60_000, max: 60 }), quoteRouter);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`[device-controller] listening on http://localhost:${PORT}`);
  });
}
