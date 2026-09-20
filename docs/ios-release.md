# NeighborWalk iOS release guide

See [Apple sign-in and invitations](ios-auth-and-invitations.md) for the new native authentication, shared invitation flow, separate link hosting, and remaining activation requirements.

## What was built

A separate, locally bundled Capacitor iOS app, with the existing React workspace and Supabase access controls, iOS-only styling, an app icon, launch screen, deep-link authentication, native export/share sheets, AirPrint, haptic tab selection, and app-switcher privacy protection. The landing page is not packaged. The app starts at `/app/today`, showing sign-in when necessary.

The website remains on `main`. Work is isolated on `codex/neighborwalk-ios`. No website deployment or production database change has been made. Signing in to a real account in the production iOS build **does use the live shared church database**. The sample workspace uses fictional data and a separate local store.

This is a working local build, not an approved or submitted App Store release. Apple decides acceptance. Complete the release requirements below before uploading.

## Verification performed

- TypeScript and ESLint passed.
- 329 unit tests passed, including native route boundaries and callback replay protection.
- Four mobile browser tests passed at 320, 393 and 768 pixels, including persistent sample data and tab navigation.
- The installed app passed an XCUITest on iPhone 17 Pro / iOS 26.5.
- An unsigned Release archive for physical iOS devices succeeded at `outputs/ios/NeighborWalk.xcarchive`. It must be rebuilt/signed with your Apple Developer team before distribution.
- The existing Next.js website production build passed.
- Production npm dependencies reported no known vulnerabilities at the time of verification. The Capacitor development CLI has three moderate transitive audit findings; do not apply a forced downgrade automatically.
- Deletion-queue SQL was tested in isolated PGlite/PostgreSQL, not against production or the complete local Supabase schema. Full authentication, live synchronization, physical-device permissions, and deletion fulfillment remain release checks.

Native test: `xcodebuild -project ios/App/App.xcodeproj -scheme App -destination 'platform=iOS Simulator,name=iPhone 17 Pro' CODE_SIGNING_ALLOWED=NO test` after `npm run ios:sync`. Browser tests: `npm run test:mobile` after `npx playwright install chromium`.

## First-time Xcode steps

1. Enroll in the paid Apple Developer Program if necessary. Add that Apple ID in Xcode Settings → Accounts.
2. Run `npm ci`, `npm run ios:sync`, then `npm run ios:open`. Node 22 is required. The production public Supabase settings are in ignored `mobile/.env.production.local` on this machine; retain them when moving the project.
3. Select the **App** target, then **Signing & Capabilities**. Select your team and enable automatic signing. `app.neighborwalk.ios` is the proposed bundle identifier; verify ownership/availability before the first upload, and update it both here and in `capacitor.config.ts` if necessary.
4. Choose an iPhone simulator or connected iPhone and press Run. Use **Explore sample workspace** to try fictional records without an account. A real account needs a church invitation and should be tested only with authorized test records.
5. Once the requirements below are complete, select a generic iOS device, choose Product → Archive, then Organizer → Distribute App → App Store Connect. Start with TestFlight.
6. Create the App Store Connect listing, add genuine screenshots from the final build, fill in app privacy and age-rating questionnaires, give the reviewer access, and submit.

Xcode project: `ios/App/App.xcodeproj`. The project uses Swift Package Manager; CocoaPods is not required. Native dependencies are pinned through npm and the resolved Swift package file.

## Release requirements that are not completed automatically

### Account deletion

`supabase/migrations/20260919191901_mobile_account_deletion_requests.sql` is **not deployed**. It adds a private deletion-request queue and an authenticated, idempotent RPC. It does not remove or change any existing church tables. Its isolated PostgreSQL tests cover permissions, identity, repeat requests, separation between accounts, and deadline calculation.

Before release, apply it first to the full local Supabase sandbox and run database tests/advisors. Review the additive migration, then deploy it as a separate backend release. Do not merge the iOS UI into the website just to deploy this migration.

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

### Public policies and support

Confirm the legal publisher name, support email, privacy policy, and terms before release. The current website has operator-controlled policy/enrollment gates; this change does not approve those policies or invent a publisher identity. The native app opens policy/help pages in the system browser sheet. Verify those pages have real contact details and no draft notices.

Shared church notes and optional faith/relationship fields can contain sensitive information. Review the privacy policy and App Store privacy labels against actual backend use, retention and third-party map/geocoding/Scripture services. Disclose contact information, user identifiers, user content and sensitive information where applicable. Review location disclosures based on whether the service retains coordinates and whether they are linked to users. Do not mark “Data Not Collected” merely because the binary has no advertising SDK.

`PrivacyInfo.xcprivacy` declares no tracking and the required-reason APIs used by local export files and native preferences. This is not a substitute for the App Store privacy questionnaire. Review the Xcode archive's privacy report with the final SDK versions.

### Review access and testing

Provide a dedicated reviewer account with realistic fictional records and access to all relevant roles/features. The device-only sample is useful for exploration but does not demonstrate authenticated synchronization, invitations, or deletion fulfillment. Do not supply real neighbor data to App Review.

Before release, physically test: sign-in/out, email recovery, invitation acceptance, permissions, map location denial/approval, starting a walk, encounter capture, follow-up assignment, airplane-mode editing and reopening, reconnect sync, sharing a file, AirPrint, deletion request and completion, large text, VoiceOver, and both iPhone and iPad layouts. Maps and remote Scripture need a connection; bundled UI and previously authorized cached records can work offline within the existing access policy.

App Review guideline 4.2 considers the whole app experience; native integrations alone do not guarantee approval. Explain its real fieldwork functionality and offline workflows. Review guideline 1.2 against church-shared user content and establish appropriate abuse-reporting/moderation policies before wider public enrollment.

## Suggested listing draft

- Name: **NeighborWalk**
- Subtitle: **Walk together. Care personally.**
- Category: **Productivity**
- Description: “NeighborWalk helps church teams organize neighborhood walks and follow through with care. See your next walk, find your assigned area, record conversations, and keep requested follow-ups with a clear owner. Prepare your workspace before heading out, save fieldwork on your device when a connection drops, and share changes when you reconnect. A church invitation is required for shared workspaces. A separate sample workspace lets you explore with fictional records.”
- Review notes: Describe how to sign in to the review church, start its sample outing, record an encounter, view People and Guides, export sample data, and find Settings → Delete account. Supply the tested account and explain the manual deletion deadline.

Do not publish claims of Apple approval, guaranteed delivery, offline maps, background tracking, or push notifications; those are not included.

## Maintaining the two apps

Keep web releases and iOS releases independent. `npm run build` produces the website; `npm run ios:sync` builds/copies the app bundle into Xcode. Increment the Xcode build number for every upload. Updates to bundled UI ship through App Store review, not by pointing the native app at a new website URL. Keep backend changes compatible with both existing web clients and already-installed iOS versions.

References: [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), [Apple account deletion guidance](https://developer.apple.com/support/offering-account-deletion-in-your-app/), [Capacitor iOS](https://capacitorjs.com/docs/ios).
