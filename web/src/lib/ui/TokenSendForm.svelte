<script lang="ts">
	// v2: send an ERC-20, ERC-721 or ERC-1155 token out of the wallet. The contract encodes the
	// calldata itself (transfer / safeTransferFrom only); this form only picks the parameters.
	import {
		broadcast,
		clampFees,
		encodeTokenTransfer,
		etherscanTx,
		formatEth,
		formatNear,
		getFees,
		MAX_TOKEN_GAS_LIMIT,
		readErc20Meta,
		requestTokenTransfer,
		tokenTransferGasLimit,
		waitForReceipt,
		type Erc20Meta,
		type EthFees,
		type Hex,
		type SignedTx,
		type TokenHolding,
		type TokenStandard
	} from '$lib/chain';
	import { onMount } from 'svelte';
	import { formatUnits, parseUnits } from 'viem';
	import Button from './Button.svelte';
	import Callout from './Callout.svelte';
	import Stepper, { type Step } from './Stepper.svelte';
	import { describeError, type DescribedError } from './errors';
	import { feeConfig, signFeeYocto } from './extras';
	import { toast } from './toast.svelte';

	let {
		tokenId,
		fromAddress,
		balanceWei = null,
		holdings = [],
		blocked = null,
		onsettled
	}: {
		tokenId: string;
		/** The wallet's address; token transfers need it pinned by a first ETH transfer */
		fromAddress: Hex | null;
		balanceWei?: bigint | null;
		/** Tokens the index says the wallet holds, offered as quick picks */
		holdings?: TokenHolding[];
		blocked?: string | null;
		onsettled?: () => void;
	} = $props();

	const uid = $props.id();
	let standard = $state<TokenStandard>('erc20');
	let token = $state('');
	let to = $state('');
	let idText = $state('');
	let amountText = $state('');
	let fees = $state<EthFees | null>(null);
	let signFee = $state<string | null>(null);
	let meta = $state<Erc20Meta | null>(null);

	type Phase = 'form' | 'signing' | 'broadcasting' | 'confirming' | 'done' | 'failed';
	let phase = $state<Phase>('form');
	let failedAt = $state<'sign' | 'broadcast' | 'confirm' | null>(null);
	let err = $state<DescribedError | null>(null);
	let signed = $state<SignedTx | null>(null);
	let txHash = $state<Hex | null>(null);
	let receipt = $state<'success' | 'reverted' | null>(null);

	onMount(() => {
		getFees().then((f) => (fees = f)).catch(() => {});
		feeConfig().then((c) => (signFee = signFeeYocto(c)));
	});

	const addr = (s: string) => (/^0x[0-9a-fA-F]{40}$/.test(s.trim()) ? (s.trim() as Hex) : null);
	const tokenAddr = $derived(addr(token));
	const toAddr = $derived(addr(to));

	// ERC-20 amounts are typed in whole tokens and converted with the token's own decimals.
	$effect(() => {
		const t = tokenAddr;
		meta = null;
		if (standard !== 'erc20' || !t) return;
		readErc20Meta(t)
			.then((m) => t === tokenAddr && (meta = m))
			.catch(() => {});
	});

	const id = $derived(standard === 'erc20' ? 0n : /^\d+$/.test(idText.trim()) ? BigInt(idText.trim()) : null);
	const amount = $derived.by(() => {
		if (standard === 'erc721') return 1n;
		const a = amountText.trim();
		if (!a) return null;
		try {
			if (standard === 'erc20') return meta ? parseUnits(a, meta.decimals) : null;
			return /^\d+$/.test(a) ? BigInt(a) : null;
		} catch {
			return null;
		}
	});
	const filled = $derived(tokenAddr !== null && toAddr !== null && id !== null && amount !== null && amount > 0n);

	let gasLimit = $state<bigint | null>(null);
	let gasEstimating = $state(false);
	let gasError = $state('');
	let gasRun = 0;
	$effect(() => {
		const [s, t, r, i, a, from] = [standard, tokenAddr, toAddr, id, amount, fromAddress];
		gasLimit = null;
		gasError = '';
		if (!t || !r || i === null || a === null || a <= 0n || !from) {
			gasEstimating = false;
			return;
		}
		const run = ++gasRun;
		gasEstimating = true;
		const timer = setTimeout(() => {
			tokenTransferGasLimit(from, t, encodeTokenTransfer(s, from, r, i, a))
				.then((g) => {
					if (run !== gasRun) return;
					gasLimit = g;
					if (g === null) gasError = `Needs more than ${MAX_TOKEN_GAS_LIMIT.toLocaleString('en-US')} gas, which the contract will not sign.`;
				})
				.catch(() => run === gasRun && (gasError = 'This transfer would fail: check the token, the id and that the wallet holds it.'))
				.finally(() => run === gasRun && (gasEstimating = false));
		}, 300);
		return () => clearTimeout(timer);
	});

	const feeWei = $derived(fees && gasLimit !== null ? clampFees(fees).maxFeePerGas * gasLimit : null);
	const overBalance = $derived(balanceWei !== null && feeWei !== null && feeWei > balanceWei);
	const canSubmit = $derived(filled && !!fromAddress && gasLimit !== null && !gasEstimating && !gasError && !overBalance && !blocked);

	function pick(h: TokenHolding) {
		standard = h.standard;
		token = h.token;
		idText = h.id ?? '';
		amountText = h.standard === 'erc20' ? formatUnits(h.amount, h.decimals) : h.standard === 'erc1155' ? h.amount.toString() : '';
	}

	const label = (h: TokenHolding) =>
		h.standard === 'erc20'
			? `${formatUnits(h.amount, h.decimals)} ${h.symbol || 'tokens'}`
			: h.standard === 'erc721'
				? `${h.symbol || 'NFT'} #${h.id}`
				: `${h.amount} × ${h.symbol || 'item'} #${h.id}`;

	const steps = $derived.by((): Step[] => {
		const st = (key: 'sign' | 'broadcast' | 'confirm', active: Phase, done: Phase[]) =>
			failedAt === key ? 'error' : phase === active ? 'active' : done.includes(phase) ? 'done' : 'idle';
		return [
			{
				label: 'MPC signature',
				detail:
					failedAt === 'sign'
						? err?.kind === 'refused'
							? 'Refused before any signature was created.'
							: (err?.title ?? 'Signing failed.')
						: signed
							? `Signed with nonce ${signed.nonce}, recorded in the public log.`
							: 'The contract encodes the token transfer and asks the NEAR signing network to sign it.',
				state: st('sign', 'signing', ['broadcasting', 'confirming', 'done'])
			},
			{
				label: 'Broadcast to Sepolia',
				detail: failedAt === 'broadcast' ? (err?.detail ?? 'Broadcast failed.') : txHash ? 'Sent to the network.' : 'eth_sendRawTransaction.',
				state: st('broadcast', 'broadcasting', ['confirming', 'done'])
			},
			{
				label: receipt === 'reverted' ? 'Reverted' : 'Confirmed',
				detail: receipt === 'success' ? 'Mined on Sepolia.' : 'Waiting for the transaction to be mined.',
				state: receipt === 'reverted' ? 'error' : st('confirm', 'confirming', ['done']),
				href: txHash ? etherscanTx(txHash) : undefined,
				hrefLabel: 'View on Etherscan'
			}
		];
	});

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!canSubmit || !tokenAddr || !toAddr || id === null || amount === null || gasLimit === null) return;
		err = null;
		failedAt = null;
		signed = null;
		txHash = null;
		receipt = null;
		phase = 'signing';
		try {
			signed = await requestTokenTransfer({
				tokenId,
				standard,
				token: tokenAddr,
				to: toAddr,
				id,
				amount,
				gasLimit,
				...(fees ? clampFees(fees) : {})
			});
		} catch (x) {
			fail('sign', x);
			return;
		}
		await doBroadcast();
	}

	async function doBroadcast() {
		if (!signed) return;
		phase = 'broadcasting';
		failedAt = null;
		err = null;
		try {
			txHash = await broadcast(signed.rawSignedTxHex);
		} catch (x) {
			fail('broadcast', x);
			return;
		}
		phase = 'confirming';
		try {
			receipt = await waitForReceipt(txHash);
			phase = receipt === 'success' ? 'done' : 'failed';
			toast({
				tone: receipt === 'success' ? 'success' : 'error',
				title: receipt === 'success' ? 'Token transfer confirmed' : 'Transaction reverted',
				message: `To ${toAddr?.slice(0, 8)}…`,
				href: etherscanTx(txHash),
				linkLabel: 'View on Etherscan'
			});
		} catch (x) {
			fail('confirm', x);
		}
		onsettled?.();
	}

	function fail(at: 'sign' | 'broadcast' | 'confirm', x: unknown) {
		err = describeError(x, { contractCall: at === 'sign' });
		failedAt = at;
		phase = 'failed';
		onsettled?.();
	}

	function again() {
		phase = 'form';
		failedAt = null;
		err = null;
		signed = null;
		txHash = null;
		receipt = null;
	}
</script>

{#if phase === 'form'}
	<form class="form" onsubmit={submit} novalidate>
		{#if !fromAddress}
			<Callout tone="neutral" title="Send ETH once first">
				The wallet's address is pinned by its first signature. Make one ETH transfer, then tokens can be sent.
			</Callout>
		{/if}
		{#if holdings.length}
			<div class="field">
				<span class="field-label">Held by this wallet</span>
				<div class="picks">
					{#each holdings as h (h.token + (h.id ?? ''))}
						<button type="button" class="pick mono" onclick={() => pick(h)}>{label(h)}</button>
					{/each}
				</div>
			</div>
		{/if}
		<div class="field">
			<label class="field-label" for="{uid}-std">Standard</label>
			<select id="{uid}-std" class="input" bind:value={standard}>
				<option value="erc20">ERC-20 token</option>
				<option value="erc721">ERC-721 NFT</option>
				<option value="erc1155">ERC-1155 item</option>
			</select>
		</div>
		<div class="field">
			<label class="field-label" for="{uid}-tok">Token contract</label>
			<input id="{uid}-tok" class="input mono" placeholder="0x…" autocomplete="off" spellcheck="false" bind:value={token} />
		</div>
		{#if standard !== 'erc20'}
			<div class="field">
				<label class="field-label" for="{uid}-id">Token id</label>
				<input id="{uid}-id" class="input mono" inputmode="numeric" placeholder="0" autocomplete="off" bind:value={idText} />
			</div>
		{/if}
		{#if standard !== 'erc721'}
			<div class="field">
				<label class="field-label" for="{uid}-amt">Amount</label>
				<div class="input-group">
					<input id="{uid}-amt" class="input mono" inputmode="decimal" placeholder="0" autocomplete="off" bind:value={amountText} />
					<span class="suffix">{standard === 'erc20' ? (meta?.symbol ?? 'tokens') : 'units'}</span>
				</div>
			</div>
		{/if}
		<div class="field">
			<label class="field-label" for="{uid}-to">Recipient</label>
			<input id="{uid}-to" class="input mono" placeholder="0x…" autocomplete="off" spellcheck="false" bind:value={to} />
			{#if gasError}<span class="field-error">{gasError}</span>{/if}
			{#if overBalance}<span class="field-error">The wallet needs more ETH for the network fee.</span>{/if}
		</div>
		<dl class="fees">
			<div>
				<dt>Gas limit</dt>
				<dd class="mono">{#if gasEstimating}<span class="muted">estimating</span>{:else if gasLimit !== null}{gasLimit.toLocaleString('en-US')}{:else}<span class="muted">-</span>{/if}</dd>
			</div>
			<div>
				<dt>Max network fee</dt>
				<dd class="mono">{#if feeWei !== null}{formatEth(feeWei, 6)} ETH{:else}<span class="muted">-</span>{/if}</dd>
			</div>
			{#if signFee}
				<div>
					<dt>Signing fee</dt>
					<dd class="mono">{formatNear(signFee)} NEAR</dd>
				</div>
			{/if}
		</dl>
		<Button type="submit" variant="primary" full icon="send" disabled={!canSubmit}>Request signature and send token</Button>
		<p class="fine">
			The contract encodes the call itself: ERC-20 transfer or ERC-721 / ERC-1155 safeTransferFrom from this wallet. It never
			signs an approval.
		</p>
	</form>
{:else}
	<div class="progress">
		<Stepper {steps} label="Token transfer progress" />
		{#if err && failedAt === 'sign'}
			<Callout tone={err.kind === 'refused' ? 'bad' : 'neutral'} title={err.title}>{err.detail}</Callout>
		{:else if err && failedAt === 'broadcast'}
			<Callout tone="dirty" title="Signed, but not broadcast yet">
				The signed transaction is in the public log. Anyone can broadcast it.
				{#snippet actions()}
					<Button size="sm" icon="radio" onclick={doBroadcast}>Retry broadcast</Button>
				{/snippet}
			</Callout>
		{/if}
		{#if phase === 'done' || phase === 'failed'}
			<div>
				<Button variant="secondary" size="sm" onclick={again} icon={phase === 'done' ? 'plus' : 'refresh'}>
					{phase === 'done' ? 'New token transfer' : 'Back to form'}
				</Button>
			</div>
		{/if}
	</div>
{/if}

<style>
	.form,
	.progress {
		display: grid;
		gap: 16px;
	}
	.picks {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.pick {
		font-size: var(--text-xs);
		padding: 4px 10px;
		border-radius: 999px;
		border: 1px solid var(--border-strong);
		background: var(--surface-2);
		color: var(--text);
	}
	.pick:hover {
		border-color: var(--accent);
	}
	.fees {
		display: grid;
		gap: 6px;
		padding: 12px;
		border-radius: var(--radius-md);
		background: var(--surface-2);
		border: 1px solid var(--border);
		font-size: var(--text-xs);
	}
	.fees div {
		display: flex;
		justify-content: space-between;
		gap: 12px;
	}
	.fees dt {
		color: var(--text-3);
	}
	.fees dd {
		color: var(--text-2);
		text-align: right;
	}
	.fine {
		font-size: var(--text-xs);
		color: var(--text-3);
		text-align: center;
		text-wrap: balance;
	}
</style>
