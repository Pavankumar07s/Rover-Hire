import type { MetadataRoute } from "next";
import { site, flatNav } from "@/lib/site";

// Generated sitemap covering every documentation route — helps search engines
// crawl the full docs tree.
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return flatNav.map((item) => ({
    url: new URL(item.href, site.url).toString(),
    lastModified: now,
    changeFrequency: "weekly",
    priority: item.href === "/" ? 1 : 0.7,
  }));
}
