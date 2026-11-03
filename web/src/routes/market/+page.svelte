<script lang="ts">
	import { isConfigured, listListings, type Listing, type WalletStatus } from '$lib/chain';
	import Button from '$lib/ui/Button.svelte';
	import CardSkeleton from '$lib/ui/CardSkeleton.svelte';
	import EmptyState from '$lib/ui/EmptyState.svelte';
	import ErrorState from '$lib/ui/ErrorState.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import WalletCard from '$lib/ui/WalletCard.svelte';
	import { howHref, mintHref } from '$lib/ui/links';
	import { Resource } from '$lib/ui/resource.svelte';
	import { onMount } from 'svelte';

	type Sort = 'price-asc' | 'price-desc' | 'newest';

	const configured = isConfigured();
	const listings = new Resource<Listing[]>(() => listListings(0, 100));
	// tokenId -> status (null when the check failed)
	let statuses = $state<Record<string, WalletStatus | null>>({});
	let cleanOnly = $state(false);
	let sort = $state<Sort>('price-asc');

	onMount(() => {
		if (configured) listings.load();
	});

	function onstatus(id: string, s: WalletStatus | null) {
		statuses[id] = s;
	}

	const cmp = (a: string, b: string) => {
		const x = BigInt(a);
		const y = BigInt(b);
		return x < y ? -1 : x > y ? 1 : 0;
	};

	const sorted = $derived.by(() => {
		const xs = [...(listings.data ?? [])];
		if (sort === 'price-asc') xs.sort((a, b) => cmp(a.priceYocto, b.priceYocto));
		else if (sort === 'price-desc') xs.sort((a, b) => cmp(b.priceYocto, a.priceYocto));
		else xs.sort((a, b) => cmp(b.listedAtNs, a.listedAtNs));
		return xs;
	});

	const checked = $derived(sorted.filter((l) => l.tokenId in statuses));
	const cleanCount = $derived(checked.filter((l) => statuses[l.tokenId]?.verdict === 'clean').length);
	const unchecked = $derived(sorted.length - checked.length);
	const visible = $derived(
		cleanOnly ? sorted.filter((l) => !(l.tokenId in statuses) || statuses[l.tokenId]?.verdict === 'clean') : sorted
	);
</script>

<svelte:head><title>Market · Handover</title></svelte:head>

<div class="container page">
	<header class="page-head">
		<div>
			<span class="eyebrow">Market</span>
			<h1>Wallets for sale</h1>
			<p class="lede">
				Listed wallets are frozen: no new signatures can be created for them. Each card runs the clean check live against
				NEAR and Sepolia.
			</p>
		</div>
		<a class="link how" href={howHref('#clean-check')}>What “clean” means <Icon name="arrow-right" size={14} /></a>
	</header>

	{#if !configured}
		<EmptyState icon="info" title="No contract configured">
			Listings appear here once the app points at a deployed Handover contract.
		</EmptyState>
	{:else if listings.error}
		<ErrorState error={listings.error} onretry={() => listings.load()} />
	{:else}
		<div class="toolbar">
			<div class="summary" aria-live="polite">
				{#if listings.data}
					<span><strong class="tnum">{sorted.length}</strong> {sorted.length === 1 ? 'listing' : 'listings'}</span>
					<span class="dotsep" aria-hidden="true"></span>
					<span class="clean-sum"><strong class="tnum">{cleanCount}</strong> verified clean</span>
					{#if unchecked > 0}
						<span class="dotsep" aria-hidden="true"></span>
						<span class="muted"><span class="tnum">{unchecked}</span> checking</span>
					{/if}
				{:else}
					<span class="muted">Loading listings</span>
				{/if}
			</div>
			<div class="controls">
				<label class="switch">
					<input type="checkbox" bind:checked={cleanOnly} />
					<span class="track" aria-hidden="true"><span class="thumb"></span></span>
					<span>Clean only</span>
				</label>
				<label class="select">
					<span class="visually-hidden">Sort listings</span>
					<Icon name="sort" size={14} />
					<select bind:value={sort}>
						<option value="price-asc">Price: low to high</option>
						<option value="price-desc">Price: high to low</option>
						<option value="newest">Newest listed</option>
					</select>
					<Icon name="chevron-down" size={14} />
				</label>
			</div>
		</div>

		{#if listings.data === undefined}
			<div class="grid" aria-busy="true" aria-label="Loading listings">
				{#each { length: 6 } as _, i (i)}<CardSkeleton />{/each}
			</div>
		{:else if sorted.length === 0}
			<EmptyState icon="tag" title="Nothing listed yet">
				When an owner lists a Handover wallet it appears here, frozen and ready to verify.
				{#snippet actions()}
					<Button variant="primary" href={mintHref()} icon="plus">Mint a wallet</Button>
				{/snippet}
			</EmptyState>
		{:else if visible.length === 0}
			<EmptyState icon="filter" title="No clean listings right now" compact>
				Every checked listing has a pending signature or is otherwise not clean.
				{#snippet actions()}
					<Button variant="secondary" onclick={() => (cleanOnly = false)}>Show all listings</Button>
				{/snippet}
			</EmptyState>
		{:else}
			<div class="grid">
				{#each visible as l (l.tokenId)}
					<WalletCard tokenId={l.tokenId} listing={l} {onstatus} />
				{/each}
			</div>
		{/if}
	{/if}
</div>

<style>
	.how {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: var(--text-sm);
		font-weight: 500;
	}
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 12px 16px;
		padding: 10px 10px 10px 16px;
		margin-bottom: 20px;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--surface);
	}
	.summary {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 10px;
		font-size: var(--text-sm);
		color: var(--text-2);
	}
	.summary strong {
		color: var(--text);
		font-weight: 600;
	}
	.clean-sum strong {
		color: var(--clean);
	}
	.dotsep {
		width: 3px;
		height: 3px;
		border-radius: 50%;
		background: var(--text-3);
		opacity: 0.6;
	}
	.controls {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.switch {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		height: 32px;
		padding: 0 10px;
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
		font-weight: 500;
		cursor: pointer;
		user-select: none;
	}
	.switch:hover {
		background: var(--surface-sunken);
	}
	.switch input {
		position: absolute;
		opacity: 0;
		width: 1px;
		height: 1px;
	}
	.track {
		position: relative;
		width: 28px;
		height: 16px;
		border-radius: 999px;
		background: var(--border-strong);
		transition: background-color var(--dur-2) var(--ease-out);
	}
	.thumb {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: #fff;
		box-shadow: 0 1px 2px rgb(0 0 0 / 0.25);
		transition: transform var(--dur-2) var(--ease-out);
	}
	.switch input:checked + .track {
		background: var(--clean-solid);
	}
	.switch input:checked + .track .thumb {
		transform: translateX(12px);
	}
	.switch input:focus-visible + .track {
		box-shadow: var(--ring);
	}
	.select {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 32px;
		padding: 0 10px;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		background: var(--surface);
		color: var(--text-2);
	}
	.select:focus-within {
		box-shadow: var(--ring);
	}
	.select select {
		appearance: none;
		-webkit-appearance: none;
		border: 0;
		background: transparent;
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--text);
		padding-right: 2px;
		cursor: pointer;
		outline: none;
	}
	.select select option {
		background: var(--surface);
		color: var(--text);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(270px, 1fr));
		gap: 16px;
	}
	@media (max-width: 560px) {
		.toolbar {
			padding: 12px;
		}
		.controls {
			width: 100%;
			justify-content: space-between;
		}
	}
	@media (max-width: 420px) {
		.grid {
			grid-template-columns: 1fr;
		}
	}
</style>
