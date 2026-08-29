<script lang="ts">
	import { coachSections } from '$lib/clabber/coach';
	import type { GameStore } from '$lib/repo/gameStore.svelte';

	let { store }: { store: GameStore } = $props();

	const doc = $derived(store.doc);
	const mySeat = $derived(store.mySeat);
	const sections = $derived(doc ? coachSections(doc, mySeat) : []);

	// Per-player and per-tab: the shared doc only says the coach is available,
	// each player opens or closes it for themselves.
	const OPEN_KEY = 'clabber:coach-open';
	let open = $state(readOpen());
	function readOpen(): boolean {
		try {
			return localStorage.getItem(OPEN_KEY) === '1';
		} catch {
			return false;
		}
	}
	function toggle() {
		open = !open;
		try {
			localStorage.setItem(OPEN_KEY, open ? '1' : '0');
		} catch {
			/* ignore */
		}
	}
</script>

<!-- Bottom-left, above the log toggle. Chat lives in the bottom-right corner, so
     the two never collide. -->
<div class="fixed bottom-2 left-2 z-30 flex flex-col items-start gap-2">
	{#if open}
		<div
			class="max-h-[65vh] w-80 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-2xl bg-green-950/95 p-4 text-left ring-1 ring-white/15"
		>
			<div class="mb-2 flex items-center justify-between gap-3">
				<h2 class="text-sm font-bold tracking-wide text-amber-200">Training coach</h2>
				<button
					onclick={toggle}
					class="rounded px-1.5 text-white/50 hover:text-white"
					aria-label="Close training coach">✕</button
				>
			</div>
			{#each sections as section (section.title)}
				<section class="mb-3 last:mb-0">
					<h3 class="text-xs font-semibold text-white/90">{section.title}</h3>
					<ul class="mt-1 space-y-1 text-[12px] leading-snug text-white/70">
						{#each section.points as point, i (i)}
							<li class="flex gap-1.5">
								<span aria-hidden="true" class="text-amber-300/70">•</span><span>{point}</span>
							</li>
						{/each}
					</ul>
				</section>
			{/each}
		</div>
	{/if}

	<!-- `mb-9` keeps this clear of the log toggle sitting in the same corner. -->
	<button
		onclick={toggle}
		aria-expanded={open}
		class="mb-9 rounded-full bg-amber-300 px-3 py-1.5 text-sm font-semibold text-green-950 shadow-lg ring-1 ring-black/10 hover:bg-amber-200"
	>
		{open ? 'Hide help' : '🎓 Learn'}
	</button>
</div>
