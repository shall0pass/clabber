// Cloudflare Pages Function — the list of open Clabber games.
//
// Route:  /games
//   GET → 200 { games: [{ code, url, host, seats, updatedAt }] }
//
// Backed by the same KV namespace bound as `GAMES`. Each entry keyed `open:<CODE>`
// is written (and periodically refreshed) by `PUT /games/:code` with
// `listed: true`, and carries its summary in KV metadata so the whole list comes
// back from a single `list()` call. Entries expire ~2 min after the last
// heartbeat, so an abandoned game drops off on its own.

const CORS = {
	'access-control-allow-origin': '*',
	'access-control-allow-methods': 'GET, OPTIONS',
	'access-control-allow-headers': 'content-type'
};

const MAX_ROWS = 50;

export function onRequestOptions() {
	return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ env }) {
	const { keys } = await env.GAMES.list({ prefix: 'open:', limit: 1000 });
	const games = keys
		.map((k) => ({ code: k.name.slice('open:'.length), m: k.metadata ?? {} }))
		.filter(({ m }) => typeof m.url === 'string')
		.map(({ code, m }) => ({
			code,
			url: m.url,
			host: typeof m.host === 'string' ? m.host : '',
			seats: Number.isFinite(m.seats) ? m.seats : 0,
			updatedAt: Number.isFinite(m.updatedAt) ? m.updatedAt : 0
		}))
		.sort((a, b) => b.updatedAt - a.updatedAt)
		.slice(0, MAX_ROWS);

	return new Response(JSON.stringify({ games }), {
		headers: { 'content-type': 'application/json', ...CORS }
	});
}
