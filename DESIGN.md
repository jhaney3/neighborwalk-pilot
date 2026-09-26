# NeighborWalk iOS redesign: handoff for the next agent

Read this before touching any screen. It tells you what's been decided, where the decisions live, how to build them, and how to prove the result matches.

Status on Sep 25, 2026: **the redesign is built and committed** (`42a8334` on `codex/ios-experiment`). Every screen in the final check is rated Match except PL1 and BD11, which wait on the user's call about the logger header and grid. Changes made after the lock are logged as decisions at the bottom of the build plan. Still to do on a Mac: `npm run ios:sync`, device testing and a signed-in (non-sample) pass.

## The three documents

| Document | What it's for | Rule |
|---|---|---|
| [`docs/design/redesign-walkthrough.html`](docs/design/redesign-walkthrough.html) | **The source of truth.** 53 screens, each with a phone mockup, a stable ID (WM, PL, MP, WK, PW, FU, TD, PE, AD) and notes on why it looks that way, all locked by the user over three review rounds. The top box lists the "Rules in force". | Build exactly what's drawn. The notes on each screen are part of the spec. |
| [`docs/design/redesign-build-plan.md`](docs/design/redesign-build-plan.md) | The ordered checklist: Phase 0 removals, then one checkbox per screen ID in phases 1–8, then verification. | Work phase by phase and tick items only when they pass the final check. |
| [`docs/design/final-check/index.html`](docs/design/final-check/index.html) | **The acceptance gate.** Every locked screen side by side: *before* (the audit capture), *locked mockup*, and *built* (a capture of the running iOS app), each rated Match, Drifted or Not built. Includes BD1–BD12, the screens still in force from the original board (Today, Follow-ups, check-in, the + logger and so on). | A screen is done only when it's rated **Match**. |

The original board (screens locked before the walkthrough) is `.mobbin/nw-ab-type-mockups-20260923.html` in the release worktree. Its mockups that still count are exported to `docs/design/final-check/mockups/BD*.webp`, so you shouldn't need the board itself. Older decisions are in `docs/design/decisions.md`. Where it disagrees with the walkthrough, the walkthrough wins.

### Updating the final check

1. Start the sample app: `npm run mobile:dev -- --port 4392 --strictPort` (it serves `/demo`, a fictional church).
2. In `docs/design/final-check/capture.mjs`, add or fix the step for each screen you built. A step drives the sample app to that exact screen. The helpers `home`, `tab`, `esc`, `mutateSample` and `asVolunteer` are already there.
3. Run `node docs/design/final-check/capture.mjs` (or pass IDs, e.g. `… capture.mjs WM1 WM2`). Captures land in `final-check/built/<ID>.jpg`. Set `FINAL_CHECK_THEME=dark` for a dark pass; change the viewport in the script for a 320pt pass.
4. Open `final-check/index.html`, **look at each capture next to its mockup**, and set `status` and `note` for that ID in `final-check/status.js`, plus `checked` to the date. Be honest: layout, copy, type, spacing, colors and states all count. If something differs, rate it Drifted and say what differs.
5. Don't regenerate `screens.js`, `mockups/` or `before/`. They're frozen with the locked design.

The sample data has gaps that will make honest captures hard. The live walk shows elapsed times of many hours, because it started "yesterday" relative to today, and personal History on Today is empty. The mockups show populated states. Seed sample data that matches (for example `lib/seed.ts` relative to the current time), or use `mutateSample` in the step, rather than accepting an empty screen as a match.

## Scope: the iOS app only

- The user wants **the iOS app** to look flawless. Ignore the web (Next.js) experience for now. Don't run or fix web browser tests (`tests/browser`), and don't change the web worktree (branch `rework/church-ready-neighborwalk`).
- The code is shared with the web build, so it still has to pass `npm run lint` and `npm run typecheck`.
- The redesign was built on `codex/ios-experiment` (worktree `/home/jhaney/Work/neighborwalk-redesign`) and is meant to merge into the iOS release branch `codex/neighborwalk-ios` (worktree `/home/jhaney/Work/neighborwalk-pilot-ios`).

### What "iOS" means in this codebase

The iOS app is **the React app running inside a native iOS shell (Capacitor 8)**, built with Vite (`mobile/vite.config.ts`, entry `mobile/main.tsx`). The native project is `ios/App`. Screens are React components styled in `app/styles/*.css`, not SwiftUI views.

So:
- **Apple's Human Interface Guidelines govern every screen**: layout, hit targets, sheets, gestures, typography behavior, feedback. Apply them through the web stack.
- **SwiftUI guidance applies only if a screen truly needs native code** (a Capacitor plugin). Don't rewrite screens natively, and don't add native dependencies or raise the iOS deployment target without the user's approval. Before any native work, check the API against current Apple documentation and the project's deployment target.
- Native capabilities come from Capacitor plugins already installed: `@capacitor/haptics`, `keyboard`, `share`, `local-notifications`, `push-notifications`, `network`, `filesystem`, `browser` and `app`.

## HIG checklist for every screen you build

Check each item against the current Apple Human Interface Guidelines page when you're unsure. These are the parts that matter for these screens:

- **Hit targets are at least 44×44pt**, including chips, icon buttons, the grey pin bar and swipe actions. The mobile suite already checks 44pt targets; extend it to new controls.
- **Safe areas:** use `--top-inset` and `--bottom-inset` (`env(safe-area-inset-*)`, defined in `app/styles/foundation.css`) for anything pinned to the edges: the walk pill, chips, the toast, sheets and the tab bar.
- **Sheets:** follow iOS sheet behavior. There's a grabber, swipe down or tap the dimmed area to dismiss, and one sheet at a time. When a ⋯ menu opens from a sheet, the sheet steps away and comes back on Close (MP12). Keep sheet content scrollable and clear of the keyboard.
- **Action sheets** (WK5, MP4, MP12): actions in one group, a separate Close/Cancel at the bottom, and destructive actions in red. They must be confirmed if they can't be undone.
- **Gestures:** long-press is a shortcut, and HIG discourages making a hidden gesture the only path. Long-press drops a pin straight to Don't knock (WM2), so also give VoiceOver an accessible way to do it (for example a custom action on the map, or Don't knock on the new-pin sheet for assistive tech only), and log it under "Decisions made while building" in the build plan for the user to confirm. Don't let the long-press fight MapLibre's pan and zoom.
- **Haptics (`@capacitor/haptics`):** use the vocabulary in `mobile/haptics.ts` and nothing else. On Sep 26, 2026, the user asked for broad coverage: a selection tick on every button press and every tap into a text field (installed globally in `mobile/main.tsx`), a light impact when a pin or drawing corner lands, success when a save completes (`useAsyncAction().save` or a success toast), a warning when a destructive confirmation opens, and an error when an action fails. Use `action.save` for new changes the person makes, and keep `action.run` for shares, syncs, exports and previews. Ask the user before adding a new kind of haptic.
- **Text:** support larger text without clipping or overlap (test with browser zoom at 200% as a stand-in for Dynamic Type), and never truncate an address without a way to see all of it. Keep Schibsted Grotesk for names, titles and addresses, and IBM Plex Mono for times, counts and dates.
- **Color and contrast:** support light and dark (`:root[data-theme="dark"]` and `prefers-color-scheme`), meet contrast for text on tinted cards, and never use color alone. Outcome dots always come with a word.
- **Motion:** respect `prefers-reduced-motion` (there are existing blocks in `app/styles/responsive.css` and `people.css`). Keep transitions short; the Walks / Map / List switch must not jump (WK1).
- **Keyboard:** inputs stay visible above the keyboard. Done dismisses single-line fields (`mobile/keyboard.ts`); keep that behavior.
- **VoiceOver:** meaningful labels on icon-only buttons (the tab bar, ⋯, locate, the pin bar icons), a logical reading order in sheets, and state announced for switches, segments and checks.
- **Deliberate departures the user chose (keep them):** the pill tab bar with icon-only inactive tabs, the separate yellow + button, the offset "next action" card, and mono metadata. Don't "correct" these toward stock iOS.

## Design system and rules

- **Tokens** live in `app/styles/foundation.css`: colors (ink, hedge, porch, outcome colors), `--font-display`, `--font-mono`, `--ink-line` and the offset shadows. Components: `.offset-card`, `.mono-meta`, grouped lists. Reuse them; don't create a second palette or button family.
- **The rules** are in the walkthrough's "Rules in force" box and copied into the build plan. The ones most often broken:
  - **Pins, not next door.** Walkers drop pins as they walk. Nothing suggests the next house, and leaders never pre-pin.
  - **The pin sheet** is the outcome grid. On existing pins only, add one quiet grey bar: Don't knock · Another home · History. Tapping away from a new pin with nothing logged removes it. Long-press drops a pin as Don't knock.
  - **The yellow + always opens the logger** (starting on the live walk). There's no "log away from a door" link in walk mode.
  - **No conversation guides** in the UI (stored data stays), and **no email** in forms.
  - **History everywhere uses the follow-up history component**: date over time in mono on the left, the entry on the right.
  - **The Walks / Map / List switch** is always first on the screen, in the same place, with no title above it.
  - **No floating button stacks on maps**, only the locate button.
  - **Routes are picked by hand** (no automatic split). The walk page keeps its routes list, Edit teams and Team activity, but no mini map.

## How to work with this user

- **Build what was agreed; don't invent.** An earlier pass added unrequested features (a "next door" suggestion, an off-door logging link) and CSS-only restyles of screens that were never designed. The user called that "sloppy and disconnected from intended design". If the mockups don't cover something (an empty, error or loading state, or an edge case), use the nearest locked pattern and write it under "Decisions made while building" in the build plan.
- **Don't re-litigate locked decisions.** If something seems wrong, ask, and propose it as a walkthrough change (see below) rather than changing it quietly.
- **Changing a locked screen:** in the walkthrough, press "Reopen for changes" on that screen and let the user review it. The page generates a structured prompt as before.
- **Report honestly:** say what you checked, what you couldn't (this Linux machine has no Xcode, iOS simulator or WebKit), and what still needs a device.

## General design workflow

These are condensed from the project's full workflow file, `docs/design/workflow.md` on `codex/neighborwalk-ios`, and they still apply:

1. Understand the task, the user of the screen and its primary action. Reuse the existing system.
2. Research in proportion to the change. Use Mobbin for new or unfamiliar interactions (6–12 relevant screens), and look at the real screenshots. Don't send private data to design services.
3. Check Apple's HIG and documentation for platform questions. Don't present a Mobbin pattern or personal taste as an Apple requirement.
4. Build every state the feature needs, with realistic synthetic data.
5. Verify the rendered result: small and large layouts, dark mode, text scaling, keyboard, scrolling and truncation. A passing build is not visual verification.
6. Record durable decisions in `docs/design/decisions.md`.

## Commands

| What | Command |
|---|---|
| Sample app for captures and manual checks | `npm run mobile:dev -- --port 4392 --strictPort` → `http://localhost:4392/demo` |
| Lint, types, unit tests | `npm run lint`, `npm run typecheck`, `npx vitest run` |
| iOS bundle | `npm run mobile:build:sample` |
| Mobile UI tests | `MOBILE_TEST_PORT=4392 CHROME_EXECUTABLE=/usr/bin/chromium npx playwright test --config playwright.mobile.config.ts --project chromium` |
| Final check captures | `node docs/design/final-check/capture.mjs [IDs…]` |
| Sync to Xcode (needs a Mac) | `npm run ios:sync` then `npm run ios:open` |

The Node version comes from `mise.toml`. Don't kill a server you didn't start: port 4173 may be the user's.
