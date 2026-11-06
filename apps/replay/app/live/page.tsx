import type { Metadata } from "next";
import { Live } from "@/components/Live";

export const metadata: Metadata = {
  title: "Rover for Hire · Live",
  description: "A mission as it happens: payments from Hedera within seconds, the rover's view and decisions from 0G Storage, re-checked in your browser.",
};

export default function Page() {
  return <Live />;
}
