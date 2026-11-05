/**
 * EMQX credential provisioning — same contract as
 * services/device-controller/src/lib/emqx.ts. Dashboard create/rotate/delete
 * must hit the broker or UI-created devices cannot connect.
 */
const API_URL = process.env.EMQX_API_URL;
const API_KEY = process.env.EMQX_API_KEY;
const API_SECRET = process.env.EMQX_API_SECRET;

const REQUEST_TIMEOUT_MS = 10_000;
const AUTHENTICATOR = "password_based%3Abuilt_in_database";

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
    throw new Error(
      `EMQX API unreachable (${method}): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

async function describe(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  return `${res.status} ${text.slice(0, 300)}`;
}

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

export async function deleteDeviceCredential(
  connectorId: string,
): Promise<void> {
  if (!emqxProvisioningEnabled) return;

  const res = await emqxFetch(usersPath(connectorId), "DELETE");
  if (res.ok || res.status === 404) return;
  throw new Error(`EMQX credential deletion failed: ${await describe(res)}`);
}
