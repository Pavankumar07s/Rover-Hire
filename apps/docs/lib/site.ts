// Central site config for SEO + navigation. Set NEXT_PUBLIC_DOCS_URL in prod so
// canonical URLs, sitemap, and Open Graph point at the real domain.
export const site = {
  name: "0xBS Docs",
  title: "0xBS — Machine-payable physical AI for agents",
  description:
    "Prompt Claude or ChatGPT; they settle USDC over x402 and actuate MCU-class hardware. 0xBS is the control plane that turns ESP32 silicon, sensors, robotics, and UAVs into globally addressable, paywalled endpoints.",
  url: process.env.NEXT_PUBLIC_DOCS_URL ?? "https://docs.0xbs.org",
  // Where the running device-controller API lives (for copy-paste examples).
  apiUrl: process.env.NEXT_PUBLIC_DEVICE_CONTROLLER_URL ?? "https://device-controller.0xbs.org",
  twitter: "@AbhinavGenX",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "https://app.0xbs.org",
  sdk: "https://github.com/abhinav-genx/0xBs-sdk",
  x402: "https://www.x402.org",
  keywords: [
    "x402",
    "physical AI",
    "agentic commerce",
    "AI agents",
    "ESP32",
    "microcontroller payments",
    "USDC",
    "Base",
    "robotics",
    "drone",
    "sensor marketplace",
    "MCP",
    "ChatGPT actions",
    "Claude tools",
    "machine-to-agent",
    "pay per call",
  ],
} as const;

export type NavItem = { title: string; href: string; summary: string };

// Ordered documentation sections — drives the sidebar AND the sitemap.
export const nav: { group: string; items: NavItem[] }[] = [
  {
    group: "Getting started",
    items: [
      { title: "Introduction", href: "/", summary: "The machine-payable control plane for physical AI." },
      { title: "Quickstart", href: "/docs/quickstart", summary: "Discover and pay a device from an agent." },
      { title: "Core concepts", href: "/docs/concepts", summary: "Devices, services, IDs, and x402 settlement." },
    ],
  },
  {
    group: "For agents",
    items: [
      { title: "Discover devices", href: "/docs/discovery", summary: "List a device's services + arguments." },
      { title: "Call a service", href: "/docs/calling", summary: "Free, paid (x402), and protected calls." },
      { title: "Claude & ChatGPT", href: "/docs/agents", summary: "Prompt an agent; it settles and actuates." },
      { title: "skills.md", href: "/docs/skills", summary: "The machine-readable skill agents can fetch." },
    ],
  },
  {
    group: "For device operators",
    items: [
      { title: "Firmware SDK", href: "/docs/firmware", summary: "wrap() — MCU-class silicon as a merchant." },
      { title: "Connect a device", href: "/docs/connect-device", summary: "connectorId, API key, and MQTT." },
      { title: "API reference", href: "/docs/api", summary: "Every public + owner endpoint." },
      { title: "Security", href: "/docs/security", summary: "What to keep private and why." },
    ],
  },
];

export const flatNav: NavItem[] = nav.flatMap((g) => g.items);
