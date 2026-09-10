export const PRODUCTION_SUPABASE_HOST = "llhrbtlkcneldgrhkwpf.supabase.co";
export const LOCAL_SUPABASE_URL = "http://127.0.0.1:54321";

export function assertSafeSupabaseUrl(value: string | undefined, production: boolean, browserHost?: string) {
  if (!value?.trim()) return;
  const url = new URL(value);
  const local = url.origin === LOCAL_SUPABASE_URL;
  const live = url.protocol === "https:" && url.hostname === PRODUCTION_SUPABASE_HOST && !url.port;
  const loopbackBrowser = browserHost === "localhost" || browserHost === "127.0.0.1" || browserHost === "[::1]";
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/"
    || (production ? !live || loopbackBrowser : !local)) {
    throw new Error("Production data is protected. Local and preview builds must use the local test database at http://127.0.0.1:54321. Run npm run sandbox:start.");
  }
}

export const isProductionApp = process.env.NEXT_PUBLIC_APP_ENV === "production";

export function environmentStorageKey(name: string, url: string | undefined, production: boolean) {
  // Keep existing production storage intact; test builds never read its pending edits.
  if (production) return name;
  const scope = url?.trim() ? new URL(url).origin : "demo";
  return `${name}:sandbox:${scope}`;
}

export function storageKey(name: string) {
  return environmentStorageKey(name, process.env.NEXT_PUBLIC_SUPABASE_URL, isProductionApp);
}

export const SANDBOX_CONTENT_SECURITY_POLICY = [
  "connect-src 'self' blob: data: http://127.0.0.1:54321 ws://127.0.0.1:54321 https://api.maptiler.com https://*.maptiler.com https://tiles.openfreemap.org https://fonts.openmaptiles.org",
  "form-action 'self'",
  "base-uri 'self'",
].join("; ");
