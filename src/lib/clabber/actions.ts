// Every mutation to a `GameDoc` goes through `reduce` as one of these actions.

import type { Bid, Card, Seat } from './types';

export type Action =
	| { type: 'JoinSeat'; seat: Seat; name: string; actorId?: string }
	| { type: 'LeaveSeat'; seat: Seat }
	| { type: 'RenameSeat'; seat: Seat; name: string }
	| { type: 'SetBot'; seat: Seat; isBot: boolean; botName?: string }
	/** Deal the next hand. From `handScored` the deal advances to the next
	 *  dealer; from `redeal` (or the first hand) it keeps the current dealer. */
	| { type: 'StartHand'; seed: string }
	| { type: 'Bid'; seat: Seat; bid: Bid }
	| { type: 'AnnounceMeld'; seat: Seat }
	/** `allowIllegal` (Advanced mode) lets the seat play a card that breaks the
	 *  rules of following/trumping — that ends the hand as a renege. */
	| { type: 'PlayCard'; seat: Seat; card: Card; allowIllegal?: boolean }
	/** Collect a completed trick and move on (from phase `trickDone`). The host
	 *  fires this after a short pause so every client sees all four cards. */
	| { type: 'AdvanceTrick' }
	/** Claim the "bot runner" role. Which client should claim (and when) is
	 *  decided client-side; the reducer just records the winner. */
	| { type: 'HostClaim'; actorId: string }
	/** Hand a seated human's seat to (or back from) the bot AI mid-game when
	 *  they drop out. Keeps the name and `actorId` so they resume on return. */
	| { type: 'CoverSeat'; seat: Seat; isBot: boolean }
	/** After a game ends: back to the lobby, keeping seats, names and the code. */
	| { type: 'ResetToLobby' };

export type ActionType = Action['type'];
