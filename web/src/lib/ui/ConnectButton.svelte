<script lang="ts">
	import { connectWallet, disconnectWallet, nearWallet, nearblocksAccount } from '$lib/chain';
	import Button from './Button.svelte';
	import Icon from './Icon.svelte';
	import { copyText } from './copy';
	import { describeError } from './errors';
	import { walletsHref } from './links';
	import { toast } from './toast.svelte';

	let open = $state(false);
	let busy = $state(false);
	let root: HTMLDivElement | undefined = $state();

	const account = $derived(nearWallet.accountId);
	const short = $derived(account && account.length > 22 ? `${account.slice(0, 10)}…${account.slice(-8)}` : account);
	const hue = $derived(account ? [...account].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7) : 0);

	async function connect() {
		busy = true;
		try {
			await connectWallet();
		} catch (e) {
			const d = describeError(e);
			toast({ tone: 'error', title: 'Could not connect', message: d.detail });
		} finally {
			busy = false;
		}
	}

	async function disconnect() {
		open = false;
		try {
			await disconnectWallet();
			toast({ tone: 'neutral', title: 'Disconnected' });
		} catch (e) {
			toast({ tone: 'error', title: 'Could not disconnect', message: describeError(e).detail });
		}
	}

	async function copyAccount() {
		if (account && (await copyText(account))) toast({ tone: 'success', title: 'Account copied', message: account, timeout: 2500 });
		open = false;
	}

	function onWindowClick(e: MouseEvent) {
		if (open && root && !root.contains(e.target as Node)) open = false;
	}
	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape' && open) {
			open = false;
			root?.querySelector<HTMLButtonElement>('.acct')?.focus();
		}
	}
</script>

<svelte:window onclick={onWindowClick} onkeydown={onKey} />

{#if account}
	<div class="menu-root" bind:this={root}>
		<button
			type="button"
			class="acct"
			aria-haspopup="menu"
			aria-expanded={open}
			onclick={() => (open = !open)}
			title={account}
		>
			<span class="avatar" style:--h={hue} aria-hidden="true"></span>
			<span class="name mono">{short}</span>
			<Icon name="chevron-down" size={14} />
		</button>
		{#if open}
			<div class="menu" role="menu">
				<div class="menu-head">
					<span class="eyebrow">Connected</span>
					<span class="mono full">{account}</span>
				</div>
				<a role="menuitem" href={walletsHref()} onclick={() => (open = false)}><Icon name="wallet" size={15} />My wallets</a>
				<button role="menuitem" type="button" onclick={copyAccount}><Icon name="copy" size={15} />Copy account id</button>
				<a role="menuitem" href={nearblocksAccount(account)} target="_blank" rel="noreferrer noopener"
					><Icon name="external" size={15} />View on NearBlocks</a
				>
				<hr />
				<button role="menuitem" type="button" class="danger" onclick={disconnect}><Icon name="power" size={15} />Disconnect</button>
			</div>
		{/if}
	</div>
{:else}
	<Button variant="primary" size="sm" loading={busy || nearWallet.connecting} onclick={connect}>
		{busy || nearWallet.connecting ? 'Connecting' : 'Connect wallet'}
	</Button>
{/if}

<style>
	.menu-root {
		position: relative;
	}
	.acct {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		height: 32px;
		padding: 0 8px 0 5px;
		border-radius: var(--radius-full);
		border: 1px solid var(--border-strong);
		background: var(--surface);
		color: var(--text);
		font-size: var(--text-sm);
		transition:
			background-color var(--dur-1),
			border-color var(--dur-1);
		max-width: 220px;
	}
	.acct:hover {
		background: var(--surface-2);
	}
	.acct:focus-visible {
		box-shadow: var(--ring);
		outline: none;
		border-radius: var(--radius-full);
	}
	.avatar {
		flex: none;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background:
			radial-gradient(circle at 30% 30%, hsl(calc(var(--h) * 1deg) 70% 72%), transparent 60%),
			conic-gradient(from 90deg, hsl(calc(var(--h) * 1deg) 55% 45%), hsl(calc(var(--h) * 1deg + 60deg) 55% 35%), hsl(calc(var(--h) * 1deg) 55% 45%));
		box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.08);
	}
	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--text-xs);
	}
	.menu {
		position: absolute;
		right: 0;
		top: calc(100% + 8px);
		z-index: 60;
		width: 260px;
		padding: 6px;
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-lg);
		animation: fade-up var(--dur-2) var(--ease-out);
	}
	.menu-head {
		display: grid;
		gap: 2px;
		padding: 8px 10px 10px;
	}
	.full {
		font-size: var(--text-xs);
		overflow-wrap: anywhere;
		color: var(--text);
	}
	.menu a,
	.menu button {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 8px 10px;
		border-radius: var(--radius-sm);
		font-size: var(--text-sm);
		color: var(--text-2);
		text-align: left;
	}
	.menu a:hover,
	.menu button:hover,
	.menu a:focus-visible,
	.menu button:focus-visible {
		background: var(--surface-sunken);
		color: var(--text);
		outline: none;
	}
	.menu .danger {
		color: var(--bad);
	}
	.menu .danger:hover {
		background: var(--bad-bg);
		color: var(--bad);
	}
	hr {
		border: 0;
		height: 1px;
		background: var(--border);
		margin: 6px 0;
	}
	@media (max-width: 520px) {
		.name {
			max-width: 92px;
		}
	}
</style>
