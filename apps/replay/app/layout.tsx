import type { Metadata } from "next";
import { Doto, Geist_Mono, Geist_Pixel, Silkscreen } from "next/font/google";
import "./globals.css";

const pixel = Geist_Pixel({ variable: "--nf-pixel", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--nf-mono", subsets: ["latin"] });
const dots = Doto({ variable: "--nf-dots", subsets: ["latin"], weight: ["800"] });
const label = Silkscreen({ variable: "--nf-label", subsets: ["latin"], weight: ["400"] });

export const metadata: Metadata = {
  title: "Rover for Hire · Replay",
  description:
    "Every move a hired rover made, re-verified in your browser from 0G Storage, 0G's on-chain TEE signer and Hedera's ledger. No team server.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${pixel.variable} ${mono.variable} ${dots.variable} ${label.variable} h-full antialiased`}>
      <body className="min-h-full font-mono">{children}</body>
    </html>
  );
}
// 2026-11-06T20:18:00
