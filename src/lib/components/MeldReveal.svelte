<script lang="ts">
	import Card from './Card.svelte';
	import { SEATS, teamOf } from '$lib/clabber/state';
	import { selectBestMelds } from '$lib/clabber/meld';
	import { SUIT_SYMBOL } from '$lib/cards/display';
	import type { GameStore } from '$lib/repo/gameStore.svelte';
	import type { MeldClaim, MeldKind, Seat } from '$lib/clabber/types';

	let { store }: { store: GameStore } = $props();

	const doc = $derived(store.doc);
	const mySeat = $derived(store.mySeat);
	const open = $derived(doc?.phase === 'meldReveal');

	const KIND_LABEL: Record<MeldKind, string> = {
		dad: 'Dad',
		fifty: 'Fifty',
		hundred: 'Hundred',
		twohundred: 'Two hundred',
		bella: 'Bella'
	};
	function describe(c: MeldClaim): string {
		return `${KIND_LABEL[c.kind]}${c.suit ? ` ${SUIT_SYMBOL[c.suit]}` : ''}`;
	}

	const announcers = $derived(
		(SEATS as readonly Seat[]).filter((s) => {
			const d = doc?.melds.declared[s];
			return d != null && d.length > 0;
		})
	);

	function name(seat: Seat): string {
		if (seat === mySeat) return 'You';
		return doc?.players[seat]?.name ?? `Seat ${seat + 1}`;
	}
	function seatTotal(seat: Seat): number {
		return selectBestMelds(doc?.melds.declared[seat] ?? []).sum;
	}

	const iOweAShow = $derived(
		mySeat != null &&
			(doc?.melds.declared[mySeat]?.length ?? 0) > 0 &&
			!(doc?.melds.shown[mySeat] ?? false)
	);

	const resolved = $derived(doc?.melds.resolved ?? false);
	const scoredTeam = $derived(doc?.melds.scoredTeam ?? null);
	function teamLabel(team: number): string {
		if (mySeat == null) return team === 0 ? 'Team A' : 'Team B';
		return teamOf(mySeat) === team ? 'Your team' : 'The other team';
	}
	const outcome = $derived.by(() => {
		if (!resolved || !doc) return '';
		const [a, b] = doc.melds.points;
		if (scoredTeam == null && a === 0 && b === 0) return 'No meld scores this hand.';
		if (scoredTeam == null)
			return `Push on the top meld — ${a === 0 ? teamLabel(1) : teamLabel(0)} still scores bella.`;
		return `${teamLabel(scoredTeam)} takes meld: ${doc.melds.points[scoredTeam]}.`;
	});

	function showMine() {
		if (mySeat != null) store.tryChange({ type: 'ShowMeld', seat: mySeat as Seat });
	}
	function done() {
		store.tryChange({ type: 'AdvanceMeldReveal' });
	}
</script>

{#if open && doc}
	<div class="fixed inset-0 z-30 grid place-items-center bg-black/55 p-4">
		<div
			class="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-green-950 p-5 text-white ring-1 ring-white/15"
		>
			<h2 class="text-lg font-bold">Meld</h2>
			<p class="mb-3 text-sm text-white/55">
				Each player who called meld shows it now. The best single meld wins it for that team.
			</p>

			<ul class="flex flex-col gap-2">
				{#each announcers as seat (seat)}
					{@const claims = doc.melds.declared[seat] ?? []}
					<li class="rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
						<div class="flex items-baseline justify-between">
							<span class="font-semibold">{name(seat)}</span>
							{#if doc.melds.shown[seat]}
								<span class="text-sm text-amber-200">{seatTotal(seat)}</span>
							{:else}
								<span class="text-xs text-white/40">hasn’t shown yet</span>
							{/if}
						</div>
						{#if doc.melds.shown[seat]}
							<div class="mt-2 flex flex-col gap-2">
								{#each claims as c (describe(c) + c.points)}
									<div class="flex items-center gap-2">
										<span class="w-16 shrink-0 text-xs text-white/60">{describe(c)}</span>
										<div class="flex gap-0.5">
											{#each c.cards as card (card)}
												<Card {card} height={40} />
											{/each}
										</div>
									</div>
								{/each}
							</div>
						{/if}
					</li>
				{/each}
			</ul>

			{#if outcome}
				<p class="mt-3 rounded-lg bg-amber-300/15 px-3 py-2 text-sm font-semibold text-amber-100">
					{outcome}
				</p>
			{/if}

			<div class="mt-4 flex flex-col gap-2">
				{#if iOweAShow}
					<button
						onclick={showMine}
						class="w-full rounded-lg bg-amber-300 py-2 font-semibold text-green-950 hover:bg-amber-200"
					>
						Show my meld
					</button>
				{/if}
				<button
					onclick={done}
					class="w-full rounded-lg py-2 font-semibold {iOweAShow
						? 'bg-white/10 hover:bg-white/20'
						: 'bg-green-500 text-green-950 hover:bg-green-400'}"
				>
					Continue
				</button>
			</div>
			<p class="mt-2 text-center text-[11px] text-white/35">
				(the table plays on automatically in a few seconds)
			</p>
		</div>
	</div>
{/if}
