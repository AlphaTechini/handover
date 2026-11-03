<script lang="ts">
	import { HANDOVER_CONTRACT, MPC_CONTRACT, isConfigured, nearblocksAccount } from '$lib/chain';
	import Button from '$lib/ui/Button.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import VerdictBadge from '$lib/ui/VerdictBadge.svelte';
	import { marketHref, mintHref, NFT_CHAIN_KEYS_URL } from '$lib/ui/links';

	const contract = isConfigured() ? HANDOVER_CONTRACT : 'handover contract';

	const toc = [
		{ id: 'mechanism', label: 'The mechanism' },
		{ id: 'diagram', label: 'Who signs what' },
		{ id: 'invariant', label: 'The invariant' },
		{ id: 'clean-check', label: 'The clean check' },
		{ id: 'buying', label: 'Buying safely' },
		{ id: 'recovery', label: 'Reserved and stuck requests' },
		{ id: 'prior-art', label: 'What Handover adds' },
		{ id: 'limits', label: 'Security model and limits' }
	];
</script>

<svelte:head><title>How it works · Handover</title></svelte:head>

<div class="container page">
	<header class="page-head hero">
		<div>
			<span class="eyebrow">How it works</span>
			<h1>A wallet you can sell, and a sale you can check</h1>
			<p class="lede">
				Handover pairs NEAR Chain Signatures with a contract that keeps every signature public, freezes signing during a
				sale, and settles payment and transfer in one call.
			</p>
		</div>
	</header>

	<div class="doc">
		<nav class="toc" aria-label="On this page">
			<p class="eyebrow">On this page</p>
			<ol>
				{#each toc as t, i (t.id)}
					<li><a href="#{t.id}"><span class="mono n">{String(i + 1).padStart(2, '0')}</span>{t.label}</a></li>
				{/each}
			</ol>
		</nav>

		<article class="prose">
			<section id="mechanism">
				<h2>The mechanism</h2>
				<p>
					Each Handover NFT has its own Ethereum address, derived from the Handover contract’s account and the path
					<code>handover-&lt;token id&gt;</code>. Only the Handover contract can ask NEAR’s signing network for signatures
					on that address, and it only does so:
				</p>
				<ul class="checks">
					<li><Icon name="check" size={14} stroke={2.25} />for the NFT’s current owner,</li>
					<li><Icon name="check" size={14} stroke={2.25} />for plain ETH transfers the contract builds itself, with empty calldata,</li>
					<li><Icon name="check" size={14} stroke={2.25} />with nonces it hands out one by one and records in a public log.</li>
				</ul>
				<p>
					To sell, the owner lists the NFT, which freezes signing. Anyone can then check that the address’s nonce on Sepolia
					has caught up with the last nonce the contract issued. That proves no signed transaction is still waiting to be
					broadcast. The buyer pays and receives the NFT in one call.
				</p>
			</section>

			<section id="diagram">
				<h2>Who signs what</h2>
				<p>No one holds a private key for a Handover wallet. The key is split across NEAR’s MPC network, and only the contract can ask it to sign for this path.</p>

				<figure class="diagram card">
					<svg viewBox="0 0 800 300" role="img" aria-labelledby="dg-t dg-d">
						<title id="dg-t">Signing flow</title>
						<desc id="dg-d">
							The owner calls the Handover contract on NEAR. The contract builds the transfer and asks the MPC signing
							network to sign it for the wallet's derivation path. The signature returns to the contract, which records it
							in the public log. Anyone can take the signed transaction from the log and broadcast it to the wallet's
							Ethereum address on Sepolia. That address is derived from the contract account and the path, and no one
							holds its private key.
						</desc>
						<defs>
							<marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
								<path d="M0 0L10 5L0 10z" class="ah" />
							</marker>
							<marker id="ah-a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
								<path d="M0 0L10 5L0 10z" class="ah-a" />
							</marker>
							<marker id="ah-c" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
								<path d="M0 0L10 5L0 10z" class="ah-c" />
							</marker>
						</defs>

						<rect x="8" y="8" width="592" height="284" rx="12" class="lane-bg" />
						<rect x="612" y="8" width="180" height="284" rx="12" class="lane-bg" />
						<text x="24" y="280" class="lane">NEAR TESTNET</text>
						<text x="628" y="280" class="lane">ETHEREUM SEPOLIA</text>

						<!-- edges first so nodes sit on top -->
						<path d="M275 76C275 26 705 26 705 74" class="edge dash" marker-end="url(#ah-c)" />
						<rect x="404" y="27" width="170" height="16" rx="4" class="label-bg" />
						<text x="489" y="39" class="el" text-anchor="middle">address = derive(contract, path)</text>

						<path d="M140 104H188" class="edge" marker-end="url(#ah)" />
						<text x="164" y="96" class="el" text-anchor="middle">request</text>

						<path d="M360 96H428" class="edge" marker-end="url(#ah)" />
						<text x="394" y="88" class="el" text-anchor="middle">sign</text>
						<path d="M430 114H362" class="edge soft" marker-end="url(#ah-a)" />
						<text x="396" y="130" class="el" text-anchor="middle">signature</text>

						<path d="M275 138V194" class="edge" marker-end="url(#ah)" />
						<text x="283" y="170" class="el">record</text>

						<path d="M360 228H628" class="edge" marker-end="url(#ah)" />
						<text x="480" y="220" class="el" text-anchor="middle">signed tx, readable by anyone</text>

						<path d="M705 196V140" class="edge" marker-end="url(#ah)" />
						<text x="713" y="172" class="el">broadcast</text>

						<!-- nodes -->
						<g transform="translate(20 76)">
							<rect width="120" height="60" rx="10" class="node" />
							<text x="14" y="26" class="nt">Owner</text>
							<text x="14" y="44" class="ns">NEAR account</text>
						</g>
						<g transform="translate(190 76)">
							<rect width="170" height="60" rx="10" class="node accent" />
							<text x="14" y="26" class="nt">Handover contract</text>
							<text x="14" y="44" class="ns mono-s">builds the transfer</text>
						</g>
						<g transform="translate(430 76)">
							<rect width="156" height="60" rx="10" class="node" />
							<text x="14" y="26" class="nt">MPC network</text>
							<text x="14" y="44" class="ns mono-s">{MPC_CONTRACT}</text>
						</g>
						<g transform="translate(190 196)">
							<rect width="170" height="60" rx="10" class="node" />
							<text x="14" y="26" class="nt">Public signature log</text>
							<text x="14" y="44" class="ns mono-s">nonce 0, 1, 2, …</text>
						</g>
						<g transform="translate(628 76)">
							<rect width="154" height="60" rx="10" class="node clean" />
							<text x="14" y="26" class="nt">Wallet address</text>
							<text x="14" y="44" class="ns mono-s">no private key</text>
						</g>
						<g transform="translate(628 196)">
							<rect width="154" height="60" rx="10" class="node" />
							<text x="14" y="26" class="nt">Anyone</text>
							<text x="14" y="44" class="ns">relays to Sepolia</text>
						</g>
					</svg>
				</figure>
			</section>

			<section id="invariant">
				<h2>The invariant</h2>
				<blockquote class="inv">
					Once a Handover wallet shows <span class="cw">clean</span>, no one but the next owner can ever move its funds.
				</blockquote>
				<p>Why this holds, step by step:</p>
				<ol class="steps">
					<li>
						<span class="mono sn">1</span>
						<p>The contract is the only party that can get a signature for the address, so its log is the complete list of every signature that exists.</p>
					</li>
					<li>
						<span class="mono sn">2</span>
						<p>Ethereum accepts each nonce once, in order. When Sepolia’s nonce equals the contract’s next nonce, every logged signature has been used and none can be replayed.</p>
					</li>
					<li>
						<span class="mono sn">3</span>
						<p>Listing freezes signing, so no new signature can appear between the check and the purchase.</p>
					</li>
					<li>
						<span class="mono sn">4</span>
						<p>Only plain transfers are ever signed, so no token approval can outlive the sale. After the purchase, requests from the old owner are refused.</p>
					</li>
				</ol>
			</section>

			<section id="clean-check">
				<h2>The clean check</h2>
				<p>
					Anyone can run it, and this app runs it in your browser. It reads two numbers and compares them, then checks that
					the log itself is well formed.
				</p>

				<div class="formula card">
					<div class="f-side">
						<span class="eyebrow">From the contract</span>
						<code class="f-code">next_nonce</code>
						<span class="f-sub">signatures ever issued</span>
					</div>
					<span class="f-eq mono" aria-hidden="true">=</span>
					<div class="f-side">
						<span class="eyebrow">From Sepolia</span>
						<code class="f-code">eth_getTransactionCount</code>
						<span class="f-sub">confirmed nonce of the address</span>
					</div>
				</div>

				<p>
					The check also recovers the signer of every transaction in the log. Each one must have been signed by the
					wallet’s own key, and the address the contract recorded at the first signature must match the address derived
					from the signing network. A transaction signed by any other key makes the wallet inconsistent.
				</p>

				<p>The verdict, evaluated in this order:</p>
				<div class="vtable card">
					<div class="vrow">
						<VerdictBadge verdict="inconsistent" size="sm" />
						<p>The log does not hold nonces 0 to next_nonce minus 1 exactly once, or Sepolia is ahead of the contract. Something moved the address without a logged signature. Do not buy.</p>
					</div>
					<div class="vrow">
						<VerdictBadge verdict="busy" size="sm" />
						<p>A signature request is in flight. A new signed transaction may appear at any moment.</p>
					</div>
					<div class="vrow">
						<VerdictBadge verdict="busy" size="sm" />
						<p>An <code>nft_transfer_call</code> has not resolved yet, so the owner may still change. Check again once it settles.</p>
					</div>
					<div class="vrow">
						<VerdictBadge verdict="dirty" pending={1} size="sm" />
						<p>Sepolia’s nonce is behind. The logged transactions from that nonce up are signed but not mined. Anyone can broadcast them to clear it.</p>
					</div>
					<div class="vrow">
						<VerdictBadge verdict="clean" size="sm" />
						<p>The numbers match. Every signature ever issued is already on chain.</p>
					</div>
				</div>
			</section>

			<section id="buying">
				<h2>Buying safely</h2>
				<ul class="flow">
					<li>
						<span class="fi"><Icon name="lock" size={15} /></span>
						<div><p class="ft">The seller lists</p><p>Signing freezes. The contract refuses new signatures, and listing is refused while a request is in flight.</p></div>
					</li>
					<li>
						<span class="fi"><Icon name="shield-check" size={15} /></span>
						<div><p class="ft">The buyer re-checks</p><p>The Buy button stays disabled until a clean check has passed in the last 60 seconds. The purchase carries the nonce that check saw, as <code>expected_next_nonce</code>.</p></div>
					</li>
					<li>
						<span class="fi"><Icon name="swap" size={15} /></span>
						<div><p class="ft">One call settles it</p><p><code>buy</code> takes exactly the listed price, with no overpay. It transfers the NFT, pays the seller and clears the listing together. If the wallet signed anything since your check, or any part fails, none of it happens.</p></div>
					</li>
					<li>
						<span class="fi"><Icon name="ban" size={15} /></span>
						<div><p class="ft">The old owner is refused</p><p>The next signature request from the seller fails with the contract’s own error. The buyer’s first transfer goes through.</p></div>
					</li>
				</ul>
			</section>

			<section id="recovery">
				<h2>Reserved transactions and stuck requests</h2>
				<p>
					Before the contract asks the signing network for a signature, it reserves the exact transaction for the next nonce.
					If the attempt does not finish, a signature for it may still exist, so the reservation stays. The owner can only
					retry that same transaction, and listing and selling are blocked until it is logged.
				</p>
				<p>
					If the signing network never answers, the owner can call <code>release_stuck</code> after the release window of
					NEAR blocks has passed. It frees the wallet from the pending request and keeps the same transaction reserved, so
					nothing new can be signed in its place. The contract also records the signer address at the first signature and
					treats any later signature from a different key as a failed attempt.
				</p>
			</section>

			<section id="prior-art">
				<h2>What Handover adds to NFT Chain Keys</h2>
				<p>
					<a class="link" href={NFT_CHAIN_KEYS_URL} target="_blank" rel="noreferrer noopener">NFT Chain Keys</a>
					showed first that an NFT can control a Chain Signatures key. Handover does not claim to invent that. Owning the NFT
					is not enough to make a sale safe, so Handover adds:
				</p>
				<div class="adds">
					<div class="add card">
						<p class="eyebrow">Prior art</p>
						<ul>
							<li><Icon name="check" size={14} />An NFT that controls a Chain Signatures key</li>
							<li><Icon name="check" size={14} />The NFT owner can request signatures</li>
						</ul>
					</div>
					<div class="add card accent">
						<p class="eyebrow">Added by Handover</p>
						<ul>
							<li><Icon name="plus" size={14} />A public, strictly sequential signature log</li>
							<li><Icon name="plus" size={14} />Signing frozen while listed</li>
							<li><Icon name="plus" size={14} />Only plain ETH transfers, built by the contract, with a fixed 21,000 gas limit</li>
							<li><Icon name="plus" size={14} />A locked contract with no upgrade path</li>
							<li><Icon name="plus" size={14} />Atomic payment and transfer, gated by a clean check</li>
						</ul>
					</div>
				</div>
			</section>

			<section id="limits">
				<h2>Security model and limits</h2>
				<ul class="limits">
					<li>
						<p class="ft">You trust NEAR’s MPC network</p>
						<p>The signing key is shared across the network’s nodes. If enough of them colluded they could sign for any derived address. Handover inherits that assumption from Chain Signatures.</p>
					</li>
					<li>
						<p class="ft">Gifting needs a check on the receiving side</p>
						<p>Standard <code>nft_transfer</code> still works, as NEP-171 requires, but it does not freeze or check anything. If someone sends you a wallet, open it here and run the clean check before you rely on it.</p>
					</li>
					<li>
						<p class="ft">The check trusts the RPCs it reads</p>
						<p>This app reads the contract and Sepolia through public RPC endpoints. For high value, run the same comparison against your own nodes.</p>
					</li>
					<li>
						<p class="ft">A locked contract cannot be upgraded</p>
						<p>
							The contract is meant to be locked after its final deploy by deleting its full-access keys. You can verify that on the
							contract account’s access keys{#if isConfigured()}
								(<a class="link" href={nearblocksAccount(HANDOVER_CONTRACT)} target="_blank" rel="noreferrer noopener">{contract}</a>){/if}. Redeploying to a new account would change every wallet address.
						</p>
					</li>
					<li>
						<p class="ft">Testnets and ETH only</p>
						<p>Handover runs on NEAR testnet and Ethereum Sepolia. It moves ETH only: token transfers are not supported in this version. Never send real funds.</p>
					</li>
				</ul>
			</section>

			<div class="end card">
				<div>
					<h3>See it on testnet</h3>
					<p class="secondary">Mint a wallet, spend from it, then list it and watch the verdict.</p>
				</div>
				<div class="end-ctas">
					<Button variant="primary" href={mintHref()} icon="plus">Mint a wallet</Button>
					<Button variant="secondary" href={marketHref()}>Market</Button>
				</div>
			</div>
		</article>
	</div>
</div>

<style>
	.hero h1 {
		font-size: clamp(1.75rem, 1.2rem + 2vw, 2.5rem);
		max-width: 20ch;
	}
	.doc {
		display: grid;
		grid-template-columns: 200px minmax(0, 1fr);
		gap: 56px;
		align-items: start;
	}
	.toc {
		position: sticky;
		top: calc(var(--nav-h) + 32px);
		display: grid;
		gap: 10px;
	}
	.toc ol {
		display: grid;
		gap: 2px;
		border-left: 1px solid var(--border);
	}
	.toc a {
		display: flex;
		gap: 10px;
		padding: 5px 12px;
		margin-left: -1px;
		border-left: 1px solid transparent;
		font-size: var(--text-sm);
		color: var(--text-2);
		transition:
			color var(--dur-1),
			border-color var(--dur-1);
	}
	.toc a:hover {
		color: var(--text);
		border-left-color: var(--text);
	}
	.toc .n {
		font-size: var(--text-2xs);
		color: var(--text-3);
		padding-top: 2px;
	}
	.prose {
		display: grid;
		gap: 56px;
		max-width: 760px;
		min-width: 0;
	}
	.prose section {
		display: grid;
		gap: 14px;
		scroll-margin-top: calc(var(--nav-h) + 24px);
	}
	.prose h2 {
		font-size: var(--text-xl);
	}
	.prose p {
		color: var(--text-2);
		font-size: var(--text-md);
		line-height: 1.65;
	}
	code {
		font-size: 0.88em;
		padding: 1px 5px;
		border-radius: 4px;
		background: var(--surface-sunken);
		border: 1px solid var(--border);
		color: var(--text);
		white-space: nowrap;
	}
	.checks {
		display: grid;
		gap: 6px;
	}
	.checks li {
		display: flex;
		gap: 10px;
		align-items: baseline;
		font-size: var(--text-md);
		color: var(--text);
	}
	.checks li :global(svg) {
		color: var(--clean);
		transform: translateY(2px);
	}

	.diagram {
		padding: 16px;
		margin-top: 6px;
		overflow-x: auto;
	}
	.diagram svg {
		min-width: 640px;
		width: 100%;
		height: auto;
	}
	.lane {
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: 0.08em;
		fill: var(--text-3);
	}
	.lane-bg {
		fill: var(--bg-subtle);
		stroke: var(--border);
	}
	.label-bg {
		fill: var(--bg-subtle);
	}
	.node {
		fill: var(--surface-2);
		stroke: var(--border-strong);
	}
	.node.accent {
		fill: var(--accent-soft);
		stroke: var(--accent-border);
	}
	.node.clean {
		fill: var(--clean-bg);
		stroke: var(--clean-border);
	}
	.nt {
		font-size: 13px;
		font-weight: 600;
		fill: var(--text);
	}
	.ns {
		font-size: 11px;
		fill: var(--text-3);
	}
	.mono-s {
		font-family: var(--font-mono);
		font-size: 10px;
	}
	.edge {
		fill: none;
		stroke: var(--text-2);
		stroke-width: 1.25;
	}
	.edge.soft {
		stroke: var(--accent);
	}
	.edge.dash {
		stroke: var(--clean-solid);
		stroke-dasharray: 4 4;
	}
	.ah {
		fill: var(--text-2);
	}
	.ah-a {
		fill: var(--accent);
	}
	.ah-c {
		fill: var(--clean-solid);
	}
	.el {
		font-family: var(--font-mono);
		font-size: 10px;
		fill: var(--text-3);
	}

	.inv {
		font-size: var(--text-xl);
		line-height: 1.35;
		font-weight: 500;
		letter-spacing: var(--tracking-tight);
		padding: 20px 24px;
		border-left: 3px solid var(--clean-solid);
		background: var(--surface);
		border-radius: 0 var(--radius-lg) var(--radius-lg) 0;
		border-top: 1px solid var(--border);
		border-right: 1px solid var(--border);
		border-bottom: 1px solid var(--border);
	}
	.cw {
		color: var(--clean);
	}
	.steps {
		display: grid;
		gap: 10px;
	}
	.steps li {
		display: grid;
		grid-template-columns: 28px 1fr;
		gap: 12px;
		align-items: baseline;
	}
	.sn {
		display: grid;
		place-items: center;
		width: 24px;
		height: 24px;
		border-radius: 50%;
		border: 1px solid var(--border-strong);
		font-size: var(--text-2xs);
		color: var(--text-2);
		transform: translateY(-2px);
	}

	.formula {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		gap: 16px;
		padding: 22px 24px;
	}
	.f-side {
		display: grid;
		gap: 6px;
		min-width: 0;
	}
	.f-side:last-child {
		text-align: right;
		justify-items: end;
	}
	.f-code {
		font-size: var(--text-md);
		padding: 4px 8px;
		width: fit-content;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.f-sub {
		font-size: var(--text-xs);
		color: var(--text-3);
	}
	.f-eq {
		display: grid;
		place-items: center;
		width: 40px;
		height: 40px;
		border-radius: 50%;
		background: var(--clean-bg);
		color: var(--clean);
		border: 1px solid var(--clean-border);
		font-size: var(--text-xl);
	}
	.vtable {
		display: grid;
		overflow: hidden;
	}
	.vrow {
		display: grid;
		grid-template-columns: 150px 1fr;
		gap: 16px;
		align-items: baseline;
		padding: 14px 18px;
	}
	.vrow + .vrow {
		border-top: 1px solid var(--border);
	}
	.vrow p {
		font-size: var(--text-sm) !important;
	}

	.flow,
	.limits {
		display: grid;
		gap: 18px;
	}
	.flow li {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 14px;
	}
	.fi {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		border-radius: 9px;
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text-2);
	}
	.ft {
		font-weight: 600;
		color: var(--text) !important;
		font-size: var(--text-md);
	}
	.flow p:not(.ft),
	.limits p:not(.ft) {
		font-size: var(--text-base) !important;
	}
	.limits li {
		padding-left: 16px;
		border-left: 2px solid var(--border-strong);
		display: grid;
		gap: 4px;
	}

	.adds {
		display: grid;
		grid-template-columns: 1fr 1.3fr;
		gap: 12px;
	}
	.add {
		display: grid;
		gap: 12px;
		align-content: start;
		padding: 18px;
	}
	.add.accent {
		background: var(--accent-soft);
		border-color: var(--accent-border);
	}
	.add ul {
		display: grid;
		gap: 8px;
	}
	.add li {
		display: flex;
		gap: 8px;
		align-items: baseline;
		font-size: var(--text-sm);
		color: var(--text);
	}
	.add li :global(svg) {
		transform: translateY(2px);
		color: var(--text-3);
	}
	.add.accent li :global(svg) {
		color: var(--accent-text);
	}

	.end {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: center;
		gap: 16px;
		padding: 22px 24px;
	}
	.end h3 {
		font-size: var(--text-lg);
	}
	.end p {
		font-size: var(--text-sm) !important;
	}
	.end-ctas {
		display: flex;
		gap: 8px;
	}

	@media (max-width: 980px) {
		.doc {
			grid-template-columns: 1fr;
		}
		.toc {
			display: none;
		}
	}
	@media (max-width: 640px) {
		.formula {
			grid-template-columns: 1fr;
			justify-items: center;
			text-align: center;
		}
		.f-side,
		.f-side:last-child {
			justify-items: center;
			text-align: center;
		}
		.vrow {
			grid-template-columns: 1fr;
			gap: 8px;
		}
		.adds {
			grid-template-columns: 1fr;
		}
		.prose {
			gap: 44px;
		}
		.prose p {
			font-size: var(--text-base);
		}
		.inv {
			font-size: var(--text-lg);
			padding: 16px 18px;
		}
		.f-code {
			font-size: var(--text-sm);
		}
	}
</style>
