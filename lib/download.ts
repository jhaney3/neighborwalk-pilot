import { isMobileApp } from "./mobile";
export function downloadBlob(blob: Blob, filename: string) {
  if (isMobileApp) {
    void import("../mobile/share-file").then(({ shareFile }) => shareFile(blob, filename)).catch(() => window.alert("The file could not be shared. Your records are still saved on this device. Please try again."));
    return;
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // Give the browser time to start consuming the object URL.
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
