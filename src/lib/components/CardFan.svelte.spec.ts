import { page } from 'vitest/browser';
import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import CardFan from './CardFan.svelte';

// docs/table-jitter-plan.md R5 — an opponent's fan keeps a constant footprint
// as the hand depletes, so the seat cell doesn't shrink (and the plate drift)
// trick by trick.

const box = (c: HTMLElement) => (c.firstElementChild as HTMLElement).getBoundingClientRect();

describe('CardFan', () => {
	it('with `reserve`, the footprint is constant as the count falls', async () => {
		const { container, rerender } = render(CardFan, { count: 6, reserve: 6, height: 52 });
		await page.viewport(1000, 800);
		const full = box(container);

		await rerender({ count: 3, reserve: 6, height: 52 });
		const mid = box(container);
		await rerender({ count: 1, reserve: 6, height: 52 });
		const low = box(container);

		expect(Math.abs(mid.width - full.width)).toBeLessThanOrEqual(1);
		expect(Math.abs(low.width - full.width)).toBeLessThanOrEqual(1);
		expect(Math.abs(mid.height - full.height)).toBeLessThanOrEqual(1);
	});

	it('without `reserve`, the footprint shrinks with the count (the old behaviour)', async () => {
		const { container, rerender } = render(CardFan, { count: 6, height: 52 });
		const w6 = box(container).width;
		await rerender({ count: 2, height: 52 });
		const w2 = box(container).width;
		expect(w2).toBeLessThan(w6 - 10);
	});
});
