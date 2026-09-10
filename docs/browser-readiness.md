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
| Known API permission denial | Cache window invalidated; later offline token expiry could not reopen it |
| Cross-tab session removal | Records hidden; original queued work retained and unavailable to an unsigned-in session |
| Same-account tab handover | Second writer blocked; closing the original allowed reopening with the pending entry intact and both later entries shared once |
| Leader-to-volunteer task responsibility | Assignment, decline, acceptance and completion matched server state; completion was unavailable before acceptance |
| Email reminder self-service | Unconfigured delivery blocked enrollment; with a fictional availability response, real local RPC opt-in persisted across reload and opt-out persisted across a second reload; no email was sent |

The original three-scenario browser suite passed in hosted CI run `34450072005`. Runs `34452002846` and `34453143023` found a request escaping simulated disconnection during tab replacement. The test now combines CDP offline state, a persistent request-abort boundary and an explicit per-tab fetch transport failure boundary (service-worker-controlled pages can bypass interception). All zero-server-write assertions remain. The targeted handover passed five consecutive local runs, and all eight scenarios passed in hosted CI run `34454068051`. These are simulated transport failures, not physical-device airplane-mode evidence. The ninth reminder settings scenario subsequently passed with the full local suite (about two minutes). Latest full verification passes 158 unit tests, lint, types and the optimized build; hosted verification of the reminder additions is pending.

## Offline design

`npm run build` generates an ignored `public/sw-build.js` manifest containing only immutable Next.js JS/CSS/font paths. The cache version includes asset content, the worker source, build ID and public icons. Current app assets total roughly 2.9 MiB uncompressed; generation fails above 16 MiB pending review.

The worker prepares the anonymous app shell and those assets before installation succeeds. It does not force activation over open tabs, and pins its app shell to its own prepared build. The app asks the worker whether its cache is actually complete and shows preparing/ready/update-waiting/unavailable states. A ready app shell is **not** a guarantee that a particular account, assignment or guide is fresh: those remain separately scoped and require prior online preparation and a bounded membership check.

No API responses, sign-in/invitation routes, invite tokens, external map imagery, source maps, private records or arbitrary image URLs are included. Church records remain in account-scoped IndexedDB. New invitation links use URL fragments so their secret is not sent in HTTP request paths/query strings. Legacy query links are accepted and scrubbed after preservation in session storage.

When an expired access token cannot refresh, the user may explicitly select an already prepared offline workspace only while its membership check is less than 24 hours old and the same account remains in SDK storage. This is a device-cache selector, not a new login or server credential. Known API denial, a missing/mismatched session or an expired/future membership check disables it. Browser storage is not a cryptographically sealed authorization boundary: someone controlling the browser profile can inspect its stored records. Devices and downloads must be protected accordingly.

An exclusive Web Lock permits one live workspace tab/window per account in a browser profile, preventing stale tab snapshots from overwriting the device queue. A second tab must close the first and retry; separate devices are unaffected. In-flight acknowledged writes settle before orderly release; the browser releases the lock when a tab/process ends. Unsupported browsers get an explicit safe refusal. See [Web Locks behavior](https://developer.mozilla.org/en-US/docs/Web/API/LockManager/request).

Protected view navigation uses Next.js's documented native History integration. Each view uses the persistent client workspace; changing views does not need a network-only Server Component request or interrupt an IndexedDB write. Direct links and browser history remain available.

References: [Next.js native History integration](https://nextjs.org/docs/app/getting-started/linking-and-navigating#native-history-api), [Playwright service-worker testing and limitations](https://playwright.dev/docs/service-workers).

## Still required before release

- Full 24-hour window expiry while open, fresh sign-in as another account and recovery of the original account’s pending work. Expired token, known API denial and cross-tab removal paths are covered above.
- Service-worker version transition with pending records and multiple open tabs/windows; storage eviction and backgrounding/screen lock.
- Live permission conflict/recovery; concurrent area/group archival and person moves with open tasks.
- iPhone Safari/installed PWA, Android Chrome/installed PWA and proportionate desktop Safari/Firefox checks. Chromium emulation is not a substitute for actual devices.
- Keyboard/screen reader, 200% enlargement, narrow-screen layouts and physical printing.
- Staging/production headers, real provider delivery, deployment cutover and operational restore checks.

Passing these local tests is evidence for the tested flows, not a claim that all release gates or church pilots are complete.
