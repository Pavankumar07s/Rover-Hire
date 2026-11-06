// Public defaults, all changeable on the page: the EpisodeLog on 0G Galileo and the rover's Galileo signer (zg-log's wallet).
export const DEFAULT_LOG = "0x44152879e809A63F70d4c529826660a65fd3B3E7";
export const DEFAULT_ROVER = "0x68F1c6cd175Ae8373947c2Aca6a8520929a82aEa";
export const DEPLOY_BLOCK = 64023569;
export const MAINNET_EXPLORER = "https://chainscan.0g.ai";
export const REPO = "https://github.com/Pavankumar07s/rover-for-hire";
export const SITE = "https://rover-replay.vercel.app";
// Hedera topics the live page reads: the rover's money log and the haggling audit (README, "All the ids").
export const TOPICS = { money: "0.0.11327288", spend: "0.0.11327289", audit: "0.0.11327290" };
// Claude's wallet (the buyer), and the two rovers on the ERC-8004 registry.
export const BUYER = "0.0.11326806";
export const ROVER_A = { account: "0.0.11327287", agentId: 137,
  // Where it is also paid (Phase 14): its card lists these under x402.accepts.
  pay: { base: "0x79C515a8fC8A6E6cf65636dd163772f4C5204ce1", solana: "GaHBtss84gr2xvmY9gVy4XydioVh5nFwU2Rv8cDAih58" } };
export const ROVER_B = { account: "0.0.11327291", agentId: 138 };
// Station-A, the sensor station (Phase 12): its account, sales topic, ERC-8004 agent and the key that signs readings.
export const STATION = {
  account: "0.0.11328271", topic: "0.0.11328274", agentId: 139, signer: "0x9Aeb19a151E001799926BBA7C9CCAa3E7D4fb702",
  prices: { reading: "0.001", motion: "0.0005", historyPerMin: "0.0002" },
  // Where it is also paid (Phase 14): its card lists these under x402.accepts.
  pay: { base: "0x93Af7Fd05A961132DAbdEd59657652c97333b54f", solana: "Afr4bRMcWpTPemgKGbVqUjBXyQaxuK6u5L32sGWsPVLM" },
};

// The latest real runs, so the diagrams' numbers point at something that happened: shown only once there is one on DEFAULT_LOG.
export interface Run { id: string; date: string; facts: [string, string][] }
export const LAST_RUN: Run | null = { id: "a-7c7666ae", date: "6 Nov 2026, at ETHGlobal Mumbai",
  facts: [["3/3", "photos"], ["0.465", "USDC on Hedera"], ["203 s", "mission"], ["19/19", "0G decisions TEE-verified"]] };
export const REMOTE_RUN: Run | null = null;
