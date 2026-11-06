<script lang="ts">
	// v2: empty the wallet to one address. Every token the index lists goes first, then the ETH
	// that is left after gas. Each item is its own contract-built transfer and MPC signature, so the
	// owner approves each one in their NEAR wallet; the sweep stops at the first failure.
	import {
		broadcast,
		clampFees,
		encodeTokenTransfer,
		etherscanTx,
		formatEth,
		getBalance,
		getFees,
		MIN_GAS_LIMIT,
		requestTokenTransfer,
		requestTransfer,
		tokenTransferGasLimit,
		transferGasLimit,
		waitForMined,
		type Hex,
		type TokenHolding
	} from '$lib/chain';
	import { formatUnits } from 'viem';
	import Button from './Button.svelte';
	import { describeError } from './errors';
	import { toast } from './toast.svelte';

	let {
		tokenId,
		fromAddress,
		holdings = [],
		blocked = null,
		onsettled
	}: {
		tokenId: string;
		/** The wallet's pinned address (needed for token transfers) */
		fromAddress: Hex | null;
		holdings?: TokenHolding[];
		blocked?: string | null;
		onsettled?: () => void;
	} = $props();

	const uid = $props.id();
	let to = $state('');
	type Status = 'waiting' | 'signing' | 'sending' | 'done' | 'failed' | 'skipped';
	interface Item {
		label: string;
		status: Status;
		txHash?: Hex;
		error?: string;
	}
	let items = $state<Item[]>([]);
	let running = $state(false);
	// Block of the last mined sweep transfer; the ETH balance is read there so a lagging RPC node cannot report it stale.
	let lastBlock: bigint | undefined;

	const toAddr = $derived(/^0x[0-9a-fA-F]{40}$/.test(to.trim()) ? (to.trim() as Hex) : null);
	const canRun = $derived(!!toAddr && !!fromAddress && !running && !blocked);

	const label = (h: TokenHolding) =>
		h.standard === 'erc20'
			? `${formatUnits(h.amount, h.decimals)} ${h.symbol || 'tokens'} (ERC-20)`
			: h.standard === 'erc721'
				? `${h.symbol || 'NFT'} #${h.id} (ERC-721)`
				: `${h.amount} × ${h.symbol || 'item'} #${h.id} (ERC-1155)`;

	function set(i: number, patch: Partial<Item>) {
		items[i] = { ...items[i], ...patch };
	}

	async function send(signed: { rawSignedTxHex: Hex }, i: number): Promise<boolean> {
		set(i, { status: 'sending' });
		const hash = await broadcast(signed.rawSignedTxHex);
		set(i, { txHash: hash });
		const r = await waitForMined(hash);
		lastBlock = r.blockNumber;
		if (r.status !== 'success') {
			set(i, { status: 'failed', error: 'Reverted on Sepolia.' });
			return false;
		}
		set(i, { status: 'done' });
		return true;
	}

	async function balanceAfterTokens(from: Hex): Promise<bigint> {
		for (let i = 0; ; i++) {
			try {
				return await getBalance(from, lastBlock);
			} catch (x) {
				if (i >= 5) throw x;
				await new Promise((r) => setTimeout(r, 3000));
			}
		}
	}

	async function run() {
		if (!canRun || !toAddr || !fromAddress) return;
		const from = fromAddress;
		const recipient = toAddr;
		const list = [...holdings];
		items = [...list.map((h) => ({ label: label(h), status: 'waiting' as Status })), { label: 'Remaining ETH', status: 'waiting' }];
		running = true;
		lastBlock = undefined;
		try {
			const fees = clampFees(await getFees());
			for (let i = 0; i < list.length; i++) {
				const h = list[i];
				const id = BigInt(h.id ?? 0);
				set(i, { status: 'signing' });
				try {
					const gasLimit = await tokenTransferGasLimit(from, h.token, encodeTokenTransfer(h.standard, from, recipient, id, h.amount));
					if (gasLimit === null) throw new Error('Needs more gas than the contract signs.');
					const signed = await requestTokenTransfer({
						tokenId,
						standard: h.standard,
						token: h.token,
						to: recipient,
						id,
						amount: h.amount,
						gasLimit,
						...fees
					});
					if (!(await send(signed, i))) return;
				} catch (x) {
					set(i, { status: 'failed', error: describeError(x, { contractCall: true }).detail });
					return;
				}
			}
			// ETH last, so every token transfer above still had gas.
			const e = items.length - 1;
			set(e, { status: 'signing' });
			try {
				const balance = await balanceAfterTokens(from);
				const gasLimit = (await transferGasLimit(from, recipient, 1n)) ?? MIN_GAS_LIMIT;
				const value = balance - gasLimit * fees.maxFeePerGas;
				if (value <= 0n) {
					set(e, { status: 'skipped', error: 'Nothing left after the network fee.' });
				} else {
					set(e, { label: `${formatEth(value, 6)} ETH (all but the fee)` });
					const signed = await requestTransfer({ tokenId, to: recipient, valueWei: value, gasLimit, ...fees });
					if (!(await send(signed, e))) return;
				}
			} catch (x) {
				set(e, { status: 'failed', error: describeError(x, { contractCall: true }).detail });
				return;
			}
			toast({ tone: 'success', title: 'Wallet emptied', message: `Everything sent to ${recipient.slice(0, 8)}…` });
		} finally {
			running = false;
			onsettled?.();
		}
	}

	const statusText: Record<Status, string> = {
		waiting: 'Waiting',
		signing: 'Approve in your wallet',
		sending: 'Sending',
		done: 'Done',
		failed: 'Failed',
		skipped: 'Skipped'
	};
</script>

<div class="sweep">
	<div class="field">
		<label class="field-label" for="{uid}-to">Send everything to</label>
		<input id="{uid}-to" class="input mono" placeholder="0x…" autocomplete="off" spellcheck="false" bind:value={to} disabled={running} />
	</div>

	{#if items.length}
		<ol class="items">
			{#each items as it, i (i)}
				<li class={it.status}>
					<span class="mono lbl">{it.label}</span>
					<span class="st">
						{statusText[it.status]}{#if it.txHash}
							· <a class="link" href={etherscanTx(it.txHash)} target="_blank" rel="noreferrer">tx</a>{/if}
					</span>
					{#if it.error}<span class="field-error">{it.error}</span>{/if}
				</li>
			{/each}
		</ol>
	{:else}
		<ul class="items preview">
			{#each holdings as h (h.token + (h.id ?? ''))}
				<li><span class="mono lbl">{label(h)}</span></li>
			{/each}
			<li><span class="mono lbl">Remaining ETH (all but the network fee)</span></li>
		</ul>
	{/if}

	<Button variant="primary" full icon="send" loading={running} disabled={!canRun} onclick={run}>
		Send everything ({holdings.length + 1} {holdings.length ? "transfers" : "transfer"})
	</Button>
	<p class="fine">
		Each transfer is its own signature, so approve each one in your NEAR wallet. Tokens go first and ETH last, so gas stays
		covered. Tokens missing from the index are not included: send those with the form above.
	</p>
</div>

<style>
	.sweep {
		display: grid;
		gap: 16px;
	}
	.items {
		display: grid;
		gap: 8px;
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: var(--text-xs);
	}
	.items li {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 4px 12px;
		padding: 8px 10px;
		border-radius: var(--radius-md);
		background: var(--surface-2);
		border: 1px solid var(--border);
	}
	.items .field-error {
		grid-column: 1 / -1;
	}
	.lbl {
		color: var(--text);
		overflow-wrap: anywhere;
	}
	.st {
		color: var(--text-3);
	}
	.done .st {
		color: var(--clean);
	}
	.failed .st {
		color: var(--bad);
	}
	.signing .st,
	.sending .st {
		color: var(--accent-text);
	}
	.fine {
		font-size: var(--text-xs);
		color: var(--text-3);
		text-align: center;
		text-wrap: balance;
	}
</style>
