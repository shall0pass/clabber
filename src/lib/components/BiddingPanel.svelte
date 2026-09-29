<script lang="ts">
	import Card from './Card.svelte';
	import { legalBids } from '$lib/clabber/bidding';
	import { suitOf } from '$lib/clabber/cards';
	import { SUIT_NAME, SUIT_SYMBOL, isRedSuit } from '$lib/cards/display';
	import type { GameStore } from '$lib/repo/gameStore.svelte';
	import type { Bid, Seat } from '$lib/clabber/types';

	let { store, cardH = 72 }: { store: GameStore; cardH?: number } = $props();

	const doc = $derived(store.doc);
	const mySeat = $derived(store.mySeat);
	const bidding = $derived(doc?.bidding ?? null);
	const myTurn = $derived(bidding != null && mySeat != null && bidding.turn === mySeat);
	const options = $derived(myTurn && doc && mySeat != null ? legalBids(doc, mySeat) : []);
	const turnName = $derived(
		bidding ? (doc?.players[bidding.turn]?.name ?? `seat ${bidding.turn}`) : ''
	);

	function label(bid: Bid): string {
		if (bid === 'pass') return 'Pass';
		if (bid === 'accept') {
			const s = doc?.upCard ? suitOf(doc.upCard) : undefined;
			return s ? `Play ${SUIT_NAME[s]}` : 'Play';
		}
		return `${SUIT_SYMBOL[bid.suit]} ${SUIT_NAME[bid.suit]}`;
	}

	function send(bid: Bid) {
		if (mySeat == null) return;
		store.tryChange({ type: 'Bid', seat: mySeat as Seat, bid });
	}
</script>

{#if bidding && doc}
	<!-- One line, always (follow-up pass on docs/responsive-layout-plan.md):
	     up-card, round text, bids — all inline. This used to have a taller,
	     stacked variant for wide screens, but a stacked panel growing upward
	     from the status slot could reach past its reserved height and into the
	     trick area's played cards; a one-line bar comfortably fits the slot's
	     fixed `min-h-14` everywhere, so it can't cover a card
	     (scripts/layout-check.mjs checks this). -->
	<div
		class="flex max-w-[90vw] flex-wrap items-center justify-center gap-2 rounded-xl bg-green-950/85 px-3 py-1.5 ring-1 ring-white/10"
	>
		{#if doc.upCard}
			<Card card={doc.upCard} height={Math.min(cardH, 48)} />
		{/if}
		<span class="text-xs text-white/70">
			{#if bidding.round === 1}
				Round 1 — play or pass
			{:else}
				Round 2 — name a suit (not {bidding.passedSuit ? SUIT_NAME[bidding.passedSuit] : ''})
			{/if}
		</span>
		{#if myTurn}
			{#each options as opt (JSON.stringify(opt))}
				<button
					onclick={() => send(opt)}
					class="rounded-lg px-2.5 py-1 text-xs font-semibold
						{opt === 'pass'
						? 'bg-white/10 hover:bg-white/20'
						: 'bg-amber-300 text-green-950 hover:bg-amber-200'}
						{typeof opt === 'object' && isRedSuit(opt.suit) ? 'text-red-700' : ''}"
				>
					{label(opt)}
				</button>
			{/each}
		{:else}
			<span class="text-xs text-white/55">Waiting for {turnName}…</span>
		{/if}
	</div>
{/if}
