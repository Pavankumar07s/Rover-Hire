import type { Metadata } from "next";
import { ArchDiagram, ArchHeader, ArchPage, RunStrip } from "@/components/arch";
import { SYSTEM } from "@/lib/arch";

export const metadata: Metadata = {
  title: "Rover for Hire · Architecture",
  description: "How Rover for Hire works: Claude hires a rover on Hedera and pays each move in USDC on Hedera, Base or Solana; 0G decides and proves every move, every step is saved on 0G.",
};

export default function Page() {
  return (
    <ArchPage>
      <ArchHeader subject="Architecture · the whole system" logos={["hedera", "0g"]} current="/architecture/" />
      <RunStrip />
      <ArchDiagram spec={SYSTEM} present="/architecture/present/" />
    </ArchPage>
  );
}
