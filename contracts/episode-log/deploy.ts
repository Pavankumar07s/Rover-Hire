// Deploys EpisodeLog to Galileo and writes deployment.json. Refuses to replace an existing deployment.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { ethers } from "ethers";
import { abi, EXPLORER, wallet } from "./galileo.ts";

const out = new URL("deployment.json", import.meta.url);
if (existsSync(out) && !process.argv.includes("--force")) throw new Error("deployment.json exists; pass --force to deploy a new one");
const { bytecode, solc, evmVersion } = JSON.parse(readFileSync(new URL("bytecode.json", import.meta.url), "utf8"));
const signer = await wallet();
const t0 = performance.now();
const contract = await new ethers.ContractFactory(abi, bytecode, signer).deploy();
const receipt = await contract.deploymentTransaction()!.wait();
if (!receipt) throw new Error("no deploy receipt");
const address = await contract.getAddress();
const deployment = {
  network: "galileo", chainId: 16602, address, deployer: signer.address, tx: receipt.hash, block: receipt.blockNumber,
  gasUsed: receipt.gasUsed.toString(), feeWei: (receipt.gasUsed * receipt.gasPrice).toString(),
  seconds: Math.round((performance.now() - t0) / 100) / 10, solc, evmVersion, at: new Date().toISOString(),
};
writeFileSync(out, JSON.stringify(deployment, null, 2) + "\n");
console.log(JSON.stringify(deployment, null, 2));
console.log(`${EXPLORER}/address/${address}`);
// 2026-11-06T07:28:00
