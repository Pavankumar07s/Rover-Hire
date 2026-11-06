import type { Root } from "fumadocs-core/page-tree";
import { nav } from "@/lib/site";

export const pageTree: Root = {
  name: "Docs",
  children: nav.map((group) => ({
    type: "folder" as const,
    name: group.group,
    defaultOpen: true,
    children: group.items.map((item) => ({
      type: "page" as const,
      name: item.title,
      url: item.href,
      description: item.summary,
    })),
  })),
};
