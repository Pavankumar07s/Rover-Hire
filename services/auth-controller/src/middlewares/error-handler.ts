import type { ErrorRequestHandler, RequestHandler } from "express";

const SERVICE = "auth-controller";

// One line per request; 5xx are logged as errors so failures stand out.
export const requestLogger: RequestHandler = (req, res, next) => {
  const startedAt = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - startedAt;
    const line = `[${SERVICE}] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms}ms)`;
    if (res.statusCode >= 500) console.error(line);
    else console.log(line);
  });
  next();
};

export const notFoundHandler: RequestHandler = (req, res) => {
  console.warn(`[${SERVICE}] 404 ${req.method} ${req.originalUrl}`);
  res.status(404).json({ error: "Not found" });
};

// Central error handler: logs which service failed, where, and the full stack.
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  const e = err as { status?: number; statusCode?: number };
  const status = e?.status ?? e?.statusCode ?? 500;
  const message = err instanceof Error ? err.message : String(err);
  console.error(
    `[${SERVICE}] ERROR ${req.method} ${req.originalUrl} -> ${status} ${message}`,
  );
  if (err instanceof Error && err.stack) console.error(err.stack);
  if (res.headersSent) return next(err);
  // Expose the message for client errors (4xx); hide internals for 5xx.
  res
    .status(status)
    .json({ error: status < 500 ? message : "Internal server error" });
};

// Last-resort logging so a stray rejection/exception names the guilty service.
export const registerProcessErrorHandlers = () => {
  process.on("unhandledRejection", (reason) => {
    console.error(`[${SERVICE}] UNHANDLED REJECTION ->`, reason);
  });
  process.on("uncaughtException", (err) => {
    console.error(`[${SERVICE}] UNCAUGHT EXCEPTION ->`, err);
  });
};
