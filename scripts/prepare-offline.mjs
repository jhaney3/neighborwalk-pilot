import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const staticDirectory = join(root, ".next", "static");
async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => entry.isDirectory() ? collect(join(directory, entry.name)) : [join(directory, entry.name)]));
  return nested.flat();
}
const files = (await collect(staticDirectory)).filter((path) => /\.(js|css|woff2?)$/.test(path)).sort();
if (!files.length || files.length > 500) throw new Error("Unexpected static asset manifest; offline preparation was not generated.");
const assets = files.map((path) => "/_next/static/" + relative(staticDirectory, path).replaceAll("\\", "/"));
const hash = createHash("sha256");
hash.update(await readFile(join(root, ".next", "BUILD_ID")));
hash.update(await readFile(join(root, "public", "sw.js")));
for (const asset of ["manifest.webmanifest", "favicon.svg", "icon-192.png", "icon-512.png", "apple-touch-icon.png"]) hash.update(await readFile(join(root, "public", asset)));
let bytes = 0;
for (const path of files) { hash.update(relative(staticDirectory, path)); hash.update(await readFile(path)); bytes += (await stat(path)).size; }
if (bytes > 16 * 1024 * 1024) throw new Error("The offline app shell exceeds 16 MB. Review bundle growth before release.");
const manifest = { version: hash.digest("hex").slice(0, 24), assets, bytes };
// Generated build output only. No records, secrets, source maps or external map
// imagery enter this manifest. Updating an imported worker script triggers the
// browser's normal service-worker update lifecycle without skipWaiting().
await writeFile(join(root, "public", "sw-build.js"), "self.NEIGHBORWALK_BUILD = " + JSON.stringify(manifest) + ";\n");
process.stdout.write(`Prepared ${assets.length} immutable offline app assets (${Math.ceil(bytes / 1024)} KiB). No church records or map imagery included.\n`);
