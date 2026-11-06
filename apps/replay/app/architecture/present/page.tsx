import type { Metadata } from "next";
import { ArchPresent } from "@/components/arch";
import { SYSTEM } from "@/lib/arch";

export const metadata: Metadata = { title: "Rover for Hire · Architecture (full screen)" };

export default function Page() {
  return <ArchPresent spec={SYSTEM} subject="Architecture · the whole system" logos={["hedera", "0g"]} />;
}
