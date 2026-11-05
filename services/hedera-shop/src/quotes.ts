// Quotes and their missions, persisted in data/quotes-<seller>.json so a restart keeps the running totals.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { writeDurable } from "./durable.js";

const QUOTE_VALID_MS = 5 * 60_000;

export interface Quote {
  quote_id: string;
  mission: string;
  photos_wanted: number;
  move: string; // USDC atomic units per move
  photo: string; // per photo
  pay_to: string;
  status: "quoted" | "accepted" | "declined" | "started" | "ended";
  round: number; // negotiation round (plan §3.6); the quote is final after 3
  final: boolean;
  valid_until: string;
  transcript: { from: "buyer" | "seller"; at: string; msg: Record<string, unknown> }[];
  moves_paid: number;
  photos_paid: Record<string, string>; // photo n → tx
  move_txs: string[]; // move n → move_txs[n - 1]; the rover labels each move with it
  created_at: string;
}

export class Quotes {
  private map = new Map<string, Quote>();
  private file: string;

  constructor(seller: string) {
    const dir = new URL("../data/", import.meta.url).pathname;
    mkdirSync(dir, { recursive: true });
    this.file = `${dir}quotes-${seller}.json`;
    if (existsSync(this.file)) for (const q of JSON.parse(readFileSync(this.file, "utf8")) as Quote[]) this.map.set(q.quote_id, q);
  }

  save(): void {
    writeDurable(this.file, JSON.stringify([...this.map.values()], null, 2));
  }

  get(id: string | undefined): Quote | undefined {
    return id ? this.map.get(id) : undefined;
  }

  active(): Quote[] {
    return [...this.map.values()].filter((q) => q.status === "started");
  }

  create(seller: string, mission: string, photosWanted: number, prices: { move: string; photo: string }, payTo: string): Quote {
    const q: Quote = { quote_id: `${seller}-${randomBytes(4).toString("hex")}`, mission, photos_wanted: photosWanted, ...prices, pay_to: payTo,
                       status: "quoted", round: 1, final: false, valid_until: new Date(Date.now() + QUOTE_VALID_MS).toISOString(),
                       transcript: [], moves_paid: 0, photos_paid: {}, move_txs: [], created_at: new Date().toISOString() };
    this.map.set(q.quote_id, q);
    this.save();
    return q;
  }
}
