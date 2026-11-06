// A2A buyer side (@a2a-js/sdk 1.3.0): one conversation (contextId) per seller.
import { randomUUID } from "node:crypto";
import { Role } from "@a2a-js/sdk";
import { ClientFactory, JsonRpcTransportFactory } from "@a2a-js/sdk/client";

export class Seller {
  private contextId = "";
  private constructor(readonly base: string, private client: any) {}

  static async connect(base: string): Promise<Seller> {
    const client = await new ClientFactory({ transports: [new JsonRpcTransportFactory()] }).createFromUrl(base);
    return new Seller(base.replace(/\/$/, ""), client);
  }

  async say(value: Record<string, unknown>): Promise<any> {
    const message = { messageId: randomUUID(), contextId: this.contextId, taskId: "", role: Role.ROLE_USER,
                      parts: [{ content: { $case: "data", value }, metadata: undefined, filename: "", mediaType: "application/json" }],
                      metadata: undefined, extensions: [], referenceTaskIds: [] };
    const res = await this.client.sendMessage({ tenant: "", message, configuration: undefined, metadata: undefined });
    this.contextId = res.contextId || this.contextId;
    const reply = (res.parts ?? []).find((p: any) => p.content?.$case === "data")?.content.value;
    if (!reply || reply.type === "error") throw new Error(`seller: ${reply?.error ?? "no data reply"}`);
    return reply;
  }
}
