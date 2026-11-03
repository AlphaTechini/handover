<script lang="ts" module>
	export type StepState = 'idle' | 'active' | 'done' | 'error';
	export interface Step {
		label: string;
		detail?: string;
		state: StepState;
		href?: string;
		hrefLabel?: string;
	}
</script>

<script lang="ts">
	import Icon from './Icon.svelte';
	import Spinner from './Spinner.svelte';

	let { steps, label = 'Progress' }: { steps: Step[]; label?: string } = $props();
</script>

<ol class="stepper" aria-label={label}>
	{#each steps as s, i (i)}
		<li class="step {s.state}" aria-current={s.state === 'active' ? 'step' : undefined}>
			<span class="node" aria-hidden="true">
				{#if s.state === 'done'}
					<Icon name="check" size={12} stroke={2.75} />
				{:else if s.state === 'active'}
					<Spinner size={12} />
				{:else if s.state === 'error'}
					<Icon name="x" size={12} stroke={2.75} />
				{:else}
					<span class="num">{i + 1}</span>
				{/if}
			</span>
			<div class="text">
				<p class="lab">
					{s.label}
					<span class="visually-hidden">
						({s.state === 'done' ? 'done' : s.state === 'active' ? 'in progress' : s.state === 'error' ? 'failed' : 'waiting'})
					</span>
				</p>
				{#if s.detail}<p class="det">{s.detail}</p>{/if}
				{#if s.href}
					<a class="link det-link" href={s.href} target="_blank" rel="noreferrer noopener"
						>{s.hrefLabel ?? 'View'} <Icon name="arrow-up-right" size={12} /></a
					>
				{/if}
			</div>
		</li>
	{/each}
</ol>

<style>
	.stepper {
		display: grid;
		gap: 0;
	}
	.step {
		position: relative;
		display: grid;
		grid-template-columns: 22px 1fr;
		gap: 12px;
		padding-bottom: 16px;
	}
	.step:last-child {
		padding-bottom: 0;
	}
	.step:not(:last-child)::before {
		content: '';
		position: absolute;
		left: 10.5px;
		top: 24px;
		bottom: 2px;
		width: 1px;
		background: var(--border-strong);
		transition: background-color var(--dur-3) var(--ease-out);
	}
	.step.done:not(:last-child)::before {
		background: var(--clean-solid);
	}
	.node {
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		border: 1px solid var(--border-strong);
		background: var(--surface);
		color: var(--text-3);
		font-size: var(--text-2xs);
		transition: all var(--dur-2) var(--ease-out);
	}
	.num {
		font-family: var(--font-mono);
		font-weight: 500;
	}
	.active .node {
		border-color: var(--accent);
		color: var(--accent-text);
		box-shadow: 0 0 0 4px var(--accent-soft);
	}
	.done .node {
		background: var(--clean-solid);
		border-color: var(--clean-solid);
		color: #fff;
	}
	.error .node {
		background: var(--bad-solid);
		border-color: var(--bad-solid);
		color: #fff;
	}
	.text {
		padding-top: 1px;
		min-width: 0;
	}
	.lab {
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--text);
	}
	.idle .lab {
		color: var(--text-3);
	}
	.det {
		font-size: var(--text-xs);
		color: var(--text-3);
		margin-top: 2px;
		overflow-wrap: anywhere;
	}
	.error .det {
		color: var(--bad);
	}
	.det-link {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		margin-top: 4px;
		font-size: var(--text-xs);
	}
</style>
