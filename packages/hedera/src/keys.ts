import { AccountId, Client, PrivateKey } from "@hiero-ledger/sdk";

/** The portal's "HEX Encoded Private Key" (ECDSA, 64 hex) or a DER-encoded key. */
export function parseKey(raw: string | undefined, label: string): PrivateKey {
  const s = (raw ?? "").trim();
  if (!s) throw new Error(`${label} is not set`);
  const hex = s.startsWith("0x") ? s.slice(2) : s;
  return /^[0-9a-fA-F]{64}$/.test(hex) ? PrivateKey.fromStringECDSA(hex) : PrivateKey.fromStringDer(hex);
}

export function operatorClient(accountId: string, key: PrivateKey): Client {
  return Client.forTestnet().setOperator(AccountId.fromString(accountId), key);
}
