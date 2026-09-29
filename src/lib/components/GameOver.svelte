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

	<!-- Tighter padding/margins in short landscape (plan §7) so this fits
	     667×375 with the score sheet closed — `max-h`+`overflow-y-auto` stays
	     as a safety net only. `pb-22` keeps the bottom strip, where the corner
	     toggles dock while a dialog is up, clear of the dialog. -->
	<div
		class="fixed inset-0 z-50 grid place-items-center bg-black/45 px-2 pt-2 pb-22 text-center text-white short-landscape:px-1 short-landscape:pt-1"
	>
		<div
			data-game-over-modal
			class="max-h-[calc(100dvh-6rem)] overflow-y-auto rounded-2xl bg-green-950/95 p-4 shadow-2xl ring-1 ring-white/15 sm:p-8 short-landscape:p-3"
		>
			<h2 class="text-3xl font-bold short-landscape:text-xl">
				{#if mySeat == null}
					Team {winner + 1} wins
				{:else if iWon}
					We won! 🎉
				{:else}
					We lost
				{/if}
			</h2>
			<p class="mt-2 text-sm text-white/60 short-landscape:mt-1">
				Final: {running[0]} – {running[1]}
			</p>

			<button
				onclick={() => (showSheet = !showSheet)}
				class="mt-4 rounded-lg px-3 py-1 text-xs font-semibold text-white/70 ring-1 ring-white/20 hover:text-white hover:ring-white/40 short-landscape:mt-2"
				aria-expanded={showSheet}
			>
				{showSheet ? 'Hide round scores' : 'Review round scores'}
			</button>

			{#if showSheet}
				<div
					class="mx-auto mt-3 w-72 max-w-full rounded-xl bg-green-950 p-3 text-left ring-1 ring-white/10 short-landscape:max-h-32 short-landscape:overflow-y-auto"
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
				class="mt-6 rounded-lg bg-green-500 px-6 py-2 font-semibold text-green-950 hover:bg-green-400 short-landscape:mt-3"
			>
				Play again
			</button>
		</div>
	</div>
{/if}
