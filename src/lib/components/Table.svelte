<script lang="ts">
	import { SEATS, partnerSeat, teamOf } from '$lib/clabber/state';
	import { sortHand } from '$lib/clabber/cards';
	import { legalMoves } from '$lib/clabber/play';
	import { seatMeldStatus } from '$lib/clabber/meld';
	import { trickPointsSoFar } from '$lib/clabber/score';
	import { SvelteSet } from 'svelte/reactivity';
	import {
		computeHandLayout,
		fitTrickCardH,
		deriveShared,
		sideColW,
		trickBoxH,
		clamp
	} from '$lib/layout/tableLayout';
	import type { Card as CardT, Seat } from '$lib/clabber/types';
	import type { GameStore } from '$lib/repo/gameStore.svelte';
	import type { Presence } from '$lib/repo/presence.svelte';

	import PlayerPlate from './PlayerPlate.svelte';
	import CardFan from './CardFan.svelte';
	import MyHand from './MyHand.svelte';
	import TrickArea from './TrickArea.svelte';
	import BiddingPanel from './BiddingPanel.svelte';
	import MeldPanel from './MeldPanel.svelte';
	import GameTopBar from './GameTopBar.svelte';
	import GameOver from './GameOver.svelte';
	import LogFeed from './LogFeed.svelte';
	import CoachPanel from './CoachPanel.svelte';
	import Card from './Card.svelte';

	// Compact's banners overlay the one-line top band, so the reveal cards are
	// sized to its height.
	const COMPACT_REVEAL_CARD_H = 26;

	let { store, presence, onleave }: { store: GameStore; presence: Presence; onleave: () => void } =
		$props();

	const doc = $derived(store.doc);
	const mySeat = $derived(store.mySeat);
	const baseSeat = $derived((mySeat ?? 0) as Seat);

	// screen slot: 0 bottom, 1 left, 2 top, 3 right — rotate so I'm at the bottom
	function screenSlot(seat: Seat) {
		return (seat - baseSeat + 4) % 4;
	}
	const SIDE = ['bottom', 'left', 'top', 'right'] as const;
	function relationFor(seat: Seat): 'you' | 'partner' | 'opponent' {
		if (mySeat == null) return 'opponent';
		if (seat === mySeat) return 'you';
		if (seat === partnerSeat(mySeat)) return 'partner';
		return 'opponent';
	}
	// The seat at the top of the table (the partner, from the seated player's
	// view). In short landscape it moves into the top band instead of its own
	// grid row (plan §4) — a whole extra row of chrome is what was pushing the
	// phase panel off the bottom of the screen at 667×375 (see git history /
	// PR notes for the measurement). Its `CardFan` is dropped there rather than
	// made even smaller, to keep the reclaimed height meaningful.
	const topSeat = $derived(SEATS.find((s) => screenSlot(s) === 2) as Seat);
	const leftSeat = $derived(SEATS.find((s) => screenSlot(s) === 1) as Seat);
	const rightSeat = $derived(SEATS.find((s) => screenSlot(s) === 3) as Seat);

	const currentSeat = $derived.by<Seat | null>(() => {
		if (!doc) return null;
		if (doc.phase === 'bid1' || doc.phase === 'bid2') return doc.bidding?.turn ?? null;
		if (doc.phase === 'meld' || doc.phase === 'trick') return doc.trick?.turn ?? null;
		return null;
	});

	function teamTricks(seat: Seat) {
		if (!doc) return 0;
		return doc.wonBySeat[seat].length + doc.wonBySeat[partnerSeat(seat)].length;
	}
	function lastBid(seat: Seat) {
		if (!doc?.bidding) return '';
		return doc.bidding.passes.includes(seat) ? 'pass' : '';
	}

	const myHand = $derived(
		doc && mySeat != null ? sortHand(doc.hands[mySeat], doc.trump) : ([] as CardT[])
	);
	const myLegal = $derived(doc && mySeat != null ? legalMoves(doc, mySeat) : ([] as CardT[]));
	const handActive = $derived(
		doc != null &&
			mySeat != null &&
			(doc.phase === 'meld' || doc.phase === 'trick') &&
			doc.trick?.turn === mySeat
	);
	const handPoints = $derived(doc ? trickPointsSoFar(doc) : ([0, 0] as [number, number]));
	const iLost = $derived(
		doc?.phase === 'gameOver' &&
			doc.winner != null &&
			mySeat != null &&
			teamOf(mySeat) !== doc.winner
	);

	// Advanced mode: play any card; an illegal one is a renege. Chosen in the
	// lobby and locked for the game, so it lives on the shared doc.
	const advanced = $derived(doc?.advanced ?? false);

	// Team names relative to the local player, matching the scoreboard.
	function teamName(team: number): string {
		if (mySeat == null) return team === 0 ? 'Team A' : 'Team B';
		return teamOf(mySeat) === team ? 'Your team' : 'The other team';
	}

	function play(card: CardT) {
		if (mySeat == null) return;
		// Advanced mode: an illegal card is allowed through without a warning —
		// it only matters if the other team calls the renege.
		const illegal = !myLegal.includes(card);
		store.tryChange({
			type: 'PlayCard',
			seat: mySeat,
			card,
			...(illegal && advanced ? { allowIllegal: true } : {})
		});
	}

	// Calling a renege is a standing option during Advanced play — you decide,
	// from your own read of the table, whether the other team broke a rule. Get
	// it wrong (Advanced mode) and the penalty lands on your team, so it's a
	// deliberate two-step. Outside Advanced mode it only appears when the other
	// team really did leave a renege (e.g. showed a beaten meld).
	const uncalledOppRenege = $derived(
		doc?.renege != null &&
			!doc.renege.called &&
			mySeat != null &&
			teamOf(doc.renege.seat) !== teamOf(mySeat)
	);
	const mayCallRenege = $derived(
		mySeat != null &&
			doc != null &&
			// Still open on the score screen — a last look before everyone
			// presses Continue and the next hand deals.
			['meld', 'trick', 'trickDone', 'handScored'].includes(doc.phase) &&
			(advanced || uncalledOppRenege)
	);
	let pendingCall = $state(false);
	function callRenege() {
		if (mySeat != null) store.tryChange({ type: 'CallRenege', seat: mySeat });
		pendingCall = false;
	}
	$effect(() => {
		if (!mayCallRenege) pendingCall = false;
	});

	// Trick two: on my turn, before I play, I may show the meld I called.
	const canShowMeld = $derived(
		doc != null &&
			mySeat != null &&
			doc.phase === 'trick' &&
			doc.trick?.number === 2 &&
			doc.trick?.turn === mySeat &&
			(doc.melds.declared[mySeat]?.length ?? 0) > 0 &&
			!doc.melds.shownDone[mySeat]
	);
	function showMeld() {
		if (mySeat != null) store.tryChange({ type: 'ShowMeld', seat: mySeat });
	}

	// Bella may be called from here right up until I've played both my K and Q
	// of trump.
	const canCallBella = $derived.by(() => {
		if (!doc || mySeat == null || !doc.trump) return false;
		if (doc.melds.bella === mySeat) return false;
		if (doc.phase !== 'meld' && doc.phase !== 'trick') return false;
		const pair = [`K${doc.trump}`, `Q${doc.trump}`] as CardT[];
		const hand = doc.hands[mySeat];
		const played = doc.playedBySeat[mySeat];
		return (
			pair.every((c) => hand.includes(c) || played.includes(c)) &&
			pair.some((c) => hand.includes(c))
		);
	});
	function callBella() {
		if (mySeat != null) store.tryChange({ type: 'CallBella', seat: mySeat });
	}

	// Meld picking (plan §5): the cards are toggled in the real hand below, not
	// in a second mini-hand inside the panel, so the led card stays visible.
	// This state is owned here and threaded into both `MeldPanel` (the one-line
	// bar) and `MyHand` (the tap targets); it's a presentation choice only —
	// the player still picks every card and presses Call, and `DeclareMeld`
	// still validates it. No auto-detection or suggestion of a meld.
	let meldPicking = $state(false);
	let meldChosen = $state<CardT[]>([]);
	function openMeldPicker() {
		meldPicking = true;
		meldChosen = [];
	}
	function cancelMeldPicker() {
		meldPicking = false;
		meldChosen = [];
	}
	function toggleMeldCard(card: CardT) {
		meldChosen = meldChosen.includes(card)
			? meldChosen.filter((c) => c !== card)
			: [...meldChosen, card];
	}
	// If it stops being my turn to call meld (played, phase moved on) while
	// picking, drop out of picking mode so the hand goes back to normal play.
	$effect(() => {
		if (!handActive || doc?.phase !== 'meld') cancelMeldPicker();
	});

	// Brief banner when trick two resolves the meld — shown once per hand for
	// ~3.5 s. Keyed on `doc.seed` so it fires once, and cleared the moment a new
	// hand un-resolves the meld (otherwise a prior hand's line lingers, because
	// `melds.resolved` stays true through the rest of this hand and an $effect
	// cleanup would keep cancelling the auto-clear).
	let meldBanner = $state('');
	let meldBannerSeed = '';
	let meldBannerTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		if (!doc) return;
		// `scoredTeam` stays `null` on a bella-only hand even though `points`
		// already has bella's 20 — key off `points` so that case still announces.
		const scored = doc.melds.resolved && (doc.melds.points[0] > 0 || doc.melds.points[1] > 0);
		if (!scored) {
			if (meldBanner) meldBanner = '';
			return;
		}
		if (meldBannerSeed === doc.seed) return;
		meldBannerSeed = doc.seed;
		meldBanner = ([0, 1] as const)
			.filter((t) => doc.melds.points[t] > 0)
			.map((t) => `${teamName(t)} scored ${doc.melds.points[t]} for meld`)
			.join(' · ');
		clearTimeout(meldBannerTimer);
		meldBannerTimer = setTimeout(() => (meldBanner = ''), 3500);
	});
	$effect(() => () => clearTimeout(meldBannerTimer));

	// Immediate table-wide callout the moment someone declares a meld or bella
	// (trick one) — at a real table you'd hear this said out loud right away,
	// rather than everyone finding out only once trick two's comparison lands.
	let announceBanner = $state('');
	let seenLogLines = 0;
	let announceTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		if (!doc) return;
		if (doc.log.length <= seenLogLines) {
			seenLogLines = doc.log.length; // hand/game reset — nothing to announce
			return;
		}
		const added = doc.log.slice(seenLogLines);
		seenLogLines = doc.log.length;
		// Every new call in this change, not just the first — a seat can declare
		// two melds (or a meld and bella) in one go.
		const hits = added.filter((l) => /declares|calls bella|'s \w+ includes bella/.test(l));
		if (hits.length) {
			announceBanner = hits
				.map((l) => l.replace(/seat (\d)/g, (_, n) => doc.players[Number(n)]?.name ?? `seat ${n}`))
				.join(' · ');
			clearTimeout(announceTimer);
			announceTimer = setTimeout(() => (announceBanner = ''), 3500);
		}
	});
	$effect(() => () => clearTimeout(announceTimer));

	// Show each shown meld's actual cards to everyone during trick two. Seats
	// show in turn order a beat apart, so this is a QUEUE, not a single slot —
	// otherwise the next seat's show wipes the previous one off the screen
	// before anyone can read it (you'd miss your partner's meld even though the
	// team scored on it). Each reveal holds for `MELD_REVEAL_MS`, then the next.
	const MELD_REVEAL_MS = 5000;
	let meldReveal = $state<{ seat: Seat; cards: CardT[] } | null>(null);
	let revealQueue: { seat: Seat; cards: CardT[] }[] = [];
	let revealTimer: ReturnType<typeof setTimeout> | undefined;
	const revealedSeats = new SvelteSet<Seat>();
	let revealHandSeed = '';

	function pumpReveals() {
		if (meldReveal || revealQueue.length === 0) return;
		meldReveal = revealQueue.shift() ?? null;
		revealTimer = setTimeout(() => {
			meldReveal = null;
			revealTimer = undefined;
			pumpReveals();
		}, MELD_REVEAL_MS);
	}

	$effect(() => {
		if (!doc) return;
		if (doc.seed !== revealHandSeed) {
			revealHandSeed = doc.seed;
			revealedSeats.clear();
			revealQueue = [];
			clearTimeout(revealTimer);
			revealTimer = undefined;
			meldReveal = null;
		}
		for (const s of SEATS) {
			if (doc.melds.shownDone[s] && !revealedSeats.has(s)) {
				revealedSeats.add(s);
				const shown = doc.melds.shown[s];
				if (shown && shown.length > 0) {
					revealQueue.push({ seat: s, cards: [...shown].flatMap((m) => [...m.cards]) });
				}
			}
		}
		pumpReveals();
	});
	$effect(() => () => clearTimeout(revealTimer));

	// while a completed trick is held on screen, pulse the winner's plate
	const flashSeat = $derived(doc?.phase === 'trickDone' ? (doc.trick?.winner ?? null) : null);

	// Every seat must press Continue before the trick clears (`doc.trickAcks`)
	// — the host presses it for bot seats.
	const trickAcks = $derived(doc?.trickAcks ?? [false, false, false, false]);
	const iAckedTrick = $derived(mySeat != null && trickAcks[mySeat]);
	const waitingOnTrick = $derived(
		SEATS.filter((s) => !trickAcks[s]).map((s) => doc?.players[s]?.name ?? `seat ${s}`)
	);
	function ackTrick() {
		if (mySeat != null) store.tryChange({ type: 'AckTrick', seat: mySeat });
	}

	// The hand and the coarse layout mode come from the viewport alone (plan
	// §2), measured off the table root's own box (not `window.innerWidth`) so
	// padding/safe-area insets are accounted for.
	let tableEl = $state<HTMLDivElement>();
	let boxW = $state(0);
	let boxH = $state(0);
	$effect(() => {
		const el = tableEl;
		if (!el) return;
		const measure = () => {
			boxW = el.clientWidth;
			boxH = el.clientHeight;
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		// Fallbacks: some browsers resize the visual viewport (URL bar show/hide)
		// without firing a ResizeObserver on an `h-dvh` element.
		window.addEventListener('resize', measure);
		window.visualViewport?.addEventListener('resize', measure);
		return () => {
			ro.disconnect();
			window.removeEventListener('resize', measure);
			window.visualViewport?.removeEventListener('resize', measure);
		};
	});
	const hand = $derived(computeHandLayout(boxW, boxH));

	// The trick area is sized from a direct measurement of its own leftover
	// cell instead (follow-up pass on docs/responsive-layout-plan.md — see
	// tableLayout.ts's module doc for why): the middle row below is a flex row
	// whose centre cell is `flex-1` (grows/shrinks to fill whatever's left
	// after the fixed-width side seats), and this `ResizeObserver` reads its
	// actual rendered box. This only stays jitter-free because everything else
	// in that row's neighbourhood — the partner plate's badge row, the
	// turn-button row, the status slot — has a height fixed by CSS regardless
	// of game state; nothing here reacts to `doc`.
	let trickCellEl = $state<HTMLDivElement>();
	let trickAvailW = $state(0);
	let trickAvailH = $state(0);
	// Where the cell starts and the top band ends, relative to the table root —
	// the banner layer's room above the trick box (see `bannerBand`). Positions,
	// like the sizes, only change when the viewport does.
	let trickCellTop = $state(0);
	let topBandBottom = $state(0);
	$effect(() => {
		const el = trickCellEl;
		const root = tableEl;
		if (!el || !root) return;
		const measure = () => {
			trickAvailW = el.clientWidth;
			trickAvailH = el.clientHeight;
			const rootTop = root.getBoundingClientRect().top;
			trickCellTop = el.getBoundingClientRect().top - rootTop;
			const band = root.querySelector('[data-top-band]');
			topBandBottom = band ? band.getBoundingClientRect().bottom - rootTop : 0;
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		// Same fallback as the table-root measurement above, and for the same
		// kind of reason: under rapid successive resizes (e.g. a test sweep
		// resizing through a dozen sizes a fraction of a second apart) this
		// element's own `ResizeObserver` callback can be coalesced/delayed by
		// the browser and leave a stale reading from a few resizes ago. A
		// plain `resize` listener re-measures unconditionally on every
		// viewport change, so it can't go stale the same way.
		window.addEventListener('resize', measure);
		window.visualViewport?.addEventListener('resize', measure);
		return () => {
			ro.disconnect();
			window.removeEventListener('resize', measure);
			window.visualViewport?.removeEventListener('resize', measure);
		};
	});
	const trickCardH = $derived(fitTrickCardH(trickAvailW, trickAvailH));
	const shared = $derived(deriveShared(trickCardH, hand.handCardH));

	// The banners (announce / meld reveal / meld scored) sit over the
	// partner-side felt, between the top band and the trick box's top edge, so
	// they never cover a played card (plan §6). Portrait: an absolute layer
	// filling exactly that band, bottom-aligned against the trick box; the two
	// text banners share a row and the reveal cards shrink so that row and the
	// reveal both fit. Compact has no room there (the trick box starts
	// right under the top band), so the banners overlay the top band's centre
	// instead, over the partner plate, in one row with small reveal cards.
	const BANNER_MARGIN = 4;
	const bannerBand = $derived.by(() => {
		const top = topBandBottom + BANNER_MARGIN;
		const boxTop = trickCellTop + (trickAvailH - trickBoxH(trickCardH)) / 2;
		return { top, height: Math.max(0, boxTop - BANNER_MARGIN - top) };
	});
	// The text-banner row (28px) + gap (4) + the reveal chip's padding (8).
	const revealCardH = $derived(
		hand.compact
			? COMPACT_REVEAL_CARD_H
			: Math.round(clamp(Math.min(shared.revealCardH, bannerBand.height - 40), 24, 92))
	);
	// Fixed width for the left/right seat columns and compact's bottom-band
	// side columns (see `sideColW`). In narrow portrait the side plates are
	// turned sideways to a fixed 48px and their column is content-sized
	// instead — still viewport-only, since the fan scales off the hand.
	const sideW = $derived(sideColW(boxW));

	// Dock mechanism (plan §6): the fixed corner widgets rendered outside Table
	// (ChatBox, in +page.svelte) or inside it (LogFeed, CoachPanel, the Learning
	// badge) need to sit above the hand/dock row instead of on top of it. Table
	// publishes the row's height as a CSS custom property on the document root
	// so those widgets can offset themselves without Table having to know about
	// each one. Cleared on destroy so leaving the table (back to the lobby)
	// doesn't leave a stale offset behind.
	$effect(() => {
		// Portrait: level with my plate, beside it. Compact: just above the
		// bottom band, under the side seats (which sit at the top of their
		// columns there to leave the room).
		// While the hand-scored or game-over dialog is up, they drop to the
		// viewport's bottom corners; both dialogs keep that strip clear
		// (`pb-22`), so a toggle never covers their content.
		const modalUp = doc?.phase === 'handScored' || doc?.phase === 'gameOver';
		const dockBottom =
			mySeat == null || modalUp ? 0 : hand.handCardH + 20 + (hand.compact ? 4 : 44);
		document.documentElement.style.setProperty('--dock-bottom', `${dockBottom}px`);
		return () => document.documentElement.style.removeProperty('--dock-bottom');
	});

	// screen-reader turn announcements
	const announcement = $derived.by(() => {
		if (!doc || mySeat == null) return '';
		if ((doc.phase === 'bid1' || doc.phase === 'bid2') && doc.bidding?.turn === mySeat) {
			return 'Your turn to bid.';
		}
		if (doc.phase === 'meld' && doc.trick?.turn === mySeat) {
			return 'Your turn: call your meld or play a card.';
		}
		if (doc.phase === 'trick' && doc.trick?.turn === mySeat) {
			return doc.trick.number === 2 && (doc.melds.declared[mySeat]?.length ?? 0) > 0
				? 'Your turn: show your meld, then play a card.'
				: 'Your turn to play a card.';
		}
		if (doc.phase === 'trickDone' && doc.trick?.winner != null) {
			const w = doc.trick.winner;
			return `Trick to ${w === mySeat ? 'you' : (doc.players[w]?.name ?? `seat ${w}`)}.`;
		}
		if (doc.phase === 'handScored') {
			const t = teamOf(mySeat);
			return `Hand over. You ${doc.score.running[t]}, them ${doc.score.running[t ^ 1]}.`;
		}
		if (doc.phase === 'gameOver' && doc.winner != null) {
			return teamOf(mySeat) === doc.winner
				? 'Game over. Your team wins.'
				: 'Game over. Your team lost.';
		}
		return '';
	});
</script>

{#if doc}
	{#snippet sideSeat(seat: Seat, slot: number)}
		{@const turned = hand.sideSeatsVertical && slot !== 0}
		<!-- My own plate is rendered just above my hand instead, so a card I play
		     into the centre never lands on my name. On a narrow screen the
		     left/right plates sit sideways, outboard of the cards, so long names
		     have room to run vertically. `shrink-0` plus a fixed width from
		     `sideColW` (or, below `sm`, a content width that depends only on the
		     viewport): never game state, so the centre `trickCellEl` cell's
		     measured width can't change mid-hand. -->
		<div
			class="flex min-w-0 shrink-0 items-center justify-center
				{!turned
				? 'flex-col gap-0.5 sm:gap-1.5'
				: slot === 1
					? 'flex-row gap-0.5'
					: 'flex-row-reverse gap-0.5'}
				{hand.compact ? 'self-start' : ''}"
			style:width={!turned ? `${sideW}px` : undefined}
		>
			<PlayerPlate
				player={doc.players[seat]}
				relation={relationFor(seat)}
				side={SIDE[slot]}
				isDealer={seat === doc.dealer}
				isMaker={seat === doc.makerSeat}
				trump={doc.trump}
				isTurn={seat === currentSeat}
				isThinking={seat === currentSeat && (doc.players[seat]?.isBot ?? false)}
				justWon={seat === flashSeat}
				online={doc.players[seat]?.isBot || presence.isOnline(doc.players[seat]?.actorId)}
				lastBid={lastBid(seat)}
				tricks={teamTricks(seat)}
				meld={seatMeldStatus(doc, seat)}
				rotated={turned}
			/>
			<CardFan
				count={doc.hands[seat].length}
				reserve={6}
				height={shared.fanCardH}
				vertical={turned}
			/>
		</div>
	{/snippet}

	<!-- `h-dvh overflow-hidden`, not `min-h-screen` (plan §1): everything below
	     must fit this box, so the box itself must never grow past the visible
	     viewport (dvh accounts for a mobile browser's URL bar; a plain vh can
	     be taller than what's on screen). Safe-area insets keep content clear
	     of a notch/home-indicator in landscape. -->
	<div
		bind:this={tableEl}
		class="relative flex h-dvh w-full flex-col items-center overflow-hidden bg-green-900 text-white transition-[filter] duration-1000 {hand.compact
			? 'gap-0.5'
			: 'gap-1 sm:gap-2'}"
		style="padding-top: calc(env(safe-area-inset-top) + {hand.compact
			? '0.125rem'
			: '0.375rem'}); padding-bottom: calc(env(safe-area-inset-bottom) + {hand.compact
			? '0.125rem'
			: '0.375rem'}); padding-left: calc(env(safe-area-inset-left) + 0.5rem); padding-right: calc(env(safe-area-inset-right) + 0.5rem);"
		class:lost={iLost}
	>
		<!-- Top band: always one line, at every width — see GameTopBar's own
		     comment for why the Learning-mode indicator doesn't live here. -->
		<GameTopBar {store} {onleave}>
			{#snippet center()}
				{#if hand.compact}
					<!-- `relative` box filling the band's centre (between Leave and the
					     score pill) — the compact banner layer overlays it. -->
					<div class="relative flex w-full min-w-0 justify-center">
						<PlayerPlate
							player={doc.players[topSeat]}
							relation={relationFor(topSeat)}
							side="top"
							isDealer={topSeat === doc.dealer}
							isMaker={topSeat === doc.makerSeat}
							trump={doc.trump}
							isTurn={topSeat === currentSeat}
							isThinking={topSeat === currentSeat && (doc.players[topSeat]?.isBot ?? false)}
							justWon={topSeat === flashSeat}
							online={doc.players[topSeat]?.isBot ||
								presence.isOnline(doc.players[topSeat]?.actorId)}
							lastBid={lastBid(topSeat)}
							tricks={teamTricks(topSeat)}
							meld={seatMeldStatus(doc, topSeat)}
							compact
						/>
						<div
							class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center gap-1 overflow-hidden"
							data-banner-layer
						>
							{@render bannerChips(true)}
						</div>
					</div>
				{/if}
			{/snippet}
		</GameTopBar>

		<div class="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>

		{#if !hand.compact}
			<!-- Partner row: its own flex item (not a cell in the middle row),
			     `shrink-0` so it never changes size — this is the row whose
			     absence in `compact` mode (merged into the top band instead)
			     reclaims the height the trick area needs. -->
			<div class="flex w-full shrink-0 justify-center">
				<div class="flex max-w-[92vw] min-w-0 flex-col items-center gap-0.5 sm:gap-1.5">
					<PlayerPlate
						player={doc.players[topSeat]}
						relation={relationFor(topSeat)}
						side="top"
						isDealer={topSeat === doc.dealer}
						isMaker={topSeat === doc.makerSeat}
						trump={doc.trump}
						isTurn={topSeat === currentSeat}
						isThinking={topSeat === currentSeat && (doc.players[topSeat]?.isBot ?? false)}
						justWon={topSeat === flashSeat}
						online={doc.players[topSeat]?.isBot || presence.isOnline(doc.players[topSeat]?.actorId)}
						lastBid={lastBid(topSeat)}
						tricks={teamTricks(topSeat)}
						meld={seatMeldStatus(doc, topSeat)}
					/>
					<CardFan count={doc.hands[topSeat].length} reserve={6} height={shared.fanCardH} />
				</div>
			</div>
		{/if}

		<!-- Middle row: the only `flex-1` item, so it's the one that takes
		     whatever's left after the fixed-height rows around it. Its centre
		     cell (`trickCellEl`) is itself `flex-1` within this row, so it
		     measures as "whatever's left after the side seats" — that
		     measurement (not a guess) is what sizes the trick cards.

		     `min-h-0` on both this row and the cell is load-bearing, not
		     cosmetic: without it, a flex item's automatic minimum size is its
		     content's min-content size, and this row's content is (indirectly)
		     `TrickArea`, sized from the very same measurement this row exists
		     to produce. Drop `min-h-0` and that becomes a feedback loop with a
		     stable wrong fixed point — the row can get "stuck" reporting
		     whatever height `TrickArea` currently renders at, however that
		     arose, instead of the true flex-distributed leftover space. (Found
		     via a real repro: many rapid resizes in a row — see
		     scripts/layout-check.mjs — could latch the trick area onto a size
		     from an earlier, larger viewport and never correct back down.) -->
		<!-- `.table-grid` is now just a selector hook for Table.svelte.spec.ts's
		     jitter test (it isn't a CSS grid any more) — kept so that test still
		     asserts the same invariant (this row's position doesn't move when
		     the status slot's content changes) without needing a new selector. -->
		<div class="table-grid flex min-h-0 w-full flex-1 items-stretch justify-center gap-1">
			<!-- Left seat, trick cell, right seat — in that order, so the trick
			     area sits between them. -->
			{@render sideSeat(leftSeat, 1)}

			<div
				bind:this={trickCellEl}
				data-trick-area
				class="flex min-h-0 min-w-0 flex-1 items-center justify-center"
			>
				<TrickArea
					{doc}
					{baseSeat}
					{handPoints}
					cardH={trickCardH}
					winner={doc.phase === 'trickDone' ? doc.trick?.winner : null}
					learning={!advanced}
				/>
			</div>

			{@render sideSeat(rightSeat, 3)}
		</div>

		{#if !hand.compact}
			<!-- See `bannerBand`: exactly the felt between the top band and the
			     trick box, bottom-aligned; absolute, so it never reflows. -->
			<div
				class="pointer-events-none absolute left-1/2 z-10 flex w-[calc(100%-1rem)] max-w-2xl -translate-x-1/2 flex-col items-center justify-end gap-1 overflow-hidden"
				style:top="{bannerBand.top}px"
				style:height="{bannerBand.height}px"
				data-banner-layer
			>
				{@render bannerChips(false)}
			</div>
		{/if}

		<!-- The phase panel / renege prompt lives here without reflowing the
		     middle row or the hand: it's anchored to the bottom of this
		     fixed-height slot and grows upward over the felt. Anything that grows
		     above the slot lands on the lower part of the trick cell: the bottom
		     seat's card slot and the felt below the puck and the side cards.
		     The bidding and meld-call bars only show before my card is down, so
		     they never cover a played card or the puck
		     (scripts/layout-check.mjs checks both). Portrait reserves
		     `min-h-14`; compact reserves nothing (`h-0`, see tableLayout.ts's
		     COMPACT_STATUS_SLOT_H) and puts trickDone's Continue in the bottom
		     band's right-hand column instead, since my played card is down
		     then. -->
		<div
			class="pointer-events-none relative flex w-full shrink-0 items-start justify-center {hand.compact
				? 'h-0'
				: 'min-h-14'}"
			data-status-slot
		>
			<!-- `inset-x-0`, not `left-1/2 -translate-x-1/2`: an absolute box at
			     `left: 50%` shrink-wraps to half the slot's width, which wrapped
			     the one-line bars onto two or three lines. -->
			<div class="absolute inset-x-0 bottom-0 z-10 flex flex-col items-center">
				{#if pendingCall && mySeat != null}
					<!-- In short landscape the trick box already fills the height
						     above this slot (plan §4), so this shrinks to fit: a
						     one-line question and the buttons instead of a stacked
						     paragraph + row. -->
					<div
						class="pointer-events-auto flex max-w-[92vw] flex-col items-center gap-2 rounded-xl bg-red-950/90 px-4 py-3 text-center ring-1 ring-red-400/60"
					>
						<p class="text-xs text-red-100">
							{#if advanced}
								Call a renege on {teamName(teamOf(mySeat) ^ 1)}? the other team takes 162 plus any
								meld and the hand ends.
							{:else}
								Call the renege on {teamName(teamOf(mySeat) ^ 1)}? {teamName(teamOf(mySeat))} takes 162
								plus any meld and the hand ends.
							{/if}
						</p>
						<div class="flex gap-2">
							<button
								onclick={() => (pendingCall = false)}
								class="rounded-lg bg-white/10 px-4 py-1.5 text-sm font-semibold hover:bg-white/20"
							>
								Cancel
							</button>
							<button
								onclick={callRenege}
								class="rounded-lg bg-red-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-red-400"
							>
								Call renege
							</button>
						</div>
					</div>
				{:else if doc.phase === 'bid1' || doc.phase === 'bid2'}
					<div class="pointer-events-auto">
						<BiddingPanel {store} cardH={trickCardH} />
					</div>
				{:else if doc.phase === 'meld'}
					<div class="pointer-events-auto">
						<MeldPanel
							{store}
							picking={meldPicking}
							chosen={meldChosen}
							onopen={openMeldPicker}
							oncancel={cancelMeldPicker}
							onconfirm={cancelMeldPicker}
						/>
					</div>
				{:else if !hand.compact}
					{@render trickDoneOrRedeal()}
				{/if}
			</div>
		</div>

		{#snippet bannerChips(inBand: boolean)}
			<!-- The two text banners share one row (each truncates, full text in
			     `title`), so all three banners fit the band at 320×568. -->
			{#if announceBanner || meldBanner}
				<div class="flex max-w-full min-w-0 justify-center gap-1 {inBand ? '' : 'shrink-0'}">
					{#if announceBanner}
						<div
							data-banner
							class="min-w-0 truncate rounded-lg bg-sky-300 font-semibold text-green-950
								{inBand ? 'px-2 py-1 text-xs' : 'px-3 py-1 text-sm'}"
							role="status"
							title={announceBanner}
						>
							{announceBanner}
						</div>
					{/if}
					{#if meldBanner}
						<div
							data-banner
							class="min-w-0 truncate rounded-lg bg-amber-300 font-semibold text-green-950
								{inBand ? 'px-2 py-1 text-xs' : 'px-3 py-1 text-sm'}"
							title={meldBanner}
						>
							{meldBanner}
						</div>
					{/if}
				</div>
			{/if}

			{#if meldReveal}
				{@const revealName = doc.players[meldReveal.seat]?.name ?? `seat ${meldReveal.seat}`}
				<div
					data-banner
					class="flex max-w-full min-w-0 shrink-0 items-center rounded-lg bg-amber-300 text-green-950
						{inBand ? 'gap-1 px-1.5 py-0.5' : 'gap-2 px-2 py-1'}"
					role="status"
				>
					<span class="min-w-0 truncate font-semibold {inBand ? 'text-[11px]' : 'text-sm'}"
						>{revealName} shows</span
					>
					<div class="flex shrink-0 gap-0.5">
						{#each meldReveal.cards as card (card)}
							<Card {card} height={revealCardH} />
						{/each}
					</div>
				</div>
			{/if}
		{/snippet}

		{#snippet trickDoneOrRedeal()}
			{#if doc.phase === 'trickDone'}
				<!-- flex-col-reverse: the button is pinned to the bottom of its
				     slot, so the "waiting on …" line wraps upward over the felt
				     instead of pushing the button down into the hand. -->
				<div class="pointer-events-auto flex flex-col-reverse items-center gap-1">
					{#if mySeat != null}
						<button
							onclick={ackTrick}
							disabled={iAckedTrick}
							class="rounded-lg bg-white/10 px-4 py-1.5 text-sm text-white/70 hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50"
						>
							{iAckedTrick ? 'Waiting for the table…' : 'Continue →'}
						</button>
					{/if}
					{#if waitingOnTrick.length}
						<p
							class="text-center text-[11px] text-white/35 {hand.compact
								? 'w-full'
								: 'w-[min(92vw,40rem)]'}"
						>
							Waiting on {waitingOnTrick.join(', ')} to press Continue.
						</p>
					{/if}
				</div>
			{:else if doc.phase === 'redeal'}
				<div class="text-center text-sm text-white/60">Everyone passed — re-dealing…</div>
			{/if}
		{/snippet}

		{#snippet myPlateAndButtons()}
			<PlayerPlate
				player={doc.players[mySeat!]}
				relation="you"
				isDealer={mySeat === doc.dealer}
				isMaker={mySeat === doc.makerSeat}
				trump={doc.trump}
				isTurn={mySeat === currentSeat}
				isThinking={false}
				justWon={mySeat === flashSeat}
				online={true}
				lastBid={lastBid(mySeat!)}
				tricks={teamTricks(mySeat!)}
				meld={seatMeldStatus(doc, mySeat!)}
			/>
			<!-- Fixed height (not just a minimum) so these turn-scoped buttons never
			     change the bottom band's height — up to 3 can show at once (Show
			     meld / Call bella / Call renege); `flex-nowrap` keeps them on one
			     row rather than wrapping to a second, which `h-9` alone wouldn't
			     stop. They can get tight at the narrowest widths with all three
			     showing at once (rare — needs an un-shown meld, an unplayed bella
			     pair and a live renege, together). -->
			<div class="flex h-9 flex-nowrap items-center justify-center gap-1.5 overflow-hidden">
				{#if canShowMeld}
					<button
						onclick={showMeld}
						class="rounded-lg bg-amber-300 px-3 py-1 text-xs font-semibold text-green-950 hover:bg-amber-200"
					>
						Show meld
					</button>
				{/if}
				{#if canCallBella}
					<button
						onclick={callBella}
						class="rounded-lg bg-amber-300/90 px-3 py-1 text-xs font-semibold text-green-950 hover:bg-amber-200"
					>
						Call bella
					</button>
				{/if}
				{#if mayCallRenege && !pendingCall}
					<button
						onclick={() => (pendingCall = true)}
						class="rounded-lg bg-red-500/15 px-3 py-1 text-xs font-semibold text-red-200 ring-1 ring-red-400/40 hover:bg-red-500/25"
					>
						Call renege
					</button>
				{/if}
			</div>
		{/snippet}

		{#if mySeat == null}
			<!-- A spectator has no hand; the bottom seat's plate sits here instead. -->
			{@render sideSeat(baseSeat, 0)}
			<p class="pb-4 text-center text-sm text-white/40">You're watching this game.</p>
		{:else if hand.compact}
			<!-- Short landscape bottom band (plan §4): my plate + buttons in a
			     fixed-width left column instead of stacked above the hand — that
			     stack was the single biggest reserved-height cost in this mode
			     (measured ~227px vs ~130px as a row), and the difference is what
			     the trick area needs to clear its own floor. -->
			<div class="flex w-full items-center justify-center gap-2">
				<div class="flex shrink-0 flex-col items-center gap-1" style:width="{sideW}px">
					{@render myPlateAndButtons()}
				</div>
				<MyHand
					cards={myHand}
					legal={myLegal}
					active={handActive}
					{advanced}
					height={hand.handCardH}
					selecting={meldPicking}
					selected={meldChosen}
					onplay={play}
					ontoggle={toggleMeldCard}
				/>
				<!-- trickDone's Continue and the redeal note live here in compact
				     (see the status slot above). `relative` + an absolute child:
				     a long "waiting on …" line grows upward over the right seat
				     rather than changing this band's height. -->
				<div class="relative shrink-0 self-stretch" style:width="{sideW}px">
					<div class="absolute inset-x-0 bottom-1 flex flex-col items-center">
						{@render trickDoneOrRedeal()}
					</div>
				</div>
			</div>
		{:else}
			<div class="flex w-full flex-col items-center gap-1.5">
				{@render myPlateAndButtons()}
				<MyHand
					cards={myHand}
					legal={myLegal}
					active={handActive}
					{advanced}
					height={hand.handCardH}
					selecting={meldPicking}
					selected={meldChosen}
					onplay={play}
					ontoggle={toggleMeldCard}
				/>
			</div>
		{/if}

		<!-- The log narrates illegal cards and beaten melds outright, so it's a
		     Learning-mode aid only — in renege play catching that is the players'
		     job. It docks above the hand (plan §6) via the `--dock-bottom`
		     custom property Table publishes, so it never sits over a card. -->
		{#if !advanced}
			<LogFeed log={doc.log} players={doc.players} {mySeat} />
		{/if}
	</div>

	<!-- Outside the .lost filter so the fixed overlays position against the
	     viewport and the fireworks/tears keep their colour. -->
	<GameOver {store} />
	{#if doc.training}
		<CoachPanel {store} />
	{/if}
{/if}

<style>
	.lost {
		filter: saturate(0.3) brightness(0.85);
	}
	.table-grid {
		width: min(100%, 760px);
	}
</style>
