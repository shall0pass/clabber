<script lang="ts">
	import Card from './Card.svelte';

	let {
		count = 0,
		height = 52,
		overlap = 0.55,
		vertical = false,
		reserve = 0
	}: {
		/** number of face-down cards to show */
		count?: number;
		height?: number;
		/** fraction of a card to overlap neighbours */
		overlap?: number;
		/** stack the cards top-to-bottom instead of left-to-right */
		vertical?: boolean;
		/** keep the footprint sized for this many cards even when fewer are shown,
		 *  so a seat's fan doesn't shrink (and drift) trick by trick */
		reserve?: number;
	} = $props();

	const cardW = $derived(height * (64 / 89));
	const stepX = $derived(cardW * (1 - overlap));
	const stepY = $derived(height * (1 - overlap));

	const shown = $derived(Math.max(0, count));
	const slots = $derived(Math.max(shown, reserve));
	const indexes = $derived(Array.from({ length: shown }, (_, i) => i));

	const span = (n: number) => (n === 0 ? 0 : stepX * (n - 1) + cardW);
	const spanV = (n: number) => (n === 0 ? 0 : stepY * (n - 1) + height);

	// Box is sized for `slots`; the `shown` cards are centred within it.
	const boxW = $derived(slots === 0 ? 0 : vertical ? cardW : span(slots));
	const boxH = $derived(slots === 0 ? 0 : vertical ? spanV(slots) : height);
	const offX = $derived(vertical ? 0 : (boxW - span(shown)) / 2);
	const offY = $derived(vertical ? (boxH - spanV(shown)) / 2 : 0);
</script>

<div class="relative" style:height="{boxH}px" style:width="{boxW}px">
	{#each indexes as i (i)}
		<div
			class="absolute"
			style:left={vertical ? '0' : `${offX + i * stepX}px`}
			style:top={vertical ? `${offY + i * stepY}px` : '0'}
		>
			<Card faceDown {height} />
		</div>
	{/each}
</div>
