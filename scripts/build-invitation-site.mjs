import { cp, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const output = resolve("outputs/ios/invitation-site");
await mkdir(output, { recursive: true });
await cp("mobile/invitation-site", output, { recursive: true });
const store = process.env.NEIGHBORWALK_APP_STORE_URL || "";
if (store && !/^https:\/\/apps\.apple\.com\//.test(store)) throw new Error("Use the actual App Store HTTPS listing URL.");
await writeFile(resolve(output, "config.js"), `window.NEIGHBORWALK_APP_STORE_URL = ${JSON.stringify(store)};\n`);
const team = process.env.APPLE_TEAM_ID;
if (team) {
  if (!/^[A-Z0-9]{10}$/.test(team)) throw new Error("APPLE_TEAM_ID must be the 10-character Apple team identifier.");
  await mkdir(resolve(output, ".well-known"), { recursive: true });
  await writeFile(resolve(output, ".well-known/apple-app-site-association"), JSON.stringify({ applinks: { details: [{ appIDs: [`${team}.app.neighborwalk.ios`], components: [{ "/": "/invite", comment: "Church invitations only" }] }] } }));
}
await writeFile(resolve(output, "vercel.json"), JSON.stringify({ cleanUrls: true, rewrites: [{ source: "/invite", destination: "/" }], headers: [{ source: "/(.*)", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "X-Content-Type-Options", value: "nosniff" }, { key: "Content-Security-Policy", value: "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" }] }, { source: "/.well-known/apple-app-site-association", headers: [{ key: "Content-Type", value: "application/json" }] }] }, null, 2));
console.log(`Invitation handoff site prepared at ${output}. Deploy this directory as a separate static project.`);
