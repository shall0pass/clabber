import { describe, it, expect } from 'vitest';
import { RuleError, reduce } from './reducer';
import { chooseBid, chooseCard } from './bot';
import { createGame, SEATS } from './state';
import type { GameDoc } from './types';

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
	while (doc.phase === 'meld' || doc.phase === 'trick') {
		const seat = doc.trick!.turn;
		if (doc.phase === 'meld' && doc.melds.declared[seat] == null) {
			reduce(doc, { type: 'AnnounceMeld', seat });
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
