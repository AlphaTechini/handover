<script lang="ts">
	import { shortHex } from '$lib/chain';
	import CopyButton from './CopyButton.svelte';
	import Icon from './Icon.svelte';

	let {
		value,
		href,
		chars = 4,
		full = false,
		label,
		plain = false
	}: { value: string; href?: string; chars?: number; full?: boolean; label?: string; plain?: boolean } = $props();

	const shown = $derived(full ? value : value.startsWith('0x') ? shortHex(value, chars) : shortAccount(value));

	function shortAccount(a: string): string {
		return a.length > 24 ? `${a.slice(0, 12)}…${a.slice(-9)}` : a;
	}
</script>

<span class="chip" class:plain title={value}>
	<span class="mono val">{shown}</span>
	<CopyButton {value} label={label ? `Copy ${label}` : 'Copy'} size={13} />
	{#if href}
		<a class="ext" {href} target="_blank" rel="noreferrer noopener" aria-label="Open {label ?? value} in explorer">
			<Icon name="arrow-up-right" size={13} />
		</a>
	{/if}
</span>

<style>
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0;
		max-width: 100%;
		height: 28px;
		padding-left: 9px;
		padding-right: 1px;
		border: 1px solid var(--border);
		background: var(--surface-2);
		border-radius: var(--radius-sm);
		font-size: var(--text-sm);
		color: var(--text);
		vertical-align: middle;
	}
	.chip.plain {
		border-color: transparent;
		background: transparent;
		padding-left: 0;
	}
	.val {
		margin-right: 2px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}
	.ext {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		border-radius: var(--radius-sm);
		color: var(--text-3);
		transition:
			color var(--dur-1),
			background-color var(--dur-1);
	}
	.ext:hover {
		color: var(--text);
		background: var(--surface-sunken);
	}
</style>
