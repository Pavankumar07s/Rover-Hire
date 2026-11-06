import type { Metadata } from "next";
import { Callout } from "fumadocs-ui/components/callout";
import { Article, Code, DocLink, H2 } from "../../components";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "skills.md",
  description:
    "A machine-readable skill document at /skills.md that autonomous agents (ChatGPT, Claude) can fetch to learn how to discover and call 0xBS devices over x402.",
  alternates: { canonical: "/docs/skills" },
};

export default function Page() {
  return (
    <Article
      href="/docs/skills"
      title="skills.md — the agent-readable skill"
      lead="A single fetchable document that teaches any agent the whole flow: discover, call, pay, and authenticate."
      headings={["What it is", "Fetch it", "Use it in an agent"]}
    >
      <H2>What it is</H2>
      <p>
        <DocLink href="/skills.md">
          <code>/skills.md</code>
        </DocLink>{" "}
        is a plain-Markdown skill you can drop into an agent&apos;s context or
        point an autonomous agent at. It documents identifiers, discovery,
        free/paid/protected calls, x402 payment facts, and error handling — with
        copy-paste examples.
      </p>

      <H2>Fetch it</H2>
      <Code lang="bash">{`curl ${site.url}/skills.md`}</Code>

      <H2>Use it in an agent</H2>
      <ul>
        <li>
          <strong>Claude / ChatGPT:</strong> paste the contents as a
          skill/reference section.
        </li>
        <li>
          <strong>Autonomous agents:</strong> give the agent a fetch tool and
          the URL — it can read the skill at runtime, then discover and call
          devices.
        </li>
        <li>
          <strong>Retrieval / RAG:</strong> index it so the assistant can cite
          exact request shapes.
        </li>
      </ul>

      <Callout>
        The file is served from this docs origin at <code>/skills.md</code> and
        kept in sync with the repo root <code>skills.md</code>.
      </Callout>
    </Article>
  );
}
