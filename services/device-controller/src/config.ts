// MQTT topics are keyed by the device's PRIVATE `connectorId`, never its public
// `id`. Knowing the public id (which agents and discovery expose) must not be
// enough to talk to the device transport — only the server, which can map
// public id → private connectorId in the database, can reach these topics.
export const topics = {
  cmd: (connectorId: string) => `d/${connectorId}/cmd`, // server → device: a command
  reply: (connectorId: string) => `d/${connectorId}/reply`, // device → server: a result
  status: (connectorId: string) => `d/${connectorId}/status`, // device → server: online/offline + services
};