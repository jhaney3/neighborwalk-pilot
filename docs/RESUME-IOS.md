# NeighborWalk iOS checkpoint — September 19, 2026

## Where to resume

Repository: https://github.com/jhaney3/neighborwalk-pilot
Branch: `codex/neighborwalk-ios`
Local folder: `/Users/brycehaney/Documents/Codex/2026-09-19/dow-2/neighborwalk-pilot`
Xcode project: `ios/App/App.xcodeproj`

This checkpoint combines Claude's styling and Codex's native app, authentication, invitations, sheet fixes, and assignment-based target selection. Keep this branch separate from `main`; do not merge it simply to submit the iOS app. The bundled app excludes the marketing landing page. Real signed-in builds use the existing shared Supabase backend, so backend changes require compatibility with the live website.

## Start next session

Ask the agent: “Read docs/RESUME-IOS.md and the linked release guides. Continue toward TestFlight and App Store submission on codex/neighborwalk-ios. Preserve main and the hosted website. Check actual completion of each release requirement before proceeding.”

On this machine, open the existing folder and confirm the branch before editing. On another machine, clone the repository and check out `codex/neighborwalk-ios`. Use Node 22, run `npm ci`, restore the local mobile environment configuration, then run `npm run ios:sync` and `npm run ios:open`.

GitHub does not store ignored `.env` files, signing credentials, simulator data, generated bundles, screenshots, or archives. Keep the existing `mobile/.env.production.local` on this Mac or transfer its configuration through a private password manager. Do not put private keys, service-role keys, or Apple credentials into Git. Xcode signing will need the authorized Apple account/team. Generated assets can be rebuilt from the committed source.

## Remaining release work

1. Enroll/configure Apple Developer membership and App Store Connect; verify bundle identifier, team, signing, and capabilities.
2. Enable and test native Apple sign-in with Supabase on a signed physical iPhone, including Hide My Email. Google sign-in code is implemented; the user reported adding its redirect URL. Verify an actual device login and invitation acceptance with a different email.
3. Rehearse and deploy the additive shared-invitation and account-deletion migrations against the complete schema. They have not been deployed by this work.
4. Host the separate invitation handoff site, configure its origin, and finish/test Universal Links. This does not require changing the marketing website.
5. Finish and test actual account-deletion fulfillment, including Apple authorization revocation. The request queue alone is insufficient.
6. Finalize public privacy/support details, privacy disclosures, review access with fictional records, and applicable shared-content moderation/reporting.
7. Test the final signed build on a physical iPhone and supported iPad layouts: authentication, invitations, walks, offline/reconnect behavior, permissions, accessibility, sharing, and deletion.
8. Create a signed archive, distribute to TestFlight, address findings, then prepare screenshots/listing/review notes and submit through App Store Connect.

Phone-only SMS sign-in is optional; phone-addressed invitation links can already be accepted using another enabled sign-in provider once the invitation backend is activated.

## Detailed instructions and verification context

- [Release guide](ios-release.md): Xcode steps, privacy, deletion, device checklist, draft listing.
- [Authentication and invitations](ios-auth-and-invitations.md): Apple/Google setup, migrations, invitation hosting, link behavior.
- [Walk sheets](ios-walk-sheets.md): interaction fixes and tests.

Prior local verification includes TypeScript, lint, 341 unit tests, mobile Chromium/WebKit tests, mocked invitation flows, isolated SQL tests, a native simulator UI test, and an unsigned archive. These are development checks, not proof of completed live provider setup or App Store readiness. The final target-selection change passed TypeScript and Chromium/WebKit regression tests and was synced into the iOS bundle.

No App Store upload or production backend deployment has been performed as part of this checkpoint. Apple approval is still pending completion of release work and review.
