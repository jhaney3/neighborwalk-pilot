import type { NextConfig } from "next";
import { assertSafeSupabaseUrl } from "./lib/environment";
import { securityHeaders } from "./lib/security-headers";

const production = process.env.VERCEL_ENV === "production" && process.env.NODE_ENV === "production";
assertSafeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, production);

const nextConfig: NextConfig = {
  poweredByHeader: false,
  env: { NEXT_PUBLIC_APP_ENV: production ? "production" : "sandbox" },
  async headers() {
    return [{
      source: "/:path*",
      headers: securityHeaders(production),
    }, {
      source: "/:file(sw.js|sw-build.js)",
      headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
    }];
  },
};

export default nextConfig;
