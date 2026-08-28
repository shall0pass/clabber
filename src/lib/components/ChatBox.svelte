<script lang="ts">
	import { tick } from 'svelte';
	import { partnerSeat, teamOf } from '$lib/clabber/state';
	import type { Seat } from '$lib/clabber/types';
	import type { GameStore } from '$lib/repo/gameStore.svelte';

	let { store }: { store: GameStore } = $props();

	const doc = $derived(store.doc);
	const messages = $derived(doc?.chat ?? []);
	const mySeat = $derived(store.mySeat);

	const NAME_KEY = 'clabber:name';
	function myName(): string {
		if (mySeat != null) return doc?.players[mySeat]?.name ?? 'Player';
		try {
			return localStorage.getItem(NAME_KEY)?.trim() || 'Spectator';
		} catch {
			return 'Spectator';
		}
	}

	let open = $state(false);
	let text = $state('');
	let list = $state<HTMLDivElement>();
	let lastReadTs = $state(0);

	const unread = $derived(
		open ? 0 : messages.filter((m) => m.ts > lastReadTs && m.from !== store.clientId).length
	);

	function nameTint(seat: Seat | null, from: string): string {
		if (from === store.clientId) return 'text-amber-300';
		if (seat == null) return 'text-white/45 italic';
		if (mySeat != null && (seat === mySeat || teamOf(seat) === teamOf(mySeat))) {
			return seat === partnerSeat(mySeat) ? 'text-sky-300' : 'text-sky-200';
		}
		return 'text-white/80';
	}

	function fmtTime(ts: number): string {
		try {
			return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
		} catch {
			return '';
		}
	}

	async function scrollDown() {
		await tick();
		if (list) list.scrollTop = list.scrollHeight;
	}

	function send() {
		const t = text.trim();
		if (!t) return;
		store.tryChange({
			type: 'SendChat',
			id: crypto.randomUUID(),
			from: store.clientId,
			name: myName(),
			seat: mySeat,
			text: t,
			ts: Date.now()
		});
		text = '';
		scrollDown();
	}

	function toggle() {
		open = !open;
		if (open) {
			lastReadTs = Date.now();
			scrollDown();
		}
	}

	// While the panel is open, follow new messages and treat them as read.
	$effect(() => {
		if (open && messages.length) {
			lastReadTs = Date.now();
			scrollDown();
		}
	});
</script>

<div class="fixed right-3 bottom-3 z-30 flex flex-col items-end">
	{#if open}
		<div
			class="mb-2 flex h-80 w-72 max-w-[calc(100vw-1.5rem)] flex-col rounded-xl bg-green-950/95 shadow-xl ring-1 ring-white/15"
		>
			<div class="flex items-center justify-between border-b border-white/10 px-3 py-2">
				<span class="text-sm font-semibold text-white/80">Table chat</span>
				<button onclick={toggle} class="px-1 text-white/40 hover:text-white" aria-label="Close chat"
					>✕</button
				>
			</div>

			<div
				bind:this={list}
				class="flex-1 space-y-1.5 overflow-y-auto px-3 py-2 text-[13px] leading-snug"
				aria-live="polite"
			>
				{#if messages.length === 0}
					<p class="text-white/35">No messages yet. Say hi 👋</p>
				{/if}
				{#each messages as m (m.id)}
					<div class="break-words">
						<span class="font-semibold {nameTint(m.seat, m.from)}">{m.name}</span>
						<span class="ml-1 text-[10px] text-white/25">{fmtTime(m.ts)}</span>
						<span class="ml-1 text-white/85">{m.text}</span>
					</div>
				{/each}
			</div>

			<form
				onsubmit={(e) => {
					e.preventDefault();
					send();
				}}
				class="flex gap-2 border-t border-white/10 p-2"
			>
				<input
					bind:value={text}
					maxlength="500"
					placeholder="Message…"
					aria-label="Chat message"
					autocomplete="off"
					class="min-w-0 flex-1 rounded-lg bg-white/10 px-3 py-1.5 text-sm placeholder:text-white/30 focus:ring-2 focus:ring-green-400 focus:outline-none"
				/>
				<button
					type="submit"
					disabled={!text.trim()}
					class="rounded-lg bg-green-500 px-3 py-1.5 text-sm font-semibold text-green-950 hover:bg-green-400 disabled:opacity-40"
				>
					Send
				</button>
			</form>
		</div>
	{/if}

	<button
		onclick={toggle}
		class="relative rounded-full bg-green-950/85 px-4 py-2 text-sm font-semibold text-white/80 ring-1 ring-white/15 hover:text-white"
		aria-expanded={open}
	>
		💬 Chat
		{#if unread > 0}
			<span
				class="absolute -top-1 -right-1 grid h-5 min-w-5 place-items-center rounded-full bg-red-500 px-1 text-[11px] font-bold text-white"
			>
				{unread > 9 ? '9+' : unread}
			</span>
		{/if}
	</button>
</div>
