<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import {
		broadcast,
		blocksUntilRelease,
		buyToken,
		canReleaseStuck,
		connectWallet,
		currentBlockHeight,
		delistToken,
		etherscanAddress,
		etherscanTx,
		formatEth,
		formatNear,
		getConfig,
		getWallet,
		getWalletStatus,
		HANDOVER_CONTRACT,
		isConfigured,
		isWalletChangedError,
		listToken,
		MPC_CONTRACT,
		nearblocksAccount,
		nearWallet,
		nsToDate,
		parseNear,
		releaseStuck,
		SEPOLIA_CHAIN_ID,
		shortHex,
		walletAddress,
		type ContractConfig,
		type SignedTx,
		type Verdict,
		type WalletStatus
	} from '$lib/chain';
	import AddressChip from '$lib/ui/AddressChip.svelte';
	import Badge from '$lib/ui/Badge.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Callout from '$lib/ui/Callout.svelte';
	import EmptyState from '$lib/ui/EmptyState.svelte';
	import ErrorState from '$lib/ui/ErrorState.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import NonceMeter from '$lib/ui/NonceMeter.svelte';
	import Seal from '$lib/ui/Seal.svelte';
	import SendForm from '$lib/ui/SendForm.svelte';
	import SigLogTable from '$lib/ui/SigLogTable.svelte';
	import Skeleton from '$lib/ui/Skeleton.svelte';
	import VerdictBadge from '$lib/ui/VerdictBadge.svelte';
	import { describeError } from '$lib/ui/errors';
	import { reservedOf, retryReserved } from '$lib/ui/extras';
	import { howHref, marketHref, walletHref, walletsHref } from '$lib/ui/links';
	import { previouslyOwned, rememberOwned } from '$lib/ui/memory';
	import { Resource } from '$lib/ui/resource.svelte';
	import { formatDate, relativeTime } from '$lib/ui/time';
	import { toast } from '$lib/ui/toast.svelte';
	import { VERDICTS } from '$lib/ui/verdict';
	import { onMount, untrack } from 'svelte';

	const FRESH_MS = 60_000;
	const configured = isConfigured();

	const id = $derived(page.url.searchParams.get('id')?.trim() || null);
	const validId = $derived(id !== null && /^\d+$/.test(id));

	const status = new Resource<WalletStatus | null>(async () => {
		const tokenId = id!;
		const [w, st] = await Promise.all([getWallet(tokenId), getWalletStatus(tokenId).catch((e: unknown) => e)]);
		if (!w) return null;
		if (st instanceof Error || !st || typeof st !== 'object') throw st;
		return st as WalletStatus;
	});
	const address = new Resource(() => walletAddress(id!));

	let now = $state(Date.now());

	$effect(() => {
		if (!configured || !validId) return;
		void id;
		untrack(() => {
			status.reset();
			address.reset();
			check = null;
			bought = false;
			walletChanged = false;
			height = null;
			showTry = false;
			status.load();
			address.load();
		});
	});

	onMount(() => {
		const tick = setInterval(() => (now = Date.now()), 1000);
		const poll = setInterval(() => {
			if (document.visibilityState === 'visible' && status.data && !status.loading && !acting) status.load();
		}, 30_000);
		return () => {
			clearInterval(tick);
			clearInterval(poll);
		};
	});

	// ---------- derived view state ----------
	const s = $derived(status.data ?? null);
	const w = $derived(s?.wallet ?? null);
	const addr = $derived(s?.address ?? address.data ?? null);
	const account = $derived(nearWallet.accountId);
	const isOwner = $derived(!!account && !!w && account === w.ownerId);
	const listing = $derived(w?.listing ?? null);
	const wasMine = $derived(!!account && !!w && !isOwner && previouslyOwned(account, w.tokenId));
	const meta = $derived(s ? VERDICTS[s.verdict] : null);
	const reserved = $derived(reservedOf(w));
	const transferPending = $derived(w?.transferCallPending === true);
	const blockedReason = $derived(
		transferPending
			? 'The NFT is in the middle of a transfer call.'
			: w?.inFlight
			? 'A signature request is in flight.'
			: reserved
				? `Signing attempt for nonce ${reserved.nonce} did not complete.`
				: null
	);

	// release_stuck: only offered once the MPC request has outlived the contract's release window
	let cfg = $state<ContractConfig | null>(null);
	let height = $state<number | null>(null);
	const canRelease = $derived(!!w && !!cfg && height !== null && canReleaseStuck(w, cfg, height));
	const releaseWait = $derived(w && cfg && height !== null ? blocksUntilRelease(w, cfg, height) : null);

	async function loadHeight() {
		try {
			[cfg, height] = await Promise.all([cfg ? Promise.resolve(cfg) : getConfig(), currentBlockHeight()]);
		} catch {
			/* the action simply stays hidden until the height is known */
		}
	}

	$effect(() => {
		if (!w?.inFlight) return;
		void w.reserved?.requestedAtBlock;
		untrack(loadHeight);
		const t = setInterval(loadHeight, 15_000);
		return () => clearInterval(t);
	});

	let releasing = $state(false);
	async function doRelease() {
		if (!w) return;
		releasing = true;
		try {
			await releaseStuck(w.tokenId);
			toast({
				tone: 'success',
				title: 'Request released',
				message: 'The same transaction stays reserved. Retry the signature to finish it.'
			});
		} catch (x) {
			const d = describeError(x, { contractCall: true });
			toast({ tone: 'error', title: d.kind === 'refused' ? 'The contract refused to release' : 'Release failed', message: d.detail });
		} finally {
			releasing = false;
			status.load();
		}
	}

	let retrying = $state(false);
	async function doRetry() {
		if (!w || !retryReserved) return;
		retrying = true;
		try {
			await retryReserved(w.tokenId);
			toast({ tone: 'success', title: `Nonce ${reserved?.nonce ?? ''} signed`, message: 'The reserved transaction is now in the log. Broadcast it to clear.' });
		} catch (x) {
			const d = describeError(x, { contractCall: true });
			toast({ tone: 'error', title: d.kind === 'refused' ? 'The contract refused' : 'Retry failed', message: d.detail });
		} finally {
			retrying = false;
			status.load();
		}
	}

	$effect(() => {
		if (isOwner && account && w) rememberOwned(account, w.tokenId);
	});

	// ---------- actions ----------
	let acting = $state(false);
	let broadcasting = $state<number | null>(null);
	let broadcastingAll = $state(false);

	async function broadcastTx(tx: SignedTx) {
		broadcasting = tx.nonce;
		try {
			const h = await broadcast(tx.rawSignedTxHex);
			toast({
				tone: 'success',
				title: `Broadcast nonce ${tx.nonce}`,
				message: 'Sent to Sepolia. The verdict updates once it is mined.',
				href: etherscanTx(h),
				linkLabel: 'View on Etherscan'
			});
		} catch (e) {
			const d = describeError(e);
			toast({ tone: 'error', title: `Could not broadcast nonce ${tx.nonce}`, message: d.detail });
			throw e;
		} finally {
			broadcasting = null;
			status.load();
		}
	}

	async function broadcastAll() {
		if (!s) return;
		broadcastingAll = true;
		try {
			for (const tx of [...s.pending].sort((a, b) => a.nonce - b.nonce)) await broadcastTx(tx);
		} catch {
			/* surfaced per tx */
		} finally {
			broadcastingAll = false;
		}
	}

	// list / delist
	let price = $state('');
	let priceTouched = $state(false);
	const priceYocto = $derived.by(() => {
		const p = price.trim();
		if (!/^\d*\.?\d+$|^\d+\.$/.test(p)) return null;
		try {
			const v = parseNear(p);
			return v > 0n ? v : null;
		} catch {
			return null;
		}
	});

	async function doList(e: SubmitEvent) {
		e.preventDefault();
		priceTouched = true;
		if (!w || priceYocto === null) return;
		acting = true;
		try {
			await listToken(w.tokenId, priceYocto.toString());
			toast({ tone: 'success', title: 'Listed for sale', message: `Signing is frozen while wallet #${w.tokenId} is listed.` });
			price = '';
			priceTouched = false;
			await status.load();
		} catch (x) {
			const d = describeError(x, { contractCall: true });
			toast({ tone: 'error', title: d.kind === 'refused' ? 'The contract refused to list' : 'Could not list', message: d.detail });
		} finally {
			acting = false;
		}
	}

	async function doDelist() {
		if (!w) return;
		acting = true;
		try {
			await delistToken(w.tokenId);
			toast({ tone: 'success', title: 'Delisted', message: 'Signing is unfrozen. You can spend from this wallet again.' });
			await status.load();
		} catch (x) {
			const d = describeError(x, { contractCall: true });
			toast({ tone: 'error', title: d.kind === 'refused' ? 'The contract refused to delist' : 'Could not delist', message: d.detail });
		} finally {
			acting = false;
		}
	}

	// buy: an explicit re-check right before the call
	let check = $state<{ verdict: Verdict; at: number; pending: number; priceYocto: string | null; nextNonce: number } | null>(null);
	/** The contract rejected the buy because the wallet signed after the check the buyer ran */
	let walletChanged = $state(false);
	let checking = $state(false);
	let checkError = $state<unknown>(null);
	let bought = $state(false);
	let showTry = $state(false);

	const checkAge = $derived(check ? now - check.at : Infinity);
	const checkFresh = $derived(checkAge < FRESH_MS);
	const nonceMoved = $derived(!!check && !!w && check.nextNonce !== w.nextNonce);
	const checkOk = $derived(
		!!check &&
			checkFresh &&
			check.verdict === 'clean' &&
			!!listing &&
			check.priceYocto === listing.priceYocto &&
			!nonceMoved
	);
	const canBuy = $derived(!!account && !isOwner && !!listing && checkOk && !acting);

	async function recheck() {
		checking = true;
		checkError = null;
		walletChanged = false;
		const st = await status.load();
		if (st) {
			check = {
				verdict: st.verdict,
				at: Date.now(),
				pending: st.pending.length,
				priceYocto: st.wallet.listing?.priceYocto ?? null,
				nextNonce: st.wallet.nextNonce
			};
		} else {
			checkError = status.error ?? new Error('Wallet not found');
			check = null;
		}
		checking = false;
	}

	async function doBuy() {
		if (!w || !listing || !canBuy || !check) return;
		acting = true;
		walletChanged = false;
		try {
			// Bound to the nonce the buyer just verified: the contract refuses if the wallet has signed since.
			await buyToken(w.tokenId, listing.priceYocto, check.nextNonce);
			bought = true;
			check = null;
			toast({ tone: 'success', title: `You own wallet #${w.tokenId}`, message: 'Payment and NFT transfer settled in one call.' });
			await status.load();
		} catch (x) {
			const d = describeError(x, { contractCall: true });
			if (isWalletChangedError(d.raw) || isWalletChangedError(d.detail)) {
				walletChanged = true;
				check = null;
				status.load();
			} else {
				toast({ tone: 'error', title: d.kind === 'refused' ? 'The contract refused the purchase' : 'Purchase failed', message: d.detail });
			}
		} finally {
			acting = false;
		}
	}

	let connecting = $state(false);
	async function connect() {
		connecting = true;
		try {
			await connectWallet();
		} catch (e) {
			toast({ tone: 'error', title: 'Could not connect', message: describeError(e).detail });
		} finally {
			connecting = false;
		}
	}

	// lookup form when no id is given
	let lookup = $state('');
	function openLookup(e: SubmitEvent) {
		e.preventDefault();
		const v = lookup.trim().replace(/^#/, '');
		if (/^\d+$/.test(v)) goto(walletHref(v));
	}

	function safeDate(ns: string | undefined): string {
		if (!ns) return '-';
		try {
			return formatDate(nsToDate(ns));
		} catch {
			return '-';
		}
	}
</script>

<svelte:head><title>{id ? `Wallet #${id}` : 'Wallet'} · Handover</title></svelte:head>

<div class="container page">
	{#if !validId}
		<div class="container-narrow lookup-wrap">
			<EmptyState icon="search" title={id ? `“${id}” is not a token id` : 'Open a wallet'}>
				Token ids are whole numbers, starting at 0. Enter one to see its address, balance and verification.
				{#snippet actions()}
					<form class="lookup" onsubmit={openLookup}>
						<label class="visually-hidden" for="lookup">Token id</label>
						<input id="lookup" class="input mono" placeholder="Token id, e.g. 0" inputmode="numeric" bind:value={lookup} />
						<Button type="submit" variant="primary" iconRight="arrow-right">Open</Button>
					</form>
				{/snippet}
			</EmptyState>
		</div>
	{:else if !configured}
		<EmptyState icon="info" title="No contract configured">
			Wallet <span class="mono">#{id}</span> can be shown once the app points at a deployed Handover contract.
		</EmptyState>
	{:else if s === null && !status.loading && !status.error && status.loadedAt > 0}
		<EmptyState icon="search" title="Wallet #{id} does not exist">
			No Handover NFT has this token id yet. Token ids are assigned in order at mint.
			{#snippet actions()}
				<Button variant="secondary" href={marketHref()}>Browse market</Button>
			{/snippet}
		</EmptyState>
	{:else}
		<nav class="crumbs" aria-label="Breadcrumb">
			<a href={isOwner ? walletsHref() : marketHref()}>{isOwner ? 'My wallets' : 'Market'}</a>
			<Icon name="chevron-right" size={12} />
			<span aria-current="page">Wallet <span class="mono">#{id}</span></span>
		</nav>

		<!-- ============ Header ============ -->
		<header class="w-head">
			<div class="w-seal">
				<Seal tokenId={id!} address={addr} />
			</div>
			<div class="w-id">
				<div class="w-title">
					<h1>Wallet <span class="mono">#{id}</span></h1>
					<div class="w-badges">
						<VerdictBadge
							verdict={s?.verdict}
							pending={s?.pending.length ?? 0}
							state={status.error ? 'error' : !s ? 'loading' : 'ready'}
						/>
						{#if listing}<Badge tone="accent" icon="lock">Listed, signing frozen</Badge>{/if}
						{#if isOwner}<Badge tone="neutral">You own this</Badge>{/if}
					</div>
				</div>
				<dl class="w-meta">
					<div>
						<dt>Ethereum address</dt>
						<dd>
							{#if addr}
								<AddressChip value={addr} href={etherscanAddress(addr)} chars={6} label="address" />
							{:else if address.error && status.error}
								<span class="muted">unavailable</span>
							{:else}
								<Skeleton width="180px" height="28px" />
							{/if}
						</dd>
					</div>
					<div>
						<dt>Owner</dt>
						<dd>
							{#if w}
								<AddressChip value={w.ownerId} href={nearblocksAccount(w.ownerId)} label="owner account" />
							{:else if status.error}
								<span class="muted">unavailable</span>
							{:else}
								<Skeleton width="140px" height="28px" />
							{/if}
						</dd>
					</div>
					<div class="hide-sm">
						<dt>Minted</dt>
						<dd class="plain">{#if w}{safeDate(w.mintedAtNs)}{:else if status.error}-{:else}<Skeleton width="90px" />{/if}</dd>
					</div>
				</dl>
			</div>
			<div class="w-bal">
				<span class="k">Balance</span>
				<span class="v tnum">
					{#if s}{formatEth(s.balanceWei, 6)}<span class="unit">ETH</span>{:else if status.error}<span class="unavail">unavailable</span>{:else}<Skeleton
							width="150px"
							height="34px"
						/>{/if}
				</span>
				<span class="sub">
					{#if s}Sepolia · updated {relativeTime(status.loadedAt, now)}{:else}Sepolia{/if}
				</span>
			</div>
		</header>

		<div class="layout">
			<!-- ============ Left: verification + log ============ -->
			<div class="main-col">
				<section class="card panel verify-panel" aria-labelledby="verify-h">
					<header class="p-head">
						<div>
							<h2 id="verify-h">Verification</h2>
							<p class="p-sub">The contract’s signature log compared with Sepolia, checked from your browser.</p>
						</div>
						<div class="p-tools">
							{#if s}<span class="checked">Checked {relativeTime(s.checkedAt, now)}</span>{/if}
							<Button size="sm" variant="secondary" icon="refresh" loading={status.loading} onclick={() => status.load()}>
								Re-check
							</Button>
						</div>
					</header>

					{#if s && meta}
						<div class="verdict {meta.tone}" aria-live="polite">
							<span class="v-ico"><Icon name={meta.icon} size={20} stroke={2} /></span>
							<div class="v-text">
								<p class="v-label">
									{meta.label}{#if s.verdict === 'dirty'}<span class="v-count">&nbsp;·&nbsp;{s.pending.length} pending</span>{/if}
								</p>
								{#if s.verdict === 'busy' && s.wallet.transferCallPending}
									<p class="v-head">A transfer call is in progress</p>
									<p class="v-exp">
										The NFT is in the middle of a transfer call; its owner may change. Check again once it has resolved.
									</p>
								{:else if s.verdict === 'busy' && !s.wallet.inFlight && reserved}
									<p class="v-head">A signing attempt did not complete</p>
									<p class="v-exp">
										The contract reserved nonce {reserved.nonce} for a transfer whose signature may already exist. Until the owner
										retries it and the result is logged, the wallet cannot be listed or sold.
									</p>
								{:else}
									<p class="v-head">{meta.headline}</p>
									<p class="v-exp">{meta.explain}</p>
								{/if}
							</div>
						</div>

						<div class="meter-wrap">
							<NonceMeter
								issued={s.wallet.nextNonce}
								confirmed={s.chainNonce}
								mempool={s.pendingChainNonce}
								reservedNonce={s.wallet.inFlight ? s.wallet.nextNonce : (reserved?.nonce ?? null)}
							/>
						</div>

						{#if s.reasons.length}
							<div class="reasons">
								<p class="r-title">Why</p>
								<ul>
									{#each s.reasons as r, i (i)}
										<li><Icon name={s.verdict === 'clean' ? 'check' : 'chevron-right'} size={13} stroke={2} />{r}</li>
									{/each}
								</ul>
							</div>
						{/if}

						{#if s.pending.length > 0}
							<div class="pending">
								<div class="pend-head">
									<div>
										<p class="pend-title">
											{s.pending.length} signed {s.pending.length === 1 ? 'transaction' : 'transactions'} waiting to be broadcast
										</p>
										<p class="pend-sub">
											These are the current owner’s own transfers. Anyone may broadcast them. The verdict turns clean once they
											are mined.
										</p>
									</div>
									<Button
										variant="primary"
										size="sm"
										icon="radio"
										loading={broadcastingAll}
										disabled={broadcasting !== null}
										onclick={broadcastAll}
									>
										Broadcast pending
									</Button>
								</div>
								<ul class="pend-list">
									{#each s.pending as tx (tx.nonce)}
										<li>
											<span class="mono pn">nonce {tx.nonce}</span>
											<span class="mono">{formatEth(BigInt(tx.valueWei))} ETH</span>
											<span class="arrow" aria-hidden="true"><Icon name="arrow-right" size={12} /></span>
											<span class="mono" title={tx.to}>{shortHex(tx.to, 4)}</span>
											{#if tx.nonce < s.pendingChainNonce}<Badge tone="busy" size="sm" dot>In mempool</Badge>{/if}
											<span class="pl-act">
												<Button
													size="sm"
													variant="ghost"
													icon="radio"
													loading={broadcasting === tx.nonce}
													disabled={broadcasting !== null && broadcasting !== tx.nonce}
													aria-label="Broadcast nonce {tx.nonce}"
													onclick={() => broadcastTx(tx).catch(() => {})}>Broadcast</Button
												>
											</span>
										</li>
									{/each}
								</ul>
							</div>
						{/if}
					{:else if status.error}
						<div class="p-body">
							<ErrorState error={status.error} compact onretry={() => status.load()} title="Verification unavailable" />
						</div>
					{:else}
						<div class="p-body sk-stack" aria-busy="true" aria-label="Running clean check">
							<Skeleton height="76px" radius="10px" />
							<div class="sk-row"><Skeleton width="38%" height="44px" /><Skeleton width="38%" height="44px" /></div>
							<Skeleton height="18px" />
							<Skeleton height="18px" />
						</div>
					{/if}
				</section>

				<section class="card panel log-panel" aria-labelledby="log-h">
					<header class="p-head">
						<div>
							<h2 id="log-h">
								Signature log
								{#if s}<span class="count mono">{s.sigLog.length}</span>{/if}
							</h2>
							<p class="p-sub">Every signature the contract ever issued for this address. Public and strictly sequential.</p>
						</div>
					</header>
					{#if s}
						{#if s.sigLog.length}
							<SigLogTable log={s.sigLog} chainNonce={s.chainNonce} mempoolNonce={s.pendingChainNonce} />
						{:else}
							<div class="p-body">
								<EmptyState icon="pen" title="No signatures yet" compact>
									The contract has never signed for this address, so nothing can be waiting to be broadcast.
								</EmptyState>
							</div>
						{/if}
					{:else if status.error}
						<div class="p-body"><p class="muted small">The log loads with the verification above.</p></div>
					{:else}
						<div class="p-body sk-stack">
							{#each { length: 3 } as _, i (i)}<Skeleton height="36px" />{/each}
						</div>
					{/if}
				</section>
			</div>

			<!-- ============ Right: actions ============ -->
			<aside class="side-col" aria-label="Actions">
				{#if !w}
					{#if !status.error}
						<div class="card panel"><div class="p-body sk-stack"><Skeleton height="20px" width="50%" /><Skeleton height="40px" /><Skeleton height="40px" /><Skeleton height="36px" /></div></div>
					{/if}
				{:else if isOwner}
					{#if bought}
						<Callout tone="clean" title="This wallet is yours">
							The NFT and the address moved to you in one call. Try a small transfer below: it will go through. The previous owner’s
							requests are now refused.
						</Callout>
					{/if}

					{#if listing}
						<section class="card panel" aria-labelledby="listed-h">
							<header class="p-head">
								<div>
									<h2 id="listed-h">Listed for sale</h2>
									<p class="p-sub">Listed {safeDate(listing.listedAtNs)}</p>
								</div>
							</header>
							<div class="p-body stack">
								<div class="price-big">
									<span class="tnum">{formatNear(listing.priceYocto)}</span><span class="unit">NEAR</span>
								</div>
								<div class="frozen">
									<span class="fz-ico"><Icon name="snow" size={16} /></span>
									<div>
										<p class="fz-t">Signing is frozen</p>
										<p class="fz-d">
											While listed, the contract refuses every signature request for this wallet, including yours. That is
											what lets a buyer verify it: no new signature can appear between their check and their purchase.
										</p>
									</div>
								</div>
								<Button variant="secondary" full icon="unlock" loading={acting} onclick={doDelist}>Delist and unfreeze</Button>
							</div>
						</section>
					{:else}
						<section class="card panel" aria-labelledby="send-h">
							<header class="p-head">
								<div>
									<h2 id="send-h">Send ETH</h2>
									<p class="p-sub">Signed by the NEAR MPC network for you, as the NFT’s owner.</p>
								</div>
							</header>
							<div class="p-body stack">
								{#if transferPending}
									<Callout tone="busy" title="A transfer call is in progress">
										The NFT is in the middle of a transfer call; its owner may change. Signing and listing resume once it
										resolves.
									</Callout>
								{:else if w.inFlight}
									<Callout tone="busy" title="A signature is in flight">
										The contract accepts one request at a time. Wait for it to finish, then re-check.
										{#snippet actions()}
											{#if canRelease}
												<p class="small muted release-note">
													The signing network timed out on this request. Releasing keeps the same transaction reserved, so it
													can be retried.
												</p>
												<Button size="sm" variant="secondary" icon="unlock" loading={releasing} onclick={doRelease}>
													Release stuck request
												</Button>
											{:else if releaseWait !== null && releaseWait > 0}
												<span class="small muted">
													If it never finishes, you can release it in about {releaseWait} NEAR {releaseWait === 1 ? 'block' : 'blocks'}.
												</span>
											{/if}
										{/snippet}
									</Callout>
								{:else if reserved}
									<Callout tone="busy" title="Signing attempt for nonce {reserved.nonce} did not complete">
										A signature for that exact transaction may already exist, so the contract keeps it reserved. Retry it to
										finish; new transfers and listing stay blocked until then.
										{#snippet actions()}
											{#if retryReserved}
												<Button size="sm" variant="primary" icon="refresh" loading={retrying} onclick={doRetry}>Retry signature</Button>
											{:else}
												<span class="small muted">Retry is not available in this build.</span>
											{/if}
										{/snippet}
									</Callout>
								{/if}
								<SendForm
									tokenId={w.tokenId}
									fromAddress={addr}
									balanceWei={s?.balanceWei ?? null}
									blocked={blockedReason}
									onsettled={() => status.load()}
								/>
							</div>
						</section>

						<section class="card panel" aria-labelledby="list-h">
							<header class="p-head">
								<div>
									<h2 id="list-h">List for sale</h2>
									<p class="p-sub">Listing freezes signing until the wallet is sold or delisted.</p>
								</div>
							</header>
							<form class="p-body stack" onsubmit={doList} novalidate>
								<div class="field">
									<label class="field-label" for="price">Price</label>
									<div class="input-group">
										<input
											id="price"
											class="input mono"
											inputmode="decimal"
											placeholder="0.0"
											bind:value={price}
											onblur={() => (priceTouched = true)}
											aria-invalid={priceTouched && price.trim() && priceYocto === null ? 'true' : undefined}
										/>
										<span class="suffix">NEAR</span>
									</div>
									{#if priceTouched && price.trim() && priceYocto === null}
										<span class="field-error">Enter a price greater than 0.</span>
									{:else}
										<span class="field-help">Paid to you by the buyer in the same call that transfers the NFT.</span>
									{/if}
								</div>
								<Button
									type="submit"
									variant="secondary"
									full
									icon="tag"
									loading={acting}
									disabled={priceYocto === null || !!blockedReason}
								>
									List for sale
								</Button>
								{#if blockedReason}<p class="fine">Listing is blocked: {blockedReason.toLowerCase()}</p>{/if}
							</form>
						</section>
					{/if}
				{:else}
					<!-- not the owner -->
					{#if listing}
						<section class="card panel buy" aria-labelledby="buy-h">
							<header class="p-head">
								<div>
									<h2 id="buy-h">Buy this wallet</h2>
									<p class="p-sub">The NFT, the address and everything in it.</p>
								</div>
							</header>
							<div class="p-body stack">
								<div class="price-big">
									<span class="tnum">{formatNear(listing.priceYocto)}</span><span class="unit">NEAR</span>
								</div>
								<p class="seller">
									Sold by <span class="mono">{listing.sellerId}</span>
								</p>

								<ol class="buy-steps">
									<li class:done={checkOk}>
										<span class="bs-n">{#if checkOk}<Icon name="check" size={12} stroke={2.75} />{:else}1{/if}</span>
										<div class="bs-body">
											<p class="bs-t">Re-check right before buying</p>
											{#if check && checkFresh}
												<div class="bs-res">
													<VerdictBadge verdict={check.verdict} pending={check.pending} size="sm" />
													<span class="muted">{relativeTime(check.at, now)}, valid {Math.max(0, Math.ceil((FRESH_MS - checkAge) / 1000))}s</span>
												</div>
											{:else if check && !checkFresh}
												<p class="bs-d">The last check expired. Run it again.</p>
											{:else}
												<p class="bs-d">Reads the log and the Sepolia nonce again, now.</p>
											{/if}
											<Button size="sm" variant={checkOk ? 'ghost' : 'secondary'} icon="shield-check" loading={checking} onclick={recheck}>
												{check ? 'Check again' : 'Run clean check'}
											</Button>
										</div>
									</li>
									<li>
										<span class="bs-n">2</span>
										<div class="bs-body">
											<p class="bs-t">Pay and receive in one call</p>
											<p class="bs-d">
												You pay exactly the listed price, bound to the wallet state you just checked. If the NFT does not move, you are not charged.
											</p>
										</div>
									</li>
								</ol>

								{#if walletChanged || (check && checkFresh && nonceMoved)}
									<Callout tone="dirty" title="The wallet changed since your check" role="alert">
										The wallet signed a new transaction after your check, so nothing was bought and you were not charged.
										Run the clean check again before you buy.
									</Callout>
								{/if}
								{#if checkError}
									<ErrorState error={checkError} compact title="Check failed" />
								{:else if check && checkFresh && check.verdict !== 'clean'}
									<Callout tone={VERDICTS[check.verdict].tone} title="Buying is disabled">
										The wallet is {VERDICTS[check.verdict].label.toLowerCase()}. {VERDICTS[check.verdict].explain}
									</Callout>
								{:else if check && checkFresh && check.priceYocto !== listing.priceYocto}
									<Callout tone="dirty" title="The listing changed">The price or listing changed since your check. Check again.</Callout>
								{/if}

								{#if !account}
									<Button variant="primary" size="lg" full loading={connecting || nearWallet.connecting} onclick={connect}>
										Connect to buy
									</Button>
								{:else}
									<Button variant="success" size="lg" full icon="shield-check" disabled={!canBuy} loading={acting} onclick={doBuy}>
										Buy for {formatNear(listing.priceYocto)} NEAR
									</Button>
									{#if !checkOk}<p class="fine">Enabled only after a clean check in the last 60 seconds.</p>{/if}
								{/if}
							</div>
						</section>
					{:else}
						<section class="card panel" aria-labelledby="nfs-h">
							<header class="p-head">
								<div>
									<h2 id="nfs-h">Not for sale</h2>
									<p class="p-sub">The owner has not listed this wallet.</p>
								</div>
							</header>
							<div class="p-body">
								<p class="small secondary">
									Only <span class="mono">{w.ownerId}</span> can spend from it. If it is listed later, it appears on the
									<a class="link" href={marketHref()}>market</a> with a live clean check.
								</p>
							</div>
						</section>
					{/if}

					{#if account}
						<section class="card panel" class:tried={wasMine} style:order={wasMine ? -1 : null} aria-labelledby="try-h">
							<header class="p-head">
								<div>
									<h2 id="try-h">{wasMine ? 'You sold this wallet' : 'Spend as a non-owner'}</h2>
									<p class="p-sub">
										{#if wasMine}
											Ownership moved to <span class="mono">{w.ownerId}</span>. The contract now refuses your requests.
										{:else}
											Only the NFT’s owner can get a signature. You can see the refusal yourself.
										{/if}
									</p>
								</div>
							</header>
							<div class="p-body stack">
								{#if wasMine || showTry}
									<SendForm tokenId={w.tokenId} mode="refusal" onsettled={() => status.load()} />
								{:else}
									<Button variant="ghost" full icon="ban" onclick={() => (showTry = true)}>Try to spend (will be refused)</Button>
								{/if}
							</div>
						</section>
					{:else}
						<Callout tone="neutral" title="Connect to act on this wallet">
							Connect a NEAR testnet account to buy it, or to see the contract refuse a spend from a non-owner.
							{#snippet actions()}
								<Button size="sm" variant="primary" loading={connecting} onclick={connect}>Connect wallet</Button>
							{/snippet}
						</Callout>
					{/if}
				{/if}

				<section class="card panel details" aria-labelledby="det-h">
					<header class="p-head"><h2 id="det-h" class="h-sm">Details</h2></header>
					<dl class="kv">
						<div><dt>Token id</dt><dd class="mono">{id}</dd></div>
						<div><dt>Derivation path</dt><dd class="mono">{w?.path ?? `handover-${id}`}</dd></div>
						<div>
							<dt>Contract</dt>
							<dd>
								<a class="mono link" href={nearblocksAccount(HANDOVER_CONTRACT)} target="_blank" rel="noreferrer noopener"
									>{HANDOVER_CONTRACT}</a
								>
							</dd>
						</div>
						<div><dt>Signer</dt><dd class="mono">{MPC_CONTRACT}</dd></div>
						<div><dt>Chain</dt><dd class="mono">Sepolia · {SEPOLIA_CHAIN_ID}</dd></div>
					</dl>
					<a class="link det-link" href={howHref('#clean-check')}>How the clean check works <Icon name="arrow-right" size={13} /></a>
				</section>
			</aside>
		</div>
	{/if}
</div>

<style>
	.lookup-wrap {
		margin-inline: auto;
	}
	.lookup {
		display: flex;
		gap: 8px;
		width: min(360px, 100%);
	}
	.crumbs {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: var(--text-sm);
		color: var(--text-3);
		margin-bottom: 20px;
	}
	.crumbs a:hover {
		color: var(--text);
	}
	.crumbs [aria-current] {
		color: var(--text-2);
	}

	/* header */
	.w-head {
		display: grid;
		grid-template-columns: 112px minmax(0, 1fr) auto;
		gap: 24px;
		align-items: center;
		padding-bottom: 28px;
		margin-bottom: 28px;
		border-bottom: 1px solid var(--border);
	}
	.w-seal {
		width: 112px;
		height: 112px;
		border-radius: 20px;
		overflow: hidden;
		box-shadow:
			0 0 0 1px var(--border),
			var(--shadow-md);
	}
	.w-id {
		display: grid;
		gap: 14px;
		min-width: 0;
	}
	.w-title {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px 14px;
	}
	h1 {
		font-size: var(--text-2xl);
		line-height: 1.1;
		letter-spacing: var(--tracking-tight);
	}
	h1 .mono {
		font-weight: 500;
	}
	.w-badges {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.w-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 10px 28px;
	}
	.w-meta > div {
		display: grid;
		gap: 4px;
		min-width: 0;
	}
	.w-meta dt {
		font-size: var(--text-xs);
		color: var(--text-3);
	}
	.w-meta dd {
		min-height: 28px;
		display: flex;
		align-items: center;
		min-width: 0;
	}
	.w-meta dd.plain {
		font-size: var(--text-sm);
		color: var(--text-2);
	}
	.w-bal {
		display: grid;
		justify-items: end;
		gap: 4px;
		text-align: right;
	}
	.w-bal .k {
		font-size: var(--text-xs);
		color: var(--text-3);
	}
	.w-bal .v {
		font-size: var(--text-3xl);
		font-weight: 600;
		letter-spacing: var(--tracking-display);
		line-height: 1.1;
		display: flex;
		align-items: baseline;
		gap: 6px;
	}
	.unit {
		font-size: var(--text-md);
		font-weight: 500;
		color: var(--text-3);
		letter-spacing: 0;
		margin-left: 6px;
	}
	.w-bal .sub {
		font-size: var(--text-xs);
		color: var(--text-3);
	}
	.unavail {
		font-size: var(--text-md);
		font-weight: 400;
		letter-spacing: 0;
		color: var(--text-3);
	}

	/* layout */
	.layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 360px;
		gap: 24px;
		align-items: start;
	}
	.main-col,
	.side-col {
		display: grid;
		gap: 24px;
		min-width: 0;
	}
	.side-col {
		position: sticky;
		top: calc(var(--nav-h) + 24px);
	}
	.panel {
		overflow: hidden;
	}
	.p-head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 12px 16px;
		flex-wrap: wrap;
		padding: 18px 20px 0;
	}
	.p-head h2 {
		font-size: var(--text-md);
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.h-sm {
		font-size: var(--text-sm) !important;
	}
	.p-sub {
		font-size: var(--text-sm);
		color: var(--text-3);
		margin-top: 2px;
	}
	.p-tools {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.checked {
		font-size: var(--text-xs);
		color: var(--text-3);
	}
	.count {
		font-size: var(--text-xs);
		font-weight: 500;
		padding: 1px 7px;
		border-radius: var(--radius-full);
		background: var(--surface-sunken);
		border: 1px solid var(--border);
		color: var(--text-2);
	}
	.p-body {
		padding: 18px 20px 20px;
	}
	.panel > :global(.wrap) {
		margin-top: 18px;
		border-top: 1px solid var(--border);
	}
	.stack {
		display: grid;
		gap: 16px;
	}
	.sk-stack {
		display: grid;
		gap: 12px;
	}
	.sk-row {
		display: flex;
		justify-content: space-between;
	}
	.small {
		font-size: var(--text-sm);
	}
	.fine {
		font-size: var(--text-xs);
		color: var(--text-3);
		text-align: center;
	}

	/* verdict */
	.verdict {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 14px;
		margin: 18px 20px 0;
		padding: 16px;
		border-radius: var(--radius-lg);
		border: 1px solid;
		animation: fade-up var(--dur-3) var(--ease-out);
	}
	.v-ico {
		display: grid;
		place-items: center;
		width: 40px;
		height: 40px;
		border-radius: 12px;
		color: #fff;
	}
	.v-label {
		font-size: var(--text-lg);
		font-weight: 600;
		letter-spacing: var(--tracking-tight);
		line-height: 1.2;
	}
	.v-count {
		font-weight: 500;
	}
	.v-head {
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--text);
		margin-top: 2px;
	}
	.v-exp {
		font-size: var(--text-sm);
		color: var(--text-2);
		margin-top: 4px;
		max-width: 62ch;
	}
	.verdict.clean {
		background: var(--clean-bg);
		border-color: var(--clean-border);
	}
	.verdict.clean .v-ico {
		background: var(--clean-solid);
	}
	.verdict.clean .v-label {
		color: var(--clean);
	}
	.verdict.dirty {
		background: var(--dirty-bg);
		border-color: var(--dirty-border);
	}
	.verdict.dirty .v-ico {
		background: var(--dirty-solid);
		color: #241a08;
	}
	.verdict.dirty .v-label {
		color: var(--dirty);
	}
	.verdict.busy {
		background: var(--busy-bg);
		border-color: var(--busy-border);
	}
	.verdict.busy .v-ico {
		background: var(--busy-solid);
	}
	.verdict.busy .v-label {
		color: var(--busy);
	}
	.verdict.bad {
		background: var(--bad-bg);
		border-color: var(--bad-border);
	}
	.verdict.bad .v-ico {
		background: var(--bad-solid);
	}
	.verdict.bad .v-label {
		color: var(--bad);
	}
	.meter-wrap {
		padding: 22px 20px 4px;
	}
	.reasons {
		margin: 16px 20px 20px;
		padding-top: 14px;
		border-top: 1px solid var(--border);
	}
	.r-title {
		font-size: var(--text-xs);
		color: var(--text-3);
		margin-bottom: 6px;
	}
	.reasons ul {
		display: grid;
		gap: 4px;
	}
	.reasons li {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 8px;
		align-items: baseline;
		font-size: var(--text-sm);
		color: var(--text-2);
	}
	.reasons li :global(svg) {
		transform: translateY(2px);
		color: var(--text-3);
	}

	.pending {
		margin: 0 20px 20px;
		border: 1px solid var(--dirty-border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}
	.pend-head {
		display: flex;
		justify-content: space-between;
		gap: 12px 16px;
		flex-wrap: wrap;
		padding: 14px;
		background: var(--dirty-bg);
	}
	.pend-title {
		font-weight: 600;
		font-size: var(--text-sm);
		color: var(--dirty);
	}
	.pend-sub {
		font-size: var(--text-xs);
		color: var(--text-2);
		margin-top: 2px;
		max-width: 52ch;
	}
	.pend-list li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px 10px;
		padding: 8px 8px 8px 14px;
		min-height: 46px;
		border-top: 1px solid var(--dirty-border);
		font-size: var(--text-sm);
	}
	.pl-act {
		margin-left: auto;
	}
	.pn {
		font-size: var(--text-xs);
		padding: 1px 6px;
		border-radius: 4px;
		background: var(--surface-sunken);
		border: 1px solid var(--border);
	}
	.arrow {
		color: var(--text-3);
		display: inline-flex;
	}

	/* side */
	.price-big {
		display: flex;
		align-items: baseline;
		font-size: var(--text-3xl);
		font-weight: 600;
		letter-spacing: var(--tracking-display);
		line-height: 1;
	}
	.seller {
		font-size: var(--text-sm);
		color: var(--text-3);
		margin-top: -8px;
		overflow-wrap: anywhere;
	}
	.frozen {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 12px;
		padding: 14px;
		border-radius: var(--radius-md);
		background: var(--accent-soft);
		border: 1px solid var(--accent-border);
	}
	.fz-ico {
		display: grid;
		place-items: center;
		width: 30px;
		height: 30px;
		border-radius: 8px;
		background: var(--accent);
		color: #fff;
	}
	.fz-t {
		font-weight: 600;
		font-size: var(--text-sm);
		color: var(--accent-text);
	}
	.fz-d {
		font-size: var(--text-sm);
		color: var(--text-2);
		margin-top: 2px;
	}

	.buy-steps {
		display: grid;
		gap: 0;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}
	.buy-steps li {
		display: grid;
		grid-template-columns: 22px 1fr;
		gap: 12px;
		padding: 14px;
	}
	.buy-steps li + li {
		border-top: 1px solid var(--border);
	}
	.bs-n {
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		border: 1px solid var(--border-strong);
		font-family: var(--font-mono);
		font-size: var(--text-2xs);
		color: var(--text-2);
	}
	.buy-steps li.done .bs-n {
		background: var(--clean-solid);
		border-color: var(--clean-solid);
		color: #fff;
	}
	.bs-body {
		display: grid;
		gap: 8px;
		justify-items: start;
		min-width: 0;
	}
	.bs-t {
		font-weight: 500;
		font-size: var(--text-sm);
		line-height: 22px;
	}
	.bs-d {
		font-size: var(--text-xs);
		color: var(--text-3);
		margin-top: -6px;
	}
	.bs-res {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		font-size: var(--text-xs);
	}

	.tried {
		border-color: var(--bad-border);
	}

	.kv {
		display: grid;
		padding: 12px 20px 4px;
	}
	.kv div {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 8px 0;
		border-bottom: 1px solid var(--border);
		font-size: var(--text-sm);
	}
	.kv div:last-child {
		border-bottom: 0;
	}
	.kv dt {
		color: var(--text-3);
	}
	.kv dd {
		text-align: right;
		overflow-wrap: anywhere;
		min-width: 0;
		font-size: var(--text-xs);
	}
	.det-link {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		margin: 6px 20px 18px;
		font-size: var(--text-sm);
	}

	@media (max-width: 1040px) {
		.layout {
			grid-template-columns: 1fr;
		}
		.side-col {
			position: static;
		}
		/* single column: verdict first, then what you can do, then the full log */
		.main-col {
			display: contents;
		}
		.verify-panel {
			order: 1;
		}
		.side-col {
			order: 2;
		}
		.log-panel {
			order: 3;
		}
	}
	@media (max-width: 760px) {
		.w-head {
			grid-template-columns: 72px minmax(0, 1fr);
			gap: 16px 16px;
			align-items: start;
		}
		.w-seal {
			width: 72px;
			height: 72px;
			border-radius: 14px;
		}
		.w-bal {
			grid-column: 1 / -1;
			justify-items: start;
			text-align: left;
			padding: 14px 16px;
			border: 1px solid var(--border);
			border-radius: var(--radius-lg);
			background: var(--surface);
		}
		.w-bal .v {
			font-size: var(--text-2xl);
		}
		.w-meta {
			grid-column: 1 / -1;
		}
		.w-id {
			display: contents;
		}
		.w-title {
			align-self: center;
		}
		.hide-sm {
			display: none !important;
		}
		h1 {
			font-size: var(--text-xl);
		}
	}
	@media (max-width: 520px) {
		.p-head {
			padding: 16px 16px 0;
		}
		.p-body {
			padding: 16px;
		}
		.verdict {
			margin: 16px 16px 0;
			padding: 14px;
			gap: 12px;
		}
		.v-ico {
			width: 34px;
			height: 34px;
			border-radius: 10px;
		}
		.meter-wrap {
			padding: 20px 16px 4px;
		}
		.reasons {
			margin: 14px 16px 16px;
		}
		.pending {
			margin: 0 16px 16px;
		}
		.kv {
			padding: 10px 16px 4px;
		}
		.det-link {
			margin: 6px 16px 16px;
		}
	}
</style>
