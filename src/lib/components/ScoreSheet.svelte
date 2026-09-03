<script lang="ts">
	import { SUIT_NAME } from '$lib/cards/display';
	import type { HandResult } from '$lib/clabber/types';

	let {
		hands,
		myTeam,
		spectator,
		usLabel,
		themLabel,
		us,
		them
	}: {
		hands: HandResult[];
		myTeam: 0 | 1;
		spectator: boolean;
		usLabel: string;
		themLabel: string;
		us: number;
		them: number;
	} = $props();

	function makerLabel(r: HandResult): string {
		if (spectator) return r.maker === 0 ? 'Team A' : 'Team B';
		return r.maker === myTeam ? 'We' : 'They';
	}
</script>

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
