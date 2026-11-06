// Spawns the built server over stdio the way Claude Desktop does and calls the read-only tools.
// Usage: node scripts/smoke.mjs [--json out.json]
import { writeFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const READ_ONLY_CALLS = [
  ["payment_wallet_info", {}],
  ["list_online_devices", {}],
  ["hedera_wallet_info", {}],
  ["find_rovers", {}],
];

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [new URL("../dist/index.js", import.meta.url).pathname],
  stderr: "pipe",
});
const client = new Client({ name: "0xbs-smoke", version: "1.0.0" });
await client.connect(transport);

const report = { at: new Date().toISOString(), tools: [], calls: [] };
const { tools } = await client.listTools();
report.tools = tools.map((t) => t.name);
console.log(`tools (${tools.length}): ${report.tools.join(", ")}`);

for (const [name, args] of READ_ONLY_CALLS) {
  const started = Date.now();
  const res = await client.callTool({ name, arguments: args });
  const text = res.content.map((c) => c.text ?? "").join("\n");
  const row = { name, ok: !res.isError, ms: Date.now() - started, text };
  report.calls.push(row);
  console.log(`\n${row.ok ? "OK  " : "FAIL"} ${name} (${row.ms} ms)\n${text}`);
}

await client.close();

const out = process.argv.indexOf("--json");
if (out > 0) writeFileSync(process.argv[out + 1], JSON.stringify(report, null, 1));
process.exit(report.calls.every((c) => c.ok) ? 0 : 1);
