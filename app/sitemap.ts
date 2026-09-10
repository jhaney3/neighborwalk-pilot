import type { MetadataRoute } from "next";
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = process.env.NEXT_PUBLIC_SITE_URL || "https://neighborwalk-pilot.vercel.app";
  return ["", "/how-it-works", "/pricing", "/trust", "/help", "/pilot"].map((path) => ({
    url: origin + path, lastModified: "2026-09-10", changeFrequency: "monthly", priority: path ? 0.7 : 1,
  }));
}
