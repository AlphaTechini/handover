<script lang="ts">
	let { size = 22, wordmark = true }: { size?: number; wordmark?: boolean } = $props();
</script>

<span class="logo">
	<svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
		<rect width="24" height="24" rx="6.5" class="tile" />
		<rect x="6.4" y="5.6" width="2.6" height="12.8" rx="1.3" class="stem" />
		<rect x="15" y="5.6" width="2.6" height="12.8" rx="1.3" class="stem" />
		<path d="M8.6 14.6L15.4 9.4" class="bar" stroke-width="2.5" stroke-linecap="round" />
	</svg>
	{#if wordmark}<span class="word">Handover</span>{/if}
</span>

<style>
	.logo {
		display: inline-flex;
		align-items: center;
		gap: 9px;
	}
	.tile {
		fill: var(--ink);
	}
	.stem {
		fill: var(--bg);
	}
	.bar {
		stroke: var(--accent);
	}
	.word {
		font-weight: 600;
		font-size: 15px;
		letter-spacing: -0.025em;
		color: var(--text);
	}
</style>
