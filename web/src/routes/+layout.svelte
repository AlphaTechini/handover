<script lang="ts">
	import '@fontsource-variable/geist';
	import '@fontsource-variable/geist-mono';
	import '$lib/styles/global.css';

	import { page } from '$app/state';
	import { HANDOVER_CONTRACT, initWallet, isConfigured, nearblocksAccount } from '$lib/chain';
	import ConnectButton from '$lib/ui/ConnectButton.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import Logo from '$lib/ui/Logo.svelte';
	import NetworkPill from '$lib/ui/NetworkPill.svelte';
	import SetupBanner from '$lib/ui/SetupBanner.svelte';
	import ThemeToggle from '$lib/ui/ThemeToggle.svelte';
	import Toasts from '$lib/ui/Toasts.svelte';
	import { homeHref, howHref, marketHref, mintHref, REPO_URL, walletsHref } from '$lib/ui/links';
	import { initTheme } from '$lib/ui/theme.svelte';
	import { onMount } from 'svelte';

	let { children } = $props();

	let menuOpen = $state(false);
	const configured = isConfigured();

	const nav = [
		{ href: marketHref(), label: 'Market', match: '/market' },
		{ href: walletsHref(), label: 'My wallets', match: '/wallets' },
		{ href: mintHref(), label: 'Mint', match: '/mint' },
		{ href: howHref(), label: 'How it works', match: '/how' }
	];

	const isActive = (m: string) => page.url.pathname.replace(/\/$/, '').endsWith(m);

	onMount(() => {
		initTheme();
		initWallet().catch((e) => {
			// The wallet selector failing must never take the app down.
			console.warn('[handover] initWallet failed:', e);
		});
	});

	$effect(() => {
		// close the mobile menu on navigation
		void page.url.pathname;
		menuOpen = false;
	});
</script>

<a class="skip-link" href="#main">Skip to content</a>

<header class="nav">
	<div class="container nav-inner">
		<a class="brand" href={homeHref()} aria-label="Handover home"><Logo /></a>

		<nav class="links" aria-label="Primary">
			{#each nav as item (item.href)}
				<a href={item.href} class:active={isActive(item.match)} aria-current={isActive(item.match) ? 'page' : undefined}
					>{item.label}</a
				>
			{/each}
		</nav>

		<div class="right">
			<span class="pill-wrap"><NetworkPill /></span>
			<ThemeToggle />
			<ConnectButton />
			<button
				type="button"
				class="burger"
				aria-label={menuOpen ? 'Close menu' : 'Open menu'}
				aria-expanded={menuOpen}
				aria-controls="mobile-menu"
				onclick={() => (menuOpen = !menuOpen)}
			>
				<Icon name={menuOpen ? 'x' : 'menu'} size={18} />
			</button>
		</div>
	</div>

	{#if menuOpen}
		<nav id="mobile-menu" class="mobile" aria-label="Primary">
			<div class="container mobile-inner">
				{#each nav as item (item.href)}
					<a href={item.href} class:active={isActive(item.match)} aria-current={isActive(item.match) ? 'page' : undefined}>
						{item.label}
						<Icon name="chevron-right" size={16} />
					</a>
				{/each}
				<div class="mobile-pill"><NetworkPill /></div>
			</div>
		</nav>
	{/if}
</header>

{#if !configured}
	<SetupBanner />
{/if}

<main id="main" tabindex="-1">
	{@render children()}
</main>

<footer class="footer">
	<div class="container foot-inner">
		<div class="foot-brand">
			<Logo size={18} />
			<p class="muted">An NFT that owns its own Ethereum wallet. Testnet software: NEAR testnet and Sepolia only, no real funds.</p>
		</div>
		<div class="foot-links">
			<div>
				<span class="eyebrow">Contract</span>
				{#if configured}
					<a class="mono flink" href={nearblocksAccount(HANDOVER_CONTRACT)} target="_blank" rel="noreferrer noopener"
						>{HANDOVER_CONTRACT}<Icon name="arrow-up-right" size={12} /></a
					>
				{:else}
					<span class="mono muted small">not configured</span>
				{/if}
			</div>
			<div>
				<span class="eyebrow">Source</span>
				<a class="flink" href={REPO_URL} target="_blank" rel="noreferrer noopener"
					><Icon name="github" size={14} />GitHub<Icon name="arrow-up-right" size={12} /></a
				>
			</div>
			<div>
				<span class="eyebrow">Learn</span>
				<a class="flink" href={howHref()}>How it works</a>
			</div>
		</div>
	</div>
</footer>

<Toasts />

<style>
	.nav {
		position: sticky;
		top: 0;
		z-index: 50;
		background: color-mix(in srgb, var(--bg) 86%, transparent);
		backdrop-filter: saturate(1.4) blur(10px);
		-webkit-backdrop-filter: saturate(1.4) blur(10px);
		border-bottom: 1px solid var(--border);
	}
	.nav-inner {
		display: flex;
		align-items: center;
		gap: 28px;
		height: var(--nav-h);
	}
	.brand {
		display: inline-flex;
		border-radius: var(--radius-sm);
	}
	.links {
		display: flex;
		gap: 2px;
	}
	.links a {
		padding: 6px 10px;
		border-radius: var(--radius-sm);
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--text-2);
		transition:
			color var(--dur-1),
			background-color var(--dur-1);
	}
	.links a:hover {
		color: var(--text);
		background: var(--surface-sunken);
	}
	.links a.active {
		color: var(--text);
		background: var(--surface-sunken);
	}
	.right {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.burger {
		display: none;
		place-items: center;
		width: 34px;
		height: 34px;
		border-radius: var(--radius-md);
		color: var(--text-2);
	}
	.burger:hover {
		background: var(--surface-sunken);
		color: var(--text);
	}
	.mobile {
		border-top: 1px solid var(--border);
		background: var(--bg);
		animation: fade-up var(--dur-2) var(--ease-out);
	}
	.mobile-inner {
		display: grid;
		padding-block: 8px 16px;
	}
	.mobile a {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 4px;
		border-bottom: 1px solid var(--border);
		font-size: var(--text-md);
		font-weight: 500;
		color: var(--text-2);
	}
	.mobile a.active {
		color: var(--text);
	}
	.mobile-pill {
		padding-top: 14px;
	}

	main {
		min-height: calc(100dvh - var(--nav-h) - 160px);
	}
	main:focus {
		outline: none;
	}

	.footer {
		border-top: 1px solid var(--border);
		background: var(--bg-subtle);
	}
	.foot-inner {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 32px;
		padding-block: 40px 48px;
	}
	.foot-brand {
		display: grid;
		gap: 12px;
		max-width: 340px;
		font-size: var(--text-sm);
	}
	.foot-links {
		display: flex;
		flex-wrap: wrap;
		gap: 24px 48px;
	}
	.foot-links > div {
		display: grid;
		gap: 8px;
		align-content: start;
	}
	.flink {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: var(--text-sm);
		color: var(--text-2);
		overflow-wrap: anywhere;
	}
	.flink:hover {
		color: var(--text);
	}
	.small {
		font-size: var(--text-sm);
	}

	@media (max-width: 980px) {
		.pill-wrap {
			display: none;
		}
	}
	@media (max-width: 800px) {
		.links {
			display: none;
		}
		.burger {
			display: grid;
		}
		.right {
			gap: 4px;
		}
	}
</style>
