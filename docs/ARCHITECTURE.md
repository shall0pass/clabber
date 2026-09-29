# Architecture decisions

## Viewport-driven layout (responsive, no page scroll)

See `docs/responsive-layout-plan.md` for the full plan this implements.

- **Hand sizing is a pure function of the viewport; trick sizing is measured.**
  `src/lib/layout/tableLayout.ts` exports `computeHandLayout(width, height)`
  (my hand's card height and the coarse layout mode — `orientation`,
  `compact` for short landscape, `sideSeatsVertical` for narrow portrait) and
  `fitTrickCardH(availW, availH)` (the largest played-card size that fits a
  measured box). An earlier version of this module tried to _guess_ the fixed
  chrome around the trick area (top-bar height, partner-row height, grid
  gaps) from constants calibrated against one measurement, and every
  real-world variation on that chrome (a badge row appearing, a top bar
  wrapping) broke the guess and reopened clipping bugs. `Table.svelte` now
  gives the trick area its own flex row with a `ResizeObserver` on the real
  "leftover" cell (`data-trick-area`, a `flex-1` child between the left and
  right seat columns) and feeds the _measured_ box straight into
  `fitTrickCardH`. This only stays jitter-free (docs/table-jitter-plan.md) if
  the rest of that row's neighbourhood has a size that depends only on the
  viewport too:
  - The left/right seat columns have a fixed width, `sideColW(width)`
    (18% of the width, 120–200px), so a plate gaining its "1 trick" label or
    a long name can't narrow the cell. In narrow portrait
    (`sideSeatsVertical`) the plates are turned sideways to a fixed 48px and
    the column is content-sized instead; the opponents' fans scale off the
    hand (`deriveShared`), not the trick cards, so that width is
    viewport-only too and there is no measure → resize → measure loop.
    Whether a plate is turned comes from `sideSeatsVertical` (PlayerPlate's
    `rotated` prop), not a width breakpoint: a 568×320 phone is under 640px
    wide but has no height for sideways plates.
  - `PlayerPlate`'s DEAL/MADE/meld badge row is permanently reserved
    (`invisible` when empty, never `hidden`) — a badge appearing mid-hand used
    to be exactly the kind of height change this measurement would otherwise
    read as "the leftover shrank".
  - The turn-button row (Show meld / Call bella / Call renege) is a fixed
    `h-9` with `flex-nowrap`, not just a `min-h-9`.
  - The status slot (`[data-status-slot]`) has a fixed reserved height:
    `min-h-14`, or `h-0` in compact (see below); its content is absolutely
    positioned and never adds flow height.
  - `Table.svelte`'s top band (`GameTopBar`) is always one line — see the
    Learning-mode point below.

  Both `computeHandLayout` and `fitTrickCardH` still depend only on their
  numeric inputs, never game state — the hand's own share of the viewport is
  a plain formula (`heightShare` × height, width-limited), capped by two
  trades against the fixed chrome, in both the compact-landscape and portrait
  branches: `maxHandForTrickFloor` gives the trick area first claim on its
  floor, and `maxHandForRatio` keeps the trick card at least 0.6× the hand
  card where the trick area is height-bound. The chrome constants those
  trades use only steer the hand's size; the trick size is always the
  measured fit, so a constant that drifts from the real DOM costs balance,
  not clipping. `Table.svelte.spec.ts`'s "hand/trick size ratio" block
  checks the rendered ratio across the matrix (viewports where a floor binds
  are excluded). Measured card heights (hand / trick, px): 320×568 56/56,
  375×667 103/74, 390×844 127/79, 430×932 140/92, 768×1024 170/130,
  568×320 71/56, 667×375 94/66, 844×390 98/69, 932×430 108/79,
  1024×768 137/86, 1440×900 170/114.

- **`h-dvh` + `overflow-hidden`, not `min-h-screen`** — `Table`, `Lobby` and
  `JoinScreen` all size their root to the _dynamic_ viewport height (accounts
  for a mobile browser's URL bar) and never let it grow past that. The
  document itself never scrolls; the only internal scroll left is inside
  opt-in panels (chat, log, coach, the score-sheet dropdown, a renege trick
  history) and, as a safety net only, two modals whose normal case is meant
  to fit without it (see plan §7, below).

- **Compact landscape (plan §4)** — short landscape drops the partner's own
  row (merged into the top band via a `center` snippet on `GameTopBar`
  instead, with its badge row dropped rather than reserved there — the one
  place a plate's badge row isn't constant, and it's still not
  game-state-dependent: it's just always absent) and turns the bottom section
  from a stacked column into a row: my plate + turn buttons in a fixed-width
  left column, the hand centred, and a matching right column holding
  trickDone's Continue and the redeal note. This reclaims the height a full
  portrait-style stack would otherwise cost. Compact also reserves no height
  for the status slot (`h-0`): the bidding and meld-call bars overlay the
  lower part of the trick cell (see the bidding/meld-call point below), and
  the side seats sit at the top of their columns so the Learn/Log/Chat
  toggles can dock just above the bottom band, under them.

- **The Learning-mode indicator is not in the top band.** It used to be a
  badge next to the "Leave table" button; a badge is one more thing that can
  push that row to two lines at a narrow width with a wide score, and the top
  band must stay one line at every width (it's part of the fixed chrome the
  measured trick-area sizing depends on). It's a small fixed-size chip on the
  trick-area puck instead (`TrickArea`'s `learning` prop) — a chip on a
  circle whose size never depends on its content can't cause a wrap.

- **The bidding/meld-call bar never covers a played card or the puck.** Both
  `BiddingPanel` and `MeldPanel` are compact bars that grow upward from the
  bottom of the status slot. What they can reach is the lower part of the
  trick box: the bottom seat's card slot and the felt below the puck and the
  side cards. Both bars only show before my card is down (bidding has no
  trick; the meld bar hides once I've played), so that region is empty
  whenever they're up. The bar's wrapper spans the slot (`inset-x-0`), not
  `left-1/2` + translate, which shrink-wrapped it to half the slot's width
  and wrapped the bars onto two or three lines. `scripts/layout-check.mjs`
  fails if the panel intersects a played card, the left/top/right card
  slots (computed from TrickArea's geometry, so the check doesn't depend on
  which cards happen to be down) or the puck, during bidding and meld
  picking.

- **Dock mechanism (plan §6)** — Table publishes `--dock-bottom` on
  `document.documentElement` (cleared on unmount) so the fixed corner widgets
  rendered outside Table (`ChatBox`, in `+page.svelte`) or inside it
  (`LogFeed`, `CoachPanel`) can sit above the hand instead of guessing a fixed
  offset: beside my plate in portrait, just above the bottom band in compact.
  Lobby/JoinScreen never set the property, so those widgets keep their
  default position there. While the hand-scored or game-over dialog is up
  the property drops to 0, putting the toggles in the viewport's bottom
  corners, and both dialogs keep that strip clear (`pb-22`, with their
  `max-h` reduced to match) — so the coach stays reachable without a toggle
  ever covering the dialog's content. Below 360px wide the Chat and Learn toggles show
  only their icon (the word stays for screen readers), since the words don't
  fit beside my plate at 320px. `layout-check.mjs` fails if a toggle
  overlaps the hand, a plate or the trick area's cards, or — while a dialog is
  up — the dialog.

- **Banners sit above the trick box (plan §6).** The announce, meld-reveal and
  meld-scored banners never cover a played card. Outside compact they live in
  an absolute layer that fills exactly the felt between the top band and the
  trick box's top edge (`bannerBand`, from the same viewport-only
  measurement as the trick cell plus `trickBoxH`), bottom-aligned against the
  box. The two text banners share one row (each truncates, full text in
  `title`), and the reveal cards shrink so that row plus the reveal fit — at
  320×568 they're ~47px. Compact has no felt above the trick box (it starts
  right under the top band), so there the banners overlay the top band's
  centre, over the partner plate, in one row with 26px reveal cards. The
  layer is `z-10`, under the top band's `z-20`, so the hand-scored modal
  (rendered inside the top band by `Scoreboard`) sits above any banner still
  showing. The sweep forces all three banners at every viewport (a new
  `doc.seed`, a shown meld and a "declares" log line through the dev store
  handle) and fails if one overlaps a played card, a card slot or the puck,
  or is clipped.

- **The meld picker bar is one line.** Instruction (or, once cards are
  picked, the live preview in its place), Cancel and Call, `flex-nowrap`, with
  only the text truncating; an error message gets its own line above. The
  sweep checks the controls share one row.

- **Meld selection lives in the hand (plan §5)** — `MeldPanel`'s "Call meld"
  puts `Table` into a `meldPicking` state; `MyHand` gets a `selecting` +
  `selected` + `ontoggle` mode where tapping a card toggles it (raised, amber
  ring, `aria-pressed`) instead of playing it, and drag-to-play is disabled.
  This is a presentation change only — the player still picks every card and
  presses Call, and the reducer (`DeclareMeld`) still validates it. No
  auto-detection or suggestion of a meld (see this file's project rule
  below).

- **Hand-scored modal and game-over (plan §7)** — the hand-scored modal
  (`Scoreboard.svelte`) is two columns in short landscape (score table left;
  Continue/renege/waiting right), so the normal, non-renege case fits
  667×375 without its `overflow-y-auto` safety net engaging; the renege trick
  history (the one part long enough that two columns alone don't guarantee a
  fit) has its own scrollbox. Game-over (`GameOver.svelte`) tightens its
  padding and heading size in short landscape to fit 667×375 with the score
  sheet closed.

- **Layout sweep (`scripts/layout-check.mjs`)** — Playwright against the dev
  server, `--learning` for Learning mode. It sits at seat 1 so the first
  bidding turn is always mine, sweeps the matrix at bidding, mid-trick,
  trickDone and handScored in hand one, then the meld picker in hand two (my
  turn in trick one, three cards down). Playing to 500 takes minutes, so it
  then ends the game through the dev-only `globalThis.__clabber` store handle
  (score to 500, phase `gameOver`) and sweeps the game-over screen. Besides
  page overflow and viewport clipping it checks the top band is one line and
  the trick box fits its measured cell, and prints the hand/trick card
  heights per viewport.

## Project rule: players do the work

The UI never auto-detects, warns about, or resolves melds or reneges on the
player's behalf — that's explicit in `CLAUDE.md` and it constrained the meld
selection UI above: `MyHand`'s `selecting` mode only toggles what the player
taps, `classifyMeld` is used to preview what a mid-formation ends up scoring
(the same fed-back "not a meld yet" text this project's older meld picker
already showed) but never to pick cards for you.
