# Clabber — Test & Fix Plan: kill the in-game table jitter

## Symptom

During a hand the whole table nudges up and down (and sometimes sideways) by
tens of pixels every time something toggles: a bot's turn starts or ends, a
banner appears, the meld reveal cycles, the phase panel changes, a trick
completes. The trick area, the four plates and the hand all move together — the
eye keeps re-fixating.

## Root cause, in one sentence

`Table.svelte`'s middle region is a `flex flex-1 flex-col items-center
justify-center` column ([Table.svelte:337](../src/lib/components/Table.svelte#L337))
holding the grid **plus** three conditional banners **plus** the phase panel, so
any height change in any of those siblings re-centres the entire block — and
several of those siblings appear/disappear or resize many times per hand.

## Jitter inventory

| #   | Source                                                                            | Where                                                                       | Toggles                                                                                                                                                                                                               | Flow impact                                                                                                                      |
| --- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Middle column is `flex-1` + `justify-center`** over a pile of toggling siblings | [Table.svelte:337](../src/lib/components/Table.svelte#L337)                 | —                                                                                                                                                                                                                     | **Amplifier.** Turns every child height change into a vertical shift of the grid, ≈ ½ the delta.                                 |
| 2   | `announceBanner` — "X declares…"                                                  | [:385](../src/lib/components/Table.svelte#L385)                             | on for 3.5 s whenever a meld/bella is called; text width varies                                                                                                                                                       | in-flow block ≈ 34 px + `gap-4` 16 px appears/disappears                                                                         |
| 3   | `meldReveal` — the shown cards                                                    | [:394](../src/lib/components/Table.svelte#L394)                             | trick two: one entry per melding seat, 5 s each, **different card counts → different width**                                                                                                                          | in-flow block ≈ 90 px tall, appears, changes size per queue entry, disappears                                                    |
| 4   | `meldBanner` — "Team X scored N for meld"                                         | [:409](../src/lib/components/Table.svelte#L409)                             | once per hand for 3.5 s                                                                                                                                                                                               | in-flow block ≈ 34 px                                                                                                            |
| 5   | **Phase panel swap**                                                              | [:415-438](../src/lib/components/Table.svelte#L415)                         | `bid1/2` → `BiddingPanel` (~130 px) · `meld` → `MeldPanel` (~190 px, taller with the card picker open) · `trick` → **nothing** · `trickDone` → Continue button (~40 px, +`waitingOnTrick` line) · `redeal` → one line | the tallest→empty→short cycle happens at every phase edge, several times per hand                                                |
| 6   | `PlayerPlate` "thinking…" / bid text                                              | [PlayerPlate.svelte:135-139](../src/lib/components/PlayerPlate.svelte#L135) | on/off **every turn change** (~1 s cadence) as the turn walks the table                                                                                                                                               | adds ≈ 55 px of width to whichever plate is on turn                                                                              |
| 7   | `PlayerPlate` trick count                                                         | [PlayerPlate.svelte:141-145](../src/lib/components/PlayerPlate.svelte#L141) | appears once `tricks > 0`, then the number widens 1→2 digits                                                                                                                                                          | adds ≈ 45 px width (`ml-auto`)                                                                                                   |
| 8   | `PlayerPlate` DEAL / MADE / meld chip                                             | [PlayerPlate.svelte:107-133](../src/lib/components/PlayerPlate.svelte#L107) | DEAL/MADE appear at deal/bid and stay; meld chip appears when declared                                                                                                                                                | widen the plate; the **partner (row 1)** plate also grows the grid's first row height                                            |
| 9   | Bottom action row                                                                 | [Table.svelte:457](../src/lib/components/Table.svelte#L457)                 | `Show meld` (trick 2), `Call bella`, `Call renege` toggle                                                                                                                                                             | row height 0 ↔ ~32 px → pushes `MyHand`, and the `flex-1` middle then shrinks to match                                           |
| 10  | `pendingCall` renege confirm                                                      | [:483](../src/lib/components/Table.svelte#L483)                             | user opens/closes                                                                                                                                                                                                     | ~90 px block in the bottom column                                                                                                |
| 11  | `CardFan` width shrinks as a hand depletes                                        | [CardFan.svelte:24-29](../src/lib/components/CardFan.svelte#L24)            | every trick, 6→1 cards                                                                                                                                                                                                | side/top seat cells narrow trick by trick                                                                                        |
| 12  | Grid rows `auto auto auto`                                                        | [Table.svelte:552](../src/lib/components/Table.svelte#L552)                 | —                                                                                                                                                                                                                     | row 1 (partner) and row 3 track heights follow plate content, so #6–8 on the partner plate move row 2 (the whole centre) down/up |

**Not a source (already stable):** `TrickArea`'s outer box is `2·(gap+card)`
derived from `scale` only ([TrickArea.svelte:47-48](../src/lib/components/TrickArea.svelte#L47)),
the puck is a fixed square, played cards are `absolute`. `MyHand`'s container
height is a fixed `height + 20` ([MyHand.svelte](../src/lib/components/MyHand.svelte)).
The grid **columns** are `minmax(0,1fr) auto minmax(0,1fr)` with the `auto`
centre = TrickArea width, so column positions hold — plates that outgrow their
`1fr` track spill symmetrically rather than pushing. Leave these alone.

## Principle

Reserve the space; never re-centre toggling content. Anything that turns on and
off gets a fixed-size home, and the persistent furniture (grid, trick area,
hand) sits at a fixed position regardless of what those homes currently hold.

## Rearrangement — as shipped

### R1 — Pin the grid; transients into a fixed-height slot — DONE

- The banners, the phase panel and the renege prompt moved out of the middle
  flex column into one `relative min-h-14` slot (`[data-status-slot]`) under the
  grid. The active panel / renege prompt is `absolute bottom-0` in that slot and
  grows **upward** over the felt; the three banners are an
  `absolute bottom-full` overlay just above it (`[data-banner-layer]`,
  `pointer-events-none`). Nothing there adds flow height.
- The middle wrapper keeps `flex-1 justify-center` but now holds only the grid +
  the fixed-height slot, so the centred block height is constant and the grid's
  `y` never moves.
- **Also required:** `w-full` on that middle wrapper. Without a definite parent
  width, `.table-grid`'s `min(100%, 760px)` was resolving to the grid's
  _intrinsic_ width, so a plate gaining a "1 trick" label re-sized the whole
  grid and re-centred it (a horizontal jitter the plan had written off). With
  `w-full` the grid is a flat 760 px and plate width changes spill within the
  fixed `1fr` tracks.

### R3 — Fix the centre column — DONE

- `grid-template-columns: minmax(0,1fr) var(--center-w) minmax(0,1fr)`, with
  `--center-w` set from JS to the trick area's own width (mirrors TrickArea's
  card/puck math). The partner plate (which sits in the centre column) can no
  longer widen it and squeeze the side seats. Rows stay `auto` — the current
  single-line plate doesn't change height, so the tracks are already stable.

### R5 — Reserve the `CardFan` footprint — DONE

- New `reserve` prop; `Table` passes `reserve={6}` to the opponent fans. The box
  is sized for `reserve` cards and the `count` shown cards are centred within it,
  so a seat's fan stays put as the hand depletes.

### R2 — Freeze `PlayerPlate`'s box — PARTIAL

- "thinking…" (a ~55 px word that toggled on every turn change) → a fixed 8 px
  pulsing dot. That was the loudest offender.
- The fuller freeze (fixed-width slots for bid / trick-count, plate
  `min-height`) is **not done** — with R1 + R3 in place those changes no longer
  move the table, only make the individual plate breathe slightly. Left as
  follow-up if it still reads as jittery on device.

### R4 — Reserve the bottom action row — DONE

- The Show-meld / Call-bella / Call-renege row is `min-h-9`, so it holds its
  height when empty and never pushes `MyHand`.
- `pendingCall` (#10) now renders in the R1 slot as an overlay, not an inserted
  block in the bottom column.

## Tests

### T1 — `Table.svelte` layout stability — DONE

`src/lib/components/Table.svelte.spec.ts`. Renders `Table` with faked
`store` / `presence` / `host`, `import '../../routes/layout.css'`, a real
`createGame` + `reduce` doc driven to `meld` / `trick` / `trickDone`, and
asserts `.table-grid`'s `getBoundingClientRect()` `top` and `left` move ≤ 2 px
across the phase-panel swap. Also asserts the banner layer and the panel
container are `position: absolute` and the slot keeps a ≥ 48 px height. At
1280 px for now — the 360/768 rows are still to add.

`src/lib/components/CardFan.svelte.spec.ts` covers R5: footprint constant with
`reserve` as `count` falls 6 → 3 → 1; still shrinks without it.

### T2 — `PlayerPlate` box-invariance — NOT DONE

Deferred with the fuller R2. With R1 + R3 the plate no longer moves the table,
so this is only worth adding if the plate itself still reads as breathing.

### T3 — Manual, per release

Play a full hand at 360 / 768 / 1280 px with a screen recording. Scrub and
confirm the trick-area centre and the top of `MyHand` do not jump at: deal,
each bid, bid→meld, meld→trick, every trick→trickDone→next trick, the trick-two
reveal cycling through 2–3 melds, meld banner, hand-scored. A 1–2 px drift from
sub-pixel rounding is fine; a visible hop is a fail.

## Status

- **Done:** R1 (status slot + `w-full` on the middle wrapper), R3 (fixed centre
  column), R4 (reserved action row + renege prompt as overlay), R5 (`CardFan`
  reserve), the loud half of R2 ("thinking…" → dot). T1 + `CardFan` spec.
- **Left:** the fuller R2 (fixed-width slots for bid / trick-count, plate
  `min-height`) + T2, only if the plate still reads as breathing on device;
  T1's 360 / 768 rows; T3 on all three viewports.

## Green gate

`npm run lint` · `npm run check` · `npm test` · `npm run build`. Now:
**195 tests, 24 files** (+4: `Table.svelte.spec.ts` ×2, `CardFan.svelte.spec.ts`
×2).
