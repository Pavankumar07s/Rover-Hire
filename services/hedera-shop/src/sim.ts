// Simulated seller (D1): A2A quotes and negotiation only. No body, so no mission, no payments, no money topic.
import express from "express";
import { a2aRouter } from "./a2a.js";
import { cfg } from "./config.js";
import { Quotes } from "./quotes.js";

const quotes = new Quotes(cfg.seller);
const app = express();
app.use(express.json());
app.use(a2aRouter(quotes));
app.use("/missions", (_req, res) => void res.status(503).json({ error: "simulated seller, no body" }));
app.get("/health", (_req, res) => res.json({ ok: true, seller: cfg.seller, pay_to: cfg.payTo, simulated: true }));
app.listen(cfg.port, () => console.log(`${cfg.name} on :${cfg.port}, payTo ${cfg.payTo}`));
