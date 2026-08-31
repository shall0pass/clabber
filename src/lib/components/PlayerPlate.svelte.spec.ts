import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import PlayerPlate from './PlayerPlate.svelte';
import type { SeatMeldStatus } from '$lib/clabber/meld';
import type { MeldClaim, PlayerSlot } from '$lib/clabber/types';

// The persistent meld badge is the backstop for docs/test-plan.md item 2:
// every player must be able to see, for the whole hand, that a seat called a
// meld (and what it was, once shown) — the transient "shows meld" reveal alone
// can be missed when two seats show a beat apart.

const player: PlayerSlot = { seat: 0, name: 'Robin', isBot: false, lastSeen: 0 };

const dad: MeldClaim = {
	kind: 'dad',
	group: 'run',
	suit: 'H',
	cards: ['9H', 'TH', 'JH'],
	points: 20,
	top: 3
};

const status = (o: Partial<SeatMeldStatus>): SeatMeldStatus => ({
	declaredCount: 0,
	bella: false,
	shown: [],
	forfeited: false,
	shownPoints: null,
	...o
});

describe('PlayerPlate meld badge', () => {
	it('shows no badge when the seat has no meld', async () => {
		render(PlayerPlate, { player, meld: status({}) });
		await expect.element(page.getByText('Robin')).toBeInTheDocument();
		await expect.element(page.getByText('meld', { exact: true })).not.toBeInTheDocument();
	});

	it('shows "meld" for one called meld — no suit, no strength — before the show', async () => {
		render(PlayerPlate, { player, meld: status({ declaredCount: 1 }) });
		await expect.element(page.getByText('meld', { exact: true })).toBeInTheDocument();
	});

	it('shows the count for multiple called melds', async () => {
		render(PlayerPlate, { player, meld: status({ declaredCount: 2 }) });
		await expect.element(page.getByText('meld ×2')).toBeInTheDocument();
	});

	it('shows "bella" when only bella is held', async () => {
		render(PlayerPlate, { player, meld: status({ bella: true }) });
		await expect.element(page.getByText('bella', { exact: true })).toBeInTheDocument();
	});

	it('reveals the shown meld and its points after the seat has shown', async () => {
		render(PlayerPlate, { player, meld: status({ shown: [dad], shownPoints: 20 }) });
		await expect.element(page.getByText('dad · 20')).toBeInTheDocument();
	});

	it('marks a forfeited meld', async () => {
		render(PlayerPlate, { player, meld: status({ declaredCount: 1, forfeited: true }) });
		await expect.element(page.getByText('meld —')).toBeInTheDocument();
	});
});
