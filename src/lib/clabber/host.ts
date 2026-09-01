// Deciding what the bot-runner should do. Pure — no Svelte, no Automerge.
// The stateful wiring (timers, election, applying the move) lives in
// `src/lib/repo/host.ts`.

import type { Action } from './actions';
import type { GameDoc, Seat } from './types';
import { chooseBid, chooseCard } from './bot';
import { bestMeld, compareMeldClaim } from './meld';
import { SEATS, otherTeam, seatsOfTeam, teamOf } from './state';

/** How long presence silence means a host is gone. Matches the presence
 *  staleness window so a departed host is dropped consistently. */
export const HOST_STALE_MS = 12_000;

/** The elected host among the currently-online client ids: the
 *  lexicographically smallest, so every client agrees. `null` if the list is
 *  empty. */
export function pickHost(onlineClientIds: readonly string[]): string | null {
	let best: string | null = null;
	for (const id of onlineClientIds) if (best === null || id < best) best = id;
	return best;
}

/** The single action the bot-runner should take for the current position, or
 *  `null` when it is a human's turn or there is nothing to do. */
export function nextBotAction(
	doc: GameDoc,
	makeSeed: () => string = () => crypto.randomUUID()
): Action | null {
	// A competent opponent catches a renege — but only like a real player would,
	// once it is provable from cards already on the table. For an illegal card
	// that means the offender has since played a card they could legally have
	// followed with (see `renegeProvable`); for a beaten-meld show it means
	// trick two has been played out. A human keeps the wider window the rules
	// allow (call any time before the last trick is turned) via the UI.
	const r = doc.renege;
	const callable =
		r != null &&
		!r.called &&
		['meld', 'trick', 'trickDone', 'handScored'].includes(doc.phase) &&
		(r.card == null
			? doc.phase === 'trickDone' || doc.phase === 'handScored'
			: renegeProvable(doc, r));
	if (callable) {
		for (const s of seatsOfTeam(otherTeam(teamOf(r.seat)))) {
			if (doc.players[s]?.isBot) return { type: 'CallRenege', seat: s };
		}
	}

	switch (doc.phase) {
		case 'bid1':
		case 'bid2': {
			const seat = doc.bidding?.turn;
			if (seat == null || !doc.players[seat]?.isBot) return null;
			return { type: 'Bid', seat, bid: chooseBid(doc, seat) };
		}
		case 'meld': {
			const seat = doc.trick?.turn;
			if (seat == null || !doc.players[seat]?.isBot) return null;
			// Call meld before playing the first card, then play it.
			if (doc.melds.declared[seat] == null) return { type: 'AnnounceMeld', seat };
			return { type: 'PlayCard', seat, card: chooseCard(doc, seat) };
		}
		case 'trick': {
			const seat = doc.trick?.turn;
			if (seat == null || !doc.players[seat]?.isBot) return null;
			// Trick two: show the called meld first, unless doing so would be a
			// renege (our best is below one the other team already showed) — then
			// just play and let the meld lapse.
			if (
				doc.trick?.number === 2 &&
				(doc.melds.declared[seat]?.length ?? 0) > 0 &&
				!doc.melds.shownDone[seat] &&
				!showWouldRenege(doc, seat)
			) {
				return { type: 'ShowMeld', seat };
			}
			return { type: 'PlayCard', seat, card: chooseCard(doc, seat) };
		}
		case 'trickDone': {
			// Every seat must press Continue before the trick clears — the host
			// presses it for bot seats immediately, but waits on humans.
			const unacked = SEATS.find((s) => !doc.trickAcks[s]);
			if (unacked == null) return { type: 'AdvanceTrick' };
			if (doc.players[unacked]?.isBot) return { type: 'AckTrick', seat: unacked };
			return null;
		}
		case 'redeal':
			// Keep an unattended game moving: re-deal.
			return { type: 'StartHand', seed: makeSeed() };
		case 'handScored': {
			// Every seat must press Continue before the next hand deals — the
			// host presses it for bot seats immediately, but waits on humans.
			const unacked = SEATS.find((s) => !doc.handAcks[s]);
			if (unacked == null) return { type: 'StartHand', seed: makeSeed() };
			if (doc.players[unacked]?.isBot) return { type: 'AckHand', seat: unacked };
			return null;
		}
		default:
			return null; // lobby, gameOver
	}
}

/** Whether an illegal-card renege is now provable from cards on the table: the
 *  offender has, on a trick *after* the one they fouled, played a card they
 *  could legally have followed with. Scans collected tricks and the trick in
 *  progress. Only then may a bot call it — the same evidence a real opponent
 *  would wait for, rather than the engine's own instant knowledge. */
function renegeProvable(doc: GameDoc, r: NonNullable<GameDoc['renege']>): boolean {
	if (r.card == null || r.trick == null) return false;
	const could = r.couldHave ?? [];
	// trickHistory is 0-indexed; trick number N sits at index N-1, so index
	// r.trick is the first trick after the infraction.
	for (let i = r.trick; i < doc.trickHistory.length; i++) {
		if (could.includes(doc.trickHistory[i].bySeat[r.seat])) return true;
	}
	if (doc.trick && doc.trick.number > r.trick) {
		const p = doc.trick.plays.find((play) => play.seat === r.seat);
		if (p && could.includes(p.card)) return true;
	}
	return false;
}

/** Whether showing `seat`'s called meld now would rank below a meld the other
 *  team has already shown this trick-two round (which would be a renege). */
function showWouldRenege(doc: GameDoc, seat: Seat): boolean {
	const declared = doc.melds.declared[seat] ?? [];
	const mine = bestMeld(declared, doc.trump);
	if (!mine) return false;
	const [x, y] = seatsOfTeam(otherTeam(teamOf(seat)));
	const opp = bestMeld([...(doc.melds.shown[x] ?? []), ...(doc.melds.shown[y] ?? [])], doc.trump);
	return opp != null && compareMeldClaim(mine, opp, doc.trump) < 0;
}
