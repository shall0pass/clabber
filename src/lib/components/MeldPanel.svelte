<script lang="ts">
	import { classifyMeld } from '$lib/clabber/meld';
	import { SUIT_SYMBOL, cardTag } from '$lib/cards/display';
	import type { GameStore } from '$lib/repo/gameStore.svelte';
	import type { Card as CardT, MeldKind, Seat, Suit } from '$lib/clabber/types';

	// Selection lives in `MyHand` itself now (plan §5) so the player can see the
	// led card while picking — this panel is a one-line bar. `chosen` is owned
	// by the caller (Table), which also feeds it to MyHand's `selecting` mode;
	// this is presentation only, the player still picks every card and presses
	// Call, and the reducer still validates. No auto-detection or suggestion of
	// a meld — see CLAUDE.md "players do the work".
	let {
		store,
		picking = false,
		chosen = [],
		onopen,
		oncancel,
		onconfirm
	}: {
		store: GameStore;
		picking?: boolean;
		chosen?: CardT[];
		onopen?: () => void;
		oncancel?: () => void;
		onconfirm?: () => void;
	} = $props();

	const doc = $derived(store.doc);
	const mySeat = $derived(store.mySeat);
	const iPlayed = $derived(
		mySeat != null && (doc?.trick?.plays.some((p) => p.seat === mySeat) ?? false)
	);
	const show = $derived(doc?.phase === 'meld' && mySeat != null && !iPlayed);

	const declared = $derived(mySeat != null ? (doc?.melds.declared[mySeat] ?? []) : []);
	const bellaMine = $derived(mySeat != null && doc?.melds.bella === mySeat);

	let errorMsg = $state('');

	function openPicker() {
		errorMsg = '';
		onopen?.();
	}

	const preview = $derived(doc && chosen.length ? classifyMeld(chosen, doc.trump) : null);

	function confirm() {
		if (mySeat == null) return;
		const ok = store.tryChange({ type: 'DeclareMeld', seat: mySeat as Seat, cards: chosen });
		if (ok) {
			errorMsg = '';
			onconfirm?.();
		} else {
			errorMsg = 'Those cards don’t form a meld you can call.';
		}
	}

	function cancel() {
		errorMsg = '';
		oncancel?.();
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
	<!-- Narrow (`w-fit`), always (follow-up pass): meld can be called mid-trick,
	     unlike bidding, so this bar overlays a trick area that may already have
	     played cards on it — staying only as wide as its content needs keeps it
	     clear of the side cards and the puck (scripts/layout-check.mjs checks
	     this); what it can reach above the status slot is only my own card
	     slot, still empty while this shows. -->
	<div
		class="flex w-fit max-w-[90vw] flex-col items-center gap-1 rounded-2xl bg-green-950/85 px-4 py-1.5 ring-1 ring-white/10"
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
			<div class="flex flex-wrap items-center justify-center gap-2">
				<button
					onclick={openPicker}
					class="rounded-lg bg-amber-300 px-4 py-1.5 text-sm font-semibold text-green-950 hover:bg-amber-200"
				>
					Call meld
				</button>
				<span class="text-[11px] text-white/40">
					{declared.length || bellaMine
						? 'Call another, or play a card when you’re done.'
						: 'Or just play a card if you have no meld.'}
				</span>
			</div>
		{:else}
			<!-- One line at every width from 320px: the instruction until a card is
			     picked, then the live preview in its place, then Cancel / Call
			     (`flex-nowrap`; only the text truncates). The cards themselves are
			     tapped in the real hand below, not drawn here, so the led card
			     stays visible while picking. The full sentence is there for a
			     screen reader via `title`. An error gets its own line above. -->
			{#if errorMsg}
				<span class="text-xs text-red-300">{errorMsg}</span>
			{/if}
			<div
				class="flex max-w-full flex-nowrap items-center justify-center gap-2 text-xs"
				title="Tap the cards that make one meld"
				data-meld-controls
			>
				<span class="min-w-0 truncate {preview ? 'text-amber-200' : 'text-white/70'}">
					{#if preview}
						{describe(preview.kind, preview.suit)} — {preview.points}
					{:else if chosen.length}
						not a meld yet
					{:else}
						Tap your meld cards
					{/if}
				</span>
				<button
					onclick={cancel}
					class="shrink-0 rounded-lg bg-white/10 px-3 py-1 text-xs font-semibold hover:bg-white/20"
				>
					Cancel
				</button>
				<button
					onclick={confirm}
					disabled={!preview}
					class="shrink-0 rounded-lg bg-amber-300 px-3 py-1 text-xs font-semibold text-green-950 hover:bg-amber-200 disabled:opacity-40"
				>
					Call
				</button>
			</div>
		{/if}
	</div>
{/if}
