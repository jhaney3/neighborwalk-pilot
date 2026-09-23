import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const verifier = resolve("scripts/verify-ios-release-bundle.mjs");
const fixtures: string[] = [];

function releaseBundle(overrides: Record<string, unknown> = {}) {
  const root = mkdtempSync(resolve(tmpdir(), "neighborwalk-ios-release-"));
  const app = resolve(root, "App");
  const bundle = resolve(app, "public");
  fixtures.push(root);
  mkdirSync(bundle, { recursive: true });
  writeFileSync(resolve(bundle, "index.html"), "<!doctype html><title>NeighborWalk</title>");
  writeFileSync(resolve(bundle, "build-provenance.json"), JSON.stringify({
    schemaVersion: 1,
    appId: "app.neighborwalk.ios",
    channel: "app-store",
    releaseEligible: true,
    remotePush: true,
    apnsEnvironment: "production",
    ...overrides,
  }));
  writeFileSync(resolve(app, "capacitor.config.json"), JSON.stringify({ appId: "app.neighborwalk.ios" }));
  return { app, bundle };
}

function verify(bundle: string) {
  return execFileSync(process.execPath, [verifier, bundle], { encoding: "utf8", stdio: "pipe" });
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

describe("iOS release bundle provenance verifier", () => {
  it("accepts an App Store bundle with matching native configuration", () => {
    const { bundle } = releaseBundle();
    expect(verify(bundle)).toContain("Verified app.neighborwalk.ios App Store bundle provenance.");
  });

  it("rejects a sample bundle", () => {
    const { bundle } = releaseBundle({ channel: "sample", releaseEligible: false });
    expect(() => verify(bundle)).toThrow(/sample or unrecognized build/);
  });

  it("rejects a bundle without production assignment alerts", () => {
    const { bundle } = releaseBundle({ remotePush: false });
    expect(() => verify(bundle)).toThrow(/sample or unrecognized build/);
  });

  it("rejects a bundle backed by a remote Capacitor server", () => {
    const { app, bundle } = releaseBundle();
    writeFileSync(resolve(app, "capacitor.config.json"), JSON.stringify({
      appId: "app.neighborwalk.ios",
      server: { url: "https://example.invalid" },
    }));
    expect(() => verify(bundle)).toThrow(/does not match the reviewed bundled production app/);
  });
});
