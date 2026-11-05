import { NextResponse } from "next/server";
import { prisma } from "@0xBs/db";
import { getSessionUserId } from "@/lib/auth";
import {
  isWalletChain,
  normalizeWalletForChain,
  type WalletChain,
} from "@/lib/api-key";
import { hashPassword } from "@/lib/password";

type Ctx = { params: Promise<{ deviceId: string }> };

// Common select for returning a service (never exposes the password hash).
const SERVICE_SELECT = {
  id: true,
  title: true,
  description: true,
  parameters: true,
  recipientWallet: true,
  walletChain: true,
  serviceType: true,
  passwordProtected: true,
  globallyDiscoverable: true,
  accessUsername: true,
  createdAt: true,
} as const;

// The argument value types a service can declare.
const PARAM_TYPES = ["string", "number", "boolean"] as const;
type ParamType = (typeof PARAM_TYPES)[number];
type ParamDef = {
  name: string;
  type: ParamType;
  required: boolean;
  description?: string;
};
// An argument `name` is used as a JSON key when agents call the service, so it
// must be a valid identifier in JS, Python AND C++: start with a letter or
// underscore, then letters / digits / underscores only. No spaces or hyphens.
const PARAM_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Reserved words across JS / Python / C++ that must not be used as identifiers.
const RESERVED_WORDS = new Set([
  // JavaScript
  "break", "case", "catch", "class", "const", "continue", "debugger",
  "default", "delete", "do", "else", "export", "extends", "finally", "for",
  "function", "if", "import", "in", "instanceof", "new", "return", "super",
  "switch", "this", "throw", "try", "typeof", "var", "void", "while", "with",
  "yield", "let", "static", "enum", "await", "implements", "package",
  "protected", "interface", "private", "public", "null", "true", "false",
  // Python
  "and", "as", "assert", "async", "def", "del", "elif", "except", "from",
  "global", "is", "lambda", "nonlocal", "not", "or", "pass", "raise", "None",
  "True", "False",
  // C++
  "alignas", "alignof", "asm", "auto", "bool", "char", "const_cast", "decltype",
  "double", "dynamic_cast", "explicit", "float", "friend", "inline", "int",
  "long", "mutable", "namespace", "operator", "register", "reinterpret_cast",
  "short", "signed", "sizeof", "struct", "template", "typedef", "typeid",
  "typename", "union", "unsigned", "using", "virtual", "volatile", "wchar_t",
]);

/**
 * Validate and normalise the arguments a service declares. Returns the cleaned
 * list, or an error string when a definition is malformed.
 */
function parseParamDefs(
  input: unknown,
): { ok: true; defs: ParamDef[] } | { ok: false; error: string } {
  if (input === undefined || input === null) return { ok: true, defs: [] };
  if (!Array.isArray(input)) {
    return { ok: false, error: "parameters must be an array" };
  }

  const defs: ParamDef[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < input.length; i++) {
    const raw = input[i] as Record<string, unknown>;
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: `parameters[${i}] must be an object` };
    }
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (/\s/.test(name)) {
      return { ok: false, error: `parameters[${i}].name cannot contain spaces` };
    }
    if (!PARAM_NAME_RE.test(name)) {
      return {
        ok: false,
        error: `parameters[${i}].name is not a valid identifier (letters, numbers, _; must start with a letter or _; no spaces, hyphens, or symbols)`,
      };
    }
    if (RESERVED_WORDS.has(name)) {
      return {
        ok: false,
        error: `parameters[${i}].name "${name}" is a reserved keyword (JS/Python/C++)`,
      };
    }
    if (seen.has(name)) {
      return { ok: false, error: `duplicate parameter name "${name}"` };
    }
    seen.add(name);
    const type = raw.type as ParamType;
    if (!PARAM_TYPES.includes(type)) {
      return {
        ok: false,
        error: `parameters[${i}].type must be one of: ${PARAM_TYPES.join(", ")}`,
      };
    }
    const required = raw.required === undefined ? true : raw.required === true;
    const def: ParamDef = { name, type, required };
    if (typeof raw.description === "string" && raw.description.trim()) {
      def.description = raw.description.trim();
    }
    defs.push(def);
  }
  return { ok: true, defs };
}

// GET /api/devices/:deviceId/services
export async function GET(_request: Request, { params }: Ctx) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { deviceId } = await params;

  const device = await prisma.device.findFirst({
    where: { id: deviceId, userId },
    select: { id: true },
  });
  if (!device) {
    return NextResponse.json({ error: "Device not found" }, { status: 404 });
  }

  const services = await prisma.service.findMany({
    where: { deviceId },
    orderBy: { createdAt: "desc" },
    select: SERVICE_SELECT,
  });

  return NextResponse.json({ services });
}

// POST /api/devices/:deviceId/services — create a service
export async function POST(request: Request, { params }: Ctx) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { deviceId } = await params;

  const device = await prisma.device.findFirst({
    where: { id: deviceId, userId },
    select: { id: true },
  });
  if (!device) {
    return NextResponse.json({ error: "Device not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const description =
    typeof body?.description === "string" ? body.description.trim() : "";

  if (!title) {
    return NextResponse.json(
      { error: "Service name is required" },
      { status: 400 },
    );
  }

  // The arguments this service accepts (name / type / description).
  const parsedParams = parseParamDefs(body?.parameters);
  if (!parsedParams.ok) {
    return NextResponse.json({ error: parsedParams.error }, { status: 400 });
  }

  // ── Per-service payout wallet (devices have no wallet) ──────────────────
  // The chain this service settles on. Defaults to BASE when not specified.
  let walletChain: WalletChain = "BASE";
  if (body?.walletChain != null) {
    if (!isWalletChain(body.walletChain)) {
      return NextResponse.json(
        { error: "walletChain must be BASE or SOLANA" },
        { status: 400 },
      );
    }
    walletChain = body.walletChain;
  }

  // The address that receives payouts for this service, validated against the
  // chosen chain. Optional at create time (a paid service needs one to run).
  let recipientWallet: string | null = null;
  if (typeof body?.recipientWallet === "string" && body.recipientWallet.trim()) {
    recipientWallet = normalizeWalletForChain(body.recipientWallet, walletChain);
    if (!recipientWallet) {
      return NextResponse.json(
        {
          error:
            walletChain === "SOLANA"
              ? "Recipient wallet must be a valid Solana address (base58)"
              : "Recipient wallet must be a valid Base address (0x…)",
        },
        { status: 400 },
      );
    }
  }

  // Per-service type. Defaults to FREE when not specified.
  const serviceType =
    body?.serviceType === "PAID" || body?.serviceType === "FREE"
      ? body.serviceType
      : "FREE";
  // Per-service settings (no device inheritance). Defaults: not protected,
  // globally discoverable.
  const passwordProtected = body?.passwordProtected === true;
  const globallyDiscoverable = body?.globallyDiscoverable !== false;

  // Access credentials only matter when protection is on for this service.
  let accessUsername: string | null = null;
  let accessPasswordHash: string | null = null;
  if (passwordProtected) {
    accessUsername =
      typeof body?.accessUsername === "string" && body.accessUsername.trim()
        ? body.accessUsername.trim()
        : null;
    const pass =
      typeof body?.accessPassword === "string" ? body.accessPassword : "";
    if (!pass) {
      return NextResponse.json(
        { error: "A password is required for a password-protected service" },
        { status: 400 },
      );
    }
    accessPasswordHash = hashPassword(pass);
  }

  const service = await prisma.service.create({
    data: {
      title,
      description: description || null,
      parameters: parsedParams.defs as unknown as object[],
      recipientWallet,
      walletChain,
      serviceType,
      passwordProtected,
      globallyDiscoverable,
      accessUsername,
      accessPasswordHash,
      deviceId,
      userId,
    },
    select: SERVICE_SELECT,
  });

  return NextResponse.json({ service }, { status: 201 });
}
