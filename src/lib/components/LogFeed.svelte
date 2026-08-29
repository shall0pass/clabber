<script lang="ts">
	import { teamOf } from '$lib/clabber/state';
	import { SUIT_NAME, cardTag } from '$lib/cards/display';
	import type { PlayerSlot, Seat, Suit } from '$lib/clabber/types';

	let {
		log = [],
		players = [],
		mySeat = null
	}: { log?: string[]; players?: (PlayerSlot | null)[]; mySeat?: Seat | null } = $props();

	let open = $state(false);

	function teamName(n: number): string {
		if (mySeat == null) return n === 0 ? 'Team A' : 'Team B';
		return teamOf(mySeat) === n ? 'your team' : 'the other team';
	}

	function humanise(line: string): string {
		return line
			.replace(/seat (\d)/g, (_, n) => players[Number(n)]?.name ?? `seat ${n}`)
			.replace(/team (\d)/g, (_, n) => teamName(Number(n)))
			.replace(/makes ([SHDC]) trump/g, (_, s) => `makes ${SUIT_NAME[s as Suit]} trump`)
			.replace(/up-card ([AKQJT9][SHDC])/g, (_, c) => `up-card ${cardTag(c)}`);
	}
	const recent = $derived(log.slice(-14).map(humanise));
</script>

<div class="fixed bottom-2 left-2 z-20 text-[11px]">
	<button
		onclick={() => (open = !open)}
		class="rounded bg-green-950/70 px-2 py-1 text-white/60 ring-1 ring-white/10 hover:text-white"
		aria-expanded={open}
	>
		{open ? 'Hide log' : 'Log'}
	</button>
	{#if open}
		<ul
			class="mt-1 max-h-44 w-64 overflow-y-auto rounded bg-green-950/85 p-2 leading-snug text-white/70 ring-1 ring-white/10"
		>
			{#each recent as line, i (i)}
				<li class="py-0.5">{line}</li>
			{/each}
		</ul>
	{/if}
</div>
