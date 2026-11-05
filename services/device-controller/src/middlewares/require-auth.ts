import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "@0xBs/db";

const secret = process.env.JWT_SECRET;
if (!secret) throw new Error("JWT_SECRET is required");
const SECRET: string = secret;

type AuthPayload = jwt.JwtPayload & {
  userid?: string;
};

/**
 * Verifies the JWT from the `authorization` cookie (or Authorization header /
 * body) and attaches the authenticated user id to `res.locals.userId`.
 */
export const requireAuth: RequestHandler = async (req, res, next) => {
  const cookieAuth = req.cookies?.authorization;
  const headerAuth = req.headers.authorization;
  const authorization = cookieAuth ?? headerAuth;

  if (!authorization) {
    res.status(401).json({ error: "Missing bearer token" });
    return;
  }

  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : authorization;

  try {
    const payload = jwt.verify(token, SECRET) as AuthPayload;
    if (!payload.userid) {
      res.status(401).json({ error: "unauthorized user" });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userid },
      select: { id: true },
    });

    if (!user) {
      res.status(401).json({ error: "unauthorized user" });
      return;
    }

    res.locals.userId = user.id;
    next();
  } catch {
    res.status(401).json({ error: "unauthorized user" });
  }
};
