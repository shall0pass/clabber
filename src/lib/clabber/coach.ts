// The training coach. Given the shared game doc and which seat is "me", it
// builds a plain-language explanation of the rules that apply to whatever is on
// the table right now — the up-card during bidding, the melds in my hand, the
// follow-suit rules for the trick in progress, and so on.
//
// It reads only the rules engine (plus the display name tables), so it stays
// framework-free and easy to unit-test.

import { SUIT_NAME, cardName, cardTag } from '$lib/cards/display';
import { legalBids } from './bidding';
import { cardPoints, suitOf, trickWinner } from './cards';
import { detectMelds, selectBestMelds } from './meld';
import { legalMoves } from './play';
import { partnerSeat, teamOf } from './state';
import type { GameDoc, MeldKind, Seat, Suit } from './types';

export interface CoachSection {
	title: string;
	points: string[];
}

type Who = (seat: Seat, cap?: boolean) => string;

const KIND_LABEL: Record<MeldKind, string> = {
	dad: 'Dad (run of three)',
	fifty: 'Fifty (run of four)',
	hundred: 'Hundred (run of five, or four of a kind)',
	twohundred: 'Two hundred (all four Jacks)',
	bella: 'Bella (King + Queen of trump)'
};

/** Sections of rules help for the current table state, most relevant first. The
 *  last section is always a fixed ranking / scoring reference. */
export function coachSections(doc: GameDoc, mySeat: Seat | null): CoachSection[] {
	const who: Who = (seat, cap = false) => {
		if (seat === mySeat) return cap ? 'You' : 'you';
		return doc.players[seat]?.name ?? `seat ${seat + 1}`;
	};

	const sections: CoachSection[] = [];

	switch (doc.phase) {
		case 'lobby':
			sections.push({
				title: 'How Clabber works',
				points: [
					'Four players in two teams — you and the player across the table are partners.',
					'Every hand has two steps: name a trump suit, then play six tricks.',
					'Win tricks to capture point-cards, and claim “meld” for scoring combinations dealt into your hand.',
					'This coach panel stays with you at the table. Open it any time to see the rules for the moment you’re in.'
				]
			});
			break;

		case 'bid1':
			sections.push(bidRoundOne(doc, mySeat, who));
			break;

		case 'bid2':
			sections.push(bidRoundTwo(doc, mySeat, who));
			break;

		case 'redeal':
			sections.push({
				title: 'Nobody named trump',
				points: [
					'All four players passed in both rounds, so this deal is scrapped.',
					'The same dealer deals again and no score changes.'
				]
			});
			break;

		case 'meld':
			sections.push(meldSection(doc, mySeat));
			sections.push(trickSection(doc, mySeat, who));
			break;

		case 'meldReveal':
			sections.push(meldRevealSection(doc, mySeat, who));
			break;

		case 'trick':
		case 'trickDone':
			sections.push(trickSection(doc, mySeat, who));
			break;

		case 'handScored':
			sections.push(handScoredSection(doc, mySeat));
			break;

		case 'gameOver': {
			const pts: string[] = [];
			if (doc.winner != null && mySeat != null) {
				pts.push(
					teamOf(mySeat) === doc.winner
						? 'Your team reached 500 first — nicely played.'
						: 'The other team reached 500 first this time.'
				);
			} else if (doc.winner != null) {
				pts.push(`Team ${doc.winner === 0 ? 'A' : 'B'} reached 500 first.`);
			}
			pts.push('From here the table goes back to the lobby for another game.');
			sections.push({ title: 'Game over', points: pts });
			break;
		}
	}

	sections.push(referenceSection());
	return sections;
}

function bidRoundOne(doc: GameDoc, mySeat: Seat | null, who: Who): CoachSection {
	const up = doc.upCard;
	const points: string[] = [];
	if (up) {
		points.push(
			`The up-card is the ${cardName(up)}. If anyone says “Play”, ${SUIT_NAME[suitOf(up)]} is trump for this hand.`
		);
	}
	points.push(
		'Going clockwise from the dealer’s left, each player says “Play” to take that suit as trump, or “Pass”.'
	);
	points.push(
		'Whoever takes it makes trump for their team — and that team must then out-score the other, or win nothing for the hand.'
	);
	points.push('You can only take (or later name) a suit you actually hold a card in.');

	const b = doc.bidding;
	if (b && mySeat != null && b.turn === mySeat && up) {
		const s = suitOf(up);
		const mine = doc.hands[mySeat].filter((c) => suitOf(c) === s);
		if (mine.length) {
			points.push(
				`It’s your turn. You hold ${mine.length} ${SUIT_NAME[s]} — ${mine
					.map(cardTag)
					.join(
						' '
					)}. Taking it is strong when that includes the Jack or Nine, or you have three or more trumps plus an outside Ace.`
			);
		} else {
			points.push(`It’s your turn, but you have no ${SUIT_NAME[s]}, so you must pass this round.`);
		}
	} else if (b) {
		points.push(`Waiting for ${who(b.turn)} to decide.`);
	}

	return { title: 'Naming trump — round one', points };
}

function bidRoundTwo(doc: GameDoc, mySeat: Seat | null, who: Who): CoachSection {
	const b = doc.bidding;
	const points: string[] = [
		'Everyone passed on the up-card, so its suit is off the table for this round.',
		'In turn, each player may now name any of the other three suits as trump, or pass again.'
	];
	if (b?.passedSuit) points.push(`${SUIT_NAME[b.passedSuit]} cannot be trump this round.`);
	points.push('If all four pass again, the deal is scrapped and the same dealer re-deals.');

	if (b && mySeat != null && b.turn === mySeat) {
		const opts = legalBids(doc, mySeat).filter((o): o is { suit: Suit } => typeof o === 'object');
		if (opts.length) {
			const parts = opts.map((o) => {
				const n = doc.hands[mySeat].filter((c) => suitOf(c) === o.suit).length;
				return `${SUIT_NAME[o.suit]} (${n})`;
			});
			points.push(
				`It’s your turn. Suits you could name, and how many you hold: ${parts.join(', ')}.`
			);
		} else {
			points.push('It’s your turn, but you hold none of the remaining suits, so you must pass.');
		}
	} else if (b) {
		points.push(`Waiting for ${who(b.turn)} to decide.`);
	}

	return { title: 'Naming trump — round two', points };
}

function meldSection(doc: GameDoc, mySeat: Seat | null): CoachSection {
	const points: string[] = [
		'Meld is a scoring combination sitting in your hand: a run of 3 / 4 / 5 cards in one suit (20 / 50 / 100), four of a kind (100, or 200 for the four Jacks), or the King and Queen of trump — “Bella”, worth 20.',
		'Runs use the order 9 10 J Q K A and ignore which suit is trump.',
		'Only the team with the single best meld scores — but that team then scores every meld it holds. Bella always scores for whoever has it.',
		'Announce before you play your first card to trick one, or the meld is lost for this hand.'
	];

	if (mySeat != null) {
		const best = selectBestMelds(detectMelds(doc.hands[mySeat], doc.trump));
		if (best.list.length) {
			const names = best.list.map(
				(c) =>
					`${KIND_LABEL[c.kind]}${c.suit ? ` in ${SUIT_NAME[c.suit]}` : ''} — ${c.cards
						.map(cardTag)
						.join(' ')} (${c.points})`
			);
			points.push(`In your hand: ${names.join('; ')}. Announcing all of it is worth ${best.sum}.`);
			points.push(
				doc.melds.declared[mySeat] != null
					? 'You have already announced this hand.'
					: 'Tick the melds you want to call, then tap “Announce” before you play. Leave a box unticked to keep that one quiet.'
			);
		} else {
			points.push('You have no meld this hand — just play when it’s your turn.');
		}
	}

	return { title: 'Meld — call it before you play', points };
}

function meldRevealSection(doc: GameDoc, mySeat: Seat | null, who: Who): CoachSection {
	const points: string[] = [
		'The first trick is in. Everyone who called meld now shows it, so the table can check who has the best one.',
		'The team with the single highest meld scores the sum of all its melds; the other team scores nothing — except Bella, which always scores.'
	];

	const announcers = ([0, 1, 2, 3] as Seat[]).filter((s) => {
		const d = doc.melds.declared[s];
		return d != null && d.length > 0;
	});
	if (announcers.length) {
		points.push(
			`Called meld: ${announcers.map((s) => `${who(s)}${doc.melds.shown[s] ? ' (shown)' : ''}`).join(', ')}.`
		);
	}

	if (mySeat != null && (doc.melds.declared[mySeat]?.length ?? 0) > 0 && !doc.melds.shown[mySeat]) {
		points.push('Tap “Show my meld” to reveal your cards, then “Continue”.');
	} else {
		points.push('Tap “Continue” when you’ve seen enough — the table plays on shortly either way.');
	}

	return { title: 'Showing meld', points };
}

function trickSection(doc: GameDoc, mySeat: Seat | null, who: Who): CoachSection {
	const t = doc.trick;
	if (!t) return { title: 'Playing tricks', points: ['Waiting for the next trick to start.'] };

	const trump = doc.trump;
	const points: string[] = [];
	if (trump) points.push(`${SUIT_NAME[trump]} is trump.`);

	if (t.plays.length === 0) {
		points.push(
			`${who(t.leader, true)} lead${t.leader === mySeat ? '' : 's'} this trick and may play any card.`
		);
		points.push(
			'Leading a trump makes the other players spend theirs; leading a plain Ace usually just wins the trick outright.'
		);
	} else {
		const ledCard = t.plays[0].card;
		const led = suitOf(ledCard);
		points.push(
			`${who(t.plays[0].seat, true)} led the ${cardName(ledCard)}. Follow with ${SUIT_NAME[led]} if you hold any.`
		);
		points.push(
			'Out of that suit? You must play a trump if you have one, and beat the highest trump already down whenever you can — even if your own partner played it.'
		);
		points.push(
			'Out of that suit and trump both? Then play anything (“throwing off”) — a good chance to drop a card that can’t win.'
		);
		points.push(
			'When a plain suit is led you never have to beat what’s there, as long as you follow suit.'
		);

		const winSeat = trickWinner(t.plays, trump);
		const winCard = t.plays.find((p) => p.seat === winSeat)!.card;
		const partnerNote =
			mySeat != null && winSeat === partnerSeat(mySeat)
				? ' — that’s your partner, so the trick is yours unless someone still to play beats it'
				: '';
		points.push(
			`So far ${who(winSeat)} ${winSeat === mySeat ? 'are' : 'is'} winning it with the ${cardName(winCard)}${partnerNote}.`
		);

		const onTable = t.plays.reduce((n, p) => n + cardPoints(p.card, trump), 0);
		points.push(`Points on the table so far: ${onTable}.`);
	}

	if (doc.phase === 'trickDone' && t.winner != null) {
		points.push(
			`All four cards are down — ${who(t.winner)} take${t.winner === mySeat ? '' : 's'} the trick. Tap “Continue” to collect it.`
		);
	} else if (
		(doc.phase === 'meld' || doc.phase === 'trick') &&
		mySeat != null &&
		t.turn === mySeat
	) {
		const legal = legalMoves(doc, mySeat);
		if (legal.length) {
			points.push(`Your turn. Cards you may legally play: ${legal.map(cardTag).join(' ')}.`);
		}
	} else if (t.turn !== mySeat) {
		points.push(`Waiting for ${who(t.turn)} to play.`);
	}

	if (doc.advanced && mySeat != null) {
		points.push(
			'Advanced mode: any card is playable. An illegal card is not an automatic loss — it stands unless the other team notices and taps “Call renege” before the last trick is collected. A correct call scores that team 162 plus any meld; a call with nothing to back it up hands the same to the other side.'
		);
	}

	return {
		title: t.number === 1 ? 'The first trick' : `Trick ${t.number} of 6`,
		points
	};
}

function handScoredSection(doc: GameDoc, mySeat: Seat | null): CoachSection {
	const last = doc.score.hands.at(-1);
	const points: string[] = [
		'Each team adds up the card points in the tricks it won, +10 for taking the last trick, then adds its meld.',
		'If the team that named trump finished ahead, both teams keep what they scored. Otherwise that team is “set” and scores nothing for the hand — meld included.'
	];
	if (last) {
		const tag = last.renege ? ' (renege)' : last.set ? ' (makers set)' : '';
		points.push(`This hand: team A ${last.awarded[0]}, team B ${last.awarded[1]}${tag}.`);
	}
	points.push(
		`Running score — team A ${doc.score.running[0]}, team B ${doc.score.running[1]}. First to 500 wins.`
	);
	if (mySeat != null) {
		const t = teamOf(mySeat);
		points.push(`You’re on team ${t === 0 ? 'A' : 'B'}, currently ${doc.score.running[t]}.`);
	}
	return { title: 'How the hand scored', points };
}

function referenceSection(): CoachSection {
	return {
		title: 'Card ranking & scoring',
		points: [
			'Trump, strongest first: Jack (20), Nine (14), Ace (11), Ten (10), King (4), Queen (3).',
			'Every other suit, strongest first: Ace (11), Ten (10), King (4), Queen (3), Jack (2), Nine (0).',
			'A trick goes to the highest trump in it, or — if nobody trumped — the highest card of the suit that was led.',
			'The team that wins the last trick scores an extra 10, so 162 points are in play each hand before meld.',
			'The team that named trump must beat the other team’s total (tricks + meld) or score nothing: that’s being “set”.',
			'First team to 500 points wins the game.'
		]
	};
}
