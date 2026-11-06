"use client";

import { useEffect } from "react";

/** A panel that fails to draw must not blank a live HUD: show why, then redraw from the next snapshot. */
export default function HudError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    const t = setTimeout(reset, 2000);
    return () => clearTimeout(t);
  }, [error, reset]);
  return (
    <div className="grid min-h-screen place-items-center p-6 text-center">
      <div>
        <p className="font-pixel text-2xl">The HUD hit a drawing error</p>
        <p className="mt-3 font-mono text-sm text-chalk-2">{error.message}</p>
        <p className="mt-3 text-sm text-chalk-2">Redrawing from the next live update…</p>
      </div>
    </div>
  );
}
