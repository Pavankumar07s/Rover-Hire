export const GALILEO = {
  chainId: 16602,
  rpc: "https://evmrpc-testnet.0g.ai",
  indexer: "https://indexer-storage-testnet-turbo.0g.ai",
  explorer: "https://chainscan-galileo.0g.ai",
} as const;

// 0G mainnet compute: where the TEE signer of the decision model is registered (HANDOFF §6.4).
export const MAINNET = {
  chainId: 16661,
  rpc: "https://evmrpc.0g.ai",
  inferenceServing: "0x47340d900bdFec2BD393c626E12ea0656F938d84",
  provider: "0xf4FB8d2bD856e672b5f9848b0eD235A20079B250",
} as const;

export const GENESIS = "0".repeat(64);
export const SIG_PREFIX = "zg-sig-v1/e2ee-ct:";
