// Deterministic generative "wallet seal". Same token id -> same art, everywhere.
// Visual language: banknote guilloche (security printing), because this is a
// security product. The outer tick ring encodes the wallet's Ethereum address
// when it is known, so the seal doubles as a visual address fingerprint.

function hash32(str: string, seed = 0x811c9dc5): number {
	let h = seed >>> 0;
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

function prng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export interface Band {
	d: string;
	copies: number;
	/** rotation step in degrees between copies */
	step: number;
	stroke: string;
	width: number;
	opacity: number;
}

export interface SealSpec {
	hue: number;
	bg0: string;
	bg1: string;
	ink: string;
	inkSoft: string;
	bands: Band[];
	ticks: { a: number; len: number }[];
	label: string;
}

const C = 100; // centre of the 200x200 viewBox

function ring(r0: number, amp: number, lobes: number, samples = 240, amp2 = 0, lobes2 = 0): string {
	let d = '';
	for (let i = 0; i <= samples; i++) {
		const t = (i / samples) * Math.PI * 2;
		const r = r0 + amp * Math.sin(lobes * t) + (amp2 ? amp2 * Math.sin(lobes2 * t) : 0);
		const x = C + r * Math.cos(t);
		const y = C + r * Math.sin(t);
		d += `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`;
	}
	return d + 'Z';
}

export function sealSpec(tokenId: string, address?: string | null, salt = 'handover'): SealSpec {
	const rnd = prng(hash32(`${salt}:${tokenId}`));
	const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];

	const hue = Math.floor(rnd() * 360);
	const hue2 = (hue + 25 + Math.floor(rnd() * 50)) % 360;
	const sat = 28 + Math.floor(rnd() * 18);

	const outerLobes = pick([12, 14, 16, 18, 20, 24]);
	const midLobes = pick([7, 8, 9, 10, 11]);
	const innerLobes = pick([5, 6, 7]);
	const ink = `hsl(${hue} 70% 82%)`;
	const inkSoft = `hsl(${hue2} 60% 72%)`;

	const bands: Band[] = [
		{
			d: ring(62 + rnd() * 3, 4 + rnd() * 3, outerLobes),
			copies: 10,
			step: 360 / outerLobes / 10,
			stroke: ink,
			width: 0.45,
			opacity: 0.55
		},
		{
			d: ring(41 + rnd() * 3, 8 + rnd() * 4, midLobes, 240, 1.5 + rnd() * 2, midLobes * 3),
			copies: 12,
			step: 360 / midLobes / 12,
			stroke: inkSoft,
			width: 0.45,
			opacity: 0.6
		},
		{
			d: ring(25 + rnd() * 2, 3.5 + rnd() * 2, innerLobes),
			copies: 8,
			step: 360 / innerLobes / 8,
			stroke: ink,
			width: 0.4,
			opacity: 0.45
		}
	];

	// Address fingerprint: 40 hex chars -> 40 ticks; a placeholder ring otherwise.
	const hex = address && /^0x[0-9a-fA-F]{40}$/.test(address) ? address.slice(2).toLowerCase() : null;
	const n = 40;
	const ticks = Array.from({ length: n }, (_, i) => ({
		a: (i / n) * 360,
		len: hex ? 1.5 + (parseInt(hex[i], 16) / 15) * 6.5 : 2
	}));

	return {
		hue,
		bg0: `hsl(${hue} ${sat}% 17%)`,
		bg1: `hsl(${hue2} ${sat + 6}% 7%)`,
		ink,
		inkSoft,
		bands,
		ticks,
		label: `#${tokenId}`
	};
}
