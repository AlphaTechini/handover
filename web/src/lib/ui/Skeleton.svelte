<script lang="ts">
	let {
		width = '100%',
		height = '14px',
		radius = '6px',
		inline = false
	}: { width?: string; height?: string; radius?: string; inline?: boolean } = $props();
</script>

<span
	class="sk"
	class:inline
	style:width
	style:height
	style:border-radius={radius}
	aria-hidden="true"
></span>

<style>
	.sk {
		display: block;
		background: linear-gradient(90deg, var(--skeleton-a) 0%, var(--skeleton-b) 50%, var(--skeleton-a) 100%);
		background-size: 200% 100%;
		animation: shimmer 1.4s ease-in-out infinite;
	}
	.inline {
		display: inline-block;
		vertical-align: middle;
	}
	@keyframes shimmer {
		from {
			background-position: 100% 0;
		}
		to {
			background-position: -100% 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.sk {
			animation: none;
		}
	}
</style>
