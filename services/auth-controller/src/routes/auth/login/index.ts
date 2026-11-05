import { Router, type Router as ExpressRouter } from "express";
import { prisma } from "@0xBs/db";
import {
  verifyPassword,
  needsRehash,
  hashPassword,
} from "../../../lib/hash-pass.js";

const loginRouter: ExpressRouter = Router();

loginRouter.post("/", async (req, res) => {
  const email =
    typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const pass = typeof req.body?.pass === "string" ? req.body.pass : "";

  if (!email || !pass) {
    res.status(400).json({ error: "email and pass are required" });
    return;
  }

  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || !verifyPassword(pass, user.passwordHash)) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  if (needsRehash(user.passwordHash)) {
    await prisma.user
      .update({
        where: { id: user.id },
        data: { passwordHash: hashPassword(pass) },
      })
      .catch(() => {});
  }

  res.json({
    user: { id: user.id, name: user.name, email: user.email },
  });
});

export default loginRouter;
