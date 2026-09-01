<script lang="ts">
	import { onMount } from 'svelte';
	import confetti from 'canvas-confetti';

	let canvas = $state<HTMLCanvasElement>();

	const reduceMotion =
		typeof window !== 'undefined' &&
		window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

	const COLORS = ['#ffd700', '#ff5ebc', '#5ec8ff', '#a0ff7a', '#ff8a3d', '#ffffff'];

	onMount(() => {
		if (reduceMotion || !canvas) return;

		const fire = confetti.create(canvas, { resize: true, useWorker: true });
		const rand = (a: number, b: number) => a + Math.random() * (b - a);

		// side volleys — big spherical bursts from the top corners
		const burst = (intensity: number) => {
			for (const side of [rand(0.06, 0.3), rand(0.7, 0.94)]) {
				fire({
					particleCount: Math.round(70 * intensity),
					startVelocity: 42,
					spread: 360,
					ticks: 200,
					gravity: 1,
					decay: 0.92,
					scalar: rand(0.9, 1.4),
					colors: COLORS,
					origin: { x: side, y: rand(0.05, 0.4) }
				});
			}
		};

		// rockets — a shell fired straight up from the floor that opens overhead
		const rocket = () => {
			fire({
				particleCount: 110,
				startVelocity: 58,
				spread: 78,
				ticks: 220,
				gravity: 1.1,
				decay: 0.91,
				scalar: 1.1,
				colors: COLORS,
				origin: { x: rand(0.3, 0.7), y: 0.95 }
			});
		};

		const started = Date.now();
		let tick = 0;
		let timer: ReturnType<typeof setTimeout>;
		const loop = () => {
			const elapsed = Date.now() - started;
			const intense = elapsed < 4500;
			burst(intense ? 1 : 0.45);
			if (intense && tick % 2 === 0) rocket();
			tick++;
			timer = setTimeout(loop, intense ? 230 : 1100);
		};
		loop();

		return () => {
			clearTimeout(timer);
			fire.reset();
		};
	});
</script>

{#if reduceMotion}
	<div
		class="pointer-events-none fixed inset-0 z-60 flex items-start justify-center pt-20 text-6xl"
		aria-hidden="true"
	>
		🎆✨🎇
	</div>
{:else}
	<canvas
		bind:this={canvas}
		class="pointer-events-none fixed inset-0 z-60 h-full w-full"
		aria-hidden="true"
	></canvas>
{/if}
