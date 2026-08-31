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
	// A competent opponent catches a renege. If the other team left an illegal
	// card uncalled and one of its watchers is a bot, that bot calls it.
	const r = doc.renege;
	if (r && !r.called && ['meld', 'trick', 'trickDone', 'handScored'].includes(doc.phase)) {
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
