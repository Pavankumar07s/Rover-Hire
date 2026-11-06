import type { Metadata } from "next";
import { ArchPresent } from "@/components/arch";
import { STATION } from "@/lib/arch";

export const metadata: Metadata = { title: "Rover for Hire · Station-A (full screen)" };

export default function Page() {
  return <ArchPresent spec={STATION} subject="Station-A on Hedera · ERC-8004 · x402 · HCS" logos={["hedera"]} />;
}
