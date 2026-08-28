// Join codes. A short human-friendly code maps to an `automerge:` document url
// via the sync server's tiny registry (see sync-server/server.mjs).

import { SYNC_HTTP } from './repo';

// No 0/O/1/I/L — unambiguous when read aloud or typed.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LEN = 5;

export function makeCode(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(CODE_LEN));
	return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

export function normaliseCode(input: string): string {
	return input.trim().toUpperCase().replace(/\s+/g, '');
}

/** The document url for a code, or `null` if no game has claimed it. */
export async function resolveCode(code: string): Promise<string | null> {
	const res = await fetch(`${SYNC_HTTP}/games/${encodeURIComponent(normaliseCode(code))}`);
	if (res.status === 404) return null;
	if (!res.ok) throw new Error(`could not look up code (${res.status})`);
	return (await res.json()).url as string;
}

/** Claim `code` for `url`. Returns false if the code is already taken by a
 *  different game. */
export async function claimCode(code: string, url: string): Promise<boolean> {
	const res = await fetch(`${SYNC_HTTP}/games/${encodeURIComponent(normaliseCode(code))}`, {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ url })
	});
	if (res.status === 201 || res.status === 200) return true;
	if (res.status === 409) return false;
	throw new Error(`could not claim code (${res.status})`);
}
