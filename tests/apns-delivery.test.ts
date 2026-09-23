import { webcrypto } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  classifyApnsResponse,
  createApnsProviderToken,
  notificationPayload,
  retryAfterSeconds,
  validClaim,
  type ClaimedDelivery,
} from "../supabase/functions/push-delivery/apns";

const claim: ClaimedDelivery = {
  outbox_id: "00000000-0000-4000-8000-000000000001",
  lease_token: "00000000-0000-4000-8000-000000000002",
  device_token: "a".repeat(64),
  apns_environment: "sandbox",
  event_kind: "walk_invitation",
  title: "Walk invitation",
  body: "You have a new walk invitation in NeighborWalk.",
  app_path: "/app/outreach/walk_1",
  apns_id: "00000000-0000-4000-8000-000000000003",
  attempt: 1,
};

beforeAll(() => {
  if (!globalThis.crypto) Object.defineProperty(globalThis, "crypto", { value: webcrypto });
});

describe("APNs privacy and response handling", () => {
  it("accepts only fixed generic copy, opaque app paths and APNs-safe tokens", () => {
    expect(validClaim(claim)).toBe(true);
    expect(notificationPayload(claim)).toEqual({
      aps: { alert: { title: claim.title, body: claim.body }, sound: "default" },
      source: "neighborwalk-remote-push-v1",
      path: claim.app_path,
    });
    expect(validClaim({ ...claim, body: "Meet Jane at 12 Main Street" })).toBe(false);
    expect(validClaim({ ...claim, app_path: "https://attacker.test/collect" })).toBe(false);
    expect(validClaim({ ...claim, device_token: "header\ninjection" })).toBe(false);
  });

  it("retires rejected tokens, retries transient APNs failures and stops permanent failures", () => {
    expect(classifyApnsResponse(200, undefined)).toBe("delivered");
    expect(classifyApnsResponse(410, "Unregistered")).toBe("invalid_token");
    expect(classifyApnsResponse(410, undefined)).toBe("invalid_token");
    expect(classifyApnsResponse(400, "BadDeviceToken")).toBe("invalid_token");
    expect(classifyApnsResponse(429, "TooManyRequests")).toBe("retry");
    expect(classifyApnsResponse(403, "ExpiredProviderToken")).toBe("retry");
    expect(classifyApnsResponse(403, "InvalidProviderToken")).toBe("retry");
    expect(classifyApnsResponse(400, "BadTopic")).toBe("retry");
    expect(classifyApnsResponse(400, "PayloadTooLarge")).toBe("permanent_failure");
    expect(retryAfterSeconds("120")).toBe(120);
    expect(retryAfterSeconds("7200")).toBe(3600);
    expect(retryAfterSeconds("not-a-date")).toBeNull();
  });

  it("creates a valid ES256 provider JWT without third-party key parsing", async () => {
    const pair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const privateKey = Buffer.from(await webcrypto.subtle.exportKey("pkcs8", pair.privateKey)).toString("base64");
    const token = await createApnsProviderToken("ABCDEFGHIJ", "KLMNOPQRST", privateKey, 1_800_000_000);
    const [header, claims, signature] = token.split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ alg: "ES256", kid: "KLMNOPQRST" });
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toEqual({ iss: "ABCDEFGHIJ", iat: 1_800_000_000 });
    expect(Buffer.from(signature, "base64url")).toHaveLength(64);
    expect(await webcrypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      pair.publicKey,
      Buffer.from(signature, "base64url"),
      new TextEncoder().encode(`${header}.${claims}`),
    )).toBe(true);
  });
});
