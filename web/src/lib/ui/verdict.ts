import type { Verdict } from '$lib/chain';
import type { IconName } from './Icon.svelte';

export type Tone = 'neutral' | 'accent' | 'clean' | 'dirty' | 'busy' | 'bad';

export interface VerdictMeta {
	label: string;
	tone: Tone;
	icon: IconName;
	headline: string;
	explain: string;
	safeToBuy: boolean;
}

export const VERDICTS: Record<Verdict, VerdictMeta> = {
	clean: {
		label: 'Clean',
		tone: 'clean',
		icon: 'shield-check',
		headline: 'No signature is waiting to be broadcast',
		explain:
			'Every signed transaction the contract ever issued for this address is already mined on Sepolia. None can be replayed later.',
		safeToBuy: true
	},
	dirty: {
		label: 'Dirty',
		tone: 'dirty',
		icon: 'alert',
		headline: 'Signed transactions exist that Sepolia has not seen',
		explain:
			'The contract issued signatures that are not mined yet. Until they land they could still move funds. Anyone can broadcast them to clear this.',
		safeToBuy: false
	},
	busy: {
		label: 'Busy',
		tone: 'busy',
		icon: 'clock',
		headline: 'A signature request is in flight',
		explain:
			'The NEAR signing network is producing a signature for this wallet right now. A new signed transaction may appear at any moment.',
		safeToBuy: false
	},
	inconsistent: {
		label: 'Inconsistent',
		tone: 'bad',
		icon: 'alert-octagon',
		headline: 'The contract log and the chain disagree',
		explain:
			'The public signature log does not match what Sepolia reports for this address. Do not buy until this is explained.',
		safeToBuy: false
	}
};
