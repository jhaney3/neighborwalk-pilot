import { appHref, validAppSegments, type AppView } from "./app-routes";

export function safeAppPath(value: string | null | undefined): string {
  if (!value?.startsWith("/app/")) return appHref("today");
  try {
    const url = new URL(value, "https://neighborwalk.invalid");
    if (url.origin !== "https://neighborwalk.invalid" || !validAppSegments(url.pathname.split("/").filter(Boolean).slice(1))) return appHref("today");
    const query = new URLSearchParams();
    if (url.pathname === "/app/followups") {
      const person = url.searchParams.get("person"); const scope = url.searchParams.get("scope");
      if (person && /^[A-Za-z0-9_-]{1,240}$/.test(person)) query.set("person", person);
      if (scope && ["mine", "all", "team", "unowned", "declined"].includes(scope)) query.set("scope", scope);
    }
    return url.pathname + (query.size ? "?" + query.toString() : "");
  } catch { return appHref("today"); }
}

export function authenticatedAppPath(search: string): string {
  return safeAppPath(new URLSearchParams(search).get("next"));
}

export function legacyAppPath(search: string, hash: string, standalone = false): string | null {
  const params = new URLSearchParams(search);
  if (params.has("invite") || params.has("code") || params.has("error_description") || /(?:access_token|error_description|type=recovery|code=)/.test(hash)) return "/login" + search + hash;
  const requested = params.get("view");
  const aliases: Record<string, AppView> = { map: "map", people: "people", followups: "followups", guide: "guide", leader: "leader", settings: "settings" };
  if (requested && aliases[requested]) return appHref(aliases[requested]);
  return standalone ? appHref("today") : null;
}
