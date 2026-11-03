import { ethAddressFromMpcKey, fetchMpcDerivedKey } from '@handover/cleancheck';
import { HANDOVER_CONTRACT, MPC_CONTRACT, NEAR_RPC } from './config';
import type { Hex } from './types';

const memo = new Map<string, Promise<Hex>>();
const storageKey = (tokenId: string) => `handover:addr:${MPC_CONTRACT}:${HANDOVER_CONTRACT}:${tokenId}`;

function readStored(tokenId: string): Hex | null {
	try {
		const v = typeof localStorage !== 'undefined' ? localStorage.getItem(storageKey(tokenId)) : null;
		return v && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v as Hex) : null;
	} catch {
		return null;
	}
}

function writeStored(tokenId: string, address: Hex): void {
	try {
		if (typeof localStorage !== 'undefined') localStorage.setItem(storageKey(tokenId), address);
	} catch {
		/* storage unavailable */
	}
}

/** The wallet's Ethereum address (checksummed). Derived by the MPC contract; never changes for a given contract. */
export function walletAddress(tokenId: string): Promise<Hex> {
	const key = `${HANDOVER_CONTRACT}:${tokenId}`;
	const hit = memo.get(key);
	if (hit) return hit;
	const stored = readStored(tokenId);
	if (stored) {
		const p = Promise.resolve(stored);
		memo.set(key, p);
		return p;
	}
	const p = (async () => {
		const k = await fetchMpcDerivedKey(NEAR_RPC, MPC_CONTRACT, HANDOVER_CONTRACT, `handover-${tokenId}`);
		const addr = ethAddressFromMpcKey(k);
		writeStored(tokenId, addr);
		return addr;
	})();
	memo.set(key, p);
	p.catch(() => memo.delete(key)); // don't cache failures
	return p;
}
