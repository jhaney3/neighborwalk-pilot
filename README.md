# NeighborWalk for iOS

NeighborWalk helps church teams prepare neighborhood walks, record encounters, and follow through on assigned next steps. This worktree, `codex/neighborwalk-ios`, builds the bundled Capacitor iOS app. The separate website worktree is on `rework/church-ready-neighborwalk`; its deployment and release process are independent. The two clients share business rules and a Supabase backend, so backend changes must remain compatible with both.

## Current status

The iOS app has a locally verified source and sample build, but it has not been signed and tested on physical devices, submitted to TestFlight, approved for the App Store, or connected to the still-pending production invitation, deletion, and push services. The recorded local checks ran on Linux, which has no Xcode. **[The iOS release guide](docs/ios-release.md) is the current status and release checklist.** Confirm its gates against the actual Apple, hosting, and backend environments before a release.

No production database migration or website deployment is part of this iOS branch's completed work. A real signed-in iOS account uses the shared church database; the sample workspace uses fictional, separate device data.

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
- [Current architecture](docs/current-architecture.md), [database recovery](docs/database-recovery.md), and [safe local testing](docs/sandbox.md): shared data contracts and safeguards.
- [Historical archive](docs/archive/README.md): earlier audits, plans, web release checkpoints, and verification logs. Those records are evidence of past work, not current iOS instructions.

Source code, migrations, and tests determine implemented behavior. Keep current iOS release status in the iOS release guide so there is one checklist to update.
