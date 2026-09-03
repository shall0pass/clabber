// Cloudflare Pages Function — the Clabber join-code registry.
//
// Route:  /games/:code
//   GET    → 200 { code, url, createdAt } | 404
//   PUT    → 201 created | 200 already yours | 409 taken
//            body: { url, listed?, host?, seats? }
//            `listed: true` also (re)publishes an `open:<CODE>` entry that
//            `GET /games` lists — the same call, repeated, is the heartbeat.
//   DELETE → 204  removes only the `open:<CODE>` entry (the game stays
//            resolvable by code); used when a game fills, starts, or empties.
//
// Needs a KV namespace bound as `GAMES` (see wrangler.jsonc or the Pages
// dashboard → Settings → Functions → KV namespace bindings). Only needed if you
// want short join codes; without it, games are shared by invite link.

const CODE_RE = /^[A-Z0-9]{4,12}$/;
const TTL_SECONDS = 7 * 24 * 60 * 60; // forget codes after a week
// An open-game listing is refreshed by a client heartbeat every ~30s; if the
// heartbeats stop (tab closed, host crashed) the entry ages out on its own.
const OPEN_TTL_SECONDS = 120;

const CORS = {
	'access-control-allow-origin': '*',
	'access-control-allow-methods': 'GET, PUT, DELETE, OPTIONS',
	'access-control-allow-headers': 'content-type'
};

const json = (body, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json', ...CORS }
	});

/** Trim a client-supplied host name for public display. */
const cleanHost = (v) => (typeof v === 'string' ? v.trim().slice(0, 40) : '');
/** Clamp a client-supplied filled-seat count to 0..4. */
const cleanSeats = (v) => Math.max(0, Math.min(4, Number.isFinite(v) ? Math.floor(v) : 0));

export function onRequestOptions() {
	return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ params, env }) {
	const code = String(params.code).toUpperCase();
	if (!CODE_RE.test(code)) return json({ error: 'bad code' }, 400);
	const raw = await env.GAMES.get(code);
	if (!raw) return json({ error: 'no such game' }, 404);
	return json({ code, ...JSON.parse(raw) });
}

export async function onRequestPut({ params, env, request }) {
	const code = String(params.code).toUpperCase();
	if (!CODE_RE.test(code)) return json({ error: 'bad code' }, 400);

	let body;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'expected { url }' }, 400);
	}
	const { url, listed, host, seats } = body ?? {};
	if (typeof url !== 'string' || !url.startsWith('automerge:')) {
		return json({ error: 'url must be an automerge: url' }, 400);
	}

	const existing = await env.GAMES.get(code);
	const entry = existing ? JSON.parse(existing) : { url, createdAt: Date.now() };
	if (existing && entry.url !== url) return json({ error: 'code taken' }, 409);

	// (Re)publish or drop this game's open-for-players listing. Stored in KV
	// metadata so `GET /games` returns every listing from one `list()` call.
	if (listed === true) {
		await env.GAMES.put(`open:${code}`, url, {
			expirationTtl: OPEN_TTL_SECONDS,
			metadata: { url, host: cleanHost(host), seats: cleanSeats(seats), updatedAt: Date.now() }
		});
	} else if (listed === false) {
		await env.GAMES.delete(`open:${code}`);
	}

	if (existing) return json({ code, ...entry });
	await env.GAMES.put(code, JSON.stringify(entry), { expirationTtl: TTL_SECONDS });
	return json({ code, ...entry }, 201);
}

export async function onRequestDelete({ params, env }) {
	const code = String(params.code).toUpperCase();
	if (!CODE_RE.test(code)) return json({ error: 'bad code' }, 400);
	await env.GAMES.delete(`open:${code}`);
	return new Response(null, { status: 204, headers: CORS });
}
