<script lang="ts">
	import { teamOf } from '$lib/clabber/state';
	import Fireworks from './Fireworks.svelte';
	import Tears from './Tears.svelte';
	import ScoreSheet from './ScoreSheet.svelte';
	import type { GameStore } from '$lib/repo/gameStore.svelte';

	let { store }: { store: GameStore } = $props();

	const doc = $derived(store.doc);
	const mySeat = $derived(store.mySeat);
	const winner = $derived(doc?.winner ?? null);
	const iWon = $derived(mySeat != null && winner != null && teamOf(mySeat) === winner);
	const iLost = $derived(mySeat != null && winner != null && !iWon);
	const running = $derived(doc?.score.running ?? [0, 0]);

	// Same per-round breakdown the top-bar score pill shows, offered here because
	// the game-over overlay sits above (and hides) that pill.
	const myTeam = $derived(mySeat != null ? teamOf(mySeat) : 0);
	const usLabel = $derived(mySeat != null ? 'We' : 'Team A');
	const themLabel = $derived(mySeat != null ? 'They' : 'Team B');
	const hands = $derived(doc?.score.hands ?? []);
	let showSheet = $state(false);

	function playAgain() {
		store.tryChange({ type: 'ResetToLobby' });
	}
</script>

{#if winner != null}
	{#if iLost}
		<Tears />
	{:else}
		<Fireworks />
	{/if}

	<div class="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4 text-center text-white">
		<div
			class="max-h-[90vh] overflow-y-auto rounded-2xl bg-green-950/95 p-8 shadow-2xl ring-1 ring-white/15"
		>
			<h2 class="text-3xl font-bold">
				{#if mySeat == null}
					Team {winner + 1} wins
				{:else if iWon}
					We won! 🎉
				{:else}
					We lost
				{/if}
			</h2>
			<p class="mt-2 text-sm text-white/60">Final: {running[0]} – {running[1]}</p>

			<button
				onclick={() => (showSheet = !showSheet)}
				class="mt-4 rounded-lg px-3 py-1 text-xs font-semibold text-white/70 ring-1 ring-white/20 hover:text-white hover:ring-white/40"
				aria-expanded={showSheet}
			>
				{showSheet ? 'Hide round scores' : 'Review round scores'}
			</button>

			{#if showSheet}
				<div
					class="mx-auto mt-3 w-72 max-w-full rounded-xl bg-green-950 p-3 text-left ring-1 ring-white/10"
				>
					<ScoreSheet
						{hands}
						{myTeam}
						spectator={mySeat == null}
						{usLabel}
						{themLabel}
						us={running[myTeam]}
						them={running[myTeam ^ 1]}
					/>
				</div>
			{/if}

			<button
				onclick={playAgain}
				class="mt-6 rounded-lg bg-green-500 px-6 py-2 font-semibold text-green-950 hover:bg-green-400"
			>
				Play again
			</button>
		</div>
	</div>
{/if}
