export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // Give the browser time to start consuming the object URL.
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
