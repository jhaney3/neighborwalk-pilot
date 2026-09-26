<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Platform and worktree workflow

- This worktree is the iOS application on `codex/neighborwalk-ios`.
- The separate web application lives on `rework/church-ready-neighborwalk`. Use `git worktree list` to locate its checkout; do not switch this worktree to that branch.
- Before editing, classify the request as web-only, iOS-only, or shared. If the scope is not explicit and the choice would materially change the result, ask the user.
- Change only this worktree for iOS-only work. Do not modify the web worktree unless the request explicitly includes web or both applications.
- For shared work, keep the source change in a focused commit and port only that commit with `git cherry-pick -x`, or implement an equivalent platform-specific commit when the interfaces differ. Verify each application independently.
- Never merge the full web and iOS branches merely to synchronize a feature. Preserve deliberate platform, navigation, styling, authentication, build, and release differences.
- Do not copy generated output, dependency directories, native build artifacts, or environment files between worktrees.
- Use the Node version declared in `mise.toml`. Run `npm run lint`, `npm run typecheck`, and relevant tests for changed behavior; run `npm run mobile:build:sample` and relevant mobile browser tests for release-sensitive iOS changes.

## UI and design workflow

Before changing UI, UX, navigation, UI copy, accessibility, or visual styling, read `DESIGN.md` in the repository root. It points to the locked redesign (`docs/design/redesign-walkthrough.html`), the build plan, and the final check that every screen must pass. The current redesign targets the iOS app only.

Report missing tools and unperformed checks honestly. Backend-only work does not require this workflow.
