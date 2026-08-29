<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import { detectMelds, selectBestMelds } from '$lib/clabber/meld';
	import { SUIT_SYMBOL, cardTag } from '$lib/cards/display';
	import type { GameStore } from '$lib/repo/gameStore.svelte';
	import type { MeldClaim, MeldKind, Seat } from '$lib/clabber/types';

	let { store }: { store: GameStore } = $props();

	const doc = $derived(store.doc);
	const mySeat = $derived(store.mySeat);
	const iPlayed = $derived(
		mySeat != null && (doc?.trick?.plays.some((p) => p.seat === mySeat) ?? false)
	);
	const alreadyDeclared = $derived(mySeat != null && doc?.melds.declared[mySeat] != null);
	const show = $derived(doc?.phase === 'meld' && mySeat != null && !iPlayed && !alreadyDeclared);

	const claims = $derived(
		show && doc && mySeat != null ? detectMelds(doc.hands[mySeat], doc.trump) : []
	);

	// Everything starts selected; picking a subset is what "call your specific
	// meld" means. We track the *unticked* ones by a stable key, so a new hand's
	// candidates (different keys) come back fully selected with no reset.
	const keyOf = (c: MeldClaim) => `${c.kind}:${c.suit ?? ''}:${c.cards.join('')}`;
	const unpicked = new SvelteSet<string>();
	function toggle(c: MeldClaim) {
		const k = keyOf(c);
		if (unpicked.has(k)) unpicked.delete(k);
		else unpicked.add(k);
	}
	function isPicked(c: MeldClaim) {
		return !unpicked.has(keyOf(c));
	}

	const chosen = $derived(claims.filter(isPicked));
	const total = $derived(selectBestMelds(chosen).sum);

	const KIND_LABEL: Record<MeldKind, string> = {
		dad: 'Dad',
		fifty: 'Fifty',
		hundred: 'Hundred',
		twohundred: 'Two hundred',
		bella: 'Bella'
	};
	function describe(c: MeldClaim): string {
		const where = c.suit ? SUIT_SYMBOL[c.suit] : '';
		return `${KIND_LABEL[c.kind]} ${where}`.trim();
	}
	function cards(c: MeldClaim): string {
		return c.cards.map(cardTag).join(' ');
	}

	function announce() {
		if (mySeat != null) {
			store.tryChange({ type: 'AnnounceMeld', seat: mySeat as Seat, claims: chosen });
		}
	}
</script>

{#if show}
	<div
		class="flex flex-col items-center gap-2 rounded-2xl bg-green-950/85 p-4 ring-1 ring-white/10"
	>
		{#if claims.length}
			<div class="text-sm text-white/70">Call your meld before you play:</div>
			<ul class="flex w-full max-w-xs flex-col gap-1.5 text-xs">
				{#each claims as c (keyOf(c))}
					<li>
						<label
							class="flex cursor-pointer items-center gap-2 rounded-lg bg-white/5 px-3 py-2 ring-1 ring-white/10"
						>
							<input
								type="checkbox"
								class="h-4 w-4 accent-amber-400"
								checked={isPicked(c)}
								onchange={() => toggle(c)}
							/>
							<span class="font-semibold">{describe(c)}</span>
							<span class="text-white/45">{cards(c)}</span>
							<span class="ml-auto text-amber-200 tabular-nums">{c.points}</span>
						</label>
					</li>
				{/each}
			</ul>
			<button
				onclick={announce}
				disabled={chosen.length === 0}
				class="rounded-lg bg-amber-300 px-4 py-2 text-sm font-semibold text-green-950 hover:bg-amber-200 disabled:opacity-40"
			>
				Announce {total}
			</button>
			<div class="text-[11px] text-white/40">…or just play a card to claim nothing.</div>
		{:else}
			<div class="text-sm text-white/55">No meld this hand — play when ready.</div>
		{/if}
	</div>
{/if}
