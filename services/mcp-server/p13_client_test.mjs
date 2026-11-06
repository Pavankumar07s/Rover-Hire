// usage: node p13_client_test.mjs <mcp url> [tool | tool={json args}]... — lists tools and runs the ones named
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const client = new Client({ name: "p13-test", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(process.argv[2])));
const { tools } = await client.listTools();
console.log("tools:", tools.map((t) => t.name).join(", "));
for (const arg of process.argv.slice(3)) { // a tool name, or name={"json":"arguments"}
  const [name, json] = arg.split(/=(.*)/s);
  const r = await client.callTool({ name, arguments: json ? JSON.parse(json) : {} });
  console.log(`--- ${name}${r.isError ? " (error)" : ""}:\n` + r.content.map((c) => c.text).join("\n").slice(0, 900));
}
await client.close();
