<script lang="ts">
	import type { MeldKind, PlayerSlot, Suit } from '$lib/clabber/types';
	import type { SeatMeldStatus } from '$lib/clabber/meld';
	import { hasMeld } from '$lib/clabber/meld';
	import { SUIT_SYMBOL, isRedSuit } from '$lib/cards/display';

	let {
		player = null,
		relation = 'opponent',
		side = 'top',
		isDealer = false,
		isMaker = false,
		trump = null,
		isTurn = false,
		isThinking = false,
		justWon = false,
		online = true,
		lastBid = '',
		tricks = 0,
		meld = null,
		compact = false,
		rotated = false
	}: {
		player?: PlayerSlot | null;
		relation?: 'you' | 'partner' | 'opponent';
		/** which edge of the table this plate sits on */
		side?: 'top' | 'bottom' | 'left' | 'right';
		isDealer?: boolean;
		/** this seat named trump this hand */
		isMaker?: boolean;
		/** the trump suit, for the "made" chip symbol */
		trump?: Suit | null;
		isTurn?: boolean;
		isThinking?: boolean;
		/** briefly true right after this player takes a trick */
		justWon?: boolean;
		online?: boolean;
		/** "pass" / "♠" / "" — shown during bidding. */
		lastBid?: string;
		/** tricks this player's team has taken this hand. */
		tricks?: number;
		/** this seat's meld situation, surfaced to the whole table for the hand. */
		meld?: SeatMeldStatus | null;
		/** Short landscape's top band (plan §4): the partner plate moves in here
		 *  full-time, and space is tight enough that the DEAL/MADE/meld badge
		 *  row is dropped entirely rather than reserved — unlike the other
		 *  plates, whose badge row is always reserved (see below) so their
		 *  height never depends on game state. Dropping it here is still a
		 *  constant (never conditional on state), so it's equally jitter-safe. */
		compact?: boolean;
		/** a left/right plate turned sideways (narrow portrait — Table's
		 *  `sideSeatsVertical`), so a long name runs vertically */
		rotated?: boolean;
	} = $props();

	// Persistent meld badge: every player sees that a seat has a meld from the
	// moment it's called (count only — not the suit), and the actual meld once
	// it's been shown on trick two. This is the durable backstop for the
	// transient "shows meld" reveal, which can be missed.
	const KIND_SHORT: Record<MeldKind, string> = {
		dad: 'dad',
		fifty: '50',
		hundred: '100',
		twohundred: '200',
		bella: 'bella'
	};
	const meldChip = $derived.by(() => {
		if (!meld || !hasMeld(meld)) return null;
		if (meld.shown.length > 0) {
			const kinds = meld.shown.map((c) => KIND_SHORT[c.kind]).join('+');
			return `${kinds}${meld.bella ? '+bella' : ''} · ${meld.shownPoints}`;
		}
		if (meld.forfeited) return 'meld —';
		const bits: string[] = [];
		if (meld.declaredCount === 1) bits.push('meld');
		else if (meld.declaredCount > 1) bits.push(`meld ×${meld.declaredCount}`);
		if (meld.bella) bits.push('bella');
		return bits.join(' · ');
	});

	const ringColor = $derived(
		isTurn ? 'ring-amber-300' : relation === 'partner' ? 'ring-sky-400/60' : 'ring-white/10'
	);

	// On a narrow portrait screen the left/right plates are turned sideways and
	// sit outboard of the cards, so a long name has vertical room instead of
	// being squeezed into a tiny horizontal pill. Table decides (from the
	// viewport's shape, not just its width: a short landscape phone below
	// 640px wide has the width for upright plates but not the height for
	// sideways ones).
	const vertical = $derived(side === 'left' || side === 'right');
	const turned = $derived(rotated && vertical);
	const rotClass = $derived(!turned ? '' : side === 'left' ? '-rotate-90' : 'rotate-90');
</script>

<div
	class={turned
		? 'grid w-12 place-items-center'
		: vertical
			? 'grid max-w-full min-w-0 place-items-center'
			: 'contents'}
>
	<div
		data-plate
		class="flex max-w-full min-w-0 flex-col items-center gap-1 rounded-2xl bg-green-950/80 px-3 py-1.5 text-sm ring-2 {ringColor} {rotClass}
			{turned ? 'max-w-none px-2 py-1' : ''}
			{isTurn ? 'shadow-[0_0_16px_rgba(252,211,77,0.5)]' : ''}"
		class:won={justWon}
	>
		<!-- DEAL / MADE / meld chips get their own row above the name — always
		     rendered (never `hidden`), except in `compact`'s top-band usage
		     where it's dropped altogether (see the prop doc) — so the plate's
		     height is the same whether or not a badge is showing. Follow-up
		     pass: a chip appearing here used to be a genuine height change that
		     the middle row's `ResizeObserver` measurement would otherwise treat
		     as "the leftover shrank", which would jitter the trick area's size
		     mid-hand — see docs/table-jitter-plan.md. `invisible` keeps the
		     reserved height without painting anything. -->
		{#if !compact}
			<div
				class="flex flex-wrap items-center justify-center gap-1 {isDealer || isMaker || meldChip
					? ''
					: 'invisible'}"
			>
				{#if !isDealer && !isMaker && !meldChip}
					<span class="rounded-full px-1.5 text-[10px] font-extrabold">DEAL</span>
				{/if}
				{#if isDealer}
					<span
						class="shrink-0 rounded-full bg-amber-400 px-1.5 text-[10px] font-extrabold tracking-wide text-green-950"
						title="dealer">DEAL</span
					>
				{/if}

				{#if isMaker}
					<span
						class="flex shrink-0 items-center gap-0.5 rounded-full bg-white px-1.5 text-[10px] font-extrabold tracking-wide text-green-950"
						title="named trump"
					>
						MADE
						{#if trump}
							<span class={isRedSuit(trump) ? 'text-red-600' : 'text-black'}
								>{SUIT_SYMBOL[trump]}</span
							>
						{/if}
					</span>
				{/if}

				{#if meldChip}
					<span
						class="shrink-0 rounded-full bg-amber-400/90 px-1.5 text-[10px] font-bold whitespace-nowrap text-green-950"
						title="meld called this hand"
					>
						{meldChip}
					</span>
				{/if}
			</div>
		{/if}

		<div class="flex max-w-full min-w-0 items-center gap-1.5">
			<span
				class="inline-block h-2 w-2 shrink-0 rounded-full {online ? 'bg-green-400' : 'bg-white/25'}"
			></span>

			{#if player?.isBot}
				<svg viewBox="0 0 24 24" class="h-3.5 w-3.5 shrink-0 text-white/60" fill="currentColor">
					<path
						d="M12 2a1 1 0 0 1 1 1v1h3a3 3 0 0 1 3 3v2h1a1 1 0 1 1 0 2h-1v4a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3v-4H4a1 1 0 1 1 0-2h1V7a3 3 0 0 1 3-3h3V3a1 1 0 0 1 1-1Zm-2 9a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm4 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z"
					/>
				</svg>
			{/if}

			<span
				class="truncate font-semibold {turned
					? 'max-w-36'
					: vertical
						? 'max-w-32'
						: 'max-w-32 sm:max-w-44'}">{player?.name ?? 'empty'}</span
			>

			{#if isThinking}
				<!-- a fixed 8px dot, not the word "thinking…", so the plate doesn't
				     grow and shrink every second as the turn walks the table -->
				<span
					class="inline-block h-2 w-2 shrink-0 rounded-full bg-amber-300 motion-safe:animate-pulse"
					title="thinking"
				></span>
			{:else if lastBid}
				<span class="text-xs text-white/70">{lastBid}</span>
			{/if}

			{#if tricks > 0}
				<span class="ml-auto text-[11px] whitespace-nowrap text-white/45"
					>{tricks} {tricks === 1 ? 'trick' : 'tricks'}</span
				>
			{/if}
		</div>
	</div>
</div>

<style>
	.won {
		animation: wonpulse 0.8s ease-out;
	}
	@keyframes wonpulse {
		0% {
			box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.7);
		}
		100% {
			box-shadow: 0 0 0 14px rgba(74, 222, 128, 0);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.won {
			animation: none;
		}
	}
</style>
