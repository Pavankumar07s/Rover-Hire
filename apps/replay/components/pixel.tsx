"use client";

import { useEffect, useRef, useState } from "react";
import { GLYPHS, PIXELS, type GlyphName, type PixelName } from "@/lib/pixels";

const SWEEP = 17; // x + y runs 0..16 on a 9×9 grid

/** A 9×9 dot-matrix icon. Colour comes from `currentColor`. Icons above 16px light up along the diagonal when they
    scroll into view, and again on hover; every pixel ends fully lit. Small ones, such as verification marks, show at once. */
export function Pixel({ name, size = 36, grid = true, className = "", label }: { name: PixelName; size?: number; grid?: boolean; className?: string; label?: string }) {
  const ref = useRef<SVGSVGElement>(null);
  const animate = size > 16;
  const [stage, setStage] = useState(animate ? -1 : SWEEP);
  useEffect(() => {
    const el = ref.current;
    if (!el || !animate) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const sweep = () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setStage(SWEEP); return; }
      clearInterval(timer);
      let k = -1;
      setStage(k);
      timer = setInterval(() => { k += 1; setStage(k); if (k >= SWEEP) clearInterval(timer); }, 32);
    };
    const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting) { sweep(); io.disconnect(); } });
    io.observe(el);
    const fallback = setTimeout(() => setStage((s) => (s < 0 ? SWEEP : s)), 2500);
    const host = el.closest(".group") ?? el;
    host.addEventListener("pointerenter", sweep);
    return () => { io.disconnect(); clearTimeout(fallback); clearInterval(timer); host.removeEventListener("pointerenter", sweep); };
  }, [animate]);
  return (
    <svg ref={ref} viewBox="0 0 9 9" width={size} height={size} className={`shrink-0 ${className}`}
      role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} shapeRendering="crispEdges">
      {PIXELS[name].flatMap((row, y) => [...row].map((c, x) => {
        const key = `${x}-${y}`;
        if (c === ".") return grid ? <rect key={key} x={x + 0.12} y={y + 0.12} width={0.76} height={0.76} fill="currentColor" opacity={0.12} /> : null;
        return <rect key={key} x={x + 0.06} y={y + 0.06} width={0.88} height={0.88} opacity={stage >= x + y ? 1 : 0}
          fill={c === "*" ? "var(--color-accent)" : "currentColor"} />;
      }))}
    </svg>
  );
}

/** Loading state: a wave runs across a dot grid. */
export function PixelLoader({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-4 py-10" role="status" aria-label={label}>
      <svg viewBox="0 0 9 9" width={44} height={44} aria-hidden shapeRendering="crispEdges">
        {Array.from({ length: 81 }, (_, i) => {
          const x = i % 9, y = Math.floor(i / 9);
          return <rect key={i} x={x + 0.1} y={y + 0.1} width={0.8} height={0.8} fill="currentColor" className="px-wave" style={{ "--d": `${(x + y) * 70}ms` } as React.CSSProperties} />;
        })}
      </svg>
      <p className="font-label text-sm uppercase tracking-wider">{label}</p>
    </div>
  );
}

/** The same wave on a 3×3 grid, sized to the text, for a control that is still waiting on data. */
export function PixelDots({ className = "" }: { className?: string }) {
  return (
    <span className={`px-dots inline-flex shrink-0 ${className}`}>
      <svg viewBox="0 0 3 3" width="1.15em" height="1.15em" aria-hidden shapeRendering="crispEdges">
        {Array.from({ length: 9 }, (_, i) => {
          const x = i % 3, y = Math.floor(i / 3);
          return <rect key={i} x={x + 0.15} y={y + 0.15} width={0.7} height={0.7} fill="currentColor" className="px-wave" style={{ "--d": `${(x + y) * 150}ms` } as React.CSSProperties} />;
        })}
      </svg>
      <span className="sr-only">loading</span>
    </span>
  );
}

/** A 7×7 pixel glyph for controls and links, sized to the text. */
export function Glyph({ name, className = "" }: { name: GlyphName; className?: string }) {
  return (
    <svg viewBox="0 0 7 7" width="0.8em" height="0.8em" className={`inline-block shrink-0 ${className}`} aria-hidden shapeRendering="crispEdges">
      {GLYPHS[name].flatMap((row, y) => [...row].map((c, x) => (c === "#" ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="currentColor" /> : null)))}
    </svg>
  );
}

const FIELD_CELL = 14;

/** A dot grid behind a section: cells around the pointer light up in orange and cream and fade out. Fill the nearest
    `relative` parent; content above it needs `relative`. Static faint dots with reduced motion. */
export function PixelField() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const host = canvas?.parentElement;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !host || !ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let cols = 0, rows = 0, dpr = 1, raf = 0, inside = false;
    let heat = new Float32Array(0), cream = new Uint8Array(0);
    const draw = (): boolean => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cols * FIELD_CELL, rows * FIELD_CELL);
      let live = false;
      for (let i = 0; i < heat.length; i++) {
        const x = (i % cols) * FIELD_CELL, y = Math.floor(i / cols) * FIELD_CELL, h = heat[i]!;
        if (h > 0.03) {
          live = true;
          ctx.globalAlpha = Math.min(1, h);
          ctx.fillStyle = cream[i] ? "#f2ede3" : "#ff6a13";
          ctx.fillRect(x + 2, y + 2, FIELD_CELL - 4, FIELD_CELL - 4);
          heat[i] = h * 0.9;
        } else {
          heat[i] = 0;
          ctx.globalAlpha = 0.1;
          ctx.fillStyle = "#f2ede3";
          ctx.fillRect(x + 6, y + 6, 2, 2);
        }
      }
      ctx.globalAlpha = 1;
      return live;
    };
    const loop = () => { raf = draw() || inside ? requestAnimationFrame(loop) : 0; };
    const resize = () => {
      dpr = window.devicePixelRatio || 1;
      const w = host.clientWidth, h = host.clientHeight;
      [canvas.width, canvas.height] = [Math.round(w * dpr), Math.round(h * dpr)];
      [cols, rows] = [Math.ceil(w / FIELD_CELL), Math.ceil(h / FIELD_CELL)];
      heat = new Float32Array(cols * rows);
      cream = new Uint8Array(cols * rows);
      draw();
    };
    const onMove = (e: PointerEvent) => {
      if (reduce) return;
      const r = host.getBoundingClientRect();
      const cx = Math.floor((e.clientX - r.left) / FIELD_CELL), cy = Math.floor((e.clientY - r.top) / FIELD_CELL);
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const d = Math.hypot(dx, dy), x = cx + dx, y = cy + dy;
        if (d > 3.2 || x < 0 || y < 0 || x >= cols || y >= rows || Math.random() > 0.3 + 0.7 * (1 - d / 3.2)) continue;
        const i = y * cols + x;
        heat[i] = Math.max(heat[i]!, 1 - d / 4);
        cream[i] = Math.random() < 0.2 ? 1 : 0;
      }
      if (!raf) raf = requestAnimationFrame(loop);
    };
    const onEnter = () => { inside = true; };
    const onLeave = () => { inside = false; };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerenter", onEnter);
    host.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerenter", onEnter);
      host.removeEventListener("pointerleave", onLeave);
    };
  }, []);
  return <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />;
}
