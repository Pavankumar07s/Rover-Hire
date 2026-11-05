"use client";

import { useState } from "react";

const TABS = ["Firmware", "TypeScript", "Python", "cURL"] as const;

function snippets(api: string): Record<(typeof TABS)[number], { html: string; plain: string }> {
  return {
    Firmware: {
      html: `<span class="tok-kw">#include</span> &lt;OxBS.h&gt;

OxBS oxbs;

oxbs.wrap(FORWARD_ID, [](JsonVariantConst args, JsonObject result) {
  drive(args[<span class="tok-str">"seconds"</span>] | 1);
  result[<span class="tok-str">"action"</span>] = <span class="tok-str">"forward"</span>;
});
oxbs.setPrice(FORWARD_ID, [](JsonVariantConst args) {
  <span class="tok-kw">return</span> OxBS::usd((args[<span class="tok-str">"seconds"</span>] | 1) * 0.01f);
});
oxbs.begin(CONNECTOR_ID, API_KEY);`,
      plain: `#include <OxBS.h>

OxBS oxbs;

oxbs.wrap(FORWARD_ID, [](JsonVariantConst args, JsonObject result) {
  drive(args["seconds"] | 1);
  result["action"] = "forward";
});
oxbs.setPrice(FORWARD_ID, [](JsonVariantConst args) {
  return OxBS::usd((args["seconds"] | 1) * 0.01f);
});
oxbs.begin(CONNECTOR_ID, API_KEY);`,
    },
    TypeScript: {
      html: `<span class="tok-kw">import</span> { wrapFetchWithPayment, createSigner } <span class="tok-kw">from</span> <span class="tok-str">"x402-fetch"</span>;

<span class="tok-kw">const</span> evm = <span class="tok-kw">await</span> createSigner(<span class="tok-str">"base"</span>, process.env.KEY);
<span class="tok-kw">const</span> pay = wrapFetchWithPayment(fetch, { evm });

<span class="tok-kw">const</span> res = <span class="tok-kw">await</span> pay(
  <span class="tok-str">"${api}/quote/device/DEV/service/forward"</span>,
  {
    method: <span class="tok-str">"POST"</span>,
    body: JSON.stringify({ params: { seconds: 2 } }),
  },
);
console.log(<span class="tok-kw">await</span> res.json());`,
      plain: `import { wrapFetchWithPayment, createSigner } from "x402-fetch";

const evm = await createSigner("base", process.env.KEY);
const pay = wrapFetchWithPayment(fetch, { evm });

const res = await pay(
  "${api}/quote/device/DEV/service/forward",
  {
    method: "POST",
    body: JSON.stringify({ params: { seconds: 2 } }),
  },
);
console.log(await res.json());`,
    },
    Python: {
      html: `<span class="tok-kw">from</span> x402.http <span class="tok-kw">import</span> pay

res = pay.post(
    <span class="tok-str">"${api}/quote/device/DEV/service/forward"</span>,
    json={ <span class="tok-str">"params"</span>: { <span class="tok-str">"seconds"</span>: 2 } },
)
print(res.json())`,
      plain: `from x402.http import pay

res = pay.post(
    "${api}/quote/device/DEV/service/forward",
    json={ "params": { "seconds": 2 } },
)
print(res.json())`,
    },
    cURL: {
      html: `curl -X POST \\
  <span class="tok-str">${api}/quote/device/DEV/service/forward</span> \\
  -H <span class="tok-str">"content-type: application/json"</span> \\
  -d <span class="tok-str">'{"params":{"seconds":2}}'</span>`,
      plain: `curl -X POST \\
  ${api}/quote/device/DEV/service/forward \\
  -H "content-type: application/json" \\
  -d '{"params":{"seconds":2}}'`,
    },
  };
}

export function CodeTabs({ api }: { api: string }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Firmware");
  const [copied, setCopied] = useState(false);
  const all = snippets(api);

  async function copy() {
    try {
      await navigator.clipboard.writeText(all[tab].plain);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--hairline)] bg-[#111214]">
      <div className="flex items-center justify-end border-b border-[var(--hairline)] px-4 py-3">
        <button
          type="button"
          onClick={copy}
          className="rounded-full border border-[var(--hairline-strong)] px-3 py-1 text-[12px] text-[var(--body)] hover:text-white"
        >
          {copied ? "Copied" : "Copy code"}
        </button>
      </div>
      <pre className="min-h-[280px] overflow-x-auto p-5 font-mono text-[12.5px] leading-6 text-[#d7d9de] sm:text-[13px]">
        <code dangerouslySetInnerHTML={{ __html: all[tab].html }} />
      </pre>
      <div className="flex flex-wrap gap-1.5 border-t border-[var(--hairline)] px-3 py-2.5">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-full px-3 py-1 text-[12px] transition-colors ${
              t === tab
                ? "bg-white/10 text-white"
                : "text-[var(--body-mid)] hover:text-white"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}
