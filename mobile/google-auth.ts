import { Capacitor, registerPlugin } from "@capacitor/core";
import { createMobileGoogleClient, getSupabaseBrowserClient } from "../lib/supabase";

export const googleRedirectUrl = "neighborwalk://google-auth";
const google = registerPlugin<{ signIn(options: { url: string }): Promise<{ callbackUrl: string }> }>("NeighborWalkGoogle");
let inProgress = false;

export function googleCallbackCode(value: string) {
  const url = new URL(value);
  if (url.protocol !== "neighborwalk:" || url.hostname !== "google-auth" || !["", "/"].includes(url.pathname) || url.username || url.password || url.port || url.hash) throw new Error("Google returned an invalid sign-in response. Please try again.");
  if (url.searchParams.has("error")) throw new Error("Google sign-in was not completed. Please try again.");
  const codes = url.searchParams.getAll("code");
  if (codes.length !== 1 || !codes[0].trim()) throw new Error("Google did not return a sign-in code. Please try again.");
  return codes[0];
}

export async function signInWithGoogleNative() {
  if (Capacitor.getPlatform() !== "ios") throw new Error("Open the SendMe iPhone or iPad app to use this Google sign-in option.");
  if (inProgress) throw new Error("Google sign-in is already open.");
  const client = getSupabaseBrowserClient();
  if (!client) throw new Error("The app connection is unavailable.");
  inProgress = true;
  try {
    // The SDK owns the random verifier and S256 challenge. Both the verifier
    // and intermediate session live only in this short-lived client.
    const oauth = createMobileGoogleClient();
    const { data, error } = await oauth.auth.signInWithOAuth({ provider: "google", options: {
      redirectTo: googleRedirectUrl, skipBrowserRedirect: true, queryParams: { prompt: "select_account" },
    } });
    if (error) throw error;
    if (!data.url) throw new Error("Google sign-in could not be opened.");
    const { callbackUrl } = await google.signIn({ url: data.url });
    const result = await oauth.auth.exchangeCodeForSession(googleCallbackCode(callbackUrl));
    if (result.error) throw result.error;
    if (!result.data.session) throw new Error("Google sign-in did not create a session. Please try again.");
    const { access_token, refresh_token } = result.data.session;
    const saved = await client.auth.setSession({ access_token, refresh_token });
    if (saved.error) throw saved.error;
    // Do not navigate or clear invitation storage: the auth gate resumes the
    // invitation and requires the user to confirm Join church.
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "CANCELLED") return;
    throw error;
  } finally { inProgress = false; }
}
