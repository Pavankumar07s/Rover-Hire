// P7 setup, part 2 (plan Phase 7 task 1): Rover-B's own account, created by the buyer with an ECDSA alias and
// associated with USDC, its key written straight to .env.b (0600) and never printed; then Rover-A and Rover-B
// registered in the ERC-8004 IdentityRegistry from their own keys, so agentWallet = their payTo, with the plan §3.7
// cards, and setAgentURI adds `registrations`. Idempotent: what is already in the env files is reused.
// Usage: node scripts/setup-p7.ts [--dry] [--update-card]   (--dry: print the cards and gas estimates, write nothing;
//        --update-card: setAgentURI for a registered seller whose card changed, e.g. its Base / Solana addresses)
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { agentCard, cardUri, CHAINS, ERC8004, evmWallet, identity, mirror, operatorClient, parseKey, readCard, register, send,
         usdcAtomic, usdcBalance, USDC } from "@0xBs/hedera";
import { AccountCreateTransaction, Hbar, PrivateKey, TokenAssociateTransaction } from "@hiero-ledger/sdk";
import { config } from "dotenv";

const dry = process.argv.includes("--dry");
const updateCard = process.argv.includes("--update-card");
const envPath = (s: string) => new URL(`../.env.${s}`, import.meta.url).pathname;
const buyerEnv = new URL("../../../packages/hedera-buyer/.env", import.meta.url).pathname;
const load = (path: string) => config({ path, quiet: true, processEnv: {} }).parsed ?? {};
const buyer = load(buyerEnv);
const buyerKey = () => parseKey(buyer.HEDERA_BUYER_KEY, "HEDERA_BUYER_KEY"); // only to create Rover-B
const B_START_HBAR = Number(process.env.START_HBAR ?? 5); // register ~0.9 + setAgentURI ~0.25 HBAR (HANDOFF), with room for a later card update

const SELLERS = {
  a: { name: "Rover-A", body: "arduino-uno-q" as const, port: 8402, list: { move: "0.02", photo: "0.08" }, floor: { move: "0.015", photo: "0.05" },
       description: "Real 4WD rover (Arduino UNO Q) for hire: inspects a parcel with its camera. Every move is a 0G TEE-verified " +
                    "decision paid per move in USDC with x402 on Hedera; photos are pay-on-delivery." },
  b: { name: "Rover-B (simulated)", body: "simulated" as const, port: 8403, list: { move: "0.03", photo: "0.10" }, floor: { move: "0.03", photo: "0.10" },
       description: "Simulated seller with no physical body: quotes parcel inspections at a higher price and holds firm. " +
                    "It cannot run a mission." },
};
type Seller = keyof typeof SELLERS;

function appendEnv(path: string, lines: Record<string, string>) {
  const have = load(path);
  const add = Object.entries(lines).filter(([k]) => !have[k]).map(([k, v]) => `${k}=${v}\n`).join("");
  if (add) appendFileSync(path, add);
}

async function createRoverB(): Promise<void> {
  if (load(envPath("b")).HEDERA_ROVER_ID) return;
  const key = PrivateKey.generateECDSA();
  const client = operatorClient(buyer.HEDERA_BUYER_ID!, buyerKey());
  const rc = await (await new AccountCreateTransaction().setECDSAKeyWithAlias(key).setInitialBalance(new Hbar(B_START_HBAR))
    .execute(client)).getReceipt(client);
  const id = rc.accountId!.toString();
  // The key never leaves this process except into the 0600 file.
  writeFileSync(envPath("b"), `HEDERA_ROVER_ID=${id}\nHEDERA_ROVER_KEY=${key.toStringRaw()}\n`, { mode: 0o600 });
  const own = operatorClient(id, key);
  await (await new TokenAssociateTransaction().setAccountId(id).setTokenIds([USDC]).execute(own)).getReceipt(own);
  console.log(JSON.stringify({ step: "rover-b account", id, initial_hbar: B_START_HBAR, usdc_associated: (await usdcBalance(id)).associated }));
}

async function setupSeller(s: Seller) {
  const sel = SELLERS[s];
  if (!dry) appendEnv(envPath(s), { SHOP_NAME: sel.name, PRICE_MOVE: sel.list.move, PRICE_PHOTO: sel.list.photo,
                                    PRICE_FLOOR_MOVE: sel.floor.move, PRICE_FLOOR_PHOTO: sel.floor.photo, PORT: String(sel.port) });
  const env = load(envPath(s));
  const key = parseKey(env.HEDERA_ROVER_KEY, `${s}: HEDERA_ROVER_KEY`);
  const wallet = evmWallet(key);
  const acct = await mirror(`/api/v1/accounts/${env.HEDERA_ROVER_ID}`);
  if (acct?.evm_address?.toLowerCase() !== wallet.address.toLowerCase())
    throw new Error(`${s}: ${env.HEDERA_ROVER_ID}'s EVM address ${acct?.evm_address} is not its key's ${wallet.address}`);
  // Phase 14: the seller's addresses on Base Sepolia and Solana devnet, when its env file has them
  const accepts = ([[CHAINS.base, env.ROVER_BASE_PAY_TO], [CHAINS.solana, env.ROVER_SOLANA_PAY_TO]] as const)
    .filter(([, payTo]) => !!payTo).map(([c, payTo]) => ({ network: c.network, asset: c.usdc, payTo: payTo! }));
  const input = { name: sel.name, description: sel.description + (accepts.length ? " It also takes USDC on the other chains under x402.accepts." : ""),
                  shop: env.PUBLIC_URL ?? `http://localhost:${sel.port}`, payTo: env.HEDERA_ROVER_ID!,
                  move: usdcAtomic(sel.list.move).toString(), photo: usdcAtomic(sel.list.photo).toString(), body: sel.body,
                  ...(accepts.length ? { accepts } : {}) };
  const row: any = { seller: s, account: env.HEDERA_ROVER_ID, evm: wallet.address, hbar: acct.balance.balance / 1e8 };
  if (dry) {
    const card = agentCard(input);
    row.card = card;
    row.card_bytes = cardUri(card).length;
    row.register_gas_estimate = (await identity(wallet).getFunction("register").estimateGas(cardUri(card),
      [{ metadataKey: "hederaAccount", metadataValue: new TextEncoder().encode(env.HEDERA_ROVER_ID!) }])).toString();
    return row;
  }
  let agentId = env.ERC8004_AGENT_ID;
  if (!agentId) {
    const reg = await register(wallet, agentCard(input), env.HEDERA_ROVER_ID!);
    agentId = reg.agentId;
    appendEnv(envPath(s), { ERC8004_AGENT_ID: agentId });
    row.register = { tx: reg.hash, gas_used: reg.gasUsed, gas_limit: reg.gasLimit, hbar: reg.feeHbar,
                     block_time: (await reg.receipt.getBlock()).timestamp };
    const upd = await send(identity(wallet), "setAgentURI", [agentId, cardUri(agentCard({ ...input, agentId }))]);
    row.set_agent_uri = { tx: upd.hash, gas_used: upd.gasUsed, gas_limit: upd.gasLimit, hbar: upd.feeHbar };
  } else if (updateCard) {
    const want = cardUri(agentCard({ ...input, agentId }));
    if (want !== (await identity().tokenURI(agentId))) {
      const upd = await send(identity(wallet), "setAgentURI", [agentId, want]);
      row.set_agent_uri = { tx: upd.hash, gas_used: upd.gasUsed, gas_limit: upd.gasLimit, hbar: upd.feeHbar };
    } else row.set_agent_uri = "card already up to date";
  }
  const id = identity();
  const [uri, owner, wallet8004] = await Promise.all([id.tokenURI(agentId), id.ownerOf(agentId), id.getAgentWallet(agentId)]);
  const card = await readCard(uri);
  row.agentId = agentId;
  row.checks = { owner_is_wallet: owner.toLowerCase() === wallet.address.toLowerCase(),
                 agent_wallet_is_payto: wallet8004.toLowerCase() === wallet.address.toLowerCase(),
                 card_payto: card.x402?.payTo === env.HEDERA_ROVER_ID,
                 registrations: card.registrations?.[0]?.agentId === Number(agentId) && card.registrations?.[0]?.agentRegistry === ERC8004.agentRegistry };
  row.card = card;
  return row;
}

if (!dry && !updateCard) await createRoverB();
const rows = [];
for (const s of ["a", "b"] as Seller[]) {
  if ((dry || updateCard) && !load(envPath(s)).HEDERA_ROVER_ID) { rows.push({ seller: s, note: "no account in this checkout (created by the real run)" }); continue; }
  const row = await setupSeller(s);
  console.log(JSON.stringify(row, null, dry ? 1 : 0));
  rows.push(row);
}
if (!dry) {
  const firstReg = Math.min(...rows.map((r: any) => r.register?.block_time ?? Infinity));
  if (Number.isFinite(firstReg)) appendEnv(buyerEnv, { ERC8004_FROM: String(firstReg - 60) });
  const dir = process.env.SETUP_EVIDENCE_DIR
    ? pathToFileURL(process.env.SETUP_EVIDENCE_DIR.replace(/\/?$/, "/")) // a setup run can keep its record outside the evidence folders
    : new URL("../../../docs/rover/evidence/P7/", import.meta.url);
  mkdirSync(dir, { recursive: true });
  writeFileSync(new URL(updateCard ? "card_update.json" : process.env.SETUP_EVIDENCE_DIR ? "setup-agents.json" : "setup.json", dir), JSON.stringify({ at: new Date().toISOString(), registry: ERC8004.identity, sellers: rows,
                                                            erc8004_from: load(buyerEnv).ERC8004_FROM ?? null }, null, 2) + "\n");
}
process.exit(0); // the Hedera client keeps its gRPC channels open
