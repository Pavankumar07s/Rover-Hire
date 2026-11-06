import type { Metadata } from "next";
import { ArchDiagram, ArchHeader, ArchPage, RunStrip } from "@/components/arch";
import { ZEROG } from "@/lib/arch";

export const metadata: Metadata = {
  title: "Rover for Hire · on 0G",
  description: "Every move decided by a model in a TEE on 0G Compute, its signature checked against 0G's chain, every step saved on 0G Storage and anchored on Galileo.",
};

export default function Page() {
  return (
    <ArchPage>
      <ArchHeader subject="On 0G · Compute (TEE) · Storage · Galileo" logos={["0g"]} current="/architecture/0g/" />
      <RunStrip />
      <ArchDiagram spec={ZEROG} present="/architecture/0g/present/" />
    </ArchPage>
  );
}
