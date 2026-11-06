import { Article, DocLink } from "./components";

export default function NotFound() {
  return (
    <Article title="Page not found" lead="That documentation page doesn't exist.">
      <p>
        See the <DocLink href="/">introduction</DocLink> or the{" "}
        <DocLink href="/docs/quickstart">quickstart</DocLink>.
      </p>
    </Article>
  );
}
