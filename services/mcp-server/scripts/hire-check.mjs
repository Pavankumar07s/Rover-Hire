// Drives hire_rover → rover_mission_status (→ end_rover_mission) over stdio, the way Claude Desktop calls them.
// Usage: node scripts/hire-check.mjs --photos 5 --budget 0.10 [--end-after 60] [--json out.json]
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const { values } = parseArgs({ options: { photos: { type: "string", default: "5" }, budget: { type: "string", default: "0.10" },
                                          "end-after": { type: "string" }, json: { type: "string" }, "max-s": { type: "string", default: "420" } } });
const transport = new StdioClientTransport({ command: process.execPath, args: [new URL("../dist/index.js", import.meta.url).pathname], stderr: "pipe" });
const client = new Client({ name: "0xbs-hire-check", version: "1.0.0" });
await client.connect(transport);
const call = async (name, args) => {
  const res = await client.callTool({ name, arguments: args }, undefined, { timeout: 120_000 });
  return { isError: !!res.isError, text: res.content.filter((c) => c.type === "text").map((c) => c.text).join("\n"),
           images: res.content.filter((c) => c.type === "image").length };
};
const report = { at: new Date().toISOString(), calls: [] };
const t0 = Date.now();
const hired = await call("hire_rover", { photos: Number(values.photos), budgetUsdc: values.budget });
report.calls.push({ name: "hire_rover", ms: Date.now() - t0, ...hired });
console.log(`hire_rover (${Date.now() - t0} ms): ${hired.text}`);
const id = /Mission (m-[0-9a-f]+)/.exec(hired.text)?.[1];
let status, ended = false;
while (id && Date.now() - t0 < Number(values["max-s"]) * 1000) {
  await new Promise((r) => setTimeout(r, 5000));
  if (values["end-after"] && !ended && Date.now() - t0 > Number(values["end-after"]) * 1000) {
    const e = await call("end_rover_mission", { missionId: id });
    report.calls.push({ name: "end_rover_mission", ...e });
    console.log(`end_rover_mission: ${e.text}`);
    ended = true;
  }
  status = await call("rover_mission_status", { missionId: id, photos: "none" });
  const phase = /^Mission \S+: (\S+)/.exec(status.text)?.[1];
  process.stderr.write(`[${Math.round((Date.now() - t0) / 1000)} s] ${phase}\n`);
  if (phase === "ended" || phase === "failed") break;
}
const final = id ? await call("rover_mission_status", { missionId: id, photos: "all" }) : null;
report.calls.push({ name: "rover_mission_status", ...final });
console.log(`\nrover_mission_status (${final?.images ?? 0} images):\n${final?.text}`);
await client.close();
if (values.json) writeFileSync(values.json, JSON.stringify(report, null, 1));
process.exit(0);
