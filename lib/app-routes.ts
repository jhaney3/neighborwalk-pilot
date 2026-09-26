export type AppView = "today" | "outreach" | "map" | "people" | "followups" | "leader" | "settings" | "more" | "recovery" | "data";
const paths: Record<AppView, string> = { today: "today", outreach: "outreach", map: "locations", people: "people", followups: "followups", leader: "leader", settings: "settings", more: "more", recovery: "recovery", data: "data" };
export function appHref(view: AppView, id?: string) { return "/app/" + paths[view] + (id ? "/" + encodeURIComponent(id) : ""); }
export function appRoute(pathname: string): { view: AppView; id?: string; fieldOutingId?: string } {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "app") return { view: "today" };
  const view = (Object.keys(paths) as AppView[]).find((v) => paths[v] === parts[1]) ?? "today";
  if (view === "outreach" && parts[3] === "field") return { view: "map", fieldOutingId: parts[2] };
  return { view, id: parts[2] ? decodeURIComponent(parts[2]) : undefined };
}
export function validAppSegments(parts: string[]) {
  if (!Object.values(paths).includes(parts[0])) return false;
  if (parts.length === 1) return true;
  if (!/^[A-Za-z0-9_-]{1,240}$/.test(parts[1] ?? "")) return false;
  return (parts.length === 2 && ["outreach", "people", "locations", "followups"].includes(parts[0]))
    || (parts.length === 3 && parts[0] === "outreach" && parts[2] === "field");
}
