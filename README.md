# SendMe for iOS

SendMe helps church teams prepare neighborhood walks, record encounters, and follow through on assigned next steps. This worktree, `codex/neighborwalk-ios`, builds the bundled Capacitor iOS app. The separate website worktree is on `rework/church-ready-neighborwalk`; its deployment and release process are independent. The two clients share business rules and a Supabase backend, so backend changes must remain compatible with both.

## Current status

The iOS app has working Mac simulator builds, signed Release archives and App Store IPA exports. Native Apple sign-in passed the user’s physical iPhone check. Invitation hosting and the deletion/push functions are deployed; APNs activation, actual deletion fulfillment and final device acceptance remain incomplete. It has not been submitted to TestFlight or App Review. The intended distribution is an unlisted App Store app available by direct link, held on manual release while Apple reviews that request. **[The iOS release guide](docs/ios-release.md) is the current status and release checklist.**

The authorized shared-backend migrations and focused public website release are recorded in that guide. A real signed-in iOS account uses the shared church database; the sample workspace uses fictional, separate device data.

## Start here

Use Node 22 as declared in `mise.toml`. For local preview and a fictional sample bundle:

```sh
npm ci
npm run mobile:dev
npm run mobile:build:sample
```

See [the mobile guide](mobile/README.md) for simulator, native sync, sample data, and production configuration. Use `npm run ios:release:prepare` only after restoring approved public mobile configuration; keep provider secrets and service-role keys out of the app.

## Documentation map

- [iOS release guide](docs/ios-release.md): current status, remaining gates, Xcode steps, signed-device checks, and App Store preparation.
- [Authentication and invitations](docs/ios-auth-and-invitations.md) and [push activation](docs/IOS-REMOTE-PUSH-RUNBOOK.md): provider, migration, hosting, and device setup details.
- [Account deletion operations](docs/account-deletion-operations.md): daily queue review and the operator's fulfillment procedure.
- [Current architecture](docs/current-architecture.md), [database recovery](docs/database-recovery.md), and [safe local testing](docs/sandbox.md): shared data contracts and safeguards.
- [Historical archive](docs/archive/README.md): earlier audits, plans, web release checkpoints, and verification logs. Those records are evidence of past work, not current iOS instructions.

Source code, migrations, and tests determine implemented behavior. Keep current iOS release status in the iOS release guide so there is one checklist to update.
