import '../../routes/layout.css'; // real Tailwind, so the grid and slot geometry is real
import { page } from 'vitest/browser';
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Table from './Table.svelte';
import { reduce } from '$lib/clabber/reducer';
import { chooseCard } from '$lib/clabber/bot';
import { createGame, SEATS } from '$lib/clabber/state';
import type { GameDoc } from '$lib/clabber/types';
import type { GameStore } from '$lib/repo/gameStore.svelte';
import type { Presence } from '$lib/repo/presence.svelte';

// docs/table-jitter-plan.md — the phase panel, the three banners and the renege
// prompt are now absolutely positioned in a fixed-height slot, so none of them
// reflows `.table-grid`.

function fourBotsAtBid(): GameDoc {
	const doc = createGame('jitter', 0);
	for (const s of SEATS) reduce(doc, { type: 'SetBot', seat: s, isBot: true, botName: `Bot ${s}` });
	reduce(doc, { type: 'StartHand', seed: 'jitter-1' });
	return doc;
}

function fourBotsAtMeld(): GameDoc {
	const doc = fourBotsAtBid();
	reduce(doc, { type: 'Bid', seat: doc.bidding!.turn, bid: 'accept' }); // trump made → phase 'meld'
	return doc;
}

function playFullTrick(doc: GameDoc): void {
	while (doc.trick!.plays.length < 4) {
		const seat = doc.trick!.turn;
		if (doc.phase === 'meld' && doc.melds.declared[seat] == null) {
			reduce(doc, { type: 'AnnounceMeld', seat });
		}
		reduce(doc, { type: 'PlayCard', seat, card: chooseCard(doc, seat) });
	}
}

/** phase 'meld' (trick 1, nothing played) */
const meldDoc = () => fourBotsAtMeld();

/** phase 'trickDone' (trick 1's four cards down) */
const trickDoneDoc = () => {
	const d = fourBotsAtMeld();
	playFullTrick(d);
	return d;
};

/** phase 'trick' (into trick 2) */
const trickDoc = () => {
	const d = trickDoneDoc();
	for (const s of SEATS) reduce(d, { type: 'AckTrick', seat: s });
	reduce(d, { type: 'AdvanceTrick' });
	return d;
};

const fakeStore = (doc: GameDoc) =>
	({ doc, mySeat: 0, tryChange: () => true }) as unknown as GameStore;
const presence = { isOnline: () => true } as unknown as Presence;
const props = (doc: GameDoc) => ({ store: fakeStore(doc), presence, onleave: () => {} });

const settle = () => new Promise((r) => setTimeout(r, 60));
const gridRect = () =>
	(document.querySelector('.table-grid') as HTMLElement).getBoundingClientRect();

describe('Table layout stability', () => {
	beforeEach(async () => {
		await page.viewport(1280, 900);
	});

	it('the grid does not move when the phase panel changes', async () => {
		const { rerender } = render(Table, props(meldDoc()));
		await settle();
		const a = gridRect();

		await rerender(props(trickDoc())); // panel: MeldPanel → nothing
		await settle();
		const b = gridRect();

		await rerender(props(trickDoneDoc())); // panel: nothing → Continue button
		await settle();
		const c = gridRect();

		expect(Math.abs(b.top - a.top)).toBeLessThanOrEqual(2);
		expect(Math.abs(c.top - a.top)).toBeLessThanOrEqual(2);
		expect(Math.abs(b.left - a.left)).toBeLessThanOrEqual(1);
		expect(Math.abs(c.left - a.left)).toBeLessThanOrEqual(1);
	});

	// The trick cards are sized from a measurement of their cell, so anything
	// that changed the cell mid-hand (a plate gaining its MADE badge or its
	// "1 trick" label, a panel) would resize them. Bidding (no maker) → meld
	// (MADE badge, no tricks won) → trick two (tricks won) → trickDone must
	// all measure the same.
	for (const [w, h] of [
		[375, 667],
		[667, 375],
		[1024, 768]
	] as const) {
		it(`${w}x${h}: the trick card size does not change across phases`, async () => {
			await page.viewport(w, h);
			const cardH = () => (document.querySelector('[data-card-h]') as HTMLElement).dataset.cardH;
			const { rerender } = render(Table, props(fourBotsAtBid()));
			await new Promise((r) => setTimeout(r, 400));
			const a = cardH();
			const cell = document.querySelector('[data-trick-area]')!.getBoundingClientRect();

			await rerender(props(meldDoc()));
			await new Promise((r) => setTimeout(r, 200));
			expect(cardH()).toBe(a);

			await rerender(props(trickDoc()));
			await new Promise((r) => setTimeout(r, 200));
			expect(cardH()).toBe(a);

			await rerender(props(trickDoneDoc()));
			await new Promise((r) => setTimeout(r, 200));
			expect(cardH()).toBe(a);
			const cell2 = document.querySelector('[data-trick-area]')!.getBoundingClientRect();
			expect(Math.abs(cell2.width - cell.width)).toBeLessThanOrEqual(1);
			expect(Math.abs(cell2.height - cell.height)).toBeLessThanOrEqual(1);
		});
	}

	it('the transient region is out of flow (absolute) and height-reserved', async () => {
		render(Table, props(meldDoc()));
		await settle();

		const slot = document.querySelector('[data-status-slot]') as HTMLElement;
		const banners = document.querySelector('[data-banner-layer]') as HTMLElement;
		const panel = slot.querySelector(':scope > div:last-child') as HTMLElement;

		expect(slot.getBoundingClientRect().height).toBeGreaterThanOrEqual(48);
		expect(getComputedStyle(banners).position).toBe('absolute');
		expect(getComputedStyle(panel).position).toBe('absolute');
	});
});

// docs/responsive-layout-plan.md §Verification/4 — a portrait and a landscape
// viewport, neither scrolls, and the hand/plates/trick area are all fully
// inside the visible viewport (not just "the document doesn't scroll" —
// content can still be silently clipped by `overflow-hidden` even when it
// is, which is what `scripts/layout-check.mjs` is for at a fuller matrix).
describe('Table layout fits the viewport', () => {
	const insideViewport = (r: DOMRect, w: number, h: number) => {
		const margin = 0.5;
		expect(r.top).toBeGreaterThanOrEqual(-margin);
		expect(r.left).toBeGreaterThanOrEqual(-margin);
		expect(r.right).toBeLessThanOrEqual(w + margin);
		expect(r.bottom).toBeLessThanOrEqual(h + margin);
	};

	for (const [w, h] of [
		[390, 844],
		[844, 390]
	] as const) {
		it(`${w}x${h}: no overflow, hand/plates/trick area all on-screen`, async () => {
			await page.viewport(w, h);
			render(Table, props(trickDoc()));
			// Two independent `ResizeObserver`s (the table root, the trick area's
			// own leftover cell) settle over a couple of animation frames —
			// `settle()`'s 60ms is enough for the jitter tests above but not
			// always for this.
			await new Promise((r) => setTimeout(r, 400));

			expect(document.documentElement.scrollHeight).toBeLessThanOrEqual(h + 1);
			expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w + 1);

			const hand = document.querySelector('[aria-label="your hand"]');
			expect(hand).toBeTruthy();
			insideViewport(hand!.getBoundingClientRect(), w, h);

			insideViewport(gridRect(), w, h);

			const trickArea = document.querySelector('[data-trick-area]');
			expect(trickArea).toBeTruthy();
			insideViewport(trickArea!.getBoundingClientRect(), w, h);
		});
	}
});

// Follow-up pass item 4 — the trick area used to sit at its floor (56px) while
// the hand grew close to its cap (up to 169px), a lopsided split. This
// measures the *real* rendered sizes (not the formulas that produce them —
// the trick area's size comes from a live measurement, so a pure-function
// test can't see it) across the viewport matrix and checks the trick area is
// a reasonable fraction of the hand wherever neither is pinned to its floor
// (right at a floor, a bigger ratio usually isn't achievable — see
// tableLayout.ts's HAND_FLOOR/TRICK_FLOOR).
describe('Table hand/trick size ratio', () => {
	const MATRIX: [number, number][] = [
		[320, 568],
		[375, 667],
		[390, 844],
		[430, 932],
		[768, 1024],
		[568, 320],
		[667, 375],
		[844, 390],
		[932, 430],
		[1024, 768],
		[1440, 900]
	];
	const FLOOR = 56; // tableLayout.ts's HAND_FLOOR / TRICK_FLOOR
	const MIN_RATIO = 0.6;

	for (const [w, h] of MATRIX) {
		it(`${w}x${h}: trick card height is a reasonable fraction of the hand's`, async () => {
			await page.viewport(w, h);
			render(Table, props(trickDoc()));
			await new Promise((r) => setTimeout(r, 400));

			const handCard = document.querySelector('[aria-label="your hand"] .card') as HTMLElement;
			const trickBox = document.querySelector('[data-card-h]') as HTMLElement;
			expect(handCard).toBeTruthy();
			expect(trickBox).toBeTruthy();

			const handCardH = handCard.getBoundingClientRect().height;
			// TrickArea publishes the played-card height it renders at (the puck
			// has its own floor, so it can't stand in for it).
			const trickCardH = Number(trickBox.dataset.cardH);

			if (handCardH <= FLOOR + 1 || trickCardH <= FLOOR + 1) return; // a floor binds — excluded

			expect(trickCardH).toBeGreaterThanOrEqual(MIN_RATIO * handCardH);
		});
	}
});
