<script lang="ts">
	import Icon from './Icon.svelte';
	import { copyText } from './copy';

	let {
		value,
		label = 'Copy',
		size = 14,
		showLabel = false
	}: { value: string; label?: string; size?: number; showLabel?: boolean } = $props();

	let copied = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;

	async function onclick(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		const ok = await copyText(value);
		if (!ok) return;
		copied = true;
		clearTimeout(timer);
		timer = setTimeout(() => (copied = false), 1600);
	}
</script>

<button type="button" class="copy" class:copied class:with-label={showLabel} {onclick} aria-label={copied ? 'Copied' : label}>
	<span class="ico" aria-hidden="true">
		<span class="a"><Icon name="copy" {size} /></span>
		<span class="b"><Icon name="check" {size} stroke={2.25} /></span>
	</span>
	{#if showLabel}<span class="txt">{copied ? 'Copied' : label}</span>{/if}
	<span class="visually-hidden" aria-live="polite">{copied ? 'Copied to clipboard' : ''}</span>
</button>

<style>
	.copy {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		min-width: 26px;
		height: 26px;
		padding: 0 5px;
		border-radius: var(--radius-sm);
		color: var(--text-3);
		transition:
			color var(--dur-1) var(--ease-out),
			background-color var(--dur-1) var(--ease-out);
	}
	.copy:hover {
		color: var(--text);
		background: var(--surface-sunken);
	}
	.copy.with-label {
		padding: 0 8px;
		font-size: var(--text-sm);
		font-weight: 500;
	}
	.copied {
		color: var(--clean);
	}
	.copied:hover {
		color: var(--clean);
	}
	.ico {
		position: relative;
		display: inline-grid;
	}
	.ico > span {
		grid-area: 1 / 1;
		display: inline-flex;
		transition:
			opacity var(--dur-2) var(--ease-out),
			transform var(--dur-2) var(--ease-out);
	}
	.b {
		opacity: 0;
		transform: scale(0.6);
	}
	.copied .a {
		opacity: 0;
		transform: scale(0.6);
	}
	.copied .b {
		opacity: 1;
		transform: none;
	}
</style>
