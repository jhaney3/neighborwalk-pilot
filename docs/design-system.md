# NeighborWalk design system ("hedge and porch light")

The iOS app uses a native iOS structure with a neighborhood palette. This note
is the reference for adding or changing screens.

## Voice

- One word per idea: **Walk**, **Neighborhood**, **Route**, **Home**,
  **Conversation**, **Follow-up**, **Team**, **Don't knock**. Database names are
  unchanged; only people-facing words follow this list.
- Plain sentences, sentence case, no all-caps labels, no reassurance clauses.
  Put privacy and policy explanations in Help, not inline on every screen.
- Show record states with human labels from `lib/status-labels.ts`, never raw
  enum values.

## Tokens (`app/styles/foundation.css`)

| Role | Light | Dark |
|---|---|---|
| Paper (`--bg-grouped`) | `#f1f2ec` | `#121714` |
| Card (`--bg-grouped-2`) | `#fcfcf9` | `#1b221d` |
| Ink (`--label`) | `#1b231e` | `#eef1ea` |
| Hedge (`--tint`) | `#2d5a45` | `#8cc7a6` |
| Hero surface (`--hero-bg`) | `#2d5a45` | `#1f3d30` |
| Porch light (`--accent`) | `#e5a53c` | `#efb44e` |

- The porch-light amber is reserved for **Log a conversation**, live walks and
  things that need you. Everything else uses hedge green or neutrals.
- Titles use `--font-display` (Apple's New York serif); everything else uses
  the system font. Spacing uses `--space-1…8`; radii are 12 (controls),
  14 (rows), 16–22 (cards and sheets).
- Visit outcomes share one color per outcome via `[data-outcome]` and `--o`
  (`app/styles/fieldwork.css`); the map uses the same colors from
  `outcomeMeta` in `lib/domain.ts`.

## Components (`components/ui.tsx`, `components/visuals.tsx`)

- `ListGroup` / `ListRow`: the default container for anything row-shaped.
- `Badge`, `SegmentedControl`, `BackButton`, `Avatar`, `Modal` (a bottom sheet
  on phones) and `ConfirmProvider` / `useConfirm` (never `window.confirm`).
- `NeighborhoodShape`: a neighborhood's boundary with each home as a dot in its
  outcome color. It needs no map tiles, so it works offline and in both themes.
- `ProgressRing`, `avatarTone` (stable warm tint per person), `BrandMark` (a
  house with the porch light on) and `StreetScene` (sign-in and empty Home).

## Stylesheet order

`foundation → primitives → visuals → feature files → readiness (legacy) →
home → shell → conversations → walks → fieldwork → walk-setup →
walk-target-planner → polish`. New screen work goes in its own feature file
after `readiness.css`; `polish.css` holds final overrides of legacy rules. Both
`app/globals.css` and `mobile/main.tsx` list the files and must stay in sync.
