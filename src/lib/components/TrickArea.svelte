<script lang="ts">
	import Card from './Card.svelte';
	import { SUIT_SYMBOL, isRedSuit } from '$lib/cards/display';
	import type { GameDoc, Seat } from '$lib/clabber/types';

	let {
		doc,
		baseSeat = 0,
		handPoints = [0, 0],
		cardH: cardHProp = 110,
		winner = null,
		learning = false
	}: {
		doc: GameDoc;
		/** the seat rendered at the bottom of the table */
		baseSeat?: Seat;
		/** trick points banked so far this hand, [team0, team1] */
		handPoints?: [number, number];
		/** played-card height, px — from `computeTableLayout`'s `trickCardH`
		 *  (viewport-only; never game state, so this never jitters) */
		cardH?: number;
		/** while a finished trick is held on screen, the seat that took it */
		winner?: Seat | null;
		/** Learning mode is on — shown as a small chip on the puck rather than in
		 *  the top band, which must stay one line at every width (follow-up pass
		 *  on docs/responsive-layout-plan.md): a chip absolutely positioned on a
		 *  fixed-size circle can never cause a wrap, unlike text in a flex row. */
		learning?: boolean;
	} = $props();

	// Big, readable played cards around a central puck that shows trump / trick /
	// score. `gap` is the clear ring between the puck and the inner edge of each
	// card, so the puck text is never covered.
	const cardH = $derived(Math.round(cardHProp));
	const cardW = $derived(Math.round(cardH * (64 / 89)));
	const scale = $derived(cardH / 110);
	const puck = $derived(Math.round(116 * scale));
	const gap = $derived(Math.round(puck / 2 + 12 * scale));

	// Offset of each card's centre from the middle of the table. slot: 0 bottom,
	// 1 left, 2 top, 3 right.
	const offsets = $derived([
		{ x: 0, y: gap + cardH / 2 },
		{ x: -(gap + cardW / 2), y: 0 },
		{ x: 0, y: -(gap + cardH / 2) },
		{ x: gap + cardW / 2, y: 0 }
	]);
	function slot(seat: Seat) {
		return (seat - baseSeat + 4) % 4;
	}

	const boxW = $derived(2 * (gap + cardW));
	const boxH = $derived(2 * (gap + cardH));

	const plays = $derived(doc.trick?.plays ?? []);
	const trump = $derived(doc.trump);
</script>

<div class="relative" data-card-h={cardH} style:width="{boxW}px" style:height="{boxH}px">
	<div
		data-puck
		class="absolute top-1/2 left-1/2 grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-center leading-tight"
		style:width="{puck}px"
		style:height="{puck}px"
		style="background: radial-gradient(circle at 50% 40%, #157a4a, #0a5c36 72%); box-shadow: inset 0 0 36px rgba(0,0,0,0.45);"
	>
		<div class="text-white/85">
			{#if trump}
				<div class="text-2xl {isRedSuit(trump) ? 'text-red-400' : 'text-white'}">
					{SUIT_SYMBOL[trump]}
				</div>
				<div class="text-[9px] tracking-wide text-white/45 uppercase">trump</div>
			{/if}
			{#if doc.trick}
				<div class="mt-0.5 text-[11px] text-white/60">trick {doc.trick.number} / 6</div>
			{/if}
			<div class="text-[11px] text-white/45">{handPoints[0]} – {handPoints[1]} pts</div>
		</div>

		{#if learning}
			<span
				class="absolute right-0 bottom-0 rounded-full bg-amber-400 px-1 text-[8px] font-bold text-green-950 uppercase"
				title="Learning mode"
			>
				L
			</span>
		{/if}
	</div>

	{#each plays as play (play.seat)}
		{@const o = offsets[slot(play.seat)]}
		<div
			class="absolute top-1/2 left-1/2 transition-transform duration-200"
			class:trick-winner={winner === play.seat}
			style:transform="translate(-50%, -50%) translate({o.x}px, {o.y}px)"
		>
			<Card card={play.card} height={cardH} />
		</div>
	{/each}
</div>

<style>
	.trick-winner {
		filter: drop-shadow(0 0 8px rgba(74, 222, 128, 0.9));
		z-index: 1;
	}
	.trick-winner :global(.card) {
		outline: 2px solid rgba(74, 222, 128, 0.9);
		outline-offset: 1px;
	}
</style>
