/** Resolves like `p`, but calls `onStuck` once if `p` has not settled after `ms`. */
export function watched<T>(p: Promise<T>, ms: number, onStuck: () => void): Promise<T> {
  const t = setTimeout(onStuck, ms);
  return p.finally(() => clearTimeout(t));
}
