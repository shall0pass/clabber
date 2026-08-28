// The bot runner. Exactly one connected client ("the host") drives every bot
// seat through bidding, meld and trick play, and starts each new hand.
//
// Election: the online client with the smallest id claims the host role by
// writing `hostActorId` into the doc (see `pickHost`). A live host is left
// alone; a host that presence hasn't heard from is taken over. Automerge's
// last-writer-wins resolves a concurrent claim to one value that every peer
// then agrees on, so at most one client sees `isHost === true`.
//
// Every move is applied through `reduce`, which rejects anything illegal for
// the current position — so a brief double-host during a handover cannot
// double-play: the losing write just throws and is swallowed.

import type { GameStore } from './gameStore.svelte';
import type { Presence } from './presence.svelte';
import { HOST_STALE_MS, nextBotAction, pickHost } from '$lib/clabber/host';

export interface HostOptions {
	/** Humanising think-time bounds for a bot move (ms). */
	minDelayMs?: number;
	maxDelayMs?: number;
	/** Pause on the score screen before dealing the next hand (ms). */
	interHandDelayMs?: number;
	/** Pause before re-dealing after everyone passed twice (ms). */
	redealDelayMs?: number;
	/** How often to re-check the election (ms). */
	electionIntervalMs?: number;
	makeSeed?: () => string;
}

const DEFAULTS: Required<HostOptions> = {
	minDelayMs: 450,
	maxDelayMs: 1150,
	interHandDelayMs: 2500,
	redealDelayMs: 700,
	electionIntervalMs: 2500,
	makeSeed: () => crypto.randomUUID()
};

export class Host {
	#store: GameStore;
	#presence: Presence;
	#clientId: string;
	#opts: Required<HostOptions>;
	#moveTimer: ReturnType<typeof setTimeout> | undefined;
	#electionTimer: ReturnType<typeof setInterval> | undefined;
	#running = false;
	#onChange = () => this.#reconcile();

	constructor(store: GameStore, presence: Presence, opts: HostOptions = {}) {
		this.#store = store;
		this.#presence = presence;
		this.#clientId = store.clientId;
		this.#opts = { ...DEFAULTS, ...opts };
	}

	/** Whether this tab is currently the elected bot runner. Reactive (reads
	 *  the store's `$state` doc). */
	get isHost(): boolean {
		return this.#store.doc?.hostActorId === this.#clientId;
	}

	start(): void {
		if (this.#running) return;
		this.#running = true;
		this.#store.handle.on('change', this.#onChange);
		this.#electionTimer = setInterval(() => this.#elect(), this.#opts.electionIntervalMs);
		this.#elect();
		this.#reconcile();
	}

	stop(): void {
		this.#running = false;
		this.#store.handle.off('change', this.#onChange);
		clearInterval(this.#electionTimer);
		clearTimeout(this.#moveTimer);
		this.#electionTimer = this.#moveTimer = undefined;
	}

	#onlineClientIds(): string[] {
		const now = Date.now();
		const ids = new Set<string>([this.#clientId]);
		for (const [id, seenAt] of Object.entries(this.#presence.seen)) {
			if (now - seenAt < HOST_STALE_MS) ids.add(id);
		}
		return [...ids];
	}

	#elect(): void {
		if (!this.#running) return;
		const doc = this.#store.doc;
		if (!doc) return;
		const online = this.#onlineClientIds();
		const current = doc.hostActorId;
		if (current && online.includes(current)) return; // a live host already holds it
		if (pickHost(online) === this.#clientId && current !== this.#clientId) {
			try {
				this.#store.change({ type: 'HostClaim', actorId: this.#clientId });
			} catch {
				/* concurrent claim — the next tick settles it */
			}
		}
	}

	#reconcile(): void {
		if (!this.#running) return;
		clearTimeout(this.#moveTimer);
		this.#moveTimer = undefined;
		if (!this.isHost) return;

		const doc = this.#store.doc;
		if (!doc || !nextBotAction(doc, this.#opts.makeSeed)) return;

		const { minDelayMs, maxDelayMs, interHandDelayMs, redealDelayMs } = this.#opts;
		const delay =
			doc.phase === 'handScored'
				? interHandDelayMs
				: doc.phase === 'redeal'
					? redealDelayMs
					: minDelayMs + Math.random() * (maxDelayMs - minDelayMs);

		this.#moveTimer = setTimeout(() => {
			this.#moveTimer = undefined;
			if (!this.#running || !this.isHost) return;
			// Re-derive from the current doc — it may have advanced during the wait.
			const action = nextBotAction(this.#store.doc!, this.#opts.makeSeed);
			if (!action) return;
			try {
				this.#store.change(action);
			} catch {
				/* RuleError: another client already made this move */
			}
			// The resulting change event re-enters #reconcile for the next move.
		}, delay);
	}
}
