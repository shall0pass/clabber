import { describe, expect, it } from 'vitest';
import { Repo, type DocHandle } from '@automerge/automerge-repo';
import { createGame, SEATS } from '$lib/clabber';
import type { GameDoc } from '$lib/clabber/types';
import { GameStore } from './gameStore.svelte';
import { Presence } from './presence.svelte';
import { Host } from './host';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function setup(clientId: string) {
	const repo = new Repo({});
	const handle = repo.create(
		createGame('HOSTTEST', 0) as unknown as Record<string, unknown>
	) as unknown as DocHandle<GameDoc>;
	const store = new GameStore(handle, clientId);
	const presence = new Presence(handle, clientId);
	const host = new Host(store, presence, {
		minDelayMs: 0,
		maxDelayMs: 0,
		interHandDelayMs: 0,
		redealDelayMs: 0,
		electionIntervalMs: 200
	});
	return { store, presence, host };
}

describe('Host', () => {
	it('claims the role and drives the bots off the lobby', async () => {
		const { store, host } = setup('solo');
		for (const s of SEATS) store.change({ type: 'SetBot', seat: s, isBot: true });
		host.start();
		await wait(30);
		expect(host.isHost).toBe(true);

		store.change({ type: 'StartHand', seed: 'go' });
		// Give the reconciler a moment to work through bidding + first tricks.
		const deadline = Date.now() + 4000;
		while (['bid1', 'bid2'].includes(store.doc?.phase ?? '') && Date.now() < deadline) {
			await wait(20);
		}
		host.stop();
		expect(['meld', 'trick', 'handScored', 'redeal', 'gameOver']).toContain(store.doc?.phase);
	});

	it('does not drive the bots when another live client is the host', async () => {
		const { store, presence, host } = setup('zzz');
		presence.seen['aaa'] = Date.now(); // 'aaa' is online...
		store.change({ type: 'HostClaim', actorId: 'aaa' }); // ...and holds the role
		for (const s of SEATS) store.change({ type: 'SetBot', seat: s, isBot: true });

		host.start();
		await wait(60);
		expect(host.isHost).toBe(false);

		store.change({ type: 'StartHand', seed: 'nogo' });
		await wait(200);
		expect(store.doc?.phase).toBe('bid1'); // nobody advanced it
		host.stop();
	});

	it('takes over when the current host goes silent', async () => {
		const { store, presence, host } = setup('bbb');
		presence.seen['aaa'] = Date.now() - 30_000; // stale
		store.change({ type: 'HostClaim', actorId: 'aaa' });
		host.start();

		const deadline = Date.now() + 2000;
		while (!host.isHost && Date.now() < deadline) await wait(20);
		expect(host.isHost).toBe(true);
		host.stop();
	});

	it('takes over a stale host mid-hand and runs the game to completion', async () => {
		const { store, presence, host } = setup('bbb');
		presence.seen['gone'] = Date.now() - 30_000;
		store.change({ type: 'HostClaim', actorId: 'gone' });
		for (const s of SEATS) store.change({ type: 'SetBot', seat: s, isBot: true });
		store.change({ type: 'StartHand', seed: 'resume-me' });

		host.start(); // 'gone' never acts — our Host must resume and finish
		const deadline = Date.now() + 20_000;
		while (store.doc?.phase !== 'gameOver' && Date.now() < deadline) await wait(20);
		host.stop();

		expect(store.doc?.phase).toBe('gameOver');
		expect([0, 1]).toContain(store.doc?.winner);
	});
});
