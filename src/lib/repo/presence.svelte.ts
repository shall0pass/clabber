// Lightweight presence over Automerge ephemeral messages (which are NOT written
// into the document history). Each tab broadcasts a heartbeat every few
// seconds; peers keep a last-seen time per client id.

import type { DocHandle } from '@automerge/automerge-repo';
import type { GameDoc } from '$lib/clabber/types';

const BEAT_MS = 4000;
const STALE_MS = 15000;

export class Presence {
	#handle: DocHandle<GameDoc>;
	#clientId: string;
	#timer: ReturnType<typeof setInterval> | undefined;
	/** clientId -> last-seen epoch ms. */
	seen = $state<Record<string, number>>({});

	constructor(handle: DocHandle<GameDoc>, clientId: string) {
		this.#handle = handle;
		this.#clientId = clientId;
	}

	start(): void {
		if (this.#timer) return;
		this.#handle.on('ephemeral-message', ({ message }) => {
			const m = message as { t?: string; clientId?: string };
			if (m?.t !== 'hb' || typeof m.clientId !== 'string' || m.clientId === this.#clientId) return;
			const isNew = !this.seen[m.clientId];
			this.seen[m.clientId] = Date.now();
			// Answer a newcomer straight away so presence converges in one round trip.
			if (isNew) this.#send();
		});
		this.#send();
		this.#timer = setInterval(() => this.#send(), BEAT_MS);
	}

	#send(): void {
		this.#handle.broadcast({ t: 'hb', clientId: this.#clientId });
		this.seen[this.#clientId] = Date.now();
		const cutoff = Date.now() - STALE_MS;
		for (const id of Object.keys(this.seen)) {
			if (this.seen[id] < cutoff) delete this.seen[id];
		}
	}

	stop(): void {
		clearInterval(this.#timer);
		this.#timer = undefined;
	}

	isOnline(clientId: string | undefined | null): boolean {
		return !!clientId && Date.now() - (this.seen[clientId] ?? 0) < STALE_MS;
	}
}
