<script lang="ts">
	import { SEATS, partnerSeat, teamOf } from '$lib/clabber/state';
	import { sortHand } from '$lib/clabber/cards';
	import { legalMoves } from '$lib/clabber/play';
	import { trickPointsSoFar } from '$lib/clabber/score';
	import type { Card as CardT, Seat } from '$lib/clabber/types';
	import type { GameStore } from '$lib/repo/gameStore.svelte';
	import type { Presence } from '$lib/repo/presence.svelte';
	import type { Host } from '$lib/repo/host';

	import PlayerPlate from './PlayerPlate.svelte';
	import CardFan from './CardFan.svelte';
	import MyHand from './MyHand.svelte';
	import TrickArea from './TrickArea.svelte';
	import BiddingPanel from './BiddingPanel.svelte';
	import MeldPanel from './MeldPanel.svelte';
	import Scoreboard from './Scoreboard.svelte';
	import GameOver from './GameOver.svelte';
	import LogFeed from './LogFeed.svelte';
	import LeaveButton from './LeaveButton.svelte';
	import CoachPanel from './CoachPanel.svelte';

	let {
		store,
		presence,
		host,
		onleave
	}: { store: GameStore; presence: Presence; host: Host; onleave: () => void } = $props();

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
			['meld', 'trick', 'trickDone'].includes(doc.phase) &&
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
	function nextHand() {
		store.tryChange({ type: 'StartHand', seed: crypto.randomUUID() });
	}

	// brief banner when the first trick resolves the meld
	let meldBanner = $state('');
	$effect(() => {
		if (doc?.melds.resolved && doc.melds.scoredTeam != null) {
			const t = doc.melds.scoredTeam;
			const pts = doc.melds.points[t];
			meldBanner = `${teamName(t)} scored ${pts} for meld`;
			const id = setTimeout(() => (meldBanner = ''), 3500);
			return () => clearTimeout(id);
		}
	});

	// while a completed trick is held on screen, pulse the winner's plate
	const flashSeat = $derived(doc?.phase === 'trickDone' ? (doc.trick?.winner ?? null) : null);

	function advanceTrick() {
		store.tryChange({ type: 'AdvanceTrick' });
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
		<div class="absolute top-3 right-3 z-20">
			<Scoreboard {store} onNextHand={nextHand} />
		</div>
		<div class="absolute top-3 left-3 z-10 flex flex-col items-start gap-1">
			<LeaveButton {onleave} />
			{#if host.isHost}
				<span class="text-[11px] text-white/35">running the computer players</span>
			{/if}
		</div>

		<div class="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>

		<div class="flex flex-1 flex-col items-center justify-center gap-4">
			<div class="table-grid">
				{#each SEATS as seat (seat)}
					{#if mySeat == null || seat !== mySeat}
						{@const slot = screenSlot(seat)}
						<!-- My own plate is rendered just above my hand instead, so a card
						     I play into the centre never lands on my name. On a narrow
						     screen the left/right plates sit sideways, outboard of the
						     cards, so long names have room to run vertically. -->
						<div
							class="{areaFor(seat)} flex max-w-full min-w-0 items-center gap-0.5 sm:gap-1.5
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
							/>
							<CardFan
								count={doc.hands[seat].length}
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

			{#if meldBanner}
				<div class="rounded-lg bg-amber-300 px-4 py-1.5 text-sm font-semibold text-green-950">
					{meldBanner}
				</div>
			{/if}

			{#if doc.phase === 'bid1' || doc.phase === 'bid2'}
				<BiddingPanel {store} />
			{:else if doc.phase === 'meld'}
				<MeldPanel {store} />
			{:else if doc.phase === 'trickDone'}
				<button
					onclick={advanceTrick}
					class="rounded-lg bg-white/10 px-4 py-1.5 text-sm text-white/70 hover:bg-white/20"
				>
					Continue →
				</button>
			{:else if doc.phase === 'redeal'}
				<div class="text-sm text-white/60">Everyone passed — re-dealing…</div>
			{/if}
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
				/>
				<div class="flex flex-wrap justify-center gap-2">
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
				{#if pendingCall}
					<div
						class="flex flex-col items-center gap-2 rounded-xl bg-red-950/90 px-4 py-3 text-center ring-1 ring-red-400/60"
					>
						<p class="text-sm text-red-100">
							{#if advanced}
								Call a renege on {teamName(teamOf(mySeat) ^ 1)}? If they didn't break a rule, the
								penalty falls on {teamName(teamOf(mySeat))} instead — the other team takes 162 plus any
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
				{/if}
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

		{#if advanced}
			<span
				class="absolute right-3 bottom-16 rounded-lg bg-red-500/20 px-2 py-1 text-[11px] text-red-200 ring-1 ring-red-400/40"
			>
				Advanced (renege)
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
		grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
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
