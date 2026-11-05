<script lang="ts">
	import { describeTokenCall, etherscanTx, formatEth, nsToDate, shortHex, type SignedTx } from '$lib/chain';
	import Badge from './Badge.svelte';
	import Button from './Button.svelte';
	import CopyButton from './CopyButton.svelte';
	import Icon from './Icon.svelte';
	import { formatDateTime, relativeTime } from './time';

	let {
		log,
		chainNonce,
		mempoolNonce = chainNonce,
		onbroadcast,
		broadcasting = null
	}: {
		log: SignedTx[];
		chainNonce: number;
		mempoolNonce?: number;
		onbroadcast?: (tx: SignedTx) => void;
		broadcasting?: number | null;
	} = $props();

	const rows = $derived([...log].sort((a, b) => b.nonce - a.nonce));

	function status(tx: SignedTx): 'mined' | 'mempool' | 'pending' {
		if (tx.nonce < chainNonce) return 'mined';
		if (tx.nonce < mempoolNonce) return 'mempool';
		return 'pending';
	}
	function safeDate(ns: string): Date | null {
		try {
			return nsToDate(ns);
		} catch {
			return null;
		}
	}
	function safeEth(v: string): string {
		try {
			return formatEth(BigInt(v));
		} catch {
			return v;
		}
	}
</script>

<div class="wrap">
	<table class="log">
		<caption class="visually-hidden">Every signature the contract issued for this wallet, newest first</caption>
		<thead>
			<tr>
				<th scope="col" class="c-nonce">Nonce</th>
				<th scope="col">To</th>
				<th scope="col" class="num">Value</th>
				<th scope="col">Tx hash</th>
				<th scope="col">Signed</th>
				<th scope="col" class="c-status">Status</th>
			</tr>
		</thead>
		<tbody>
			{#each rows as tx (tx.nonce)}
				{@const st = status(tx)}
				{@const d = safeDate(tx.signedAtNs)}
				{@const tc = describeTokenCall(tx.rawSignedTxHex)}
				<tr class={st}>
					<td class="c-nonce" data-label="Nonce"><span class="mono nonce">{tx.nonce}</span></td>
					<td data-label="To">
						{#if tc}
							<span class="mono addr" title={tc.recipient}>{shortHex(tc.recipient, 4)}</span>
						{:else}
							<span class="mono addr" title={tx.to}>{shortHex(tx.to, 4)}</span>
						{/if}
					</td>
					<td class="num" data-label="Value">
						{#if tc}
							<span class="mono" title="Token contract {tc.token}"
								>{tc.standard === 'erc721' ? `#${tc.id}` : tc.standard === 'erc1155' ? `${tc.amount} × #${tc.id}` : tc.amount.toString()}</span
							>
							<span class="unit">{tc.standard === 'erc20' ? 'ERC-20 units' : tc.standard === 'erc721' ? 'ERC-721' : 'ERC-1155'}</span>
						{:else}
							<span class="mono">{safeEth(tx.valueWei)}</span> <span class="unit">ETH</span>
						{/if}
					</td>
					<td data-label="Tx hash">
						<span class="hash">
							<a class="mono link-plain" href={etherscanTx(tx.txHash)} target="_blank" rel="noreferrer noopener" title={tx.txHash}
								>{shortHex(tx.txHash, 5)}<Icon name="arrow-up-right" size={12} /></a
							>
							<CopyButton value={tx.txHash} label="Copy transaction hash" size={12} />
						</span>
					</td>
					<td data-label="Signed">
						{#if d}<time datetime={d.toISOString()} title={formatDateTime(d)}>{relativeTime(d)}</time>{:else}<span class="muted">-</span>{/if}
					</td>
					<td class="c-status" data-label="Status">
						{#if st === 'mined'}
							<Badge tone="clean" size="sm" icon="check">Mined</Badge>
						{:else if st === 'mempool'}
							<Badge tone="busy" size="sm" dot>In mempool</Badge>
						{:else}
							<span class="pend">
								<Badge tone="dirty" size="sm" dot>Not broadcast</Badge>
								{#if onbroadcast}
									<Button size="sm" variant="secondary" icon="radio" loading={broadcasting === tx.nonce} onclick={() => onbroadcast?.(tx)}>
										Broadcast
									</Button>
								{/if}
							</span>
						{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	.wrap {
		width: 100%;
		overflow-x: auto;
		container-type: inline-size;
	}
	.log {
		font-size: var(--text-sm);
	}
	th {
		text-align: left;
		font-weight: 500;
		font-size: var(--text-xs);
		color: var(--text-3);
		padding: 10px 14px;
		border-bottom: 1px solid var(--border);
		background: var(--surface-2);
		white-space: nowrap;
	}
	th:first-child,
	td:first-child {
		padding-left: 20px;
	}
	th:last-child,
	td:last-child {
		padding-right: 20px;
	}
	td {
		padding: 12px 14px;
		border-bottom: 1px solid var(--border);
		vertical-align: middle;
		white-space: nowrap;
	}
	tbody tr:last-child td {
		border-bottom: 0;
	}
	tbody tr {
		transition: background-color var(--dur-1);
	}
	tbody tr:hover {
		background: var(--surface-2);
	}
	tr.pending {
		background: color-mix(in srgb, var(--dirty-bg) 60%, transparent);
	}
	.num {
		text-align: right;
	}
	.nonce {
		display: inline-grid;
		place-items: center;
		min-width: 28px;
		height: 22px;
		padding: 0 6px;
		border-radius: var(--radius-xs);
		background: var(--surface-sunken);
		border: 1px solid var(--border);
		font-size: var(--text-xs);
		font-weight: 500;
	}
	.unit {
		color: var(--text-3);
		font-size: var(--text-xs);
	}
	.hash {
		display: inline-flex;
		align-items: center;
		gap: 2px;
	}
	.link-plain {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		color: var(--text);
	}
	.link-plain:hover {
		color: var(--accent-text);
	}
	time {
		color: var(--text-2);
	}
	.c-status {
		text-align: right;
	}
	.pend {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}

	@container (max-width: 640px) {
		thead {
			display: none;
		}
		.log,
		tbody {
			display: block;
		}
		tr {
			display: grid;
			grid-template-columns: auto minmax(0, 1fr) auto;
			grid-template-areas:
				'n val st'
				'n to time'
				'n hash hash';
			gap: 4px 12px;
			padding: 14px 16px;
			border-bottom: 1px solid var(--border);
		}
		tbody tr:last-child {
			border-bottom: 0;
		}
		td,
		td:first-child,
		td:last-child {
			display: block;
			padding: 0;
			border: 0;
			text-align: left;
			white-space: nowrap;
			min-width: 0;
		}
		td:nth-child(1) {
			grid-area: n;
		}
		td:nth-child(2) {
			grid-area: to;
			color: var(--text-2);
			font-size: var(--text-xs);
		}
		td.num {
			text-align: left;
		}
		td:nth-child(3) {
			grid-area: val;
			font-weight: 500;
		}
		td:nth-child(4) {
			grid-area: hash;
			font-size: var(--text-xs);
		}
		td:nth-child(5) {
			grid-area: time;
			text-align: right;
			font-size: var(--text-xs);
		}
		td:nth-child(6) {
			grid-area: st;
			text-align: right;
		}
		td:nth-child(2)::before {
			content: 'to ';
			color: var(--text-3);
		}
	}
</style>
