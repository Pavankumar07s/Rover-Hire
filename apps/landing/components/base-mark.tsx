/**
 * Base mark: the official Base logo — a blue circle with a rounded notch —
 * rendered clean and flat to anchor the brand.
 */
export function BaseMark({
  size = 26,
  tone = "brand",
}: {
  size?: number;
  tone?: "brand" | "on-dark";
}) {
  const fill = tone === "on-dark" ? "#ffffff" : "#0052FF";
  const inner = tone === "on-dark" ? "#0a0a0a" : "#fff";
  return (
    <span className="inline-flex shrink-0" style={{ lineHeight: 0 }}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        style={{ display: "block" }}
      >
        <circle cx="50" cy="50" r="50" fill={fill} />
        <path
          d="M50 84c18.8 0 34-15.2 34-34S68.8 16 50 16c-17.8 0-32.4 13.7-33.9 31.1h45v5.8h-45C17.6 70.3 32.2 84 50 84Z"
          fill={inner}
        />
      </svg>
    </span>
  );
}
