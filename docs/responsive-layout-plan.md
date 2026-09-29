# Clabber — Plan: fit the game to any screen, portrait or landscape, without scrolling

## Goal

Every game screen (join, lobby, table, hand-scored and game-over overlays) fits
inside the visible viewport in **both portrait and landscape** with **no page
scroll** (vertical or horizontal), and uses the space it has: bigger cards where
there's room, a side-by-side arrangement where height is short.

Closes `docs/TODO.md` item 1.

## Measured baseline (before this change)

Headless Chromium, real game vs bots, `document.documentElement.scrollHeight − innerHeight`:

| Viewport                                | Screen | Overflow                                               |
| --------------------------------------- | ------ | ------------------------------------------------------ |
| 667×375 (SE landscape)                  | table  | **453 px**                                             |
| 844×390 (iPhone landscape)              | table  | **478 px**                                             |
| 1024×768 (tablet landscape)             | table  | **100 px**                                             |
| 375×667 / 390×844 / 768×1024 / 1440×900 | table  | 0                                                      |
| 844×390                                 | join   | 184 px                                                 |
| 375×667                                 | lobby  | 541 px (plus horizontal overflow — right seat clipped) |
| 844×390                                 | lobby  | 798 px                                                 |

Other problems seen in screenshots:

1. **Cards are sized from width only.** `Table.svelte` sets `uiScale = clamp(innerWidth / 720, 0.58, 1)`,
   so landscape phones get full-size cards stacked vertically (hence the overflow), and a
   390×844 portrait phone gets a ~76 px-tall hand with ~300 px of empty felt above it.
2. **`min-h-screen` (100vh)** — on mobile browsers 100vh is taller than the visible area
   (URL bar), which forces a scroll even when content "fits". No safe-area insets are
   honoured although `app.html` sets `viewport-fit=cover`.
3. **Fixed corner widgets collide with the table**: the 💬 Chat button covers the right-most
   hand card in portrait; Log / 🎓 Learn / "Learning mode" badge sit over the felt at
   fixed offsets that know nothing about the hand.
4. **Top bar is `absolute`** and overlaps the partner plate on 375-wide portrait.
5. **Meld picker** renders a second, tiny (44 px) copy of the hand inside a panel that
   covers the trick area — on a phone it hides the led card you need to see.
6. **Banners** ("X declares dad") sit over the trick cards on small portrait screens.
7. Overlays use `max-h-[90vh]` / `max-h-[65vh]` (vh, not dvh).

## Design

### 1. One viewport-sized frame

- Table root: `h-dvh w-full overflow-hidden` (replace `min-h-screen`), padding from
  `env(safe-area-inset-*)` plus the normal gutter. Same for Lobby and JoinScreen roots
  (`min-h-dvh` is **not** enough — they must fit, not grow).
- The page must never scroll: acceptance is `scrollHeight <= innerHeight` and
  `scrollWidth <= innerWidth` on every screen in the test matrix.
- Internal scroll is allowed **only** inside opt-in panels the user opens: chat
  message list, log list, coach panel, score-sheet dropdown, and the renege trick
  history inside the hand-scored modal.

### 2. A pure layout function, driven by both dimensions

New module `src/lib/layout/tableLayout.ts` (pure, no DOM):

```ts
export type Orientation = 'portrait' | 'landscape';
export interface TableLayout {
	orientation: Orientation;
	compact: boolean; // short landscape (h < ~500) — side-by-side bottom band
	handCardH: number; // px, my hand
	trickCardH: number; // px, played cards
	puck: number; // px, centre puck diameter
	fanCardH: number; // px, opponents' face-down fans
	revealCardH: number; // px, meld-reveal banner cards
	sideSeatsVertical: boolean; // rotated side plates + vertical fans (narrow portrait)
}
export function computeTableLayout(width: number, height: number): TableLayout;
```

- Inputs are the **available** box (viewport minus safe-area/padding), measured with a
  `ResizeObserver` on the table root (fall back to `window` resize +
  `visualViewport` resize). Replace the current `uiScale` / `isNarrow` effect.
- **Depends only on the viewport, never on game state** — this preserves the
  anti-jitter invariants from `docs/table-jitter-plan.md` (nothing reflows when a
  banner, panel or chip toggles).
- Solve against a vertical budget, not a width guess. Suggested rules (tune by
  measurement, keep the numbers as named constants):
  - Hand: 6 cards overlap at 0.62 step → hand width ≈ 4.1 × cardW. `handCardH =
min(widthLimit, heightShare × h, 170)` where `heightShare` ≈ 0.20 portrait,
    ≈ 0.30 compact landscape. Width limit leaves room for side gutters in compact
    landscape (see §4).
  - Trick area box is `2·(gap + cardW)` × `2·(gap + cardH)` (see `TrickArea.svelte`);
    choose `trickCardH` as the largest value whose box fits the height left after the
    fixed rows and the width left after the side seats. Cap ~130 px.
  - Floors so things stay legible: hand ≥ 64 px, trick ≥ 56 px, puck ≥ 64 px. On the
    smallest target (568×320) floors win and sizes stop there — record the result.
- Targets for "optimize", checked by the layout test:
  - 390×844 portrait: hand card ≥ **110 px** tall (was ~76).
  - 375×667 portrait: hand ≥ 95 px.
  - 844×390 / 667×375 landscape: hand ≥ 90 / 80 px, trick ≥ 64 px, zero overflow.
- Unit tests `src/lib/layout/tableLayout.spec.ts` (plain vitest): every matrix viewport
  produces a layout whose summed row heights fit the height and widths fit the width;
  monotonic (bigger viewport never gives smaller cards); floors respected.

`TrickArea`, `MyHand`, `CardFan`, the meld-reveal cards and `centerColW` all take their
sizes from this layout object instead of `px(n)` / `scale`.

### 3. Portrait arrangement (`orientation === 'portrait'`)

CSS grid on the table root, rows top→bottom:

1. **Top bar** — real row (not `absolute`): Leave · (Learning badge) · score pill. ~40 px.
2. **Partner** plate + fan.
3. **Middle** — left seat · trick area · right seat (existing `.table-grid` 3-column
   idea; keep the fixed centre column). This row is `1fr` and takes the slack.
4. **Status slot** (existing `data-status-slot` behaviour: banners + phase panel
   absolutely positioned, anchored so they grow upward over the felt).
5. **Dock row**: [Log][🎓 Learn] … my plate + turn buttons (Show meld / Call bella /
   Call renege) … [💬 Chat]. One row, fixed min-height so buttons appearing never move
   the hand.
6. **Hand**, full width, sized per §2.

Narrow portrait keeps the rotated side plates / vertical fans (`sideSeatsVertical`).

### 4. Landscape arrangement

Applies when `width > height`. When `compact` (short landscape, h < ~500 — every phone):

- **Top band** (~40 px): Leave top-left · partner plate with its fan **inline beside it**
  (horizontal, one line) centred · score pill top-right. No separate top-bar row.
- **Middle**: left seat · trick area · right seat. Side seats: plate on top, horizontal
  fan below (there's plenty of width). Trick area fills the remaining height.
- **Bottom band**: three columns —
  - left: my plate + turn buttons (Show meld / Call bella / Call renege), stacked;
  - centre: my hand;
  - right: phase panel slot for trickDone "Continue →" and the redeal note; chat/log/
    learn toggles sit in the corners of this band.
    Side columns have a fixed width (e.g. `clamp(120px, 18vw, 200px)`) so the hand never
    sits under a corner widget.
- **Bidding panel** / **meld call bar** / **renege confirm**: overlay centred on the
  trick area (the trick area is empty or near-empty then), compact variant: up-card at
  `trickCardH`, buttons in one row. Must fit inside the trick-area box.

Non-compact landscape (tablet 1024×768, desktop) uses the portrait row structure but
with the §2 sizing, so it fits by construction (fixes the 100 px tablet overflow).

### 5. Meld calling uses the real hand

Replace the in-panel mini-hand with selection **in `MyHand` itself**:

- `MeldPanel` "Call meld" puts the table into picking mode. `MyHand` gets a
  `selecting` mode + `selected` set + `ontoggle` callback: tapping a card toggles it
  (raised + amber ring, `aria-pressed`), **never plays it**. Drag-to-play is disabled
  while selecting.
- `MeldPanel` shrinks to a one-line bar: "Tap the cards that make one meld · Dad ♦ — 20
  / not a meld yet · [Cancel] [Call]". Error text stays.
- This is a presentation change only: the player still chooses the cards and presses
  Call; the reducer still validates. No auto-detection or suggestion of melds (house
  rule — see CLAUDE.md "Players do the work").
- Keep `MeldPanel` working for the existing declared-melds list.

### 6. Transient overlays never cover what you need

- Banner layer (announce / meld reveal / meld scored) anchors to the **top edge of the
  trick area**, over the partner-side felt, width-capped to the centre column + side
  gutters; reveal cards use `revealCardH`. Still absolutely positioned (no reflow).
- Fixed widgets (`ChatBox`, `LogFeed`, `CoachPanel`, Learning badge): Table publishes
  the dock position so they sit in the dock row (portrait) / bottom-band corners
  (landscape). Suggested mechanism: Table sets CSS custom properties on
  `document.documentElement` (`--dock-bottom`, `--dock-inset-x`) on mount/resize and
  clears them on destroy; the widgets use `bottom: calc(var(--dock-bottom, 0px) + …)`.
  Lobby/join (no dock) keep today's positions. Engineer may choose a cleaner
  mechanism if one appears, but ChatBox is rendered by `+page.svelte`, outside Table.
- Open panels (chat, log, coach, score dropdown) cap at
  `max-h-[calc(100dvh-<top band>-<margin>)]` with internal scroll, and open upward/
  downward so they stay on-screen in short landscape.
- Learning-mode badge moves into the top band.

### 7. Hand-scored modal and game-over

- `max-h-[calc(100dvh-1rem)]` (dvh), `overflow-y-auto` kept as a safety net only.
- In short landscape, the hand-scored modal becomes two columns: score table on the
  left; Continue / Call renege / waiting text on the right — fits 667×375 with no
  internal scroll in the normal (non-renege) case. Renege trick history may scroll
  inside its own box.
- Game-over: tighter padding at short heights (`p-8` → `p-4`), fits 667×375 with the
  score sheet closed.

### 8. Lobby and join screen

- **Lobby portrait**: shrink `Seat` (`w-40` → responsive, e.g. `w-[min(10rem,28vw)]`) so
  the 3-column seat grid never exceeds the width; setting descriptions collapse behind a
  "What's this?" `<details>` (or ⓘ toggle) so the screen fits 375×667. Keep all wording.
- **Lobby landscape**: two columns — seat grid left, code + Fill/Deal + settings right.
- **Join screen**: at short heights reduce vertical spacing; in landscape put the open-
  games list beside the code/create form. Fits 844×390 and 667×375.

### 9. Mobile hygiene

- `html, body { overscroll-behavior: none; }` and `background: #14532d` (green-900) in
  `layout.css`, so rubber-banding doesn't flash white.
- Hand cards keep ≥ 44 px effective tap width where possible; note if the floor size
  at 568×320 violates this.
- Don't lock orientation; both are first-class.

## Verification

### Automated

1. `src/lib/layout/tableLayout.spec.ts` — pure layout maths (see §2).
2. Existing browser specs (`Table.svelte.spec.ts`, `MyHand.svelte.spec.ts`,
   `CardFan.svelte.spec.ts`, `PlayerPlate.svelte.spec.ts`, `GameTopBar.svelte.spec.ts`,
   `GameOver.svelte.spec.ts`) keep passing. The jitter tests rely on `.table-grid`,
   `[data-status-slot]` and `[data-banner-layer]` — keep those hooks, or update the tests
   deliberately with the same invariants (grid doesn't move when panels/banners toggle).
3. Add to `MyHand.svelte.spec.ts`: in `selecting` mode a tap toggles selection and does
   **not** call `onplay`.
4. Add a Table browser spec that renders at a portrait and a landscape viewport
   (`page.viewport(w, h)`) and asserts: no document overflow; hand, all four plates and
   the trick area are fully inside the viewport; hand rect doesn't intersect the chat
   button.
5. **Layout sweep script** `scripts/layout-check.mjs` (Playwright, run manually against
   `npm run dev` + `npm run sync:dev`, `?fast`): creates a game, sits, fills bots, deals,
   and at each phase — lobby, bidding (my turn), meld phase with picker open, mid-trick
   (≥ 2 cards down), trickDone, handScored — resizes through the matrix and reports
   overflow + overlaps (hand vs chat/log/learn buttons; partner plate vs top-bar items;
   panel vs hand) and saves screenshots to a gitignored folder. Exit non-zero on any
   failure. Run once with Learning mode on (coach + log visible) and once off.

Viewport matrix: 320×568, 375×667, 390×844, 430×932 (portrait phones); 568×320,
667×375, 844×390, 932×430 (landscape phones); 768×1024, 1024×768 (tablet); 1440×900
(desktop). 568×320 / 320×568 are "must not scroll, may be cramped".

### Commands

`npm test`, `npm run check`, `npm run lint` all clean.

## Docs to update

- `docs/ARCHITECTURE.md` — new section: viewport-driven layout (`computeTableLayout`,
  dvh frame, no page scroll, dock mechanism for fixed widgets, meld selection in hand).
- `docs/TODO.md` — remove item 1 (landscape view); add anything deferred.
- `docs/USER_MANUAL.md` does not exist yet — do not create it for this change.

## Out of scope

Game rules, bot logic, sync, card art. No change to what the player is responsible for.
