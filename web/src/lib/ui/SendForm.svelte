<script lang="ts">
	import {
		broadcast,
		etherscanTx,
		formatEth,
		formatNear,
		getFees,
		parseEth,
		requestTransfer,
		waitForReceipt,
		type EthFees,
		type Hex,
		type SignedTx
	} from '$lib/chain';
	import { onMount } from 'svelte';
	import Button from './Button.svelte';
	import Callout from './Callout.svelte';
	import Icon from './Icon.svelte';
	import Stepper, { type Step } from './Stepper.svelte';
	import { describeError, type DescribedError } from './errors';
	import { feeConfig, signFeeYocto } from './extras';
	import { toast } from './toast.svelte';

	const GAS_LIMIT = 21000n;

	let {
		tokenId,
		balanceWei = null,
		mode = 'owner',
		blocked = null,
		onsettled
	}: {
		/** Reason the owner cannot request a signature right now (in flight, reserved) */
		blocked?: string | null;
		tokenId: string;
		balanceWei?: bigint | null;
		/** 'refusal': the connected account is not the owner; the contract is expected to refuse */
		mode?: 'owner' | 'refusal';
		onsettled?: () => void;
	} = $props();

	const uid = $props.id();
	let to = $state('');
	let amount = $state('');
	let touched = $state(false);
	let fees = $state<EthFees | null>(null);
	let feesError = $state(false);

	type Phase = 'form' | 'signing' | 'broadcasting' | 'confirming' | 'done' | 'failed';
	let phase = $state<Phase>('form');
	let failedAt = $state<'sign' | 'broadcast' | 'confirm' | null>(null);
	let err = $state<DescribedError | null>(null);
	let signed = $state<SignedTx | null>(null);
	let txHash = $state<Hex | null>(null);
	let receipt = $state<'success' | 'reverted' | null>(null);

	let signFee = $state<string | null>(null);

	onMount(() => {
		loadFees();
		feeConfig().then((c) => (signFee = signFeeYocto(c)));
	});

	async function loadFees() {
		feesError = false;
		try {
			fees = await getFees();
		} catch {
			feesError = true;
		}
	}

	const toValid = $derived(/^0x[0-9a-fA-F]{40}$/.test(to.trim()));
	const valueWei = $derived.by(() => {
		const a = amount.trim();
		if (!/^\d*\.?\d+$|^\d+\.$/.test(a)) return null;
		try {
			return parseEth(a);
		} catch {
			return null;
		}
	});
	const feeWei = $derived(fees ? fees.maxFeePerGas * GAS_LIMIT : null);
	const totalWei = $derived(valueWei !== null && feeWei !== null ? valueWei + feeWei : null);
	const overBalance = $derived(balanceWei !== null && totalWei !== null && totalWei > balanceWei);

	const toError = $derived(touched && to.trim() && !toValid ? 'Enter a 0x address with 40 hex characters.' : '');
	const amountError = $derived(
		touched && amount.trim() && (valueWei === null || valueWei <= 0n)
			? 'Enter an amount greater than 0.'
			: mode === 'owner' && overBalance
				? 'Amount plus the maximum network fee is more than the balance.'
				: ''
	);
	const canSubmit = $derived(
		toValid && valueWei !== null && valueWei > 0n && (mode === 'refusal' || (!overBalance && !blocked))
	);

	function setMax() {
		if (balanceWei === null || feeWei === null) return;
		const max = balanceWei - feeWei;
		amount = max > 0n ? formatEth(max, 18) : '0';
		touched = true;
	}

	const steps = $derived.by((): Step[] => {
		const st = (key: 'sign' | 'broadcast' | 'confirm', activePhase: Phase, donePhases: Phase[]) =>
			failedAt === key ? 'error' : phase === activePhase ? 'active' : donePhases.includes(phase) ? 'done' : 'idle';
		return [
			{
				label: 'MPC signature',
				detail:
					failedAt === 'sign'
						? 'Refused before any signature was created.'
						: signed
							? `Signed with nonce ${signed.nonce}, recorded in the public log.`
							: 'The contract builds the transfer and asks the NEAR signing network to sign it.',
				state: st('sign', 'signing', ['broadcasting', 'confirming', 'done'])
			},
			{
				label: 'Broadcast to Sepolia',
				detail:
					failedAt === 'broadcast'
						? (err?.detail ?? 'Broadcast failed.')
						: txHash
							? 'Sent to the network.'
							: 'The signed transaction is sent with eth_sendRawTransaction.',
				state: st('broadcast', 'broadcasting', ['confirming', 'done'])
			},
			{
				label: receipt === 'reverted' ? 'Reverted' : 'Confirmed',
				detail:
					failedAt === 'confirm'
						? (err?.detail ?? 'No receipt yet.')
						: receipt === 'success'
							? 'Mined on Sepolia.'
							: 'Waiting for the transaction to be mined.',
				state: receipt === 'reverted' ? 'error' : st('confirm', 'confirming', ['done']),
				href: txHash ? etherscanTx(txHash) : undefined,
				hrefLabel: 'View on Etherscan'
			}
		];
	});

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		touched = true;
		if (!canSubmit || valueWei === null) return;
		err = null;
		failedAt = null;
		signed = null;
		txHash = null;
		receipt = null;
		phase = 'signing';
		try {
			signed = await requestTransfer({
				tokenId,
				to: to.trim() as Hex,
				valueWei,
				gasLimit: GAS_LIMIT,
				maxFeePerGas: fees?.maxFeePerGas,
				maxPriorityFeePerGas: fees?.maxPriorityFeePerGas
			});
		} catch (x) {
			fail('sign', x);
			onsettled?.();
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
				title: receipt === 'success' ? 'Transfer confirmed' : 'Transaction reverted',
				message: `${formatEth(BigInt(signed.valueWei))} ETH to ${signed.to.slice(0, 8)}…`,
				href: etherscanTx(txHash),
				linkLabel: 'View on Etherscan'
			});
		} catch (x) {
			fail('confirm', x);
		}
		onsettled?.();
	}

	function fail(at: 'sign' | 'broadcast' | 'confirm', x: unknown): DescribedError {
		const d = describeError(x, { contractCall: at === 'sign' });
		failedAt = at;
		err = d;
		phase = 'failed';
		if (at !== 'sign') onsettled?.();
		return d;
	}

	function again() {
		phase = 'form';
		failedAt = null;
		err = null;
		signed = null;
		txHash = null;
		receipt = null;
		if (mode === 'owner') {
			amount = '';
			to = '';
			touched = false;
		}
	}
</script>

{#if phase === 'form'}
	<form class="form" onsubmit={submit} novalidate>
		<div class="field">
			<label class="field-label" for="{uid}-to">Recipient</label>
			<input
				id="{uid}-to"
				class="input mono"
				placeholder="0x…"
				autocomplete="off"
				spellcheck="false"
				bind:value={to}
				onblur={() => (touched = true)}
				aria-invalid={toError ? 'true' : undefined}
				aria-describedby={toError ? `${uid}-to-err` : undefined}
			/>
			{#if toError}<span class="field-error" id="{uid}-to-err">{toError}</span>{/if}
		</div>

		<div class="field">
			<div class="field-label">
				<label for="{uid}-amt">Amount</label>
				{#if mode === 'owner' && balanceWei !== null}
					<button type="button" class="max" onclick={setMax} disabled={!feeWei} aria-label="Use maximum amount">
						Max {formatEth(balanceWei, 5)}
					</button>
				{/if}
			</div>
			<div class="input-group">
				<input
					id="{uid}-amt"
					class="input mono"
					inputmode="decimal"
					placeholder="0.0"
					autocomplete="off"
					bind:value={amount}
					onblur={() => (touched = true)}
					aria-invalid={amountError ? 'true' : undefined}
					aria-describedby="{uid}-fee"
				/>
				<span class="suffix">ETH</span>
			</div>
			{#if amountError}<span class="field-error">{amountError}</span>{/if}
		</div>

		<dl class="fees" id="{uid}-fee">
			<div>
				<dt>Gas limit</dt>
				<dd class="mono">21,000</dd>
			</div>
			<div>
				<dt>Max network fee</dt>
				<dd class="mono">
					{#if feeWei !== null}{formatEth(feeWei, 6)} ETH{:else if feesError}<button type="button" class="retry" onclick={loadFees}
							>Unavailable, retry</button
						>{:else}<span class="muted">estimating</span>{/if}
				</dd>
			</div>
			{#if signFee}
				<div>
					<dt>Signing fee</dt>
					<dd class="mono">{formatNear(signFee)} NEAR</dd>
				</div>
			{/if}
			{#if totalWei !== null}
				<div class="total">
					<dt>Max total from wallet</dt>
					<dd class="mono">{formatEth(totalWei, 6)} ETH</dd>
				</div>
			{/if}
		</dl>

		<Button type="submit" variant={mode === 'refusal' ? 'danger' : 'primary'} full icon={mode === 'refusal' ? 'ban' : 'send'} disabled={!canSubmit}>
			{mode === 'refusal' ? 'Try to spend (will be refused)' : 'Request signature and send'}
		</Button>
		<p class="fine">
			{#if mode === 'refusal'}
				The contract checks the caller against the NFT’s current owner before it asks for any signature.
			{:else}
				The contract only signs a plain ETH transfer it builds itself. Fees are set automatically from Sepolia.
			{/if}
		</p>
	</form>
{:else}
	<div class="progress">
		{#if err?.kind !== 'refused'}
			<Stepper {steps} label="Transfer progress" />
		{/if}

		{#if err?.kind === 'refused'}
			<div class="refusal" role="alert">
				<div class="r-head">
					<span class="r-ico"><Icon name="ban" size={16} stroke={2.25} /></span>
					<div>
						<p class="r-title">Refused by the contract</p>
						<p class="r-sub">No signature was created. The wallet is unchanged.</p>
					</div>
				</div>
				<pre class="r-msg"><span class="r-k">panic</span> {err.refusal}</pre>
			</div>
		{:else if err && failedAt === 'sign'}
			<Callout tone={err.kind === 'rejected' ? 'neutral' : err.kind === 'incomplete' ? 'busy' : 'bad'} title={err.title}
				>{err.detail}</Callout
			>
		{:else if err && failedAt === 'broadcast'}
			<Callout tone="dirty" title="Signed, but not broadcast yet">
				The signed transaction is in the public log and now counts as pending, so the wallet shows dirty until it lands. Anyone
				can broadcast it.
				{#snippet actions()}
					<Button size="sm" icon="radio" onclick={doBroadcast}>Retry broadcast</Button>
				{/snippet}
			</Callout>
		{/if}

		{#if phase === 'done' || phase === 'failed'}
			<div class="after">
				<Button variant="secondary" size="sm" onclick={again} icon={phase === 'done' ? 'plus' : 'refresh'}>
					{phase === 'done' ? 'New transfer' : 'Back to form'}
				</Button>
			</div>
		{/if}
	</div>
{/if}

<style>
	.form {
		display: grid;
		gap: 16px;
	}
	.max {
		font-size: var(--text-xs);
		font-weight: 500;
		color: var(--accent-text);
		font-family: var(--font-mono);
	}
	.max:hover:not(:disabled) {
		text-decoration: underline;
	}
	.max:disabled {
		color: var(--text-3);
		cursor: default;
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
	.fees .total {
		padding-top: 6px;
		border-top: 1px dashed var(--border-strong);
	}
	.fees .total dt,
	.fees .total dd {
		color: var(--text);
		font-weight: 500;
	}
	.retry {
		color: var(--accent-text);
		font-size: inherit;
	}
	.fine {
		font-size: var(--text-xs);
		color: var(--text-3);
		text-align: center;
		text-wrap: balance;
	}
	.progress {
		display: grid;
		gap: 16px;
	}
	.after {
		display: flex;
		justify-content: flex-start;
	}
	.refusal {
		border: 1px solid var(--bad-border);
		background: var(--bad-bg);
		border-radius: var(--radius-md);
		overflow: hidden;
		animation: fade-up var(--dur-3) var(--ease-out);
	}
	.r-head {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 10px;
		padding: 12px 14px;
	}
	.r-ico {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		border-radius: 50%;
		background: var(--bad-solid);
		color: #fff;
	}
	.r-title {
		font-weight: 600;
		color: var(--bad);
		font-size: var(--text-sm);
	}
	.r-sub {
		font-size: var(--text-xs);
		color: var(--text-2);
	}
	.r-msg {
		margin: 0;
		padding: 12px 14px;
		border-top: 1px solid var(--bad-border);
		background: color-mix(in srgb, var(--surface) 70%, var(--bad-bg));
		font-size: var(--text-xs);
		line-height: 1.6;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		color: var(--text);
	}
	.r-k {
		display: inline-block;
		margin-right: 6px;
		padding: 0 5px;
		border-radius: 3px;
		background: var(--bad-solid);
		color: #fff;
		font-size: var(--text-2xs);
		text-transform: uppercase;
		letter-spacing: var(--tracking-caps);
	}
</style>
