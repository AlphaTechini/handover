<script lang="ts">
	import Icon from './Icon.svelte';
	import { howHref } from './links';
</script>

<div class="banner" role="status">
	<div class="container inner">
		<span class="ico"><Icon name="info" size={15} stroke={2} /></span>
		<p>
			<strong>Preview mode.</strong>
			The Handover contract account is not configured, so live on-chain data is off. Set
			<code>PUBLIC_HANDOVER_CONTRACT</code> and rebuild to connect.
			<a class="link" href={howHref()}>How it works</a>
		</p>
	</div>
</div>

<style>
	.banner {
		border-bottom: 1px solid var(--accent-border);
		background: var(--accent-soft);
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.inner {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		padding-block: 10px;
	}
	.ico {
		color: var(--accent-text);
		padding-top: 2px;
	}
	strong {
		color: var(--text);
		font-weight: 600;
	}
	code {
		font-size: 0.92em;
		padding: 1px 5px;
		border-radius: 4px;
		background: var(--surface);
		border: 1px solid var(--accent-border);
		color: var(--text);
	}
</style>
