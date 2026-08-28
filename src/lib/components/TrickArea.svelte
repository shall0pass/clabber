<script lang="ts">
	import Card from './Card.svelte';
	import { SUIT_SYMBOL, isRedSuit } from '$lib/cards/display';
	import type { GameDoc, Seat } from '$lib/clabber/types';

	let {
		doc,
		baseSeat = 0,
		handPoints = [0, 0],
		scale = 1,
		winner = null
	}: {
		doc: GameDoc;
		/** the seat rendered at the bottom of the table */
		baseSeat?: Seat;
		/** trick points banked so far this hand, [team0, team1] */
		handPoints?: [number, number];
		/** shrink factor for small screens */
		scale?: number;
		/** while a finished trick is held on screen, the seat that took it */
		winner?: Seat | null;
	} = $props();

	const felt = $derived(Math.round(150 * scale));
	const cardH = $derived(Math.round(52 * scale));

	// Each played card sits just outside the felt circle so it never covers the
	// trump / trick / score text in the middle. slot: 0 bottom, 1 left, 2 top,
	// 3 right.
	const SLOT_POS = [
		'left-1/2 bottom-0 -translate-x-1/2 translate-y-[58%]',
		'top-1/2 left-0 -translate-y-1/2 -translate-x-[58%]',
		'left-1/2 top-0 -translate-x-1/2 -translate-y-[58%]',
		'top-1/2 right-0 -translate-y-1/2 translate-x-[58%]'
	];
	function slot(seat: Seat) {
		return (seat - baseSeat + 4) % 4;
	}

	const plays = $derived(doc.trick?.plays ?? []);
	const trump = $derived(doc.trump);
</script>

<div class="relative grid place-items-center" style:width="{felt}px" style:height="{felt}px">
	<div
		class="grid aspect-square w-full place-items-center rounded-full text-center leading-tight"
		style="background: radial-gradient(circle at 50% 40%, #157a4a, #0a5c36 72%); box-shadow: inset 0 0 36px rgba(0,0,0,0.4);"
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
	</div>

	{#each plays as play (play.seat)}
		<div
			class="absolute transition-transform duration-200 {SLOT_POS[slot(play.seat)]}"
			class:trick-winner={winner === play.seat}
		>
			<Card card={play.card} height={cardH} />
		</div>
	{/each}
</div>

<style>
	.trick-winner {
		scale: 1.12;
		filter: drop-shadow(0 0 8px rgba(74, 222, 128, 0.9));
		z-index: 1;
	}
</style>
