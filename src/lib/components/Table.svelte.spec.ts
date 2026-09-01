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

function fourBotsAtMeld(): GameDoc {
	const doc = createGame('jitter', 0);
	for (const s of SEATS) reduce(doc, { type: 'SetBot', seat: s, isBot: true, botName: `Bot ${s}` });
	reduce(doc, { type: 'StartHand', seed: 'jitter-1' });
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
