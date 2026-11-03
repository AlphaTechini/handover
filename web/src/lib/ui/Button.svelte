<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import Icon, { type IconName } from './Icon.svelte';
	import Spinner from './Spinner.svelte';

	type Variant = 'primary' | 'secondary' | 'ghost' | 'accent' | 'danger' | 'success';
	type Size = 'sm' | 'md' | 'lg';

	let {
		variant = 'secondary',
		size = 'md',
		href,
		external = false,
		loading = false,
		disabled = false,
		icon,
		iconRight,
		full = false,
		type = 'button',
		children,
		class: klass = '',
		...rest
	}: {
		variant?: Variant;
		size?: Size;
		href?: string;
		external?: boolean;
		loading?: boolean;
		disabled?: boolean;
		icon?: IconName;
		iconRight?: IconName;
		full?: boolean;
		type?: 'button' | 'submit' | 'reset';
		children?: Snippet;
		class?: string;
	} & Omit<HTMLButtonAttributes, 'type' | 'disabled' | 'class' | 'children'> = $props();

	const iconSize = $derived(size === 'sm' ? 14 : 16);
</script>

{#snippet inner()}
	{#if loading}
		<Spinner size={iconSize} />
	{:else if icon}
		<Icon name={icon} size={iconSize} />
	{/if}
	{#if children}<span class="label">{@render children()}</span>{/if}
	{#if iconRight && !loading}
		<Icon name={iconRight} size={iconSize} class="right" />
	{/if}
{/snippet}

{#if href && !disabled}
	<a
		{href}
		class="btn {variant} {size} {klass}"
		class:full
		target={external ? '_blank' : undefined}
		rel={external ? 'noreferrer noopener' : undefined}
		aria-label={rest['aria-label']}
	>
		{@render inner()}
	</a>
{:else}
	<button
		{type}
		class="btn {variant} {size} {klass}"
		class:full
		class:is-loading={loading}
		disabled={disabled || loading}
		aria-busy={loading || undefined}
		{...rest}
	>
		{@render inner()}
	</button>
{/if}

<style>
	.btn {
		--h: 36px;
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		height: var(--h);
		padding: 0 14px;
		border-radius: var(--radius-md);
		border: 1px solid transparent;
		font-size: var(--text-base);
		font-weight: 500;
		line-height: 1;
		white-space: nowrap;
		user-select: none;
		transition:
			background-color var(--dur-1) var(--ease-out),
			border-color var(--dur-1) var(--ease-out),
			color var(--dur-1) var(--ease-out),
			box-shadow var(--dur-1) var(--ease-out),
			transform var(--dur-1) var(--ease-out);
	}
	.btn:active:not(:disabled) {
		transform: translateY(0.5px) scale(0.99);
	}
	.btn:focus-visible {
		outline: none;
		box-shadow: var(--ring);
		border-radius: var(--radius-md);
	}
	.btn:disabled {
		cursor: not-allowed;
	}
	.btn:disabled:not(.is-loading) {
		opacity: 0.5;
	}
	.btn.is-loading {
		cursor: progress;
	}
	.full {
		width: 100%;
	}
	.sm {
		--h: 30px;
		padding: 0 10px;
		font-size: var(--text-sm);
		gap: 6px;
		border-radius: var(--radius-sm);
	}
	.lg {
		--h: 44px;
		padding: 0 20px;
		font-size: var(--text-md);
		border-radius: var(--radius-md);
	}
	.label {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.primary {
		background: var(--ink);
		color: var(--text-inverse);
		box-shadow:
			inset 0 1px 0 rgb(255 255 255 / 0.12),
			var(--shadow-sm);
	}
	.primary:hover:not(:disabled) {
		background: var(--ink-hover);
	}

	.accent {
		background: var(--accent);
		color: #fff;
		box-shadow:
			inset 0 1px 0 rgb(255 255 255 / 0.18),
			var(--shadow-sm);
	}
	.accent:hover:not(:disabled) {
		background: var(--accent-hover);
	}

	.success {
		background: var(--clean-solid);
		color: #fff;
		box-shadow:
			inset 0 1px 0 rgb(255 255 255 / 0.18),
			var(--shadow-sm);
	}
	.success:hover:not(:disabled) {
		background: color-mix(in srgb, var(--clean-solid) 88%, black);
	}

	.secondary {
		background: var(--surface);
		color: var(--text);
		border-color: var(--border-strong);
		box-shadow: var(--shadow-xs);
	}
	.secondary:hover:not(:disabled) {
		background: var(--surface-2);
		border-color: color-mix(in srgb, var(--border-strong) 70%, var(--text-3));
	}

	.ghost {
		background: transparent;
		color: var(--text-2);
	}
	.ghost:hover:not(:disabled) {
		background: var(--surface-sunken);
		color: var(--text);
	}

	.danger {
		background: var(--surface);
		color: var(--bad);
		border-color: var(--bad-border);
	}
	.danger:hover:not(:disabled) {
		background: var(--bad-bg);
	}

	:global(.btn .right) {
		margin-right: -2px;
		transition: transform var(--dur-2) var(--ease-out);
	}
	.btn:hover :global(.right) {
		transform: translateX(2px);
	}
</style>
