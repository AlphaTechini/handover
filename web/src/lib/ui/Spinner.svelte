<script lang="ts">
	let { size = 14, label }: { size?: number; label?: string } = $props();
</script>

<svg
	class="spinner"
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	role={label ? 'img' : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : 'true'}
>
	<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-opacity="0.2" stroke-width="2.5" />
	<path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
</svg>

<style>
	.spinner {
		flex: none;
		animation: spin 0.8s linear infinite;
	}
	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation: spin 2.4s linear infinite !important;
			animation-iteration-count: infinite !important;
			animation-duration: 2.4s !important;
		}
	}
</style>
