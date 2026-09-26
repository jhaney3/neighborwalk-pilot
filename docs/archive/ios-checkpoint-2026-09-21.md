# NeighborWalk iOS checkpoint — September 21, 2026

> Historical record. For the current iOS release status and requirements, see the [iOS release guide](../ios-release.md).

## Production-readiness pass recorded at the time

This file preserves the September 2026 iOS-only completion pass on
`codex/neighborwalk-ios`. It is no longer the release checklist. Use the
[current iOS release guide](../ios-release.md) for any new verification or gate update.

### Status recorded in that session

- [x] Confirmed the correct clean worktree and branch; the separate hosted web
  worktree remains untouched.
- [x] Reviewed the existing iOS release, authentication, invitation, and mobile
  architecture handoffs.
- [x] Completed focused audits of native/Xcode release readiness, application
  and backend feature completeness, and iOS UX/accessibility.
- [x] Established a clean baseline with Node 22.23.2, ESLint, TypeScript, the
  test suites, the shared-invitation SQL harness, migration rehearsal, a sample
  mobile bundle, Capacitor dependency checks, and a production-only npm audit.
  Docker remains unavailable to this OS user, but the full rollback-only
  migration rehearsal completed against the existing local PostgreSQL server.
- [x] Implemented the highest-value code-completable gaps: privacy-safe local
  reminders; APNs invitation/follow-up alerts with session-bound private token
  storage, cancellation, dedupe, retry and invalid-token handling; app-launch
  token refresh; notification route validation; sign-out cleanup; in-app
  attention badges; native connectivity truth; secure deletion-request guards;
  migration rehearsal coverage; 44pt controls; visible focus/selection states;
  iPad safe areas; system/light/dark appearance; and location-denial guidance.
- [x] Ran the repository-required lint, typecheck, unit/database/mobile tests,
  invitation harness, production web build, sample mobile build, native sync,
  release-provenance rejection check, dependency audit, and focused UI checks.
- [x] Reconciled this checkpoint and `docs/ios-release.md` with the verified
  local state and listed the remaining human-controlled release actions.

### Boundaries for this pass

The current pass can complete and verify repository code, migrations, native
project configuration, automated tests, runbooks, and locally buildable assets.
It cannot independently enroll an Apple Developer account, accept Apple legal
agreements, create certificates or provisioning profiles, configure production
provider secrets, deploy production database changes, approve legal/privacy
language, supply a real reviewer account, validate a signed build on the owner's
physical devices, or submit an App Store Connect build. Those remain release
gates even if all source work is complete.

## Recorded workspace and branch

Repository: https://github.com/jhaney3/neighborwalk-pilot
Branch: `codex/neighborwalk-ios`
Current worktree: `/home/jhaney/Work/neighborwalk-pilot-ios`
Xcode project: `ios/App/App.xcodeproj`

This checkpoint combines Claude's styling and Codex's native app, authentication, invitations, sheet fixes, and assignment-based target selection. Keep this branch separate from `main`; do not merge it simply to submit the iOS app. The bundled app excludes the marketing landing page. Real signed-in builds use the existing shared Supabase backend, so backend changes require compatibility with the live website.

## Handoff instruction recorded at the time

The handoff originally directed the next agent to continue toward TestFlight and App Store submission while preserving the separate website. That instruction has been replaced by the current release guide and `AGENTS.md`.

On this machine, open the existing folder and confirm the branch before editing. On another machine, clone the repository and check out `codex/neighborwalk-ios`. Use Node 22, run `npm ci`, restore the approved public mobile environment configuration, then run `npm run ios:release:prepare` and `npm run ios:open`.

GitHub does not store ignored `.env` files, signing credentials, simulator data,
generated bundles, screenshots, or archives. This worktree does **not** contain
`mobile/.env.production.local`; restore its approved public values through a
private configuration channel before running `npm run ios:release:prepare`.
Do not put private keys, service-role keys, APNs worker secrets, or Apple
credentials into Git or the mobile environment. Xcode signing will need the
authorized Apple account/team. Generated assets can be rebuilt from source.

## Work remaining at this checkpoint

1. Enroll/configure Apple Developer membership and App Store Connect; verify the
   final bundle identifier, team, signing, and capabilities. Add Push
   Notifications and Associated Domains in Xcode/provisioning; do not hardcode
   a development APNs entitlement into the App Store archive.
2. Enable and test native Apple sign-in with Supabase on a signed physical iPhone, including Hide My Email. Google sign-in code is implemented; the user reported adding its redirect URL. Verify an actual device login and invitation acceptance with a different email.
3. Review and deploy the additive shared-invitation, account-deletion, and APNs
   migrations. Deploy/configure the `push-delivery` Edge Function with Apple
   credentials and a recurring protected invocation. The complete local
   migration rehearsal now passes and rolls back; production remains untouched.
4. Host the separate invitation handoff site, configure its origin, and finish/test Universal Links. This does not require changing the marketing website.
5. Finish and test actual account-deletion fulfillment, including Apple authorization revocation. The request queue alone is insufficient.
6. Finalize public privacy/support details, privacy disclosures, review access with fictional records, and applicable shared-content moderation/reporting.
7. Test the final signed build on physical iPhone and iPad hardware:
   authentication, invitations, sandbox/TestFlight APNs, local reminders,
   notification taps, reassignment/cancellation, location denial, walks,
   offline/reconnect behavior, large text, VoiceOver, sharing, and deletion.
8. Create a signed archive, distribute to TestFlight, address findings, then prepare screenshots/listing/review notes and submit through App Store Connect.

Phone-only SMS sign-in is optional; phone-addressed invitation links can already be accepted using another enabled sign-in provider once the invitation backend is activated.

## Links and verification recorded at this checkpoint

- [Release guide](../ios-release.md): Xcode steps, privacy, deletion, device checklist, draft listing.
- [Authentication and invitations](../ios-auth-and-invitations.md): Apple/Google setup, migrations, invitation hosting, link behavior.
- [iOS notifications](../IOS-REMOTE-PUSH-RUNBOOK.md): Apple capability, backend secrets,
  Edge Function schedule, build flags, privacy, and signed-device acceptance.
- [Walk sheets](ios-walk-sheets.md): interaction fixes and tests.

Current local verification on September 21, 2026 includes ESLint, TypeScript,
75 unit/integration files with 373 passing tests, the shared-invitation security
harness, the complete rollback-only migration rehearsal, the Next.js production
build, the sample mobile bundle, 20 passing Chromium mobile flows, Capacitor iOS
sync with nine plugins, and a production-only npm audit with zero known
vulnerabilities. The Xcode Release guard also correctly rejected the synced
sample bundle. APNs worker type-check/lint, ES256 signing, SQL security tests,
and database advisors passed during this work session.

This Linux machine does not have Xcode, so it cannot rebuild the Swift target,
run the iOS simulator, inspect a signed archive, or validate entitlements and
provisioning. WebKit browser execution is also unavailable here because its
required host libraries are absent. Previously documented simulator/archive
results remain historical evidence only; the final production-configured build
still requires the signed-device and TestFlight checks above.

No App Store upload or production backend deployment has been performed as part of this checkpoint. Apple approval is still pending completion of release work and review.
