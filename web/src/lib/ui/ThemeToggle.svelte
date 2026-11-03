<script lang="ts">
	import Icon from './Icon.svelte';
	import { setTheme, theme } from './theme.svelte';

	const next = $derived(theme.value === 'dark' ? 'light' : 'dark');
</script>

<button
	type="button"
	class="toggle"
	onclick={() => setTheme(next)}
	aria-label="Switch to {next} theme"
	title="Switch to {next} theme"
>
	<span class="i" class:show={theme.value === 'light'}><Icon name="moon" size={16} /></span>
	<span class="i" class:show={theme.value === 'dark'}><Icon name="sun" size={16} /></span>
</button>

<style>
	.toggle {
		position: relative;
		display: grid;
		place-items: center;
		width: 34px;
		height: 34px;
		border-radius: var(--radius-md);
		color: var(--text-2);
		transition:
			background-color var(--dur-1),
			color var(--dur-1);
	}
	.toggle:hover {
		background: var(--surface-sunken);
		color: var(--text);
	}
	.i {
		grid-area: 1 / 1;
		display: inline-flex;
		opacity: 0;
		transform: rotate(-60deg) scale(0.6);
		transition:
			opacity var(--dur-2) var(--ease-out),
			transform var(--dur-3) var(--ease-out);
	}
	.i.show {
		opacity: 1;
		transform: none;
	}
</style>
