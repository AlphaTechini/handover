<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		label,
		children,
		sub,
		align = 'left'
	}: { label: string; children: Snippet; sub?: Snippet; align?: 'left' | 'right' } = $props();
</script>

<div class="stat" class:right={align === 'right'}>
	<dt>{label}</dt>
	<dd class="val">{@render children()}</dd>
	{#if sub}<dd class="sub">{@render sub()}</dd>{/if}
</div>

<style>
	.stat {
		display: grid;
		gap: 4px;
		min-width: 0;
	}
	.right {
		text-align: right;
		justify-items: end;
	}
	dt {
		font-size: var(--text-xs);
		color: var(--text-3);
		font-weight: 500;
	}
	.val {
		font-size: var(--text-lg);
		font-weight: 600;
		letter-spacing: var(--tracking-tight);
		font-variant-numeric: tabular-nums;
		line-height: 1.25;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.sub {
		font-size: var(--text-xs);
		color: var(--text-3);
	}
</style>
