<script lang="ts">
	// The heart of verification: signatures the contract issued (its next_nonce)
	// side by side with the nonce Sepolia has confirmed for the address.
	let {
		issued,
		confirmed,
		mempool = confirmed,
		/** A nonce currently being signed (in flight) or reserved by an incomplete attempt */
		reservedNonce = null,
		max = 28
	}: { issued: number; confirmed: number; mempool?: number; reservedNonce?: number | null; max?: number } = $props();

	const total = $derived(Math.max(issued, confirmed, reservedNonce !== null ? reservedNonce + 1 : 0));
	const start = $derived(Math.max(0, total - max));
	const cells = $derived(Array.from({ length: total - start }, (_, i) => start + i));
	const relation = $derived(issued === confirmed ? '=' : issued > confirmed ? '>' : '<');
	const tone = $derived(
		confirmed > issued ? 'bad' : issued > confirmed ? 'dirty' : reservedNonce !== null ? 'busy' : 'clean'
	);
	const gap = $derived(Math.abs(issued - confirmed));

	function sigState(n: number): string {
		if (n < issued) return 'on';
		if (n === reservedNonce) return 'reserved';
		return 'missing';
	}
	function chainState(n: number): string {
		if (n < confirmed) return n < issued ? 'on' : 'rogue';
		if (n < mempool) return 'mempool';
		if (n < issued) return 'pending';
		return 'none';
	}
</script>

<div class="meter {tone}">
	<div class="compare">
		<div class="side">
			<span class="k">Contract issued</span>
			<span class="n tnum">{issued}</span>
			<span class="u">{issued === 1 ? 'signature' : 'signatures'}</span>
		</div>
		<div class="rel" aria-hidden="true">
			<span class="sym">{relation}</span>
		</div>
		<div class="side right">
			<span class="k">Sepolia nonce</span>
			<span class="n tnum">{confirmed}</span>
			<span class="u">confirmed</span>
		</div>
	</div>

	<p class="visually-hidden">
		The contract issued {issued} signatures and Sepolia has confirmed nonce {confirmed}.
		{#if relation === '='}They match.{:else if relation === '>'}{gap} signed {gap === 1 ? 'transaction is' : 'transactions are'} not mined yet.{:else}Sepolia is ahead of the contract log.{/if}
	</p>

	{#if total > 0}
		<div class="rows" aria-hidden="true">
			<div class="row">
				<span class="rk">Signed</span>
				<div class="cells" style:--n={cells.length}>
					{#each cells as n (n)}<span class="cell {sigState(n)}" title="nonce {n}"></span>{/each}
				</div>
			</div>
			<div class="row">
				<span class="rk">Mined</span>
				<div class="cells" style:--n={cells.length}>
					{#each cells as n (n)}<span class="cell {chainState(n)}" title="nonce {n}"></span>{/each}
				</div>
			</div>
			<div class="axis">
				<span class="rk"></span>
				<div class="cells ticks" style:--n={cells.length}>
					<span class="mono t">{start > 0 ? `…${start}` : '0'}</span>
					{#if cells.length > 1}<span class="mono t last" style:grid-column={cells.length}>{total - 1}</span>{/if}
				</div>
			</div>
		</div>
	{:else}
		<p class="none">No signatures issued yet. Both sides are at nonce 0.</p>
	{/if}

	<div class="legend" aria-hidden="true">
		{#if Math.min(issued, confirmed) > 0}<span><i class="cell on"></i>Signed and mined</span>{/if}
		{#if issued > mempool}<span><i class="cell pending"></i>Signed, not broadcast</span>{/if}
		{#if confirmed > issued}<span><i class="cell rogue"></i>Mined without a logged signature</span>{/if}
		{#if reservedNonce !== null}<span><i class="cell reserved"></i>Being signed or reserved</span>{/if}
		{#if mempool > confirmed}<span><i class="cell mempool"></i>In mempool</span>{/if}
	</div>
</div>

<style>
	.meter {
		display: grid;
		gap: 18px;
	}
	.compare {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		gap: 12px;
	}
	.side {
		display: grid;
		gap: 2px;
	}
	.side.right {
		text-align: right;
	}
	.k {
		font-family: var(--font-mono);
		font-size: var(--text-2xs);
		letter-spacing: var(--tracking-caps);
		text-transform: uppercase;
		color: var(--text-3);
	}
	.n {
		font-size: var(--text-3xl);
		font-weight: 600;
		line-height: 1.1;
		letter-spacing: var(--tracking-display);
		color: var(--text);
	}
	.u {
		font-size: var(--text-xs);
		color: var(--text-3);
	}
	.rel {
		display: grid;
		place-items: center;
	}
	.sym {
		display: grid;
		place-items: center;
		width: 40px;
		height: 40px;
		border-radius: 50%;
		font-family: var(--font-mono);
		font-size: var(--text-xl);
		font-weight: 500;
		border: 1px solid;
	}
	.clean .sym {
		color: var(--clean);
		background: var(--clean-bg);
		border-color: var(--clean-border);
	}
	.dirty .sym {
		color: var(--dirty);
		background: var(--dirty-bg);
		border-color: var(--dirty-border);
	}
	.busy .sym {
		color: var(--busy);
		background: var(--busy-bg);
		border-color: var(--busy-border);
	}
	.bad .sym {
		color: var(--bad);
		background: var(--bad-bg);
		border-color: var(--bad-border);
	}

	.rows {
		display: grid;
		gap: 6px;
	}
	.row,
	.axis {
		display: grid;
		grid-template-columns: 52px 1fr;
		align-items: center;
		gap: 10px;
	}
	.rk {
		font-size: var(--text-xs);
		color: var(--text-3);
	}
	.cells {
		display: grid;
		grid-template-columns: repeat(var(--n), minmax(0, 34px));
		gap: 3px;
	}
	.cell {
		display: block;
		height: 20px;
		border-radius: 3px;
		border: 1px solid var(--border-strong);
		background: var(--surface-sunken);
		transition:
			background-color var(--dur-3) var(--ease-out),
			border-color var(--dur-3) var(--ease-out);
	}
	.cell.on {
		background: var(--clean-solid);
		border-color: var(--clean-solid);
	}
	.cell.pending {
		border-color: var(--dirty-solid);
		background: repeating-linear-gradient(
			-45deg,
			color-mix(in srgb, var(--dirty-solid) 55%, transparent) 0 2px,
			transparent 2px 5px
		);
	}
	.cell.mempool {
		border-color: var(--busy-solid);
		background: color-mix(in srgb, var(--busy-solid) 30%, transparent);
	}
	.cell.reserved {
		border-color: var(--busy-solid);
		border-style: dashed;
		background: color-mix(in srgb, var(--busy-solid) 14%, transparent);
	}
	.cell.rogue {
		background: var(--bad-solid);
		border-color: var(--bad-solid);
	}
	.cell.none,
	.cell.missing {
		border-style: dashed;
		background: transparent;
	}
	.ticks {
		font-size: var(--text-2xs);
		color: var(--text-3);
		line-height: 1;
	}
	.t {
		grid-row: 1;
		white-space: nowrap;
	}
	.t.last {
		justify-self: end;
	}
	.none {
		font-size: var(--text-sm);
		color: var(--text-3);
		padding: 10px 12px;
		border: 1px dashed var(--border-strong);
		border-radius: var(--radius-md);
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 16px;
		font-size: var(--text-xs);
		color: var(--text-3);
	}
	.legend span {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.legend .cell {
		width: 12px;
		height: 12px;
		flex: none;
		border-radius: 3px;
	}
</style>
