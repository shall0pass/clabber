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
	const isBlob = (c: string) => c.startsWith('e1:');

	function encryptedStore(clientId = 'me') {
		const repo = new Repo({});
		const handle = repo.create(
			createGame('', 0) as unknown as Record<string, unknown>
		) as unknown as DocHandle<GameDoc>;
		handle.change((d) => ((d as unknown as GameDoc).code = 'the-doc-id'));
		// a short join code turns encryption on
		return { store: new GameStore(handle, 'ABCDE', clientId), handle };
	}

	/** me at seat 0; the other three seats are `spec` ('bot' | 'human'). */
	function seatUp(store: GameStore, spec: ('bot' | 'human')[]) {
		store.change({ type: 'JoinSeat', seat: 0, name: 'Me', actorId: 'me' });
		spec.forEach((kind, i) => {
			const seat = (i + 1) as 1 | 2 | 3;
			if (kind === 'bot') store.change({ type: 'SetBot', seat, isBot: true, botName: `B${seat}` });
			else store.change({ type: 'JoinSeat', seat, name: `H${seat}`, actorId: `h${seat}` });
		});
	}

	it('every hand and the seed are ciphertext in the synced document', async () => {
		const { store, handle } = encryptedStore();
		seatUp(store, ['bot', 'bot', 'bot']);
		store.change({ type: 'StartHand', seed: 'deadbeef' });
		await tick();

		const raw = handle.doc() as unknown as GameDoc;
		expect(raw.hands.flat().length).toBe(24);
		expect(raw.hands.flat().every(isBlob)).toBe(true);
		expect(isBlob(raw.seed)).toBe(true);
		// the real join code never reaches the document
		expect(raw.code).toBe('the-doc-id');
	});

	it('the local snapshot decrypts only my own hand, not another human', async () => {
		const { store } = encryptedStore('me');
		seatUp(store, ['human', 'bot', 'bot']); // not the host — hostActorId is unset
		store.change({ type: 'StartHand', seed: 'deadbeef' });
		await tick();

		expect(store.doc!.hands[0].every((c) => PLAIN_CARD.test(c))).toBe(true);
		expect(store.doc!.hands[1].every(isBlob)).toBe(true); // opponent human
		expect(store.doc!.hands[2].every(isBlob)).toBe(true); // bots — I'm not running them
		expect(isBlob(store.doc!.seed)).toBe(true); // no deal seed to recompute hands from
	});

	it('the elected host also sees the bot hands it has to run', async () => {
		const { store } = encryptedStore('me');
		seatUp(store, ['bot', 'bot', 'bot']);
		store.change({ type: 'HostClaim', actorId: 'me' });
		store.change({ type: 'StartHand', seed: 'deadbeef' });
		await tick();

		for (const s of [0, 1, 2, 3] as const) {
			expect(store.doc!.hands[s].every((c) => PLAIN_CARD.test(c))).toBe(true);
		}
	});

	it('a played card moves out of the (encrypted) hand into the plaintext trick', async () => {
		const { store, handle } = encryptedStore('me');
		seatUp(store, ['bot', 'bot', 'bot']);
		store.change({ type: 'HostClaim', actorId: 'me' }); // so I can see the bot leader's hand
		store.change({ type: 'StartHand', seed: 'deadbeef' });
		await tick();

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
