# NeighborWalk production checklist

The client and Supabase foundation are ready for an owner-operated connected pilot. Complete every required item below before treating the app as a church-wide system of record.

## Supabase and synchronization

- Keep the Supabase migrations in source control and run both Security Advisor and Performance Advisor after every schema change.
- Set the production Site URL and exact redirect URL in Supabase Auth before testing Google or passwordless sign-in.
- Configure and test the Google OAuth consent screen, authorized JavaScript origin, Supabase callback URL, Client ID, and Client Secret. Keep the Client Secret only in Supabase.
- Add a leader-controlled invitation and membership-revocation flow before inviting volunteers.
- Replace the pilot snapshot sync with entity-level conflict merging before simultaneous multi-device field use; the current revision check safely rejects stale overwrites.
- Add cursor pagination, request body limits, rate limits, structured logs, error tracking, database backups, restore drills, and availability alerts.
- Add retention and erasure jobs for visits, follow-ups, audit entries, soft-deleted properties, mutation receipts, and backups.
- Configure trusted custom SMTP before a broad rollout so sign-in emails are branded and deliver reliably.

## Maps and addresses

- Choose a production map style/tile provider whose usage terms and capacity match the rollout. Preserve all required attribution.
- Proxy reverse geocoding through the backend, enforce rate limits, and document whether address queries are logged by the provider.
- Test the actual ministry area. Map building coverage varies, so volunteers must be able to add a coordinate and confirm the address manually.
- If full offline maps are required, add a licensed offline-region download workflow. This build caches only recently viewed same-origin/app assets and a bounded set of map responses.

## Privacy and ministry policy

- Approve a written purpose, access policy, retention schedule, incident response plan, and resident correction/deletion process.
- Train volunteers not to enter names, contact details, sensitive traits, speculation, prayer requests, or pastoral counseling notes in the objective note field.
- Confirm that “do not revisit” is honored across future events and define who may reverse that status.
- Review local privacy, solicitation, trespass, safeguarding, and records laws with qualified counsel.
- Replace all fictional church, volunteer, territory, and guide content before launch. Have ministry leadership and safeguarding reviewers approve every guide step.

## Authentication and devices

- Keep the app shell public, but require Supabase authentication and server-enforced church membership on every protected data request.
- Require device screen locks and current browsers; define what to do when a phone is lost or a volunteer leaves.
- Verify sign-out and account-switch behavior does not expose cached resident data. Consider managed devices or encrypted native storage for higher-risk deployments.
- Add real push delivery if reminders must arrive while the PWA is closed. The current notification is an on-device reminder shown when the app runs.

## Release gate

- Run `npm run verify` in CI on the exact release commit.
- Test install, upgrade, first load, offline recording, reconnection, duplicate sync, two-device conflicts, backup export/import, retention, and account revocation.
- Test narrow phones, large text, keyboard-only navigation, screen readers, reduced motion, weak connections, denied geolocation, and unavailable map tiles.
- Conduct a small supervised pilot with fictional or consented data, review audit logs and volunteer feedback, then explicitly approve the live rollout.
