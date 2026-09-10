import { appHref, validAppSegments, type AppView } from "./app-routes";

export function authenticatedAppPath(search: string): string {
  const params = new URLSearchParams(search);
  const next = params.get("next");
  const parts = next?.split("/").filter(Boolean);
  const safe = next?.startsWith("/app/") && parts && validAppSegments(parts.slice(1)) ? next : appHref("today");
  const invite = params.get("invite");
  return safe + (invite && /^[a-f0-9-]{16,200}$/i.test(invite) ? "?invite=" + encodeURIComponent(invite) : "");
}

export function legacyAppPath(search: string, hash: string, standalone = false): string | null {
  const params = new URLSearchParams(search);
  if (params.has("invite") || params.has("code") || params.has("error_description") || /(?:access_token|error_description|type=recovery|code=)/.test(hash)) return "/login" + search + hash;
  const requested = params.get("view");
  const aliases: Record<string, AppView> = { map: "map", people: "people", followups: "followups", guide: "guide", leader: "leader", settings: "settings" };
  if (requested && aliases[requested]) return appHref(aliases[requested]);
  return standalone ? appHref("today") : null;
}
