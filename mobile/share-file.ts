import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

export async function shareFile(blob: Blob, filename: string) {
  if (!Capacitor.isNativePlatform()) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return;
  }
  const path = `exports/${crypto.randomUUID()}/${filename.replace(/[^a-zA-Z0-9_.-]/g, "_")}`;
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  const { uri } = await Filesystem.writeFile({ path, data, directory: Directory.Cache, recursive: true });
  try { await Share.share({ title: filename, files: [uri], dialogTitle: "Save or share your export" }); }
  catch (error) {
    if (!/cancel/i.test(error instanceof Error ? error.message : String(error))) throw error;
  } finally {
    await Filesystem.deleteFile({ path, directory: Directory.Cache }).catch(() => {});
  }
}
