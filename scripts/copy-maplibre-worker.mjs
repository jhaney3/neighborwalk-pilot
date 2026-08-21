import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicDirectory = join(projectRoot, "public");

await mkdir(publicDirectory, { recursive: true });
await copyFile(
  join(projectRoot, "node_modules", "maplibre-gl", "dist", "maplibre-gl-worker.mjs"),
  join(publicDirectory, "maplibre-gl-worker.mjs"),
);
