import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "@0xBs/db";
import { getJwtSecret } from "../lib/jwt-secret.js";

type AuthPayload = jwt.JwtPayload & {
  userid?: string;
};

export const requireUserDetails: RequestHandler = async (req, res, next) => {
  const cookieAuthorization = req.cookies?.authorization;
  const headerAuthorization = req.headers.authorization;
  const authorization = cookieAuthorization ?? headerAuthorization;

  if (!authorization) {
    return res.status(401).json({ error: "Missing bearer token" });
  }

  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : authorization;

  try {
    const payload = jwt.verify(token, getJwtSecret()) as AuthPayload;

    if (!payload.userid) {
      return res.status(401).json({ error: "unauthorized user" });
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userid },
      select: {
        id: true,
        email: true,
        name: true,
      },
    });

    if (!user) {
      return res.status(401).json({ error: "unauthorized user" });
    }

    res.locals.user = user;
    return next();
  } catch {
    return res.status(401).json({ error: "unauthorized user" });
  }
};
