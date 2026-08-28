<script lang="ts">
	import { onMount } from 'svelte';
	import { dev } from '$app/environment';
	import JoinScreen from '$lib/components/JoinScreen.svelte';
	import Lobby from '$lib/components/Lobby.svelte';
	import { GameStore, joinExistingGame } from '$lib/repo/gameStore.svelte';
	import { Presence } from '$lib/repo/presence.svelte';
	import { Host } from '$lib/repo/host';

	let store = $state<GameStore | undefined>(undefined);
	let presence = $state<Presence | undefined>(undefined);
	let host = $state<Host | undefined>(undefined);
	let booting = $state(true);
	let bootError = $state('');

	function attach(s: GameStore) {
		store = s;
		// Put the code in the URL fragment so a reload rejoins the same game.
		// Fragment-only, so it never triggers a navigation or the SvelteKit router.
		if (location.hash.slice(1) !== s.code) {
			location.replace(`${location.pathname}${location.search}#${s.code}`);
		}
		const p = new Presence(s.handle, s.clientId);
		p.start();
		presence = p;

		const h = new Host(s, p);
		h.start();
		host = h;

		if (dev) {
			(globalThis as Record<string, unknown>).__clabber = { store: s, presence: p, host: h };
		}
	}

	onMount(() => {
		const code = location.hash.replace(/^#+/, '');
		if (code) {
			joinExistingGame(code)
				.then((s) => {
					if (s) attach(s);
					else bootError = `No game with code "${code}".`;
				})
				.catch(() => (bootError = 'Could not reach the game server.'))
				.finally(() => (booting = false));
		} else {
			booting = false;
		}

		return () => {
			host?.stop();
			presence?.stop();
		};
	});

	const phase = $derived(store?.doc?.phase);
</script>

{#if booting}
	<div class="grid min-h-screen place-items-center bg-green-900 text-white/70">joining…</div>
{:else if store && presence}
	{#if phase === 'lobby'}
		<Lobby {store} {presence} />
	{:else}
		<div class="grid min-h-screen place-items-center bg-green-900 p-6 text-center text-white">
			<div>
				<p class="text-lg font-semibold">Game in progress</p>
				<p class="text-sm text-white/60">
					Phase: {phase}. The table view arrives in a later step.
				</p>
				{#if host?.isHost}
					<p class="mt-2 text-xs text-white/40">You're running the computer players.</p>
				{/if}
			</div>
		</div>
	{/if}
{:else}
	<JoinScreen onjoined={attach} />
	{#if bootError}
		<p class="bg-green-900 pb-6 text-center text-sm text-red-300">{bootError}</p>
	{/if}
{/if}
