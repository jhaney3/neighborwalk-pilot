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

Fictional browser encounters remain in the local fixture church with a generated rehearsal prefix. Assertions query counts only. Repeating the suite creates a new prefix; it does not erase earlier records or reset existing accounts.

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

The complete automated browser suite passed again after anonymous app-shell precaching was hardened (about one minute locally). All 131 unit tests, lint, types and the optimized build passed at this checkpoint. The new browser CI job still needs its first hosted run.

## Offline design

`npm run build` generates an ignored `public/sw-build.js` manifest containing only immutable Next.js JS/CSS/font paths. The cache version includes asset content, the worker source, build ID and public icons. Current app assets total roughly 2.9 MiB uncompressed; generation fails above 16 MiB pending review.

The worker prepares the anonymous app shell and those assets before installation succeeds. It does not force activation over open tabs, and pins its app shell to its own prepared build. The app asks the worker whether its cache is actually complete and shows preparing/ready/update-waiting/unavailable states. A ready app shell is **not** a guarantee that a particular account, assignment or guide is fresh: those remain separately scoped and require prior online preparation and a bounded membership check.

No API responses, sign-in/invitation routes, invite tokens, external map imagery, source maps, private records or arbitrary image URLs are included. Church records remain in account-scoped IndexedDB. New invitation links use URL fragments so their secret is not sent in HTTP request paths/query strings. Legacy query links are accepted and scrubbed after preservation in session storage.

Protected view navigation uses Next.js's documented native History integration. Each view uses the persistent client workspace; changing views does not need a network-only Server Component request or interrupt an IndexedDB write. Direct links and browser history remain available.

References: [Next.js native History integration](https://nextjs.org/docs/app/getting-started/linking-and-navigating#native-history-api), [Playwright service-worker testing and limitations](https://playwright.dev/docs/service-workers).

## Still required before release

- Expiring authentication during a long disconnected interval; known revocation and account switching with pending work.
- Service-worker version transition with pending records and multiple open tabs/windows; storage eviction and backgrounding/screen lock.
- Live permission conflict/recovery; concurrent area/group archival and person moves with open tasks.
- iPhone Safari/installed PWA, Android Chrome/installed PWA and proportionate desktop Safari/Firefox checks. Chromium emulation is not a substitute for actual devices.
- Keyboard/screen reader, 200% enlargement, narrow-screen layouts and physical printing.
- Staging/production headers, real provider delivery, deployment cutover and operational restore checks.

Passing these local tests is evidence for the tested flows, not a claim that all release gates or church pilots are complete.
