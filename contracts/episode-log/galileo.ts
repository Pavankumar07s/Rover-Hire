// Galileo testnet constants and the deployer wallet (ZG_PRIVATE_KEY from .env).
import "dotenv/config";
import { readFileSync } from "node:fs";
import { ethers } from "ethers";

export const RPC = "https://evmrpc-testnet.0g.ai";
export const CHAIN_ID = 16602n;
export const EXPLORER = "https://chainscan-galileo.0g.ai";

export const abi = JSON.parse(readFileSync(new URL("abi.json", import.meta.url), "utf8"));

export async function wallet(): Promise<ethers.Wallet> {
  const pk = process.env.ZG_PRIVATE_KEY?.trim();
  if (!pk) throw new Error("ZG_PRIVATE_KEY is not set (contracts/episode-log/.env)");
  const provider = new ethers.JsonRpcProvider(RPC);
  const { chainId } = await provider.getNetwork();
  if (chainId !== CHAIN_ID) throw new Error(`RPC is chain ${chainId}, expected ${CHAIN_ID}`);
  return new ethers.Wallet(pk, provider);
}
