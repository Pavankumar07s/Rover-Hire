/**
 * EMQX credential provisioning.
 *
 * Every device authenticates to the broker as `username = connectorId`, with
 * its raw API key as the password. Since `connectorId` is minted by Postgres at
 * device-creation time, the matching broker credential has to be created in the
 * same request — nobody can pre-register it in the EMQX console.
 *
 * Authorization is NOT provisioned here. A static pair of `${username}` rules
 * in the console covers every device forever, so there's nothing per-device to
 * create and one less call that can fail:
 *   All Users  d/${username}/cmd    Subscribe  Allow
 *   All Users  d/${username}/reply  Publish    Allow
 *   All Users  #                    Pub & Sub  Deny
 */
const API_URL = process.env.EMQX_API_URL;
const API_KEY = process.env.EMQX_API_KEY;
const API_SECRET = process.env.EMQX_API_SECRET;

const REQUEST_TIMEOUT_MS = 10_000;

// The built-in credential database's authenticator id. The colon is part of the
// id, so it must be percent-encoded to survive as a single path segment.
const AUTHENTICATOR = "password_based%3Abuilt_in_database";

/**
 * Provisioning is opt-in. Local dev runs against an EMQX with anonymous access
 * and no API keys, where every call here is a no-op.
 */
export const emqxProvisioningEnabled = Boolean(API_URL && API_KEY && API_SECRET);

function usersPath(userId?: string): string {
  const base = `${API_URL!.replace(/\/$/, "")}/authentication/${AUTHENTICATOR}/users`;
  return userId ? `${base}/${encodeURIComponent(userId)}` : base;
}

async function emqxFetch(
  url: string,
  method: string,
  body?: unknown,
): Promise<Response> {
  const auth = Buffer.from(`${API_KEY}:${API_SECRET}`, "utf8").toString("base64");
  try {
    return await fetch(url, {
      method,
      headers: {
        authorization: `Basic ${auth}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    // Network/timeout — the broker's own error bodies are handled by callers.
    throw new Error(
      `EMQX API unreachable (${method} ${url.replace(/\/\/[^@/]*@/, "//***@")}): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

/** Read an error body without ever echoing the password we just sent. */
async function describe(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  return `${res.status} ${text.slice(0, 300)}`;
}

/**
 * Create (or reset) the broker credential for a device. Safe to call again for
 * the same device: EMQX rejects a duplicate user, which we treat as "update the
 * password instead" so a retried device creation or a rotation both converge.
 */
export async function upsertDeviceCredential(
  connectorId: string,
  apiKey: string,
): Promise<void> {
  if (!emqxProvisioningEnabled) return;

  const created = await emqxFetch(usersPath(), "POST", {
    user_id: connectorId,
    password: apiKey,
  });
  if (created.ok) return;

  // 409 Conflict — the user already exists, so set its password instead.
  if (created.status === 409) {
    const updated = await emqxFetch(usersPath(connectorId), "PUT", {
      password: apiKey,
    });
    if (updated.ok) return;
    throw new Error(
      `EMQX credential update failed for device: ${await describe(updated)}`,
    );
  }

  throw new Error(
    `EMQX credential creation failed for device: ${await describe(created)}`,
  );
}

/**
 * Remove a device's broker credential. A missing user is success — the goal is
 * "this device can no longer connect", which is already true.
 */
export async function deleteDeviceCredential(connectorId: string): Promise<void> {
  if (!emqxProvisioningEnabled) return;

  const res = await emqxFetch(usersPath(connectorId), "DELETE");
  if (res.ok || res.status === 404) return;
  throw new Error(`EMQX credential deletion failed: ${await describe(res)}`);
}

/** True if a client with this clientId is currently connected to the broker. */
export async function isClientConnected(clientId: string): Promise<boolean> {
  if (!emqxProvisioningEnabled) return false;
  const url = `${API_URL!.replace(/\/$/, "")}/clients/${encodeURIComponent(clientId)}`;
  try {
    const res = await emqxFetch(url, "GET");
    if (!res.ok) return false;
    const body = (await res.json().catch(() => null)) as
      | { connected?: boolean; data?: { connected?: boolean } }
      | null;
    return Boolean(body?.connected ?? body?.data?.connected);
  } catch {
    return false;
  }
}

type EmqxClientRow = {
  clientid?: string;
  username?: string;
  connected?: boolean;
};

/**
 * All identities currently connected to the broker (client ids and usernames).
 * One paginated list instead of N per-device lookups. Used by the public
 * online catalog.
 */
export async function listConnectedIdentities(): Promise<Set<string>> {
  const ids = new Set<string>();
  if (!emqxProvisioningEnabled) return ids;

  const limit = 100;
  const maxPages = 50;
  for (let page = 1; page <= maxPages; page += 1) {
    const url =
      `${API_URL!.replace(/\/$/, "")}/clients` +
      `?limit=${limit}&page=${page}&conn_state=connected`;
    try {
      const res = await emqxFetch(url, "GET");
      if (!res.ok) break;
      const body = (await res.json().catch(() => null)) as
        | { data?: EmqxClientRow[] }
        | null;
      const rows = body?.data ?? [];
      for (const row of rows) {
        if (row.clientid) ids.add(row.clientid);
        if (row.username) ids.add(row.username);
      }
      if (rows.length < limit) break;
    } catch {
      break;
    }
  }
  return ids;
}
