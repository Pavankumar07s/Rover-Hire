import { callDevice } from "../lib/mqtt.js";

export const getResult = (
  // The device's PRIVATE connector id — MQTT topics + clientId are keyed by it,
  // never the public device id.
  connectorId: string,
  serviceId: string,
  params: {},
  apiKeyHash?: string,
): Promise<any> =>
  callDevice("GET_RESULT", connectorId, serviceId, params, apiKeyHash);
