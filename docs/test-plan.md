# Clabber — Test & Fix Plan for the "Items to verify"

This plan turns the two open items in `implementation-plan.md` (§ "Items to
verify") into concrete work: a root-cause review, the fix to make, and the tests
that prove it. Both items must end green on `npm run lint`, `npm run check`,
`npm test`, `npm run build`.

| #   | Item                                                                    | Type                   | Primary artefact                                                |
| --- | ----------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------- |
| 1   | Icon & control placement across screen sizes — buttons always clickable | Layout / responsive    | `src/lib/components/*.svelte` + a viewport matrix               |
| 2   | "I don't always see my partner's meld when it is called"                | Correctness / UI state | `Table.svelte` meld surfacing + a persistent per‑seat indicator |

---

## Item 1 — Icons & controls are always reachable and clickable

### Definition of done

For every supported viewport and every game phase:

- No interactive control (button, checkbox, pencil/icon button, card) is
  clipped by the viewport edge, and no control needs a horizontal scroll to
  reach. The game root never scrolls horizontally at ≥ 320 px.
- Every primary action has a hit target ≥ 44×44 px; secondary/icon controls
  ≥ 24×24 px (WCAG 2.5.8).
- No fixed/absolute overlay (chat, log, coach, scoreboard, "Learning mode"
  badge, offline banner, modals) covers a control the player needs in that
  phase. `document.elementFromPoint(centre)` on each visible control returns
  that control or a descendant.
- Tapping each control through Playwright at each viewport produces the
  expected state change.

### Current layout / overlap inventory

Fixed & absolute layers in the game view (stacking order matters):

| Layer                                                        | Where                              | Position / z                            |
| ------------------------------------------------------------ | ---------------------------------- | --------------------------------------- |
| Offline banner                                               | `routes/+page.svelte:108`          | `fixed inset-x-0 top-0 z-50`            |
| GameOver modal                                               | `components/GameOver.svelte:28`    | `fixed inset-0 z-50`                    |
| Hand‑scored modal                                            | `components/Scoreboard.svelte:137` | `fixed inset-0 z-30`                    |
| ChatBox (toggle + open panel `h-80 w-72`)                    | `components/ChatBox.svelte:88`     | `fixed right-3 bottom-3 z-30`           |
| CoachPanel (toggle + open panel `max-h-[65vh] w-80`)         | `components/CoachPanel.svelte:34`  | `fixed bottom-2 left-2 z-30`            |
| LogFeed (toggle + open panel `w-64 max-h-44`)                | `components/LogFeed.svelte:29`     | `fixed bottom-2 left-2 z-20`            |
| Scoreboard pill                                              | `components/Table.svelte:296`      | `absolute top-3 right-3 z-20`           |
| Leave button + "running the computer players"                | `components/Table.svelte:299`      | `absolute top-3 left-3 z-10`            |
| "Learning mode" badge                                        | `components/Table.svelte:495`      | `absolute right-3 bottom-16`, **no z**  |
| In‑flow action bar: **Show meld / Call bella / Call renege** | `components/Table.svelte:426`      | normal flow, centred above the hand     |
| `MyHand` cards                                               | `components/MyHand.svelte:112`     | `absolute bottom-0`; lifted card `z-10` |

`uiScale` and `isNarrow` come from `Table.svelte:246-258`
(`uiScale = clamp(0.58, innerWidth/720, 1)`, `isNarrow = innerWidth < 640`).
`ChatBox` is mounted for **both** the lobby and the game (`+page.svelte:125`).

### Known / suspected problems (confirm or clear each with the checks below)

1. **ChatBox open panel (`z-30`, bottom‑right) covers the in‑flow action bar**
   (Show meld / Call bella / Call renege) and the right‑hand `MyHand` cards on
   narrow/short screens — the panel is 288 px wide and 320 px tall and wins on
   z‑index over the lifted card's `z-10`.
2. **CoachPanel open panel (`z-30`, bottom‑left, `w-80`)** overlaps the left
   `MyHand` cards / lifted card at small widths. In the default _Learning mode_
   both CoachPanel and LogFeed live in the same corner.
3. **"Learning mode" badge** (`absolute right-3 bottom-16`, no z‑index) sits over
   the hand region and just above the collapsed ChatBox pill; it can overlap the
   right edge of `MyHand` or the action bar on small screens.
4. **Two `z-30` siblings**: the hand‑scored modal and ChatBox. On a short
   viewport the modal's "Next hand" / "Continue" button (bottom of a
   `max-h-[90vh]` card) can land under the ChatBox pill.
5. **`min-h-screen` column, no inner scroll**: on landscape phones
   (`844×390`) the table + hand + bidding/meld panel stack taller than the
   viewport, pushing "Play (♦)" / "Pass" / "Call meld" / "Continue →" below the
   fold with only body scroll to recover them.
6. **The Scoreboard buries the "Leave table" button on narrow screens —
   FIXED.** The top bar was two independent `absolute` islands (`LeaveButton`
   `top-3 left-3 z-10`, `Scoreboard` `top-3 right-3 z-20`) and the score panel
   (`w-72`, capped only at `calc(100vw − 1.5rem)`) opened straight over the
   Leave button: at 375 px it spanned x ≈ 75–363 across the button at x ≈ 12–86;
   at 320 px it covered the whole row. **Fix shipped:** the two are now flex
   siblings in a single `GameTopBar.svelte` row (`flex flex-wrap items-start
justify-between`, Leave group `shrink-0`), the score sheet is a width‑capped
   `absolute` dropdown (`max-w-[calc(100vw-7rem)]`), and `LeaveButton` padding
   was bumped to a ≥ 24 px tap target. Regression test:
   `GameTopBar.svelte.spec.ts` (check A′). Still needs an on‑device visual pass
   for the wrapped state.
7. **Scoreboard pill vs the top opponent's plate**: both occupy the top‑right of
   the grid on narrow screens; the pill (`z-20`) covers the partner's name /
   turn glow (cosmetic — record, low priority).
8. **Lobby**: seat "Sit here" buttons, the pencil rename, the copy‑code button
   and the "Fill empty seats" / "Deal" row at 320 px.

### Viewport matrix

| Label           | Size       | Notes                                      |
| --------------- | ---------- | ------------------------------------------ |
| Small phone     | 320 × 568  | hard minimum (iPhone SE 1st gen)           |
| iPhone SE       | 375 × 667  | SE 2nd/3rd gen — the reported failure case |
| Phone           | 390 × 844  | iPhone‑class portrait                      |
| Large phone     | 414 × 896  |                                            |
| Phone landscape | 844 × 390  | worst case for vertical stacking           |
| Tablet          | 768 × 1024 | `isNarrow` boundary is 640                 |
| Desktop         | 1280 × 800 |                                            |

### Automated checks

**A. Per‑component clickability — `src/lib/components/responsive.svelte.spec.ts`
(new, `client`/chromium project).**

For each of `JoinScreen`, `Lobby`, `BiddingPanel`, `MeldPanel`,
`Scoreboard` (with a `handScored` doc so the modal renders), `GameOver`,
`ChatBox` (forced open): render with a faked `store` (see
`GameOver.svelte.spec.ts` for the `fakeStore` pattern), set the viewport with
`await page.viewport(w, h)`, then for every `getByRole('button')` /
`getByRole('checkbox')`:

- assert `getBoundingClientRect()` is within `[0, w]` horizontally and has
  `width ≥ 24 && height ≥ 24`;
- assert `document.elementFromPoint(cx, cy)` is the element or contained by it;
- click it and assert the wired callback / `store.tryChange` fired.

Loop the widths `[320, 360, 375, 390, 768, 1280]`.

> **CSS in component tests.** `vitest-browser-svelte` renders with **no
> stylesheet**, so `flex` / `absolute` / `w-72` / `calc(100vw…)` do nothing and
> a geometric test is meaningless. Import the Tailwind entry at the top of the
> spec — `import '../../routes/layout.css';` — and `@tailwindcss/vite` injects
> the real utilities. `GameTopBar.svelte.spec.ts` does this.

**A′. Top‑bar collision (regression for item 6) — DONE:
`src/lib/components/GameTopBar.svelte.spec.ts`.** Renders `GameTopBar` (which
composes `LeaveButton` + `Scoreboard`), opens the score sheet, and at widths
`[320, 360, 375, 1280]` × `{1‑digit, 3‑digit}` score asserts the `Leave table`
button: is a ≥ 24 px target, is inside the viewport, does **not** intersect the
open panel's rect, is what `elementFromPoint` returns at its centre, and still
drives `onleave` end to end.

**B. Cross‑layer overlap — ad‑hoc Playwright script (documented here, not part of
`npm test`).** Drive `npm run dev` with `?fast`, one Playwright‑controlled human

- three host bots (same shape as the Phase 5 full‑game E2E). At `360×640` and at
  `844×390`, in phases `meld`, `trick` (1 and 2), `trickDone`, `handScored`,
  `gameOver`, with **ChatBox + CoachPanel + LogFeed all open**:

* every enabled `MyHand` card and every visible action button passes the
  `elementFromPoint` hit test and a real `.click()` changes state;
* `document.scrollingElement.scrollWidth === clientWidth` (no horizontal
  scroll);
* the `handScored` "Next hand" button and the `trickDone` "Continue →" button
  are not covered by any bottom‑corner panel.

### Fixes likely required (finalise after A/B)

- **Top bar (item 6) — DONE.** `LeaveButton` + `Scoreboard` now live in one
  `GameTopBar.svelte` flex row (`absolute inset-x-3 top-3 z-20 flex flex-wrap
items-start justify-between gap-2`, Leave group `shrink-0`, Scoreboard wrapper
  `ml-auto min-w-0`). The score sheet is an `absolute top-full right-0 z-30`
  dropdown capped at `max-w-[calc(100vw-7rem)]`, so it never widens the bar or
  reaches the Leave button; if the row can't fit it wraps instead. `LeaveButton`
  padding bumped to a ≥ 24 px target.
- Give the "Learning mode" badge a place in normal flow (e.g. next to the
  Scoreboard) or a `z` below the action bar and clear of `MyHand`.
- Below `sm`, auto‑collapse ChatBox / CoachPanel / LogFeed, or make them
  mutually exclusive, or raise the in‑flow action bar and `MyHand` into their
  own stacking context above `z-30`.
- Bump the hand‑scored modal to `z-40` so it clears ChatBox.
- On short/landscape viewports let the table area scroll within itself (or drop
  opponent fans / lower the `uiScale` floor) so the action bar stays on screen.
- Add an `overflow-x: hidden` guard on the game and lobby roots; verify no
  horizontal scrollbar at 320 px.

### Manual checklist (record pass/fail per cell)

For each viewport × phase: Join · Lobby · Bidding · Meld · Trick · Trick‑done ·
Hand‑scored modal · Game‑over. Tap **every** control; confirm nothing is
clipped, hidden, or under an overlay, and the pencil/robot/dealer/turn icons
render at the right size.

Explicit for item 6: on the iPhone SE (375 × 667 **and** 320 × 568), open the
Scoreboard and confirm "Leave table" stays fully visible and tappable; repeat
with a 3‑digit running score and with `host.isHost` true (adds the "running the
computer players" line under the button).

---

## Item 2 — Every player sees a meld the moment it's called, and while it's shown

> **Status: fix shipped** (persistent per‑seat badge + reveal queue + all‑match
> announce toast + timer cleanup). Reported again from a live game — a partner's
> meld the team scored on was never seen — which is exactly root cause 3 below.
> Still wants the trick‑two E2E for the reveal‑queue timing.

### Expected behaviour (from the rules doc + plan §8.5)

- **Trick one — a meld is _called_.** Every player is told _that_ a seat holds a
  meld (and/or bella), immediately, and can still see it for the rest of the
  hand — not just for a few seconds. The suit is **not** announced on the call
  (`reducer.ts:352` keeps the log kind‑only; keep that).
- **Trick two — a meld is _shown_.** On each melding seat's turn the actual
  cards are revealed to everyone for a readable window (~10 s per the code
  comment) before that seat plays.
- **After trick two** the "Team X scored N for meld" result is announced.

### Root causes in the current code

All in `src/lib/components/Table.svelte`:

1. **The call is a 3.5 s toast only** — `announceBanner` (`Table.svelte:184-205`).
   Nothing persists on the table, so a player who looks away misses their
   partner's call entirely, and there is no per‑seat record afterwards.
   `PlayerPlate.svelte` has no meld indicator at all.
2. **The toast shows only the first new meld** — `added.find(...)`
   (`Table.svelte:197`). A seat that declares two melds in one change (bots do:
   `announceMeld` pushes one log line per meld, `reducer.ts:342`) announces just
   one of them.
3. **The trick‑two reveal is a single slot that later shows overwrite** —
   `meldReveal` (`Table.svelte:207-230`). Seats show in turn order ~0.5–1.2 s
   apart (bot delay); each new `shownDone` seat reassigns `meldReveal`, so a
   partner's reveal that is followed by an opponent's can flash for well under a
   second instead of the intended 10 s. **This is the most likely literal cause
   of "I don't always see my partner's meld."**
4. **Timer leaks / stale banners** — the `announceBanner` and `meldReveal`
   `$effect`s call `setTimeout` without a cleanup return, so a hand reset or
   fast re‑fire can leave a stale banner or clear the wrong reveal.
5. **`meldBanner`** (the post‑trick‑two result, `Table.svelte:168-182`) is also
   a 3.5 s transient with no lasting record.

### Fix design — as shipped

**Primary: a persistent, per‑seat meld badge visible to everyone.**

`src/lib/clabber/meld.ts` gained a pure selector:

```ts
export interface SeatMeldStatus {
	declaredCount: number; // melds this seat called on trick one
	bella: boolean; // melds.bella === seat
	shown: MeldClaim[]; // populated once the seat has had its trick-two show
	forfeited: boolean; // took the show turn with a declared meld, showed nothing
	shownPoints: number | null; // null until shown (no suit/strength leak on the call)
}
export function seatMeldStatus(doc: GameDoc, seat: Seat): SeatMeldStatus;
export function hasMeld(s: SeatMeldStatus): boolean;
```

`PlayerPlate.svelte` takes a `meld` prop and renders a small amber chip next to
the name: `meld` / `meld ×2` / `bella` before the show; `dad · 20`,
`fifty+bella · 40`, … after the seat's show; `meld —` on forfeit. Present from
the call through `handScored`, for opponents and the local player alike.
`Table.svelte` passes `seatMeldStatus(doc, seat)` to every plate.

**Secondary (all in `Table.svelte`):**

- **Reveal queue.** `meldReveal` is now fed by a FIFO `revealQueue`; each entry
  holds for `MELD_REVEAL_MS` (5000) and only then does `pumpReveals()` advance.
  A later seat's show can no longer wipe the previous reveal off screen. Queue
  and timer are reset on `doc.seed` change; the timer is cleared on unmount via
  a dep‑free `$effect(() => () => clearTimeout(revealTimer))`.
- **All matches, not the first.** `added.find` → `added.filter`; the announce
  toast names every meld/bella called in the change, joined with `·`.
- **Timer hygiene.** `announceBanner` and the reveal queue each have a real
  cleanup now.
- **Bella parity.** The chip shows `bella` for `melds.bella === seat` for every
  viewer.

No reducer/state‑shape change — `doc.melds.declared/bella/shown/shownDone`
already persist for the hand and converge across peers. This is a
**presentation** fix over existing shared state.

### Tests

**Pure unit — `src/lib/clabber/meld.spec.ts` (node) — DONE (+10).**
`seatMeldStatus` / `hasMeld` for: nothing called; one declare (count only, no
`shownPoints`); two declares; separate bella call; bella‑only hand; after
`ShowMeld` (`shown` + `shownPoints`); bella folded into `shownPoints`; forfeit
(`shownDone`, declared, empty `shown`); no forfeit when nothing was declared.

**Component — `src/lib/components/PlayerPlate.svelte.spec.ts` (new, chromium) —
DONE (+6).** With a `meld` prop: renders `meld`, `meld ×2`, `bella`, `dad · 20`
(after show), `meld —` (forfeit); nothing when the seat has no meld.

**Still open:**

- **Reducer — `reducer.spec.ts`.** Explicit persistence assertions: after
  `AnnounceMeld` / `DeclareMeld`, `doc.melds.declared[seat]` / `doc.melds.bella`
  are still readable at `meld`, `trick` (1 & 2), `trickDone`, `handScored`.
  (Existing "never announces the suit" test at `reducer.spec.ts:548` still
  covers that half.)
- **Component — `Table.svelte`** (faked `store`/`presence`/`host`): the partner
  plate chip is present in `meld` and stays through `trick` #1/#2, `trickDone`,
  `handScored`; reveal queue with fake timers shows reveal #1 for ≥
  `MELD_REVEAL_MS` before #2; the announce toast names two melds from one
  change.
- **E2E (ad‑hoc Playwright).** One human + three bots, `?fast`: during trick two
  the human sees each revealed meld for its full window, and every melding seat
  keeps its plate chip until the hand‑scored screen.

---

## Execution order

1. ~~Item 1 top bar (item 6): `GameTopBar.svelte` + `GameTopBar.svelte.spec.ts`
   (check A′).~~ **Done.**
2. ~~Item 2 primary + secondary: `seatMeldStatus` selector + `meld.spec.ts`;
   `PlayerPlate` meld chip + `PlayerPlate.svelte.spec.ts`; reveal queue,
   all‑match announce toast and timer cleanup in `Table.svelte`.~~ **Done.**
3. Item 2 remaining: `reducer.spec.ts` persistence assertions; `Table.svelte`
   component test (chip persistence + reveal‑queue timing + two‑meld toast);
   trick‑two E2E.
4. Item 1 check A (`responsive.svelte.spec.ts`) — let failures drive the
   remaining CSS/z fixes listed above.
5. Item 1 check B + both manual checklists on the seven viewports.
6. Green gate, then update `implementation-plan.md` §"Items to verify" to point
   at the shipped fixes.

## Green gate

`npm run lint` · `npm run check` · `npm test` · `npm run build`. Current
baseline: **191 tests, 22 files** (top‑bar fix +6 `GameTopBar.svelte.spec.ts`;
Item 2 +10 `meld.spec.ts`, +6 `PlayerPlate.svelte.spec.ts`). The pre‑existing
`svelte/prefer-svelte-reactivity` lint error on `new Set<Seat>()` in
`Table.svelte` was cleared in passing (`SvelteSet`).
