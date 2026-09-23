import { createClient } from "@supabase/supabase-js";
import {
  classifyApnsResponse,
  createApnsProviderToken,
  notificationPayload,
  retryAfterSeconds,
  validClaim,
  type ClaimedDelivery,
  type DeliveryOutcome,
} from "./apns.ts";

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

type Environment = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  PUSH_WORKER_SECRET: string;
  APNS_TEAM_ID: string;
  APNS_KEY_ID: string;
  APNS_PRIVATE_KEY_PKCS8_BASE64: string;
  APNS_TOPIC: string;
};

const required = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "PUSH_WORKER_SECRET",
  "APNS_TEAM_ID",
  "APNS_KEY_ID",
  "APNS_PRIVATE_KEY_PKCS8_BASE64",
  "APNS_TOPIC",
] as const;
const environment = Object.fromEntries(required.map((key) => [key, Deno.env.get(key) ?? ""])) as Environment;
let cachedProviderToken: { value: string; createdAt: number } | undefined;

function configured() {
  return required.every((key) => environment[key])
    && environment.PUSH_WORKER_SECRET.length >= 32
    && /^[A-Za-z0-9.-]+$/.test(environment.APNS_TOPIC);
}

async function secureEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const a = new Uint8Array(leftHash);
  const b = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

async function providerToken(forceRefresh = false) {
  const now = Math.floor(Date.now() / 1000);
  if (!forceRefresh && cachedProviderToken && now - cachedProviderToken.createdAt < 50 * 60) return cachedProviderToken.value;
  const value = await createApnsProviderToken(
    environment.APNS_TEAM_ID,
    environment.APNS_KEY_ID,
    environment.APNS_PRIVATE_KEY_PKCS8_BASE64,
    now,
  );
  cachedProviderToken = { value, createdAt: now };
  return value;
}

async function send(delivery: ClaimedDelivery, forceRefresh = false) {
  const origin = delivery.apns_environment === "sandbox" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
  const response = await fetch(`${origin}/3/device/${delivery.device_token}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${await providerToken(forceRefresh)}`,
      "apns-id": delivery.apns_id,
      "apns-collapse-id": delivery.apns_id,
      "apns-topic": environment.APNS_TOPIC,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-expiration": String(Math.floor(Date.now() / 1000) + 86_400),
      "content-type": "application/json",
    },
    body: JSON.stringify(notificationPayload(delivery)),
    signal: AbortSignal.timeout(8_000),
  });
  let reason: string | undefined;
  if (!response.ok) {
    try {
      const decoded = await response.json();
      if (typeof decoded?.reason === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(decoded.reason)) reason = decoded.reason;
    } catch { /* APNs can close without a JSON error body. */ }
  }
  return {
    status: response.status,
    reason,
    retryAfter: retryAfterSeconds(response.headers.get("retry-after")),
  };
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!configured()) return Response.json({ error: "Push delivery is not configured" }, { status: 503 });
  const authorization = request.headers.get("authorization") ?? "";
  if (!await secureEqual(authorization, `Bearer ${environment.PUSH_WORKER_SECRET}`)) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    // Fail closed before leasing work when an Apple key was pasted or rotated
    // incorrectly; configuration failures must not consume delivery attempts.
    await providerToken();
  } catch {
    return Response.json({ error: "APNs credentials are invalid" }, { status: 503 });
  }

  const supabase = createClient(environment.SUPABASE_URL, environment.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc("claim_apns_deliveries", {
    // Sequential sends are intentionally bounded: at most two eight-second
    // attempts per item remain well inside this four-minute lease.
    target_batch_size: 8,
    target_lease_seconds: 240,
  });
  if (error) return Response.json({ error: "Unable to lease push deliveries" }, { status: 500 });

  const totals: Record<DeliveryOutcome | "rejected_claim" | "acknowledgement_error", number> = {
    delivered: 0,
    retry: 0,
    permanent_failure: 0,
    invalid_token: 0,
    rejected_claim: 0,
    acknowledgement_error: 0,
  };
  for (const delivery of (data ?? []) as ClaimedDelivery[]) {
    let outcome: DeliveryOutcome = "retry";
    let reason = "NetworkError";
    let retryAfter: number | null = null;
    if (!validClaim(delivery)) {
      outcome = "permanent_failure";
      reason = "UnsafeClaim";
      totals.rejected_claim += 1;
    } else {
      try {
        let result = await send(delivery);
        if (result.reason === "ExpiredProviderToken") result = await send(delivery, true);
        outcome = classifyApnsResponse(result.status, result.reason);
        reason = result.reason ?? (outcome === "delivered" ? "Delivered" : `Http${result.status}`);
        retryAfter = result.retryAfter;
        if (outcome === "retry" && ["BadTopic", "ExpiredProviderToken", "Forbidden", "InvalidProviderToken", "MissingProviderToken", "TopicDisallowed"].includes(reason)) {
          // Preserve work during an operator-correctable key/topic incident
          // instead of exhausting every attempt in a few minutes.
          retryAfter = 3_600;
        }
      } catch {
        // Do not log or return the delivery object: it contains the APNs token.
        outcome = "retry";
      }
    }

    const { data: finished, error: finishError } = await supabase.rpc("finish_apns_delivery", {
      target_outbox_id: delivery.outbox_id,
      target_lease_token: delivery.lease_token,
      target_outcome: outcome,
      target_reason: reason,
      target_retry_after_seconds: retryAfter,
      target_apns_id: delivery.apns_id,
    });
    if (finishError || finished !== true) totals.acknowledgement_error += 1;
    else totals[outcome] += 1;
  }
  return Response.json({ leased: (data ?? []).length, outcomes: totals });
});
