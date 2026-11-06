import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-night px-4 text-chalk">
      <div className="text-center">
        <p className="font-pixel text-[30vw] leading-none sm:text-[14rem]">4<span className="text-accent">0</span>4</p>
        <p className="mt-4 font-mono text-sm text-chalk-2">This page is not on any chain.</p>
        <Link href="/" className="mt-8 inline-flex items-center gap-2.5 border border-accent bg-accent px-4 py-3 font-label text-xs uppercase tracking-[0.14em] text-night hover:bg-chalk">
          <span className="h-1.5 w-1.5 bg-current" aria-hidden />Back to missions
        </Link>
      </div>
    </main>
  );
}
