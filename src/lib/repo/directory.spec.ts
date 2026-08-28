import { afterEach, describe, expect, it, vi } from 'vitest';
import { claimCode, makeCode, normaliseCode, resolveCode } from './directory';

afterEach(() => vi.unstubAllGlobals());

const respond = (status: number, body: unknown) =>
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response(JSON.stringify(body), { status }))
	);

describe('makeCode / normaliseCode', () => {
	it('makes 5-character codes from an unambiguous alphabet', () => {
		for (let i = 0; i < 50; i++) {
			expect(makeCode()).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$/);
		}
	});

	it('upper-cases and strips whitespace', () => {
		expect(normaliseCode('  ab c9 ')).toBe('ABC9');
	});
});

describe('resolveCode', () => {
	it('returns the url when the code is registered', async () => {
		respond(200, { code: 'ABCDE', url: 'automerge:xyz', createdAt: 1 });
		expect(await resolveCode('abcde')).toBe('automerge:xyz');
	});

	it('returns null for an unknown code', async () => {
		respond(404, { error: 'no such game' });
		expect(await resolveCode('ZZZZZ')).toBeNull();
	});
});

describe('claimCode', () => {
	it('is true when the registry accepts the claim', async () => {
		respond(201, { code: 'ABCDE', url: 'automerge:xyz', createdAt: 1 });
		expect(await claimCode('ABCDE', 'automerge:xyz')).toBe(true);
	});

	it('is false when the code is already taken by another game', async () => {
		respond(409, { error: 'code taken' });
		expect(await claimCode('ABCDE', 'automerge:other')).toBe(false);
	});
});
