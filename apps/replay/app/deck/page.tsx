import type { Metadata } from "next";
import { ArchSlide, Poster } from "@/components/arch";
import { HEDERA, MULTICHAIN, STATION, SYSTEM, ZEROG } from "@/lib/arch";

export const metadata: Metadata = { title: "Rover for Hire · Deck" };

// Six 1920×1080 pages for print to PDF: the poster, then the whole system, Hedera, 0G, Station-A and paying on any chain.
export default function Page() {
  return (
    <div className="bg-night">
      <style>{"@page { size: 1920px 1080px; margin: 0 } html, body { background: #0a0a0a; margin: 0 } section { break-after: page } section:last-child { break-after: auto }"}</style>
      <Poster />
      <ArchSlide spec={SYSTEM} subject="Architecture · the whole system" logos={["hedera", "0g"]} />
      <ArchSlide spec={HEDERA} subject="On Hedera · ERC-8004 · A2A · x402 · HCS · Agent Kit" logos={["hedera"]} />
      <ArchSlide spec={ZEROG} subject="On 0G · Compute (TEE) · Storage · Galileo" logos={["0g"]} />
      <ArchSlide spec={STATION} subject="Station-A on Hedera · ERC-8004 · x402 · HCS" logos={["hedera"]} />
      <ArchSlide spec={MULTICHAIN} subject="Pay on any chain · Hedera · Base · Solana" logos={["hedera", "0g"]} />
    </div>
  );
}
