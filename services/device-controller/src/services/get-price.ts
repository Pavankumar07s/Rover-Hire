import { callDevice } from "../lib/mqtt.js";

export const getPrice = (
  // The device's PRIVATE connector id — MQTT topics + clientId are keyed by it,
  // never the public device id.
  connectorId: string,
  serviceId: string,
  params: {},
  apiKeyHash?: string,
): Promise<any> =>
  callDevice("GET_QUOTE", connectorId, serviceId, params, apiKeyHash);
