<script lang="ts">
	import Card from './Card.svelte';
	import { SUIT_SYMBOL, isRedSuit } from '$lib/cards/display';
	import type { GameDoc, Seat } from '$lib/clabber/types';

	let {
		doc,
		baseSeat = 0,
		handPoints = [0, 0],
		scale = 1
	}: {
		doc: GameDoc;
		/** the seat rendered at the bottom of the table */
		baseSeat?: Seat;
		/** trick points banked so far this hand, [team0, team1] */
		handPoints?: [number, number];
		/** shrink factor for small screens */
		scale?: number;
	} = $props();

	// screen slot for a seat: 0 bottom, 1 left, 2 top, 3 right
	const SLOT_POS = [
		'bottom-1 left-1/2 -translate-x-1/2',
		'left-1 top-1/2 -translate-y-1/2',
		'top-1 left-1/2 -translate-x-1/2',
		'right-1 top-1/2 -translate-y-1/2'
	];
	function slot(seat: Seat) {
		return (seat - baseSeat + 4) % 4;
	}

	const plays = $derived(doc.trick?.plays ?? []);
	const trump = $derived(doc.trump);
</script>

<div
	class="relative grid aspect-square w-full place-items-center rounded-full text-center"
	style="max-width: {190 *
		scale}px; background: radial-gradient(circle at 50% 40%, #157a4a, #0a5c36 72%); box-shadow: inset 0 0 40px rgba(0,0,0,0.35);"
>
	<div class="text-white/85">
		{#if trump}
			<div class="text-3xl {isRedSuit(trump) ? 'text-red-400' : 'text-white'}">
				{SUIT_SYMBOL[trump]}
			</div>
			<div class="text-[11px] tracking-wide text-white/50 uppercase">trump</div>
		{/if}
		{#if doc.trick}
			<div class="mt-1 text-xs text-white/60">trick {doc.trick.number} / 6</div>
		{/if}
		<div class="mt-1 text-[11px] text-white/45">{handPoints[0]} – {handPoints[1]} pts</div>
	</div>

	{#each plays as play (play.seat)}
		<div class="absolute {SLOT_POS[slot(play.seat)]}">
			<Card card={play.card} height={Math.round(58 * scale)} />
		</div>
	{/each}
</div>
