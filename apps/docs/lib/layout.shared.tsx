import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { site } from "@/lib/site";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <span className="font-semibold tracking-tight">0xBS</span>,
      url: "/",
    },
    githubUrl: site.sdk,
    links: [
      {
        text: "Console",
        url: `${site.appUrl}/login`,
        external: true,
      },
      {
        text: "x402",
        url: site.x402,
        external: true,
      },
    ],
    searchToggle: { enabled: false },
  };
}
