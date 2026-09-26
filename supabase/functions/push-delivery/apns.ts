export type PushKind = "walk_invitation" | "follow_up_assignment";

export type ClaimedDelivery = {
  outbox_id: string;
  lease_token: string;
  device_token: string;
  apns_environment: "sandbox" | "production";
  event_kind: PushKind;
  title: string;
  body: string;
  app_path: string;
  apns_id: string;
  attempt: number;
};

export type DeliveryOutcome = "delivered" | "retry" | "permanent_failure" | "invalid_token";

// Accept existing database claims while sending the current public brand.
const genericCopy: Record<PushKind, { title: string; body: string; legacyBody: string; path: RegExp }> = {
  walk_invitation: {
    title: "Walk invitation",
    body: "You have a new walk invitation in SendMe.",
    legacyBody: "You have a new walk invitation in NeighborWalk.",
    path: /^\/app\/outreach(?:\/[A-Za-z0-9_-]{1,240})?$/,
  },
  follow_up_assignment: {
    title: "New follow-up",
    body: "A follow-up was assigned to you in SendMe.",
    legacyBody: "A follow-up was assigned to you in NeighborWalk.",
    path: /^\/app\/followups(?:\/[A-Za-z0-9_-]{1,240})?$/,
  },
};

export function validClaim(delivery: ClaimedDelivery) {
  const copy = genericCopy[delivery.event_kind];
  return Boolean(copy
    && copy.title === delivery.title
    && (copy.body === delivery.body || copy.legacyBody === delivery.body)
    && copy.path.test(delivery.app_path)
    && /^[0-9a-f]{16,512}$/.test(delivery.device_token)
    && delivery.device_token.length % 2 === 0
    && /^[0-9a-f-]{36}$/.test(delivery.apns_id));
}

export function notificationPayload(delivery: ClaimedDelivery) {
  if (!validClaim(delivery)) throw new Error("Unsafe push delivery claim");
  return {
    aps: {
      alert: { title: delivery.title, body: genericCopy[delivery.event_kind].body },
      sound: "default",
    },
    source: "neighborwalk-remote-push-v1",
    path: delivery.app_path,
  };
}

const invalidTokenReasons = new Set(["BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered"]);
const transientReasons = new Set([
  "ExpiredProviderToken",
  "Forbidden",
  "InternalServerError",
  "InvalidProviderToken",
  "MissingProviderToken",
  "ServiceUnavailable",
  "Shutdown",
  "BadTopic",
  "TopicDisallowed",
  "TooManyProviderTokenUpdates",
  "TooManyRequests",
]);

export function classifyApnsResponse(status: number, reason: string | undefined): DeliveryOutcome {
  if (status === 200) return "delivered";
  if (status === 410 || (reason && invalidTokenReasons.has(reason))) return "invalid_token";
  if (status === 429 || status === 500 || status === 503 || (reason && transientReasons.has(reason))) return "retry";
  return "permanent_failure";
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function bytes(value: string) {
  return new TextEncoder().encode(value);
}

function decodeBase64(value: string) {
  const binary = atob(value.replaceAll(/\s/g, ""));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function createApnsProviderToken(
  teamId: string,
  keyId: string,
  privateKeyPkcs8Base64: string,
  issuedAtSeconds = Math.floor(Date.now() / 1000),
) {
  if (!/^[A-Z0-9]{10}$/.test(teamId) || !/^[A-Z0-9]{10}$/.test(keyId)) throw new Error("Invalid APNs key metadata");
  const header = base64Url(bytes(JSON.stringify({ alg: "ES256", kid: keyId })));
  const claims = base64Url(bytes(JSON.stringify({ iss: teamId, iat: issuedAtSeconds })));
  const signingInput = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    decodeBase64(privateKeyPkcs8Base64),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  // Web Crypto ECDSA returns the 64-byte IEEE-P1363 form required by JOSE.
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, bytes(signingInput)));
  if (signature.byteLength !== 64) throw new Error("Unexpected ES256 signature format");
  return `${signingInput}.${base64Url(signature)}`;
}

export function retryAfterSeconds(value: string | null, now = Date.now()) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(3600, Math.ceil(seconds));
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return null;
  return Math.min(3600, Math.max(0, Math.ceil((date - now) / 1000)));
}
