import { resolve } from '$app/paths';

// Static prerender cannot enumerate token ids, so the wallet page takes ?id=.
// Links always carry the trailing slash (trailingSlash = 'always').
export const homeHref = () => resolve('/');
export const mintHref = () => `${resolve('/mint')}/`;
export const walletsHref = () => `${resolve('/wallets')}/`;
export const marketHref = () => `${resolve('/market')}/`;
export const howHref = (hash = '') => `${resolve('/how')}/${hash}`;
export const walletHref = (tokenId: string) => `${resolve('/wallet')}/?id=${encodeURIComponent(tokenId)}`;

export const REPO_URL = 'https://github.com/AlphaTechini/handover';
export const NFT_CHAIN_KEYS_URL = 'https://github.com/near/multichain-gas-station-contract/tree/master/nft_key';
export const SEPOLIA_FAUCET_URL = 'https://cloud.google.com/application/web3/faucet/ethereum/sepolia';
