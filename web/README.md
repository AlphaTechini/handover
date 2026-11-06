# web

The Handover web app (SvelteKit, Svelte 5), hosted at https://handover-blush.vercel.app. It has no
backend: the browser reads the NEAR contract, Sepolia and the public Blockscout token index directly,
and the user's NEAR wallet signs every contract call.

Decision: static build with `@sveltejs/adapter-static` ([`vite.config.ts`](vite.config.ts)). A static
app holds no keys and no server state, so there is nothing to trust beyond the chain itself. The
tradeoff is that every read goes to public RPCs from the browser, and the token list depends on
Blockscout's index (it can lag or miss a contract; the token form still sends anything by contract and id).

## Where things are

- To find the contract calls (mint, send ETH, send a token, list, buy, release), visit [`src/lib/chain/handover.ts`](src/lib/chain/handover.ts).
- To find the clean check as the app runs it, visit [`src/lib/chain/status.ts`](src/lib/chain/status.ts) (it reuses [`packages/cleancheck`](../packages/cleancheck/README.md)).
- To find Sepolia reads, fees, broadcast and receipts, visit [`src/lib/chain/eth.ts`](src/lib/chain/eth.ts) and [`src/lib/chain/fees.ts`](src/lib/chain/fees.ts).
- To find token holdings, token transfer encoding and log decoding, visit [`src/lib/chain/tokens.ts`](src/lib/chain/tokens.ts).
- The NEAR wallet connection can be found in [`src/lib/chain/wallet.svelte.ts`](src/lib/chain/wallet.svelte.ts); network and contract settings in [`src/lib/chain/config.ts`](src/lib/chain/config.ts).
- To find the wallet page (verification, send ETH, send a token, send everything, list, buy), visit [`src/routes/wallet/+page.svelte`](src/routes/wallet/+page.svelte).
- To find the send forms, visit [`src/lib/ui/SendForm.svelte`](src/lib/ui/SendForm.svelte), [`src/lib/ui/TokenSendForm.svelte`](src/lib/ui/TokenSendForm.svelte) and [`src/lib/ui/SweepForm.svelte`](src/lib/ui/SweepForm.svelte).
- Other pages: [`src/routes/+page.svelte`](src/routes/+page.svelte) (overview), [`mint`](src/routes/mint/+page.svelte), [`market`](src/routes/market/+page.svelte), [`wallets`](src/routes/wallets/+page.svelte), [`how`](src/routes/how/+page.svelte).

## Run

Settings come from `web/.env` (copy [`.env.example`](.env.example); all values are public and inlined at build time).

```bash
pnpm --filter web dev     # dev server
pnpm --filter web check   # type check
pnpm --filter web test    # chain-layer unit tests
pnpm --filter web build   # static site in web/build
```
