# Web social sign-in and shared invitations

The website supports Google OAuth, optional Apple OAuth, and single-use shared invitations addressed by email or phone. Invitation contact details help a leader deliver the link; the recipient may use a different verified identity, including Apple Hide My Email. A signed-in recipient sees the church and role and must explicitly choose **Join church**.

## Release order

1. Rehearse and deploy `supabase/migrations/20260919214330_flexible_church_invitations.sql` before deploying the matching web UI. It adds private storage and authenticated RPCs without changing the older email-bound invitation functions.
2. Keep the existing Google provider configured. In Supabase Authentication URL Configuration, allow the production `/login` URL and each intentional local or preview callback. The Google OAuth console callback remains the Supabase callback shown in provider settings.
3. For Apple on the web, create and verify an Apple Services ID associated with the site, configure its return URL exactly as Supabase documents, and configure the Apple provider’s client ID and rotating secret in Supabase. Add the production `/login` redirect URL in Supabase, then set `NEXT_PUBLIC_APPLE_AUTH_ENABLED=true` for the production build. Do not put the Apple private key or provider secret in a public environment variable.
4. Deploy the website and test Google and Apple with an unused invitation, a different sign-in email, Apple Hide My Email, cancellation, retry, an expired link, and a revoked link. Confirm that sign-in alone does not join the church and that the explicit confirmation does.

The local sign-in page always shows both provider controls for UI review. By default, selecting one explains that the isolated sandbox has no OAuth credentials and leaves the user on the sign-in page. A real local Google flow requires a local web OAuth client whose callback is `http://127.0.0.1:54321/auth/v1/callback`, an `[auth.external.google]` entry in `supabase/config.toml`, and its secret in a protected `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET` environment variable. Apple requires equivalent local provider configuration. Only then set `NEXT_PUBLIC_LOCAL_SOCIAL_AUTH_ENABLED=true`; never put either provider secret in a `NEXT_PUBLIC_` variable.

## Sharing behavior

Leaders can create email- or phone-addressed links and use the browser or operating system share sheet, an addressed Mail/Messages draft, or clipboard copy. NeighborWalk does not send mail or SMS and cannot claim delivery. Tokens are 256-bit random values stored only as hashes, appear only in URL fragments, expire after seven days, and are replaced when another pending invitation is created for the same contact.

Run `npm run test:invitations` for the isolated migration security checks. This focused test does not replace a full migration rehearsal against a development database containing every prior migration.

References: [Supabase Google authentication](https://supabase.com/docs/guides/auth/social-login/auth-google), [Supabase Apple authentication](https://supabase.com/docs/guides/auth/social-login/auth-apple), [Supabase OAuth sign-in](https://supabase.com/docs/reference/javascript/auth-signinwithoauth).
