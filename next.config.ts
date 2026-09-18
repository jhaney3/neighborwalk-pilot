import type { NextConfig } from "next";
import { assertSafeSupabaseUrl } from "./lib/environment";
import { securityHeaders } from "./lib/security-headers";

const production = process.env.VERCEL_ENV === "production" && process.env.NODE_ENV === "production";
assertSafeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, production);

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Local browser and Playwright testing use the numeric loopback address.
  // Next 16 otherwise rejects its dev-only HMR and font requests because the
  // server identifies itself as localhost, which leaves Fast Refresh unstable.
  allowedDevOrigins: ["127.0.0.1"],
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
