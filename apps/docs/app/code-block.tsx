"use client";

import { DynamicCodeBlock } from "fumadocs-ui/components/dynamic-codeblock";

const LANG: Record<string, string> = {
  jsonc: "json",
  text: "text",
  http: "http",
};

export function Code({ children, lang = "text" }: { children: string; lang?: string }) {
  return (
    <DynamicCodeBlock
      lang={LANG[lang] ?? lang}
      code={children.replace(/^\n/, "").replace(/\n$/, "")}
    />
  );
}
