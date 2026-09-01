<script lang="ts">
	import { SEATS, partnerSeat, teamOf } from '$lib/clabber/state';
	import { sortHand } from '$lib/clabber/cards';
	import { legalMoves } from '$lib/clabber/play';
	import { seatMeldStatus } from '$lib/clabber/meld';
	import { trickPointsSoFar } from '$lib/clabber/score';
	import { SvelteSet } from 'svelte/reactivity';
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

	let { store, presence, onleave }: { store: GameStore; presence: Presence; onleave: () => void } =
		$props();

	const doc = $derived(store.doc);
	const mySeat = $derived(store.mySeat);
	const baseSeat = $derived((mySeat ?? 0) as Seat);

	// screen slot: 0 bottom, 1 left, 2 top, 3 right — rotate so I'm at the bottom
	const AREA = ['area-bottom', 'area-left', 'area-top', 'area-right'];
	function screenSlot(seat: Seat) {
		return (seat - baseSeat + 4) % 4;
	}
	function areaFor(seat: Seat) {
		return AREA[screenSlot(seat)];
	}
	const SIDE = ['bottom', 'left', 'top', 'right'] as const;
	function relationFor(seat: Seat): 'you' | 'partner' | 'opponent' {
		if (mySeat == null) return 'opponent';
		if (seat === mySeat) return 'you';
		if (seat === partnerSeat(mySeat)) return 'partner';
		return 'opponent';
	}

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

	// shrink cards on small screens; below `sm` the side seats stack vertically
	let uiScale = $state(1);
	let isNarrow = $state(false);
	$effect(() => {
		const fit = () => {
			uiScale = Math.max(0.58, Math.min(1, window.innerWidth / 720));
			isNarrow = window.innerWidth < 640;
		};
		fit();
		window.addEventListener('resize', fit);
		return () => window.removeEventListener('resize', fit);
	});
	const px = (n: number) => Math.round(n * uiScale);

	// Pin the grid's centre column to the trick area's own width (same math as
	// TrickArea: card 110 x scale, puck 116 x scale) so a wide or narrow partner
	// plate -- or anything else in the centre column -- can never widen it and
	// squeeze the side seats. The side columns are then a fixed 1fr each.
	const centerColW = $derived.by(() => {
		const cardH = Math.round(110 * uiScale);
		const cardW = Math.round(cardH * (64 / 89));
		const puck = Math.round(116 * uiScale);
		const gap = Math.round(puck / 2 + 12 * uiScale);
		return 2 * (gap + cardW);
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
	<div
		class="relative flex min-h-screen flex-col items-center gap-4 bg-green-900 p-4 text-white transition-[filter] duration-1000"
		class:lost={iLost}
	>
		<GameTopBar {store} {onleave} />

		<div class="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>

		<!-- `w-full` so `.table-grid`'s `min(100%, 760px)` resolves to a definite
		     width; without it the flex column shrink-wraps and a plate that gains
		     a "1 trick" label re-sizes the whole grid and re-centres it. -->
		<div class="flex w-full flex-1 flex-col items-center justify-center gap-4">
			<div class="table-grid" style:--center-w="{centerColW}px">
				{#each SEATS as seat (seat)}
					{#if mySeat == null || seat !== mySeat}
						{@const slot = screenSlot(seat)}
						<!-- My own plate is rendered just above my hand instead, so a card
						     I play into the centre never lands on my name. On a narrow
						     screen the left/right plates sit sideways, outboard of the
						     cards, so long names have room to run vertically.
						     The top (partner) plate sits in the fixed-width centre column;
						     let it spill past that column into the empty felt beside it
						     (capped at the viewport) rather than clamp to the column and
						     collapse the name once DEAL / MADE / meld chips are on it. -->
						<div
							class="{areaFor(seat)} flex min-w-0 items-center gap-0.5 sm:gap-1.5
								{slot === 2 ? 'max-w-[92vw]' : 'max-w-full'}
								{slot === 1 ? 'flex-row sm:flex-col' : slot === 3 ? 'flex-row-reverse sm:flex-col' : 'flex-col'}"
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
							/>
							<CardFan
								count={doc.hands[seat].length}
								reserve={6}
								height={px(52)}
								vertical={isNarrow && (slot === 1 || slot === 3)}
							/>
						</div>
					{/if}
				{/each}

				<div class="area-center">
					<TrickArea
						{doc}
						{baseSeat}
						{handPoints}
						scale={uiScale}
						winner={doc.phase === 'trickDone' ? doc.trick?.winner : null}
					/>
				</div>
			</div>

			<!-- Everything transient lives here without reflowing the grid or the
			     hand: the phase panel / renege prompt is anchored to the bottom of
			     this fixed-height slot and grows upward over the felt; the banners
			     float just above the slot. -->
			<div
				class="pointer-events-none relative flex min-h-14 w-full max-w-md items-start justify-center"
				data-status-slot
			>
				<div
					class="absolute bottom-full left-1/2 mb-2 flex w-full -translate-x-1/2 flex-col items-center gap-2"
					data-banner-layer
				>
					{#if announceBanner}
						<div
							class="rounded-lg bg-sky-300 px-4 py-1.5 text-sm font-semibold text-green-950"
							role="status"
						>
							{announceBanner}
						</div>
					{/if}

					{#if meldReveal}
						{@const revealName = doc.players[meldReveal.seat]?.name ?? `seat ${meldReveal.seat}`}
						<div
							class="flex flex-col items-center gap-1.5 rounded-lg bg-amber-300 px-4 py-2 text-green-950"
							role="status"
						>
							<span class="text-sm font-semibold">{revealName} shows meld</span>
							<div class="flex gap-1">
								{#each meldReveal.cards as card (card)}
									<Card {card} height={px(60)} />
								{/each}
							</div>
						</div>
					{/if}

					{#if meldBanner}
						<div class="rounded-lg bg-amber-300 px-4 py-1.5 text-sm font-semibold text-green-950">
							{meldBanner}
						</div>
					{/if}
				</div>

				<div class="absolute bottom-0 left-1/2 flex -translate-x-1/2 flex-col items-center">
					{#if pendingCall && mySeat != null}
						<div
							class="pointer-events-auto flex flex-col items-center gap-2 rounded-xl bg-red-950/90 px-4 py-3 text-center ring-1 ring-red-400/60"
						>
							<p class="text-sm text-red-100">
								{#if advanced}
									Call a renege on {teamName(teamOf(mySeat) ^ 1)}? If they didn't break a rule, the
									penalty falls on {teamName(teamOf(mySeat))} instead — the other team takes 162 plus
									any meld and the hand ends.
								{:else}
									Call the renege on {teamName(teamOf(mySeat) ^ 1)}? {teamName(teamOf(mySeat))} takes
									162 plus any meld and the hand ends.
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
						<div class="pointer-events-auto"><BiddingPanel {store} /></div>
					{:else if doc.phase === 'meld'}
						<div class="pointer-events-auto"><MeldPanel {store} /></div>
					{:else if doc.phase === 'trickDone'}
						<!-- flex-col-reverse: the button is pinned to the bottom of the
						     slot, so the "waiting on …" line wraps upward over the felt
						     (using the full width available) instead of pushing the
						     button down into the hand. -->
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
								<p class="w-[min(92vw,40rem)] text-center text-[11px] text-white/35">
									Waiting on {waitingOnTrick.join(', ')} to press Continue.
								</p>
							{/if}
						</div>
					{:else if doc.phase === 'redeal'}
						<div class="text-sm text-white/60">Everyone passed — re-dealing…</div>
					{/if}
				</div>
			</div>
		</div>

		<div class="flex w-full flex-col items-center gap-1.5">
			{#if mySeat != null}
				<PlayerPlate
					player={doc.players[mySeat]}
					relation="you"
					isDealer={mySeat === doc.dealer}
					isMaker={mySeat === doc.makerSeat}
					trump={doc.trump}
					isTurn={mySeat === currentSeat}
					isThinking={false}
					justWon={mySeat === flashSeat}
					online={true}
					lastBid={lastBid(mySeat)}
					tricks={teamTricks(mySeat)}
					meld={seatMeldStatus(doc, mySeat)}
				/>
				<!-- reserved height so these turn-scoped buttons never push the hand -->
				<div class="flex min-h-9 flex-wrap items-center justify-center gap-2">
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
				<MyHand
					cards={myHand}
					legal={myLegal}
					active={handActive}
					{advanced}
					height={px(140)}
					onplay={play}
				/>
			{:else}
				<p class="pb-4 text-center text-sm text-white/40">You're watching this game.</p>
			{/if}
		</div>

		{#if !advanced}
			<span
				class="absolute right-3 bottom-16 rounded-lg bg-amber-400/20 px-2 py-1 text-[11px] text-amber-200 ring-1 ring-amber-300/40"
			>
				Learning mode
			</span>
		{/if}

		<LogFeed log={doc.log} players={doc.players} {mySeat} />
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
		display: grid;
		/* fixed centre column (set from JS to the trick area's width) so nothing
		   in it can widen it and squeeze the side seats */
		grid-template-columns: minmax(0, 1fr) var(--center-w, auto) minmax(0, 1fr);
		grid-template-rows: auto auto auto;
		gap: clamp(0.3rem, 3vw, 1.25rem) clamp(0.15rem, 3vw, 1.75rem);
		place-items: center;
		width: min(100%, 760px);
	}
	.area-top {
		grid-area: 1 / 2;
	}
	.area-left {
		grid-area: 2 / 1;
	}
	.area-right {
		grid-area: 2 / 3;
	}
	.area-bottom {
		grid-area: 3 / 2;
	}
	.area-center {
		grid-area: 2 / 2;
		width: 100%;
		display: grid;
		place-items: center;
	}
</style>
