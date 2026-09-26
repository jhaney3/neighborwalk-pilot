# Simplicity verification — September 12, 2026

> Historical record. For the current iOS release status and requirements, see the [iOS release guide](../ios-release.md).

Implementation follows the [approved simplicity plan](simplicity-plan.md).
Three Sol Codex agents handled People, Walks, and the public website in the
existing herdr session; the coordinator handled Home, navigation, integration,
and verification. Existing uncommitted work was preserved.

## Checks

- Full ESLint, TypeScript, and optimized Next.js build pass.
- Unit regressions: 224 tests in 45 files pass.
- Local database regressions: nine rollback-only suites pass. No schema change
  was introduced by the simplicity pass.
- Six dedicated Chromium simplicity scenarios pass against the optimized build:
  desktop/mobile navigation; People tabs and keyboard focus; guided setup date
  validation, cancellation, saved-draft resumption and stable record IDs;
  person-free no-answer recording; profile-embedded task completion; and accepted
  assignment persistence with map/list field context locked to the assigned area.
- All 24 Chromium browser scenarios have passing results against the final
  optimized build: 22 passed in the full run, then duplicate-history and the
  100-encounter cold-offline round trip passed in focused reruns after test-only
  corrections. The latter verifies exact guide content after offline reopen,
  100 durable queued encounters across closing/reopening, and exactly-once
  reconnect. Other coverage includes quota failure, concurrent devices, lost
  responses, reviewed corrections, account isolation, access denial, tab locks,
  legacy links, and task acceptance.

React review kept route-driven selection controlled without remounting the tab
bar and losing keyboard focus. Browser verification caught and corrected a
mobile layout error: variable-height offline/sample banners must consume space
above the scrolling workspace, not push its controls beneath bottom navigation.
The wizard now uses the shared form-control styling. Screenshots remain in the
ignored `work/verification/` directory. Narrow People and public-site checks
reported no page JavaScript errors; the public site fits a 390-pixel viewport.

Test-only corrections make renamed controls explicit, compare rendered guide
text consistently, and allow a reviewed merge up to 60 seconds to confirm.
The full suite was not rerun after those final test-only corrections; the
affected scenarios were. One intermediate rerun was interrupted and is not
counted as passing evidence.

Connected browser tests target only the fixed local Supabase sandbox and
fictional accounts. They exercise actual local persistence; outbound browser
traffic is limited to the local app and local API. No production deployment,
hosted database mutation, provider activation, or real church-data change is
part of this pass.

## Product-owner checkpoint

The optimized local preview is available at <http://localhost:3013/demo>.
It is a local sandbox preview, not a production deployment.

Try the fictional sample before resuming the remaining feature plan:

1. Plan a walk with an address list and one volunteer, without creating a group.
2. Accept an assignment, open its area, and switch between map and address list.
3. Record no answer, then a requested follow-up.
4. Open People, view a profile, and complete its next step.

Automated checks do not prove the experience is simple for first-time users.
Actual iPhone/Android, screen-reader, enlargement, printing, deployment, provider,
and remaining release checks in [browser readiness](browser-readiness.md) and
[the rework ledger](rework-progress.md) remain separate gates.
