<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon, { type IconName } from './Icon.svelte';

	let {
		icon = 'layers',
		title,
		children,
		actions,
		compact = false
	}: { icon?: IconName; title: string; children?: Snippet; actions?: Snippet; compact?: boolean } = $props();
</script>

<div class="empty" class:compact>
	<div class="mark" aria-hidden="true">
		<Icon name={icon} size={20} />
	</div>
	<h3>{title}</h3>
	{#if children}<div class="body">{@render children()}</div>{/if}
	{#if actions}<div class="actions">{@render actions()}</div>{/if}
</div>

<style>
	.empty {
		display: grid;
		justify-items: center;
		text-align: center;
		gap: 10px;
		padding: var(--space-16) var(--space-6);
		border: 1px dashed var(--border-strong);
		border-radius: var(--radius-lg);
		background:
			radial-gradient(circle at 50% 0%, var(--surface) 0%, transparent 70%),
			var(--bg-subtle);
	}
	.compact {
		padding: var(--space-8) var(--space-5);
	}
	.mark {
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		border-radius: 12px;
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text-2);
		box-shadow: var(--shadow-sm);
		margin-bottom: 4px;
	}
	h3 {
		font-size: var(--text-md);
	}
	.body {
		color: var(--text-2);
		max-width: 44ch;
		font-size: var(--text-base);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}
</style>
