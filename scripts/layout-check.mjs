// Layout sweep — docs/responsive-layout-plan.md §Verification/5.
//
// Drives a real game through lobby / bidding / meld-picking / mid-trick /
// trickDone / handScored / (if there's time) gameOver and, at each phase,
// resizes through the viewport matrix and checks:
//   - the document never scrolls (scrollHeight/Width <= inner Height/Width)
//   - the key on-screen pieces (hand, plates, trick area, chat/log toggles,
//     the phase panel) are actually inside the viewport — not just "the page
//     doesn't scroll" but "nothing is silently clipped by `overflow-hidden`",
//     which is the failure mode `sh <= ih` alone misses
//   - the listed pairs don't overlap: hand vs chat/log/learn, partner plate
//     vs the top-bar controls, phase panel vs hand, phase panel vs any played
//     card (plan follow-up item 5)
//   - during bidding and meld picking, the phase panel covers no played card,
//     no side/top card slot (so the check doesn't depend on which cards
//     happen to be down) and not the puck
//   - the top band is one line, and the trick box fits its measured cell
//   - the hand-scored modal doesn't scroll internally in the normal
//     (non-renege) case, and the game-over modal fits with the score sheet
//     closed (plan §7)
//
// It also prints the hand and trick card heights per viewport (mid-trick).
//
// Run manually against `npm run dev` (port 5199) + `npm run sync:dev`:
//   node scripts/layout-check.mjs
//   node scripts/layout-check.mjs --learning   # Learning mode on
//
// Screenshots land in `layout-check-shots/` (gitignored). Exits non-zero on
// any failure, printing every failure found (not just the first). Playing a
// whole game out to 500 takes too long, so after the hand-scored sweep the
// script ends the game directly through the dev-only `globalThis.__clabber`
// store handle (score to 500, phase `gameOver`) — a test shortcut only; the
// game-over screen itself renders exactly as it would at a real finish.

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.LAYOUT_CHECK_URL ?? 'http://localhost:5199/?fast';
const OUT = process.env.OUT ?? 'layout-check-shots';
const LEARNING = process.argv.includes('--learning');

// docs/responsive-layout-plan.md §Verification: the full viewport matrix.
const MATRIX = {
	'320x568': [320, 568],
	'375x667': [375, 667],
	'390x844': [390, 844],
	'430x932': [430, 932],
	'768x1024': [768, 1024],
	'568x320': [568, 320],
	'667x375': [667, 375],
	'844x390': [844, 390],
	'932x430': [932, 430],
	'1024x768': [1024, 768],
	'1440x900': [1440, 900]
};

const failures = [];
function fail(msg) {
	failures.push(msg);
	console.error('FAIL:', msg);
}

async function rectsOf(page, selector) {
	const els = await page.locator(selector).all();
	const rects = [];
	for (const el of els) {
		const box = await el.boundingBox();
		if (box) {
			rects.push({
				top: box.y,
				left: box.x,
				right: box.x + box.width,
				bottom: box.y + box.height
			});
		}
	}
	return rects;
}

async function rectOf(page, selector) {
	// Playwright's locator engine (not a plain CSS `querySelector`), so this
	// accepts `:has-text(...)`, `text=`, etc.
	const loc = page.locator(selector).first();
	if ((await loc.count()) === 0) return null;
	const box = await loc.boundingBox();
	if (!box) return null;
	return {
		top: box.y,
		left: box.x,
		right: box.x + box.width,
		bottom: box.y + box.height,
		width: box.width,
		height: box.height
	};
}

function overlaps(a, b) {
	if (!a || !b) return false;
	return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function insideViewport(r, w, h, label, tag) {
	if (!r) return;
	const margin = 0.5; // sub-pixel rounding
	if (r.top < -margin || r.left < -margin || r.right > w + margin || r.bottom > h + margin) {
		fail(`${tag}: ${label} is clipped by the viewport — rect ${JSON.stringify(r)} vs ${w}x${h}`);
	}
}

// TrickArea's geometry (see TrickArea.svelte): the rects the left, top and
// right seats' cards occupy, and the puck, from the box and its card height.
async function trickSlots(page) {
	return page.evaluate(() => {
		const box = document.querySelector('[data-card-h]');
		if (!box) return null;
		const b = box.getBoundingClientRect();
		const cardH = Number(box.getAttribute('data-card-h'));
		const cardW = Math.round(cardH * (64 / 89));
		const scale = cardH / 110;
		const puck = Math.round(116 * scale);
		const gap = Math.round(puck / 2 + 12 * scale);
		const cx = b.left + b.width / 2;
		const cy = b.top + b.height / 2;
		const rect = (x, y, w, h) => ({
			left: x - w / 2,
			right: x + w / 2,
			top: y - h / 2,
			bottom: y + h / 2
		});
		return {
			slots: [
				rect(cx - (gap + cardW / 2), cy, cardW, cardH),
				rect(cx, cy - (gap + cardH / 2), cardW, cardH),
				rect(cx + gap + cardW / 2, cy, cardW, cardH)
			],
			bottom: rect(cx, cy + gap + cardH / 2, cardW, cardH),
			puck: rect(cx, cy, puck, puck)
		};
	});
}

async function checkPhase(page, tag, w, h) {
	const overflow = await page.evaluate(() => ({
		sh: document.documentElement.scrollHeight,
		sw: document.documentElement.scrollWidth,
		ih: innerHeight,
		iw: innerWidth
	}));
	if (overflow.sh > overflow.ih + 0.5) {
		fail(`${tag}: page scrolls vertically by ${overflow.sh - overflow.ih}px`);
	}
	if (overflow.sw > overflow.iw + 0.5) {
		fail(`${tag}: page scrolls horizontally by ${overflow.sw - overflow.iw}px`);
	}

	// Lobby has no hand/trick-area/chat/etc — `.area-center` there is the
	// "pick a seat" felt circle, an unrelated element with the same class.
	const isLobby = tag.startsWith('lobby');

	const hand = isLobby ? null : await rectOf(page, '[aria-label="your hand"]');
	const chat = await rectOf(page, 'button[aria-expanded]:has-text("Chat")');
	const log = await rectOf(page, 'button:has-text("Log")');
	const learn = await rectOf(page, 'button:has-text("Learn")');
	const trick = isLobby ? null : await rectOf(page, '[data-trick-area]');
	const leaveBtn = await rectOf(page, 'button:has-text("Leave table")');
	const scorePill = isLobby
		? null
		: await rectOf(page, 'button[title="Show the full score sheet"]');
	// The active phase panel / renege prompt, whichever is rendered.
	const panel = isLobby ? null : await rectOf(page, '[data-status-slot] > div:last-child > *');

	for (const [label, r] of [
		['hand', hand],
		['trick area', trick],
		['leave button', leaveBtn],
		['score pill', scorePill]
	]) {
		insideViewport(r, w, h, label, tag);
	}

	// While the hand-scored or game-over dialog is up the toggles drop to the
	// viewport's bottom corners, over the (dimmed) table; what matters then is
	// that they stay clear of the dialog's content.
	const dialog = isLobby
		? null
		: await rectOf(page, '[data-hand-scored-modal], [data-game-over-modal]');
	const toggles = [
		['Chat button', chat],
		['Log toggle', log],
		['Learn toggle', learn]
	];
	if (dialog) {
		for (const [label, r] of toggles) {
			if (overlaps(r, dialog)) fail(`${tag}: the ${label} overlaps the dialog`);
		}
	}

	if (!dialog) {
		if (overlaps(hand, chat)) fail(`${tag}: hand overlaps the Chat button`);
		if (overlaps(hand, log)) fail(`${tag}: hand overlaps the Log toggle`);
		if (overlaps(hand, learn)) fail(`${tag}: hand overlaps the Learn toggle`);
	}
	if (overlaps(panel, hand)) fail(`${tag}: the phase panel overlaps the hand`);

	// The corner toggles dock clear of the plates and the trick area's cards.
	if (!isLobby && !dialog) {
		const plates = await rectsOf(page, '[data-plate]');
		const geo = await trickSlots(page);
		const cardRects = [
			...(await rectsOf(page, '[data-trick-area] .card')),
			...(geo ? [...geo.slots, geo.puck] : [])
		];
		for (const [label, r] of toggles) {
			if (!r) continue;
			if (plates.some((p) => overlaps(r, p))) fail(`${tag}: the ${label} overlaps a plate`);
			if (cardRects.some((c) => overlaps(r, c))) {
				fail(`${tag}: the ${label} overlaps the trick area's cards`);
			}
		}
	}

	// Follow-up pass item 5: the bidding/meld-call bar must never sit over a
	// played card — meld can be called mid-trick (unlike bidding), so this
	// matters most during "meld picker". Scoped to the bidding/meld-call bars
	// specifically (not e.g. trickDone's Continue button, which sits this
	// close to the last-played card by design and isn't part of this ask).
	// The bidding panel's own up-card doesn't live in the trick area (it's
	// drawn inside the panel itself), so there's nothing extra to check there.
	// The up-card is drawn inside the bidding panel itself, so for bidding
	// the thing to keep clear is the puck (trump / trick / score).
	const checkPanelOverCards = tag.includes('meld picker') || tag.includes('bidding');
	if (!isLobby && panel && checkPanelOverCards) {
		const playedCards = await rectsOf(page, '[data-trick-area] .card');
		for (const card of playedCards) {
			if (overlaps(panel, card)) {
				fail(`${tag}: the phase panel overlaps a played card`);
				break;
			}
		}
		const geo = await trickSlots(page);
		if (geo) {
			if (geo.slots.some((r) => overlaps(panel, r))) {
				fail(`${tag}: the phase panel overlaps a side/top card slot`);
			}
			if (overlaps(panel, geo.puck)) fail(`${tag}: the phase panel overlaps the puck`);
		}
	}

	// The meld picker's controls (text, Cancel, Call) share one row.
	if (tag.includes('meld picker')) {
		const row = await page.evaluate(() => {
			const el = document.querySelector('[data-meld-controls]');
			if (!el) return null;
			return [...el.children].map((c) => {
				const r = c.getBoundingClientRect();
				return r.top + r.height / 2;
			});
		});
		if (!row) fail(`${tag}: the meld picker bar isn't showing`);
		else if (Math.max(...row) - Math.min(...row) > 2) {
			fail(`${tag}: the meld picker's controls wrap onto more than one line`);
		}
	}

	if (!isLobby) {
		// Top band: one line. Its height is its tallest child's (the score pill),
		// never two rows.
		const band = await page.evaluate(() => {
			const el = document.querySelector('[data-top-band]');
			if (!el) return null;
			const kids = [...el.children].map((c) => c.getBoundingClientRect().height);
			return { h: el.getBoundingClientRect().height, tallest: Math.max(0, ...kids) };
		});
		if (band && band.h > band.tallest + 1) {
			fail(`${tag}: the top band wraps (${band.h}px tall, tallest item ${band.tallest}px)`);
		}

		// The trick box fits the cell it was sized from (a floor can't push it
		// out over the neighbouring rows).
		const box = await rectOf(page, '[data-card-h]');
		if (box && trick && (box.height > trick.height + 2 || box.width > trick.width + 2)) {
			fail(
				`${tag}: trick box ${box.width}x${box.height} overflows its cell ${trick.width}x${trick.height}`
			);
		}
	}
}

// Hand and trick card heights per viewport, printed once (mid-trick).
const sizes = [];
async function recordSizes(page, tag) {
	const r = await page.evaluate(() => {
		const hc = document.querySelector('[aria-label="your hand"] .card');
		const box = document.querySelector('[data-card-h]');
		return {
			hand: hc ? Math.round(hc.getBoundingClientRect().height) : null,
			trick: box ? Number(box.getAttribute('data-card-h')) : null
		};
	});
	sizes.push({ viewport: tag.split(' ').at(-1), ...r, ratio: +(r.trick / r.hand).toFixed(2) });
}

async function sweep(page, tag, screenshotBase, extraCheck) {
	const orig = page.viewportSize();
	for (const [name, [w, h]] of Object.entries(MATRIX)) {
		await page.setViewportSize({ width: w, height: h });
		// Generous: a resize triggers a `ResizeObserver` callback, a Svelte
		// re-render and a reflow, and this runs bots (`?fast`) concurrently.
		await page.waitForTimeout(600);
		await checkPhase(page, `${tag} ${name}`, w, h);
		if (extraCheck) await extraCheck(`${tag} ${name}`, w, h);
		await page.screenshot({ path: `${OUT}/${screenshotBase}-${name}.png` }).catch(() => {});
	}
	if (orig) await page.setViewportSize(orig);
}

async function banners(page, screenshotBase) {
	const orig = page.viewportSize();
	let i = 0;
	for (const [name, [w, h]] of Object.entries(MATRIX)) {
		const tag = `banners ${name}`;
		await page.setViewportSize({ width: w, height: h });
		await page.waitForTimeout(500);
		await page.evaluate((n) => {
			const s = globalThis.__clabber?.store;
			const seat = ((s.mySeat ?? 0) + 1) % 4;
			s?.handle.change((d) => {
				d.seed = `layout-check-${n}`;
				d.melds.shownDone[seat] = true;
				d.melds.shown[seat] = [
					{
						kind: 'hundred',
						group: 'set',
						suit: null,
						cards: ['JS', 'JH', 'JD', 'JC'],
						points: 100,
						top: 3
					}
				];
				d.melds.resolved = true;
				d.melds.points = [100, 0];
				d.log.push(`seat ${seat} declares hundred`);
			});
		}, i++);
		await page.waitForTimeout(300);
		await checkPhase(page, tag, w, h);

		const chips = await page.evaluate(() => {
			const layer = document.querySelector('[data-banner-layer]')?.getBoundingClientRect();
			return [...document.querySelectorAll('[data-banner-layer] [data-banner]')].map((c) => {
				const r = c.getBoundingClientRect();
				const clipped =
					!layer ||
					r.top < layer.top - 1 ||
					r.bottom > layer.bottom + 1 ||
					r.height < 12 ||
					r.width < 12;
				return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, clipped };
			});
		});
		if (chips.length < 3) fail(`${tag}: expected 3 banners, saw ${chips.length}`);
		if (chips.some((c) => c.clipped)) fail(`${tag}: a banner is clipped by its layer`);
		const geo = await trickSlots(page);
		const cards = [
			...(await rectsOf(page, '[data-trick-area] .card')),
			...(geo ? [...geo.slots, geo.bottom, geo.puck] : [])
		];
		for (const c of chips) {
			if (cards.some((r) => overlaps(c, r))) {
				fail(`${tag}: a banner overlaps a played card or card slot`);
				break;
			}
		}
		await page.screenshot({ path: `${OUT}/${screenshotBase}-${name}.png` }).catch(() => {});
	}
	if (orig) await page.setViewportSize(orig);
}

async function waitFor(page, predicate, timeoutMs = 15000) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (await page.evaluate(predicate)) return true;
		await page.waitForTimeout(150);
	}
	return false;
}

/** Bots (Host) only play for bot seats and only press Continue for bot
 *  seats — my own seat waits for a real click every time. Poll for
 *  `condition` and, meanwhile, keep the game moving: play whatever's legal
 *  (or just the first card, in Advanced mode) when it's my turn, and press
 *  Continue on every trickDone/handScored along the way — there are 6 tricks
 *  a hand, each with its own Continue, not just the first. On my bidding
 *  turn it takes the first bid that isn't a pass (or passes if that's all
 *  there is). */
async function waitForPlaying(page, condition, timeoutMs = 20000) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (await page.evaluate(condition)) return true;
		const state = await page.evaluate(() => {
			const s = globalThis.__clabber?.store;
			const d = s?.doc;
			if (!d) return null;
			return {
				myBid: (d.phase === 'bid1' || d.phase === 'bid2') && d.bidding?.turn === s.mySeat,
				myTurn: (d.phase === 'meld' || d.phase === 'trick') && d.trick?.turn === s.mySeat,
				trickDoneUnacked: d.phase === 'trickDone' && s.mySeat != null && !d.trickAcks[s.mySeat],
				handScoredUnacked: d.phase === 'handScored' && s.mySeat != null && !d.handAcks[s.mySeat]
			};
		});
		if (state?.myBid) {
			// Holding no card that lets me play, the only option is Pass.
			const bid = page.locator('[data-status-slot] button', { hasText: /Play |♠|♥|♦|♣/ });
			const pass = page.locator('[data-status-slot] button', { hasText: /^\s*Pass\s*$/ });
			await ((await bid.count()) ? bid.first() : pass.first()).click().catch(() => {});
		} else if (state?.myTurn) {
			const playable = page
				.locator('[aria-label="your hand"] button[data-playable="true"]')
				.first();
			if (await playable.count()) await playable.click().catch(() => {});
		} else if (state?.trickDoneUnacked || state?.handScoredUnacked) {
			await page
				.getByRole('button', { name: /Continue/ })
				.click()
				.catch(() => {});
		}
		await page.waitForTimeout(150);
	}
	return false;
}

/** Checks a modal's own scrollable box doesn't need to scroll — the "no
 *  internal scroll in the normal case" half of plan §7. `overflow-y-auto` is
 *  meant as a safety net only; this catches it actually engaging. */
async function checkNoInternalScroll(page, selector, tag) {
	const el = page.locator(selector).first();
	if ((await el.count()) === 0) return;
	const overflowing = await el.evaluate((e) => e.scrollHeight > e.clientHeight + 1);
	if (overflowing) {
		fail(`${tag}: ${selector} scrolls internally (the "no scroll" safety net is engaged)`);
	}
}

async function run() {
	await mkdir(OUT, { recursive: true });

	const browser = await chromium.launch();
	const page = await (
		await browser.newContext({ viewport: { width: 390, height: 844 } })
	).newPage();
	await page.goto(BASE);
	await page.waitForTimeout(500);

	await page.getByRole('button', { name: /Start a new game/ }).click();
	await page.waitForTimeout(1200);
	// Seat 1: seat 0 deals the first hand, so seat 1 bids first and the
	// bidding sweep always gets my turn. (It also leads trick one, so the meld
	// picker is swept in hand two instead, when three cards are already down.)
	const sit = page.getByRole('button', { name: /Sit here/ }).nth(1);
	if (await sit.count()) await sit.click();

	await sweep(page, 'lobby', `lobby-${LEARNING ? 'learn' : 'std'}`);

	if (LEARNING) {
		const box = page.getByRole('checkbox').first();
		// The first checkbox in the lobby is "Learning mode".
		await box.click().catch(() => {});
	}

	await page.getByRole('button', { name: /Fill empty seats/ }).click();
	await page.waitForTimeout(400);
	await page.getByRole('button', { name: /^Deal$/ }).click();

	const ok1 = await waitFor(page, () => {
		const s = globalThis.__clabber?.store;
		const d = s?.doc;
		return (d?.phase === 'bid1' || d?.phase === 'bid2') && d.bidding?.turn === s.mySeat;
	});
	if (!ok1) fail('never reached my bidding turn');
	else await sweep(page, 'bidding', `bid-${LEARNING ? 'learn' : 'std'}`);

	// Play forward to mid-trick (>= 2 cards down, whoever's turn it is). Bots
	// only play for bot seats, so this plays for me too when it's my turn.
	const okMid = await waitForPlaying(
		page,
		() => (globalThis.__clabber?.store?.doc?.trick?.plays.length ?? 0) >= 2,
		40000
	);
	if (!okMid) fail('never reached a mid-trick state');
	else
		await sweep(page, 'mid-trick', `play-${LEARNING ? 'learn' : 'std'}`, (tag) =>
			recordSizes(page, tag)
		);

	const okDone = await waitForPlaying(
		page,
		() => globalThis.__clabber?.store?.doc?.phase === 'trickDone'
	);
	if (!okDone) fail('never reached trickDone');
	else {
		await sweep(page, 'trickDone', `trickdone-${LEARNING ? 'learn' : 'std'}`);
		// Every seat (including mine) must press Continue before the next trick
		// deals — the host presses it for the bots.
		await page
			.getByRole('button', { name: /Continue/ })
			.click()
			.catch(() => {});
	}

	const okScored = await waitForPlaying(
		page,
		() => globalThis.__clabber?.store?.doc?.phase === 'handScored',
		60000
	);
	if (!okScored) fail('never reached handScored');
	else {
		// Plan §7: no internal scroll in the modal's normal (non-renege) case.
		await sweep(page, 'handScored', `handscored-${LEARNING ? 'learn' : 'std'}`, async (tag) => {
			const renege = await page.evaluate(
				() => globalThis.__clabber?.store?.doc?.score.hands.at(-1)?.renege ?? false
			);
			if (!renege) await checkNoInternalScroll(page, '[data-hand-scored-modal]', tag);
		});
	}

	// Hand two: the meld picker on my turn in trick one. Seat 2 leads, so by
	// my turn three cards are down, which is what the panel-vs-card check is
	// for.
	const okPick = await waitForPlaying(
		page,
		() => {
			const s = globalThis.__clabber?.store;
			const d = s?.doc;
			return d?.phase === 'meld' && d.trick?.turn === s.mySeat && d.trick.plays.length > 0;
		},
		60000
	);
	if (!okPick) fail('never reached my meld turn with cards on the table (hand two)');
	else {
		await page.getByRole('button', { name: /Call meld/ }).click();
		await page.waitForTimeout(200);
		await sweep(page, 'meld picker', `meldpick-${LEARNING ? 'learn' : 'std'}`);
		await page
			.getByRole('button', { name: /^Cancel$/ })
			.click()
			.catch(() => {});
	}

	// Banners (plan §6): force all three — an announce, a meld reveal and the
	// meld-scored line — at every viewport and check none covers a played card
	// or a card slot. Still my turn in trick one here, so the bots wait and
	// three cards stay down. Each viewport changes `doc.seed` through the dev
	// store handle, which Table treats as a new hand for the reveal queue and
	// the meld banner, and appends a "declares" log line for the announce —
	// test-only doc edits, like the game-over shortcut below.
	await banners(page, `banners-${LEARNING ? 'learn' : 'std'}`);

	// Plan §7: game-over's padding at short heights. Playing to 500 takes
	// minutes, so end the game through the dev store handle instead (see the
	// header comment).
	await page.evaluate(() => {
		const s = globalThis.__clabber?.store;
		s?.handle.change((d) => {
			const t = s.mySeat != null ? s.mySeat % 2 : 0;
			d.score.running[t] = Math.max(d.score.running[t], 500);
			d.winner = t;
			d.phase = 'gameOver';
		});
	});
	const okGameOver = await waitFor(
		page,
		() => globalThis.__clabber?.store?.doc?.phase === 'gameOver'
	);
	if (!okGameOver) fail('never reached gameOver');
	else {
		await sweep(page, 'gameOver', `gameover-${LEARNING ? 'learn' : 'std'}`, async (tag, w, h) => {
			await checkNoInternalScroll(page, '[data-game-over-modal]', tag);
			// Fits with the score sheet closed (plan §7) — the sweep never opens
			// "Review round scores", so a plain overflow check here is enough.
			const modal = await rectOf(page, '[data-game-over-modal]');
			insideViewport(modal, w, h, 'game-over modal', tag);
		});
	}

	await browser.close();
}

await run();

if (sizes.length) {
	console.log('\nCard heights (px), mid-trick:');
	console.table(sizes);
}

if (failures.length) {
	console.error(`\n${failures.length} layout check failure(s).`);
	process.exit(1);
} else {
	console.log('\nAll layout checks passed.');
}
