import type { Metadata } from "next";
import { ArchDiagram, ArchHeader, ArchPage } from "@/components/arch";
import { MULTICHAIN } from "@/lib/arch";

export const metadata: Metadata = {
  title: "Rover for Hire · Pay on any chain",
  description: "The rover and Station-A take USDC on Hedera, Base or Solana; identity and every payment's record stay on Hedera, and 0G stays the brain.",
};

export default function Page() {
  return (
    <ArchPage>
      <ArchHeader subject="Pay on any chain · Hedera · Base · Solana" logos={["hedera", "0g"]} current="/architecture/multichain/" />
      <p className="mb-8 max-w-3xl text-lg leading-relaxed text-chalk-2">
        Rover-A and Station-A take USDC on Hedera, Base or Solana, and your AI asks you which one for every mission and every reading.
        Who is for hire, and the record of every payment, stay on Hedera. 0G stays the brain.
      </p>
      <ArchDiagram spec={MULTICHAIN} present="/architecture/multichain/present/" />
    </ArchPage>
  );
}
