import type { Metadata } from "next";
import { ArchPresent } from "@/components/arch";
import { HEDERA } from "@/lib/arch";

export const metadata: Metadata = { title: "Rover for Hire · on Hedera (full screen)" };

export default function Page() {
  return <ArchPresent spec={HEDERA} subject="On Hedera · ERC-8004 · A2A · x402 · HCS" logos={["hedera"]} />;
}
