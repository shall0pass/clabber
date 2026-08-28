<script lang="ts">
	import Card from './Card.svelte';

	let {
		count = 0,
		height = 52,
		overlap = 0.55
	}: {
		/** number of face-down cards to show */
		count?: number;
		height?: number;
		/** fraction of a card width to overlap neighbours */
		overlap?: number;
	} = $props();

	const width = $derived(height * (64 / 89));
	const step = $derived(width * (1 - overlap));
	const indexes = $derived(Array.from({ length: Math.max(0, count) }, (_, i) => i));
</script>

<div
	class="relative"
	style:height="{height}px"
	style:width="{indexes.length ? step * (indexes.length - 1) + width : 0}px"
>
	{#each indexes as i (i)}
		<div class="absolute top-0" style:left="{i * step}px">
			<Card faceDown {height} />
		</div>
	{/each}
</div>
