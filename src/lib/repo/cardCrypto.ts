// Obscuring card values in the shared Automerge document.
//
// Everyone's hand lives in the one synced `GameDoc`, and Automerge stores string
// values uncompressed, so a `Card` like "AS" is plainly readable in the traffic
// to the sync server and in anyone's copy of the document. This module encrypts
// the genuinely-secret card fields so the sync operator, or someone holding just
// the document URL, cannot read them.
//
// Threat model: the sync server and URL-only holders. NOT a fellow player — they
// have the same key and could decrypt regardless; stopping that needs per-seat
// key exchange and is out of scope.
//
// Key: derived from the join code (see `deriveKey`). A 5-char code is only ~25
// bits, so this is obfuscation, not strong confidentiality — a determined
// attacker with known card plaintext could brute force it offline. The code is
// deliberately kept OUT of the synced document (`gameStore` stores the document
// id in `doc.code` instead) so the sync server never sees the key material.

import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import type { GameDoc } from '$lib/clabber/types';
import { normaliseCode } from './directory';

const SALT = new TextEncoder().encode('clabber/cards/v1');
const PBKDF2_ITERS = 100_000;
const NONCE_LEN = 12;
// Marks one of our ciphertext blobs, so decoding can tell an encrypted value
// from a plain card ("AS") or an old unencrypted document. Bump on format change.
const TAG = 'e1:';

/** A bare, unencrypted card. */
export const PLAIN_CARD_RE = /^[AKQJT9][SHDC]$/;
/** The registry's join-code shape; anything else (e.g. a pasted document id) has
 *  no secret to derive a key from. */
const CODE_RE = /^[A-Z0-9]{4,12}$/;

const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder();

/** The 256-bit card key for a game, or `null` when there is no usable secret
 *  (empty code, or a document id / URL rather than a short join code) — in which
 *  case the caller leaves the document in the clear, exactly as before. */
export function deriveKey(code: string | undefined): Uint8Array | null {
	const c = normaliseCode(code ?? '');
	if (!CODE_RE.test(c)) return null;
	return pbkdf2(sha256, utf8.encode(c), SALT, { c: PBKDF2_ITERS, dkLen: 32 });
}

export function looksEncrypted(v: unknown): v is string {
	return typeof v === 'string' && v.startsWith(TAG);
}

function b64urlEncode(bytes: Uint8Array): string {
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str: string): Uint8Array {
	const s = str.replace(/-/g, '+').replace(/_/g, '/');
	const bin = atob(s);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

/** Encrypt one short string (a card, or the deal seed). */
export function encField(key: Uint8Array, plain: string): string {
	const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LEN));
	const ct = chacha20poly1305(key, nonce).encrypt(utf8.encode(plain));
	const buf = new Uint8Array(NONCE_LEN + ct.length);
	buf.set(nonce, 0);
	buf.set(ct, NONCE_LEN);
	return TAG + b64urlEncode(buf);
}

/** Decrypt a blob from `encField`. Throws if `key` is wrong or the blob is
 *  corrupt. */
export function decField(key: Uint8Array, blob: string): string {
	const buf = b64urlDecode(blob.slice(TAG.length));
	const nonce = buf.subarray(0, NONCE_LEN);
	const ct = buf.subarray(NONCE_LEN);
	return fromUtf8.decode(chacha20poly1305(key, nonce).decrypt(ct));
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const jsonEq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

type AnyDoc = Record<string, unknown>;

/** Which parts of the document a walk should touch. Encryption always touches
 *  everything; decryption for a client's own screen restricts `hands` /
 *  `melds.declared` to the seats it may legitimately see. */
export interface CardScope {
	/** Seats whose `hands` and declared-meld cards to include — `'all'` (default)
	 *  or a list of seat indices. */
	seats?: 'all' | readonly number[];
	/** Include `doc.seed` (default true). Left out of a per-screen decrypt so a
	 *  player can't recompute the deal from it. */
	seed?: boolean;
	/** Include `doc.renege.couldHave` (default true). */
	couldHave?: boolean;
}

const inScope = (scope: CardScope['seats'], seat: number) =>
	scope === undefined || scope === 'all' || scope.includes(seat);

/** Apply `fn` to every in-scope secret card/seed string in a *copy* of `doc` and
 *  return the copy. `fn` sees each string once; it decides encrypt vs. decrypt. */
function mapSecretStrings(doc: AnyDoc, fn: (s: string) => string, scope: CardScope = {}): AnyDoc {
	const d = clone(doc);

	if (Array.isArray(d.hands)) {
		d.hands = (d.hands as unknown[]).map((h, seat) =>
			Array.isArray(h) && inScope(scope.seats, seat) ? h.map((c) => fn(c as string)) : h
		);
	}

	if (scope.seed !== false && typeof d.seed === 'string' && d.seed !== '') d.seed = fn(d.seed);

	const melds = d.melds as AnyDoc | undefined;
	if (melds && Array.isArray(melds.declared)) {
		melds.declared = (melds.declared as unknown[]).map((seat, i) =>
			Array.isArray(seat) && inScope(scope.seats, i)
				? seat.map((claim) => {
						const c = claim as AnyDoc;
						return Array.isArray(c.cards) ? { ...c, cards: (c.cards as string[]).map(fn) } : c;
					})
				: seat
		);
	}

	const renege = d.renege as AnyDoc | null | undefined;
	if (scope.couldHave !== false && renege && Array.isArray(renege.couldHave)) {
		renege.couldHave = (renege.couldHave as string[]).map(fn);
	}

	return d;
}

/** A plaintext copy of `doc` with secret card fields decrypted. `scope` limits
 *  which seats' hands are revealed (default: all). Values that aren't our blobs
 *  (a plain "AS", or a seed from an unencrypted game) pass through untouched, so
 *  old / half-migrated documents still render; a blob that fails to decrypt
 *  (wrong key, or a seat left out of scope by construction) is left as-is. */
export function decryptDoc(doc: AnyDoc, key: Uint8Array, scope: CardScope = {}): GameDoc {
	return mapSecretStrings(
		doc,
		(s) => {
			if (!looksEncrypted(s)) return s;
			try {
				return decField(key, s);
			} catch {
				return s;
			}
		},
		scope
	) as unknown as GameDoc;
}

/** A copy of `doc` with every secret card field encrypted. Already-encrypted and
 *  empty values are left alone. */
export function encryptDoc(doc: AnyDoc, key: Uint8Array): AnyDoc {
	return mapSecretStrings(doc, (s) => (looksEncrypted(s) ? s : encField(key, s)));
}

/** Every secret card/seed string in `doc`, in a stable order. */
function secretStrings(doc: AnyDoc): string[] {
	const out: string[] = [];
	mapSecretStrings(doc, (s) => {
		out.push(s);
		return s;
	});
	return out;
}

/**
 * Run `mutate` (the rules reducer) against a decrypted view of the Automerge
 * change proxy `target`, then write back only the top-level fields that actually
 * changed — re-encrypting the secret ones. Keeps the reducer working purely on
 * plaintext cards and keeps the Automerge history about as small as before.
 *
 * `mutate` may throw a `RuleError`; it does so before `target` is touched, so a
 * rejected action leaves the document unchanged.
 */
export function mergeEncrypted(
	target: AnyDoc,
	key: Uint8Array,
	mutate: (plain: GameDoc) => void
): void {
	const before = decryptDoc(target, key) as unknown as AnyDoc;
	const after = clone(before);
	mutate(after as unknown as GameDoc);

	// Reuse the existing ciphertext for any card/seed whose plaintext is
	// unchanged, so a single card play doesn't re-nonce every hand in the
	// Automerge history. Card and seed values are unique within a document, so a
	// value → blob map is unambiguous.
	const plains = secretStrings(before);
	const blobs = secretStrings(target);
	const reuse = new Map<string, string>();
	for (let i = 0; i < plains.length; i++) {
		if (looksEncrypted(blobs[i])) reuse.set(plains[i], blobs[i]);
	}
	const afterEnc = mapSecretStrings(
		after,
		(s) => reuse.get(s) ?? (looksEncrypted(s) ? s : encField(key, s))
	);

	for (const k of Object.keys(after)) {
		if (!jsonEq(before[k], after[k])) target[k] = afterEnc[k];
	}
}
