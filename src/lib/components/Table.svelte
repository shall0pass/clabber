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

	let { store, presence, host }: { store: GameStore; presence: Presence; host: Host } = $props();

	const doc = $derived(store.doc);
	const mySeat = $derived(store.mySeat);
	const baseSeat = $derived((mySeat ?? 0) as Seat);

	// screen slot: 0 bottom, 1 left, 2 top, 3 right — rotate so I'm at the bottom
	const AREA = ['area-bottom', 'area-left', 'area-top', 'area-right'];
	function areaFor(seat: Seat) {
		return AREA[(seat - baseSeat + 4) % 4];
	}
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

	function play(card: CardT) {
		if (mySeat != null) store.tryChange({ type: 'PlayCard', seat: mySeat, card });
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
			meldBanner = `Team ${t} scored ${pts} for meld`;
			const id = setTimeout(() => (meldBanner = ''), 3500);
			return () => clearTimeout(id);
		}
	});

	// while a completed trick is held on screen, pulse the winner's plate
	const flashSeat = $derived(doc?.phase === 'trickDone' ? (doc.trick?.winner ?? null) : null);

	function advanceTrick() {
		store.tryChange({ type: 'AdvanceTrick' });
	}

	// shrink cards on small screens
	let uiScale = $state(1);
	$effect(() => {
		const fit = () => (uiScale = Math.max(0.62, Math.min(1, window.innerWidth / 780)));
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
			return 'Your turn: announce your meld or play a card.';
		}
		if (doc.phase === 'trick' && doc.trick?.turn === mySeat) return 'Your turn to play a card.';
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
		<div class="absolute top-3 left-3 z-10 text-[11px] text-white/35">
			{#if host.isHost}running the computer players{/if}
		</div>

		<div class="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>

		<div class="flex flex-1 flex-col items-center justify-center gap-4">
			<div class="table-grid">
				{#each SEATS as seat (seat)}
					<div class="{areaFor(seat)} flex max-w-full min-w-0 flex-col items-center gap-1.5">
						<PlayerPlate
							player={doc.players[seat]}
							relation={relationFor(seat)}
							isDealer={seat === doc.dealer}
							isTurn={seat === currentSeat}
							isThinking={seat === currentSeat && (doc.players[seat]?.isBot ?? false)}
							justWon={seat === flashSeat}
							online={doc.players[seat]?.isBot || presence.isOnline(doc.players[seat]?.actorId)}
							lastBid={lastBid(seat)}
							tricks={teamTricks(seat)}
						/>
						{#if seat !== mySeat}
							<CardFan count={doc.hands[seat].length} height={px(46)} />
						{/if}
					</div>
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

		<div class="w-full">
			{#if mySeat != null}
				<MyHand cards={myHand} legal={myLegal} active={handActive} height={px(118)} onplay={play} />
			{:else}
				<p class="pb-4 text-center text-sm text-white/40">You're watching this game.</p>
			{/if}
		</div>

		<LogFeed log={doc.log} players={doc.players} />
	</div>

	<!-- Outside the .lost filter so the fixed overlays position against the
	     viewport and the fireworks/tears keep their colour. -->
	<GameOver {store} />
{/if}

<style>
	.lost {
		filter: saturate(0.3) brightness(0.85);
	}
	.table-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		grid-template-rows: auto auto auto;
		gap: clamp(0.4rem, 3vw, 1.25rem) clamp(0.5rem, 6vw, 2.5rem);
		place-items: center;
		width: min(96vw, 680px);
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
