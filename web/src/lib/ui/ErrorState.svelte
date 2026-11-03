<script lang="ts">
	import Button from './Button.svelte';
	import Icon, { type IconName } from './Icon.svelte';
	import { describeError, type ErrorKind } from './errors';

	let {
		error,
		onretry,
		title,
		compact = false
	}: { error: unknown; onretry?: () => void; title?: string; compact?: boolean } = $props();

	const d = $derived(describeError(error));
	const icons: Record<ErrorKind, IconName> = {
		unavailable: 'radio',
		'not-configured': 'info',
		refused: 'ban',
		'not-connected': 'wallet',
		incomplete: 'clock',
		rejected: 'x',
		network: 'radio',
		unknown: 'alert'
	};
	const calm = $derived(
		d.kind === 'unavailable' || d.kind === 'not-configured' || d.kind === 'network' || d.kind === 'not-connected'
	);
</script>

<div class="err" class:compact class:calm role={calm ? 'status' : 'alert'}>
	<span class="mark"><Icon name={icons[d.kind]} size={18} /></span>
	<div class="text">
		<p class="t">{title ?? d.title}</p>
		<p class="d">{d.detail}</p>
		{#if d.raw && d.raw !== d.detail && d.kind !== 'refused'}
			<details>
				<summary>Technical details</summary>
				<code>{d.raw}</code>
			</details>
		{/if}
	</div>
	{#if onretry}
		<div class="act"><Button size="sm" icon="refresh" onclick={onretry}>Try again</Button></div>
	{/if}
</div>

<style>
	.err {
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: 14px;
		align-items: start;
		padding: 18px;
		border: 1px solid var(--bad-border);
		background: var(--bad-bg);
		border-radius: var(--radius-lg);
	}
	.err.calm {
		border-color: var(--border);
		border-style: dashed;
		background: var(--bg-subtle);
	}
	.compact {
		padding: 12px 14px;
		gap: 10px;
	}
	.mark {
		display: grid;
		place-items: center;
		width: 34px;
		height: 34px;
		border-radius: 10px;
		background: var(--surface);
		border: 1px solid var(--border);
		color: var(--bad);
	}
	.calm .mark {
		color: var(--text-3);
	}
	.compact .mark {
		width: 28px;
		height: 28px;
		border-radius: 8px;
	}
	.text {
		min-width: 0;
		display: grid;
		gap: 2px;
	}
	.t {
		font-weight: 600;
		font-size: var(--text-sm);
	}
	.d {
		color: var(--text-2);
		font-size: var(--text-sm);
		overflow-wrap: anywhere;
	}
	details {
		margin-top: 6px;
		font-size: var(--text-xs);
		color: var(--text-3);
	}
	summary {
		cursor: pointer;
		width: fit-content;
	}
	details code {
		display: block;
		margin-top: 6px;
		padding: 8px 10px;
		border-radius: var(--radius-sm);
		background: var(--surface);
		border: 1px solid var(--border);
		overflow-wrap: anywhere;
		color: var(--text-2);
	}
	@media (max-width: 520px) {
		.err {
			grid-template-columns: auto 1fr;
		}
		.act {
			grid-column: 2;
		}
	}
</style>
