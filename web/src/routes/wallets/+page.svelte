<script lang="ts">
	import { connectWallet, isConfigured, nearWallet, tokensForOwner } from '$lib/chain';
	import Button from '$lib/ui/Button.svelte';
	import CardSkeleton from '$lib/ui/CardSkeleton.svelte';
	import EmptyState from '$lib/ui/EmptyState.svelte';
	import ErrorState from '$lib/ui/ErrorState.svelte';
	import WalletCard from '$lib/ui/WalletCard.svelte';
	import { describeError } from '$lib/ui/errors';
	import { marketHref, mintHref } from '$lib/ui/links';
	import { Resource } from '$lib/ui/resource.svelte';
	import { toast } from '$lib/ui/toast.svelte';

	const configured = isConfigured();
	let account = $derived(nearWallet.accountId);
	const tokens = new Resource<string[]>(() => (account ? tokensForOwner(account) : Promise.resolve([])));
	let connecting = $state(false);

	$effect(() => {
		if (configured && account) tokens.load();
		else tokens.reset();
	});

	const sorted = $derived([...(tokens.data ?? [])].sort((a, b) => Number(b) - Number(a)));

	async function connect() {
		connecting = true;
		try {
			await connectWallet();
		} catch (e) {
			toast({ tone: 'error', title: 'Could not connect', message: describeError(e).detail });
		} finally {
			connecting = false;
		}
	}
</script>

<svelte:head><title>My wallets · Handover</title></svelte:head>

<div class="container page">
	<header class="page-head">
		<div>
			<span class="eyebrow">Portfolio</span>
			<h1>My wallets</h1>
			<p class="lede">Every Handover NFT you own, with the Ethereum wallet it controls and its current verdict.</p>
		</div>
		{#if account && tokens.data?.length}
			<Button variant="primary" href={mintHref()} icon="plus">Mint wallet</Button>
		{/if}
	</header>

	{#if !configured}
		<EmptyState icon="info" title="Not connected to a contract">
			This build has no Handover contract configured, so there are no wallets to show yet.
		</EmptyState>
	{:else if !account}
		<EmptyState icon="wallet" title="Connect to see your wallets">
			Connect a NEAR testnet account to list the Handover NFTs it owns.
			{#snippet actions()}
				<Button variant="primary" loading={connecting || nearWallet.connecting} onclick={connect}>Connect wallet</Button>
			{/snippet}
		</EmptyState>
	{:else if tokens.error}
		<ErrorState error={tokens.error} onretry={() => tokens.load()} />
	{:else if tokens.data === undefined}
		<div class="grid" aria-busy="true" aria-label="Loading wallets">
			{#each { length: 3 } as _, i (i)}<CardSkeleton />{/each}
		</div>
	{:else if sorted.length === 0}
		<EmptyState icon="key" title="No wallets yet">
			<span class="mono">{account}</span> does not own any Handover NFTs. Mint one, or buy a verified wallet on the market.
			{#snippet actions()}
				<Button variant="primary" href={mintHref()} icon="plus">Mint a wallet</Button>
				<Button variant="secondary" href={marketHref()}>Browse market</Button>
			{/snippet}
		</EmptyState>
	{:else}
		<p class="count muted">
			<span class="tnum">{sorted.length}</span>
			{sorted.length === 1 ? 'wallet' : 'wallets'} owned by <span class="mono">{account}</span>
		</p>
		<div class="grid">
			{#each sorted as id (id)}
				<WalletCard tokenId={id} context="owned" />
			{/each}
		</div>
	{/if}
</div>

<style>
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(270px, 1fr));
		gap: 16px;
	}
	.count {
		font-size: var(--text-sm);
		margin-bottom: 16px;
	}
	@media (max-width: 420px) {
		.grid {
			grid-template-columns: 1fr;
		}
	}
</style>
