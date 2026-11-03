<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon, { type IconName } from './Icon.svelte';
	import type { Tone } from './verdict';

	let {
		tone = 'neutral',
		title,
		icon,
		children,
		actions,
		role
	}: {
		tone?: Tone;
		title?: string;
		icon?: IconName;
		children?: Snippet;
		actions?: Snippet;
		role?: 'alert' | 'status';
	} = $props();

	const defaultIcon: Record<Tone, IconName> = {
		neutral: 'info',
		accent: 'info',
		clean: 'shield-check',
		dirty: 'alert',
		busy: 'clock',
		bad: 'alert-octagon'
	};
</script>

<div class="callout {tone}" {role}>
	<span class="ico"><Icon name={icon ?? defaultIcon[tone]} size={16} stroke={2} /></span>
	<div class="content">
		{#if title}<p class="title">{title}</p>{/if}
		{#if children}<div class="body">{@render children()}</div>{/if}
		{#if actions}<div class="actions">{@render actions()}</div>{/if}
	</div>
</div>

<style>
	.callout {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 10px;
		padding: 12px 14px;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--surface-2);
		font-size: var(--text-sm);
		color: var(--text-2);
	}
	.ico {
		padding-top: 1px;
		color: var(--text-3);
	}
	.content {
		display: grid;
		gap: 4px;
		min-width: 0;
	}
	.title {
		font-weight: 600;
		color: var(--text);
		font-size: var(--text-sm);
	}
	.body {
		line-height: 1.55;
		overflow-wrap: anywhere;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 6px;
	}
	.accent {
		background: var(--accent-soft);
		border-color: var(--accent-border);
	}
	.accent .ico {
		color: var(--accent-text);
	}
	.clean {
		background: var(--clean-bg);
		border-color: var(--clean-border);
	}
	.clean .ico,
	.clean .title {
		color: var(--clean);
	}
	.dirty {
		background: var(--dirty-bg);
		border-color: var(--dirty-border);
	}
	.dirty .ico,
	.dirty .title {
		color: var(--dirty);
	}
	.busy {
		background: var(--busy-bg);
		border-color: var(--busy-border);
	}
	.busy .ico,
	.busy .title {
		color: var(--busy);
	}
	.bad {
		background: var(--bad-bg);
		border-color: var(--bad-border);
	}
	.bad .ico,
	.bad .title {
		color: var(--bad);
	}
</style>
