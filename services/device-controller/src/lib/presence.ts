import { recentlySeen } from "./mqtt.js";
import { isClientConnected, listConnectedIdentities } from "./emqx.js";

/** A connector is online if it replied recently or has an MQTT session. */
export async function isDeviceOnline(connectorId: string): Promise<boolean> {
  if (recentlySeen(connectorId)) return true;
  if (await isClientConnected(connectorId)) return true;
  // Simulators use `<connectorId>.sim` so they don't kick the physical board.
  if (await isClientConnected(`${connectorId}.sim`)) return true;
  return false;
}

export function isOnlineInSet(
  connectorId: string,
  connected: Set<string>,
): boolean {
  if (recentlySeen(connectorId)) return true;
  return connected.has(connectorId) || connected.has(`${connectorId}.sim`);
}

/** Batch presence for the public catalog. */
export async function connectedIdentities(): Promise<Set<string>> {
  return listConnectedIdentities();
}
