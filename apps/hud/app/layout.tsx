import type { Metadata } from "next";
import { Doto, Geist_Mono, Geist_Pixel, Silkscreen } from "next/font/google";
import "./globals.css";

const pixel = Geist_Pixel({ variable: "--nf-pixel", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--nf-mono", subsets: ["latin"] });
const dots = Doto({ variable: "--nf-dots", subsets: ["latin"], weight: ["800"] });
const label = Silkscreen({ variable: "--nf-label", subsets: ["latin"], weight: ["400"] });

export const metadata: Metadata = {
  title: "Rover for Hire · Live",
  description: "The hired rover live: what its camera sees, what 0G decided, the three leases, and every payment and proof as it lands.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${pixel.variable} ${mono.variable} ${dots.variable} ${label.variable} h-full antialiased`}>
      <body className="min-h-full font-mono">{children}</body>
    </html>
  );
}
// 2026-11-06T19:00:00
