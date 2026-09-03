// The bot runner. Exactly one connected client ("the host") drives every bot
// seat through bidding, meld and trick play, starts each new hand, and covers
// for humans who drop out.
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
import { publishGame, unpublishGame } from './directory';
import { HOST_STALE_MS, nextBotAction, pickHost } from '$lib/clabber/host';
import { SEATS } from '$lib/clabber/state';
import type { Seat } from '$lib/clabber/types';

/** How often the host refreshes this game's public "looking for players"
 *  listing. Must comfortably beat the registry's ~120s expiry. */
const LISTING_BEAT_MS = 30_000;

export interface HostOptions {
	/** Humanising think-time bounds for a bot move (ms). */
	minDelayMs?: number;
	maxDelayMs?: number;
	/** Unused: a completed trick no longer clears on a timer. It waits for
	 *  every seat to press Continue (`doc.trickAcks`) instead — kept only so
	 *  existing option objects don't need editing. */
	trickDelayMs?: number;
	/** Unused: the score screen no longer deals on a timer. It waits for every
	 *  seat to press Continue (`doc.handAcks`) instead — kept only so existing
	 *  option objects don't need editing. */
	interHandDelayMs?: number;
	/** Pause before re-dealing after everyone passed twice (ms). */
	redealDelayMs?: number;
	/** How often to re-check the election + absent players (ms). */
	electionIntervalMs?: number;
	/** How long a seated human may be offline before the host covers / clears
	 *  their seat (ms, on top of the ~12 s presence window). */
	seatGraceMs?: number;
	makeSeed?: () => string;
}

const DEFAULTS: Required<HostOptions> = {
	minDelayMs: 450,
	maxDelayMs: 1150,
	// A long hold so there's time to study what was played; the "Continue"
	// button lets anyone move on sooner.
	trickDelayMs: 15000,
	// Long enough to read the hand's score breakdown; "Next hand" moves on sooner.
	interHandDelayMs: 15000,
	redealDelayMs: 700,
	electionIntervalMs: 2500,
	seatGraceMs: 25000,
	makeSeed: () => crypto.randomUUID()
};

export class Host {
	#store: GameStore;
	#presence: Presence;
	#clientId: string;
	#opts: Required<HostOptions>;
	#moveTimer: ReturnType<typeof setTimeout> | undefined;
	#tickTimer: ReturnType<typeof setInterval> | undefined;
	#running = false;
	#absentSince = new Map<Seat, number>();
	#onChange = () => this.#reconcile();
	/** Whether this tab currently has an open-game listing published, and when
	 *  it was last refreshed — so the heartbeat stays throttled. */
	#listingUp = false;
	#lastListingBeat = 0;

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
		this.#tickTimer = setInterval(() => this.#tick(), this.#opts.electionIntervalMs);
		this.#tick();
		this.#reconcile();
	}

	stop(): void {
		this.#running = false;
		this.#store.handle.off('change', this.#onChange);
		clearInterval(this.#tickTimer);
		clearTimeout(this.#moveTimer);
		this.#tickTimer = this.#moveTimer = undefined;
		this.#absentSince.clear();
		if (this.#listingUp) {
			this.#listingUp = false;
			void unpublishGame(this.#store.code);
		}
	}

	#tick(): void {
		if (!this.#running) return;
		this.#elect();
		this.#coverAbsentPlayers();
		this.#syncListing();
	}

	/** Keep this game's public "looking for players" listing in step with the
	 *  doc: publish/refresh it while the host, in the lobby, `listed`, with at
	 *  least one human and a free seat; otherwise take it down. Only the elected
	 *  host touches the registry. */
	#syncListing(): void {
		const doc = this.#store.doc;
		const players = doc?.players ?? [];
		const humans = players.filter((p) => p != null && !p.isBot);
		const wantsListing =
			this.isHost &&
			doc?.phase === 'lobby' &&
			!!doc.listed &&
			humans.length > 0 &&
			players.some((p) => p == null);

		if (wantsListing) {
			const now = Date.now();
			if (this.#listingUp && now - this.#lastListingBeat < LISTING_BEAT_MS) return;
			this.#listingUp = true;
			this.#lastListingBeat = now;
			void publishGame(this.#store.code, this.#store.url, {
				host: humans[0]!.name,
				seats: players.filter((p) => p != null).length
			});
		} else if (this.#listingUp) {
			this.#listingUp = false;
			this.#lastListingBeat = 0;
			void unpublishGame(this.#store.code);
		}
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

	/** Once host, clear (in the lobby) or bot-cover (in a hand) a seat whose
	 *  human has been gone past the grace period; hand it straight back when
	 *  they return. */
	#coverAbsentPlayers(): void {
		if (!this.isHost) return;
		const doc = this.#store.doc;
		if (!doc) return;
		const now = Date.now();
		const online = new Set(this.#onlineClientIds());

		for (const seat of SEATS) {
			const p = doc.players[seat];
			if (!p || !p.actorId) {
				this.#absentSince.delete(seat);
				continue;
			}
			if (online.has(p.actorId)) {
				this.#absentSince.delete(seat);
				if (p.isBot && doc.phase !== 'lobby') {
					this.#safe({ type: 'CoverSeat', seat, isBot: false }); // welcome back
				}
				continue;
			}
			// human gone
			const since = this.#absentSince.get(seat) ?? (this.#absentSince.set(seat, now), now);
			if (now - since < this.#opts.seatGraceMs) continue;
			this.#absentSince.delete(seat);
			if (doc.phase === 'lobby') this.#safe({ type: 'LeaveSeat', seat });
			else if (!p.isBot) this.#safe({ type: 'CoverSeat', seat, isBot: true });
		}
	}

	#safe(action: Parameters<GameStore['change']>[0]): void {
		try {
			this.#store.change(action);
		} catch {
			/* raced by another client */
		}
	}

	#reconcile(): void {
		if (!this.#running) return;
		clearTimeout(this.#moveTimer);
		this.#moveTimer = undefined;
		this.#coverAbsentPlayers();
		this.#syncListing();
		if (!this.isHost) return;

		const doc = this.#store.doc;
		const pending = nextBotAction(doc!, this.#opts.makeSeed);
		if (!doc || !pending) return;

		const { minDelayMs, maxDelayMs, redealDelayMs } = this.#opts;
		const thinkDelay = minDelayMs + Math.random() * (maxDelayMs - minDelayMs);
		// Neither `trickDone` nor `handScored` gets a fixed hold any more: a
		// trick clears, and the next hand deals, as soon as every seat has
		// pressed Continue (bots do so at the normal think-delay) — not on a
		// clock. See `doc.trickAcks` / `doc.handAcks`.
		const delay =
			pending.type === 'CallRenege'
				? thinkDelay // catch it promptly, whatever the phase's usual hold is
				: doc.phase === 'redeal'
					? redealDelayMs
					: thinkDelay;

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
