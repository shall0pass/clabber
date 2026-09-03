<script lang="ts">
	import { SEATS, teamOf } from '$lib/clabber/state';
	import { SUIT_NAME } from '$lib/cards/display';
	import { CARD_RATIO } from '$lib/cards/sprite';
	import Card from './Card.svelte';
	import ScoreSheet from './ScoreSheet.svelte';
	import type { GameStore } from '$lib/repo/gameStore.svelte';
	import type { HandResult, Seat } from '$lib/clabber/types';

	let { store }: { store: GameStore } = $props();

	// A trick's four cards fill the width of whatever box they're shown in
	// (the renege breakdown), rather than using a size guessed for one screen.
	const TRICK_CARD_GAP = 4; // px — matches `gap-1`
	let trickRowWidth = $state(0);
	const trickCardHeight = $derived(
		trickRowWidth > 0 ? (trickRowWidth - TRICK_CARD_GAP * 3) / (4 * CARD_RATIO) : 80
	);

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

	// Everyone must press Continue before `StartHand` will deal the next hand
	// (see `doc.handAcks`); the host presses it for bot seats.
	const acks = $derived(doc?.handAcks ?? [false, false, false, false]);
	const iAcked = $derived(mySeat != null && acks[mySeat]);
	const waitingOn = $derived(
		(SEATS as readonly Seat[])
			.filter((s) => !acks[s])
			.map((s) => doc?.players[s]?.name ?? `seat ${s}`)
	);
	function ackHand() {
		if (mySeat != null) store.tryChange({ type: 'AckHand', seat: mySeat });
	}

	// One more chance to call a renege while everyone reviews the breakdown —
	// same rule as during play: freely in Advanced mode, or only a real
	// uncalled renege from the other team outside it.
	const advanced = $derived(doc?.advanced ?? false);
	const uncalledOppRenege = $derived(
		doc?.renege != null &&
			!doc.renege.called &&
			mySeat != null &&
			teamOf(doc.renege.seat) !== teamOf(mySeat)
	);
	const mayCallRenege = $derived(mySeat != null && (advanced || uncalledOppRenege));
	let pendingRenege = $state(false);
	function callRenege() {
		if (mySeat != null) store.tryChange({ type: 'CallRenege', seat: mySeat });
		pendingRenege = false;
	}
</script>

<div class="relative flex min-w-0 flex-col items-end gap-1">
	<button
		onclick={() => (open = !open)}
		class="max-w-full overflow-hidden rounded-xl bg-green-950/80 px-3 py-2 text-sm whitespace-nowrap ring-1 ring-white/10 hover:ring-white/30"
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
		<!-- Escapes layout as a dropdown so it never widens the top bar, and is
		     capped so its left edge always clears the "Leave table" button. -->
		<div
			class="absolute top-full right-0 z-30 mt-1 w-72 max-w-[calc(100vw-7rem)] rounded-xl bg-green-950/95 p-3 text-sm shadow-xl ring-1 ring-white/15"
		>
			<div class="mb-2 flex items-baseline justify-between">
				<span class="font-semibold">Score sheet</span>
				<span class="text-[11px] text-white/40">first to 500</span>
			</div>
			<ScoreSheet {hands} {myTeam} spectator={mySeat == null} {usLabel} {themLabel} {us} {them} />
		</div>
	{/if}
</div>

{#if showModal && last}
	<div class="fixed inset-0 z-30 grid place-items-center bg-black/50 p-2 sm:p-4">
		<div
			class="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-2xl bg-green-950 p-4 text-white ring-1 ring-white/15 sm:p-6"
		>
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

			{#if last.renege && doc}
				{@const callerName = doc.players[doc.renegeCalledBy ?? 0]?.name ?? 'a player'}
				{@const offenderName = doc.renege
					? (doc.players[doc.renege.seat]?.name ?? 'a player')
					: null}
				<div class="mt-4 rounded-lg bg-red-950/60 p-3 ring-1 ring-red-400/30">
					<p class="text-xs text-red-100">
						Renege called by <strong class="text-amber-300">{callerName}</strong>{#if offenderName}
							&nbsp;on <strong>{offenderName}</strong>{/if}.
					</p>
					{#if doc.trickHistory.length}
						<p class="mt-2 mb-1 text-[10px] tracking-wide text-white/40 uppercase">
							All tricks this hand, in order
						</p>
						<div bind:clientWidth={trickRowWidth}>
							<!-- One column per seat, so a seat's plays read straight down. -->
							<div class="mb-1 grid grid-cols-4 gap-1">
								{#each SEATS as seat (seat)}
									<span class="truncate text-center text-[9px] text-white/40"
										>{doc.players[seat]?.name ?? `seat ${seat}`}</span
									>
								{/each}
							</div>
							<div class="flex flex-col gap-2">
								{#each doc.trickHistory as trick, i (i)}
									<div>
										<p class="mb-0.5 text-[9px] text-white/35">Trick {i + 1}</p>
										<div class="grid grid-cols-4 gap-1">
											{#each trick.bySeat as card, seat (seat)}
												<div class="flex justify-center" class:opacity-50={seat !== trick.winner}>
													<Card {card} height={trickCardHeight} />
												</div>
											{/each}
										</div>
									</div>
								{/each}
							</div>
						</div>
					{/if}
				</div>
			{/if}

			{#if mayCallRenege}
				{#if !pendingRenege}
					<button
						onclick={() => (pendingRenege = true)}
						class="mt-5 w-full rounded-lg bg-red-500/15 py-1.5 text-xs font-semibold text-red-200 ring-1 ring-red-400/40 hover:bg-red-500/25"
					>
						Call renege
					</button>
				{:else}
					<div
						class="mt-5 flex flex-col items-center gap-2 rounded-xl bg-red-950/90 px-4 py-3 text-center ring-1 ring-red-400/60"
					>
						<p class="text-xs text-red-100">
							{#if advanced}
								Call a renege on the other team? If they didn't break a rule, the penalty falls on
								your team instead.
							{:else}
								Call the renege on the other team? Your team takes 162 plus any meld and the hand is
								re-scored.
							{/if}
						</p>
						<div class="flex gap-2">
							<button
								onclick={() => (pendingRenege = false)}
								class="rounded-lg bg-white/10 px-3 py-1 text-xs font-semibold hover:bg-white/20"
							>
								Cancel
							</button>
							<button
								onclick={callRenege}
								class="rounded-lg bg-red-500 px-3 py-1 text-xs font-semibold text-white hover:bg-red-400"
							>
								Call renege
							</button>
						</div>
					</div>
				{/if}
			{/if}

			{#if mySeat != null}
				<button
					onclick={ackHand}
					disabled={iAcked}
					class="mt-5 w-full rounded-lg bg-green-500 py-2 font-semibold text-green-950 hover:bg-green-400 disabled:cursor-not-allowed disabled:opacity-60"
				>
					{iAcked ? 'Waiting for the table…' : 'Continue'}
				</button>
			{/if}
			{#if waitingOn.length}
				<p class="mt-2 text-center text-[11px] text-white/35">
					Waiting on {waitingOn.join(', ')} to press Continue.
				</p>
			{/if}
		</div>
	</div>
{/if}
