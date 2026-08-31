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

## Rearrangement

### R1 — Pin the grid; give the transients a fixed-height zone _(biggest win)_

- Middle wrapper: drop `flex-1 justify-center`. Use `justify-start` with a fixed
  top offset (or keep `flex-1` but `justify-start`), so `.table-grid` sits at a
  constant `y` for the whole hand.
- Replace banners #2–4 **and** the phase panel #5 with **one status zone**
  directly under the grid: a container with `min-height` set to its tallest
  state (measure `MeldPanel` with the picker open — likely ~200 px) and
  `display: grid; place-items: center`. Whatever is active renders into it; the
  zone never resizes.
- The three banners become an **overlay layer** inside that zone
  (`position: absolute; inset: 0`, `pointer-events: none`, centred) so they
  stack over the panel instead of adding flow height. Only one banner shows at a
  time in practice; if two coincide, stack them in a small flex column that's
  still inside the fixed zone.

### R2 — Freeze `PlayerPlate`'s box

- Render "thinking…" / bid / trick-count in **fixed-width slots** that are
  always in the DOM (`visibility: hidden` / a `min-w` spacer when inactive), so
  the plate width is the same whether or not it's that seat's turn.
- Prefer swapping the **"thinking…" text for a fixed 16 px indicator** (a
  pulsing dot or a tiny spinner) — the turn is already shown by the ring glow,
  and a growing/shrinking word every second is the most visible offender.
- Give the plate a `min-height` so DEAL/MADE/meld-chip appearing doesn't change
  its height. Reserve one line for the trick count from the start of the hand.

### R3 — Fix the grid track sizes

- `grid-template-rows: auto auto auto` → give row 1 and row 3 an explicit
  `minmax(<plate-max + fan>, auto)` (or a flat fixed height), and row 2 the
  TrickArea height. With R2 done, "plate-max" is a constant, so the tracks stop
  moving.

### R4 — Reserve the bottom action row

- `<div class="… min-h-[36px]">` on the Show-meld/Call-bella/Call-renege row
  ([Table.svelte:457](../src/lib/components/Table.svelte#L457)) so it holds its
  height when empty. Better: fold these buttons into the R1 status zone (they're
  turn-scoped actions like the panels) and keep the bottom column = plate + hand
  only, both fixed-size.
- `pendingCall` (#10): render it as an overlay/popover rather than an inserted
  block, or inside the reserved zone.

### R5 — Reserve the `CardFan` footprint

- Add a `reserve` prop (max hand size, 6) so `boxW`/`boxH` are computed from
  `reserve`, not `count`; still render only `count` cards. Opponent seats then
  keep a constant footprint all hand.

## Tests

### T1 — `Table.svelte` layout-stability spec _(new, chromium)_

`src/lib/components/Table.svelte.spec.ts`. Render `Table` with faked
`store` / `presence` / `host` (see `GameOver.svelte.spec.ts` `fakeStore`;
`presence.isOnline` → `() => true`; `host.isHost` → `false`), import
`../../routes/layout.css` so real Tailwind applies, and `await page.viewport(w,h)`.

Drive the faked `doc` through a scripted hand and, after each transition, read
`document.querySelector('.table-grid').getBoundingClientRect()` and the
TrickArea centre; assert **`top` and `left` move ≤ 1 px** across all of:

- `bid1` → `bid2` → `meld` → `trick` #1 → `trickDone` → `trick` #2 …
  → `trickDone` (#6) → `handScored`;
- turn walking seats 0→1→2→3 within a trick (source #6);
- `announceBanner` on/off, `meldBanner` on/off, `meldReveal` present with 3
  cards then 5 cards then gone (source #3);
- the bottom action row gaining/losing `Show meld` + `Call bella` (source #9).

Run the matrix at `[360, 768, 1280]` wide.

### T2 — `PlayerPlate` box-invariance _(extend `PlayerPlate.svelte.spec.ts`)_

For a fixed `player`, snapshot `getBoundingClientRect()` of the plate, then
re-render toggling each of `isTurn`, `isThinking`, `lastBid: 'pass'`,
`tricks: 0→1→12`, `isDealer`, `isMaker`, `meld` (none → 1 → shown). Assert
width and height are unchanged (± 1 px) after R2. Needs `../../routes/layout.css`
imported for real metrics.

### T3 — Manual, per release

Play a full hand at 360 / 768 / 1280 px with a screen recording. Scrub and
confirm the trick-area centre and the top of `MyHand` do not jump at: deal,
each bid, bid→meld, meld→trick, every trick→trickDone→next trick, the trick-two
reveal cycling through 2–3 melds, meld banner, hand-scored. A 1–2 px drift from
sub-pixel rounding is fine; a visible hop is a fail.

## Execution order

1. R1 (status zone + pin the grid) — clears #1–5, #10. Land T1 alongside.
2. R2 + R3 (`PlayerPlate` box + grid tracks) — clears #6–8, #12. Land T2.
3. R4, R5 — clears #9, #11.
4. T3 on the three viewports.

## Green gate

`npm run lint` · `npm run check` · `npm test` · `npm run build`. Baseline
before this work: **191 tests, 22 files**.
