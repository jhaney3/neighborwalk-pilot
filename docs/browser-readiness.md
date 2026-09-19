# Browser release checks

These tests use fictional records, a fixed loopback app (`127.0.0.1:3013`) and a fixed loopback Supabase database (`127.0.0.1:54321` / PostgreSQL `54322`). Browser requests to other origins are blocked. There is no environment option for pointing this suite at a real church. Test traces are disabled; local artifacts stay under ignored `work/browser-results`.

## Run locally

Use Node 22. Start and seed the isolated database with `npm run sandbox:start`, then run:

```sh
npm run verify
npm run test:database
npm run test:browser
```

The browser suite starts and stops its own optimized server on port 3013. It uses `/usr/bin/chromium` when present locally; otherwise install its pinned browser with `npx playwright install chromium`. CI installs Chromium and its dependencies in the disposable Ubuntu runner. Do not run the browser suite against `next dev`: that deliberately unregisters the service worker.

Fictional browser encounters remain in the local fixture church with a generated rehearsal prefix. Assertions query counts and the IDs/statuses of specifically generated test tasks only. Repeating the suite creates a new prefix; it does not erase earlier records or reset existing accounts.

The real Lawrence GIS browser case reads local reference parcels and a complete local street release; it never targets a hosted church. A fresh CI sandbox has no such real inventory, so that case reports an explicit skip there rather than claiming it exercised real parcels. The connected Giles case uses generated local parcel and street fixtures and remains part of CI. On September 19, 2026, all 32 browser cases passed on the operator machine with real Lawrence inventory installed. Hosted CI and production map verification remain separate checks.

## Executed scenarios

| Scenario | Observed result on September 10 |
| --- | --- |
| Cold guide reopen after clearing HTTP cache, with network blocked | Initially failed; passed after explicit build-asset precaching |
| 100 offline encounter saves, page close/reopen, reconnect | All 100 persisted locally, none reached the server while disconnected, exactly 100 after reconnect |
| Two independent devices / leader and volunteer | Both concurrent encounters persisted |
| Server commits but its response is dropped | Same immutable request retried; one encounter, no duplicate |
| IndexedDB quota failure during saving | Error visible, form/input retained, no server record; retry after restoring storage saved once |
| Invalid invitation | Secret scrubbed from URL; explicit dismissal restored the existing workspace without changing church data |
| Native location dialog | Initial focus contained, reverse tab contained, Escape closed, focus returned to the launching location |
| Expired access token / cold offline reopen | Explicit recently prepared-cache selection, one offline entry, exactly one server record after real authentication reconnects |
| Known workspace API permission denial | Cache window invalidated; later offline token expiry could not reopen it |
| Known guide-service permission denial | Live guide refresh locked visible records and invalidated the prepared window; later cold offline reopening remained unavailable |
| Cross-tab session removal | Records hidden; original queued work retained and unavailable to an unsigned-in session |
| Same-account tab handover | Second writer blocked; closing the original allowed reopening with the pending entry intact and both later entries shared once |
| Leader-to-volunteer task responsibility | Assignment, decline, acceptance and completion matched server state; completion was unavailable before acceptance |
| Email reminder self-service | Unconfigured delivery blocked enrollment; with a fictional availability response, real local RPC opt-in persisted across reload and opt-out persisted across a second reload; no email was sent |
| Person-location correction | Required reason and impact acknowledgement; open task followed the person; audit reason appeared in permitted history and database association matched |
| Reviewed duplicate people/locations | Reasoned, recently authenticated previews; source aliases, original history and stronger restrictions preserved; phone-sized review and old links verified |
| Encounter correction after lost response | One appended review, unchanged original outcome/links and open responsibility; reviewed history, derived last contact and note categories connected |
| Field guide content and keyboard navigation | Coaching, suggested words and reminders displayed; responsive tab orientation, arrows/Home/End, labelled panels and phone-sized controls verified |
| Actual session revocation / account switch | Unexpired token denied; another device stayed authorized; original queue remained private to its author and recovered once after fresh sign-in |
| While-open offline authorization expiry | Advancing browser time beyond 24 hours locked visible records without clearing the queue; successful online check resumed exactly-once sharing |
| Transactional guide save, competing editor and archive | Lost response retained the original request through reload and retried without duplication; stale edit rejected; favorite clearing persisted; archived content and original record remained |
| New work saved during a refresh | Clock-controlled debounce joined an in-flight read; after it settled, the new entry shared once before the 30-second periodic poll |

Earlier CI runs `34452002846` and `34453143023` found a request escaping simulated disconnection during tab replacement. The fixture now combines CDP offline state, persistent request abortion and per-tab fetch transport failure; all zero-server-write assertions remain. Transactional-guide checkpoint `96338c1` passed hosted CI `34478082682`, including all sixteen scenarios then present, 201 unit tests, lint, types, the optimized build and nine database suites. Subsequent workspace-read and delayed-refresh results are recorded in the [execution ledger](rework-progress.md). These simulations are not physical-device airplane-mode evidence.

The delayed-refresh regression installs [Playwright's clock](https://playwright.dev/docs/clock) before application timers exist, holds one actual guide-state request during a sync, saves new fieldwork, and advances only the debounce window. Once released, the work must share before the normal 30-second poll. It does not modify the queue or manufacture a server receipt.

## September 11 audit rerun

All 18 scenarios passed together against the final optimized local build in 6.9 minutes. The first audit run passed 17 scenarios but timed out waiting for the old “Save private guide” label while editing an existing private guide; the interface now correctly says “Save changes.” After the regression selector was updated, the guide scenario passed alone and the complete suite passed.

Separate read-only browser reviews covered every public route and each distinct demo surface at desktop and narrow widths. Final focused checks confirmed that active fieldwork exposes one outing-linked community-encounter launcher, property follow-up dates use the church-local minimum, the mobile recovery page has no horizontal overflow, Settings stays inside the demo route, `/invite` without a token reaches sign-in, changed dialogs contain and restore keyboard focus, and automated accessibility checks found no violations on the exercised People, property and community-encounter surfaces. These checks are Chromium evidence, not the outstanding physical-device or screen-reader matrix.

## Offline design

`npm run build` generates an ignored `public/sw-build.js` manifest containing only immutable Next.js JS/CSS/font paths. The cache version includes asset content, the worker source, build ID and public icons. Current app assets total roughly 2.9 MiB uncompressed; generation fails above 16 MiB pending review.

The worker prepares the anonymous app shell and those assets before installation succeeds. It does not force activation over open tabs, and pins its app shell to its own prepared build. The app asks the worker whether its cache is actually complete and shows preparing/ready/update-waiting/unavailable states. A ready app shell is **not** a guarantee that a particular account, assignment or guide is fresh: those remain separately scoped and require prior online preparation and a bounded membership check.

No API responses, sign-in/invitation routes, invite tokens, external map imagery, source maps, private records or arbitrary image URLs are included. Church records remain in account-scoped IndexedDB. New invitation links use URL fragments so their secret is not sent in HTTP request paths/query strings. Legacy query links are accepted and scrubbed after preservation in session storage.

When an expired access token cannot refresh, the user may explicitly select an already prepared offline workspace only while its membership check is less than 24 hours old and the same account remains in SDK storage. This is a device-cache selector, not a new login or server credential. Known API denial, a missing/mismatched session or an expired/future membership check disables it. Browser storage is not a cryptographically sealed authorization boundary: someone controlling the browser profile can inspect its stored records. Devices and downloads must be protected accordingly.

An exclusive Web Lock permits one live workspace tab/window per account in a browser profile, preventing stale tab snapshots from overwriting the device queue. A second tab must close the first and retry; separate devices are unaffected. In-flight acknowledged writes settle before orderly release; the browser releases the lock when a tab/process ends. Unsupported browsers get an explicit safe refusal. See [Web Locks behavior](https://developer.mozilla.org/en-US/docs/Web/API/LockManager/request).

Protected view navigation uses Next.js's documented native History integration. Each view uses the persistent client workspace; changing views does not need a network-only Server Component request or interrupt an IndexedDB write. Direct links and browser history remain available.

References: [Next.js native History integration](https://nextjs.org/docs/app/getting-started/linking-and-navigating#native-history-api), [Playwright service-worker testing and limitations](https://playwright.dev/docs/service-workers).

## Still required before release

- Repeat the automated session/account-switch and while-open expiry scenarios on actual supported devices. The local behavior and limitations are documented in [session security](session-security.md).
- Service-worker version transition with pending records and multiple open tabs/windows; storage eviction and backgrounding/screen lock.
- Live permission conflict/recovery; concurrent area/group archival and person moves with open tasks.
- iPhone Safari/installed PWA, Android Chrome/installed PWA and proportionate desktop Safari/Firefox checks. Chromium emulation is not a substitute for actual devices.
- Keyboard/screen reader, 200% enlargement, narrow-screen layouts and physical printing.
- Staging/production headers, real provider delivery, deployment cutover and operational restore checks.

Passing these local tests is evidence for the tested flows, not a claim that all release gates or church pilots are complete.
