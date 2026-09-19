import { useMemo, useSyncExternalStore, type AnchorHTMLAttributes } from "react";
import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import { validAppSegments } from "../lib/app-routes";
import { appServiceOrigin } from "../lib/mobile";

export function isAppPath(path: string) {
  return ["/login", "/invite", "/demo"].includes(path)
    || (path.startsWith("/app/") && validAppSegments(path.split("/").filter(Boolean).slice(1)));
}

const subscribe = (callback: () => void) => {
  window.addEventListener("popstate", callback);
  return () => window.removeEventListener("popstate", callback);
};
const snapshot = () => window.location.pathname + window.location.search + window.location.hash;

/** Preserve the persistent workspace and pending IndexedDB writes across tabs. */
export function installNavigation() {
  for (const method of ["pushState", "replaceState"] as const) {
    const original = window.history[method].bind(window.history);
    window.history[method] = (...args: Parameters<History[typeof method]>) => {
      original(args[0], args[1], args[2]);
      window.dispatchEvent(new PopStateEvent("popstate"));
    };
  }
  if (!isAppPath(window.location.pathname)) window.history.replaceState(null, "", "/app/today");
}

export function usePathname() { return useSyncExternalStore(subscribe, snapshot).split(/[?#]/)[0]; }
export function useSearchParams() {
  const location = useSyncExternalStore(subscribe, snapshot);
  return useMemo(() => new URLSearchParams(location.split("?")[1]?.split("#")[0] ?? ""), [location]);
}
const router = {
  push: (href: string) => { void navigate(href); },
  replace: (href: string) => { void navigate(href, true); },
  back: () => window.history.back(),
};
export function useRouter() { return router; }

export async function navigate(href: string, replace = false) {
  // URL.origin is "null" for some custom schemes; use the actual base URL.
  const url = new URL(href, window.location.href);
  const local = url.protocol === window.location.protocol && url.host === window.location.host;
  if (local && isAppPath(url.pathname)) {
    window.history[replace ? "replaceState" : "pushState"](null, "", url.pathname + url.search + url.hash);
    return;
  }
  if (local && url.pathname === "/") { router.replace("/app/today"); return; }
  const external = local ? new URL(url.pathname + url.search + url.hash, appServiceOrigin) : url;
  if (!["https:", "mailto:", "tel:", "sms:"].includes(external.protocol)) return;
  if (Capacitor.isNativePlatform() && external.protocol === "https:") await Browser.open({ url: external.href, presentationStyle: "popover" });
  else window.open(external.href, "_blank", "noopener,noreferrer");
}

export default function Link({ href = "", onClick, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} href={href} onClick={(event) => {
    onClick?.(event);
    if (event.defaultPrevented || event.metaKey || event.ctrlKey) return;
    event.preventDefault();
    void navigate(href);
  }}>{children}</a>;
}
