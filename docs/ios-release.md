# SendMe iOS release guide

This is the current iOS release status and checklist for `codex/neighborwalk-ios`. Earlier audit, web-release, and session checkpoints are preserved in the [historical archive](archive/README.md); they are not current release instructions. Verify every external gate against its actual environment before marking it complete.

See [Apple sign-in and invitations](ios-auth-and-invitations.md) for native authentication and shared links, and [iOS remote push deployment](IOS-REMOTE-PUSH-RUNBOOK.md) for APNs activation and signed-device acceptance.

## Current release status

The app and its supporting migrations, native configuration, and tests are implemented in this branch. Local verification passed on Linux and the Mac, including a production-configured iOS simulator build. Five shared-backend migrations, both Edge Functions, and public SendMe branding with iOS policy/help additions are deployed. Apple App ID registration and native signing metadata are configured; credential activation and actual deletion fulfillment remain unverified. No signed device archive, physical-device acceptance, TestFlight distribution, or App Store submission has been completed here. The remaining release gates are:

1. Confirm Apple Developer and App Store Connect ownership, the final bundle identifier, signing, Push Notifications, and Associated Domains.
2. Restore approved public mobile configuration; configure and test Apple, Google, and email authentication callbacks on a signed iPhone. Phone-only SMS sign-in is optional.
3. Complete authenticated production acceptance for invitations, new conversation fields and deletion with dedicated test records. Preserve the deployed/source migration mapping below. The operator confirmed an existing backup; its recovery was not verified here.
4. Host the separate invitation handoff site, activate Universal Links, and configure the APNs delivery function, Apple credentials, and recurring protected invocation. Prove actual notification delivery on signed devices.
5. Staff and test account-deletion fulfillment, including Apple authorization revocation. Approve real publisher, support, privacy, retention, and shared-content handling details.
6. Test the final signed build on physical iPhone and iPad hardware, then distribute through TestFlight, address findings, and prepare App Store listing and review access.

The sections below give the implementation evidence and detailed checks for these gates. A passing local build does not close any external gate.

## Mac rebuild and SendMe rename — September 26, 2026

- Updated the iOS checkout to `fbbdfa0`; installed dependencies using Node 22.23.3. The public brand is now **SendMe**, per the user's approval for the app, invitations and website. Branding source commit: `d3996b6`.
- Apple team `RXRH5R33FV` owns registered App ID `app.neighborwalk.ios`, now described as SendMe. Push Notifications, Associated Domains and Sign in with Apple are enabled. Existing bundle IDs, URL schemes, backend formats and storage keys remain unchanged.
- Configured the Xcode signing team and Associated Domain `applinks:neighborwalk-invites.vercel.app`. Restored public production mobile configuration locally; no secrets or local environment files are committed.
- The separate invitation project serves `/invite` and the Apple association file successfully without a redirect. Its clean-URL rewrite now targets `/`. Current deployment: `dpl_58AHPoGAbxwcGq3XQbageddboe6i`.
- Public website branding and approved operator/support identity (Jacob Haney; jacobbhaney@icloud.com) are deployed at https://neighborwalk-pilot.vercel.app. Production release source is `2cb3330` on `codex/sendme-web-release`, based on the previously deployed web version plus `70e90b9`; unrelated newer web features were not deployed. Deployment: `dpl_2UeDP2XsoDGNVpwsTScMUKxWoK5a`.
- The same public rename was ported with `cherry-pick -x` to the current web source branch, preserving its newer sign-in flow; `8a105dc` and `74afe9b` include the additional invitation-sharing copy. That branch separately passes lint/typecheck, 29 relevant tests across focused runs, and the production build.
- Supabase `push-delivery` version 2 renders fixed SendMe notification copy while accepting legacy database claims. APNs credentials and scheduling remain pending; the production-only, topic-restricted “SendMe Push” key review is prepared in Apple Developer but has not been registered. Creating/configuring it awaits the user's confirmation.
- Passed iOS lint/typecheck, 44 relevant unit tests, 4 Chromium mobile navigation/responsive checks (320/393/768px), sample build, production `ios:sync`/bundle verification, and Xcode simulator build. Installed and opened SendMe in the iPhone 18 Pro / iOS 27 simulator. Separately passed deployed-web lint/typecheck, 24 relevant unit tests and Next.js build. Inspected the app sign-in page, web homepage, invitation page and native app rendering.
- `ios:release:check` now passes public configuration, native metadata, and live invitation/AASA checks. Privacy/help/terms remain blocked by draft policy notices. The user approved publisher/contact details, but record/backup retention and ownership of the proposed 30-day deletion process still need confirmation. Do not mark policies approved or open enrollment merely to pass this check.
- Supabase organization `ehsjqvpajmtlfdrlymce` is on the Free plan. Off-site backup retention and recovery remain unverified. The user indicated they would handle deletion as the solo developer and requested clarification; this is not approval of a fixed retention period or deadline. Apple permits manual processing with an in-app request, disclosed completion time and completion confirmation.
- The native bundle records production configuration; that marker alone does not prove APNs activation, signed-device acceptance, account deletion, TestFlight or App Store readiness. Those external gates remain open.

## Linux release preparation — September 23, 2026

Native/release implementation commit: `ef1ffdd`. Public content source: `70e90b9`.
These commits are local; no Git branches were pushed. Current documentation
edits remain alongside the pre-existing documentation reorganization.

Implemented and partially deployed after the audit below. The five backend
migrations and both Edge Functions are now deployed. Apple credentials, push
scheduling, deletion fulfillment and native acceptance remain incomplete.

- Deletion now uses the `account-deletion` Edge Function. It validates the live
  Supabase account/session, reauthorizes the same Apple identity, exchanges the
  one-use native authorization code server-side, verifies the returned Apple JWT
  signature/issuer/audience/subject/nonce/expiry, and revokes the refresh token.
  Apple tokens and codes are not persisted or logged. A private request receipt
  records successful revocation; server-side retries are limited to once per minute.
  A failed Apple operation leaves the request queued and displays a retry message.
- The same deletion control is now available on the locked-workspace screen.
  Settings and invitation-required screens retain their existing entry points.
  The UI still describes a manual deletion process: **actual account/content
  erasure and completion confirmation are not automated or proven by this change**.
- `npm run deletion:inventory -- --help` documents the operator-only, read-only
  queue/deadline and reference-count inventory. It discovers foreign keys to Auth
  users and church memberships, and explicitly lists JSON/history/exports/storage
  review areas that counts cannot prove erased. It does not expose email, Apple
  tokens or record contents and does not certify deletion completion.
- `mobile/.env.example` is a public-only configuration template. Production builds
  now require distinct, explicit `NEXT_PUBLIC_INVITE_ORIGIN` and
  `NEXT_PUBLIC_SERVICE_ORIGIN`, and reject secret/service-role keys placed in the
  publishable-key variable. Both origins are recorded in bundle provenance.
- `npm run ios:configure` writes the actual team and invitation Associated Domain
  once `APPLE_TEAM_ID` and the invitation origin are supplied. APNs entitlements
  and Debug/Release environment settings are included. The Xcode Release guard
  also checks team, APNs, app identifier and the matching Associated Domain.
- `npm run ios:release:check` checks public configuration, native metadata, the
  live invitation page/AASA and policy/help/terms draft notices. Release preparation
  runs this before building/syncing. It cannot certify legal approval, Apple portal
  ownership, backend activation or physical-device behavior.
- `npm run ios:release:rehearse -- nw_restore_TIMESTAMP_ID` rehearses pending iOS
  migrations on a verified local restore, compares original table data and runs
  APNs SQL permission/delivery checks, then rolls everything back. It rejects
  historical migration mismatches and accepts only local `nw_restore_*` databases.
- Browser suites now write separate artifact directories and invitation tests can
  select `INVITATION_TEST_PORT`, avoiding collisions with another active preview.

- Public iOS permission/deletion information is in focused commit `70e90b9`,
  ported separately to the website. Public operator/contact approval remains
  pending; the user authorized website and compatible backend release work.

### Hosted rollout — September 23, 2026

The user confirmed they hold a backup and explicitly directed the production
changes to proceed. That backup was **not inspected or restore-verified here**.
The local fictional backup evidence below remains separate.

Reviewed SQL was applied individually through Supabase to `llhrbtlkcneldgrhkwpf`;
no historical migrations were replayed and no account/content erasure was run.
The hosted tool assigns deployment timestamps, so retain this mapping and do not
blindly run `db push` against the mismatched historical ledger:

| Local source version | Hosted version | Migration |
| --- | --- | --- |
| 20260919191901 | 20260924034149 | mobile_account_deletion_requests |
| 20260919214330 | 20260924034351 | flexible_church_invitations |
| 20260922024213 | 20260924034356 | add_apns_push_delivery |
| 20260923010000 | 20260924034402 | community_conversation_details |
| 20260924032218 | 20260924034407 | account_deletion_fulfillment |

- `account-deletion` and `push-delivery` are deployed, version 1. Their own
  bearer/session and worker-secret checks are used (`verify_jwt=false`).
- Live anonymous deletion POST returned **401**. Push POST returned **503,
  not configured**: APNs keys/worker configuration are still required. No Apple
  request, push, email or account deletion was sent by these checks.
- All four new private tables have RLS and no direct anon/authenticated read
  privilege. Worker/revocation RPCs are service-role only; user RPCs exclude anon.
  Both new encounter columns are present.
- Post-deployment security advisors add the expected four private-table
  RLS-without-policy notices and two authenticated APNs RPC notices. APNs RPCs
  require a live session and bind registrations to the account. Existing map RPC
  notices and disabled leaked-password protection remain. References:
  [RLS notices](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy),
  [function notices](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable),
  [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

- Public `/privacy` and `/help` updates are live at
  `https://neighborwalk-pilot.vercel.app` in Vercel deployment
  `dpl_E9PdjMUxJck2tRYPRKaenJEhEnfJ`. Publication used isolated branch
  `codex/ios-public-policy-release` (`d6b0a79`) based on the exact prior deployed
  commit `8b307fd`; it does not deploy unrelated pending web changes. The same
  focused source commit is ported to the web development branch as `3ee5fc4`.
  Both web checkouts passed lint/typecheck, seven relevant tests and production
  builds. Phone/desktop policy rendering was inspected. Draft notices remain;
  the private iCloud address was not published. Final approval/support details
  remain required for App Store submission.

- Shared Edge Function/migration source and 14 passing backend security tests
  are also ported to the web development checkout as a separate backend-only
  commit. Its lint/typecheck and production build passed; this source port does
  not publish the pending web social-sign-in interface.

### Remaining configuration and acceptance

1. Supply the approved publisher name, support/request email, deletion fulfillment
   owner and approved retention/shared-content handling. Website and compatible backend release work are authorized. The sole
   developer will own deletion requests; the public legal identity remains pending. The user will create a dedicated
   support address; do not publish the private iCloud account address. These are operator decisions, not Mac-only tasks.
2. Supply the actual Apple team, stable invitation/service hosts and server-side
   Apple Sign in key configuration through the protected local/provider workflow.
   Do not send credentials in chat. Configure Apple/Google callbacks and mail/relay
   delivery without replacing existing website settings.
3. Preserve the hosted/source migration mapping above for future deployments.
   Inspect and rehearse the operator-held recovery point before the next release.
4. Configure the deployed Edge Functions with the actual Apple credentials and
   protected push worker/scheduler settings. Deployment alone does not activate them.
5. For `account-deletion`, use Supabase's server `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY`, plus `APPLE_TEAM_ID`, `APPLE_KEY_ID`,
   `APPLE_CLIENT_ID=app.neighborwalk.ios`, and `APPLE_PRIVATE_KEY_PKCS8_BASE64`
   (base64 DER PKCS#8, not the PEM text). Use a key enabled for Sign in with Apple;
   APNs credentials are a separate capability. The function checks the bearer
   identity and database session itself; its config uses `verify_jwt=false`.
6. Run an operator rehearsal on a dedicated test account: request, inspect queue,
   erase associated content under the approved policy, revoke sessions, delete Auth,
   verify denied access and send completion confirmation. Verify Hide My Email
   delivery and any Apple reauthorization after the initial request; an earlier
   revocation receipt alone cannot establish that no later authorization exists.
   Keep phone-only signup disabled until there is a tested confirmation channel.
7. Fill public mobile configuration, run `ios:configure`, then
   `ios:release:check` and `ios:release:prepare`. The check currently correctly
   reports missing invitation configuration and signing team.
8. On the Mac: verify provisioning/capabilities, compile native bridges and the
   Release guard, run simulator tests, install on physical iPhone/iPad, complete
   offline/auth/deletion/notification/accessibility acceptance, then TestFlight.

### Fresh evidence

- The encrypted fictional local backup restored **63 tables / 12,243 records**
  with exact digests and column/RLS comparisons; nine permission/workflow suites
  passed against the restore. Private report:
  `/tmp/neighborwalk-backup-drill-J4t6sa/verified-report.json`.
- The new fulfillment migration was rehearsed on
  `nw_restore_20260924032644_026e39e5`: all **61 original public/private/Auth
  tables** remained unchanged and APNs SQL checks passed, followed by rollback.
  The restored baseline already contains the prior four iOS migrations; this is
  not a fresh production-baseline rehearsal of those migrations. The older full
  normalization rehearsal could not start because its historical database is absent.
- Shared-invitation SQL harness and all 13 local database suites passed. Deno
  checking/linting of the new Edge Function passed. Sample bundle build passed.
- Node 22 lint/typecheck passed; **80 unit/integration files / 398 tests** passed
  with two workers. One earlier concurrent run hit a PGlite setup timeout.
  All **24 Chromium and 24 WebKit** mobile tests passed, plus all **7 invitation
  browser tests**. WebKit ran in the official Playwright 1.63.0 Noble container
  using the existing rootless Docker socket; no host packages were installed.
  The WebKit run exposed a sample-date timezone bug, fixed in `lib/seed.ts` with
  a regression test. `npm run test:mobile:webkit:container` reproduces that check.
  The deletion confirmation and success sheets were rendered and visually inspected
  at 393px. Browser tests mock provider/backend responses; they send no mail/SMS,
  contact no Apple authorization endpoint and create no production accounts.
- Read-only inspection of the live progress RPC definitions confirmed their
  live-session and tenant/role predicates. Planning parcel/street RPCs require
  active membership and bound geometry/result size. Their advisor exposure notices
  are not evidence of unrestricted church data. Leaked-password protection still
  needs an operator/provider configuration decision.

## App Store readiness audit — September 23, 2026

**Decision: not ready for submission.** This audit inspected the iOS source,
native project, current public privacy page, and read-only metadata from the
live `neighborwalk` Supabase project (`llhrbtlkcneldgrhkwpf`). It did not deploy
anything or verify Apple Developer/App Store Connect configuration. Existing
documentation edits were preserved. The findings below supersede older claims
where they differ.

### Confirmed blockers and required acceptance evidence

| Priority | Finding and evidence | What closes it |
| --- | --- | --- |
| Blocker | **Deletion cannot currently be requested in production.** `components/AccountDeletion.tsx` invokes `request_account_deletion`; live schema inspection found no such function. The local migration only queues requests. No Apple token-revocation implementation was found; `ios/App/App/SceneDelegate.swift` returns an identity token/name without an authorization-code exchange. | Deploy the reviewed deletion migration; implement and rehearse account/content erasure, session revocation, Apple authorization revocation, and confirmation delivery. Assign an operator and prove the disclosed 30-day process with a dedicated account. |
| Blocker | **The shared backend is behind the iOS client.** Live migration history ends at `20260915024430_add_outing_participants`. It lacks `20260919191901_mobile_account_deletion_requests`, `20260919214330_flexible_church_invitations`, `20260922024213_add_apns_push_delivery`, and `20260923010000_community_conversation_details`. The conversation UI already submits place/needs fields that require the last migration. Several older local/remote migration timestamps also differ. | Reconcile migration history, rehearse backup/restore and the intended migration set in staging, then deploy through a shared-backend release. Verify persistence after reload, invitations, deletion, and compatibility with the website and older clients. Do not blindly push all local migrations. |
| Blocker | **Push delivery is inactive and signing configuration is incomplete.** Live Edge Functions contain only `parcel-import`, with no `push-delivery`. `App.entitlements` contains Sign in with Apple only: no `aps-environment` or Associated Domains entitlement. The Xcode project has no committed development team. | Confirm developer account/bundle ownership; configure signing and capabilities; deploy APNs migration/function/secrets/scheduler; prove registration, closed-app delivery, and notification routing on a signed production-environment build. APNs is required by this project's release guard, rather than universally required by Apple. |
| Blocker | **The current native bundle is sample-only.** `mobile/.env.production.local` is absent on this machine; `ios/App/App/public/build-provenance.json` declares `channel: sample`, `releaseEligible: false`, and sandbox/no remote push. | Restore approved public production configuration, run `npm run ios:release:prepare`, verify provenance, and validate the resulting signed archive. Keep provider secrets server-side. |
| Blocker | **Public policy/support material is unfinished.** The actual `/privacy` URL opened by the app still displays a draft notice, unapproved legal operator identity, and a pending operator request channel. `lib/mobile.ts` hardcodes `https://neighborwalk-pilot.vercel.app` for these pages. | Publish approved operator/contact details, retention/deletion commitments and an iOS-accurate policy/support experience at the URLs the binary opens. A change to the separate website needs its own authorized release. |
| Required verification | **Authentication and invitation handoff are not proven on a signed device.** Native Apple/Google code exists, but provider settings and mail delivery were not verified. The dedicated invitation origin is not required by the Vite build checks, so a successful build does not validate its deployment. | Verify Apple, Google, email confirmation/recovery and link sign-in; host the invitation handoff and AASA file, configure Associated Domains, and test fresh install, cold launch, expired link, and accepting with a different verified account. Include Apple Hide My Email and confirmation delivery. |
| Required verification | **No final native/device acceptance evidence.** This host has no `xcodebuild`. The app targets both iPhone and iPad and iOS 15+. | Compile/test/archive on a Mac, exercise physical iPhone/iPad and the oldest supported OS, then run a TestFlight acceptance pass. Cover offline/reconnect data integrity, role boundaries, permissions, deep links, sharing/printing, VoiceOver, large text, and keyboard/layout behavior. |
| Submission gate | **App Store Connect readiness is unknown.** Account, agreements, listing, screenshots, privacy answers, age rating, territories, export-compliance answers and review credentials were not accessible in this audit. | Complete the listing with real screenshots and a fictional reviewer church/account; keep all backend services available during review. Review the archive privacy report and label contact/user identifiers, user content, sensitive information and applicable location/device identifiers according to actual collection. |

### Additional review risks

- **Shared user content:** no dedicated abuse-reporting or objectionable-content
  filtering workflow was found in the inspected application source. Leader access
  removal is not by itself evidence that all moderation requirements are met.
  Evaluate the private church-sharing model against guideline 1.2 and implement
  appropriate reporting, handling, blocking and published contact mechanisms, or
  document a defensible applicability assessment before submission.
- **Live security advisories:** the current Supabase advisor reports leaked-password
  protection disabled, two anonymous and six authenticated `SECURITY DEFINER`
  exposure findings, and seven informational RLS-without-policy findings. These
  are findings to triage, not proof of unauthorized data access. The public map
  RPCs appear deliberately public in the migration source. Confirm live function
  boundaries and record accepted exceptions; review enabling compromised-password
  protection. Earlier “no issues” evidence does not describe this live result.
- **Startup performance:** the sample build succeeds but warns about roughly
  1.08 MB application and 0.98 MB map JavaScript chunks before gzip. Measure cold
  startup and map interaction on the oldest supported physical device before
  deciding whether splitting is necessary.

### Fresh verification and limitations

- Node 22.23.2: lint and typecheck passed; all 75 unit/integration files passed
  with **378 tests**. The sample mobile build passed, with Vite directive and
  large-chunk warnings. Production dependency audit reported zero known vulnerabilities.
- All **24 Chromium mobile browser tests passed** using
  `CHROME_EXECUTABLE=/usr/bin/chromium npm run test:mobile -- --project=chromium`.
  The initial attempt could not launch because the Playwright-managed executable
  was absent; the successful rerun used installed Chromium.
- `npm run ios:verify-bundle` rejected the current sample native bundle as
  expected. This confirms the release guard, not production-build readiness.
- WebKit could not launch because host libraries (`libicu74`, `libxml2`,
  `libflite1`) are missing; it stopped after the first launch failure. No claim
  of WebKit, simulator, physical-device, archive, or TestFlight success is made.
- Live checks read migration metadata, function presence, Edge Function inventory,
  security advisories and the public privacy page. They did not create accounts,
  send notifications, request deletion, inspect private church records, or test
  authenticated production workflows. Full SQL migration/restore rehearsals were
  not rerun during this audit.

Apple currently requires uploads to use Xcode 26 or later with the iOS 26 SDK
or later; that SDK minimum does not itself require raising the app's iOS 15
deployment target. See [Apple's SDK requirement](https://developer.apple.com/news/upcoming-requirements/?id=04282026a).
Manual deletion can be acceptable with a disclosed timeframe and completion
confirmation, but actual erasure and Apple token revocation remain necessary:
[Apple account deletion guidance](https://developer.apple.com/support/offering-account-deletion-in-your-app/).
Review shared content, completeness, privacy and review access against the
[App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/).

Recommended order: settle publisher/privacy and deletion ownership; implement
deletion/revocation and resolve content-moderation decisions; stage and deploy
the compatible backend; activate auth/invitations/APNs; produce and test the
signed release; finish TestFlight and App Store submission materials.

## What was built

A separate, locally bundled Capacitor iOS app, with the existing React workspace and Supabase access controls, iOS-only styling, an app icon, launch screen, deep-link authentication, native export/share sheets, AirPrint, haptic tab selection, privacy-safe APNs alerts and local reminders, and app-switcher privacy protection. The landing page is not packaged. The app starts at `/app/today`, showing sign-in when necessary.

The website is maintained in the separate `rework/church-ready-neighborwalk` worktree. Native work stays on `codex/neighborwalk-ios`; the authorized shared backend and public policy rollout is recorded above. Signing in to a real account in the production iOS build **does use the live shared church database**. The sample workspace uses fictional data and a separate local store.

This is a working local build, not an approved or submitted App Store release. Apple decides acceptance. Complete the release requirements below before uploading.

## Earlier baseline verification (superseded by fresh evidence above)

- Node 22.23.2 TypeScript and ESLint checks passed.
- 75 unit/integration files passed with 373 tests, including native routing,
  connectivity, local and remote notifications, release provenance, account
  deletion authorization, migration selection, and APNs delivery security.
- The shared-invitation security harness passed. The complete migration set was
  rehearsed against local PostgreSQL and rolled back successfully with all 35
  protected source records unchanged.
- All 20 Chromium mobile flows passed, covering 320/393/768px phone/tablet
  layouts, 834/1024px simulated iPad safe areas, keyboard focus, 44pt targets,
  appearance persistence, navigation, walk sheets, map returns, and creation.
- The existing Next.js production build and sample mobile bundle passed. The
  native project synced all nine Capacitor plugins, including local and push
  notifications. The Release archive guard correctly rejected that sample
  bundle, as designed.
- The APNs worker passed Deno type-check/lint and ES256 sign/verify checks; the
  database advisors reported no issues. Production npm dependencies reported
  zero known vulnerabilities.

This verification ran on Linux. Xcode is not installed, so the current changes
have not yet been compiled by Swift/Xcode, signed, run on a simulator or physical
device, or archived. Previously documented simulator and unsigned-archive runs
predate this final pass and are not substitutes for the signed-device and
TestFlight acceptance checklist below. The later WebKit run above uses a
container because the host browser libraries are unavailable.

Native test: `xcodebuild -project ios/App/App.xcodeproj -scheme App -destination 'platform=iOS Simulator,name=iPhone 17 Pro' CODE_SIGNING_ALLOWED=NO test` after `npm run ios:sync`. Browser tests: `npm run test:mobile` after `npx playwright install chromium`.

## First-time Xcode steps

1. Enroll in the paid Apple Developer Program if necessary. Add that Apple ID in Xcode Settings → Accounts.
2. Run `npm ci`, restore the approved public production configuration in ignored `mobile/.env.production.local`, run `npm run ios:release:prepare`, then `npm run ios:open`. Node 22 is required. Never add service-role or provider secrets to the mobile environment. The release preparation command builds, syncs, and verifies the production provenance marker.
3. Select the **App** target, then **Signing & Capabilities**. Select your team, enable automatic signing, and add **Push Notifications**. `app.neighborwalk.ios` is the proposed bundle identifier; verify ownership/availability before the first upload, and update it in the native project, `capacitor.config.ts`, the APNs topic, and Supabase/Apple provider settings if necessary.
4. Choose an iPhone simulator or connected iPhone and press Run. Use **Explore sample workspace** to try fictional records without an account. A real account needs a church invitation and should be tested only with authorized test records.
5. Once the requirements below are complete, select a generic iOS device, choose Product → Archive, then Organizer → Distribute App → App Store Connect. Start with TestFlight.
6. Create the App Store Connect listing, add genuine screenshots from the final build, fill in app privacy and age-rating questionnaires, give the reviewer access, and submit.

Xcode project: `ios/App/App.xcodeproj`. The project uses Swift Package Manager; CocoaPods is not required. Native dependencies are pinned through npm and the resolved Swift package file.

## Release requirements that are not completed automatically

### Account deletion

`supabase/migrations/20260919191901_mobile_account_deletion_requests.sql` is **deployed** under the hosted version mapped above. It adds a private deletion-request queue and an authenticated, idempotent RPC. It does not remove or change any existing church tables. Its tests cover permissions, live identity requirements, repeat requests, separation between accounts, and deadline calculation; it also passed the full local migration rehearsal.

The additive migration and hosted advisors have been run. Before release, rehearse authenticated deletion fulfillment with a dedicated test account. Do not merge the iOS UI into the website just to deploy this migration.

The operator must establish and test a real fulfillment process **before accepting requests**. Settings → Delete account records an actual request with a 30-day deadline; completion is manual. Apple explicitly allows manual processing when the timeframe is disclosed and completion is confirmed. It does not allow an email-only support detour or mere account deactivation.

Operational requirements:

- Assign an owner to check `private.account_deletion_requests` daily and complete each request before `due_at`. Read the queue using a privileged server connection only. Never put the service-role key in the app.
- Identify and erase the person's account and associated personal/created content across auth, memberships, invitations, guides, normalized outreach records, legacy snapshots, reminders and retained exports, subject only to documented legal retention. Existing restrictive foreign keys mean a simple `auth.admin.deleteUser` is not a complete solution. Do not silently retain all shared content just because deleting it is inconvenient.
- Revoke active sessions, remove access, and send confirmation to the account email captured securely before deleting the auth record. Explain any legally required retention and its duration.
- Account deletion does not remotely wipe device caches. Include device cleanup guidance; the user can remove the app from each device after shared work is resolved. Do not erase pending fieldwork when merely submitting a request.
- Test the full process with a dedicated account before submission. Until fulfillment is staffed and verified, this remains a release blocker.

### Authentication and invitations

Add the exact callback `neighborwalk://auth` (and the trailing-slash form emitted by the configured auth template if applicable) to Supabase Auth's allowed redirect URLs as a separately reviewed configuration change. Test account confirmation, password reset and email-link sign-in on a physical iPhone, both with the app running and fully closed. The app validates the callback scheme/host before passing it to Supabase.

The native app includes Sign in with Apple, Google through the iOS system authentication sheet, email/password, email links, and optional phone-code sign-in. Apple and SMS providers still need configuring. Shared invitations can be addressed to a phone number or email and accepted by a different signed-in account. Legacy email-bound invitations keep their existing behavior. See [the activation guide](ios-auth-and-invitations.md) for the additive database migration, separately hosted invitation page, Universal Links setup and Apple token revocation required for deletion. No associated-domain deployment was made here.

### Notifications

The native client, private APNs token/outbox migration, and Supabase Edge Function are implemented and locally tested. They are not active until the Apple Push capability/provisioning, Edge Function secrets, and recurring worker invocation are configured. Follow [the notification activation guide](IOS-REMOTE-PUSH-RUNBOOK.md). The final release bundle is deliberately rejected unless its public build configuration enables production APNs; Apple credentials and the worker secret remain server-only.

### Public policies and support

Confirm the legal publisher name, support email, privacy policy, and terms before release. The current website has operator-controlled policy/enrollment gates; this change does not approve those policies or invent a publisher identity. The native app opens policy/help pages in the system browser sheet. Verify those pages have real contact details and no draft notices.

Shared church notes and optional faith/relationship fields can contain sensitive information. Review the privacy policy and App Store privacy labels against actual backend use, retention and third-party map/geocoding/Scripture services. Disclose contact information, user identifiers, user content and sensitive information where applicable. Review location disclosures based on whether the service retains coordinates and whether they are linked to users. Do not mark “Data Not Collected” merely because the binary has no advertising SDK.

`PrivacyInfo.xcprivacy` declares no tracking and the required-reason APIs used by local export files and native preferences. This is not a substitute for the App Store privacy questionnaire. Review the Xcode archive's privacy report with the final SDK versions.

### Review access and testing

Provide a dedicated reviewer account with realistic fictional records and access to all relevant roles/features. The device-only sample is useful for exploration but does not demonstrate authenticated synchronization, invitations, or deletion fulfillment. Do not supply real neighbor data to App Review.

Before release, physically test: sign-in/out, email recovery, invitation acceptance, permissions, map location denial/approval, enabling/denying notifications, closed-app invitation and assignment alerts, accepted follow-up and walk reminders and every notification tap, starting a walk, encounter capture, follow-up assignment/reassignment, airplane-mode editing and reopening, reconnect sync, sharing a file, AirPrint, deletion request and completion, large text, VoiceOver, and both iPhone and iPad layouts. Maps and remote Scripture need a connection; bundled UI and previously authorized cached records can work offline within the existing access policy.

App Review guideline 4.2 considers the whole app experience; native integrations alone do not guarantee approval. Explain its real fieldwork functionality and offline workflows. Review guideline 1.2 against church-shared user content and establish appropriate abuse-reporting/moderation policies before wider public enrollment.

## Suggested listing draft

- Name: **NeighborWalk**
- Subtitle: **Walk together. Follow through.** (30 characters)
- Category: **Productivity**
- Description: “NeighborWalk helps church teams organize neighborhood walks and follow through with care. See your next walk, find your assigned area, record conversations, and keep requested follow-ups with a clear owner. Prepare your workspace before heading out, save fieldwork on your device when a connection drops, and share changes when you reconnect. A church invitation is required for shared workspaces. A separate sample workspace lets you explore with fictional records.”
- Review notes: Describe how to sign in to the review church, start its sample outing, record an encounter, view People and Guides, export sample data, and find Settings → Delete account. Supply the tested account and explain the manual deletion deadline.

Do not publish claims of Apple approval, guaranteed notification delivery, offline maps, or background tracking. Claim closed-app invitation/assignment alerts only after the production APNs acceptance checklist has passed.

## Submission material prepared for operator review

The listing draft above uses a 30-character subtitle. Proposed keywords (82
characters): `church,outreach,neighborhood,volunteer,walk,follow-up,care,team,community,planning`.
Confirm the final business/distribution terms and territories in App Store Connect.
No in-app purchase or paid entitlement is implemented in this branch.

Capture these four scenes using fictional review records in the final signed build:
Home with the next walk and due follow-up; a prepared walk/map; logging a
conversation; and People with an owned follow-up. Capture both phone and tablet
layouts because the target supports both. Do not submit browser screenshots as
native-device evidence. Apple's current screenshot guidance permits 1–10 images;
prepare a supported large iPhone size and the required 13-inch iPad set, checking
the exact pixel dimensions at upload:
[Apple screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications).

Proposed review notes, to complete with credentials **in App Store Connect only**:

> NeighborWalk is an invitation-based church fieldwork tool. The review accounts
> belong to a dedicated fictional church. Sign in with the supplied leader account,
> open Walks, open its prepared walk and start fieldwork. Record a fictional
> conversation, then open People to inspect and complete an assigned follow-up.
> A second volunteer account is supplied for assignment/acceptance checks. More →
> Settings contains account deletion. A signed-in account without church access
> can also initiate deletion. Deletion is fulfilled within the disclosed 30 days;
> Apple users confirm their Apple identity for revocation. The sample workspace
> uses separate fictional device data. Maps require connectivity; cached authorized
> fieldwork can be edited offline and synchronized after reconnecting.

Do not submit these notes until the described services and accounts have actually
been tested. No reviewer credentials were created by the Linux preparation work.

Privacy-label working inventory (requires operator approval and provider review):

| Implementation | Candidate disclosure and decision |
| --- | --- |
| Auth email, optional phone, display name; neighbor contact fields | Contact information; linked app-functionality data. Review which fields describe users versus their submitted church records. |
| Supabase user UUID, APNs token and installation ID | User/device identifiers linked to app functionality; not advertising identifiers. |
| Encounters, notes, guides, follow-ups and submitted addresses | Other User Content plus structured contact/location categories as applicable. |
| Optional faith fields and structured health/needs selections | Assess Sensitive Info and Health categories for intentionally collected structured fields. Generic free-text notes fall under Other User Content; do not invent HealthKit collection. |
| Map/geocoding requests and saved location coordinates | Review precise/coarse location, provider retention and account linkage; a device permission alone does not answer collection questions. |
| Hosting/auth/function logs and failures | Determine whether retained provider logs qualify as diagnostics, identifiers or other data and document retention. |

No tracking/advertising SDK was introduced. Verify third-party behavior and the
archive privacy report before making the final tracking and collection answers.
[Apple privacy-label definitions](https://developer.apple.com/app-store/app-privacy-details/).

Shared-content release decision remains open. Church roles and access removal
limit audience, but do not establish offensive-content reporting/filtering or
operator response procedures. The publisher must approve the moderation model
and its applicability assessment; do not mark guideline 1.2 resolved merely
because enrollment requires an invitation.

## Maintaining the two apps

Keep web releases and iOS releases independent. `npm run build` produces the website; `npm run ios:release:prepare` builds, copies, and verifies the App Store-eligible bundle in Xcode. The Xcode Release target rejects sample or missing provenance, including a sample bundle left by a prior `cap sync`. Increment the Xcode build number for every upload. Updates to bundled UI ship through App Store review, not by pointing the native app at a new website URL. Keep backend changes compatible with both existing web clients and already-installed iOS versions.

References: [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), [Apple account deletion guidance](https://developer.apple.com/support/offering-account-deletion-in-your-app/), [Capacitor iOS](https://capacitorjs.com/docs/ios).
