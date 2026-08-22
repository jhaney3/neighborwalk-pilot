import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicDirectory = join(projectRoot, "public");
const maplibreDistribution = join(
  projectRoot,
  "node_modules",
  "maplibre-gl",
  "dist",
);
const workerAssets = [
  "maplibre-gl-worker.mjs",
  "maplibre-gl-shared.mjs",
];

await mkdir(publicDirectory, { recursive: true });
await Promise.all(
  workerAssets.map((asset) =>
    copyFile(join(maplibreDistribution, asset), join(publicDirectory, asset)),
  ),
);
