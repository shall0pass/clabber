import { describe, it, expect } from 'vitest';
import { RuleError, reduce } from './reducer';
import { chooseBid, chooseCard } from './bot';
import { createGame, SEATS } from './state';
import type { Card, GameDoc, MeldClaim } from './types';

function fourBots(): GameDoc {
	const doc = createGame('T', 0);
	for (const s of SEATS) reduce(doc, { type: 'SetBot', seat: s, isBot: true, botName: `Bot ${s}` });
	return doc;
}

function playOneHand(doc: GameDoc): void {
	while (doc.phase === 'bid1' || doc.phase === 'bid2') {
		const seat = doc.bidding!.turn;
		reduce(doc, { type: 'Bid', seat, bid: chooseBid(doc, seat) });
	}
	while (doc.phase === 'meld' || doc.phase === 'trick' || doc.phase === 'trickDone') {
		if (doc.phase === 'trickDone') {
			const unacked = SEATS.find((s) => !doc.trickAcks[s]);
			reduce(doc, unacked != null ? { type: 'AckTrick', seat: unacked } : { type: 'AdvanceTrick' });
			continue;
		}
		const seat = doc.trick!.turn;
		if (doc.phase === 'meld' && doc.melds.declared[seat] == null) {
			reduce(doc, { type: 'AnnounceMeld', seat });
		}
		if (
			doc.phase === 'trick' &&
			doc.trick!.number === 2 &&
			(doc.melds.declared[seat]?.length ?? 0) > 0 &&
			!doc.melds.shownDone[seat]
		) {
			reduce(doc, { type: 'ShowMeld', seat });
			continue;
		}
		reduce(doc, { type: 'PlayCard', seat, card: chooseCard(doc, seat) });
	}
}

describe('createGame', () => {
	it('starts in the lobby with four empty seats and no score', () => {
		const doc = createGame('ROOM', 0);
		expect(doc.phase).toBe('lobby');
		expect(doc.players).toEqual([null, null, null, null]);
		expect(doc.score.running).toEqual([0, 0]);
	});
});

describe('lobby actions', () => {
	it('seats and renames players, and lets a human take over a bot seat', () => {
		const doc = fourBots();
		reduce(doc, { type: 'JoinSeat', seat: 2, name: 'Ada', actorId: 'a1' });
		expect(doc.players[2]).toMatchObject({ name: 'Ada', isBot: false, actorId: 'a1' });

		reduce(doc, { type: 'RenameSeat', seat: 2, name: 'Ada L.' });
		expect(doc.players[2]?.name).toBe('Ada L.');
	});

	it('will not let a player take an occupied human seat', () => {
		const doc = fourBots();
		reduce(doc, { type: 'JoinSeat', seat: 0, name: 'Ada' });
		expect(() => reduce(doc, { type: 'JoinSeat', seat: 0, name: 'Bob' })).toThrow(RuleError);
	});
});

describe('StartHand', () => {
	it('refuses to deal until every seat is filled', () => {
		const doc = createGame('T', 0);
		reduce(doc, { type: 'SetBot', seat: 0, isBot: true });
		expect(() => reduce(doc, { type: 'StartHand', seed: 's' })).toThrow(RuleError);
	});

	it('deals six cards each, turns the up-card, and opens bidding to the dealer’s left', () => {
		const doc = fourBots();
		reduce(doc, { type: 'StartHand', seed: 'deal-1' });
		expect(doc.phase).toBe('bid1');
		expect(doc.dealer).toBe(0);
		expect(doc.hands.map((h) => h.length)).toEqual([6, 6, 6, 6]);
		expect(doc.upCard).toBe(doc.hands[0][5]);
		expect(doc.bidding).toMatchObject({ round: 1, turn: 1 });
	});
});

describe('guards', () => {
	it('rejects playing a card outside a hand', () => {
		const doc = fourBots();
		expect(() => reduce(doc, { type: 'PlayCard', seat: 0, card: 'AS' })).toThrow(RuleError);
	});
});

describe('a complete hand', () => {
	it('plays out six tricks and records a result totalling 162 trick points', () => {
		let doc = fourBots();
		let played = false;
		for (let i = 0; i < 25 && !played; i++) {
			doc = fourBots();
			reduce(doc, { type: 'StartHand', seed: `whole-hand-${i}` });
			playOneHand(doc);
			played = doc.phase !== 'redeal';
		}
		expect(played).toBe(true);
		expect(['handScored', 'gameOver']).toContain(doc.phase);
		expect(doc.score.hands).toHaveLength(1);

		const r = doc.score.hands[0];
		expect(r.trickPoints[0] + r.trickPoints[1]).toBe(162);
		expect(doc.hands.flat()).toHaveLength(0);
		expect(doc.wonBySeat.flat()).toHaveLength(6); // six tricks collected

		// trickHistory is the true chronological order, one entry per trick,
		// each with every seat's card at that seat's own index.
		expect(doc.trickHistory).toHaveLength(6);
		for (const t of doc.trickHistory) {
			expect(t.bySeat).toHaveLength(4);
			expect(SEATS.every((s) => typeof t.bySeat[s] === 'string')).toBe(true);
		}
		// matches wonBySeat once re-grouped by winner
		const regrouped: string[][][] = [[], [], [], []];
		for (const t of doc.trickHistory) regrouped[t.winner].push(t.bySeat);
		for (const s of SEATS) {
			expect(regrouped[s].map((cards) => new Set(cards))).toEqual(
				doc.wonBySeat[s].map((cards) => new Set(cards))
			);
		}
	});
});

describe('hand-scored Continue gate (handAcks)', () => {
	/** Drive four bots to the handScored screen after exactly one hand. */
	function atHandScored(): GameDoc {
		let doc = fourBots();
		for (let i = 0; i < 25; i++) {
			doc = fourBots();
			reduce(doc, { type: 'StartHand', seed: `ack-${i}` });
			playOneHand(doc);
			if (doc.phase === 'handScored') break;
		}
		expect(doc.phase).toBe('handScored');
		return doc;
	}

	it('refuses to deal the next hand until every seat has pressed Continue', () => {
		const doc = atHandScored();
		expect(() => reduce(doc, { type: 'StartHand', seed: 'next' })).toThrow(RuleError);
		for (const s of SEATS.slice(0, 3)) reduce(doc, { type: 'AckHand', seat: s });
		expect(() => reduce(doc, { type: 'StartHand', seed: 'next' })).toThrow(RuleError);
		reduce(doc, { type: 'AckHand', seat: 3 });
		expect(() => reduce(doc, { type: 'StartHand', seed: 'next' })).not.toThrow();
		expect(doc.phase).toBe('bid1');
	});

	it('AckHand only works from the hand-scored screen', () => {
		const doc = fourBots();
		reduce(doc, { type: 'StartHand', seed: 's' });
		expect(() => reduce(doc, { type: 'AckHand', seat: 0 })).toThrow(RuleError);
	});

	it('StartHand resets handAcks for the new hand', () => {
		const doc = atHandScored();
		for (const s of SEATS) reduce(doc, { type: 'AckHand', seat: s });
		reduce(doc, { type: 'StartHand', seed: 'next' });
		expect(doc.handAcks).toEqual([false, false, false, false]);
	});

	it('a renege called from the score screen undoes the prior score and re-settles it', () => {
		const doc = atHandScored();
		doc.advanced = true;
		const before = [...doc.score.running] as [number, number];
		const priorHands = doc.score.hands.length;
		reduce(doc, { type: 'CallRenege', seat: 0 }); // speculative — seat 0's team takes the hit
		expect(doc.score.hands).toHaveLength(priorHands); // replaced, not appended
		const r = doc.score.hands.at(-1)!;
		expect(r.renege).toBe(true);
		expect(doc.score.running).not.toEqual(before);
		expect(doc.renegeCalledBy).toBe(0); // so the UI can point at the caller
	});
});

describe('trick Continue gate (trickAcks)', () => {
	function atTrickDone(): GameDoc {
		for (let i = 0; i < 25; i++) {
			const doc = fourBots();
			reduce(doc, { type: 'StartHand', seed: `trick-ack-${i}` });
			while (doc.phase === 'bid1' || doc.phase === 'bid2') {
				const seat = doc.bidding!.turn;
				reduce(doc, { type: 'Bid', seat, bid: chooseBid(doc, seat) });
			}
			if (!doc.trick) continue; // redeal — try another seed
			while (doc.phase !== 'trickDone') {
				const seat = doc.trick!.turn;
				if (doc.melds.declared[seat] == null) reduce(doc, { type: 'AnnounceMeld', seat });
				reduce(doc, { type: 'PlayCard', seat, card: chooseCard(doc, seat) });
			}
			return doc;
		}
		throw new Error('every seed redealt');
	}

	it('refuses to collect the trick until every seat has pressed Continue', () => {
		const doc = atTrickDone();
		expect(() => reduce(doc, { type: 'AdvanceTrick' })).toThrow(RuleError);
		for (const s of SEATS.slice(0, 3)) reduce(doc, { type: 'AckTrick', seat: s });
		expect(() => reduce(doc, { type: 'AdvanceTrick' })).toThrow(RuleError);
		reduce(doc, { type: 'AckTrick', seat: 3 });
		expect(() => reduce(doc, { type: 'AdvanceTrick' })).not.toThrow();
		expect(doc.phase).toBe('trick');
	});

	it('AckTrick only works while a trick is held on screen', () => {
		const doc = fourBots();
		reduce(doc, { type: 'StartHand', seed: 's' });
		expect(() => reduce(doc, { type: 'AckTrick', seat: 0 })).toThrow(RuleError);
	});

	it('starts the next trick unacked once it in turn completes', () => {
		const doc = atTrickDone();
		for (const s of SEATS) reduce(doc, { type: 'AckTrick', seat: s });
		reduce(doc, { type: 'AdvanceTrick' });
		expect(doc.phase).toBe('trick');
		while (doc.phase !== 'trickDone') {
			const seat = doc.trick!.turn;
			reduce(doc, { type: 'PlayCard', seat, card: chooseCard(doc, seat) });
		}
		expect(doc.trickAcks).toEqual([false, false, false, false]);
	});
});

describe('ResetToLobby', () => {
	it('clears the game but keeps the seats, and only from gameOver', () => {
		const doc = fourBots();
		reduce(doc, { type: 'JoinSeat', seat: 0, name: 'Ada', actorId: 'a' });
		reduce(doc, { type: 'StartHand', seed: 'r' });
		expect(() => reduce(doc, { type: 'ResetToLobby' })).toThrow(RuleError);

		doc.phase = 'gameOver';
		doc.score.running = [510, 300];
		reduce(doc, { type: 'ResetToLobby' });

		expect(doc.phase).toBe('lobby');
		expect(doc.score.running).toEqual([0, 0]);
		expect(doc.winner).toBeNull();
		expect(doc.trick).toBeNull();
		expect(doc.players[0]).toMatchObject({ name: 'Ada' });
		expect(doc.players[1]?.isBot).toBe(true);
	});
});

describe('LeaveTable', () => {
	it('turns a human seat into a named bot and drops its actorId, in any phase', () => {
		const doc = fourBots();
		reduce(doc, { type: 'JoinSeat', seat: 2, name: 'Ada', actorId: 'ada-1' });
		reduce(doc, { type: 'StartHand', seed: 'lt' });

		reduce(doc, { type: 'LeaveTable', seat: 2, botName: 'Rainbow Goose' });

		expect(doc.players[2]).toMatchObject({ isBot: true, name: 'Rainbow Goose' });
		expect(doc.players[2]?.actorId).toBeUndefined();
		// the hand in progress is untouched
		expect(['bid1', 'bid2']).toContain(doc.phase);
	});

	it('is a no-op on an empty seat', () => {
		const doc = createGame('T', 0);
		reduce(doc, { type: 'LeaveTable', seat: 1, botName: 'Nobody' });
		expect(doc.players[1]).toBeNull();
	});
});

describe('SendChat', () => {
	function chat(doc: GameDoc, text: string) {
		reduce(doc, {
			type: 'SendChat',
			id: crypto.randomUUID(),
			from: 'c1',
			name: 'Ada',
			seat: 0,
			text,
			ts: Date.now()
		});
	}

	it('appends a message', () => {
		const doc = createGame('T', 0);
		chat(doc, 'hello all');
		expect(doc.chat).toHaveLength(1);
		expect(doc.chat[0]).toMatchObject({ from: 'c1', name: 'Ada', seat: 0, text: 'hello all' });
	});

	it('ignores blank / whitespace-only messages and trims', () => {
		const doc = createGame('T', 0);
		chat(doc, '   ');
		chat(doc, '  hi  ');
		expect(doc.chat.map((m) => m.text)).toEqual(['hi']);
	});

	it('keeps only the most recent 100 messages', () => {
		const doc = createGame('T', 0);
		for (let i = 0; i < 130; i++) chat(doc, `m${i}`);
		expect(doc.chat).toHaveLength(100);
		expect(doc.chat[0].text).toBe('m30');
		expect(doc.chat.at(-1)?.text).toBe('m129');
	});
});

describe('SetAdvanced', () => {
	it('toggles the flag in the lobby', () => {
		const doc = createGame('T', 0);
		expect(doc.advanced).toBe(true); // renege play is the default
		reduce(doc, { type: 'SetAdvanced', on: false });
		expect(doc.advanced).toBe(false);
		reduce(doc, { type: 'SetAdvanced', on: true });
		expect(doc.advanced).toBe(true);
	});

	it('cannot be changed once a hand is dealt', () => {
		const doc = fourBots();
		reduce(doc, { type: 'StartHand', seed: 'lock' });
		expect(() => reduce(doc, { type: 'SetAdvanced', on: true })).toThrow(RuleError);
	});
});

describe('SetTraining', () => {
	it('toggles the flag', () => {
		const doc = createGame('T', 0);
		expect(doc.training).toBe(false);
		reduce(doc, { type: 'SetTraining', on: true });
		expect(doc.training).toBe(true);
		reduce(doc, { type: 'SetTraining', on: false });
		expect(doc.training).toBe(false);
	});

	it('can still be toggled mid-game (it is only a UI aid)', () => {
		const doc = fourBots();
		reduce(doc, { type: 'StartHand', seed: 'coach' });
		expect(() => reduce(doc, { type: 'SetTraining', on: true })).not.toThrow();
		expect(doc.training).toBe(true);
	});
});

describe('renege (Advanced mode)', () => {
	// Hearts led; seat 1 holds hearts, so QS / AD are illegal for it.
	function midTrick(): GameDoc {
		const doc = createGame('T', 0);
		doc.phase = 'trick';
		doc.advanced = true;
		doc.trump = 'S';
		doc.maker = 0;
		doc.players = SEATS.map((s) => ({ seat: s, name: `P${s}`, isBot: false, lastSeen: 0 }));
		doc.hands = [[], ['9H', 'KH', 'QS', 'AD'], [], []];
		doc.trick = {
			number: 3,
			leader: 0,
			turn: 1,
			plays: [{ seat: 0, card: 'AH' }],
			winner: null
		};
		return doc;
	}

	const dad: MeldClaim = {
		kind: 'dad',
		group: 'run',
		suit: 'H',
		cards: ['9H', 'TH', 'JH'],
		points: 20,
		top: 3
	};

	it('still rejects an illegal card without allowIllegal', () => {
		expect(() => reduce(midTrick(), { type: 'PlayCard', seat: 1, card: 'QS' })).toThrow(RuleError);
	});

	it('allowIllegal on a legal card just plays it, no renege', () => {
		const doc = midTrick();
		reduce(doc, { type: 'PlayCard', seat: 1, card: '9H', allowIllegal: true });
		expect(doc.renege).toBeNull();
		expect(doc.phase).toBe('trick');
		expect(doc.trick?.plays).toHaveLength(2);
	});

	it('rejects a card that is not in hand even with allowIllegal', () => {
		expect(() =>
			reduce(midTrick(), { type: 'PlayCard', seat: 1, card: 'TD' as Card, allowIllegal: true })
		).toThrow(RuleError);
	});

	it('an illegal card just stands — play continues, no automatic loss', () => {
		const doc = midTrick();
		reduce(doc, { type: 'PlayCard', seat: 1, card: 'QS', allowIllegal: true });

		expect(doc.renege).toEqual({ seat: 1, card: 'QS', called: false });
		expect(doc.phase).toBe('trick');
		expect(doc.trick?.plays).toHaveLength(2);
		expect(doc.trick?.turn).toBe(2);
		expect(doc.score.hands).toHaveLength(0);
	});

	it('the other team calling it ends the hand: caller’s team takes 162', () => {
		const doc = midTrick();
		reduce(doc, { type: 'PlayCard', seat: 1, card: 'QS', allowIllegal: true });
		reduce(doc, { type: 'CallRenege', seat: 0 }); // seat 0 is team 0

		expect(doc.renege?.called).toBe(true);
		expect(doc.phase).toBe('handScored');
		const r = doc.score.hands[0];
		expect(r.renege).toBe(true);
		expect(r.awarded).toEqual([162, 0]);
		expect(doc.score.running).toEqual([162, 0]);
	});

	it('adds the calling team’s announced meld to the 162', () => {
		const doc = midTrick();
		doc.melds.declared[2] = [dad]; // seat 2 is on team 0
		reduce(doc, { type: 'PlayCard', seat: 1, card: 'AD', allowIllegal: true });
		reduce(doc, { type: 'CallRenege', seat: 2 });
		expect(doc.score.hands[0].awarded).toEqual([182, 0]);
	});

	it('a called renege can win the game', () => {
		const doc = midTrick();
		doc.score.running = [400, 120];
		reduce(doc, { type: 'PlayCard', seat: 1, card: 'QS', allowIllegal: true });
		reduce(doc, { type: 'CallRenege', seat: 0 });
		expect(doc.phase).toBe('gameOver');
		expect(doc.winner).toBe(0);
	});

	it('an unproven call is penalised: the accused team takes 162 plus its meld', () => {
		const doc = midTrick(); // nobody played an illegal card
		doc.melds.declared[3] = [dad]; // seat 3 is on team 1 (the accused team)
		reduce(doc, { type: 'CallRenege', seat: 0 }); // team 0 calls with nothing to show

		expect(doc.phase).toBe('handScored');
		const r = doc.score.hands[0];
		expect(r.renege).toBe(true);
		expect(r.awarded).toEqual([0, 182]);
	});

	it('calling on your own team’s illegal card is unproven and costs your team', () => {
		const doc = midTrick();
		reduce(doc, { type: 'PlayCard', seat: 1, card: 'QS', allowIllegal: true }); // seat 1 = team 1
		reduce(doc, { type: 'CallRenege', seat: 3 }); // seat 3 = team 1, same team — not a valid call

		expect(doc.renege?.called).toBe(false);
		expect(doc.score.hands[0].awarded).toEqual([162, 0]); // team 0 takes it
	});

	it('CallRenege requires Advanced mode absent an uncalled renege, and closes once the game is over', () => {
		const off = midTrick();
		off.advanced = false;
		expect(() => reduce(off, { type: 'CallRenege', seat: 0 })).toThrow(RuleError);

		const done = midTrick();
		reduce(done, { type: 'CallRenege', seat: 0 }); // ends the hand -> handScored
		expect(done.phase).toBe('handScored');
		// Still callable from the score breakdown — one more look before everyone
		// presses Continue.
		expect(() => reduce(done, { type: 'CallRenege', seat: 1 })).not.toThrow();

		// Once the whole game has ended, the window is closed.
		done.phase = 'gameOver';
		expect(() => reduce(done, { type: 'CallRenege', seat: 1 })).toThrow(RuleError);
	});
});

describe('manual meld announce + show', () => {
	/** A doc parked at the start of trick one with a chosen trump and hands. */
	function atMeld(): GameDoc {
		const doc = createGame('T', 0);
		doc.phase = 'meld';
		doc.trump = 'S';
		doc.maker = 0;
		doc.makerSeat = 0;
		// seat 0: dad in hearts (9-10-J) + a spare; seat 1: nothing meldable.
		doc.hands = [
			['9H', 'TH', 'JH', 'AS', 'KC', 'QD'],
			['9C', 'AD', 'KD', 'QH', 'TD', '9D'],
			['AH', 'TS', 'KH', 'QC', 'JC', '9S'],
			['AC', 'KS', 'QS', 'JD', 'TC', 'JS']
		];
		doc.trick = { number: 1, leader: 1, turn: 1, plays: [], winner: null };
		return doc;
	}

	it('stores only the claims the player picked, and drops ones the hand lacks', () => {
		const doc = atMeld();
		const fakeFifty: MeldClaim = {
			kind: 'fifty',
			group: 'run',
			suit: 'C',
			cards: ['9C', 'TC', 'JC', 'QC'],
			points: 50,
			top: 4
		};
		reduce(doc, { type: 'AnnounceMeld', seat: 0, claims: [fakeFifty] });
		expect(doc.melds.declared[0]).toEqual([]); // fake claim rejected
	});

	describe('DeclareMeld (hand-picked cards)', () => {
		it('classifies a picked set of cards and appends it', () => {
			const doc = atMeld();
			reduce(doc, { type: 'DeclareMeld', seat: 0, cards: ['9H', 'TH', 'JH'] });
			expect(doc.melds.declared[0]).toMatchObject([{ kind: 'dad', suit: 'H', points: 20 }]);
		});

		it('rejects cards that are not a real meld', () => {
			const doc = atMeld();
			expect(() =>
				reduce(doc, { type: 'DeclareMeld', seat: 0, cards: ['9H', 'JH', 'AS'] })
			).toThrow(RuleError);
			expect(doc.melds.declared[0]).toBeNull();
		});

		it('rejects a card the seat does not hold', () => {
			const doc = atMeld();
			expect(() =>
				reduce(doc, { type: 'DeclareMeld', seat: 0, cards: ['9C', 'TC', 'JC'] })
			).toThrow(RuleError);
		});

		it('rejects a card already used in another of that seat’s melds', () => {
			const doc = atMeld();
			doc.hands[0] = ['9H', 'TH', 'JH', 'QH', 'KH', 'AS'];
			reduce(doc, { type: 'DeclareMeld', seat: 0, cards: ['9H', 'TH', 'JH'] });
			expect(() =>
				reduce(doc, { type: 'DeclareMeld', seat: 0, cards: ['JH', 'QH', 'KH'] })
			).toThrow(RuleError);
		});

		it('routes bella to melds.bella, not the declared list', () => {
			const doc = atMeld();
			doc.hands[2] = ['JS', 'QS', 'KS', 'AS', '9H', '9D']; // seat 2, trump S
			reduce(doc, { type: 'DeclareMeld', seat: 2, cards: ['JS', 'QS', 'KS', 'AS'] }); // fifty
			reduce(doc, { type: 'DeclareMeld', seat: 2, cards: ['KS', 'QS'] }); // bella (K/Q of trump)
			expect(doc.melds.declared[2]?.map((m) => m.kind)).toEqual(['fifty']);
			expect(doc.melds.bella).toBe(2);
		});

		it('"dad \'a\' belle": a declared run through K+Q of trump scores bella with no separate call', () => {
			const doc = atMeld();
			doc.hands[2] = ['JS', 'QS', 'KS', '9H', 'AC', '9D']; // seat 2, trump S: dad = J-Q-K
			reduce(doc, { type: 'DeclareMeld', seat: 2, cards: ['JS', 'QS', 'KS'] });
			expect(doc.melds.declared[2]?.map((m) => m.kind)).toEqual(['dad']);
			expect(doc.melds.bella).toBe(2); // auto-credited, no CallBella needed
		});

		it('never announces which suit a declared meld is in (only shown cards reveal it)', () => {
			const doc = atMeld();
			reduce(doc, { type: 'DeclareMeld', seat: 0, cards: ['9H', 'TH', 'JH'] });
			const added = doc.log.join(' ');
			expect(added).toContain('declares dad');
			expect(added).not.toMatch(/dad [SHDC]\b/);
		});

		it('will not declare once the seat has played to trick one', () => {
			const doc = atMeld();
			reduce(doc, { type: 'PlayCard', seat: 1, card: doc.hands[1][0] }); // seat 1 leads
			expect(doc.phase).toBe('meld');
			const still = doc.hands[1].slice(0, 3);
			expect(() => reduce(doc, { type: 'DeclareMeld', seat: 1, cards: still })).toThrow(RuleError);
		});
	});

	/** Every seat presses Continue on the completed trick on screen. */
	function ackTrick(doc: GameDoc): void {
		for (const seat of [0, 1, 2, 3] as const) reduce(doc, { type: 'AckTrick', seat });
	}

	/** Play trick one (seats 1,2,3,0), landing in `trick` number 2. */
	function throughTrickOne(doc: GameDoc): void {
		for (const seat of [1, 2, 3, 0] as const) {
			reduce(doc, { type: 'PlayCard', seat, card: chooseCard(doc, seat) });
		}
		ackTrick(doc);
		reduce(doc, { type: 'AdvanceTrick' });
		expect(doc.phase).toBe('trick');
		expect(doc.trick?.number).toBe(2);
	}

	it('shows a called meld on the seat’s trick-two turn, and scores it at the end of trick two', () => {
		const doc = atMeld();
		reduce(doc, { type: 'DeclareMeld', seat: 0, cards: ['9H', 'TH', 'JH'] });
		throughTrickOne(doc);

		// trick two leader is whoever won trick one; walk the four turns
		for (let i = 0; i < 4; i++) {
			const seat = doc.trick!.turn;
			if (seat === 0) {
				reduce(doc, { type: 'ShowMeld', seat });
				expect(doc.melds.shown[0].map((m) => m.kind)).toEqual(['dad']);
			}
			reduce(doc, { type: 'PlayCard', seat, card: chooseCard(doc, seat) });
		}
		expect(doc.phase).toBe('trickDone');
		ackTrick(doc);
		reduce(doc, { type: 'AdvanceTrick' });

		expect(doc.melds.resolved).toBe(true);
		expect(doc.melds.points).toEqual([20, 0]);
		expect(doc.trick?.number).toBe(3);
	});

	it('a called meld that is never shown does not score', () => {
		const doc = atMeld();
		reduce(doc, { type: 'DeclareMeld', seat: 0, cards: ['9H', 'TH', 'JH'] });
		throughTrickOne(doc);
		for (let i = 0; i < 4; i++) {
			const seat = doc.trick!.turn;
			reduce(doc, { type: 'PlayCard', seat, card: chooseCard(doc, seat) }); // seat 0 never shows
		}
		ackTrick(doc);
		reduce(doc, { type: 'AdvanceTrick' });
		expect(doc.melds.shownDone[0]).toBe(true);
		expect(doc.melds.shown[0]).toEqual([]);
		expect(doc.melds.points).toEqual([0, 0]);
	});

	it('two equal melds shown by opposing teams cancel; bella still scores', () => {
		const doc = atMeld();
		// seat 0 (team 0) and seat 1 (team 1) each hold a 9-10-J dad; seat 0 also
		// holds bella.
		doc.trump = 'S';
		doc.hands[0] = ['9H', 'TH', 'JH', 'KS', 'QS', 'AD'];
		doc.hands[1] = ['9C', 'TC', 'JC', 'AH', 'KD', 'TD'];
		reduce(doc, { type: 'DeclareMeld', seat: 0, cards: ['9H', 'TH', 'JH'] });
		reduce(doc, { type: 'DeclareMeld', seat: 0, cards: ['KS', 'QS'] }); // bella
		reduce(doc, { type: 'DeclareMeld', seat: 1, cards: ['9C', 'TC', 'JC'] });
		throughTrickOne(doc);
		for (let i = 0; i < 4; i++) {
			const seat = doc.trick!.turn;
			if (seat === 0 || seat === 1) reduce(doc, { type: 'ShowMeld', seat });
			reduce(doc, { type: 'PlayCard', seat, card: chooseCard(doc, seat) });
		}
		ackTrick(doc);
		reduce(doc, { type: 'AdvanceTrick' });
		// the two J-dads cancel; only bella scores, for team 0
		expect(doc.melds.points).toEqual([20, 0]);
	});

	it('showing a meld below one the other team already showed is a renege', () => {
		const doc = createGame('T', 0);
		doc.phase = 'trick';
		doc.trump = 'S';
		doc.maker = 0;
		doc.players = SEATS.map((s) => ({ seat: s, name: `P${s}`, isBot: false, lastSeen: 0 }));
		doc.hands = [['9H'], ['9C'], ['AH'], ['AC']]; // one card each — trick two
		const dad = (suit: 'H' | 'C', cards: Card[], top: number): MeldClaim => ({
			kind: 'dad',
			group: 'run',
			suit,
			cards,
			points: 20,
			top
		});
		doc.melds.declared[0] = [dad('H', ['9H', 'TH', 'JH'], 3)]; // top J
		doc.melds.declared[1] = [dad('C', ['TC', 'JC', 'QC'], 4)]; // top Q — stronger
		doc.trick = { number: 2, leader: 1, turn: 1, plays: [], winner: null };

		reduce(doc, { type: 'ShowMeld', seat: 1 }); // team 1 shows the stronger dad
		expect(doc.melds.shown[1]).toHaveLength(1);
		reduce(doc, { type: 'PlayCard', seat: 1, card: '9C' });
		reduce(doc, { type: 'PlayCard', seat: 2, card: 'AH' });
		reduce(doc, { type: 'PlayCard', seat: 3, card: 'AC' });
		expect(doc.trick!.turn).toBe(0);

		reduce(doc, { type: 'ShowMeld', seat: 0 }); // weaker dad after a stronger one
		expect(doc.renege).toMatchObject({ seat: 0, card: null, called: false });
		expect(doc.melds.shown[0]).toEqual([]);
	});

	it('records makerSeat when trump is named and clears it on the next deal', () => {
		const doc = fourBots();
		reduce(doc, { type: 'StartHand', seed: 'maker' });
		while (doc.phase === 'bid1' || doc.phase === 'bid2') {
			const seat = doc.bidding!.turn;
			reduce(doc, { type: 'Bid', seat, bid: chooseBid(doc, seat) });
		}
		if (doc.phase === 'meld') {
			expect(doc.makerSeat).not.toBeNull();
		}
		// redeal path also leaves makerSeat null
		expect([null, 0, 1, 2, 3]).toContain(doc.makerSeat);
	});
});
