import type { Metadata } from "next";
import { Hire } from "@/components/Hire";

export const metadata: Metadata = {
  title: "Rover for Hire · Hire it",
  description: "Hire the rover from your own AI: Claude or ChatGPT connect to the rover's MCP server, and pay for every move and photo in USDC on Hedera, Base or Solana.",
};

export default function Page() {
  return <Hire />;
}
