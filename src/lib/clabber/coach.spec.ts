import { describe, it, expect } from 'vitest';
import { coachSections } from './coach';
import { reduce } from './reducer';
import { chooseBid } from './bot';
import { createGame, SEATS } from './state';
import type { GameDoc } from './types';

function fourBots(): GameDoc {
	const doc = createGame('T', 0);
	for (const s of SEATS) reduce(doc, { type: 'SetBot', seat: s, isBot: true, botName: `Bot ${s}` });
	return doc;
}

/** Deal and bid until someone names trump, so the doc lands in `meld`. */
function dealToMeld(): GameDoc {
	for (let attempt = 0; attempt < 20; attempt++) {
		const doc = fourBots();
		reduce(doc, { type: 'StartHand', seed: `coach-${attempt}` });
		while (doc.phase === 'bid1' || doc.phase === 'bid2') {
			const seat = doc.bidding!.turn;
			reduce(doc, { type: 'Bid', seat, bid: chooseBid(doc, seat) });
		}
		if (doc.phase === 'meld') return doc;
	}
	throw new Error('no seed produced a made trump');
}

describe('coachSections', () => {
	it('explains the game in the lobby and always ends with the ranking reference', () => {
		const doc = createGame('ROOM', 0);
		const sections = coachSections(doc, null);
		expect(sections[0].title).toBe('How Clabber works');
		expect(sections.at(-1)?.title).toBe('Card ranking & scoring');
	});

	it('describes the up-card during round-one bidding', () => {
		const doc = fourBots();
		reduce(doc, { type: 'StartHand', seed: 'up' });
		expect(doc.phase).toBe('bid1');
		const sections = coachSections(doc, doc.bidding!.turn);
		const bidSection = sections.find((s) => s.title === 'Naming trump — round one');
		expect(bidSection).toBeDefined();
		expect(bidSection!.points.join(' ')).toContain('up-card');
	});

	it('offers meld and follow-suit help once a trick is in progress', () => {
		const doc = dealToMeld();
		const seat = doc.trick!.turn;
		const titles = coachSections(doc, seat).map((s) => s.title);
		expect(titles).toContain('Meld — declare it before you play');
		expect(titles).toContain('The first trick');
		expect(titles.at(-1)).toBe('Card ranking & scoring');
	});

	it('works for a spectator (no seat)', () => {
		const doc = dealToMeld();
		expect(() => coachSections(doc, null)).not.toThrow();
	});
});
