import type { Metadata } from "next";
import { ArchPresent } from "@/components/arch";
import { MULTICHAIN } from "@/lib/arch";

export const metadata: Metadata = { title: "Rover for Hire · Pay on any chain (full screen)" };

export default function Page() {
  return <ArchPresent spec={MULTICHAIN} subject="Pay on any chain · Hedera · Base · Solana" logos={["hedera", "0g"]} />;
}
