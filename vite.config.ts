import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
	plugins: [
		tailwindcss(),
		// Automerge ships its core as WebAssembly; this lets Vite load it in the
		// browser bundle and in the dev server. (Vite 8 / rolldown handles the
		// top-level await in Automerge's ESM entry natively.)
		wasm(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// The game is a fully client-side SPA (Automerge/wasm is browser-only),
			// deployed as a static site. `fallback` makes every route serve the
			// client shell so client-side routing takes over.
			adapter: adapter({ fallback: 'index.html' }),

			typescript: {
				config: (config) => {
					config.include.push('../drizzle.config.ts');
				}
			}
		})
	],
	optimizeDeps: {
		// Keep the wasm core external — Vite's pre-bundler can't handle it — but
		// DO pre-bundle automerge-repo and its adapters so their CommonJS deps
		// (eventemitter3, cbor-x, …) get proper ESM interop in the browser and
		// in the browser test runner.
		exclude: ['@automerge/automerge'],
		include: [
			'@automerge/automerge-repo',
			'@automerge/automerge-repo-network-websocket',
			'@automerge/automerge-repo-storage-indexeddb'
		]
	},
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},

			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
