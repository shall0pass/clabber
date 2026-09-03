import { describe, expect, it } from 'vitest';
import {
	decField,
	decryptDoc,
	deriveKey,
	encField,
	encryptDoc,
	looksEncrypted,
	mergeEncrypted,
	PLAIN_CARD_RE
} from './cardCrypto';
import { createGame } from '$lib/clabber';
import type { GameDoc } from '$lib/clabber/types';

const KEY = deriveKey('ABCDE')!;

describe('deriveKey', () => {
	it('returns a 32-byte key for a short join code, deterministically', () => {
		const a = deriveKey('ABCDE');
		const b = deriveKey('abcde'); // normalised to upper-case
		expect(a).toBeInstanceOf(Uint8Array);
		expect(a!.length).toBe(32);
		expect([...b!]).toEqual([...a!]);
	});

	it('returns null when there is no usable secret', () => {
		expect(deriveKey('')).toBeNull();
		expect(deriveKey(undefined)).toBeNull();
		// a bare document id / URL is not a short code
		expect(deriveKey('3sMDf1r2Vq8p7bKjN4hLxYtW9uZc')).toBeNull();
		expect(deriveKey('automerge:3sMDf1r2Vq8p7bKjN4hLxYtW9uZc')).toBeNull();
	});
});

describe('encField / decField', () => {
	it('round-trips a card', () => {
		const blob = encField(KEY, 'AS');
		expect(looksEncrypted(blob)).toBe(true);
		expect(blob).not.toMatch(PLAIN_CARD_RE);
		expect(decField(KEY, blob)).toBe('AS');
	});

	it('produces a different blob each time (random nonce)', () => {
		expect(encField(KEY, 'AS')).not.toBe(encField(KEY, 'AS'));
	});

	it('fails to decrypt under a different key', () => {
		const blob = encField(KEY, 'AS');
		expect(() => decField(deriveKey('ZZZZZ')!, blob)).toThrow();
	});
});

describe('decryptDoc / encryptDoc', () => {
	function dealtDoc(): GameDoc {
		const d = createGame('', 0);
		d.seed = 'seed-abc';
		d.hands = [
			['AS', 'KH'],
			['9C', 'TD'],
			['QS', 'JH'],
			['AH', 'KC']
		];
		d.melds.declared[0] = [
			{
				kind: 'fifty',
				group: 'run',
				suit: 'S',
				cards: ['AS', 'KS', 'QS', 'JS'],
				points: 50,
				top: 6
			}
		];
		d.renege = { seat: 1, card: null, called: false, couldHave: ['9H', 'TH'] };
		return d;
	}

	it('leaves an all-plaintext document untouched', () => {
		const plain = dealtDoc();
		expect(decryptDoc(plain as unknown as Record<string, unknown>, KEY)).toEqual(plain);
	});

	it('round-trips every secret card field through encrypt then decrypt', () => {
		const plain = dealtDoc();
		const enc = encryptDoc(plain as unknown as Record<string, unknown>, KEY);

		// secret fields are now blobs, not cards
		expect((enc.hands as string[][]).flat().every(looksEncrypted)).toBe(true);
		expect(looksEncrypted(enc.seed)).toBe(true);
		const declared = (enc.melds as { declared: { cards: string[] }[][] }).declared[0];
		expect(declared[0].cards.every(looksEncrypted)).toBe(true);
		expect((enc.renege as { couldHave: string[] }).couldHave.every(looksEncrypted)).toBe(true);

		// public fields left alone
		expect(enc.phase).toBe(plain.phase);
		expect(enc.players).toEqual(plain.players);

		expect(decryptDoc(enc, KEY)).toEqual(plain);
	});

	it('keeps an undecryptable blob rather than throwing (wrong key)', () => {
		const enc = encryptDoc(dealtDoc() as unknown as Record<string, unknown>, KEY);
		const wrong = decryptDoc(enc, deriveKey('ZZZZZ')!);
		expect((wrong.hands as string[][])[0].every(looksEncrypted)).toBe(true);
	});
});

describe('mergeEncrypted', () => {
	it('writes changed secret fields as ciphertext and leaves the rest', () => {
		const target: Record<string, unknown> = encryptDoc(
			(() => {
				const d = createGame('', 0);
				d.seed = 's0';
				d.hands = [
					['AS', 'KH'],
					['9C', 'TD'],
					['QS', 'JH'],
					['AH', 'KC']
				];
				return d;
			})() as unknown as Record<string, unknown>,
			KEY
		);
		const seedBefore = target.seed;
		const hand1Before = JSON.stringify(target.hands ? (target.hands as string[][])[1] : null);

		mergeEncrypted(target, KEY, (plain) => {
			plain.hands[0] = plain.hands[0].filter((c) => c !== 'AS');
			plain.phase = 'bid1';
		});

		// hand 0 changed -> re-encrypted, still ciphertext, decrypts correctly
		expect((target.hands as string[][])[0].every(looksEncrypted)).toBe(true);
		expect(decryptDoc(target, KEY).hands[0]).toEqual(['KH']);
		// untouched fields are byte-for-byte the same blobs
		expect(target.seed).toBe(seedBefore);
		expect(JSON.stringify((target.hands as string[][])[1])).toBe(hand1Before);
		// a public field still flows through in the clear
		expect(target.phase).toBe('bid1');
	});

	it('propagates a reducer throw without mutating the target', () => {
		const target: Record<string, unknown> = encryptDoc(
			createGame('', 0) as unknown as Record<string, unknown>,
			KEY
		);
		const snapshot = JSON.stringify(target);
		expect(() =>
			mergeEncrypted(target, KEY, () => {
				throw new Error('nope');
			})
		).toThrow('nope');
		expect(JSON.stringify(target)).toBe(snapshot);
	});
});
