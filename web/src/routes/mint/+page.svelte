<script lang="ts">
	import { connectWallet, etherscanAddress, formatNear, isConfigured, mint, nearWallet, totalSupply, walletAddress, type Hex } from '$lib/chain';
	import { feeConfig, mintFeeYocto } from '$lib/ui/extras';
	import Button from '$lib/ui/Button.svelte';
	import Callout from '$lib/ui/Callout.svelte';
	import CopyField from '$lib/ui/CopyField.svelte';
	import ErrorState from '$lib/ui/ErrorState.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import Seal from '$lib/ui/Seal.svelte';
	import Skeleton from '$lib/ui/Skeleton.svelte';
	import { describeError } from '$lib/ui/errors';
	import { SEPOLIA_FAUCET_URL, walletHref, walletsHref } from '$lib/ui/links';
	import { Resource } from '$lib/ui/resource.svelte';
	import { toast } from '$lib/ui/toast.svelte';
	import { onMount } from 'svelte';

	const configured = isConfigured();
	const supply = new Resource(() => totalSupply());

	let minting = $state(false);
	let mintError = $state<unknown>(null);
	let minted = $state<string | null>(null);
	let address = $state<Hex | null>(null);
	let addressError = $state<unknown>(null);
	let connecting = $state(false);

	let mintFee = $state<string | null>(null);

	onMount(() => {
		if (!configured) return;
		supply.load();
		feeConfig().then((c) => (mintFee = mintFeeYocto(c)));
	});

	const nextId = $derived(supply.data !== undefined ? String(supply.data) : null);

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

	async function loadAddress(id: string) {
		addressError = null;
		try {
			address = await walletAddress(id);
		} catch (e) {
			addressError = e;
		}
	}

	async function doMint() {
		minting = true;
		mintError = null;
		try {
			const id = await mint();
			minted = id;
			toast({ tone: 'success', title: `Wallet #${id} minted`, message: 'Its Ethereum address is ready to fund.' });
			loadAddress(id);
		} catch (e) {
			mintError = e;
		} finally {
			minting = false;
		}
	}

	function reset() {
		minted = null;
		address = null;
		addressError = null;
		supply.load();
	}
</script>

<svelte:head><title>Mint a wallet · Handover</title></svelte:head>

<div class="container container-narrow page">
	{#if !minted}
		<header class="page-head">
			<div>
				<span class="eyebrow">Mint</span>
				<h1>Mint a Handover wallet</h1>
				<p class="lede">
					One NFT, one Ethereum address. The address is derived by NEAR Chain Signatures from the Handover contract and the
					token id, so no private key for it exists.
				</p>
			</div>
		</header>

		<div class="mint card">
			<div class="preview">
				{#if nextId !== null}
					<Seal tokenId={nextId} />
				{:else}
					<div class="ph"><Icon name="key" size={28} stroke={1.25} /></div>
				{/if}
				<span class="pv-cap">
					{#if nextId !== null}Preview of <span class="mono">#{nextId}</span>. The id is final when the mint lands.{:else}Each seal is generated from its token id.{/if}
				</span>
			</div>

			<div class="side">
				<ul class="facts">
					<li>
						<span class="fi"><Icon name="key" size={15} /></span>
						<div>
							<p class="ft">Its own Sepolia address</p>
							<p class="fd">Derived from the contract account and the path <code>handover-&lt;id&gt;</code>.</p>
						</div>
					</li>
					<li>
						<span class="fi"><Icon name="shield" size={15} /></span>
						<div>
							<p class="ft">Only the owner can spend</p>
							<p class="fd">The contract asks for signatures only for the NFT’s current owner, and only for plain ETH transfers.</p>
						</div>
					</li>
					<li>
						<span class="fi"><Icon name="layers" size={15} /></span>
						<div>
							<p class="ft">Storage deposit</p>
							<p class="fd">
								Minting attaches {mintFee ? `${formatNear(mintFee)} NEAR` : 'a small NEAR deposit'} to pay for the token’s
								on-chain storage. The contract refunds whatever the storage does not use.
							</p>
						</div>
					</li>
				</ul>

				<div class="action">
					{#if !configured}
						<Callout tone="neutral" title="Minting is unavailable in preview mode">
							The contract account is not configured for this build.
						</Callout>
					{:else if !nearWallet.accountId}
						<Button variant="primary" size="lg" full loading={connecting || nearWallet.connecting} onclick={connect}>
							Connect a NEAR testnet wallet
						</Button>
						<p class="fine">You will approve the mint in your wallet. Testnet NEAR only.</p>
					{:else}
						<Button variant="primary" size="lg" full loading={minting} icon="plus" onclick={doMint}>
							{minting ? 'Confirm in your wallet' : 'Mint wallet'}
						</Button>
						<p class="fine">Minting to <span class="mono">{nearWallet.accountId}</span></p>
					{/if}
					{#if mintError}
						<ErrorState error={mintError} compact title="Mint did not complete" />
					{/if}
				</div>
			</div>
		</div>
	{:else}
		<div class="success reveal">
			<div class="s-head">
				<span class="s-check"><Icon name="check" size={18} stroke={2.5} /></span>
				<div>
					<span class="eyebrow">Minted</span>
					<h1>Wallet <span class="mono">#{minted}</span> is yours</h1>
				</div>
			</div>

			<div class="s-card card">
				<div class="s-seal"><Seal tokenId={minted} {address} /></div>
				<div class="s-body">
					<div>
						<h2>Fund this wallet</h2>
						<p class="secondary">
							Send Sepolia ETH to the address below. It belongs to the NFT: whoever owns the NFT controls it. It needs ETH for gas;
							ERC-20, ERC-721 and ERC-1155 tokens sent here move with the NFT too.
						</p>
					</div>
					{#if address}
						<CopyField value={address} label="Ethereum address (Sepolia)" action="Copy address" />
						<div class="s-links">
							<a class="link" href={etherscanAddress(address)} target="_blank" rel="noreferrer noopener"
								>View on Etherscan <Icon name="arrow-up-right" size={13} /></a
							>
							<a class="link" href={SEPOLIA_FAUCET_URL} target="_blank" rel="noreferrer noopener"
								>Get Sepolia ETH from a faucet <Icon name="arrow-up-right" size={13} /></a
							>
						</div>
					{:else if addressError}
						<ErrorState error={addressError} compact title="Could not derive the address" onretry={() => loadAddress(minted!)} />
					{:else}
						<div class="sk-field">
							<Skeleton width="160px" height="12px" />
							<Skeleton height="42px" radius="8px" />
						</div>
					{/if}
					<div class="s-actions">
						<Button variant="primary" href={walletHref(minted)} iconRight="arrow-right">Open wallet</Button>
						<Button variant="secondary" href={walletsHref()}>My wallets</Button>
						<Button variant="ghost" icon="plus" onclick={reset}>Mint another</Button>
					</div>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.mint {
		display: grid;
		grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
		overflow: hidden;
	}
	.preview {
		position: relative;
		display: grid;
		align-content: end;
		min-height: 360px;
		background: #101012;
		border-right: 1px solid var(--border);
	}
	.preview :global(.seal) {
		position: absolute;
		inset: 0;
		height: 100%;
	}
	.ph {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		color: #6c6c70;
		background:
			repeating-radial-gradient(circle at 50% 50%, transparent 0 14px, rgb(255 255 255 / 0.04) 14px 15px),
			#101012;
	}
	.pv-cap {
		position: relative;
		margin: 12px;
		padding: 6px 10px;
		border-radius: var(--radius-sm);
		background: rgb(10 10 12 / 0.6);
		color: #d9d9d6;
		font-size: var(--text-xs);
		backdrop-filter: blur(6px);
		-webkit-backdrop-filter: blur(6px);
		justify-self: start;
	}
	.side {
		display: grid;
		gap: 28px;
		padding: 28px;
		align-content: space-between;
	}
	.facts {
		display: grid;
		gap: 18px;
	}
	.facts li {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 12px;
	}
	.fi {
		display: grid;
		place-items: center;
		width: 30px;
		height: 30px;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text-2);
	}
	.ft {
		font-weight: 600;
		font-size: var(--text-sm);
	}
	.fd {
		color: var(--text-2);
		font-size: var(--text-sm);
		margin-top: 2px;
	}
	code {
		font-size: 0.92em;
		padding: 1px 4px;
		border-radius: 4px;
		background: var(--surface-sunken);
		border: 1px solid var(--border);
	}
	.action {
		display: grid;
		gap: 10px;
	}
	.fine {
		text-align: center;
		font-size: var(--text-xs);
		color: var(--text-3);
	}

	.success {
		display: grid;
		gap: 28px;
	}
	.s-head {
		display: flex;
		align-items: center;
		gap: 16px;
	}
	.s-head h1 {
		font-size: var(--text-2xl);
		line-height: 1.15;
	}
	.s-check {
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		border-radius: 50%;
		background: var(--clean-solid);
		color: #fff;
		box-shadow: 0 0 0 6px var(--clean-bg);
	}
	.s-card {
		display: grid;
		grid-template-columns: 240px 1fr;
		overflow: hidden;
	}
	.s-seal {
		position: relative;
		background: #101012;
		min-height: 240px;
	}
	.s-seal :global(.seal) {
		position: absolute;
		inset: 0;
		height: 100%;
	}
	.s-body {
		display: grid;
		gap: 18px;
		padding: 24px;
		min-width: 0;
	}
	.s-body h2 {
		font-size: var(--text-lg);
	}
	.s-body p {
		margin-top: 4px;
		font-size: var(--text-sm);
	}
	.s-links {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 20px;
		font-size: var(--text-sm);
	}
	.s-links a {
		display: inline-flex;
		align-items: center;
		gap: 3px;
	}
	.sk-field {
		display: grid;
		gap: 8px;
	}
	.s-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		padding-top: 18px;
		border-top: 1px solid var(--border);
	}

	@media (max-width: 720px) {
		.mint,
		.s-card {
			grid-template-columns: 1fr;
		}
		.preview {
			min-height: 0;
			aspect-ratio: 16 / 10;
			border-right: 0;
			border-bottom: 1px solid var(--border);
		}
		.s-seal {
			min-height: 0;
			aspect-ratio: 16 / 9;
		}
		.side {
			padding: 20px;
		}
		.s-body {
			padding: 20px;
		}
	}
</style>
