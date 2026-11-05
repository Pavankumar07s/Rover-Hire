// P12 setup (plan Phase 12 task 4): Station-A's own account, created by the stable buyer with an ECDSA alias and
// associated with USDC (its key goes straight to .env.s, 0600, never printed); its sales topic (submit key: Station-A);
// then Station-A registered in the ERC-8004 IdentityRegistry from its own key, so agentWallet = payTo, with the
// stationCard, and setAgentURI adds `registrations`. Idempotent: what is already in .env.s is reused.
// Usage: node scripts/setup-p12.ts <stable buyer .env> [--dry] [--update-card]  (--update-card: setAgentURI when the card changed)
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { CHAINS, cardUri, ERC8004, evmWallet, identity, mirror, operatorClient, parseKey, readCard, register, send, stationCard,
         usdcAtomic, usdcBalance, USDC } from "@0xBs/hedera";
import { AccountCreateTransaction, Hbar, PrivateKey, TokenAssociateTransaction, TopicCreateTransaction } from "@hiero-ledger/sdk";
import { config } from "dotenv";

const dry = process.argv.includes("--dry");
const updateCard = process.argv.includes("--update-card");
const START_HBAR = Number(process.env.START_HBAR ?? 5); // register ~0.9 + setAgentURI ~0.25 HBAR, the sales log, and room for a card update
const PORT = 8404;
const envPath = new URL("../.env.s", import.meta.url).pathname;
const load = (path: string) => (existsSync(path) ? config({ path, quiet: true, processEnv: {} }).parsed ?? {} : {});
const buyerPath = process.argv[2];
if (!buyerPath || !existsSync(buyerPath)) throw new Error("usage: node scripts/setup-p12.ts <stable buyer .env> [--dry]");
const buyer = load(buyerPath);
const buyerClient = operatorClient(buyer.HEDERA_BUYER_ID!, parseKey(buyer.HEDERA_BUYER_KEY, "HEDERA_BUYER_KEY"));

function appendEnv(lines: Record<string, string>) {
  const have = load(envPath);
  const add = Object.entries(lines).filter(([k]) => !have[k]).map(([k, v]) => `${k}=${v}\n`).join("");
  if (add) appendFileSync(envPath, add, { mode: 0o600 });
}

const have0 = load(envPath);
for (const k of ["STATION_URL", "STATION_LAN_TOKEN", "STATION_SIGNER"])
  if (!have0[k]) throw new Error(`${k} must be in ${envPath} first (the station's address, its LAN token and its signer)`);

if (!have0.HEDERA_STATION_ID && !dry) {
  const key = PrivateKey.generateECDSA();
  const rc = await (await new AccountCreateTransaction().setECDSAKeyWithAlias(key).setInitialBalance(new Hbar(START_HBAR))
    .execute(buyerClient)).getReceipt(buyerClient);
  appendEnv({ HEDERA_STATION_ID: rc.accountId!.toString(), HEDERA_STATION_KEY: key.toStringRaw() });
  console.log(JSON.stringify({ step: "account", id: rc.accountId!.toString(), initial_hbar: START_HBAR }));
}
const env = load(envPath);
if (dry && !env.HEDERA_STATION_ID) {
  const card = stationCard({ name: "Station-A", description: "(dry run)", shop: `http://localhost:${PORT}`, payTo: "0.0.0",
                             signer: env.STATION_SIGNER!, reading: "1000", motion: "500", historyPerMin: "200", pressure: false });
  console.log(JSON.stringify({ note: "account not created yet (created by the real run)", card, card_bytes: cardUri(card).length }, null, 1));
  process.exit(0);
}
const id = env.HEDERA_STATION_ID!;
const key = parseKey(env.HEDERA_STATION_KEY, "HEDERA_STATION_KEY");
const own = operatorClient(id, key);
const wallet = evmWallet(key);

if (!dry && !(await usdcBalance(id)).associated) {
  await (await new TokenAssociateTransaction().setAccountId(id).setTokenIds([USDC]).execute(own)).getReceipt(own);
  console.log(JSON.stringify({ step: "usdc associated", id }));
}
if (!dry && !env.HCS_SALES_TOPIC) {
  const rc = await (await new TopicCreateTransaction().setTopicMemo("Rover for Hire, Station-A sales (Phase 12)")
    .setSubmitKey(key.publicKey).execute(own)).getReceipt(own);
  appendEnv({ HCS_SALES_TOPIC: rc.topicId!.toString() });
  console.log(JSON.stringify({ step: "sales topic", topic: rc.topicId!.toString() }));
}
if (!dry) appendEnv({ SHOP_NAME: "Station-A", PORT: String(PORT), PRICE_READING: "0.001", PRICE_MOTION: "0.0005", PRICE_HISTORY_PER_MIN: "0.0002" });

const acct = await mirror(`/api/v1/accounts/${id}`);
if (acct?.evm_address?.toLowerCase() !== wallet.address.toLowerCase())
  throw new Error(`${id}'s EVM address ${acct?.evm_address} is not its key's ${wallet.address}`);
const input = {
  name: "Station-A",
  description: "A real sensor station (Arduino UNO Q) selling signed temperature, humidity, light and motion readings, paid per " +
               "reading in USDC with x402 on Hedera" + (load(envPath).STATION_BASE_PAY_TO || load(envPath).STATION_SOLANA_PAY_TO
                 ? ", or on the other chains under x402.accepts" : "") + ". Every reading is signed on the station itself; check it against `signer`.",
  shop: `http://localhost:${PORT}`, payTo: id, signer: load(envPath).STATION_SIGNER!,
  reading: usdcAtomic("0.001").toString(), motion: usdcAtomic("0.0005").toString(), historyPerMin: usdcAtomic("0.0002").toString(),
  pressure: false,
  // Phase 14: Station-A's addresses on Base Sepolia and Solana devnet, when .env.s has them
  accepts: [[CHAINS.base, load(envPath).STATION_BASE_PAY_TO], [CHAINS.solana, load(envPath).STATION_SOLANA_PAY_TO]]
    .filter(([, payTo]) => !!payTo).map(([c, payTo]) => ({ network: (c as typeof CHAINS.base).network, asset: (c as typeof CHAINS.base).usdc, payTo: payTo as string })),
};
const row: any = { account: id, evm: wallet.address, hbar: acct.balance.balance / 1e8, sales_topic: load(envPath).HCS_SALES_TOPIC ?? null };
if (dry) {
  row.card = stationCard(input);
  row.card_bytes = cardUri(row.card).length;
} else {
  let agentId = load(envPath).ERC8004_AGENT_ID;
  if (!agentId) {
    const reg = await register(wallet, stationCard(input), id);
    agentId = reg.agentId;
    appendEnv({ ERC8004_AGENT_ID: agentId });
    row.register = { tx: reg.hash, hbar: reg.feeHbar, block_time: (await reg.receipt.getBlock()).timestamp };
    const upd = await send(identity(wallet), "setAgentURI", [agentId, cardUri(stationCard({ ...input, agentId }))]);
    row.set_agent_uri = { tx: upd.hash, hbar: upd.feeHbar };
  } else if (updateCard) {
    const want = cardUri(stationCard({ ...input, agentId }));
    if (want !== (await identity().tokenURI(agentId))) {
      const upd = await send(identity(wallet), "setAgentURI", [agentId, want]);
      row.set_agent_uri = { tx: upd.hash, hbar: upd.feeHbar };
    } else row.set_agent_uri = "card already up to date";
  }
  const reg = identity();
  const [uri, owner, wallet8004] = await Promise.all([reg.tokenURI(agentId), reg.ownerOf(agentId), reg.getAgentWallet(agentId)]);
  const card = await readCard(uri);
  row.agentId = agentId;
  row.checks = { owner_is_wallet: owner.toLowerCase() === wallet.address.toLowerCase(),
                 agent_wallet_is_payto: wallet8004.toLowerCase() === wallet.address.toLowerCase(),
                 card_payto: card.x402?.payTo === id, card_signer: (card as any).signer === input.signer,
                 registrations: card.registrations?.[0]?.agentId === Number(agentId) && card.registrations?.[0]?.agentRegistry === ERC8004.agentRegistry };
  row.card = card;
  const dir = process.env.SETUP_EVIDENCE_DIR
    ? pathToFileURL(process.env.SETUP_EVIDENCE_DIR.replace(/\/?$/, "/")) // a setup run can keep its record outside the evidence folders
    : new URL("../../../docs/rover/evidence/P12/", import.meta.url);
  mkdirSync(dir, { recursive: true });
  writeFileSync(new URL(updateCard ? "card_update.json" : process.env.SETUP_EVIDENCE_DIR ? "setup-station.json" : "setup.json", dir),
                JSON.stringify({ at: new Date().toISOString(), registry: ERC8004.identity, station: row }, null, 2) + "\n");
}
console.log(JSON.stringify(row, null, 1));
process.exit(0);
