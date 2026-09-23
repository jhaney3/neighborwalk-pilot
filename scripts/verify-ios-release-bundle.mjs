import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const bundle = resolve(process.argv[2] || "ios/App/App/public");

async function readJson(filename) {
  try {
    return JSON.parse(await readFile(resolve(bundle, filename), "utf8"));
  } catch {
    throw new Error(`The iOS bundle is missing a valid ${filename}. Run npm run ios:sync before archiving.`);
  }
}

const provenance = await readJson("build-provenance.json");
if (provenance.schemaVersion !== 1 || provenance.appId !== "app.neighborwalk.ios"
  || provenance.channel !== "app-store" || provenance.releaseEligible !== true
  || provenance.remotePush !== true || provenance.apnsEnvironment !== "production") {
  throw new Error("The iOS bundle is a sample or unrecognized build. Run npm run ios:sync with the production mobile environment before archiving.");
}

const capacitor = await readJson("../capacitor.config.json");
if (capacitor.appId !== provenance.appId || capacitor.server?.url) {
  throw new Error("The native Capacitor configuration does not match the reviewed bundled production app.");
}

try {
  await readFile(resolve(bundle, "index.html"));
} catch {
  throw new Error("The iOS production web bundle is incomplete. Run npm run ios:sync before archiving.");
}

console.log(`Verified ${provenance.appId} App Store bundle provenance.`);
