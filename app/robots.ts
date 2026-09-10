import type { MetadataRoute } from "next";
export default function robots(): MetadataRoute.Robots {
  const origin = process.env.NEXT_PUBLIC_SITE_URL || "https://neighborwalk-pilot.vercel.app";
  return { rules: { userAgent: "*", allow: "/", disallow: ["/app/", "/login", "/demo", "/api/"] }, sitemap: origin + "/sitemap.xml" };
}
