import type { NearConnector } from '@hot-labs/near-connect';
import type { NearWalletState } from './types';
import { HANDOVER_CONTRACT, NEAR_NETWORK, NEAR_RPC } from './config';
import { decodeSuccessValue, extractOutcomeError, outcomeTxHash } from './errors';

/** Reactive wallet session. Fields are mutated in place; never reassign the object. */
export const nearWallet: NearWalletState = $state({ accountId: null, connecting: false, ready: false });

let connector: NearConnector | null = null;
let initPromise: Promise<void> | null = null;

const inBrowser = () => typeof window !== 'undefined';

/** Creates the near-connect connector (browser only), restores a previous session, wires events. Idempotent. */
export function initWallet(): Promise<void> {
	if (!inBrowser()) return Promise.resolve();
	if (initPromise) return initPromise;
	initPromise = (async () => {
		try {
			const { NearConnector } = await import('@hot-labs/near-connect');
			const c = new NearConnector({
				network: NEAR_NETWORK,
				providers: { testnet: [NEAR_RPC] },
				footerBranding: null
			});
			connector = c;
			c.on('wallet:signIn', (e) => {
				nearWallet.accountId = e.accounts?.[0]?.accountId ?? null;
				nearWallet.connecting = false;
			});
			c.on('wallet:signOut', () => {
				nearWallet.accountId = null;
				nearWallet.connecting = false;
			});
			try {
				const { accounts } = await c.getConnectedWallet();
				nearWallet.accountId = accounts?.[0]?.accountId ?? null;
			} catch {
				nearWallet.accountId = null; // no stored session
			}
		} catch (err) {
			initPromise = null; // allow a retry
			throw err;
		} finally {
			nearWallet.ready = true;
		}
	})();
	return initPromise;
}

const isCancel = (err: unknown) => /clos|reject|cancel|declin|denied/i.test(err instanceof Error ? err.message : String(err));

export async function connectWallet(): Promise<void> {
	if (!inBrowser()) return;
	await initWallet();
	if (!connector) throw new Error('Wallet connector is not available');
	nearWallet.connecting = true;
	try {
		await connector.connect();
	} catch (err) {
		if (!isCancel(err)) throw err; // closing the selector is not an error
	} finally {
		nearWallet.connecting = false;
	}
}

export async function disconnectWallet(): Promise<void> {
	if (!inBrowser()) return;
	await initWallet();
	try {
		await connector?.disconnect();
	} finally {
		nearWallet.accountId = null;
	}
}

export interface CallOptions {
	/** yoctogas, decimal string (default 100 Tgas) */
	gas?: string;
	/** yoctoNEAR, decimal string (default "0") */
	deposit?: string;
}

export interface CallResult<T> {
	/** Decoded JSON of the final SuccessValue, or null when empty / the wallet returned no outcome */
	value: T | null;
	/** NEAR transaction hash, when the wallet reported one */
	txHash: string | null;
}

/**
 * Signs and sends a FunctionCall to the Handover contract through the connected wallet.
 * Throws an Error carrying the contract's own panic string when execution fails.
 */
export async function callContract<T = unknown>(
	methodName: string,
	args: Record<string, unknown>,
	opts: CallOptions = {}
): Promise<CallResult<T>> {
	if (!inBrowser()) throw new Error('Wallet calls are only available in the browser');
	if (!HANDOVER_CONTRACT) throw new Error('PUBLIC_HANDOVER_CONTRACT is not configured');
	await initWallet();
	if (!connector || !nearWallet.accountId) throw new Error('Connect a NEAR wallet first');
	const wallet = await connector.wallet();
	const outcome: any = await wallet.signAndSendTransaction({
		receiverId: HANDOVER_CONTRACT,
		actions: [
			{
				type: 'FunctionCall',
				params: { methodName, args, gas: opts.gas ?? '100000000000000', deposit: opts.deposit ?? '0' }
			}
		]
	});
	if (outcome == null) return { value: null, txHash: null };
	const failure = extractOutcomeError(outcome);
	if (failure) throw new Error(failure);
	let value: T | null = null;
	try {
		value = decodeSuccessValue<T>(outcome);
	} catch {
		value = null;
	}
	return { value, txHash: outcomeTxHash(outcome) };
}
