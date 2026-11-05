import type { RequestHandler } from "express";

type Bucket = { n: number; reset: number };

export function rateLimit(options: {
  windowMs: number;
  max: number;
}): RequestHandler {
  const hits = new Map<string, Bucket>();
  const { windowMs, max } = options;

  return (req, res, next) => {
    const id = req.ip ?? req.socket.remoteAddress ?? "unknown";
    const now = Date.now();
    const bucket = hits.get(id);
    if (!bucket || now >= bucket.reset) {
      hits.set(id, { n: 1, reset: now + windowMs });
      next();
      return;
    }
    bucket.n += 1;
    if (bucket.n > max) {
      const retry = Math.ceil((bucket.reset - now) / 1000);
      res.setHeader("Retry-After", String(retry));
      res.status(429).json({ error: "Too many requests. Try again shortly." });
      return;
    }
    next();
  };
}
