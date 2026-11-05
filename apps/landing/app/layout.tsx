import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "0xBs — Prompt an agent. Hardware settles and moves.",
  description:
    "The machine-payable control plane for physical AI. Wrap any microcontroller into a globally addressable x402 endpoint. Claude and ChatGPT settle USDC, actuate motors, and purchase sensor telemetry — including MCU-class silicon at commodity cost.",
  keywords: [
    "x402",
    "physical AI",
    "agentic commerce",
    "ESP32",
    "microcontroller payments",
    "USDC",
    "Base",
    "robotics",
    "drone",
    "sensor marketplace",
    "machine-to-agent",
    "MQTT",
  ],
  openGraph: {
    title: "0xBs — Prompt an agent. Hardware settles and moves.",
    description:
      "Machine-payable infrastructure for Claude, ChatGPT, and any x402 client. MCU-class devices become globally addressable merchants.",
    url: "https://0xbs.org",
    siteName: "0xBs",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    creator: "@AbhinavGenX",
    title: "0xBs — Prompt an agent. Hardware settles and moves.",
    description:
      "x402 → ESP32 → motors. Agents settle USDC on Base and actuate physical systems.",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
