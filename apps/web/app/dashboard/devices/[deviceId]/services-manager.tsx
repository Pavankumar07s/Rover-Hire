"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  Input,
  Textarea,
  Select,
  Toggle,
} from "@/components/ui";
import { CopyButton } from "@/components/copy-button";
import { apiUrl } from "@/lib/base-path";

type Chain = "BASE" | "SOLANA";
type ServiceType = "FREE" | "PAID";
type ParamType = "string" | "number" | "boolean";

// One declared argument the service accepts, e.g. { name, type, description }.
export type ServiceParam = {
  name: string;
  type: ParamType;
  required: boolean;
  description?: string;
};

// A row in the arguments editor (adds a stable key for React list rendering).
type ArgRow = {
  key: string;
  name: string;
  type: ParamType;
  required: boolean;
  description: string;
};

const PARAM_TYPE_OPTIONS = [
  { label: "String", value: "string" },
  { label: "Number", value: "number" },
  { label: "Boolean", value: "boolean" },
];

// An identifier used as a JSON key when agents call the service. It must be a
// valid identifier in JavaScript, Python AND C++, so we intersect their rules:
// start with a letter or underscore, then letters / digits / underscores only.
// No spaces, hyphens, dots, or other punctuation.
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

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
  "short", "signed", "sizeof", "struct", "template", "throw", "typedef",
  "typeid", "typename", "union", "unsigned", "using", "virtual", "volatile",
  "wchar_t",
]);

/**
 * Validate an argument identifier. Returns an error message string when the
 * name is invalid, or null when it's a usable JSON key / identifier.
 */
function validateIdentifier(name: string): string | null {
  if (!name) return "Identifier is required.";
  if (/\s/.test(name)) return "Identifier cannot contain spaces.";
  if (!IDENTIFIER_RE.test(name)) {
    return "Identifier must start with a letter or _ and contain only letters, numbers, and _ (no spaces, hyphens, or symbols).";
  }
  if (RESERVED_WORDS.has(name)) {
    return `"${name}" is a reserved keyword (JS/Python/C++) and cannot be used.`;
  }
  return null;
}

// Strip characters that are never allowed in an identifier as the user types.
// Removes spaces, hyphens, and any symbol outside [A-Za-z0-9_].
function sanitizeIdentifier(input: string): string {
  return input.replace(/[^A-Za-z0-9_]/g, "");
}

function newArgRow(): ArgRow {
  return {
    key: Math.random().toString(36).slice(2),
    name: "",
    type: "string",
    required: true,
    description: "",
  };
}

export type ServiceItem = {
  id: string;
  title: string | null;
  description: string | null;
  // The input arguments an agent must send when calling this service.
  parameters: ServiceParam[] | null;
  // Per-service payout wallet (devices have no wallet).
  recipientWallet: string | null;
  walletChain: Chain;
  serviceType: ServiceType;
  // Per-service settings (each service owns its own; no device inheritance).
  passwordProtected: boolean;
  globallyDiscoverable: boolean;
  accessUsername: string | null;
  createdAt: string;
};

export function ServicesManager({
  deviceId,
  services,
}: {
  deviceId: string;
  services: ServiceItem[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // All settings are direct per-service (no device inheritance).
  const [serviceType, setServiceType] = useState<ServiceType>("FREE");
  const [walletChain, setWalletChain] = useState<Chain>("BASE");
  const [passwordProtected, setPasswordProtected] = useState(false);
  const [globallyDiscoverable, setGloballyDiscoverable] = useState(true);
  // The arguments this service accepts (name, type, description).
  const [args, setArgs] = useState<ArgRow[]>([]);

  function addArg() {
    setArgs((prev) => [...prev, newArgRow()]);
  }

  function removeArg(key: string) {
    setArgs((prev) => prev.filter((a) => a.key !== key));
  }

  function updateArg(key: string, patch: Partial<ArgRow>) {
    setArgs((prev) =>
      prev.map((a) => (a.key === key ? { ...a, ...patch } : a)),
    );
  }

  function resetForm() {
    setServiceType("FREE");
    setWalletChain("BASE");
    setPasswordProtected(false);
    setGloballyDiscoverable(true);
    setArgs([]);
  }

  async function createService(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const form = new FormData(e.currentTarget);
    const wallet = ((form.get("recipientWallet") as string) ?? "").trim();

    const payload: Record<string, unknown> = {
      title: form.get("title") as string,
      description: form.get("description") as string,
    };
    payload.serviceType = serviceType;
    payload.passwordProtected = passwordProtected;
    payload.globallyDiscoverable = globallyDiscoverable;

    // Build the declared arguments list. Drop empty rows (no name) and
    // validate that every identifier is a valid JSON key / JS-Python-C++ name.
    const parameters: ServiceParam[] = [];
    const seen = new Set<string>();
    for (const a of args) {
      const name = a.name.trim();
      if (!name) continue; // skip blank rows
      const idError = validateIdentifier(name);
      if (idError) {
        setError(`Argument "${name}": ${idError}`);
        setLoading(false);
        return;
      }
      if (seen.has(name)) {
        setError(`Duplicate argument identifier "${name}".`);
        setLoading(false);
        return;
      }
      seen.add(name);
      const param: ServiceParam = {
        name,
        type: a.type,
        required: a.required,
      };
      if (a.description.trim()) param.description = a.description.trim();
      parameters.push(param);
    }
    payload.parameters = parameters;
    // Wallet details only apply to paid services.
    if (serviceType === "PAID") {
      payload.walletChain = walletChain;
      if (wallet) payload.recipientWallet = wallet;
    }
    if (passwordProtected) {
      payload.accessUsername = (form.get("accessUsername") as string) ?? "";
      payload.accessPassword = (form.get("accessPassword") as string) ?? "";
    }

    try {
      const res = await fetch(apiUrl(`/api/devices/${deviceId}/services`), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not create service");
        setLoading(false);
        return;
      }
      setOpen(false);
      resetForm();
      setLoading(false);
      router.refresh();
    } catch {
      setError("Network error — please try again");
      setLoading(false);
    }
  }

  async function deleteService(id: string) {
    if (!window.confirm("Delete this service?")) return;
    setDeletingId(id);
    try {
      const res = await fetch(apiUrl(`/api/devices/${deviceId}/services/${id}`), {
        method: "DELETE",
      });
      if (res.ok) router.refresh();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-[var(--foreground)]">
            Services
          </h3>
          <p className="mt-1 text-[13px] text-[var(--muted)]">
            {services.length} service{services.length === 1 ? "" : "s"} on this
            device.
          </p>
        </div>
        {!open && (
          <Button onClick={() => setOpen(true)}>
            <span className="text-base leading-none">+</span> Add service
          </Button>
        )}
      </div>

      {open && (
        <Card className="p-5">
          <form onSubmit={createService} className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-[var(--foreground)]">
                New service
              </h4>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-[13px] font-medium text-[var(--muted)] hover:text-[var(--foreground)]"
              >
                Cancel
              </button>
            </div>
            <Input
              label="Service name"
              name="title"
              placeholder="e.g. Telemetry Ingest"
              required
              autoFocus
            />
            <Textarea
              label="Description"
              name="description"
              rows={2}
              placeholder="What does this service do?"
            />

            {/* Arguments the service accepts. Each row is a JSON identifier /
                type / description; agents send matching values when calling. */}
            <div className="space-y-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)]/40 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[13px] font-medium text-[var(--foreground)]">
                    Arguments
                  </p>
                  <p className="mt-0.5 text-[12px] leading-snug text-[var(--muted)]">
                    The inputs this service accepts. Each identifier becomes a
                    JSON key agents send when calling the device. Identifiers
                    must be valid in JS, Python & C++ — letters, numbers, and _
                    only, no spaces or hyphens. The type and description are
                    shared with agents so they know how to call the service.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={addArg}
                  className="shrink-0 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[13px] font-medium text-[var(--foreground)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)]"
                >
                  <span className="leading-none">+</span> Add argument
                </button>
              </div>

              {args.length === 0 ? (
                <p className="rounded-[var(--radius-sm)] border border-dashed border-[var(--border-strong)] bg-[var(--surface)] px-3 py-4 text-center text-[12px] text-[var(--muted)]">
                  No arguments. This service takes no inputs.
                </p>
              ) : (
                <ul className="space-y-3">
                  {args.map((a) => {
                    // Live per-row identifier validation (ignore blank rows).
                    const idError =
                      a.name.trim() === ""
                        ? null
                        : validateIdentifier(a.name.trim());
                    return (
                      <li
                        key={a.key}
                        className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] p-3"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                          <div className="flex-1">
                            <Input
                              label="Identifier"
                              value={a.name}
                              onChange={(e) =>
                                updateArg(a.key, {
                                  // Strip disallowed characters as they type.
                                  name: sanitizeIdentifier(e.target.value),
                                })
                              }
                              placeholder="e.g. target_angle"
                              hint="JSON key sent to the device. Letters, numbers, _ only."
                              aria-invalid={idError ? true : undefined}
                            />
                          </div>
                          <div className="sm:w-40">
                            <Select
                              label="Type"
                              value={a.type}
                              onChange={(e) =>
                                updateArg(a.key, {
                                  type: e.target.value as ParamType,
                                })
                              }
                              options={PARAM_TYPE_OPTIONS}
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => removeArg(a.key)}
                            aria-label="Remove argument"
                            className="mb-0.5 shrink-0 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-[13px] font-medium text-[var(--danger)] transition-colors hover:border-[var(--danger)] hover:bg-[var(--danger-soft)]"
                          >
                            Remove
                          </button>
                        </div>
                        {idError && (
                          <p className="mt-2 text-[12px] leading-snug text-[var(--danger)]">
                            {idError}
                          </p>
                        )}
                        <div className="mt-3">
                          <Input
                            label="Description"
                            value={a.description}
                            onChange={(e) =>
                              updateArg(a.key, { description: e.target.value })
                            }
                            placeholder="What is this argument for? Shown to agents. (optional)"
                            hint="Sent to agents to explain how to use this argument."
                          />
                        </div>
                        <div className="mt-3">
                          <Toggle
                            label="Required"
                            hint="Callers must include this argument."
                            checked={a.required}
                            onCheckedChange={(v) =>
                              updateArg(a.key, { required: v })
                            }
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Every setting below is per-service — type, wallet, password
                protection, and discoverability. */}
            <div className="space-y-4 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)]/40 p-4">
              <p className="text-[13px] font-medium text-[var(--foreground)]">
                Service settings
              </p>
              <Select
                label="Service type"
                value={serviceType}
                onChange={(e) => setServiceType(e.target.value as ServiceType)}
                options={[
                  { label: "Free", value: "FREE" },
                  { label: "Paid (x402)", value: "PAID" },
                ]}
              />
              {serviceType === "PAID" && (
                <>
                  <Select
                    label="Wallet chain"
                    value={walletChain}
                    onChange={(e) => setWalletChain(e.target.value as Chain)}
                    options={[
                      { label: "Base", value: "BASE" },
                      { label: "Solana", value: "SOLANA" },
                    ]}
                    hint="Which chain this service settles payments on."
                  />
                  <Input
                    label="Recipient wallet"
                    name="recipientWallet"
                    placeholder={
                      walletChain === "SOLANA"
                        ? "So1anaAddrEssBase58…"
                        : "0x0000000000000000000000000000000000000000"
                    }
                    hint="The address that receives payouts for this service. Required before a paid service can be called."
                  />
                </>
              )}
              <Toggle
                label="Password protected"
                hint="Require a username + password to call this service."
                checked={passwordProtected}
                onCheckedChange={setPasswordProtected}
              />
              <Toggle
                label="Globally discoverable"
                hint="List this service in the public discovery index. When off, agents must use the device API key to connect."
                checked={globallyDiscoverable}
                onCheckedChange={setGloballyDiscoverable}
              />
              {passwordProtected && (
                <div className="space-y-4">
                  <Input
                    label="Access username"
                    name="accessUsername"
                    placeholder="agent"
                    hint="Optional. Sent alongside the password by callers."
                  />
                  <Input
                    label="Access password"
                    name="accessPassword"
                    type="password"
                    placeholder="••••••••"
                    required
                    hint="Stored hashed — never retrievable later."
                  />
                </div>
              )}
            </div>

            {error && (
              <p className="rounded-[var(--radius-sm)] border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
                {error}
              </p>
            )}
            <Button type="submit" loading={loading}>
              Create service
            </Button>
          </form>
        </Card>
      )}

      {services.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-dashed border-[var(--border-strong)] bg-[var(--surface)] p-10 text-center">
          <p className="text-sm text-[var(--muted)]">
            No services yet. Add one to get started.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {services.map((s) => (
            <li key={s.id}>
              <Card className="flex items-start justify-between gap-4 p-4 transition-colors hover:border-[var(--border-strong)]">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="truncate font-semibold text-[var(--foreground)]">
                      {s.title ?? "Untitled service"}
                    </h4>
                    <ServiceBadges service={s} />
                  </div>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    {s.description ?? "No description"}
                  </p>
                  {s.parameters && s.parameters.length > 0 && (
                    <div className="mt-3">
                      <span className="text-[13px] font-medium text-[var(--muted)]">
                        Arguments
                      </span>
                      <ul className="mt-1.5 flex flex-wrap gap-1.5">
                        {s.parameters.map((p) => (
                          <li
                            key={p.name}
                            className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 font-mono text-xs text-[var(--muted)]"
                            title={p.description ?? undefined}
                          >
                            <span className="text-[var(--foreground)]">
                              {p.name}
                            </span>
                            <span className="text-[var(--muted-2)]">
                              {p.type}
                            </span>
                            {!p.required && (
                              <span className="text-[var(--muted-2)]">?</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="mt-3 flex items-center gap-2">
                    <span className="text-[13px] font-medium text-[var(--muted)]">
                      ID
                    </span>
                    <code className="max-w-full overflow-x-auto whitespace-nowrap rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 font-mono text-xs text-[var(--muted)]">
                      {s.id}
                    </code>
                    <CopyButton value={s.id} label="Copy" className="py-1" />
                  </div>
                </div>
                <Button
                  variant="danger"
                  loading={deletingId === s.id}
                  onClick={() => deleteService(s.id)}
                  className="shrink-0 px-3 py-1.5"
                >
                  Delete
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Badge({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "blue" | "green";
}) {
  const tones = {
    muted:
      "border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted)]",
    blue: "border-[var(--base-blue)]/30 bg-[var(--base-blue)]/10 text-[var(--base-blue)]",
    green: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600",
  } as const;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/** Shows the service's settings (all per-service, no device inheritance). */
function ServiceBadges({ service }: { service: ServiceItem }) {
  const type = service.serviceType;
  const discoverable = service.globallyDiscoverable;
  const protectedOn = service.passwordProtected;

  return (
    <>
      <Badge tone={type === "PAID" ? "blue" : "muted"}>
        {type === "PAID" ? "Paid" : "Free"}
      </Badge>
      <Badge tone={discoverable ? "green" : "muted"}>
        {discoverable ? "Discoverable" : "Private"}
      </Badge>
      {protectedOn && <Badge tone="muted">🔒 Protected</Badge>}
    </>
  );
}
