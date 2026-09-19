import { copyFile, mkdir } from "node:fs/promises";
await mkdir("mobile/public", { recursive: true });
for (const filename of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  await copyFile(`public/${filename}`, `mobile/public/${filename}`);
}
