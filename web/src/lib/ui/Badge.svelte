<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon, { type IconName } from './Icon.svelte';
	import type { Tone } from './verdict';

	let {
		tone = 'neutral',
		size = 'md',
		icon,
		dot = false,
		children,
		title
	}: { tone?: Tone; size?: 'sm' | 'md' | 'lg'; icon?: IconName; dot?: boolean; children: Snippet; title?: string } =
		$props();
</script>

<span class="badge {tone} {size}" {title}>
	{#if dot}<span class="dot" aria-hidden="true"></span>{/if}
	{#if icon}<Icon name={icon} size={size === 'lg' ? 16 : size === 'sm' ? 12 : 14} stroke={2} />{/if}
	<span>{@render children()}</span>
</span>

<style>
	.badge {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 24px;
		padding: 0 9px;
		border-radius: var(--radius-full);
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text-2);
		font-size: var(--text-xs);
		font-weight: 500;
		line-height: 1;
		white-space: nowrap;
	}
	.sm {
		height: 20px;
		padding: 0 7px;
		gap: 5px;
		font-size: var(--text-2xs);
	}
	.lg {
		height: 32px;
		padding: 0 12px;
		gap: 8px;
		font-size: var(--text-base);
		font-weight: 600;
	}
	.dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: currentColor;
	}
	.accent {
		color: var(--accent-text);
		background: var(--accent-soft);
		border-color: var(--accent-border);
	}
	.clean {
		color: var(--clean);
		background: var(--clean-bg);
		border-color: var(--clean-border);
	}
	.dirty {
		color: var(--dirty);
		background: var(--dirty-bg);
		border-color: var(--dirty-border);
	}
	.busy {
		color: var(--busy);
		background: var(--busy-bg);
		border-color: var(--busy-border);
	}
	.bad {
		color: var(--bad);
		background: var(--bad-bg);
		border-color: var(--bad-border);
	}
</style>
