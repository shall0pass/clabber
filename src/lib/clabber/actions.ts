// Every mutation to a `GameDoc` goes through `reduce` as one of these actions.

import type { Bid, Card, Difficulty, MeldClaim, Seat } from './types';

export type Action =
	| { type: 'JoinSeat'; seat: Seat; name: string; actorId?: string }
	| { type: 'LeaveSeat'; seat: Seat }
	| { type: 'RenameSeat'; seat: Seat; name: string }
	| { type: 'SetBot'; seat: Seat; isBot: boolean; botName?: string }
	/** Turn Advanced (renege) mode on or off. Only allowed in the lobby — once a
	 *  hand is dealt the setting is frozen for the rest of the game. */
	| { type: 'SetAdvanced'; on: boolean }
	/** Turn the training coach on or off. It only changes what help the UI
	 *  offers, so it is allowed in any phase. */
	| { type: 'SetTraining'; on: boolean }
	/** Set the computer-player skill, game-wide. Only tunes bot behaviour, so it
	 *  is allowed in any phase. */
	| { type: 'SetDifficulty'; level: Difficulty }
	/** Opt this game in or out of the public "looking for players" list. Only
	 *  meaningful in the lobby; the elected host acts on it. */
	| { type: 'SetListed'; on: boolean }
	/** Deal the next hand. From `handScored` the deal advances to the next
	 *  dealer; from `redeal` (or the first hand) it keeps the current dealer. */
	| { type: 'StartHand'; seed: string }
	| { type: 'Bid'; seat: Seat; bid: Bid }
	/** Call meld before playing the first trick. `claims` is the subset of the
	 *  seat's holdable melds the caller chose; omit it to claim every meld the
	 *  hand contains. Used by the bot runner — human players call each meld by
	 *  hand with `DeclareMeld`. */
	| { type: 'AnnounceMeld'; seat: Seat; claims?: MeldClaim[] }
	/** Call one meld by naming the exact cards that form it (a human picking
	 *  cards from their hand). The reducer classifies the selection; anything
	 *  that isn't a real meld is rejected. Repeatable — one call per meld. */
	| { type: 'DeclareMeld'; seat: Seat; cards: Card[] }
	/** Show the melds this seat called, on its turn in trick two, before it
	 *  plays. Showing a meld lower than one the other team already showed is a
	 *  renege. Not showing = the meld is forfeit. */
	| { type: 'ShowMeld'; seat: Seat }
	/** Call bella (K + Q of trump). Allowed from the meld panel and any time in
	 *  play, up until the second of the two bella cards has been played. */
	| { type: 'CallBella'; seat: Seat }
	/** `allowIllegal` (Advanced mode) lets the seat play a card that breaks the
	 *  rules of following/trumping. The card stands and play continues; it is
	 *  only penalised if the other team calls the renege. */
	| { type: 'PlayCard'; seat: Seat; card: Card; allowIllegal?: boolean }
	/** Call the renege on the other team's earlier illegal card (Advanced mode).
	 *  Only a member of the non-offending team may call, and only before the
	 *  last trick is collected. Ends the hand: the caller's team scores 162 plus
	 *  its meld. */
	| { type: 'CallRenege'; seat: Seat }
	/** Collect a completed trick and move on (from phase `trickDone`). The host
	 *  fires this after a short pause so every client sees all four cards. */
	| { type: 'AdvanceTrick' }
	/** Press "Continue" on the hand-scored screen. `StartHand` from
	 *  `handScored` requires every seat to have called this first. */
	| { type: 'AckHand'; seat: Seat }
	/** Press "Continue" on a completed trick. `AdvanceTrick` requires every
	 *  seat to have called this first. */
	| { type: 'AckTrick'; seat: Seat }
	/** Claim the "bot runner" role. Which client should claim (and when) is
	 *  decided client-side; the reducer just records the winner. */
	| { type: 'HostClaim'; actorId: string }
	/** Hand a seated human's seat to (or back from) the bot AI mid-game when
	 *  they drop out. Keeps the name and `actorId` so they resume on return. */
	| { type: 'CoverSeat'; seat: Seat; isBot: boolean }
	/** After a game ends: back to the lobby, keeping seats, names and the code. */
	| { type: 'ResetToLobby' }
	/** A human walks away for good: their seat becomes a bot (named `botName`)
	 *  and loses its `actorId`, so a later re-join won't reclaim it. Works in
	 *  any phase — a hand in progress is played out by the bot. */
	| { type: 'LeaveTable'; seat: Seat; botName: string }
	/** Post a message to the table chat. `id` / `ts` are supplied by the caller
	 *  so the reducer stays pure. */
	| {
			type: 'SendChat';
			id: string;
			from: string;
			name: string;
			seat: Seat | null;
			text: string;
			ts: number;
	  };

export type ActionType = Action['type'];
