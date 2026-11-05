// EpisodeLog.sol → abi.json + bytecode.json with solc 0.8.28 (cancun, optimizer 200; HANDOFF §7).
import { readFileSync, writeFileSync } from "node:fs";
import solc from "solc";

const settings = { evmVersion: "cancun", optimizer: { enabled: true, runs: 200 } };
const input = {
  language: "Solidity",
  sources: { "EpisodeLog.sol": { content: readFileSync(new URL("EpisodeLog.sol", import.meta.url), "utf8") } },
  settings: { ...settings, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
};
const out = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (out.errors ?? []).filter((e: { severity: string }) => e.severity === "error");
if (errors.length) throw new Error(errors.map((e: { formattedMessage: string }) => e.formattedMessage).join("\n"));
const c = out.contracts["EpisodeLog.sol"].EpisodeLog;
writeFileSync(new URL("abi.json", import.meta.url), JSON.stringify(c.abi, null, 2) + "\n");
writeFileSync(new URL("bytecode.json", import.meta.url),
  JSON.stringify({ solc: solc.version(), ...settings, bytecode: "0x" + c.evm.bytecode.object }, null, 2) + "\n");
console.log(`compiled with solc ${solc.version()}: ${c.abi.length} ABI entries, ${c.evm.bytecode.object.length / 2} bytes`);
// 2026-11-06T07:15:00
