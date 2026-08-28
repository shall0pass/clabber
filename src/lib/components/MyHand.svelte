<script lang="ts">
	import Card from './Card.svelte';
	import type { Card as CardT } from '$lib/clabber/types';

	let {
		cards,
		legal = [],
		active = false,
		advanced = false,
		height = 118,
		onplay
	}: {
		/** already sorted for display */
		cards: CardT[];
		/** the subset that may be played right now */
		legal?: CardT[];
		/** whether it is this player's turn to play a card */
		active?: boolean;
		/** Advanced mode: every card in hand is playable (an illegal one reneges) */
		advanced?: boolean;
		height?: number;
		onplay?: (card: CardT) => void;
	} = $props();

	const legalSet = $derived(new Set(legal));
	const width = $derived(height * (64 / 89));
	const step = $derived(width * 0.62);

	function playable(c: CardT) {
		return active && (advanced || legalSet.has(c));
	}
	function reneging(c: CardT) {
		return active && advanced && !legalSet.has(c);
	}

	// When it becomes this player's turn, move keyboard focus to the first
	// playable card so it can be played without reaching for the mouse.
	let container = $state<HTMLDivElement>();
	let wasActive = false;
	$effect(() => {
		if (active && !wasActive) {
			container?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
		}
		wasActive = active;
	});
</script>

<div
	bind:this={container}
	class="relative mx-auto"
	style:height="{height + 18}px"
	style:width="{cards.length ? step * (cards.length - 1) + width : 0}px"
	role="group"
	aria-label="your hand"
>
	{#each cards as card, i (card)}
		<button
			type="button"
			class="absolute bottom-0 rounded-[6%] transition-all duration-150 focus:outline-none
				{playable(card)
				? 'cursor-pointer hover:-translate-y-4 focus-visible:-translate-y-4 focus-visible:ring-2 focus-visible:ring-amber-300'
				: active
					? 'cursor-not-allowed opacity-40'
					: 'cursor-default'}
				{reneging(card) ? 'ring-2 ring-red-500/70' : ''}"
			style:left="{i * step}px"
			disabled={!playable(card)}
			aria-label={reneging(card) ? `${card} (renege)` : card}
			onclick={() => onplay?.(card)}
		>
			<Card {card} {height} />
		</button>
	{/each}
</div>
