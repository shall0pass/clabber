// Sizing for the table screen. See docs/responsive-layout-plan.md §2.
//
// Follow-up pass: this used to be one function that *guessed* the fixed
// chrome around the trick area (top bar height, partner row height, grid
// gaps, ...) from constants calibrated against one measurement, and every
// real-world variation on that chrome (a badge row appearing, a top bar
// wrapping) broke the guess and reopened clipping bugs. The trick area's size
// is now measured directly instead: `Table.svelte` gives the trick area its
// own flex row with a `ResizeObserver` on the actual "leftover" cell, and
// `fitTrickCardH` (exported) just fits the largest card into whatever that
// measurement says is available. That's only jitter-free if the *rest* of the
// row (the partner plate, the status slot, the bottom band) has a height that
// depends only on the viewport too — see PlayerPlate's permanently-reserved
// badge row and the fixed-height turn-button row in Table.svelte, both added
// in the same pass, and docs/table-jitter-plan.md for why this matters.
//
// The hand is still sized from the viewport directly (`computeHandLayout`) —
// nothing to measure there, it's simply given a share of the height/width it
// has. Both functions depend only on their numeric inputs, never game state.

export type Orientation = 'portrait' | 'landscape';

export interface HandLayout {
	orientation: Orientation;
	/** short landscape (roughly every phone in landscape) — the bottom band
	 *  becomes three side-by-side columns instead of a stacked portrait row */
	compact: boolean;
	/** my hand's card height, px */
	handCardH: number;
	/** narrow portrait: rotate the side plates/fans vertical, outboard of the
	 *  trick area, instead of stacking them full width */
	sideSeatsVertical: boolean;
}

export interface SharedSizes {
	/** centre puck diameter, px */
	puck: number;
	/** opponents' face-down fan card height, px */
	fanCardH: number;
	/** meld-reveal banner card height, px */
	revealCardH: number;
}

// Card art aspect ratio (width / height), matching Card.svelte / CardFan / TrickArea.
const CARD_RATIO = 64 / 89;

export const HAND_CAP = 170;
// Lowered from 64 in the follow-up pass: at 320×568 (the smallest portrait
// target) even a floor of 64 left the hand a few px taller than the viewport
// had room for once real chrome (not a guess) was accounted for. 56 matches
// the trick area's own floor — see the "meets the plan targets" test for what
// this looks like at every matrix size.
export const HAND_FLOOR = 56;
export const TRICK_CAP = 130;
export const TRICK_FLOOR = 56;
export const PUCK_FLOOR = 64;

// Hand width for N cards at the standard 0.62 overlap step: (N-1)*0.62*w + w.
// For a 6-card hand that's ≈4.1 card widths — used to size the hand from the
// width it has to spread across.
const HAND_WIDTH_CARDS = 4.1;

// Table root's own left+right padding — the hand spans close to the full
// width it's given (a 6-card hand is deliberately ≈ the whole row), so this
// has to come off the raw viewport width before sizing it, or the hand's own
// rendered width overruns the padded content box and clips past the right
// edge (its container isn't itself clamped to the parent's content width).
const H_PADDING_W = 16;

// Fixed-width side columns (plan §4) — width only, no
// height guesses live here any more.
const COMPACT_SIDE_COL_MIN = 120;
const COMPACT_SIDE_COL_MAX = 200;
const COMPACT_SIDE_COL_SHARE = 0.18;

// The hand doesn't get a measurement (see the module doc — it's sized from
// the viewport directly), but it still has to leave the trick area *some*
// chance of reaching a decent size, and the fixed chrome around both of them
// is genuinely fixed now (not a guess): a single-line top band, the status
// slot's reserved height (see Table.svelte — smaller in compact, since every
// pixel matters more there), a `gap-0.5`/`gap-1` between each. Measured
// against the real rendered DOM (scripts/layout-check.mjs, and
// Table.svelte.spec.ts's "hand/trick size ratio" describe block).
const COMPACT_ROOT_PADDING_H = 4;
const COMPACT_TOP_BAND_H = 36;
const COMPACT_GAPS_H = 6; // 3 × the `gap-0.5` rows
// Compact reserves no height for the status slot: its panels (bidding, meld
// call) overlay the bottom of the trick cell instead — the part below the
// puck and the side cards, which only the bottom seat's card uses, and that
// card isn't down yet while either panel shows. trickDone's Continue sits in
// the bottom band's right-hand column. Those 40px were worth ~12px of trick
// card at 667×375.
const COMPACT_STATUS_SLOT_H = 0;

const PORTRAIT_ROOT_PADDING_H = 12;
const PORTRAIT_TOP_BAND_H = 40;
const PORTRAIT_PARTNER_ROW_H = 88; // plate + fan, its own flex row now (not a grid row)
const PORTRAIT_GAPS_H = 16; // 4 × the root's `gap-1`/`gap-2` rows, between the 5 stacked rows
// My own plate + the turn-button row sit *above* the hand in the same
// stacked bottom column (unlike compact, where they're a side column instead
// — see the `compact` branch, which doesn't need this term at all) — missing
// this was the actual bug behind the ratio test initially failing at
// 375×667: the hand itself was sized correctly, but the trade that's
// supposed to protect the trick area's share never saw this cost, so it
// never engaged.
const PORTRAIT_BOTTOM_CHROME_H = 130;
const PORTRAIT_STATUS_SLOT_H = 56;

const TRICK_FLOOR_BOX_H = TRICK_FLOOR * (36 / 11);
const BOX_H_PER_CARD_H = 36 / 11;
// Table.svelte.spec.ts's "hand/trick size ratio" describe block's own
// threshold — kept in step with it here.
const MIN_TRICK_HAND_RATIO = 0.6;

/** The most the hand can be while still leaving the trick area's own floor in
 *  the height left after `fixedH` and the hand's own `+20` wrapper padding —
 *  the trade both non-compact and compact make, giving the trick area first
 *  claim on its floor rather than letting the hand's full share starve it. */
function maxHandForTrickFloor(fixedH: number, height: number): number {
	return height - fixedH - 20 - TRICK_FLOOR_BOX_H;
}

/** The most the hand can be while still leaving the trick area at least
 *  `MIN_TRICK_HAND_RATIO` of it, assuming the trick area ends up height-bound
 *  (the common case once the hand's own width limit isn't the binding
 *  constraint). */
function maxHandForRatio(fixedH: number, height: number): number {
	return (height - fixedH - 20) / (1 + MIN_TRICK_HAND_RATIO * BOX_H_PER_CARD_H);
}

export function clamp(n: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, n));
}

/** Largest card height whose 2×2 trick box (see TrickArea's own math: puck =
 *  cardH·116/110, gap = puck/2 + 12·cardH/110) fits inside `availW`×`availH`,
 *  capped and floored. `availW`/`availH` should be a *measurement* of the
 *  actual leftover cell (see the module doc), not an estimate. */
export function fitTrickCardH(availW: number, availH: number): number {
	// gap = cardH*(58/110) + cardH*(12/110) = cardH*(7/11)
	// boxH = 2*(gap + cardH) = cardH*(36/11)
	// boxW = 2*(gap + cardW), cardW = cardH*CARD_RATIO
	const boxHPerCardH = 36 / 11;
	const boxWPerCardH = 2 * (7 / 11 + CARD_RATIO);
	const byH = availH / boxHPerCardH;
	const byW = availW / boxWPerCardH;
	return clamp(Math.min(byH, byW), TRICK_FLOOR, TRICK_CAP);
}

/** The trick box's rendered height for a played-card height — the same
 *  rounding as TrickArea (cardH, puck and gap are each rounded to whole px). */
export function trickBoxH(trickCardH: number): number {
	const cardH = Math.round(trickCardH);
	const scale = cardH / 110;
	const puck = Math.round(116 * scale);
	const gap = Math.round(puck / 2 + 12 * scale);
	return 2 * (gap + cardH);
}

/** Sizes that scale off the hand/trick sizes rather than getting their own
 *  budget: opponent fans, the meld-reveal cards, the puck. The fans scale off
 *  the hand, not the trick cards: they sit in the side columns whose width the
 *  trick cell's measurement depends on, so sizing them from that measurement
 *  would be a feedback loop. */
export function deriveShared(trickCardH: number, handCardH: number): SharedSizes {
	const puck = Math.max(PUCK_FLOOR, Math.round(trickCardH * (116 / 110)));
	const fanCardH = clamp(handCardH * 0.28, 32, 56);
	const revealCardH = clamp(handCardH * 0.7, 56, 92);
	return { puck, fanCardH, revealCardH };
}

/** Fixed side-column width, in px: compact landscape's bottom-band columns,
 *  and the left/right seat columns beside the trick cell whenever those seats
 *  aren't `sideSeatsVertical`. A fixed width (rather than the plate's own
 *  content width) keeps the trick area centred and stops a plate gaining its
 *  "1 trick" label from resizing the measured trick cell mid-hand. */
export function sideColW(width: number): number {
	return clamp(width * COMPACT_SIDE_COL_SHARE, COMPACT_SIDE_COL_MIN, COMPACT_SIDE_COL_MAX);
}

/** My hand's card height and the coarse layout mode, from the viewport alone. */
export function computeHandLayout(width: number, height: number): HandLayout {
	const orientation: Orientation = width > height ? 'landscape' : 'portrait';
	const compact = orientation === 'landscape' && height < 500;
	const sideSeatsVertical = orientation === 'portrait' && width < 640;

	if (compact) {
		const availW = width - 2 * sideColW(width) - H_PADDING_W;
		const widthLimit = availW / (HAND_WIDTH_CARDS * CARD_RATIO);
		const naiveHandCardH = clamp(
			Math.min(widthLimit, 0.25 * height, HAND_CAP),
			HAND_FLOOR,
			HAND_CAP
		);
		const fixedH =
			COMPACT_ROOT_PADDING_H + COMPACT_TOP_BAND_H + COMPACT_GAPS_H + COMPACT_STATUS_SLOT_H;
		const handCardH = clamp(
			Math.min(
				naiveHandCardH,
				Math.max(maxHandForTrickFloor(fixedH, height), HAND_FLOOR),
				Math.max(maxHandForRatio(fixedH, height), HAND_FLOOR)
			),
			HAND_FLOOR,
			HAND_CAP
		);
		return { orientation, compact, handCardH, sideSeatsVertical };
	}

	const heightShare = orientation === 'portrait' ? 0.2 : 0.22;
	const widthLimit = (width - H_PADDING_W) / (HAND_WIDTH_CARDS * CARD_RATIO);
	const naiveHandCardH = clamp(
		Math.min(widthLimit, heightShare * height, HAND_CAP),
		HAND_FLOOR,
		HAND_CAP
	);
	const fixedH =
		PORTRAIT_ROOT_PADDING_H +
		PORTRAIT_TOP_BAND_H +
		PORTRAIT_PARTNER_ROW_H +
		PORTRAIT_GAPS_H +
		PORTRAIT_STATUS_SLOT_H +
		PORTRAIT_BOTTOM_CHROME_H;
	const handCardH = clamp(
		Math.min(
			naiveHandCardH,
			Math.max(maxHandForTrickFloor(fixedH, height), HAND_FLOOR),
			Math.max(maxHandForRatio(fixedH, height), HAND_FLOOR)
		),
		HAND_FLOOR,
		HAND_CAP
	);
	return { orientation, compact, handCardH, sideSeatsVertical };
}
