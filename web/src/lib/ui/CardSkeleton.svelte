<script lang="ts">
	import Skeleton from './Skeleton.svelte';
</script>

<div class="card sk-card" aria-hidden="true">
	<div class="art"><Skeleton height="100%" radius="0" /></div>
	<div class="body">
		<div class="row">
			<div class="col">
				<Skeleton width="96px" height="16px" />
				<Skeleton width="128px" height="12px" />
			</div>
			<Skeleton width="58px" height="20px" radius="999px" />
		</div>
		<div class="row stats">
			<Skeleton width="70px" height="28px" />
			<Skeleton width="56px" height="28px" />
		</div>
	</div>
</div>

<style>
	.sk-card {
		overflow: hidden;
	}
	.art {
		aspect-ratio: 16 / 10;
		border-bottom: 1px solid var(--border);
	}
	.body {
		display: grid;
		gap: 14px;
		padding: 14px 16px 16px;
	}
	.row {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 12px;
	}
	.col {
		display: grid;
		gap: 6px;
	}
	.stats {
		justify-content: flex-start;
		gap: 24px;
		padding-top: 12px;
		border-top: 1px solid var(--border);
	}
</style>
