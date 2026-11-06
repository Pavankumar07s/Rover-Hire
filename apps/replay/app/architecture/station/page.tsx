import type { Metadata } from "next";
import Link from "next/link";
import { ArchDiagram, ArchHeader, ArchPage } from "@/components/arch";
import { STATION } from "@/lib/arch";

export const metadata: Metadata = {
  title: "Rover for Hire · Station-A",
  description: "Station-A, a sensor station on a second Arduino UNO Q: found on ERC-8004, paid 0.001 USDC a reading with x402, every reading signed, every sale on a public HCS topic.",
};

export default function Page() {
  return (
    <ArchPage>
      <ArchHeader subject="Station-A on Hedera · ERC-8004 · x402 · HCS" logos={["hedera"]} current="/architecture/station/" />
      <p className="mb-8 max-w-3xl text-lg leading-relaxed text-chalk-2">
        The marketplace isn&apos;t only for the rover. Station-A is a second Arduino UNO Q that sells signed readings of the room:
        temperature, humidity, light and motion. Same registry, same payments, same public logs; no 0G, because it makes no decisions.{" "}
        <Link href="/station/" className="text-chalk underline decoration-accent underline-offset-4 hover:text-accent">See its sales ›</Link>
      </p>
      <ArchDiagram spec={STATION} present="/architecture/station/present/" />
    </ArchPage>
  );
}
