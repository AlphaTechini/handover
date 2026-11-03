// Per-browser memory of wallets an account has owned, so a seller who comes back
// after a sale is told plainly that the contract will now refuse them.
// Convenience only: nothing here is trusted or required for correctness.
const KEY = 'handover:owned-by';

function read(): Record<string, string[]> {
	try {
		const raw = localStorage.getItem(KEY);
		const v = raw ? JSON.parse(raw) : {};
		return v && typeof v === 'object' ? v : {};
	} catch {
		return {};
	}
}

export function rememberOwned(account: string, tokenId: string): void {
	try {
		const all = read();
		const list = new Set(all[account] ?? []);
		if (list.has(tokenId)) return;
		list.add(tokenId);
		all[account] = [...list];
		localStorage.setItem(KEY, JSON.stringify(all));
	} catch {
		/* storage unavailable */
	}
}

export function previouslyOwned(account: string, tokenId: string): boolean {
	return (read()[account] ?? []).includes(tokenId);
}
