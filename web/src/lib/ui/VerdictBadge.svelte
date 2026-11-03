<script lang="ts">
	import type { Verdict } from '$lib/chain';
	import Badge from './Badge.svelte';
	import Spinner from './Spinner.svelte';
	import { VERDICTS } from './verdict';

	let {
		verdict,
		pending = 0,
		size = 'md',
		state = 'ready'
	}: {
		verdict?: Verdict | null;
		pending?: number;
		size?: 'sm' | 'md' | 'lg';
		state?: 'ready' | 'loading' | 'error' | 'idle';
	} = $props();

	const meta = $derived(verdict ? VERDICTS[verdict] : null);
</script>

{#if state === 'loading' && !meta}
	<span class="checking {size}" aria-live="polite"><Spinner size={size === 'lg' ? 14 : 12} /> Checking</span>
{:else if state === 'error' && !meta}
	<Badge tone="neutral" {size} icon="info">Unverified</Badge>
{:else if meta}
	<Badge tone={meta.tone} {size} icon={meta.icon} title={meta.headline}>
		{meta.label}{#if verdict === 'dirty' && pending > 0}<span class="sep" aria-hidden="true">·</span><span class="tnum"
				>{pending} pending</span
			>{/if}
	</Badge>
{:else}
	<Badge tone="neutral" {size}>Not checked</Badge>
{/if}

<style>
	.checking {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 24px;
		padding: 0 9px;
		border-radius: var(--radius-full);
		border: 1px dashed var(--border-strong);
		color: var(--text-3);
		font-size: var(--text-xs);
		font-weight: 500;
	}
	.checking.sm {
		height: 20px;
		font-size: var(--text-2xs);
		padding: 0 7px;
	}
	.checking.lg {
		height: 32px;
		font-size: var(--text-base);
		padding: 0 12px;
	}
	.sep {
		margin: 0 5px;
		opacity: 0.6;
	}
</style>
