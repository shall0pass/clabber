import { describe, it, expect } from 'vitest';
import {
	classifyMeld,
	compareMeldClaim,
	detectMelds,
	hasMeld,
	resolveShownMelds,
	seatMeldStatus,
	selectBestMelds
} from './meld';
import { createGame } from './state';
import type { Card, GameDoc, MeldClaim, Suit } from './types';

const kinds = (claims: MeldClaim[]) => claims.map((c) => c.kind).sort();

describe('classifyMeld', () => {
	it('classifies a hand-picked three-card run as a dad', () => {
		expect(classifyMeld(['JH', '9H', 'TH'], 'S')).toMatchObject({
			kind: 'dad',
			group: 'run',
			suit: 'H',
			points: 20
		});
	});

	it('classifies four and five card runs', () => {
		expect(classifyMeld(['9H', 'TH', 'JH', 'QH'], 'S')).toMatchObject({
			kind: 'fifty',
			points: 50
		});
		expect(classifyMeld(['9H', 'TH', 'JH', 'QH', 'KH'], 'S')).toMatchObject({
			kind: 'hundred',
			points: 100
		});
	});

	it('classifies four of a kind, with 200 for jacks', () => {
		expect(classifyMeld(['9S', '9H', '9D', '9C'], 'S')).toMatchObject({
			kind: 'hundred',
			points: 100
		});
		expect(classifyMeld(['JS', 'JH', 'JD', 'JC'], 'S')).toMatchObject({
			kind: 'twohundred',
			points: 200
		});
	});

	it('classifies king + queen of trump as bella', () => {
		expect(classifyMeld(['KS', 'QS'], 'S')).toMatchObject({ kind: 'bella', points: 20 });
		expect(classifyMeld(['KH', 'QH'], 'S')).toBeNull(); // not trump
	});

	it('rejects gaps, mixed suits, duplicates and odd sizes', () => {
		expect(classifyMeld(['9H', 'JH', 'QH'], 'S')).toBeNull(); // gap at 10
		expect(classifyMeld(['9H', 'TH', 'JS'], 'S')).toBeNull(); // mixed suit
		expect(classifyMeld(['9H', '9H', 'TH'], 'S')).toBeNull(); // duplicate card
		expect(classifyMeld(['9H', 'TH'], 'S')).toBeNull(); // two cards, not bella
		expect(classifyMeld(['9S', '9H', '9D'], 'S')).toBeNull(); // only three of a kind
	});
});

describe('detectMelds', () => {
	it('finds a three-card sequence (dad)', () => {
		expect(kinds(detectMelds(['9H', 'TH', 'JH', 'AS', 'KC', 'QD'], 'S'))).toEqual(['dad']);
	});

	it('finds a four-card sequence (fifty)', () => {
		const m = detectMelds(['9H', 'TH', 'JH', 'QH', 'KC', 'QD'], 'S');
		expect(m).toHaveLength(1);
		expect(m[0]).toMatchObject({ kind: 'fifty', points: 50 });
	});

	it('finds a five-card sequence (hundred)', () => {
		const m = detectMelds(['9H', 'TH', 'JH', 'QH', 'KH', 'QD'], 'S');
		expect(m[0]).toMatchObject({ kind: 'hundred', group: 'run', points: 100 });
	});

	it('scores four aces as a hundred and four jacks as two hundred', () => {
		expect(detectMelds(['AS', 'AH', 'AD', 'AC', 'KH', 'QH'], 'S')[0]).toMatchObject({
			kind: 'hundred',
			group: 'set',
			points: 100
		});
		expect(detectMelds(['JS', 'JH', 'JD', 'JC', 'KH', 'QH'], 'S')[0]).toMatchObject({
			kind: 'twohundred',
			points: 200
		});
	});

	it('finds two dads in different suits', () => {
		const m = detectMelds(['9H', 'TH', 'JH', '9C', 'TC', 'JC'], 'S');
		expect(kinds(m)).toEqual(['dad', 'dad']);
	});

	it('recognises bella (K + Q of trump), stackable with a dad for 40', () => {
		const m = detectMelds(['JS', 'QS', 'KS', 'AH', '9D', 'TC'], 'S');
		expect(kinds(m)).toEqual(['bella', 'dad']);
		expect(selectBestMelds(m).sum).toBe(40); // dad 20 + bella 20
	});

	it('does not award bella without a trump suit', () => {
		expect(detectMelds(['KS', 'QS', 'AH', '9D', 'TC', 'JH'], null)).toHaveLength(0);
	});
});

describe('compareMeldClaim', () => {
	const dad = (suit: Suit, top: number): MeldClaim => ({
		kind: 'dad',
		group: 'run',
		suit,
		cards: [],
		points: 20,
		top
	});

	it('ranks by points first', () => {
		expect(compareMeldClaim({ ...dad('H', 3), points: 50 }, dad('C', 6), 'S')).toBeGreaterThan(0);
	});

	it('breaks equal sequences by top card', () => {
		expect(compareMeldClaim(dad('H', 5), dad('C', 3), 'S')).toBeGreaterThan(0);
	});

	it('a trump sequence beats a non-trump sequence of equal rank', () => {
		expect(compareMeldClaim(dad('S', 4), dad('H', 4), 'S')).toBeGreaterThan(0);
	});

	it('two equal non-trump sequences are a push', () => {
		expect(compareMeldClaim(dad('H', 4), dad('C', 4), 'S')).toBe(0);
	});
});

describe('resolveShownMelds', () => {
	/** A doc whose four seats have shown the melds detectable in the given
	 *  hands (bella, if any, recorded on `melds.bella`). */
	function docWithShown(hands: (Card[] | null)[], trump: GameDoc['trump'] = 'S'): GameDoc {
		const doc = createGame('T', 0);
		doc.trump = trump;
		hands.forEach((h, s) => {
			if (!h) return;
			const found = detectMelds(h, trump);
			doc.melds.shown[s] = found.filter((c) => c.group !== 'bella');
			if (found.some((c) => c.group === 'bella')) doc.melds.bella = s as 0 | 1 | 2 | 3;
		});
		return doc;
	}

	it('gives the whole meld total to the team with the best shown meld', () => {
		const doc = docWithShown([
			['9H', 'TH', 'JH', 'QH', 'AS', 'KC'], // team 0: fifty (50)
			['9C', 'TC', 'JC', 'AD', 'KD', 'QD'], // team 1: dad in clubs (20)
			null,
			null
		]);
		resolveShownMelds(doc);
		expect(doc.melds.scoredTeam).toBe(0);
		expect(doc.melds.points).toEqual([50, 0]);
	});

	it('a losing team still scores its bella', () => {
		const doc = docWithShown([
			['AS', 'AH', 'AD', 'AC', '9H', 'TH'], // team 0: four aces (100)
			['KS', 'QS', 'JH', 'TD', '9D', 'TC'], // team 1: bella only (20)
			null,
			null
		]);
		resolveShownMelds(doc);
		expect(doc.melds.scoredTeam).toBe(0);
		expect(doc.melds.points).toEqual([100, 20]);
	});

	it('cancels two equal shown melds so neither scores', () => {
		const doc = docWithShown([
			['9H', 'TH', 'JH', 'AS', 'KC', 'AD'], // team 0: dad in hearts, top J
			['9C', 'TC', 'JC', 'KD', 'QD', 'AH'], // team 1: dad in clubs, top J
			null,
			null
		]);
		resolveShownMelds(doc);
		expect(doc.melds.scoredTeam).toBeNull();
		expect(doc.melds.points).toEqual([0, 0]);
	});

	it('cancels the matching pair but still scores an unmatched meld', () => {
		const doc = createGame('T', 0);
		doc.trump = 'S';
		const dadH: MeldClaim = {
			kind: 'dad',
			group: 'run',
			suit: 'H',
			cards: ['9H', 'TH', 'JH'],
			points: 20,
			top: 3
		};
		const dadC: MeldClaim = {
			kind: 'dad',
			group: 'run',
			suit: 'C',
			cards: ['9C', 'TC', 'JC'],
			points: 20,
			top: 3
		};
		const fiftyH: MeldClaim = {
			kind: 'fifty',
			group: 'run',
			suit: 'H',
			cards: ['9H', 'TH', 'JH', 'QH'],
			points: 50,
			top: 4
		};
		doc.melds.shown[0] = [dadH, fiftyH]; // team 0
		doc.melds.shown[1] = [dadC]; // team 1 — cancels dadH
		resolveShownMelds(doc);
		expect(doc.melds.scoredTeam).toBe(0);
		// dadH / dadC cancel and score nothing; the unmatched fifty still scores.
		expect(doc.melds.points).toEqual([50, 0]);
	});
});

describe('seatMeldStatus — what the whole table sees about a seat', () => {
	const dad = (suit: Suit, cards: Card[]): MeldClaim => ({
		kind: 'dad',
		group: 'run',
		suit,
		cards,
		points: 20,
		top: 3
	});

	it('is empty, and hasMeld is false, for a seat that called nothing', () => {
		const doc = createGame('T', 0);
		const st = seatMeldStatus(doc, 1);
		expect(st).toEqual({
			declaredCount: 0,
			bella: false,
			shown: [],
			forfeited: false,
			shownPoints: null
		});
		expect(hasMeld(st)).toBe(false);
	});

	it('reports a called meld by count only — not its strength — before it is shown', () => {
		const doc = createGame('T', 0);
		doc.melds.declared[2] = [dad('H', ['9H', 'TH', 'JH'])];
		const st = seatMeldStatus(doc, 2);
		expect(st.declaredCount).toBe(1);
		expect(st.shown).toEqual([]);
		expect(st.shownPoints).toBeNull();
		expect(hasMeld(st)).toBe(true);
	});

	it('counts multiple called melds', () => {
		const doc = createGame('T', 0);
		doc.melds.declared[0] = [dad('H', ['9H', 'TH', 'JH']), dad('C', ['9C', 'TC', 'JC'])];
		expect(seatMeldStatus(doc, 0).declaredCount).toBe(2);
	});

	it('tracks bella separately from the declared list', () => {
		const doc = createGame('T', 0);
		doc.melds.declared[3] = [];
		doc.melds.bella = 3;
		const st = seatMeldStatus(doc, 3);
		expect(st).toMatchObject({ declaredCount: 0, bella: true });
		expect(hasMeld(st)).toBe(true);
	});

	it('exposes the shown melds and their point total once the seat has shown', () => {
		const doc = createGame('T', 0);
		doc.melds.declared[1] = [dad('H', ['9H', 'TH', 'JH'])];
		doc.melds.shown[1] = [dad('H', ['9H', 'TH', 'JH'])];
		doc.melds.shownDone[1] = true;
		const st = seatMeldStatus(doc, 1);
		expect(st.shown.map((m) => m.kind)).toEqual(['dad']);
		expect(st.shownPoints).toBe(20);
		expect(st.forfeited).toBe(false);
	});

	it('folds bella into the shown point total', () => {
		const doc = createGame('T', 0);
		doc.melds.declared[1] = [dad('H', ['9H', 'TH', 'JH'])];
		doc.melds.shown[1] = [dad('H', ['9H', 'TH', 'JH'])];
		doc.melds.shownDone[1] = true;
		doc.melds.bella = 1;
		expect(seatMeldStatus(doc, 1).shownPoints).toBe(40);
	});

	it('flags a forfeit: the seat took its show turn, had a meld, showed nothing', () => {
		const doc = createGame('T', 0);
		doc.melds.declared[2] = [dad('H', ['9H', 'TH', 'JH'])];
		doc.melds.shownDone[2] = true; // played its trick-two card without showing
		const st = seatMeldStatus(doc, 2);
		expect(st.forfeited).toBe(true);
		expect(st.shown).toEqual([]);
		expect(hasMeld(st)).toBe(true);
	});

	it('is not a forfeit when the seat never declared a meld', () => {
		const doc = createGame('T', 0);
		doc.melds.shownDone[2] = true;
		expect(seatMeldStatus(doc, 2).forfeited).toBe(false);
	});
});
