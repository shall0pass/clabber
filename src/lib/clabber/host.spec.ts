import { describe, it, expect } from 'vitest';
import { nextBotAction, pickHost } from './host';
import { reduce } from './reducer';
import { createGame, SEATS } from './state';
import { chooseCard } from './bot';
import { legalMoves } from './play';
import type { Card, Difficulty, GameDoc } from './types';

function fourBots(): GameDoc {
	const doc = createGame('T', 0);
	for (const s of SEATS) reduce(doc, { type: 'SetBot', seat: s, isBot: true });
	return doc;
}

describe('pickHost', () => {
	it('is the lexicographically smallest id', () => {
		expect(pickHost([])).toBeNull();
		expect(pickHost(['only'])).toBe('only');
		expect(pickHost(['m', 'a', 'z'])).toBe('a');
	});
});

describe('HostClaim', () => {
	it('records the claimant and allows takeover', () => {
		const doc = createGame('T', 0);
		expect(doc.hostActorId).toBe('');
		reduce(doc, { type: 'HostClaim', actorId: 'alice' });
		expect(doc.hostActorId).toBe('alice');
		reduce(doc, { type: 'HostClaim', actorId: 'bob' });
		expect(doc.hostActorId).toBe('bob');
	});
});

describe('CoverSeat', () => {
	it('flips a seated player between human and bot, keeping name and actorId', () => {
		const doc = createGame('T', 0);
		reduce(doc, { type: 'JoinSeat', seat: 1, name: 'Ada', actorId: 'ada' });
		reduce(doc, { type: 'CoverSeat', seat: 1, isBot: true });
		expect(doc.players[1]).toMatchObject({ name: 'Ada', actorId: 'ada', isBot: true });
		reduce(doc, { type: 'CoverSeat', seat: 1, isBot: false });
		expect(doc.players[1]).toMatchObject({ name: 'Ada', actorId: 'ada', isBot: false });
	});

	it('is a no-op on an empty seat', () => {
		const doc = createGame('T', 0);
		reduce(doc, { type: 'CoverSeat', seat: 2, isBot: true });
		expect(doc.players[2]).toBeNull();
	});
});

describe('nextBotAction', () => {
	it('does nothing in the lobby or once the game is over', () => {
		expect(nextBotAction(createGame('T', 0))).toBeNull();
		const doc = fourBots();
		reduce(doc, { type: 'StartHand', seed: 's' });
		doc.phase = 'gameOver';
		expect(nextBotAction(doc)).toBeNull();
	});

	it('bids for the bot whose turn it is', () => {
		const doc = fourBots();
		reduce(doc, { type: 'StartHand', seed: 's' });
		const a = nextBotAction(doc);
		expect(a?.type).toBe('Bid');
		expect(a && 'seat' in a && a.seat).toBe(doc.bidding!.turn);
	});

	it('returns null when it is a human seat’s turn', () => {
		const doc = createGame('T', 0);
		reduce(doc, { type: 'JoinSeat', seat: 1, name: 'H', actorId: 'h' });
		for (const s of [0, 2, 3] as const) reduce(doc, { type: 'SetBot', seat: s, isBot: true });
		reduce(doc, { type: 'StartHand', seed: 's' });
		expect(doc.bidding!.turn).toBe(1); // left of dealer 0 — the human
		expect(nextBotAction(doc)).toBeNull();
	});

	it('announces meld before playing to the first trick', () => {
		let doc = fourBots();
		// Search seeds until a hand actually reaches the meld phase.
		for (let i = 0; i < 20; i++) {
			doc = fourBots();
			reduce(doc, { type: 'StartHand', seed: `meld-${i}` });
			while (doc.phase === 'bid1' || doc.phase === 'bid2' || doc.phase === 'redeal') {
				reduce(doc, nextBotAction(doc)!);
			}
			if (doc.phase === 'meld') break;
		}
		expect(doc.phase).toBe('meld');
		const first = nextBotAction(doc)!;
		expect(first.type).toBe('AnnounceMeld');
		reduce(doc, first);
		expect(nextBotAction(doc)!.type).toBe('PlayCard');
	});

	describe('trickDone', () => {
		it('acks bot seats one at a time, then advances once everyone has', () => {
			const doc = fourBots();
			doc.phase = 'trickDone';
			for (const seat of SEATS) {
				const a = nextBotAction(doc);
				expect(a).toEqual({ type: 'AckTrick', seat });
				reduce(doc, a!);
			}
			expect(nextBotAction(doc)?.type).toBe('AdvanceTrick');
		});

		it('waits (returns null) on an un-acked human seat', () => {
			const doc = createGame('T', 0);
			reduce(doc, { type: 'JoinSeat', seat: 0, name: 'H', actorId: 'h' });
			for (const s of [1, 2, 3] as const) reduce(doc, { type: 'SetBot', seat: s, isBot: true });
			doc.phase = 'trickDone';
			for (const seat of [1, 2, 3] as const) reduce(doc, { type: 'AckTrick', seat });
			expect(nextBotAction(doc)).toBeNull(); // only the human (seat 0) is left
		});
	});

	describe('handScored', () => {
		it('acks bot seats one at a time, then deals once everyone has', () => {
			const doc = fourBots();
			doc.phase = 'handScored';
			for (const seat of SEATS) {
				const a = nextBotAction(doc);
				expect(a).toEqual({ type: 'AckHand', seat });
				reduce(doc, a!);
			}
			expect(nextBotAction(doc)?.type).toBe('StartHand');
		});

		it('waits (returns null) on an un-acked human seat', () => {
			const doc = createGame('T', 0);
			reduce(doc, { type: 'JoinSeat', seat: 0, name: 'H', actorId: 'h' });
			for (const s of [1, 2, 3] as const) reduce(doc, { type: 'SetBot', seat: s, isBot: true });
			doc.phase = 'handScored';
			for (const seat of [1, 2, 3] as const) reduce(doc, { type: 'AckHand', seat });
			expect(nextBotAction(doc)).toBeNull(); // only the human (seat 0) is left
		});
	});

	it('drives four bots through a whole game', () => {
		const doc = fourBots();
		reduce(doc, { type: 'StartHand', seed: 'whole-game' });
		let guard = 0;
		while (doc.phase !== 'gameOver') {
			if (++guard > 100_000) throw new Error('game did not finish');
			const a = nextBotAction(doc);
			if (!a) throw new Error(`no action for phase ${doc.phase}`);
			reduce(doc, a);
		}
		expect([0, 1]).toContain(doc.winner);
		expect(Math.max(...doc.score.running)).toBeGreaterThanOrEqual(500);
	});

	describe('renege', () => {
		// Hearts led on trick 3; seat 1 (team 1) holds hearts, so a non-heart
		// card is an illegal play. Four bots, so the watchers on team 0
		// (seats 0 and 2) are bots that could call it.
		function midTrickBots(): GameDoc {
			const doc = fourBots();
			doc.phase = 'trick';
			doc.advanced = true;
			doc.trump = 'S';
			doc.maker = 0;
			doc.hands = [
				['AS', 'KS'],
				['9H', 'KH', 'QC', 'AD'],
				['TH', 'JH'],
				['9D', 'TD']
			];
			doc.trick = { number: 3, leader: 0, turn: 1, plays: [{ seat: 0, card: 'AH' }], winner: null };
			return doc;
		}

		it('does not call it while unproven — the offender has not shown they held the suit', () => {
			const doc = midTrickBots();
			reduce(doc, { type: 'PlayCard', seat: 1, card: 'QC', allowIllegal: true });
			const a = nextBotAction(doc);
			expect(a?.type).not.toBe('CallRenege');
			expect(a).toEqual({ type: 'PlayCard', seat: 2, card: expect.any(String) });
		});

		it('calls it once the offender plays a card of the led suit in the trick in progress', () => {
			const doc = midTrickBots();
			reduce(doc, { type: 'PlayCard', seat: 1, card: 'QC', allowIllegal: true });
			// Trick 3 was collected without a call; in trick 4 seat 1 plays a
			// heart — proof it held one when it failed to follow on trick 3.
			doc.trick = {
				number: 4,
				leader: 3,
				turn: 2,
				plays: [
					{ seat: 3, card: '9D' },
					{ seat: 0, card: 'KS' },
					{ seat: 1, card: '9H' }
				],
				winner: null
			};
			expect(nextBotAction(doc)).toEqual({ type: 'CallRenege', seat: 0 });
		});

		it('calls it once the proof lands in a trick already collected, through to the score screen', () => {
			const doc = midTrickBots();
			reduce(doc, { type: 'PlayCard', seat: 1, card: 'QC', allowIllegal: true });
			doc.trickHistory = [
				{ winner: 0, bySeat: ['9S', 'TC', 'TD', 'JS'] as Card[] },
				{ winner: 0, bySeat: ['JD', 'QD', 'AC', '9C'] as Card[] },
				{ winner: 0, bySeat: ['AH', 'QC', 'TH', 'TD'] as Card[] }, // trick 3 — the infraction
				{ winner: 1, bySeat: ['9D', '9H', 'JH', 'TC'] as Card[] } // trick 4 — seat 1 plays 9H
			];
			doc.trick = { number: 5, leader: 1, turn: 1, plays: [], winner: null };
			expect(nextBotAction(doc)).toEqual({ type: 'CallRenege', seat: 0 });

			doc.phase = 'handScored';
			expect(nextBotAction(doc)).toEqual({ type: 'CallRenege', seat: 0 });
		});

		it('the beaten-meld path waits for trick two to be played out, not for proof', () => {
			const doc = fourBots();
			doc.phase = 'trick';
			doc.trump = 'S';
			doc.maker = 0;
			doc.hands = [
				['AS', 'KS'],
				['9C', 'KC'],
				['TH', 'JH'],
				['9D', 'TD']
			];
			doc.trick = {
				number: 2,
				leader: 0,
				turn: 2,
				plays: [
					{ seat: 0, card: '9H' },
					{ seat: 1, card: 'TC' }
				],
				winner: null
			};
			doc.renege = { seat: 1, card: null, called: false };

			expect(nextBotAction(doc)?.type).not.toBe('CallRenege');

			doc.phase = 'trickDone';
			expect(nextBotAction(doc)).toEqual({ type: 'CallRenege', seat: 0 });
		});
	});

	describe('difficulty', () => {
		// Diamonds led by seat 3; seat 0 (a bot) is on lead-to-follow with three
		// legal diamonds, so `chooseCard` has a real choice to perturb.
		function cardDoc(difficulty: Difficulty): GameDoc {
			const doc = fourBots();
			doc.phase = 'trick';
			doc.difficulty = difficulty;
			doc.trump = 'S';
			doc.maker = 0;
			doc.hands = [['9D', 'TD', 'AD'], ['9C'], ['9H'], ['KH']];
			doc.trick = { number: 3, leader: 3, turn: 0, plays: [{ seat: 3, card: 'KD' }], winner: null };
			return doc;
		}

		// Seat 0 to open trick one; `declared[0]` is null, so the meld decision runs.
		function meldDoc(difficulty: Difficulty): GameDoc {
			const doc = fourBots();
			doc.phase = 'meld';
			doc.difficulty = difficulty;
			doc.trump = 'S';
			doc.maker = 0;
			doc.hands = [['9H', 'TH', 'JH', 'QS', 'KS', 'AS'], [], [], []];
			doc.trick = { number: 1, leader: 0, turn: 0, plays: [], winner: null };
			return doc;
		}

		// Seat 1 fouled on trick 3 (played QC on a heart lead) and then played a
		// heart on trick 4 — the renege is provable; watchers are bot seats 0 & 2.
		function provenRenegeDoc(difficulty: Difficulty): GameDoc {
			const doc = fourBots();
			doc.phase = 'trick';
			doc.difficulty = difficulty;
			doc.advanced = true;
			doc.trump = 'S';
			doc.maker = 0;
			doc.hands = [
				['AS', 'KS'],
				['9H', 'KH', 'QC', 'AD'],
				['TH', 'JH'],
				['9D', 'TD']
			];
			doc.trick = { number: 3, leader: 0, turn: 1, plays: [{ seat: 0, card: 'AH' }], winner: null };
			reduce(doc, { type: 'PlayCard', seat: 1, card: 'QC', allowIllegal: true });
			doc.trick = {
				number: 4,
				leader: 3,
				turn: 2,
				plays: [
					{ seat: 3, card: '9D' },
					{ seat: 0, card: 'KS' },
					{ seat: 1, card: '9H' }
				],
				winner: null
			};
			return doc;
		}

		it('expert plays chooseCard’s pick every time, with no rolls', () => {
			for (let i = 0; i < 40; i++) {
				const doc = cardDoc('expert');
				doc.seed = `e${i}`;
				expect(nextBotAction(doc)).toEqual({
					type: 'PlayCard',
					seat: 0,
					card: chooseCard(doc, 0)
				});
			}
		});

		it('is deterministic — the same doc yields the same action on every call', () => {
			const doc = cardDoc('easy');
			doc.seed = 'stable';
			expect(nextBotAction(doc)).toEqual(nextBotAction(doc));

			const rd = provenRenegeDoc('easy');
			rd.seed = 'stable';
			expect(nextBotAction(rd)).toEqual(nextBotAction(rd));
		});

		it('easy card play stays legal but is not always the best card', () => {
			const best = chooseCard(cardDoc('easy'), 0);
			const legal = legalMoves(cardDoc('easy'), 0);
			let slips = 0;
			for (let i = 0; i < 200; i++) {
				const doc = cardDoc('easy');
				doc.seed = `l${i}`;
				const card = (nextBotAction(doc) as { card: Card }).card;
				expect(legal).toContain(card);
				if (card !== best) slips++;
			}
			expect(slips).toBeGreaterThan(0);
			expect(slips).toBeLessThan(200);
		});

		it('normal keeps the best card ~92% of the time', () => {
			const best = chooseCard(cardDoc('normal'), 0);
			let right = 0;
			const N = 400;
			for (let i = 0; i < N; i++) {
				const doc = cardDoc('normal');
				doc.seed = `n${i}`;
				if ((nextBotAction(doc) as { card?: Card }).card === best) right++;
			}
			expect(right / N).toBeGreaterThan(0.85);
			expect(right / N).toBeLessThan(0.985);
		});

		it('expert always announces its meld; easy sometimes skips it and just plays', () => {
			for (let i = 0; i < 30; i++) {
				const doc = meldDoc('expert');
				doc.seed = `x${i}`;
				expect(nextBotAction(doc)!.type).toBe('AnnounceMeld');
			}

			let announced = 0;
			let skipped = 0;
			for (let i = 0; i < 200; i++) {
				const doc = meldDoc('easy');
				doc.seed = `m${i}`;
				const a = nextBotAction(doc)!;
				if (a.type === 'AnnounceMeld') announced++;
				else if (a.type === 'PlayCard') skipped++;
			}
			expect(announced).toBeGreaterThan(0);
			expect(skipped).toBeGreaterThan(0);
			expect(announced).toBeGreaterThan(skipped); // ~80% still announce
		});

		it('expert always catches a provable renege; easy often misses it', () => {
			let caught = 0;
			let missed = 0;
			for (let i = 0; i < 200; i++) {
				const exp = provenRenegeDoc('expert');
				exp.seed = `r${i}`;
				expect(nextBotAction(exp)).toEqual({ type: 'CallRenege', seat: 0 });

				const easy = provenRenegeDoc('easy');
				easy.seed = `r${i}`;
				if (nextBotAction(easy)!.type === 'CallRenege') caught++;
				else missed++;
			}
			expect(caught).toBeGreaterThan(0);
			expect(missed).toBeGreaterThan(0);
		});
	});
});
