// Meld: scoring combinations held in hand, announced on the first trick.
//
//   Two Hundred  four jacks                       200
//   Hundred      four 9s / As / 10s / Ks / Qs     100
//   Hundred      sequence of five (or six)        100
//   Fifty        sequence of four                  50
//   Dad          sequence of three                 20
//   Bella        K + Q of trump                    20   (always scores)
//
// Sequences use the natural order 9 10 J Q K A. No card is used in more than
// one meld, except bella's K/Q, which may also appear in a sequence (so K-Q-J
// of trump is worth 20 + 20 = 40, "dad 'a' belle").
//
// The team holding the single highest-ranking meld scores the sum of ALL its
// melds; the other team scores nothing for meld — except bella, which always
// scores for whoever holds it. Tie-break between two melds: higher points, then
// higher top card, then a trump sequence beats a non-trump one; still equal and
// neither team scores meld this deal.

import type { Card, GameDoc, MeldClaim, Suit, TeamId } from './types';
import { RANKS, SUITS, rankOf, sequenceStrength, suitOf } from './cards';
import { teamOf } from './state';

/** Every meld present in a hand (may include mutually-exclusive candidates; use
 *  `selectBestMelds` to pick the scoring set). */
export function detectMelds(hand: Card[], trump: Suit | null): MeldClaim[] {
	const claims: MeldClaim[] = [];

	// Four of a kind.
	for (const r of RANKS) {
		const cs = hand.filter((c) => rankOf(c) === r);
		if (cs.length === 4) {
			claims.push(
				r === 'J'
					? {
							kind: 'twohundred',
							group: 'set',
							suit: null,
							cards: cs,
							points: 200,
							top: sequenceStrength(cs[0])
						}
					: {
							kind: 'hundred',
							group: 'set',
							suit: null,
							cards: cs,
							points: 100,
							top: sequenceStrength(cs[0])
						}
			);
		}
	}

	// Longest run in each suit.
	for (const s of SUITS) {
		const cs = hand
			.filter((c) => suitOf(c) === s)
			.sort((a, b) => sequenceStrength(a) - sequenceStrength(b));
		if (cs.length < 3) continue;
		let bestStart = 0;
		let bestLen = 1;
		let curStart = 0;
		let curLen = 1;
		for (let i = 1; i < cs.length; i++) {
			if (sequenceStrength(cs[i]) === sequenceStrength(cs[i - 1]) + 1) {
				curLen++;
			} else {
				curStart = i;
				curLen = 1;
			}
			if (curLen > bestLen) {
				bestLen = curLen;
				bestStart = curStart;
			}
		}
		if (bestLen < 3) continue;
		const run = cs.slice(bestStart, bestStart + bestLen);
		const top = sequenceStrength(run[run.length - 1]);
		if (bestLen >= 5)
			claims.push({ kind: 'hundred', group: 'run', suit: s, cards: run, points: 100, top });
		else if (bestLen === 4)
			claims.push({ kind: 'fifty', group: 'run', suit: s, cards: run, points: 50, top });
		else claims.push({ kind: 'dad', group: 'run', suit: s, cards: run, points: 20, top });
	}

	// Bella.
	if (trump) {
		const k = `K${trump}` as Card;
		const q = `Q${trump}` as Card;
		if (hand.includes(k) && hand.includes(q)) {
			claims.push({
				kind: 'bella',
				group: 'bella',
				suit: trump,
				cards: [k, q],
				points: 20,
				top: sequenceStrength(k)
			});
		}
	}

	return claims;
}

export interface MeldSelection {
	list: MeldClaim[];
	sum: number;
}

/** The best legal (disjoint) set of melds from a hand's candidates. Four-of-a-
 *  kind and sequences cannot coexist in a six-card hand, so this is just the
 *  higher-scoring of the two, plus bella. */
export function selectBestMelds(claims: MeldClaim[]): MeldSelection {
	const runs = claims.filter((c) => c.group === 'run');
	const sets = claims.filter((c) => c.group === 'set');
	const bella = claims.find((c) => c.group === 'bella');
	const runSum = runs.reduce((n, c) => n + c.points, 0);
	const setSum = sets.reduce((n, c) => n + c.points, 0);
	const list = (runSum >= setSum ? runs : sets).slice();
	let sum = Math.max(runSum, setSum);
	if (bella) {
		list.push(bella);
		sum += bella.points;
	}
	return { list, sum };
}

/** Classify an exact hand-picked set of cards as a single meld, or `null` if
 *  the selection is not a valid meld. Used when a player declares meld by
 *  choosing the cards themselves (no auto-detection).
 *
 *    2 cards  K + Q of trump ....................... bella (20)
 *    4 cards  four of a kind ...... 200 for jacks, else hundred (100)
 *    3-6 same-suit cards in sequence 9 10 J Q K A ... dad 20 / fifty 50 / hundred 100
 */
export function classifyMeld(cards: readonly Card[], trump: Suit | null): MeldClaim | null {
	const uniq = new Set(cards);
	if (uniq.size !== cards.length || cards.length < 2) return null;
	const n = cards.length;

	// Bella — exactly the king and queen of trump.
	if (n === 2) {
		if (!trump) return null;
		const k = `K${trump}` as Card;
		const q = `Q${trump}` as Card;
		if (uniq.has(k) && uniq.has(q)) {
			return {
				kind: 'bella',
				group: 'bella',
				suit: trump,
				cards: [k, q],
				points: 20,
				top: sequenceStrength(k)
			};
		}
		return null;
	}

	// Four of a kind.
	if (n === 4 && cards.every((c) => rankOf(c) === rankOf(cards[0]))) {
		const isJacks = rankOf(cards[0]) === 'J';
		return {
			kind: isJacks ? 'twohundred' : 'hundred',
			group: 'set',
			suit: null,
			cards: [...cards],
			points: isJacks ? 200 : 100,
			top: sequenceStrength(cards[0])
		};
	}

	// Sequence in one suit.
	if (n <= 6 && cards.every((c) => suitOf(c) === suitOf(cards[0]))) {
		const run = [...cards].sort((a, b) => sequenceStrength(a) - sequenceStrength(b));
		const consecutive = run.every(
			(c, i) => i === 0 || sequenceStrength(c) === sequenceStrength(run[i - 1]) + 1
		);
		if (consecutive) {
			const kind = n >= 5 ? 'hundred' : n === 4 ? 'fifty' : 'dad';
			const points = n >= 5 ? 100 : n === 4 ? 50 : 20;
			return {
				kind,
				group: 'run',
				suit: suitOf(run[0]),
				cards: run,
				points,
				top: sequenceStrength(run[run.length - 1])
			};
		}
	}

	return null;
}

/** Whether two claims describe the same combination (kind, suit and card set). */
export function sameMeldClaim(a: MeldClaim, b: MeldClaim): boolean {
	if (a.kind !== b.kind || a.suit !== b.suit || a.cards.length !== b.cards.length) return false;
	const bcards = [...b.cards];
	for (const c of a.cards) {
		const i = bcards.indexOf(c);
		if (i < 0) return false;
		bcards.splice(i, 1);
	}
	return true;
}

/** Keep only the entries of `chosen` that match a real candidate in `available`
 *  — so a client can't announce a meld the hand doesn't actually hold. */
export function validateClaims(chosen: MeldClaim[], available: MeldClaim[]): MeldClaim[] {
	return chosen.filter((c) => available.some((d) => sameMeldClaim(c, d)));
}

/** >0: `a` outranks `b`; <0: `b` outranks `a`; 0: tie — no team scores meld. */
export function compareMeldClaim(a: MeldClaim, b: MeldClaim, trump: Suit | null): number {
	if (a.points !== b.points) return a.points - b.points;
	if (a.top !== b.top) return a.top - b.top;
	const at = a.group === 'run' && a.suit === trump;
	const bt = b.group === 'run' && b.suit === trump;
	if (at !== bt) return at ? 1 : -1;
	return 0;
}

/** The strongest claim in `claims` (by `compareMeldClaim`), or `null`. */
export function bestMeld(claims: MeldClaim[], trump: Suit | null): MeldClaim | null {
	const real = claims.filter((c): c is MeldClaim => c != null);
	if (!real.length) return null;
	return real.reduce((best, c) => (compareMeldClaim(c, best, trump) > 0 ? c : best));
}

/** Score the melds that were actually shown during trick two, writing the
 *  outcome into `doc.melds`. Equal opposing melds cancel pairwise; the team
 *  with the best remaining shown meld then scores all of its shown melds.
 *  Bella (from `doc.melds.bella`) always adds 20 for its holder's team. */
export function resolveShownMelds(doc: GameDoc): void {
	const trump = doc.trump;
	const teamShown: [MeldClaim[], MeldClaim[]] = [[], []];
	for (const s of [0, 1, 2, 3] as const) {
		for (const m of doc.melds.shown[s] ?? []) teamShown[teamOf(s)].push(m);
	}

	// Cancel each pair of exactly-equal melds, one from each team.
	const t0 = [...teamShown[0]];
	const t1 = [...teamShown[1]];
	for (let i = t0.length - 1; i >= 0; i--) {
		const j = t1.findIndex((b) => compareMeldClaim(t0[i], b, trump) === 0);
		if (j >= 0) {
			t0.splice(i, 1);
			t1.splice(j, 1);
		}
	}

	const best0 = bestMeld(t0, trump);
	const best1 = bestMeld(t1, trump);
	const sum = (list: MeldClaim[]) => list.reduce((n, c) => n + c.points, 0);

	const points: [number, number] = [0, 0];
	let winner: TeamId | null = null;
	if (best0 && best1) {
		const cmp = compareMeldClaim(best0, best1, trump);
		if (cmp > 0) winner = 0;
		else if (cmp < 0) winner = 1;
	} else if (best0) winner = 0;
	else if (best1) winner = 1;

	if (winner === 0) points[0] = sum(t0);
	else if (winner === 1) points[1] = sum(t1);

	if (doc.melds.bella != null) points[teamOf(doc.melds.bella)] += 20;

	doc.melds.points = points;
	doc.melds.scoredTeam = winner;
	doc.melds.resolved = true;
	doc.log.push(`meld: team 0 ${points[0]}, team 1 ${points[1]}`);
}
