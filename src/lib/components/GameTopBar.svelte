<script lang="ts">
	import Scoreboard from './Scoreboard.svelte';
	import LeaveButton from './LeaveButton.svelte';
	import type { Snippet } from 'svelte';
	import type { GameStore } from '$lib/repo/gameStore.svelte';

	let {
		store,
		onleave,
		center
	}: {
		store: GameStore;
		onleave: () => void;
		/** short landscape (plan §4): the partner plate moves in here instead of
		 *  its own row, so there's no chrome above the trick area besides this
		 *  one band. */
		center?: Snippet;
	} = $props();
</script>

<!-- One flex row across the top of the table, in normal flow (plan §3: not
     `absolute`) so it reserves its own height instead of floating over
     whatever's first in the table's flow — on a narrow portrait phone that
     used to be the partner plate, and the two collided. The "Leave table"
     control and the score pill used to be two independent `absolute` islands;
     on a narrow screen (iPhone SE) the score panel — wider and higher in the
     stack — opened straight over the Leave button and buried it. As flex
     siblings they can never overlap: the Leave button holds its width
     (`shrink-0`), the score column shrinks and, if it still can't fit, wraps
     to its own line.

     The Learning-mode indicator does NOT live in this row (follow-up pass):
     it used to be a badge here, but a badge is one more thing that can push
     this row to two lines at a narrow width with a wide score, and this row
     must stay one line at every width. It's a small chip on the trick-area
     puck instead (`TrickArea`'s `learning` prop) — a fixed-size element that
     can't wrap. -->
<div data-top-band class="relative z-20 flex w-full flex-wrap items-start justify-between gap-2">
	<div class="flex shrink-0 items-center gap-2">
		<LeaveButton {onleave} />
	</div>
	{#if center}
		<div class="flex min-w-0 flex-1 items-center justify-center">
			{@render center()}
		</div>
	{/if}

	<div class="ml-auto min-w-0">
		<Scoreboard {store} />
	</div>
</div>
