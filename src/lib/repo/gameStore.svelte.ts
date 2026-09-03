// A Svelte-reactive wrapper around one game's Automerge `DocHandle`.
//
//   store.doc      - the current GameDoc snapshot ($state; updates on sync)
//   store.change() - apply a rules-engine Action inside handle.change()
//   store.mySeat   - which seat this tab occupies, or null

import type { AnyDocumentId, DocHandle } from '@automerge/automerge-repo';
import type { Action } from '$lib/clabber/actions';
import type { GameDoc, Seat } from '$lib/clabber/types';
import { createGame, reduce } from '$lib/clabber';
import { deriveKey, decryptDoc, mergeEncrypted } from './cardCrypto';
import { claimCode, makeCode, resolveCode } from './directory';
import { getRepo } from './repo';

const CLIENT_ID_KEY = 'clabber:clientId';

/** A per-tab identity, stable across reloads. Determines which seat is "me". */
export function getClientId(): string {
	try {
		let id = sessionStorage.getItem(CLIENT_ID_KEY);
		if (!id) {
			id = crypto.randomUUID();
			sessionStorage.setItem(CLIENT_ID_KEY, id);
		}
		return id;
	} catch {
		return crypto.randomUUID();
	}
}

export class GameStore {
	#handle: DocHandle<GameDoc>;
	/** The join code, kept here rather than in the synced document so the sync
	 *  server never sees the key material. `''` for direct construction (tests). */
	#code: string;
	/** Card-encryption key derived from the join code, or `null` when there is no
	 *  usable secret (link-shared game / tests) — then the document is in the
	 *  clear and every path below is the original behaviour. */
	#key: Uint8Array | null;
	readonly clientId: string;
	doc = $state<GameDoc | undefined>(undefined);

	constructor(handle: DocHandle<GameDoc>, code: string = '', clientId: string = getClientId()) {
		this.#handle = handle;
		this.#code = code;
		this.#key = deriveKey(code);
		this.clientId = clientId;
		this.doc = this.#decode(handle.doc());
		handle.on('change', (payload) => {
			this.doc = this.#decode(payload.doc as GameDoc);
		});
	}

	/**
	 * A plaintext view of a synced document snapshot — but only of the hands this
	 * client may legitimately see: its own seat, plus every bot seat when it is
	 * the elected host (which has to run them). Other players' hands, and the deal
	 * seed, stay as ciphertext in `this.doc`, so opening devtools no longer hands
	 * someone the whole table. A determined player can still re-derive the key
	 * from the join code; this only removes the zero-effort peek.
	 */
	#decode(raw: GameDoc): GameDoc {
		if (!this.#key) return raw;
		const players = raw.players ?? [];
		const iAmHost = raw.hostActorId === this.clientId;
		const seats: number[] = [];
		players.forEach((p, s) => {
			if (p == null) return;
			if (p.actorId === this.clientId || (iAmHost && p.isBot)) seats.push(s);
		});
		return decryptDoc(raw as unknown as Record<string, unknown>, this.#key, {
			seats,
			seed: false,
			couldHave: iAmHost
		});
	}

	get handle(): DocHandle<GameDoc> {
		return this.#handle;
	}

	get url(): string {
		return this.#handle.url;
	}

	get code(): string {
		return this.#code || this.doc?.code || '';
	}

	/** The seat this tab occupies, or null if it is only spectating. */
	get mySeat(): Seat | null {
		const players = this.doc?.players ?? [];
		const i = players.findIndex((p) => p != null && p.actorId === this.clientId);
		return i >= 0 ? (i as Seat) : null;
	}

	change(action: Action): void {
		this.#handle.change((d) => {
			if (this.#key) {
				mergeEncrypted(d as unknown as Record<string, unknown>, this.#key, (plain) =>
					reduce(plain, action)
				);
			} else {
				reduce(d as unknown as GameDoc, action);
			}
		});
	}

	/** Apply an action, swallowing a `RuleError` (e.g. a bot raced us to the
	 *  move). Returns whether it applied. For UI-initiated actions. */
	tryChange(action: Action): boolean {
		try {
			this.change(action);
			return true;
		} catch {
			return false;
		}
	}
}

// --- create / join -------------------------------------------------------

type Init = Parameters<ReturnType<typeof getRepo>['create']>[0];

/** Create a brand-new game. Registers a short join code if a registry is
 *  reachable; otherwise the shareable identifier is the document id and the
 *  game is joined by invite link. Pass `listed: true` to advertise it on the
 *  public "looking for players" list while it waits in the lobby. */
export async function createNewGame({
	listed = false
}: { listed?: boolean } = {}): Promise<GameStore> {
	const repo = getRepo();
	const handle = repo.create(createGame('') as Init) as DocHandle<GameDoc>;
	await handle.whenReady();
	if (listed) handle.change((d) => (d.listed = true));

	// `doc.code` only ever holds the (non-secret) document id — the real join
	// code stays out of the synced document so the sync server can't derive the
	// card-encryption key. The code is carried by `GameStore`, the URL fragment
	// and the same-origin registry instead.
	const docId = handle.url.replace(/^automerge:/, '');
	handle.change((d) => (d.code = docId));

	for (let attempt = 0; attempt < 6; attempt++) {
		const code = makeCode();
		let claimed: boolean;
		try {
			claimed = await claimCode(code, handle.url);
		} catch {
			break; // no reachable registry — fall back to the document id
		}
		if (claimed) return new GameStore(handle, code);
		// otherwise: astronomically rare collision, try another code
	}

	return new GameStore(handle, docId);
}

/** Join the game a code points at, or `null` if the code is unknown. */
export async function joinExistingGame(code: string): Promise<GameStore | null> {
	const url = await resolveCode(code);
	if (!url) return null;
	const handle = (await getRepo().find(url as AnyDocumentId)) as DocHandle<GameDoc>;
	await handle.whenReady();
	// A short join code is the encryption secret; a pasted document id / URL is
	// not (link-shared game) — pass the bare id so the URL fragment stays tidy.
	const isShortCode = /^[A-Za-z0-9]{4,12}$/.test(code.trim());
	return new GameStore(handle, isShortCode ? code : url.replace(/^automerge:/, ''));
}
