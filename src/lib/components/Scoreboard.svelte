<script lang="ts">
	import { teamOf } from '$lib/clabber/state';
	import { SUIT_NAME } from '$lib/cards/display';
	import type { GameStore } from '$lib/repo/gameStore.svelte';
	import type { HandResult } from '$lib/clabber/types';

	let { store, onNextHand }: { store: GameStore; onNextHand?: () => void } = $props();

	const doc = $derived(store.doc);
	const mySeat = $derived(store.mySeat);
	const myTeam = $derived(mySeat != null ? teamOf(mySeat) : 0);
	const running = $derived(doc?.score.running ?? [0, 0]);
	// "We" / "They" are relative to the local player's team; a spectator has no
	// side, so they see neutral team labels.
	const usLabel = $derived(mySeat != null ? 'We' : 'Team A');
	const themLabel = $derived(mySeat != null ? 'They' : 'Team B');
	const us = $derived(running[myTeam]);
	const them = $derived(running[myTeam ^ 1]);

	const hands = $derived(doc?.score.hands ?? []);
	const last = $derived(hands.at(-1));
	const showModal = $derived(doc?.phase === 'handScored' && last != null);

	// Tap the bar to open the full breakdown any time.
	let open = $state(false);

	function makerLabel(r: HandResult): string {
		if (mySeat == null) return r.maker === 0 ? 'Team A' : 'Team B';
		return r.maker === myTeam ? 'We' : 'They';
	}
</script>

<div class="flex flex-col items-end gap-1">
	<button
		onclick={() => (open = !open)}
		class="rounded-xl bg-green-950/80 px-3 py-2 text-sm ring-1 ring-white/10 hover:ring-white/30"
		aria-expanded={open}
		title="Show the full score sheet"
	>
		<span class="font-semibold">{usLabel} {us}</span>
		<span class="text-white/40"> — </span>
		<span class="font-semibold">{themLabel} {them}</span>
		<span class="ml-1 text-[11px] text-white/40">to 500</span>
		<span class="ml-1 text-white/40">{open ? '▴' : '▾'}</span>
	</button>

	{#if open}
		<div
			class="w-72 max-w-[calc(100vw-1.5rem)] rounded-xl bg-green-950/95 p-3 text-sm ring-1 ring-white/15"
		>
			<div class="mb-2 flex items-baseline justify-between">
				<span class="font-semibold">Score sheet</span>
				<span class="text-[11px] text-white/40">first to 500</span>
			</div>
			{#if hands.length === 0}
				<p class="text-white/45">No hands played yet.</p>
			{:else}
				<div class="max-h-64 overflow-y-auto">
					<table class="w-full text-xs tabular-nums">
						<thead class="text-white/40">
							<tr>
								<th class="text-left font-normal">#</th>
								<th class="text-left font-normal">Trump</th>
								<th class="text-left font-normal">Made</th>
								<th class="text-right font-normal">{usLabel}</th>
								<th class="text-right font-normal">{themLabel}</th>
							</tr>
						</thead>
						<tbody>
							{#each hands as h, i (i)}
								<tr class="border-t border-white/5">
									<td class="py-1 text-white/50">{i + 1}</td>
									<td class="py-1">{SUIT_NAME[h.trump]}</td>
									<td class="py-1 text-white/60"
										>{makerLabel(h)}{h.set ? ' · set' : ''}{h.renege ? ' · renege' : ''}</td
									>
									<td class="py-1 text-right">{h.awarded[myTeam]}</td>
									<td class="py-1 text-right">{h.awarded[myTeam ^ 1]}</td>
								</tr>
							{/each}
						</tbody>
						<tfoot>
							<tr class="border-t border-white/15 font-semibold">
								<td class="py-1" colspan="3">Total</td>
								<td class="py-1 text-right">{us}</td>
								<td class="py-1 text-right">{them}</td>
							</tr>
						</tfoot>
					</table>
				</div>
			{/if}
		</div>
	{/if}
</div>

{#if showModal && last}
	<div class="fixed inset-0 z-30 grid place-items-center bg-black/50 p-4">
		<div class="w-full max-w-sm rounded-2xl bg-green-950 p-6 text-white ring-1 ring-white/15">
			<h2 class="mb-1 text-lg font-bold">{last.renege ? 'Renege!' : 'Hand scored'}</h2>
			<p class="mb-4 text-sm text-white/60">
				{#if last.renege}
					A player reneged — the other team takes 162 plus their meld.
				{:else}
					{makerLabel(last)} made {SUIT_NAME[last.trump]}{last.set ? ' — and went set.' : '.'}
				{/if}
			</p>

			<table class="w-full text-sm">
				<thead class="text-white/40">
					<tr>
						<th class="text-left font-normal"></th>
						<th class="text-right font-normal">{usLabel}</th>
						<th class="text-right font-normal">{themLabel}</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td class="py-0.5 text-white/60">Tricks</td>
						<td class="text-right">{last.trickPoints[myTeam]}</td>
						<td class="text-right">{last.trickPoints[myTeam ^ 1]}</td>
					</tr>
					<tr>
						<td class="py-0.5 text-white/60">Meld</td>
						<td class="text-right">{last.meldPoints[myTeam]}</td>
						<td class="text-right">{last.meldPoints[myTeam ^ 1]}</td>
					</tr>
					<tr class="border-t border-white/10 font-semibold">
						<td class="py-1">Awarded</td>
						<td class="text-right">{last.awarded[myTeam]}</td>
						<td class="text-right">{last.awarded[myTeam ^ 1]}</td>
					</tr>
					<tr class="text-white/70">
						<td class="py-0.5">Game</td>
						<td class="text-right">{last.runningAfter[myTeam]}</td>
						<td class="text-right">{last.runningAfter[myTeam ^ 1]}</td>
					</tr>
				</tbody>
			</table>

			{#if onNextHand}
				<button
					onclick={onNextHand}
					class="mt-5 w-full rounded-lg bg-green-500 py-2 font-semibold text-green-950 hover:bg-green-400"
				>
					Continue
				</button>
				<p class="mt-2 text-center text-[11px] text-white/35">
					(the table deals the next hand automatically in a few seconds)
				</p>
			{/if}
		</div>
	</div>
{/if}
