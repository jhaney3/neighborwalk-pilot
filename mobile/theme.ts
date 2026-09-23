import { Capacitor, registerPlugin } from "@capacitor/core";

export type MobileColorTheme = "light" | "dark";
export type MobileColorThemePreference = "system" | MobileColorTheme;

const STORAGE_KEY = "neighborwalk.mobile.color-theme";
const systemPreference = () => typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
const nativeAppearance = registerPlugin<{ setTheme(options: { theme: MobileColorTheme }): Promise<void> }>("NeighborWalkAppearance");

function storedPreference(): MobileColorTheme | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : null;
  } catch {
    return null;
  }
}

export function getMobileColorTheme(): MobileColorThemePreference {
  return storedPreference() ?? "system";
}

export function applyMobileColorTheme(theme: MobileColorTheme) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#121714" : "#f1f2ec");
  if (Capacitor.isNativePlatform()) void nativeAppearance.setTheme({ theme }).catch(() => {});
}

export function setMobileColorTheme(theme: MobileColorThemePreference) {
  try {
    if (theme === "system") window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // The visual preference still applies for this session when storage is unavailable.
  }
  applyMobileColorTheme(theme === "system" ? systemPreference() : theme);
}

export function installMobileColorTheme() {
  applyMobileColorTheme(storedPreference() ?? systemPreference());
  const preference = window.matchMedia("(prefers-color-scheme: dark)");
  preference.addEventListener("change", (event) => {
    if (!storedPreference()) applyMobileColorTheme(event.matches ? "dark" : "light");
  });
}
