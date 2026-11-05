/**
 * Local payment wallet for the MCP process.
 *
 * Keys live on disk (or in env for power users). Tool results only ever
 * return public addresses — Claude must not see a private key.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { base58 } from "@scure/base";
import { ed25519 } from "@noble/curves/ed25519";

export const WALLET_DIR = join(homedir(), ".0xbs");
export const WALLET_PATH = join(WALLET_DIR, "wallet.json");

export type WalletSource = "env" | "file" | "none";
export type WalletChains = "both" | "base" | "evm" | "solana";
export type RotatedChain = "base" | "solana";

export interface StoredWallet {
  version: 1;
  createdAt: string;
  evmPrivateKey?: string;
  solanaPrivateKey?: string;
}

export interface ResolvedKeys {
  evm?: string;
  solana?: string;
  source: WalletSource;
  path?: string;
}

const EVM_KEY = /^0x[0-9a-fA-F]{64}$/;
const ZERO_EVM = /^0x0+$/;

function usableEvm(key: string | undefined): string | undefined {
  const value = key?.trim();
  if (!value || !EVM_KEY.test(value) || ZERO_EVM.test(value)) return undefined;
  return value;
}

function usableSolana(key: string | undefined): string | undefined {
  const value = key?.trim();
  if (!value) return undefined;
  try {
    const bytes = base58.decode(value);
    if (bytes.length !== 32 && bytes.length !== 64) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

function readWalletFile(): StoredWallet | undefined {
  if (!existsSync(WALLET_PATH)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(WALLET_PATH, "utf8")) as StoredWallet;
    if (parsed?.version !== 1) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function writeWalletFile(wallet: StoredWallet): void {
  mkdirSync(WALLET_DIR, { recursive: true, mode: 0o700 });
  chmodSync(WALLET_DIR, 0o700);
  const tmp = `${WALLET_PATH}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(wallet, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(tmp, WALLET_PATH);
  chmodSync(WALLET_PATH, 0o600);
}

function generateSolanaSecret(): string {
  const seed = ed25519.utils.randomPrivateKey();
  const publicKey = ed25519.getPublicKey(seed);
  const secret = new Uint8Array(64);
  secret.set(seed, 0);
  secret.set(publicKey, 32);
  return base58.encode(secret);
}

export function evmAddressFromKey(privateKey: string): string {
  return privateKeyToAccount(privateKey as `0x${string}`).address;
}

export function solanaAddressFromKey(secret: string): string {
  const bytes = base58.decode(secret);
  const publicKey =
    bytes.length === 64 ? bytes.slice(32) : ed25519.getPublicKey(bytes);
  return base58.encode(publicKey);
}

/**
 * A key in ~/.0xbs/wallet.json wins for that chain so Claude-generated
 * (including fresh) keys are used immediately. Env is the fallback when
 * the file has no key for that family.
 */
export function getKeys(): ResolvedKeys {
  const file = readWalletFile();
  const fileEvm = usableEvm(file?.evmPrivateKey);
  const fileSolana = usableSolana(file?.solanaPrivateKey);
  const envEvm = usableEvm(process.env.AGENT_EVM_PRIVATE_KEY);
  const envSolana = usableSolana(process.env.AGENT_SOLANA_PRIVATE_KEY);

  const evm = fileEvm ?? envEvm;
  const solana = fileSolana ?? envSolana;
  if (!evm && !solana) return { source: "none", path: WALLET_PATH };

  const fromFile = Boolean(fileEvm || fileSolana);
  return {
    evm,
    solana,
    source: fromFile ? "file" : "env",
    path: fromFile ? WALLET_PATH : undefined,
  };
}

export function publicAddresses(keys: ResolvedKeys): {
  evm?: string;
  solana?: string;
} {
  return {
    evm: keys.evm ? evmAddressFromKey(keys.evm) : undefined,
    solana: keys.solana ? solanaAddressFromKey(keys.solana) : undefined,
  };
}

function wantsBase(chains: WalletChains): boolean {
  return chains === "both" || chains === "base" || chains === "evm";
}

function wantsSolana(chains: WalletChains): boolean {
  return chains === "both" || chains === "solana";
}

export function createLocalWallet(options: {
  /** Generate new keys for the selected chain(s). Keeps the other chain. */
  fresh?: boolean;
  /** Alias for fresh=true on both chains (legacy). */
  replace?: boolean;
  chains?: WalletChains;
}): {
  created: boolean;
  rotated: RotatedChain[];
  source: WalletSource;
  path: string;
  evm?: string;
  solana?: string;
} {
  const chains = options.chains ?? "both";
  const rotate = Boolean(options.fresh || options.replace);
  const existing = getKeys();
  const previous = readWalletFile();

  const rotateBase = wantsBase(chains) && (rotate || !existing.evm);
  const rotateSolana = wantsSolana(chains) && (rotate || !existing.solana);

  if (!rotateBase && !rotateSolana) {
    return {
      created: false,
      rotated: [],
      source: existing.source,
      path: existing.path ?? WALLET_PATH,
      ...publicAddresses(existing),
    };
  }

  const rotated: RotatedChain[] = [];
  const wallet: StoredWallet = {
    version: 1,
    createdAt: previous?.createdAt ?? new Date().toISOString(),
    evmPrivateKey: previous?.evmPrivateKey,
    solanaPrivateKey: previous?.solanaPrivateKey,
  };

  if (rotateBase) {
    wallet.evmPrivateKey = generatePrivateKey();
    rotated.push("base");
  }
  if (rotateSolana) {
    wallet.solanaPrivateKey = generateSolanaSecret();
    rotated.push("solana");
  }

  writeWalletFile(wallet);
  return {
    created: true,
    rotated,
    source: "file",
    path: WALLET_PATH,
    ...publicAddresses(getKeys()),
  };
}

export function importLocalWallet(options: {
  evmPrivateKey?: string;
  solanaPrivateKey?: string;
}): { path: string; evm?: string; solana?: string } {
  const evm = usableEvm(options.evmPrivateKey);
  const solana = usableSolana(options.solanaPrivateKey);
  if (!evm && !solana) {
    throw new Error(
      "Provide a 0x-prefixed 32-byte EVM key and/or a base58 Solana secret key.",
    );
  }

  const previous = readWalletFile();
  writeWalletFile({
    version: 1,
    createdAt: previous?.createdAt ?? new Date().toISOString(),
    evmPrivateKey: evm ?? previous?.evmPrivateKey,
    solanaPrivateKey: solana ?? previous?.solanaPrivateKey,
  });

  return { path: WALLET_PATH, ...publicAddresses(getKeys()) };
}
