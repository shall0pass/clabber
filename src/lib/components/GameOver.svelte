<script lang="ts">
	import { teamOf } from '$lib/clabber/state';
	import type { GameStore } from '$lib/repo/gameStore.svelte';

	// Phase 6 replaces the emoji with fireworks / tears.
	let { store }: { store: GameStore } = $props();

	const doc = $derived(store.doc);
	const mySeat = $derived(store.mySeat);
	const winner = $derived(doc?.winner ?? null);
	const iWon = $derived(mySeat != null && winner != null && teamOf(mySeat) === winner);
	const running = $derived(doc?.score.running ?? [0, 0]);

	function playAgain() {
		store.tryChange({ type: 'ResetToLobby' });
	}
</script>

{#if winner != null}
	<div class="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4 text-center text-white">
		<div class="rounded-2xl bg-green-950 p-8 ring-1 ring-white/15">
			<div class="text-6xl">{iWon ? '🎆' : mySeat != null ? '😢' : '🏁'}</div>
			<h2 class="mt-3 text-2xl font-bold">
				{#if mySeat == null}
					Team {winner} wins
				{:else if iWon}
					Your team wins!
				{:else}
					Your team lost
				{/if}
			</h2>
			<p class="mt-1 text-sm text-white/60">
				Final: {running[0]} – {running[1]}
			</p>
			<button
				onclick={playAgain}
				class="mt-6 rounded-lg bg-green-500 px-6 py-2 font-semibold text-green-950 hover:bg-green-400"
			>
				Play again
			</button>
		</div>
	</div>
{/if}
