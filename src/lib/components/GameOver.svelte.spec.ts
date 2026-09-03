import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import GameOver from './GameOver.svelte';
import type { GameStore } from '$lib/repo/gameStore.svelte';

// The fireworks canvas isn't what we're testing here.
vi.mock('canvas-confetti', () => ({
	default: Object.assign(() => {}, {
		create: () => Object.assign(() => {}, { reset: () => {} })
	})
}));

function fakeStore(opts: {
	winner: 0 | 1 | null;
	mySeat: number | null;
	running?: [number, number];
	hands?: unknown[];
}) {
	return {
		doc: {
			winner: opts.winner,
			score: { running: opts.running ?? [510, 320], hands: opts.hands ?? [] }
		},
		mySeat: opts.mySeat,
		tryChange: vi.fn()
	} as unknown as GameStore;
}

const handResult = (over: Record<string, unknown> = {}) => ({
	dealer: 0,
	trump: 'H',
	maker: 0,
	trickPoints: [90, 72] as [number, number],
	meldPoints: [0, 0] as [number, number],
	set: false,
	renege: false,
	awarded: [90, 72] as [number, number],
	runningAfter: [90, 72] as [number, number],
	...over
});

describe('GameOver.svelte', () => {
	it('renders nothing until there is a winner', async () => {
		render(GameOver, { store: fakeStore({ winner: null, mySeat: 0 }) });
		await expect.element(page.getByRole('button', { name: 'Play again' })).not.toBeInTheDocument();
	});

	it('celebrates when your team won', async () => {
		render(GameOver, { store: fakeStore({ winner: 0, mySeat: 0 }) });
		await expect.element(page.getByText('We won!')).toBeInTheDocument();
	});

	it('commiserates when your team lost', async () => {
		render(GameOver, { store: fakeStore({ winner: 1, mySeat: 0 }) });
		await expect.element(page.getByText('We lost')).toBeInTheDocument();
	});

	it('names the winning team for a spectator', async () => {
		render(GameOver, { store: fakeStore({ winner: 1, mySeat: null }) });
		await expect.element(page.getByText('Team 2 wins')).toBeInTheDocument();
	});

	it('reveals the per-round score sheet on request', async () => {
		const store = fakeStore({
			winner: 0,
			mySeat: 0,
			running: [510, 320],
			hands: [handResult({ trump: 'H' }), handResult({ trump: 'S', maker: 1, set: true })]
		});
		render(GameOver, { store });

		await expect.element(page.getByText('Total')).not.toBeInTheDocument();
		await page.getByRole('button', { name: 'Review round scores' }).click();

		await expect.element(page.getByText('Total')).toBeInTheDocument();
		await expect.element(page.getByRole('cell', { name: '510' })).toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: 'Hide round scores' }))
			.toBeInTheDocument();
	});

	it('Play again resets to the lobby', async () => {
		const store = fakeStore({ winner: 0, mySeat: 0 });
		render(GameOver, { store });
		await page.getByRole('button', { name: 'Play again' }).click();
		expect(store.tryChange).toHaveBeenCalledWith({ type: 'ResetToLobby' });
	});
});
