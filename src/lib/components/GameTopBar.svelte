<script lang="ts">
	import Scoreboard from './Scoreboard.svelte';
	import LeaveButton from './LeaveButton.svelte';
	import type { GameStore } from '$lib/repo/gameStore.svelte';

	let { store, onleave }: { store: GameStore; onleave: () => void } = $props();
</script>

<!-- One flex row across the top of the table. The "Leave table" control and the
     score pill used to be two independent `absolute` islands; on a narrow
     screen (iPhone SE) the score panel — wider and higher in the stack — opened
     straight over the Leave button and buried it. As flex siblings they can
     never overlap: the Leave button holds its width (`shrink-0`), the score
     column shrinks and, if it still can't fit, wraps to its own line. -->
<div class="absolute inset-x-3 top-3 z-20 flex flex-wrap items-start justify-between gap-2">
	<div class="shrink-0">
		<LeaveButton {onleave} />
	</div>
	<div class="ml-auto min-w-0">
		<Scoreboard {store} />
	</div>
</div>
