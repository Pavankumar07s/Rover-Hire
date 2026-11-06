import type { Metadata } from "next";
import { ArchDiagram, ArchHeader, ArchPage, RunStrip } from "@/components/arch";
import { HEDERA } from "@/lib/arch";

export const metadata: Metadata = {
  title: "Rover for Hire · on Hedera",
  description: "ERC-8004 to find and review rovers, A2A to haggle, x402 in USDC for every move and photo, and HCS for public logs.",
};

export default function Page() {
  return (
    <ArchPage>
      <ArchHeader subject="On Hedera · ERC-8004 · A2A · x402 · HCS · Agent Kit" logos={["hedera"]} current="/architecture/hedera/" />
      <RunStrip />
      <ArchDiagram spec={HEDERA} present="/architecture/hedera/present/" />
    </ArchPage>
  );
}
