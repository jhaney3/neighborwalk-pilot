import { Capacitor, registerPlugin } from "@capacitor/core";
import { getSupabaseBrowserClient } from "../lib/supabase";

const apple = registerPlugin<{ signIn(options: { nonce: string }): Promise<{ identityToken: string; fullName?: string }> }>("NeighborWalkApple");
const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

export async function signInWithApple() {
  if (Capacitor.getPlatform() !== "ios") throw new Error("Open the NeighborWalk iPhone or iPad app to use Sign in with Apple.");
  const client = getSupabaseBrowserClient();
  if (!client) throw new Error("The workspace connection is unavailable.");
  const nonce = hex(crypto.getRandomValues(new Uint8Array(32)));
  const digest = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(nonce))));
  const credential = await apple.signIn({ nonce: digest });
  const { error } = await client.auth.signInWithIdToken({ provider: "apple", token: credential.identityToken, nonce });
  if (error) throw error;
  // Apple returns the name only on first authorization. It is display data, never a role or permission.
  if (credential.fullName) await client.auth.updateUser({ data: { full_name: credential.fullName } });
}
