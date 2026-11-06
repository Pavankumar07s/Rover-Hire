/**
 * Drives the MCP server exactly the way Claude or Codex would: spawn it over
 * stdio, list its tools, then call them.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const DEVICE = "5ed4c654-7c17-41f3-9ac8-1bb95a8fa6a8";
const FREE = "ac56f1eb-1622-4616-919c-aaa588e5deac";
const PAID = "562f2b44-eaad-4090-be30-43e72160cf98";

const includePaid = process.argv.includes("--paid");

const transport = new StdioClientTransport({
  command: "node",
  args: [new URL("./dist/index.js", import.meta.url).pathname],
});

const client = new Client({ name: "smoke-test", version: "1.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`\n=== TOOLS (${tools.length}) ===`);
for (const t of tools) {
  const args = Object.keys(t.inputSchema?.properties ?? {}).join(", ") || "none";
  console.log(`- ${t.name}(${args})`);
}

async function callTool(name, args) {
  console.log(`\n=== ${name} ${JSON.stringify(args)} ===`);
  const res = await client.callTool({ name, arguments: args });
  const text = res.content.map((c) => c.text ?? "").join("\n");
  console.log(res.isError ? `ERROR: ${text}` : text);
  return { text, isError: Boolean(res.isError) };
}

await callTool("payment_wallet_info", {});
await callTool("discover_device", { deviceId: DEVICE });
await callTool("get_service_price", { deviceId: DEVICE, serviceId: PAID });
await callTool("get_service_price", { deviceId: DEVICE, serviceId: FREE });

// Guard rail check: ask to pay a cent with a limit below it.
await callTool("call_device_service", {
  deviceId: DEVICE,
  serviceId: PAID,
  params: { times: 3 },
  maxUsdc: "0.001",
});

await callTool("call_device_service", {
  deviceId: DEVICE,
  serviceId: FREE,
  params: { times: 4, onMs: 150, offMs: 150 },
});

if (includePaid) {
  await callTool("call_device_service", {
    deviceId: DEVICE,
    serviceId: PAID,
    params: { times: 8, onMs: 200, offMs: 200 },
  });
}

await client.close();
console.log("\ndone");
