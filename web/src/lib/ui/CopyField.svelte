<script lang="ts">
	import Icon from './Icon.svelte';
	import { copyText } from './copy';

	let {
		value,
		label,
		action = 'Copy'
	}: { value: string; label?: string; action?: string } = $props();

	let copied = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;

	async function copy() {
		if (!(await copyText(value))) return;
		copied = true;
		clearTimeout(timer);
		timer = setTimeout(() => (copied = false), 1800);
	}
</script>

<div class="copyfield">
	{#if label}<span class="lab">{label}</span>{/if}
	<div class="row">
		<code class="val">{value}</code>
		<button type="button" class="btn" class:copied onclick={copy}>
			<Icon name={copied ? 'check' : 'copy'} size={14} stroke={copied ? 2.25 : 1.75} />
			<span>{copied ? 'Copied' : action}</span>
		</button>
	</div>
	<span class="visually-hidden" aria-live="polite">{copied ? 'Copied to clipboard' : ''}</span>
</div>

<style>
	.copyfield {
		display: grid;
		gap: 6px;
		min-width: 0;
	}
	.lab {
		font-size: var(--text-xs);
		color: var(--text-3);
		font-weight: 500;
	}
	.row {
		display: flex;
		align-items: stretch;
		min-width: 0;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		background: var(--surface-sunken);
		overflow: hidden;
	}
	.val {
		flex: 1;
		min-width: 0;
		padding: 10px 12px;
		font-size: var(--text-sm);
		word-break: break-all;
		line-height: 1.45;
		color: var(--text);
	}
	.btn {
		flex: none;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 0 14px;
		border-left: 1px solid var(--border-strong);
		background: var(--surface);
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--text);
		transition:
			background-color var(--dur-1),
			color var(--dur-1);
	}
	.btn:hover {
		background: var(--surface-2);
	}
	.btn.copied {
		color: var(--clean);
	}
</style>
