<script lang="ts">
	import Card from './Card.svelte';
	import { classifyMeld } from '$lib/clabber/meld';
	import { sortHand } from '$lib/clabber/cards';
	import { SUIT_SYMBOL, cardTag } from '$lib/cards/display';
	import type { GameStore } from '$lib/repo/gameStore.svelte';
	import type { Card as CardT, MeldKind, Seat, Suit } from '$lib/clabber/types';

	let { store, height = 44 }: { store: GameStore; height?: number } = $props();

	const doc = $derived(store.doc);
	const mySeat = $derived(store.mySeat);
	const iPlayed = $derived(
		mySeat != null && (doc?.trick?.plays.some((p) => p.seat === mySeat) ?? false)
	);
	const show = $derived(doc?.phase === 'meld' && mySeat != null && !iPlayed);

	const declared = $derived(mySeat != null ? (doc?.melds.declared[mySeat] ?? []) : []);
	const bellaMine = $derived(mySeat != null && doc?.melds.bella === mySeat);
	const myHand = $derived(
		show && doc && mySeat != null ? sortHand(doc.hands[mySeat], doc.trump) : ([] as CardT[])
	);

	let picking = $state(false);
	let chosen = $state<CardT[]>([]);
	let errorMsg = $state('');

	function openPicker() {
		picking = true;
		chosen = [];
		errorMsg = '';
	}
	function toggle(card: CardT) {
		chosen = chosen.includes(card) ? chosen.filter((c) => c !== card) : [...chosen, card];
		errorMsg = '';
	}

	const preview = $derived(doc ? classifyMeld(chosen, doc.trump) : null);

	function confirm() {
		if (mySeat == null) return;
		const ok = store.tryChange({ type: 'DeclareMeld', seat: mySeat as Seat, cards: chosen });
		if (ok) {
			picking = false;
			chosen = [];
			errorMsg = '';
		} else {
			errorMsg = 'Those cards don’t form a meld you can call.';
		}
	}

	const KIND_LABEL: Record<MeldKind, string> = {
		dad: 'Dad',
		fifty: 'Fifty',
		hundred: 'Hundred',
		twohundred: 'Two hundred',
		bella: 'Bella'
	};
	function describe(kind: MeldKind, suit: Suit | null): string {
		return `${KIND_LABEL[kind]}${suit ? ` ${SUIT_SYMBOL[suit]}` : ''}`;
	}
</script>

{#if show}
	<div
		class="flex w-full max-w-sm flex-col items-center gap-2 rounded-2xl bg-green-950/85 p-4 ring-1 ring-white/10"
	>
		{#if declared.length || bellaMine}
			<ul class="flex flex-wrap justify-center gap-1.5 text-xs">
				{#each declared as d (d.cards.join())}
					<li class="rounded bg-white/10 px-2 py-1">
						{describe(d.kind, d.suit)} · {d.cards.map(cardTag).join(' ')} · {d.points}
					</li>
				{/each}
				{#if bellaMine}
					<li class="rounded bg-white/10 px-2 py-1">Bella · 20</li>
				{/if}
			</ul>
		{/if}

		{#if !picking}
			<button
				onclick={openPicker}
				class="rounded-lg bg-amber-300 px-4 py-2 text-sm font-semibold text-green-950 hover:bg-amber-200"
			>
				Call meld
			</button>
			<div class="text-[11px] text-white/40">
				{declared.length || bellaMine
					? 'Call another, or play a card when you’re done.'
					: 'Or just play a card if you have no meld.'}
			</div>
		{:else}
			<div class="text-sm text-white/70">Tap the cards that make one meld:</div>
			<div class="flex flex-wrap justify-center gap-1">
				{#each myHand as card (card)}
					<button
						type="button"
						onclick={() => toggle(card)}
						aria-pressed={chosen.includes(card)}
						class="rounded-[8%] transition {chosen.includes(card)
							? '-translate-y-1 ring-2 ring-amber-300'
							: 'opacity-80 hover:opacity-100'}"
					>
						<Card {card} {height} />
					</button>
				{/each}
			</div>
			<div class="text-xs {preview ? 'text-amber-200' : 'text-white/40'}">
				{preview ? `${describe(preview.kind, preview.suit)} — ${preview.points}` : 'not a meld yet'}
			</div>
			{#if errorMsg}
				<div class="text-xs text-red-300">{errorMsg}</div>
			{/if}
			<div class="flex gap-2">
				<button
					onclick={() => (picking = false)}
					class="rounded-lg bg-white/10 px-4 py-1.5 text-sm font-semibold hover:bg-white/20"
				>
					Cancel
				</button>
				<button
					onclick={confirm}
					disabled={!preview}
					class="rounded-lg bg-amber-300 px-4 py-1.5 text-sm font-semibold text-green-950 hover:bg-amber-200 disabled:opacity-40"
				>
					Call
				</button>
			</div>
		{/if}
	</div>
{/if}
