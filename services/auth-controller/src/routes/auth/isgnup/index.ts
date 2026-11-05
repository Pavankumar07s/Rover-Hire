import { Router, type Router as ExpressRouter } from "express";
import { prisma } from "@0xBs/db";
import { hashPassword, MIN_PASSWORD_LENGTH } from "../../../lib/hash-pass.js";

const signupRouter: ExpressRouter = Router();

signupRouter.post("/", async (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const email =
    typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const pass = typeof req.body?.pass === "string" ? req.body.pass : "";

  if (!name || !email || !pass) {
    return res.status(400).json({ error: "name, email and pass are required" });
  }

  if (pass.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: "An account with this email already exists" });
  }

  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash: hashPassword(pass),
    },
    select: { id: true, name: true, email: true },
  });

  res.status(201).json({ user });
});

signupRouter.get("/health", (_req, res) => {
  res.status(200).json({ message: "All Good !!!" });
});

export default signupRouter;
