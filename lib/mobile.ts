/** Compile-time flag; the website keeps its own navigation and sign-in flow. */
export const isMobileApp = process.env.NEXT_PUBLIC_NATIVE_APP === "true";
export const appServiceOrigin = process.env.NEXT_PUBLIC_SERVICE_ORIGIN || "https://neighborwalk-pilot.vercel.app";

export function serviceUrl(path: string) {
  return isMobileApp ? new URL(path, appServiceOrigin).toString() : path;
}
