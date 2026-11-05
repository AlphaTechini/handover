<script lang="ts">
	import Button from '$lib/ui/Button.svelte';
	import Icon, { type IconName } from '$lib/ui/Icon.svelte';
	import NonceMeter from '$lib/ui/NonceMeter.svelte';
	import Seal from '$lib/ui/Seal.svelte';
	import VerdictBadge from '$lib/ui/VerdictBadge.svelte';
	import { howHref, marketHref, mintHref, NFT_CHAIN_KEYS_URL } from '$lib/ui/links';

	const steps: { n: string; title: string; body: string; icon: IconName }[] = [
		{
			n: '01',
			title: 'Mint',
			icon: 'key',
			body: 'Each NFT gets its own Ethereum address, derived through NEAR Chain Signatures. No private key for it exists anywhere.'
		},
		{
			n: '02',
			title: 'Spend',
			icon: 'pen',
			body: 'The owner asks the contract to sign plain ETH transfers. Each signature takes the next nonce and is written to a public log.'
		},
		{
			n: '03',
			title: 'List freezes',
			icon: 'lock',
			body: 'Listing the NFT for sale freezes signing. From that moment no new signature can be created for the wallet.'
		},
		{
			n: '04',
			title: 'Check, then buy',
			icon: 'shield-check',
			body: 'Anyone compares the log with Sepolia. If the nonces match, the wallet is clean. The buyer pays and receives the NFT in one call.'
		}
	];

	const risks: { title: string; threat: string; fix: string; icon: IconName }[] = [
		{
			title: 'Pre-signed transactions',
			icon: 'pen',
			threat: 'The seller gets a transfer signed before the sale, keeps it, and broadcasts it after being paid.',
			fix: 'Every signature is sequential and public. The clean check proves none is still waiting to be broadcast.'
		},
		{
			title: 'Standing approvals',
			icon: 'swap',
			threat: 'The seller approves a contract to spend the wallet’s tokens. The right survives the sale and needs no new signature.',
			fix: 'The contract only signs plain ETH transfers it builds itself, with empty calldata. An approval can never be signed.'
		},
		{
			title: 'Upgradeable contract',
			icon: 'layers',
			threat: 'Whoever controls the NFT contract’s account can deploy new code and take every wallet.',
			fix: 'After the final deploy the contract account’s full-access keys are deleted, so the code can no longer be changed.'
		},
		{
			title: 'Non-atomic payment',
			icon: 'tag',
			threat: 'The buyer pays and the seller never transfers, or the NFT moves and the payment never arrives.',
			fix: 'buy() moves the NFT and pays the seller in the same call. Either both happen or neither does.'
		}
	];
</script>

<svelte:head>
	<title>Handover: buy a wallet, not a promise</title>
</svelte:head>

<section class="hero">
	<div class="grid-bg" aria-hidden="true"></div>
	<div class="container hero-inner">
		<div class="copy reveal">
			<span class="eyebrow"><span class="led" aria-hidden="true"></span>NEAR Chain Signatures · Sepolia testnet</span>
			<h1>Buy a wallet,<br />not a promise.</h1>
			<p class="lede">
				Handover is an NFT that owns its own Ethereum wallet. Sell it and the buyer gets the address and its ETH,
				with public proof that the seller kept no way back in.
			</p>
			<div class="ctas">
				<Button variant="primary" size="lg" href={mintHref()} iconRight="arrow-right">Mint a wallet</Button>
				<Button variant="secondary" size="lg" href={marketHref()}>Browse the market</Button>
			</div>
		</div>

		<figure class="visual reveal" style="animation-delay: 80ms" aria-label="Illustration of a Handover wallet passing its clean check">
			<div class="vcard card">
				<div class="vseal"><Seal tokenId="0" address="0x5b3a9c0e7d21f4a86b0c3e9d17a2f45c8e6b0d39" /></div>
				<div class="vbody">
					<div class="vhead">
						<div>
							<p class="vt">Wallet <span class="mono">#0</span></p>
							<p class="mono vaddr">0x5b3a…0d39</p>
						</div>
						<VerdictBadge verdict="clean" />
					</div>
					<NonceMeter issued={3} confirmed={3} max={12} />
				</div>
			</div>
			<figcaption class="vcap">Illustration. Live wallets show real NEAR and Sepolia data.</figcaption>
		</figure>
	</div>
</section>

<section class="invariant">
	<div class="container">
		<div class="inv-card">
			<span class="eyebrow">The invariant</span>
			<blockquote>
				Once a Handover wallet shows <span class="clean-word">clean</span>, no one but the next owner can ever move its funds.
			</blockquote>
			<a class="link inv-link" href={howHref('#clean-check')}>Why this holds <Icon name="arrow-right" size={14} /></a>
		</div>
	</div>
</section>

<section class="section">
	<div class="container">
		<header class="sec-head">
			<span class="eyebrow">The mechanism</span>
			<h2>Four steps, each one checkable</h2>
			<p class="secondary">
				The Handover contract is the only thing that can get signatures for a wallet’s address, and it keeps a public
				record of every one it ever produced.
			</p>
		</header>

		<ol class="steps">
			{#each steps as s, i (s.n)}
				<li class="step card">
					<div class="step-top">
						<span class="step-n mono">{s.n}</span>
						<span class="step-ico"><Icon name={s.icon} size={18} /></span>
					</div>
					<h3>{s.title}</h3>
					<p>{s.body}</p>
					{#if i < steps.length - 1}<span class="step-arrow" aria-hidden="true"><Icon name="chevron-right" size={14} /></span>{/if}
				</li>
			{/each}
		</ol>
	</div>
</section>

<section class="section alt">
	<div class="container">
		<header class="sec-head">
			<span class="eyebrow">What owning the NFT alone does not fix</span>
			<h2>Four ways a wallet sale goes wrong, closed</h2>
		</header>

		<div class="risks">
			{#each risks as r (r.title)}
				<article class="risk card">
					<div class="risk-head">
						<span class="risk-ico"><Icon name={r.icon} size={16} /></span>
						<h3>{r.title}</h3>
					</div>
					<p class="threat"><span class="tag bad">Risk</span>{r.threat}</p>
					<p class="fix"><span class="tag ok">Handover</span>{r.fix}</p>
				</article>
			{/each}
		</div>
	</div>
</section>

<section class="section">
	<div class="container prior">
		<div class="prior-text">
			<span class="eyebrow">Prior art</span>
			<h2>Built on NFT Chain Keys</h2>
			<p class="secondary">
				NEAR’s NFT Chain Keys showed first that an NFT can control a Chain Signatures key. Handover does not claim to invent
				that, or Chain Signatures, or the NFT standard. It adds what makes the wallet safe to sell: a public sequential
				signature log, freeze on list, transfer-only signing, a locked contract and atomic payment.
			</p>
			<a class="link ext" href={NFT_CHAIN_KEYS_URL} target="_blank" rel="noreferrer noopener"
				>Read about NFT Chain Keys <Icon name="arrow-up-right" size={14} /></a
			>
		</div>
		<div class="cta card">
			<h3>Try the full flow on testnet</h3>
			<p class="secondary">Mint a wallet, fund it with Sepolia ETH, spend from it, list it, and watch the clean check.</p>
			<div class="cta-row">
				<Button variant="primary" href={mintHref()} icon="plus">Mint a wallet</Button>
				<Button variant="ghost" href={howHref()} iconRight="arrow-right">How it works</Button>
			</div>
		</div>
	</div>
</section>

<style>
	.hero {
		position: relative;
		overflow: hidden;
		border-bottom: 1px solid var(--border);
	}
	.grid-bg {
		position: absolute;
		inset: 0;
		background-image:
			linear-gradient(var(--grid-line) 1px, transparent 1px),
			linear-gradient(90deg, var(--grid-line) 1px, transparent 1px);
		background-size: 48px 48px;
		mask-image: radial-gradient(ellipse 70% 80% at 70% 40%, black 10%, transparent 75%);
		-webkit-mask-image: radial-gradient(ellipse 70% 80% at 70% 40%, black 10%, transparent 75%);
	}
	.hero-inner {
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
		align-items: center;
		gap: 56px;
		padding-block: 88px 96px;
	}
	.led {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--clean-solid);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--clean-solid) 25%, transparent);
	}
	h1 {
		margin-top: 20px;
		font-size: var(--text-display);
		line-height: 1.02;
		letter-spacing: var(--tracking-display);
		font-weight: 600;
	}
	.lede {
		margin-top: 22px;
		font-size: var(--text-lg);
		line-height: 1.55;
		color: var(--text-2);
		max-width: 33em;
	}
	.ctas {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		margin-top: 32px;
	}

	.visual {
		display: grid;
		gap: 10px;
		justify-items: center;
	}
	.vcard {
		width: 100%;
		max-width: 420px;
		overflow: hidden;
		box-shadow: var(--shadow-lg);
		transform: rotate(-1.2deg);
	}
	.vseal {
		aspect-ratio: 16 / 9;
		overflow: hidden;
		position: relative;
		border-bottom: 1px solid var(--border);
	}
	.vseal :global(.seal) {
		position: absolute;
		inset: 0;
		height: 100%;
	}
	.vbody {
		display: grid;
		gap: 18px;
		padding: 18px 20px 20px;
	}
	.vhead {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
	}
	.vt {
		font-weight: 600;
	}
	.vaddr {
		font-size: var(--text-xs);
		color: var(--text-3);
	}
	.vcap {
		font-size: var(--text-xs);
		color: var(--text-3);
	}

	.invariant {
		padding-block: 64px 24px;
	}
	.inv-card {
		display: grid;
		justify-items: center;
		text-align: center;
		gap: 18px;
		max-width: 860px;
		margin-inline: auto;
	}
	blockquote {
		font-size: clamp(1.4rem, 1rem + 1.6vw, 2.1rem);
		line-height: 1.25;
		letter-spacing: var(--tracking-tight);
		font-weight: 500;
		text-wrap: balance;
	}
	.clean-word {
		color: var(--clean);
		background: var(--clean-bg);
		border: 1px solid var(--clean-border);
		border-radius: 8px;
		padding: 0 8px;
		white-space: nowrap;
	}
	.inv-link {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: var(--text-sm);
		font-weight: 500;
	}

	.section {
		padding-block: 72px;
	}
	.section.alt {
		background: var(--bg-subtle);
		border-block: 1px solid var(--border);
	}
	.sec-head {
		display: grid;
		gap: 10px;
		max-width: 640px;
		margin-bottom: 36px;
	}
	h2 {
		font-size: var(--text-2xl);
		line-height: 1.15;
	}
	.sec-head p {
		font-size: var(--text-md);
	}

	.steps {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 16px;
	}
	.step {
		position: relative;
		display: grid;
		align-content: start;
		gap: 10px;
		padding: 20px;
	}
	.step-top {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 8px;
	}
	.step-n {
		font-size: var(--text-xs);
		color: var(--text-3);
	}
	.step-ico {
		display: grid;
		place-items: center;
		width: 34px;
		height: 34px;
		border-radius: 10px;
		background: var(--accent-soft);
		color: var(--accent-text);
		border: 1px solid var(--accent-border);
	}
	.step:last-child .step-ico {
		background: var(--clean-bg);
		color: var(--clean);
		border-color: var(--clean-border);
	}
	.step h3 {
		font-size: var(--text-md);
	}
	.step p {
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.step-arrow {
		position: absolute;
		right: -13px;
		top: 34px;
		z-index: 1;
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: var(--bg);
		border: 1px solid var(--border);
		color: var(--text-3);
	}

	.risks {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 16px;
	}
	.risk {
		display: grid;
		gap: 14px;
		padding: 22px;
	}
	.risk-head {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.risk-ico {
		display: grid;
		place-items: center;
		width: 30px;
		height: 30px;
		border-radius: 8px;
		background: var(--surface-sunken);
		border: 1px solid var(--border);
		color: var(--text-2);
	}
	.risk h3 {
		font-size: var(--text-md);
	}
	.threat,
	.fix {
		display: grid;
		grid-template-columns: 76px 1fr;
		gap: 12px;
		font-size: var(--text-sm);
		color: var(--text-2);
		align-items: baseline;
	}
	.fix {
		color: var(--text);
		padding-top: 14px;
		border-top: 1px solid var(--border);
	}
	.tag {
		justify-self: start;
		font-family: var(--font-mono);
		font-size: var(--text-2xs);
		letter-spacing: var(--tracking-caps);
		text-transform: uppercase;
		padding: 2px 6px;
		border-radius: 4px;
		border: 1px solid;
	}
	.tag.bad {
		color: var(--bad);
		background: var(--bad-bg);
		border-color: var(--bad-border);
	}
	.tag.ok {
		color: var(--clean);
		background: var(--clean-bg);
		border-color: var(--clean-border);
	}

	.prior {
		display: grid;
		grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
		gap: 48px;
		align-items: center;
	}
	.prior-text {
		display: grid;
		gap: 12px;
	}
	.prior-text p {
		font-size: var(--text-md);
	}
	.ext {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-weight: 500;
		width: fit-content;
	}
	.cta {
		display: grid;
		gap: 10px;
		padding: 28px;
		background:
			radial-gradient(120% 120% at 100% 0%, var(--accent-soft) 0%, transparent 55%),
			var(--surface);
	}
	.cta h3 {
		font-size: var(--text-lg);
	}
	.cta-row {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 8px;
	}

	@media (max-width: 980px) {
		.hero-inner {
			grid-template-columns: 1fr;
			gap: 48px;
			padding-block: 64px 72px;
		}
		.steps {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.step-arrow {
			display: none;
		}
		.prior {
			grid-template-columns: 1fr;
		}
	}
	@media (max-width: 640px) {
		.hero-inner {
			padding-block: 44px 56px;
		}
		.lede {
			font-size: var(--text-md);
		}
		.steps,
		.risks {
			grid-template-columns: 1fr;
		}
		.vcard {
			transform: none;
		}
		.threat,
		.fix {
			grid-template-columns: 1fr;
			gap: 6px;
		}
		.section {
			padding-block: 56px;
		}
		.ctas :global(.btn) {
			flex: 1 1 auto;
		}
	}
</style>
