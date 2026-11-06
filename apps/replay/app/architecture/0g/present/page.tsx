import type { Metadata } from "next";
import { ArchPresent } from "@/components/arch";
import { ZEROG } from "@/lib/arch";

export const metadata: Metadata = { title: "Rover for Hire · on 0G (full screen)" };

export default function Page() {
  return <ArchPresent spec={ZEROG} subject="On 0G · Compute (TEE) · Storage · Galileo" logos={["0g"]} />;
}
