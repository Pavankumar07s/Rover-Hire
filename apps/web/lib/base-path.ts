/** Optional prefix when the console is mounted under a path. Empty on this project. */
export const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function apiUrl(path: string) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${basePath}${normalized}`;
}
