import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-static';
import { defineConfig } from 'vite';

export default defineConfig({
	// Expose PUBLIC_* variables (.env or process env) to client code via import.meta.env.
	envPrefix: 'PUBLIC_',
	plugins: [
		sveltekit({
			adapter: adapter({ fallback: '200.html' }),
			// Kit 3 dropped the implicit $lib alias; the app (and the chain-layer
			// interface) import from `$lib/...`, so keep it explicitly.
			alias: { $lib: 'src/lib' }
		})
	]
});
