// P4 acceptance test on Galileo: start → anchor ×2 → end, each revert by its exact error name, events read back.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { ethers } from "ethers";
import { abi, EXPLORER, wallet } from "./galileo.ts";

// Two sample roots: the contract stores any 32 bytes, so the test makes its own.
const ROOTS = [ethers.id("p4 sample segment 0"), ethers.id("p4 sample segment 1")];

const { address } = JSON.parse(readFileSync(new URL("deployment.json", import.meta.url), "utf8"));
const signer = await wallet();
const log = new ethers.Contract(address, abi, signer);
const stranger = new ethers.Contract(address, abi, ethers.Wallet.createRandom().connect(signer.provider));
const balance0 = await signer.provider!.getBalance(signer.address);
const id = ethers.id(`p4-contract-test-${new Date().toISOString()}`);
const txs: object[] = [];
const reverts: { case: string; expected: string; got: string; ok: boolean }[] = [];

async function send(label: string, tx: Promise<ethers.ContractTransactionResponse>) {
  const t0 = performance.now();
  const receipt = await (await tx).wait();
  if (!receipt || receipt.status !== 1) throw new Error(`${label} failed`);
  const row = { label, tx: receipt.hash, block: receipt.blockNumber, gasUsed: receipt.gasUsed.toString(),
                feeWei: (receipt.gasUsed * receipt.gasPrice).toString(), seconds: Math.round((performance.now() - t0) / 100) / 10 };
  txs.push(row);
  console.log(`${label}: gas ${row.gasUsed}, ${row.seconds} s  ${EXPLORER}/tx/${row.tx}`);
  return receipt;
}

async function expectRevert(name: string, label: string, call: () => Promise<unknown>) {
  let got = "no revert";
  try {
    await call();
  } catch (e) {
    const err = e as { revert?: { name?: string }; shortMessage?: string };
    got = err.revert?.name ?? err.shortMessage ?? String(e);
  }
  reverts.push({ case: label, expected: name, got, ok: got === name });
  console.log(`${label}: expected ${name}, got ${got}`);
}

const mission = "data:application/json;base64," + Buffer.from(JSON.stringify({ test: "P4 contract test" })).toString("base64");
const started = await send("startEpisode", log.startEpisode(id, mission));
await expectRevert("Exists", "second start", () => log.startEpisode.staticCall(id, mission));
await expectRevert("NotRover", "stranger anchors", () => stranger.anchorSegment.staticCall(id, 0, ROOTS[0], 0, 0));
await expectRevert("BadIndex", "anchor index 1 before 0", () => log.anchorSegment.staticCall(id, 1, ROOTS[0], 0, 0));
await send("anchorSegment 0", log.anchorSegment(id, 0, ROOTS[0], 0, 9));
await send("anchorSegment 1", log.anchorSegment(id, 1, ROOTS[1], 10, 19));
await expectRevert("NotRover", "stranger ends", () => stranger.endEpisode.staticCall(id, ROOTS[1], 0, 20));
await send("endEpisode", log.endEpisode(id, ROOTS[1], 1, 20));
await expectRevert("AlreadyEnded", "anchor after end", () => log.anchorSegment.staticCall(id, 2, ROOTS[0], 20, 29));
await expectRevert("AlreadyEnded", "end twice", () => log.endEpisode.staticCall(id, ROOTS[1], 1, 20));

const from = started.blockNumber;
const anchored = (await log.queryFilter(log.filters.SegmentAnchored(id), from)) as ethers.EventLog[];
const ended = (await log.queryFilter(log.filters.EpisodeEnded(id), from)) as ethers.EventLog[];
const state = await log.episodes(id);
const readBack = {
  anchored: anchored.map((e) => ({ segIndex: Number(e.args.segIndex), root: e.args.root, firstSeq: Number(e.args.firstSeq), lastSeq: Number(e.args.lastSeq) })),
  ended: ended.map((e) => ({ finalRoot: e.args.finalRoot, safeStops: Number(e.args.safeStops), decisions: Number(e.args.decisions) })),
  state: { rover: state.rover, segments: Number(state.segments), ended: state.ended },
};
const pass = reverts.every((r) => r.ok) && readBack.anchored.length === 2 && readBack.anchored.every((a, i) => a.root === ROOTS[i])
  && readBack.ended.length === 1 && readBack.state.ended && readBack.state.segments === 2 && readBack.state.rover === signer.address;
const spentWei = (balance0 - (await signer.provider!.getBalance(signer.address))).toString();
const result = { at: new Date().toISOString(), contract: address, episodeId: id, txs, reverts, readBack, spentWei, pass };
mkdirSync(new URL("../../docs/rover/evidence/P4/", import.meta.url), { recursive: true });
writeFileSync(new URL("../../docs/rover/evidence/P4/contract_test.json", import.meta.url), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ pass, spent0G: ethers.formatEther(spentWei) }));
// 2026-11-06T07:42:00
