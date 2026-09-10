import type { NextConfig } from "next";
import { assertSafeSupabaseUrl, SANDBOX_CONTENT_SECURITY_POLICY } from "./lib/environment";

const production = process.env.VERCEL_ENV === "production" && process.env.NODE_ENV === "production";
assertSafeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, production);

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_APP_ENV: production ? "production" : "sandbox" },
  async headers() {
    return production ? [] : [{
      source: "/:path*",
      headers: [{ key: "Content-Security-Policy", value: SANDBOX_CONTENT_SECURITY_POLICY }],
    }];
  },
};

export default nextConfig;
