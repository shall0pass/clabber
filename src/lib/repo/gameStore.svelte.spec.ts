import { describe, expect, it } from 'vitest';
import { Repo, type DocHandle } from '@automerge/automerge-repo';
import { createGame } from '$lib/clabber';
import type { GameDoc } from '$lib/clabber/types';
import { GameStore } from './gameStore.svelte';

const tick = () => new Promise((r) => setTimeout(r, 0));

function freshStore(clientId = 'client-1') {
	const repo = new Repo({});
	const handle = repo.create(
		createGame('TEST', 0) as unknown as Record<string, unknown>
	) as unknown as DocHandle<GameDoc>;
	return new GameStore(handle, '', clientId);
}

describe('GameStore', () => {
	it('exposes the current doc and reacts to changes', async () => {
		const store = freshStore();
		expect(store.code).toBe('TEST');
		expect(store.mySeat).toBeNull();

		store.change({ type: 'SetBot', seat: 1, isBot: true, botName: 'Rainbow Goose' });
		await tick();
		expect(store.doc?.players[1]).toMatchObject({ isBot: true, name: 'Rainbow Goose' });
	});

	it('tracks which seat this client occupies', async () => {
		const store = freshStore('me');
		store.change({ type: 'JoinSeat', seat: 2, name: 'Ada', actorId: 'me' });
		await tick();
		expect(store.mySeat).toBe(2);

		store.change({ type: 'LeaveSeat', seat: 2 });
		await tick();
		expect(store.mySeat).toBeNull();
	});

	it('rejects illegal actions by surfacing the RuleError', () => {
		const store = freshStore();
		expect(() => store.change({ type: 'PlayCard', seat: 0, card: 'AS' })).toThrow();
	});
});

describe('GameStore card encryption', () => {
	const PLAIN_CARD = /^[AKQJT9][SHDC]$/;

	function encryptedStore() {
		const repo = new Repo({});
		const handle = repo.create(
			createGame('', 0) as unknown as Record<string, unknown>
		) as unknown as DocHandle<GameDoc>;
		handle.change((d) => ((d as unknown as GameDoc).code = 'the-doc-id'));
		// a short join code turns encryption on
		return { store: new GameStore(handle, 'ABCDE', 'me'), handle };
	}

	it('stores hands and seed as ciphertext but exposes plaintext to the app', async () => {
		const { store, handle } = encryptedStore();
		for (let seat = 0; seat < 4; seat++) {
			store.change({
				type: 'SetBot',
				seat: seat as 0 | 1 | 2 | 3,
				isBot: true,
				botName: `B${seat}`
			});
		}
		store.change({ type: 'StartHand', seed: 'deadbeef' });
		await tick();

		const raw = handle.doc() as unknown as GameDoc;
		expect(raw.hands.flat().length).toBe(24);
		expect(raw.hands.flat().some((c) => PLAIN_CARD.test(c))).toBe(false);
		expect(raw.seed).not.toBe('deadbeef');
		// the real join code never reaches the document
		expect(raw.code).toBe('the-doc-id');

		expect(store.doc!.hands.flat().length).toBe(24);
		expect(store.doc!.hands.flat().every((c) => PLAIN_CARD.test(c))).toBe(true);
		expect(store.doc!.seed).toBe('deadbeef');
	});

	it('a played card moves out of the (encrypted) hand into the plaintext trick', async () => {
		const { store, handle } = encryptedStore();
		for (let seat = 0; seat < 4; seat++) {
			store.change({
				type: 'SetBot',
				seat: seat as 0 | 1 | 2 | 3,
				isBot: true,
				botName: `B${seat}`
			});
		}
		store.change({ type: 'StartHand', seed: 'deadbeef' });
		await tick();

		// accept the up-card so someone is on lead, then play the leader's first card
		const dealer = store.doc!.dealer;
		const leader = ((dealer + 1) % 4) as 0 | 1 | 2 | 3;
		store.change({ type: 'Bid', seat: leader, bid: 'accept' });
		await tick();

		const card = store.doc!.hands[leader][0];
		expect(PLAIN_CARD.test(card)).toBe(true);
		store.change({ type: 'PlayCard', seat: leader, card });
		await tick();

		expect(store.doc!.hands[leader]).not.toContain(card);
		const raw = handle.doc() as unknown as GameDoc;
		expect(raw.trick!.plays[0].card).toBe(card); // played cards are public / plaintext
	});
});
