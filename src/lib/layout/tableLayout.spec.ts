import { describe, it, expect } from 'vitest';
import {
	computeHandLayout,
	deriveShared,
	fitTrickCardH,
	HAND_FLOOR,
	HAND_CAP,
	TRICK_FLOOR,
	TRICK_CAP
} from './tableLayout';

// docs/responsive-layout-plan.md §2's viewport matrix.
const PORTRAIT: [number, number][] = [
	[320, 568],
	[375, 667],
	[390, 844],
	[430, 932],
	[768, 1024]
];
const LANDSCAPE: [number, number][] = [
	[568, 320],
	[667, 375],
	[844, 390],
	[932, 430],
	[1024, 768]
];
const DESKTOP: [number, number] = [1440, 900];

const ALL = [...PORTRAIT, ...LANDSCAPE, DESKTOP];

describe('computeHandLayout', () => {
	it('never below its floor or above its cap', () => {
		for (const [w, h] of ALL) {
			const l = computeHandLayout(w, h);
			expect(l.handCardH).toBeGreaterThanOrEqual(HAND_FLOOR);
			expect(l.handCardH).toBeLessThanOrEqual(HAND_CAP);
		}
	});

	it('is monotonic: a bigger viewport (both dimensions) never shrinks the hand', () => {
		const pairs: [[number, number], [number, number]][] = [
			[
				[320, 568],
				[375, 667]
			],
			[
				[375, 667],
				[390, 844]
			],
			[
				[390, 844],
				[430, 932]
			],
			[
				[568, 320],
				[667, 375]
			],
			[
				[667, 375],
				[844, 390]
			],
			[
				[844, 390],
				[932, 430]
			],
			[
				[768, 1024],
				[1440, 1440]
			]
		];
		for (const [[w1, h1], [w2, h2]] of pairs) {
			const a = computeHandLayout(w1, h1);
			const b = computeHandLayout(w2, h2);
			expect(b.handCardH).toBeGreaterThanOrEqual(a.handCardH - 0.01);
		}
	});

	it('meets the plan §2 targets', () => {
		expect(computeHandLayout(390, 844).handCardH).toBeGreaterThanOrEqual(110);
		expect(computeHandLayout(375, 667).handCardH).toBeGreaterThanOrEqual(95);
		expect(computeHandLayout(844, 390).handCardH).toBeGreaterThanOrEqual(90);
		expect(computeHandLayout(667, 375).handCardH).toBeGreaterThanOrEqual(80);
	});

	it('identifies orientation and compactness', () => {
		expect(computeHandLayout(390, 844).orientation).toBe('portrait');
		expect(computeHandLayout(844, 390).orientation).toBe('landscape');
		expect(computeHandLayout(844, 390).compact).toBe(true);
		expect(computeHandLayout(1024, 768).compact).toBe(false);
		expect(computeHandLayout(1024, 768).orientation).toBe('landscape');
	});

	it('depends only on width and height — same inputs, same output', () => {
		const a = computeHandLayout(390, 844);
		const b = computeHandLayout(390, 844);
		expect(a).toEqual(b);
	});
});

describe('fitTrickCardH', () => {
	it('never below its floor or above its cap', () => {
		expect(fitTrickCardH(10, 10)).toBeGreaterThanOrEqual(TRICK_FLOOR);
		expect(fitTrickCardH(10000, 10000)).toBeLessThanOrEqual(TRICK_CAP);
	});

	it('is monotonic in both dimensions', () => {
		expect(fitTrickCardH(400, 400)).toBeGreaterThanOrEqual(fitTrickCardH(300, 400));
		expect(fitTrickCardH(400, 400)).toBeGreaterThanOrEqual(fitTrickCardH(400, 300));
	});

	it('picks the tighter of the two dimensions', () => {
		// A very wide, short box is height-bound; a very tall, narrow box is
		// width-bound. Either way the result still fits both.
		const wide = fitTrickCardH(2000, 120);
		const tall = fitTrickCardH(120, 2000);
		expect(wide).toBeLessThan(80);
		expect(tall).toBeLessThan(80);
	});
});

describe('deriveShared', () => {
	it('sizes the fans from the hand, not the measured trick cards', () => {
		// The fans sit in the side columns the trick cell is measured between;
		// sizing them from that measurement would be a feedback loop.
		expect(deriveShared(56, 120).fanCardH).toBe(deriveShared(130, 120).fanCardH);
		expect(deriveShared(80, 170).fanCardH).toBeGreaterThan(deriveShared(80, 120).fanCardH);
	});
});

// Table.svelte.spec.ts's "hand/trick size ratio" describe block measures the
// real rendered ratio across the matrix (plan follow-up item 4) — that needs
// a browser (the trick area's size now comes from a live `ResizeObserver`
// measurement, not a formula this module owns), so it lives there instead of
// here as a pure-function test.
