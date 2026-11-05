<script lang="ts">
	import {
		formatEth,
		formatHolding,
		formatNear,
		getTokenHoldings,
		getWalletStatus,
		shortHex,
		type Listing,
		type TokenHolding,
		type WalletStatus
	} from '$lib/chain';
	import { onMount } from 'svelte';
	import Badge from './Badge.svelte';
	import Icon from './Icon.svelte';
	import Seal from './Seal.svelte';
	import Skeleton from './Skeleton.svelte';
	import VerdictBadge from './VerdictBadge.svelte';
	import { walletHref } from './links';
	import { Resource } from './resource.svelte';

	let {
		tokenId,
		listing = null,
		context = 'market',
		onstatus
	}: {
		tokenId: string;
		listing?: Listing | null;
		context?: 'market' | 'owned';
		onstatus?: (tokenId: string, status: WalletStatus | null) => void;
	} = $props();

	const status = new Resource(() => getWalletStatus(tokenId));
	let el: HTMLAnchorElement | undefined = $state();

	// Tokens at the wallet address, shown on market cards so buyers see what a sale includes.
	let tokens = $state<TokenHolding[]>([]);

	async function load() {
		const s = await status.load();
		onstatus?.(tokenId, s ?? null);
		if (s && context === 'market') getTokenHoldings(s.address).then((t) => (tokens = t)).catch(() => {});
	}

	onMount(() => {
		if (!el || typeof IntersectionObserver === 'undefined') {
			load();
			return;
		}
		const io = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) {
					io.disconnect();
					load();
				}
			},
			{ rootMargin: '200px' }
		);
		io.observe(el);
		return () => io.disconnect();
	});

	const s = $derived(status.data);
	const listed = $derived(listing ?? s?.wallet.listing ?? null);
	const vstate = $derived(status.error ? 'error' : status.loading || !s ? 'loading' : 'ready');
</script>

<a class="card wcard" href={walletHref(tokenId)} bind:this={el} aria-label="Wallet #{tokenId}">
	<div class="art">
		<Seal {tokenId} address={s?.address} />
		{#if listed && context === 'owned'}
			<span class="flag"><Icon name="lock" size={12} stroke={2} /> Listed, signing frozen</span>
		{/if}
	</div>

	<div class="body">
		<div class="head">
			<div class="title">
				<h3>Wallet <span class="mono">#{tokenId}</span></h3>
				<p class="addr mono">
					{#if s}{shortHex(s.address, 5)}{:else if status.error}<span class="muted">address unavailable</span>{:else}<Skeleton
							width="112px"
							height="12px"
							inline
						/>{/if}
				</p>
			</div>
			<VerdictBadge verdict={s?.verdict} pending={s?.pending.length ?? 0} size="sm" state={vstate} />
		</div>

		<dl class="stats">
			<div>
				<dt>Balance</dt>
				<dd class="tnum">
					{#if s}{formatEth(s.balanceWei, 4)} <span class="unit">ETH</span>{:else if status.error}-{:else}<Skeleton
							width="64px"
							height="14px"
							inline
						/>{/if}
				</dd>
			</div>
			<div>
				<dt>Signatures</dt>
				<dd class="tnum">
					{#if s}{s.wallet.nextNonce}{:else if status.error}-{:else}<Skeleton width="24px" height="14px" inline />{/if}
				</dd>
			</div>
			{#if context === 'owned'}
				<div>
					<dt>State</dt>
					<dd>
						{#if listed}<Badge tone="accent" size="sm">Listed</Badge>{:else}<span class="secondary">Active</span>{/if}
					</dd>
				</div>
			{/if}
		</dl>

		{#if context === 'market' && tokens.length}
			<p class="incl">
				<span class="secondary">Includes</span>
				<span class="mono">{tokens.slice(0, 3).map(formatHolding).join(', ')}{tokens.length > 3 ? `, +${tokens.length - 3} more` : ''}</span>
			</p>
		{/if}

		{#if listed && context === 'market'}
			<div class="price">
				<span class="p-amount"><span class="tnum">{formatNear(listed.priceYocto)}</span> <span class="unit">NEAR</span></span>
				<span class="p-cta">View and verify <Icon name="arrow-right" size={14} /></span>
			</div>
		{/if}
	</div>
</a>

<style>
	.incl {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		font-size: var(--text-xs);
		color: var(--text);
	}
	.wcard {
		display: flex;
		flex-direction: column;
		overflow: hidden;
		transition:
			border-color var(--dur-2) var(--ease-out),
			box-shadow var(--dur-2) var(--ease-out),
			transform var(--dur-2) var(--ease-out);
	}
	.wcard:hover {
		border-color: var(--border-strong);
		box-shadow: var(--shadow-md);
		transform: translateY(-2px);
	}
	.wcard:focus-visible {
		outline: none;
		box-shadow: var(--ring);
		border-radius: var(--radius-lg);
	}
	.art {
		position: relative;
		aspect-ratio: 16 / 10;
		overflow: hidden;
		border-bottom: 1px solid var(--border);
		background: #111;
	}
	.art :global(.seal) {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		transition: transform 600ms var(--ease-out);
	}
	.wcard:hover .art :global(.seal) {
		transform: scale(1.04) rotate(2deg);
	}
	.flag {
		position: absolute;
		left: 10px;
		top: 10px;
		display: inline-flex;
		align-items: center;
		gap: 5px;
		height: 22px;
		padding: 0 8px;
		border-radius: var(--radius-full);
		background: rgb(10 10 12 / 0.62);
		color: #f3f3f2;
		font-size: var(--text-2xs);
		font-weight: 500;
		backdrop-filter: blur(6px);
		-webkit-backdrop-filter: blur(6px);
		border: 1px solid rgb(255 255 255 / 0.12);
	}
	.body {
		display: grid;
		gap: 14px;
		padding: 14px 16px 16px;
		flex: 1;
		align-content: start;
	}
	.head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 10px;
	}
	.title {
		min-width: 0;
	}
	h3 {
		font-size: var(--text-md);
		font-weight: 600;
	}
	h3 .mono {
		font-weight: 500;
	}
	.addr {
		font-size: var(--text-xs);
		color: var(--text-3);
		margin-top: 2px;
		min-height: 18px;
	}
	.stats {
		display: flex;
		gap: 24px;
		padding-top: 12px;
		border-top: 1px solid var(--border);
	}
	dt {
		font-size: var(--text-2xs);
		color: var(--text-3);
		margin-bottom: 2px;
	}
	dd {
		font-size: var(--text-sm);
		font-weight: 500;
		min-height: 22px;
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.unit {
		color: var(--text-3);
		font-weight: 400;
		font-size: var(--text-xs);
	}
	.price {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-top: auto;
		padding: 10px 12px;
		border-radius: var(--radius-md);
		background: var(--surface-2);
		border: 1px solid var(--border);
	}
	.p-amount {
		font-size: var(--text-md);
		font-weight: 600;
		letter-spacing: var(--tracking-tight);
	}
	.p-cta {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: var(--text-xs);
		color: var(--text-2);
		font-weight: 500;
		transition: color var(--dur-1);
	}
	.wcard:hover .p-cta {
		color: var(--accent-text);
	}
	@media (prefers-reduced-motion: reduce) {
		.wcard:hover {
			transform: none;
		}
		.wcard:hover .art :global(.seal) {
			transform: none;
		}
	}
</style>
