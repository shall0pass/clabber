// Core Clabber types. Everything here is plain JSON so a `GameDoc` can live
// directly inside an Automerge document (Phase 3).

export type Suit = 'S' | 'H' | 'D' | 'C';
export type Rank = 'A' | 'K' | 'Q' | 'J' | 'T' | '9';
export type Card = `${Rank}${Suit}`;

/** Seats are clockwise. The local player renders at the bottom (seat handling
 *  lives in the UI); seats 0 & 2 are one team, seats 1 & 3 the other. */
export type Seat = 0 | 1 | 2 | 3;
export type TeamId = 0 | 1;

/** A bidding decision: pass, accept the up-card's suit (round 1 only), or name
 *  a suit (round 2 only). */
export type Bid = 'pass' | 'accept' | { suit: Suit };

/** Computer-player skill, chosen game-wide in the lobby. `expert` is flawless;
 *  the others apply a probability to each bot judgment call. */
export type Difficulty = 'easy' | 'normal' | 'expert';

export type Phase =
	| 'lobby'
	| 'bid1' // round 1 — play or pass the up-card suit
	| 'bid2' // round 2 — name any other suit, or pass
	| 'redeal' // everyone passed twice; the same dealer deals again
	| 'meld' // first trick in progress; meld may still be called
	| 'trick' // tricks 2..6 (meld is shown in turn order during trick 2)
	| 'trickDone' // all four cards played; held on screen before it is collected
	| 'handScored' // hand finished, showing the breakdown
	| 'gameOver';

export type MeldKind = 'dad' | 'fifty' | 'hundred' | 'twohundred' | 'bella';
/** `run` = sequence in one suit, `set` = four of a kind, `bella` = K+Q trump. */
export type MeldGroup = 'run' | 'set' | 'bella';

export interface PlayerSlot {
	seat: Seat;
	name: string;
	isBot: boolean;
	botName?: string;
	/** Automerge actor id of the human occupying this seat (Phase 3). */
	actorId?: string;
	/** Epoch ms of the last presence heartbeat (Phase 3). */
	lastSeen: number;
}

export interface BiddingState {
	round: 1 | 2;
	turn: Seat;
	passes: Seat[];
	/** The suit passed by everyone in round 1 — forbidden as trump in round 2. */
	passedSuit: Suit | null;
}

export interface TrickPlay {
	seat: Seat;
	card: Card;
}

export interface TrickState {
	number: number; // 1..6
	leader: Seat;
	turn: Seat;
	plays: TrickPlay[];
	/** Set once the fourth card is played (phase `trickDone`); null while in play. */
	winner: Seat | null;
}

export interface MeldClaim {
	kind: MeldKind;
	group: MeldGroup;
	/** The suit for a `run`/`bella`; `null` for a `set` (spans all suits). */
	suit: Suit | null;
	cards: Card[];
	points: number;
	/** Sequence-order rank (9=1 … A=6) of the meld's highest card, for tie-breaks. */
	top: number;
}

export interface MeldState {
	/** Per seat: the melds called before that seat's first trick-1 card, or
	 *  `null` if the seat never opened the call panel (meld is then forfeit).
	 *  An empty array means the seat opened it but called nothing. Bella is not
	 *  kept here — see `bella`. */
	declared: (MeldClaim[] | null)[];
	/** Per seat: the melds actually shown during trick two (in the seat's show
	 *  turn). Empty until the seat shows; stays empty if the seat forfeits by
	 *  playing without showing, or could not show a meld that wasn't beaten. */
	shown: MeldClaim[][];
	/** Per seat: `true` once the seat has taken (or missed) its trick-two show. */
	shownDone: boolean[];
	/** The seat holding bella (K + Q of trump). Set whenever bella is called —
	 *  in the meld panel, or later, up until the second bella card is played.
	 *  Bella always scores 20 for that seat's team, whatever else happens. */
	bella: Seat | null;
	resolved: boolean;
	/** Team that won the shown-meld comparison and scores its melds; `null` when
	 *  nobody scored a sequence/set meld or it was a wash. */
	scoredTeam: TeamId | null;
	/** Final meld points awarded to each team (includes bella). */
	points: [number, number];
}

export interface ChatMessage {
	id: string;
	/** clientId (per-tab identity) of the sender. */
	from: string;
	/** display name at the time the message was sent. */
	name: string;
	/** seat 0..3 of the sender, or `null` for a spectator. */
	seat: Seat | null;
	text: string;
	/** epoch ms. */
	ts: number;
}

export interface HandResult {
	dealer: Seat;
	trump: Suit;
	maker: TeamId;
	trickPoints: [number, number];
	meldPoints: [number, number];
	/** The making team failed to out-score their opponents (they are "set"). */
	set: boolean;
	/** The hand ended on a renege — the opponents scored 162 + their meld. */
	renege: boolean;
	awarded: [number, number];
	runningAfter: [number, number];
}

export interface GameDoc {
	version: 1;
	code: string;
	createdAt: number;
	hostActorId: string;

	/** Opt-in: while in the lobby, advertise this game on the public
	 *  "looking for players" list on the join screen. The elected host
	 *  publishes and periodically refreshes the listing; it is dropped when the
	 *  game fills, the first hand is dealt, or this is turned back off. */
	listed?: boolean;

	/** Length 4, indexed by seat; `null` is an empty seat. */
	players: (PlayerSlot | null)[];

	phase: Phase;
	/** Renege play — the default mode. A player may play any card in hand; an
	 *  illegal one is a renege the other team must catch and call. Turned off by
	 *  Learning mode; chosen in the lobby, then locked for the game. */
	advanced: boolean;
	/** Learning mode — the lobby's alternative to renege play. It enforces
	 *  follow-suit (no reneging) and offers every player a "coach" panel at the
	 *  table explaining the rules for whatever is on the table right now. Paired
	 *  with `advanced`: exactly one of the two is on. */
	training: boolean;
	/** Computer-player skill, chosen in the lobby, game-wide. `expert` (the
	 *  default) is flawless; `normal` / `easy` apply a probability to whether a
	 *  bot plays the best card, handles its meld, and catches a renege. */
	difficulty: Difficulty;
	dealer: Seat;
	/** The seat that named trump this hand (for "made by …" on the table), or
	 *  `null` before a trump is set. */
	makerSeat: Seat | null;
	/** Seed of the current deal (kept for replay / debugging). */
	seed: string;

	/** Length 4, indexed by seat. */
	hands: Card[][];
	upCard: Card | null;
	trump: Suit | null;
	maker: TeamId | null;

	bidding: BiddingState | null;
	trick: TrickState | null;

	/** `wonBySeat[seat]` is the list of 4-card tricks that seat won. */
	wonBySeat: Card[][][];
	/** Every collected trick this hand, oldest first, across all seats — unlike
	 *  `wonBySeat` (grouped per seat, losing the interleaving), this is the true
	 *  play order, for a chronological review (e.g. after a renege). `bySeat`
	 *  is indexed by seat (not play order), so a reviewer can read one seat's
	 *  column straight down across every trick. */
	trickHistory: { winner: Seat; bySeat: Card[] }[];
	/** `playedBySeat[seat]` is every card that seat has played this hand, in
	 *  order — used for the "bella by the last K/Q" deadline. */
	playedBySeat: Card[][];
	lastTrickWinner: Seat | null;

	melds: MeldState;

	/** Set when a player committed a renege — an illegal card in Advanced mode
	 *  (`card` set), or showing a meld lower than one the other team already
	 *  showed (`card` null). Play continues; it only costs the hand if the other
	 *  team calls it (`called`) before the last trick is collected.
	 *
	 *  `trick` / `couldHave` describe an illegal-card renege so a bot can tell
	 *  when it is *provable from cards on the table*: `trick` is the trick the
	 *  bad card was played on, `couldHave` is the set the offender could legally
	 *  have played then. Once the offender later plays one of those cards the
	 *  renege is proven and a bot may call it. Absent on the beaten-meld path. */
	renege: {
		seat: Seat;
		card: Card | null;
		called: boolean;
		trick?: number;
		couldHave?: Card[];
	} | null;
	/** Whoever pressed "Call renege" most recently (any phase), so the UI can
	 *  point at them — separate from `renege.seat`, the accused. Reset by
	 *  `StartHand`. */
	renegeCalledBy: Seat | null;

	score: {
		running: [number, number];
		hands: HandResult[];
	};

	winner: TeamId | null;
	log: string[];

	/** Table chat, oldest first. Capped to the most recent messages. */
	chat: ChatMessage[];

	/** Per-seat confirmation on the hand-scored screen. `StartHand` cannot
	 *  deal the next hand from `handScored` until every seat has acked — a
	 *  human must press Continue; the host presses it for bot seats. Reset
	 *  to all-`false` by `StartHand`. */
	handAcks: boolean[];

	/** Per-seat confirmation that a completed trick has been seen. `AdvanceTrick`
	 *  cannot collect it and move on until every seat has acked — a human must
	 *  press Continue; the host presses it for bot seats. Reset to all-`false`
	 *  whenever a trick freshly completes (phase becomes `trickDone`). */
	trickAcks: boolean[];
}
