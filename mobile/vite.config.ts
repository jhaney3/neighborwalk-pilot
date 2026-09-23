import { defineConfig, loadEnv } from "vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { assertSafeSupabaseUrl } from "../lib/environment";

const root = fileURLToPath(new URL("..", import.meta.url));
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, resolve(root, "mobile"), ""), ...process.env };
  const production = mode === "production";
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  assertSafeSupabaseUrl(url, production);
  if (production && (!url || !env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)) throw new Error("An iOS release requires production public Supabase configuration in mobile/.env.production.local.");
  const remotePush = env.NEXT_PUBLIC_PUSH_NOTIFICATIONS_ENABLED === "true";
  const apnsEnvironment = env.NEXT_PUBLIC_APNS_ENVIRONMENT === "sandbox" || env.NEXT_PUBLIC_APNS_ENVIRONMENT === "production"
    ? env.NEXT_PUBLIC_APNS_ENVIRONMENT
    : production ? "production" : "sandbox";
  if (production && (!remotePush || apnsEnvironment !== "production")) throw new Error("An iOS release requires production APNs assignment alerts.");
  const allowed = ["NEXT_PUBLIC_INVITE_ORIGIN", "NEXT_PUBLIC_PHONE_AUTH_ENABLED", "NEXT_PUBLIC_PUSH_NOTIFICATIONS_ENABLED", "NEXT_PUBLIC_APNS_ENVIRONMENT", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_MAPTILER_KEY", "NEXT_PUBLIC_MAP_STYLE_URL", "NEXT_PUBLIC_GEOCODER_URL"];
  return {
    root: resolve(root, "mobile"),
    publicDir: resolve(root, "mobile/public"),
    plugins: [{
      name: "neighborwalk-build-provenance",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "build-provenance.json",
          source: JSON.stringify({
            schemaVersion: 1,
            appId: "app.neighborwalk.ios",
            channel: production ? "app-store" : "sample",
            releaseEligible: production,
            remotePush,
            apnsEnvironment,
          }),
        });
      },
    }],
    resolve: { alias: { "next/navigation": resolve(root, "mobile/navigation.tsx"), "next/link": resolve(root, "mobile/navigation.tsx") } },
    define: {
      ...Object.fromEntries(allowed.map((key) => [`process.env.${key}`, JSON.stringify(env[key] ?? "")])),
      "process.env.NEXT_PUBLIC_NATIVE_APP": '"true"',
      "process.env.NEXT_PUBLIC_APP_ENV": JSON.stringify(production ? "production" : "sandbox"),
      "process.env.NODE_ENV": '"production"',
    },
    esbuild: { jsx: "automatic" },
    build: { outDir: "dist", emptyOutDir: true, target: "safari15", sourcemap: false },
    server: { host: "127.0.0.1", port: 4173 },
  };
});
