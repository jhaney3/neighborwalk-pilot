# Apple sign-in and iPhone invitations

Implemented on `codex/neighborwalk-ios`. No changes were deployed to the website, `main`, Supabase, or Apple Developer. Claude’s styling remains in the working tree. The production website continues using the original email-bound invitation functions.

## User flow

1. A leader confirms a recent sign-in, chooses Phone or Email, enters a contact and optional name, and chooses Volunteer or Leader.
2. Create invitation generates a single-use, seven-day link. Share opens the iOS share sheet; Messages/Mail opens an addressed draft; Copy copies the invitation. The user sends it. No automated SMS/email delivery service is claimed.
3. The recipient opens the dedicated invitation page, taps Open NeighborWalk, and signs in with Apple, email, or (when enabled) a phone verification code.
4. The app shows the church, account and granted role, then asks the recipient to tap Join church. **Any verified, signed-in account holding the link may accept it**, as requested. Apple Hide My Email and a different iCloud email work. The contact is an addressing label, not an identity restriction. Accounts are not merged and original invited addresses are not written into another account’s membership.
5. Links expire, can be revoked, and cannot reactivate suspended memberships or replace an existing workspace membership. Recreating an invitation for the same contact revokes the prior unused link. Original email-bound invitations remain restricted to their original email.

## Enable Apple sign-in

- In Apple Developer, register/verify ownership of bundle ID `app.neighborwalk.ios` and enable Sign in with Apple. Select the matching team in Xcode and regenerate the provisioning profile. The entitlement and AuthenticationServices bridge are included.
- In Supabase Authentication → Providers → Apple, enable the provider and add `app.neighborwalk.ios` to allowed client IDs. The native path exchanges Apple’s identity token using `signInWithIdToken`; it does not require a web Services ID or a web OAuth secret. If a browser Apple OAuth flow is added later, configure its Services ID, callback and rotating secret separately.
- The app sends a SHA-256 nonce to Apple and the original random nonce to Supabase. State is validated by the native bridge. Apple’s one-time name is saved as display metadata only.
- Test on a signed physical iPhone: first authorization, returning authorization, Hide My Email, cancellation, sign-out/reentry, and joining with a different invited email. Simulator compilation does not validate the Apple Developer/Supabase provider setup.
- Leaders whose authentication is older than 15 minutes must safely share pending work, sign out and sign back in with Apple. Refreshing an access token does not bypass recent-auth checks.
- Before App Store submission, complete the account-deletion workflow and **Apple token revocation**. The existing deletion request queue alone does not revoke Apple authorization. Implement the server-side Apple authorization-code exchange/token lifecycle and revoke during deletion, or a tested Apple-supported reauthorization/revocation flow. Never put Apple private keys in the app. This remains a release blocker, not an implemented feature.

## Enable invitation links without modifying the hosted website

1. Rehearse the additive migration `supabase/migrations/20260919214330_flexible_church_invitations.sql` against a development Supabase project containing all prior migrations. `npm run test:invitations` already exercises the actual SQL in isolated PostgreSQL with a minimal prior-schema fixture; a full migration rehearsal is still required before production rollout.
2. Review and deploy this additive migration through the normal database release process. It adds private tables and authenticated RPCs; it does not change legacy invitation behavior or membership policies. Creation/revocation retain live-leader and recent-auth checks. Tokens are 256-bit random capabilities stored only as hashes; public invitation URLs put tokens in fragments.
3. Run `npm run mobile:invite-site`. Upload **only** `outputs/ios/invitation-site` to a separate static hosting project. Its included Vercel config routes `/invite` to the handoff page, with no analytics or third-party scripts. Do not point it at the existing website project. Do not commit or publish a real invitation token.
4. Set `NEXT_PUBLIC_INVITE_ORIGIN` to that project’s HTTPS origin, without a path, in ignored `mobile/.env.production.local`. Rebuild with `npm run ios:sync`. Invitation creation reports a setup error until an origin is configured; it does not generate broken links pointing to the unchanged web app.
5. Once the App Store listing exists, set `NEIGHBORWALK_APP_STORE_URL` when generating the invitation site and republish that separate site. Until then, the site offers Open NeighborWalk and Copy invitation, useful for installed development/TestFlight builds.
6. For one-tap Universal Links, set the real `APPLE_TEAM_ID` when generating the site. This adds `/.well-known/apple-app-site-association`. In Xcode add Associated Domains → `applinks:YOUR_INVITATION_HOST` to the App target and enable that capability in the provisioning profile. Keep the invitation host stable. The app already accepts HTTPS `/invite` links from the configured origin.
7. Test Messages → installed app, Mail → installed app, browser fallback, and first-time installation. Universal Links do not automatically carry a token through App Store installation; the page asks users to return to the original message afterward, or paste the copied invitation in the app. There is no device fingerprinting or hidden deferred-link service.

The fallback Open NeighborWalk button uses the registered `neighborwalk://invite` scheme. Universal Links provide stronger app/site association and are recommended before public release. The dedicated page is an invitation handoff, not the website marketing landing page; it is not packaged in the native bundle.

## Optional phone-only account creation

Set up a supported SMS provider under Supabase Phone Authentication, configure delivery/rate limits and relevant country/consent requirements, then set `NEXT_PUBLIC_PHONE_AUTH_ENABLED=true` in the mobile build environment. Without that flag, phone invitations still work: recipients use Apple or email to sign in. No SMS credentials belong in the mobile environment or client bundle.

Phone sign-in supports create-or-sign-in via SMS OTP and iOS one-time-code autofill. Retry UI throttles code requests, but Supabase/provider server-side abuse controls are required. Test successful verification, incorrect/expired code, resend, changed number and actual international delivery on test accounts before enabling publicly. Browser tests mock SMS delivery and never text anyone.

## Verification

- `npm run test:invitations`: executes the migration and existing auth guards in isolated PGlite/PostgreSQL. Covers mismatched Apple email, verified phone-only identity, private table denial, anonymous/unverified/revoked sessions, leader/recent-auth checks, cross-church access, single use, idempotent retry, suspended/existing memberships, expiry, revoke/replacement, rate limit and secret-free list responses.
- `npm test`: route/token unit tests and the existing regression suite.
- `npx playwright test --config playwright.invitation.config.ts`: mocked backend tests for invitation retention through sign-in, explicit join, phone code flow, and small-screen sign-in. No real account is created.
- `npm run ios:sync`, then the existing XCUITest: builds the native Apple bridge and verifies bundled workspace navigation. Live Apple authorization, Universal Links association and SMS delivery still require the setup above.

References: [Supabase native Apple authentication](https://supabase.com/docs/guides/auth/social-login/auth-apple), [Apple AuthenticationServices](https://developer.apple.com/documentation/authenticationservices/implementing-user-authentication-with-sign-in-with-apple), [Apple deletion guidance](https://developer.apple.com/support/offering-account-deletion-in-your-app/).

## Google sign-in on iPhone and iPad

The native sign-in screen now offers **Continue with Google** alongside Apple and email. It uses Apple's `ASWebAuthenticationSession` system sheet and Supabase's OAuth authorization-code flow with PKCE. It does not load Google's login form in the app's WKWebView. The account picker lets the person choose their Google identity; an existing browser Google login may be reused.

This approach reuses the existing **web OAuth Google provider** in Supabase. It does not need a new Google iOS SDK, an iOS OAuth client ID, or any Google client secret inside the app. The Google Console's authorized redirect URI remains the Supabase HTTPS callback shown in its Google-provider settings. Do not replace that Google Console callback with the custom app URL.

Activation:

1. Confirm the correct Supabase project already has its working Google provider enabled. Preserve the website's credentials and settings.
2. Under Authentication → URL Configuration → Redirect URLs, **add** the exact URL `neighborwalk://google-auth`. Preserve all existing URLs, including `neighborwalk://auth`, and do not change the Site URL. This configuration has not been deployed by the code change.
3. Check the Google consent screen's publishing/test-user restrictions for the existing OAuth project. Use authorized test accounts until its production configuration is ready.
4. Run `npm run ios:sync`, then build/install the signed app with Xcode.
5. Open an unused shared invitation, tap Continue with Google, choose an account with a different email, and confirm Join church. Test cancellation followed by retry, expired authorization, and a revoked invitation. The new shared-invitation migration and invitation website must also be activated before the complete real invitation test can pass.

The temporary PKCE client keeps its verifier in memory, requests only normal Google sign-in, and transfers only the resulting Supabase access/refresh tokens to the existing app session. Google provider tokens are not copied into persistent app storage. Cancellation preserves the invitation and existing session. A terminated app requires starting Google sign-in again; callbacks from that flow are not accepted by the ordinary email callback handler.

Google does not inherit another account's church membership or leader permissions just because a contact label matches. A valid shared invitation can be accepted by any verified signed-in account, while existing membership and suspension rules remain enforced. Legacy email-restricted invitations remain email-restricted.

Verification: `tests/google-auth.test.ts` exercises the real Supabase SDK's PKCE challenge/verifier exchange with mocked network responses, invalid callbacks, cancellation/retry and concurrent-attempt protection. Browser tests cover Google-identity invitation acceptance and the Google button's preview behavior. These are not a completed live Google login; that requires the provider configuration and signed-device test above.

References: [Apple web authentication sessions](https://developer.apple.com/documentation/authenticationservices/aswebauthenticationsession/), [Supabase OAuth sign-in](https://supabase.com/docs/reference/javascript/auth-signinwithoauth).
