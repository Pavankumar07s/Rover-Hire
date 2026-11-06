import type { Metadata } from "next";
import { Station } from "@/components/Station";

export const metadata: Metadata = {
  title: "Rover for Hire · Station-A",
  description: "Station-A sells signed sensor readings on Hedera. Every sale, read from its public topic and checked in your browser.",
};

export default function Page() {
  return <Station />;
}
