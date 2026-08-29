import type { Card, Rank, Suit } from '$lib/clabber/types';

export const SUIT_NAME: Record<Suit, string> = {
	S: 'Spades',
	H: 'Hearts',
	D: 'Diamonds',
	C: 'Clubs'
};

export const SUIT_SYMBOL: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };

export const RANK_NAME: Record<Rank, string> = {
	A: 'Ace',
	K: 'King',
	Q: 'Queen',
	J: 'Jack',
	T: 'Ten',
	'9': 'Nine'
};

export const isRedSuit = (s: Suit): boolean => s === 'H' || s === 'D';

/** "Jack of Spades" — a spoken card name for the training coach and captions. */
export const cardName = (c: Card): string =>
	`${RANK_NAME[c[0] as Rank]} of ${SUIT_NAME[c[1] as Suit]}`;

/** "J♠" — a compact card label. */
export const cardTag = (c: Card): string =>
	`${c[0] === 'T' ? '10' : c[0]}${SUIT_SYMBOL[c[1] as Suit]}`;
