<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Platform and worktree workflow

- This worktree is the web application on `rework/church-ready-neighborwalk`.
- The separate iOS application lives on `codex/neighborwalk-ios`. Use `git worktree list` to locate its checkout; do not switch this worktree to that branch.
- Before editing, classify the request as web-only, iOS-only, or shared. If the scope is not explicit and the choice would materially change the result, ask the user.
- Change only this worktree for web-only work. Do not modify the iOS worktree unless the request explicitly includes iOS or both applications.
- For shared work, keep the source change in a focused commit and port only that commit with `git cherry-pick -x`, or implement an equivalent platform-specific commit when the interfaces differ. Verify each application independently.
- Never merge the full web and iOS branches merely to synchronize a feature. Preserve deliberate platform, navigation, styling, authentication, build, and release differences.
- Do not copy generated output, dependency directories, native build artifacts, or environment files between worktrees.
- Use the Node version declared in `mise.toml`. Run `npm run lint`, `npm run typecheck`, and relevant tests for changed behavior; run `npm run build` for release-sensitive web changes.
