<script lang="ts">
	import type { PlayerSlot } from '$lib/clabber/types';

	let {
		player = null,
		relation = 'opponent',
		isDealer = false,
		isTurn = false,
		isThinking = false,
		online = true,
		lastBid = '',
		tricks = 0
	}: {
		player?: PlayerSlot | null;
		relation?: 'you' | 'partner' | 'opponent';
		isDealer?: boolean;
		isTurn?: boolean;
		isThinking?: boolean;
		online?: boolean;
		/** "pass" / "♠" / "" — shown during bidding. */
		lastBid?: string;
		/** tricks this player's team has taken this hand. */
		tricks?: number;
	} = $props();

	const ringColor = $derived(
		isTurn ? 'ring-amber-300' : relation === 'partner' ? 'ring-sky-400/60' : 'ring-white/10'
	);
</script>

<div
	class="flex items-center gap-2 rounded-full bg-green-950/80 px-3 py-1.5 text-sm ring-2 {ringColor} {isTurn
		? 'shadow-[0_0_16px_rgba(252,211,77,0.5)]'
		: ''}"
>
	<span class="inline-block h-2 w-2 shrink-0 rounded-full {online ? 'bg-green-400' : 'bg-white/25'}"
	></span>

	{#if player?.isBot}
		<svg viewBox="0 0 24 24" class="h-3.5 w-3.5 shrink-0 text-white/60" fill="currentColor">
			<path
				d="M12 2a1 1 0 0 1 1 1v1h3a3 3 0 0 1 3 3v2h1a1 1 0 1 1 0 2h-1v4a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3v-4H4a1 1 0 1 1 0-2h1V7a3 3 0 0 1 3-3h3V3a1 1 0 0 1 1-1Zm-2 9a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm4 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z"
			/>
		</svg>
	{/if}

	<span class="max-w-[8rem] truncate font-semibold">{player?.name ?? 'empty'}</span>

	{#if isDealer}
		<span
			class="rounded bg-white/15 px-1 text-[10px] font-bold tracking-wide text-white/70"
			title="dealer">D</span
		>
	{/if}

	{#if isThinking}
		<span class="text-xs text-amber-300">thinking…</span>
	{:else if lastBid}
		<span class="text-xs text-white/70">{lastBid}</span>
	{/if}

	{#if tricks > 0}
		<span class="ml-auto text-[11px] text-white/45"
			>{tricks} {tricks === 1 ? 'trick' : 'tricks'}</span
		>
	{/if}
</div>
