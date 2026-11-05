import "dotenv/config";
import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import authRouter from "./routes/auth/index.js";
import userRouter from "./routes/user/index.js";
import {
  requestLogger,
  notFoundHandler,
  errorHandler,
  registerProcessErrorHandlers,
} from "./middlewares/error-handler.js";
import { rateLimit } from "./lib/rate-limit.js";

registerProcessErrorHandlers();

const app: Express = express();
const PORT = process.env.PORT ?? 4000;
const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:3000";

app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(requestLogger);

app.use(
  "/auth",
  rateLimit({ windowMs: 15 * 60_000, max: 30 }),
  authRouter,
);
app.use("/user", userRouter);

app.get("/health", (req, res) => {
  res.status(200).json({ message: "All Good !!!" });
});

app.get("/", (_req, res) => {
  res.status(200).json({ service: "auth-controller", ok: true });
});

app.use(notFoundHandler);
app.use(errorHandler);

export default app;

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`[auth-controller] listening on http://localhost:${PORT}`);
  });
}
