// The single entry point for changing a game. `reduce` mutates `doc` in place
// (so it drops straight into an Automerge `change` block) and throws
// `RuleError` on an illegal action. UI and bots should gate on `legalMoves` /
// `legalBids` first; the throw is the backstop.

import type { Action } from './actions';
import type { GameDoc, HandResult, MeldClaim, Seat, Suit, TeamId } from './types';
import { suitOf, trickWinner } from './cards';
import { legalBids, sameBid, describeBid } from './bidding';
import { deal } from './deal';
import {
	classifyMeld,
	detectMelds,
	resolveMeld,
	selectBestMelds,
	sameMeldClaim,
	validateClaims
} from './meld';
import { legalMoves } from './play';
import { checkGameEnd, scoreHand } from './score';
import { nextSeat, otherTeam, seatsOfTeam, teamOf } from './state';

export class RuleError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'RuleError';
	}
}

function fail(message: string): never {
	throw new RuleError(message);
}

export function reduce(doc: GameDoc, action: Action): void {
	switch (action.type) {
		case 'JoinSeat':
			return joinSeat(doc, action);
		case 'LeaveSeat':
			return leaveSeat(doc, action);
		case 'RenameSeat':
			return renameSeat(doc, action);
		case 'SetBot':
			return setBot(doc, action);
		case 'SetAdvanced':
			return setAdvanced(doc, action);
		case 'SetTraining':
			doc.training = action.on;
			return;
		case 'StartHand':
			return startHand(doc, action);
		case 'Bid':
			return bid(doc, action);
		case 'AnnounceMeld':
			return announceMeld(doc, action);
		case 'DeclareMeld':
			return declareMeld(doc, action);
		case 'ShowMeld':
			return showMeld(doc, action);
		case 'AdvanceMeldReveal':
			return advanceMeldReveal(doc);
		case 'PlayCard':
			return playCard(doc, action);
		case 'CallRenege':
			return callRenege(doc, action);
		case 'AdvanceTrick':
			return advanceTrick(doc);
		case 'HostClaim':
			doc.hostActorId = action.actorId;
			return;
		case 'CoverSeat': {
			const p = doc.players[action.seat];
			if (p) p.isBot = action.isBot;
			return;
		}
		case 'ResetToLobby':
			return resetToLobby(doc);
		case 'LeaveTable':
			return leaveTable(doc, action);
		case 'SendChat':
			return sendChat(doc, action);
	}
}

function leaveTable(doc: GameDoc, a: Extract<Action, { type: 'LeaveTable' }>): void {
	if (!doc.players[a.seat]) return;
	const name = a.botName.trim() || `Bot ${a.seat + 1}`;
	// Replace the human with a bot; drop actorId so a fresh join can't re-seat.
	doc.players[a.seat] = {
		seat: a.seat,
		name,
		isBot: true,
		botName: name,
		lastSeen: doc.createdAt
	};
	doc.log.push(`seat ${a.seat} left; ${name} takes over`);
}

/** Newest-first cap so the chat can't grow the document without bound. */
const CHAT_LIMIT = 100;

function sendChat(doc: GameDoc, a: Extract<Action, { type: 'SendChat' }>): void {
	const text = a.text.trim().slice(0, 500);
	if (!text) return;
	if (!doc.chat) doc.chat = [];
	doc.chat.push({
		id: a.id,
		from: a.from,
		name: a.name.trim().slice(0, 40) || 'Player',
		seat: a.seat,
		text,
		ts: a.ts
	});
	if (doc.chat.length > CHAT_LIMIT) doc.chat.splice(0, doc.chat.length - CHAT_LIMIT);
}

function resetToLobby(doc: GameDoc): void {
	if (doc.phase !== 'gameOver')
		fail(`can only reset to the lobby after a game (phase ${doc.phase})`);
	doc.phase = 'lobby';
	doc.dealer = 0;
	doc.makerSeat = null;
	doc.seed = '';
	doc.hands = [[], [], [], []];
	doc.upCard = null;
	doc.trump = null;
	doc.maker = null;
	doc.bidding = null;
	doc.trick = null;
	doc.wonBySeat = [[], [], [], []];
	doc.lastTrickWinner = null;
	doc.melds = {
		declared: [null, null, null, null],
		shown: [false, false, false, false],
		resolved: false,
		scoredTeam: null,
		points: [0, 0]
	};
	doc.renege = null;
	doc.score = { running: [0, 0], hands: [] };
	doc.winner = null;
	doc.log.push('back to the lobby for another game');
}

// --- lobby -----------------------------------------------------------------

function requireLobby(doc: GameDoc): void {
	if (doc.phase !== 'lobby') fail(`seats can only change in the lobby (phase ${doc.phase})`);
}

function joinSeat(doc: GameDoc, a: Extract<Action, { type: 'JoinSeat' }>): void {
	requireLobby(doc);
	const cur = doc.players[a.seat];
	if (cur && !cur.isBot) fail(`seat ${a.seat} is taken`);
	doc.players[a.seat] = {
		seat: a.seat,
		name: a.name.trim() || `Player ${a.seat + 1}`,
		isBot: false,
		actorId: a.actorId,
		lastSeen: doc.createdAt
	};
}

function leaveSeat(doc: GameDoc, a: Extract<Action, { type: 'LeaveSeat' }>): void {
	requireLobby(doc);
	doc.players[a.seat] = null;
}

function renameSeat(doc: GameDoc, a: Extract<Action, { type: 'RenameSeat' }>): void {
	const p = doc.players[a.seat];
	if (!p) fail(`seat ${a.seat} is empty`);
	const name = a.name.trim();
	if (!name) fail('name cannot be blank');
	p.name = name;
}

function setBot(doc: GameDoc, a: Extract<Action, { type: 'SetBot' }>): void {
	requireLobby(doc);
	if (a.isBot) {
		const name = a.botName?.trim() || `Bot ${a.seat + 1}`;
		doc.players[a.seat] = {
			seat: a.seat,
			name,
			isBot: true,
			botName: name,
			lastSeen: doc.createdAt
		};
	} else if (doc.players[a.seat]?.isBot) {
		doc.players[a.seat] = null;
	}
}

function setAdvanced(doc: GameDoc, a: Extract<Action, { type: 'SetAdvanced' }>): void {
	if (doc.phase !== 'lobby')
		fail(`Advanced mode can only change in the lobby (phase ${doc.phase})`);
	doc.advanced = a.on;
}

// --- dealing -------------------------------------------------------------

function startHand(doc: GameDoc, a: Extract<Action, { type: 'StartHand' }>): void {
	if (doc.phase !== 'lobby' && doc.phase !== 'handScored' && doc.phase !== 'redeal') {
		fail(`cannot start a hand from phase ${doc.phase}`);
	}
	if (doc.players.some((p) => p == null)) fail('all four seats must be filled');

	const dealer: Seat = doc.phase === 'handScored' ? nextSeat(doc.dealer) : doc.dealer;
	const { hands, upCard } = deal(a.seed, dealer);

	doc.dealer = dealer;
	doc.makerSeat = null;
	doc.seed = a.seed;
	doc.hands = hands;
	doc.upCard = upCard;
	doc.trump = null;
	doc.maker = null;
	doc.trick = null;
	doc.wonBySeat = [[], [], [], []];
	doc.lastTrickWinner = null;
	doc.melds = {
		declared: [null, null, null, null],
		shown: [false, false, false, false],
		resolved: false,
		scoredTeam: null,
		points: [0, 0]
	};
	doc.renege = null;
	doc.bidding = { round: 1, turn: nextSeat(dealer), passes: [], passedSuit: null };
	doc.phase = 'bid1';
	doc.log.push(`seat ${dealer} deals; up-card ${upCard}`);
}

// --- bidding ------------------------------------------------------------

function bid(doc: GameDoc, a: Extract<Action, { type: 'Bid' }>): void {
	if (doc.phase !== 'bid1' && doc.phase !== 'bid2') fail(`no bidding in phase ${doc.phase}`);
	const b = doc.bidding;
	if (!b) fail('no bidding in progress');
	if (a.seat !== b.turn) fail(`it is not seat ${a.seat}'s turn to bid`);
	if (!legalBids(doc, a.seat).some((o) => sameBid(o, a.bid))) {
		fail(`illegal bid: ${describeBid(a.bid)}`);
	}

	if (a.bid === 'pass') {
		b.passes.push(a.seat);
		if (b.passes.length < 4) {
			b.turn = nextSeat(a.seat);
			return;
		}
		if (b.round === 1) {
			doc.bidding = {
				round: 2,
				turn: nextSeat(doc.dealer),
				passes: [],
				passedSuit: suitOf(doc.upCard as NonNullable<GameDoc['upCard']>)
			};
			doc.phase = 'bid2';
			doc.log.push('all passed; second round of bidding');
		} else {
			doc.bidding = null;
			doc.phase = 'redeal';
			doc.log.push('all passed twice; the same dealer re-deals');
		}
		return;
	}

	const trump =
		a.bid === 'accept' ? suitOf(doc.upCard as NonNullable<GameDoc['upCard']>) : a.bid.suit;
	doc.trump = trump;
	doc.maker = teamOf(a.seat);
	doc.makerSeat = a.seat;
	doc.bidding = null;
	doc.upCard = null;
	const leader = nextSeat(doc.dealer);
	doc.trick = { number: 1, leader, turn: leader, plays: [], winner: null };
	doc.phase = 'meld';
	doc.log.push(`seat ${a.seat} makes ${trump} trump`);
}

// --- meld + trick play -----------------------------------------------------

function announceMeld(doc: GameDoc, a: Extract<Action, { type: 'AnnounceMeld' }>): void {
	if (doc.phase !== 'meld') fail('meld may only be announced during the first trick');
	const t = doc.trick;
	if (!t) fail('no trick in progress');
	if (t.plays.some((p) => p.seat === a.seat)) {
		fail(`seat ${a.seat} has already played to the first trick`);
	}
	const available = detectMelds(doc.hands[a.seat], doc.trump);
	// `claims` omitted → claim everything the hand holds (bots, older callers).
	// Given a list, keep only the ones the hand can actually back up.
	doc.melds.declared[a.seat] = a.claims ? validateClaims(a.claims, available) : available;
}

/** A human declares one meld by picking its exact cards. Repeatable up to the
 *  seat's first card in trick one. */
function declareMeld(doc: GameDoc, a: Extract<Action, { type: 'DeclareMeld' }>): void {
	if (doc.phase !== 'meld') fail('meld may only be declared during the first trick');
	const t = doc.trick;
	if (!t) fail('no trick in progress');
	if (t.plays.some((p) => p.seat === a.seat)) {
		fail(`seat ${a.seat} has already played to the first trick`);
	}

	const hand = doc.hands[a.seat];
	for (const c of a.cards) if (!hand.includes(c)) fail(`card not in hand: ${c}`);

	const claim = classifyMeld(a.cards, doc.trump);
	if (!claim) fail('those cards are not a valid meld');

	const declared = doc.melds.declared[a.seat] ?? [];
	if (declared.some((d) => sameMeldClaim(d, claim))) fail('that meld is already declared');

	// No card may be reused across a seat's melds — except that bella's K/Q may
	// also sit in a sequence (and vice versa).
	const bellaRunPair = (x: MeldClaim, y: MeldClaim) =>
		(x.group === 'bella' && y.group === 'run') || (x.group === 'run' && y.group === 'bella');
	for (const d of declared) {
		if (bellaRunPair(d, claim)) continue;
		const clash = claim.cards.find((c) => d.cards.includes(c));
		if (clash) fail(`card ${clash} is already in another meld`);
	}

	doc.melds.declared[a.seat] = [...declared, claim];
}

/** Show an announced meld to the table during `meldReveal`. */
function showMeld(doc: GameDoc, a: Extract<Action, { type: 'ShowMeld' }>): void {
	if (doc.phase !== 'meldReveal') fail(`nothing to show in phase ${doc.phase}`);
	const declared = doc.melds.declared[a.seat];
	if (declared == null || declared.length === 0) fail(`seat ${a.seat} announced no meld`);
	if (!doc.melds.shown[a.seat]) {
		doc.melds.shown[a.seat] = true;
		doc.log.push(`seat ${a.seat} shows meld`);
	}
	// Once every announcer has shown, lock in the comparison so the reveal can
	// display the outcome while it stays on screen.
	if (!doc.melds.resolved && allAnnouncersShown(doc)) resolveMeld(doc);
}

/** Leave `meldReveal` and start trick two. Anything not yet shown is shown now
 *  (a generous house rule — no forfeit for a slow click against the bots). */
function advanceMeldReveal(doc: GameDoc): void {
	if (doc.phase !== 'meldReveal') fail(`not revealing meld (phase ${doc.phase})`);
	if (!doc.melds.resolved) {
		for (const s of [0, 1, 2, 3] as Seat[]) {
			const d = doc.melds.declared[s];
			if (d != null && d.length > 0) doc.melds.shown[s] = true;
		}
		resolveMeld(doc);
	}
	doc.phase = 'trick';
}

function allAnnouncersShown(doc: GameDoc): boolean {
	return ([0, 1, 2, 3] as Seat[]).every((s) => {
		const d = doc.melds.declared[s];
		return d == null || d.length === 0 || doc.melds.shown[s];
	});
}

/** True once at least one seat has announced a non-empty meld this hand. */
export function anyMeldAnnounced(doc: GameDoc): boolean {
	return doc.melds.declared.some((d) => d != null && d.length > 0);
}

function playCard(doc: GameDoc, a: Extract<Action, { type: 'PlayCard' }>): void {
	if (doc.phase !== 'meld' && doc.phase !== 'trick')
		fail(`cannot play a card in phase ${doc.phase}`);
	const t = doc.trick;
	if (!t) fail('no trick in progress');
	if (a.seat !== t.turn) fail(`it is not seat ${a.seat}'s turn`);

	const hand = doc.hands[a.seat];
	if (!hand.includes(a.card)) fail(`card not in hand: ${a.card}`);

	const legal = legalMoves(doc, a.seat).includes(a.card);
	if (!legal && !a.allowIllegal) fail(`illegal card: ${a.card}`);

	hand.splice(hand.indexOf(a.card), 1);
	t.plays.push({ seat: a.seat, card: a.card });

	if (!legal) {
		// Advanced mode: the illegal card stands and play continues. It only
		// costs the hand if the other team calls the renege (see `callRenege`)
		// before the last trick is collected. Record the first offence only.
		if (!doc.renege) {
			doc.renege = { seat: a.seat, card: a.card, called: false };
			doc.log.push(`seat ${a.seat} played an illegal card (${a.card}); renege may be called`);
		}
	}

	if (t.plays.length < 4) {
		t.turn = nextSeat(a.seat);
		return;
	}

	// Fourth card played: freeze the trick on screen. `AdvanceTrick` collects it.
	t.winner = trickWinner(t.plays, doc.trump);
	doc.phase = 'trickDone';
	doc.log.push(`trick ${t.number} to seat ${t.winner}`);
}

/** The window in which an uncalled renege can still be caught: any time before
 *  the last trick is collected and the hand is scored. */
const RENEGE_CALLABLE: ReadonlySet<GameDoc['phase']> = new Set([
	'meld',
	'meldReveal',
	'trick',
	'trickDone'
]);

function callRenege(doc: GameDoc, a: Extract<Action, { type: 'CallRenege' }>): void {
	if (!doc.advanced) fail('renege calls are only used in Advanced mode');
	if (!RENEGE_CALLABLE.has(doc.phase)) fail(`too late to call the renege (phase ${doc.phase})`);
	if (!doc.players[a.seat]) fail(`seat ${a.seat} is empty`);

	const callerTeam = teamOf(a.seat);
	const r = doc.renege;
	// A call is upheld only when the *other* team really did leave an illegal
	// card uncalled. Anything else is an unproven claim, which the rules punish
	// exactly like a renege by the team that made it.
	const upheld = r != null && !r.called && teamOf(r.seat) === otherTeam(callerTeam);

	if (upheld) {
		r.called = true;
		doc.log.push(`seat ${a.seat} calls the renege on seat ${r.seat} — upheld`);
		finishRenegedHand(doc, r.seat);
	} else {
		doc.log.push(`seat ${a.seat} claims a renege — not proven; it falls on their team`);
		finishRenegedHand(doc, a.seat);
	}
}

function advanceTrick(doc: GameDoc): void {
	if (doc.phase !== 'trickDone') fail(`no completed trick to advance (phase ${doc.phase})`);
	const t = doc.trick;
	if (!t || t.winner == null) fail('trick is not complete');

	const winner = t.winner;
	doc.wonBySeat[winner].push(t.plays.map((p) => p.card));
	doc.lastTrickWinner = winner;
	const n = t.number;

	if (n === 6) {
		finishHand(doc); // sets phase to handScored / gameOver and trick to null
		return;
	}

	doc.trick = { number: n + 1, leader: winner, turn: winner, plays: [], winner: null };

	if (n === 1) {
		if (anyMeldAnnounced(doc)) {
			// Hold on trick two's board while announcers show their meld.
			doc.phase = 'meldReveal';
			doc.log.push('meld announced — revealing before trick two');
			return;
		}
		resolveMeld(doc); // nobody announced: settle the (empty) meld and play on
	}

	doc.phase = 'trick';
}

function finishHand(doc: GameDoc): void {
	settleHand(doc, scoreHand(doc));
}

/** Renege: the play stops and the opponents of the reneging team score 162
 *  (all trick points) plus their own announced meld. The reneging team scores
 *  nothing. */
function finishRenegedHand(doc: GameDoc, renegingSeat: Seat): void {
	const guilty = teamOf(renegingSeat);
	const opp = otherTeam(guilty);
	const [a, b] = seatsOfTeam(opp);
	const oppMeld =
		selectBestMelds(doc.melds.declared[a] ?? []).sum +
		selectBestMelds(doc.melds.declared[b] ?? []).sum;

	const meldPoints: [number, number] = [0, 0];
	meldPoints[opp] = oppMeld;
	doc.melds.points = [...meldPoints];
	doc.melds.scoredTeam = oppMeld > 0 ? opp : null;
	doc.melds.resolved = true;

	const awarded: [number, number] = [0, 0];
	awarded[opp] = 162 + oppMeld;

	settleHand(doc, {
		dealer: doc.dealer,
		trump: doc.trump as Suit,
		maker: doc.maker as TeamId,
		trickPoints: [0, 0],
		meldPoints,
		set: false,
		renege: true,
		awarded,
		runningAfter: [0, 0]
	});
}

function settleHand(doc: GameDoc, result: HandResult): void {
	doc.score.running[0] += result.awarded[0];
	doc.score.running[1] += result.awarded[1];
	result.runningAfter = [doc.score.running[0], doc.score.running[1]];
	doc.score.hands.push(result);
	doc.trick = null;

	const w = checkGameEnd(doc.score.running);
	if (w != null) {
		doc.winner = w;
		doc.phase = 'gameOver';
		doc.log.push(`team ${w} wins ${doc.score.running[w]}–${doc.score.running[w ^ 1]}`);
	} else {
		doc.phase = 'handScored';
		doc.log.push(
			`hand scored: team 0 ${doc.score.running[0]}, team 1 ${doc.score.running[1]}` +
				(result.renege ? ' (renege)' : result.set ? ' (makers set)' : '')
		);
	}
}
