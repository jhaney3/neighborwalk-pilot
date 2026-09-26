import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";

const cancelled = (error: unknown) => /cancel|abort/i.test(error instanceof Error ? `${error.name} ${error.message}` : String(error));

/** Opens the share sheet with a message, or copies it when sharing isn't available. */
export async function shareText(title: string, text: string): Promise<"shared" | "copied"> {
  if (Capacitor.isNativePlatform()) {
    try { await Share.share({ title, text, dialogTitle: title }); }
    catch (error) { if (!cancelled(error)) throw error; }
    return "shared";
  }
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try { await navigator.share({ title, text }); return "shared"; }
    catch (error) { if (cancelled(error)) return "shared"; }
  }
  await navigator.clipboard.writeText(text);
  return "copied";
}
