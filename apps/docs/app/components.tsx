import Link from "next/link";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/layouts/docs/page";
import { findNeighbour } from "fumadocs-core/page-tree";
import type { TOCItemType } from "fumadocs-core/toc";
import { pageTree } from "@/lib/source";

export { Code } from "./code-block";

export function slugify(title: string) {
  return title
    .toLowerCase()
    .replace(/[`'"()]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function toc(...titles: string[]): TOCItemType[] {
  return titles.map((title) => ({
    title,
    url: `#${slugify(title)}`,
    depth: 2,
  }));
}

export function H2({ children }: { children: string }) {
  return <h2 id={slugify(children)}>{children}</h2>;
}

export function Article({
  title,
  lead,
  href,
  headings,
  children,
}: {
  title: string;
  lead?: string;
  href?: string;
  headings?: string[];
  children: React.ReactNode;
}) {
  const neighbours = href ? findNeighbour(pageTree, href) : undefined;
  const items = headings?.length ? toc(...headings) : undefined;

  return (
    <DocsPage
      toc={items}
      tableOfContent={{ enabled: Boolean(items) }}
      tableOfContentPopover={{ enabled: Boolean(items) }}
      footer={neighbours ? { items: neighbours } : { enabled: false }}
    >
      <DocsTitle>{title}</DocsTitle>
      {lead ? <DocsDescription>{lead}</DocsDescription> : null}
      <DocsBody>{children}</DocsBody>
    </DocsPage>
  );
}

export function DocLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const absolute = href.startsWith("http");
  if (absolute || href.endsWith(".md")) {
    return (
      <a href={href} rel={absolute ? "noreferrer" : undefined} target={absolute ? "_blank" : undefined}>
        {children}
      </a>
    );
  }
  return <Link href={href}>{children}</Link>;
}
