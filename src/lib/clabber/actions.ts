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
	| { type: 'PlayCard'; seat: Seat; card: Card }
	/** Claim the "bot runner" role. Which client should claim (and when) is
	 *  decided client-side; the reducer just records the winner. */
	| { type: 'HostClaim'; actorId: string };

export type ActionType = Action['type'];
