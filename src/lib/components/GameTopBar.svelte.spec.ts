import '../../routes/layout.css'; // real Tailwind utilities, so the layout is real
import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import GameTopBar from './GameTopBar.svelte';
import type { GameStore } from '$lib/repo/gameStore.svelte';

// Regression for docs/test-plan.md item 6: on a narrow screen the expanded
// score sheet used to open on top of the "Leave table" button and bury it (the
// two were separate absolute islands, the panel wider and higher in the stack).
// They are flex siblings now, so the panel must never cover the button.

function fakeStore(running: [number, number]): GameStore {
	return {
		doc: {
			phase: 'trick',
			score: { running, hands: [] },
			players: [null, null, null, null],
			handAcks: [false, false, false, false],
			advanced: false,
			renege: null
		},
		mySeat: 0,
		tryChange: vi.fn()
	} as unknown as GameStore;
}

const VIEWPORTS = [
	[320, 568],
	[360, 640],
	[375, 667],
	[1280, 800]
] as const;

// early game, and a late-game 3-digit score which widens the pill the most
const SCORES = [
	[0, 0],
	[240, 315]
] as const;

const rectsOverlap = (a: DOMRect, b: DOMRect) =>
	a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

describe('GameTopBar.svelte — the score sheet never buries "Leave table"', () => {
	for (const [w, h] of VIEWPORTS) {
		for (const [us, them] of SCORES) {
			it(`${w}px / score ${us}-${them}: Leave stays visible and clickable with the sheet open`, async () => {
				await page.viewport(w, h);
				const onleave = vi.fn();
				render(GameTopBar, { store: fakeStore([us, them]), isHost: true, onleave });

				await page.getByRole('button', { name: /to 500/ }).click();
				const panelEl = page.getByText('Score sheet').element().closest('div') as HTMLElement;

				const leave = page.getByRole('button', { name: 'Leave table' });
				await expect.element(leave).toBeVisible();
				const leaveEl = leave.element() as HTMLElement;

				const lr = leaveEl.getBoundingClientRect();
				const pr = panelEl.getBoundingClientRect();

				// on screen, sensible tap target, and not clipped by the viewport
				expect(lr.width).toBeGreaterThanOrEqual(24);
				expect(lr.height).toBeGreaterThanOrEqual(24);
				expect(lr.left).toBeGreaterThanOrEqual(0);
				expect(lr.right).toBeLessThanOrEqual(w + 0.5);

				// the open score sheet does not sit over the button, by geometry…
				expect(rectsOverlap(lr, pr)).toBe(false);

				// …and nothing is painted over its centre
				const hit = document.elementFromPoint(lr.left + lr.width / 2, lr.top + lr.height / 2);
				expect(leaveEl === hit || leaveEl.contains(hit)).toBe(true);

				// still works end to end
				await leave.click();
				await page.getByRole('button', { name: 'Leave' }).click();
				expect(onleave).toHaveBeenCalledTimes(1);
			});
		}
	}
});
