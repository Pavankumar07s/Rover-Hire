/**
 * Service parameter schemas.
 *
 * When a user creates a service they declare which inputs it accepts. Each
 * parameter has a `name`, a `type`, and whether it is `required`. Agents then
 * send matching values to `/pay`, and we validate those values here.
 */

// The value types a parameter can have. Kept small and JSON-friendly on purpose.
export const PARAM_TYPES = ["string", "number", "boolean"] as const;
export type ParamType = (typeof PARAM_TYPES)[number];

/** One declared parameter, e.g. { name: "angle", type: "number", required: true }. */
export interface ParamDef {
  name: string;
  type: ParamType;
  required: boolean;
  description?: string;
}

/**
 * A parameter `name` is used as a JSON key when agents call the service, so it
 * must be a valid identifier in JS, Python AND C++. We intersect their rules:
 * start with a letter or underscore, then letters / digits / underscores only.
 * No spaces, hyphens, dots, or other punctuation.
 */
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Reserved words across JS / Python / C++ that must not be used as identifiers. */
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
 * Validate and normalise a parameter DEFINITION list supplied by the user when
 * creating/updating a service. Returns the cleaned list, or an error string.
 */
export function parseParamDefs(
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
      return {
        ok: false,
        error: `parameters[${i}].name cannot contain spaces`,
      };
    }
    if (!NAME_RE.test(name)) {
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

    // `required` defaults to true if omitted.
    const required = raw.required === undefined ? true : raw.required === true;

    const def: ParamDef = { name, type, required };
    if (typeof raw.description === "string" && raw.description.trim()) {
      def.description = raw.description.trim();
    }
    defs.push(def);
  }

  return { ok: true, defs };
}

/** A stored `parameters` JSON value → typed ParamDef[] (best-effort, safe). */
export function toParamDefs(stored: unknown): ParamDef[] {
  const parsed = parseParamDefs(stored);
  return parsed.ok ? parsed.defs : [];
}

/**
 * Validate agent-supplied VALUES against a service's declared parameters.
 * Returns the cleaned values (only known params, correctly typed), or an error.
 */
export function validateParamValues(
  defs: ParamDef[],
  values: unknown,
): { ok: true; values: Record<string, unknown> } | { ok: false; error: string } {
  const obj =
    typeof values === "object" && values !== null && !Array.isArray(values)
      ? (values as Record<string, unknown>)
      : {};
  if (values !== undefined && (typeof values !== "object" || values === null || Array.isArray(values))) {
    return { ok: false, error: "params must be a JSON object" };
  }

  const out: Record<string, unknown> = {};

  for (const def of defs) {
    const has = Object.prototype.hasOwnProperty.call(obj, def.name);
    const value = obj[def.name];

    if (!has || value === undefined || value === null) {
      if (def.required) {
        return { ok: false, error: `missing required param "${def.name}"` };
      }
      continue; // optional and absent — skip
    }

    const actual = typeof value;
    if (def.type === "string" && actual !== "string") {
      return { ok: false, error: `param "${def.name}" must be a string` };
    }
    if (def.type === "number" && (actual !== "number" || Number.isNaN(value))) {
      return { ok: false, error: `param "${def.name}" must be a number` };
    }
    if (def.type === "boolean" && actual !== "boolean") {
      return { ok: false, error: `param "${def.name}" must be a boolean` };
    }

    out[def.name] = value;
  }

  return { ok: true, values: out };
}
