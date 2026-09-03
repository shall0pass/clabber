<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import {
		listOpenGames,
		normaliseCode,
		registryAvailable,
		type OpenGame
	} from '$lib/repo/directory';
	import { JOIN_CODES_SUPPORTED } from '$lib/repo/repo';
	import { createNewGame, joinExistingGame, type GameStore } from '$lib/repo/gameStore.svelte';

	let { onjoined }: { onjoined: (store: GameStore) => void } = $props();

	let code = $state('');
	let busy = $state(false);
	let error = $state('');
	let listPublicly = $state(false);
	let openGames = $state<OpenGame[]>([]);
	let openGamesLoaded = $state(false);

	// Show the "secret code" box only when short join codes actually work: a
	// custom relay build (trusted outright) or a probe that finds the
	// same-origin `/games/:code` registry. On the public Automerge relay with
	// no registry there is nothing to type there, so it stays hidden.
	let codesUsable = $state(JOIN_CODES_SUPPORTED);
	let pollTimer: ReturnType<typeof setInterval> | undefined;

	async function refreshOpenGames() {
		openGames = await listOpenGames();
		openGamesLoaded = true;
	}

	onMount(async () => {
		if (!codesUsable && (await registryAvailable())) codesUsable = true;
		if (!codesUsable) return;
		await refreshOpenGames();
		pollTimer = setInterval(refreshOpenGames, 8000);
	});
	onDestroy(() => clearInterval(pollTimer));

	async function join() {
		error = '';
		busy = true;
		try {
			const store = await joinExistingGame(code);
			if (store) onjoined(store);
			else error = `No game with code "${normaliseCode(code)}".`;
		} catch {
			error = 'Could not reach the game server.';
		} finally {
			busy = false;
		}
	}

	async function joinOpen(g: OpenGame) {
		error = '';
		busy = true;
		try {
			const store = await joinExistingGame(g.code);
			if (store) onjoined(store);
			else error = 'That game is no longer available.';
		} catch {
			error = 'Could not reach the game server.';
		} finally {
			busy = false;
		}
	}

	async function create() {
		error = '';
		busy = true;
		try {
			onjoined(await createNewGame({ listed: listPublicly }));
		} catch {
			error = 'Could not create a game.';
		} finally {
			busy = false;
		}
	}
</script>

<div class="flex min-h-screen items-center justify-center bg-green-900 p-6 text-white">
	<div class="w-full max-w-sm rounded-2xl bg-green-950/60 p-8 shadow-xl ring-1 ring-white/10">
		<h1 class="mb-1 text-center text-3xl font-bold tracking-wide">Clabber</h1>
		<p class="mb-6 text-center text-sm text-white/60">
			{#if codesUsable}
				Enter your friends' secret code to join.
			{:else}
				Start a game, then share the invite link with your friends.
			{/if}
		</p>

		{#if codesUsable && openGamesLoaded}
			<div class="mb-5">
				<p class="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
					Games looking for players
				</p>
				{#if openGames.length > 0}
					<ul class="flex flex-col gap-2">
						{#each openGames as g (g.code)}
							<li
								class="flex items-center justify-between gap-3 rounded-lg bg-white/10 px-3 py-2 text-sm"
							>
								<span class="min-w-0">
									<span class="block truncate font-semibold">{g.host || 'A game'}</span>
									<span class="text-white/50">{g.seats}/4 seated</span>
								</span>
								<button
									onclick={() => joinOpen(g)}
									disabled={busy}
									class="shrink-0 rounded-md bg-green-500 px-3 py-1.5 text-xs font-semibold text-green-950 transition hover:bg-green-400 disabled:opacity-40"
								>
									Join
								</button>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="rounded-lg bg-white/5 px-3 py-2 text-sm text-white/40">
						No public games waiting right now.
					</p>
				{/if}
			</div>
		{/if}

		{#if codesUsable}
			<form
				onsubmit={(e) => {
					e.preventDefault();
					join();
				}}
			>
				<input
					bind:value={code}
					oninput={() => (code = code.toUpperCase())}
					placeholder="SECRET CODE"
					autocomplete="off"
					autocapitalize="characters"
					spellcheck="false"
					class="w-full rounded-lg border-0 bg-white/10 px-4 py-3 text-center text-lg font-semibold tracking-[0.3em] text-white uppercase placeholder:tracking-normal placeholder:text-white/30 focus:ring-2 focus:ring-green-400 focus:outline-none"
				/>
				<button
					type="submit"
					disabled={busy || normaliseCode(code).length < 4}
					class="mt-3 w-full rounded-lg bg-green-500 py-3 font-semibold text-green-950 transition hover:bg-green-400 disabled:cursor-not-allowed disabled:opacity-40"
				>
					Join game
				</button>
			</form>

			<div class="my-5 flex items-center gap-3 text-xs text-white/40">
				<span class="h-px flex-1 bg-white/15"></span>or<span class="h-px flex-1 bg-white/15"></span>
			</div>
		{/if}

		<button
			onclick={create}
			disabled={busy}
			class="w-full rounded-lg py-3 font-semibold transition disabled:opacity-40 {codesUsable
				? 'bg-white/10 hover:bg-white/20'
				: 'bg-green-500 text-green-950 hover:bg-green-400'}"
		>
			Start a new game
		</button>

		{#if codesUsable}
			<label class="mt-3 flex cursor-pointer items-center gap-2 text-xs text-white/50">
				<input type="checkbox" class="h-3.5 w-3.5 accent-green-400" bind:checked={listPublicly} />
				List this game so anyone can join
			</label>
		{/if}

		{#if error}
			<p class="mt-4 text-center text-sm text-red-300">{error}</p>
		{/if}

		<p class="mt-6 text-center text-[11px] leading-snug text-white/35">
			{#if codesUsable}
				Friendly game: everyone's cards live in the shared data, so don't go poking at it.
			{:else}
				Already have an invite link? Just open it. Friendly game: everyone's cards live in the
				shared data, so don't go poking at it.
			{/if}
		</p>
	</div>
</div>
