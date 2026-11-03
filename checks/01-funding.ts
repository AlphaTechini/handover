// Check 1: funding. Proves the human can actually fund both sides of the system.
//
//   NEAR:    the testnet account NEAR_ACCOUNT_ID exists and holds a positive balance
//            (view_account over NEAR_RPC).
//   Sepolia: the Ethereum address (argument or SEPOLIA_FUNDED_ADDRESS) holds a
//            positive ETH balance (eth_getBalance over SEPOLIA_RPC).
//
// PASS if both are positive. A missing account or a zero balance prints the
// funding commands. Usage: tsx 01-funding.ts [0xSepoliaAddress]

import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { EnvError, getNearAccountId, getNearRpc, getSepoliaFundedAddress, getSepoliaRpc, parseEthAddress, scriptArgs } from './lib/env';
import { formatNear, nearRpc } from './lib/near';
import { report, runMain, type Status } from './lib/report';

const ID = '01-funding';

const NEAR_CLI_INSTALL = `curl -sSL https://github.com/near/near-cli-rs/releases/download/v0.30.1/near-cli-rs-x86_64-unknown-linux-gnu.tar.gz | tar xz`;
const NEAR_CREATE = (acct: string) =>
  `near account create-account sponsor-by-faucet-service ${acct} autogenerate-new-keypair save-to-legacy-keychain network-config testnet create`;
const SEPOLIA_FAUCET = 'https://cloud.google.com/application/web3/faucet/ethereum/sepolia';

function printFundingHelp(nearAccount: string, needNear: boolean, needSepolia: boolean): void {
  console.log('');
  if (needNear) {
    console.log('How to fund the NEAR side (testnet, free faucet):');
    console.log(`  1. Install near-cli-rs 0.30.1 (one time, Linux x86_64; macOS users: use the release for your platform):`);
    console.log(`     ${NEAR_CLI_INSTALL}`);
    console.log(`  2. Create and fund the account (generates a key and saves it locally, never print it):`);
    console.log(`     ${NEAR_CREATE(nearAccount)}`);
    console.log(`     Short form from the NEAR docs: near create-account ${nearAccount} --useFaucet --networkId testnet`);
    console.log('');
  }
  if (needSepolia) {
    console.log('How to fund the Sepolia side:');
    console.log(`  Google Cloud Web3 faucet (about 0.05 ETH per day with a Google account, no mainnet balance needed):`);
    console.log(`  ${SEPOLIA_FAUCET}`);
    console.log('  Paste the Ethereum address that holds your test funds (for check 5, the address derived for your token is printed by check 5).');
    console.log('');
  }
}

async function nearAccountBalance(rpc: string, account: string): Promise<{ exists: boolean; yocto: bigint }> {
  try {
    const v = await nearRpc<{ amount: string }>(rpc, 'query', {
      request_type: 'view_account',
      finality: 'final',
      account_id: account,
    });
    return { exists: true, yocto: BigInt(v.amount) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/UNKNOWN_ACCOUNT|does not exist/i.test(msg)) return { exists: false, yocto: 0n };
    throw err;
  }
}

async function main(): Promise<number> {
  const args = scriptArgs();
  const addrArg = args.find((a) => !a.startsWith('--'));
  const raw = addrArg ?? getSepoliaFundedAddress();
  if (!raw) {
    throw new EnvError(
      'no Sepolia address: pass one as the argument (tsx 01-funding.ts 0x...) or set SEPOLIA_FUNDED_ADDRESS, see .env.example',
    );
  }
  const sepoliaAddress = parseEthAddress(raw, 'Sepolia address');
  const nearAccount = getNearAccountId();
  const nearRpcUrl = getNearRpc();
  const sepoliaRpcUrl = getSepoliaRpc();

  const near = await nearAccountBalance(nearRpcUrl, nearAccount);
  const client = createPublicClient({ chain: sepolia, transport: http(sepoliaRpcUrl, { timeout: 20_000 }) });
  const sepWei = await client.getBalance({ address: sepoliaAddress });

  const nearOk = near.exists && near.yocto > 0n;
  const sepOk = sepWei > 0n;
  const status: Status = nearOk && sepOk ? 'PASS' : 'FAIL';
  const reasons: string[] = [];
  if (!near.exists) reasons.push(`NEAR account ${nearAccount} does not exist on testnet.`);
  else if (near.yocto === 0n) reasons.push(`NEAR account ${nearAccount} has a zero balance.`);
  if (!sepOk) reasons.push(`Sepolia address ${sepoliaAddress} has a zero balance.`);

  const evidence = {
    near_account: nearAccount,
    near_exists: near.exists,
    near_balance_near: near.exists ? formatNear(near.yocto) : 'n/a',
    near_balance_yocto: near.yocto.toString(),
    sepolia_address: sepoliaAddress,
    sepolia_balance_wei: sepWei.toString(),
    near_rpc: nearRpcUrl,
    sepolia_rpc: sepoliaRpcUrl,
  };
  report({
    id: ID,
    status,
    summary: status === 'PASS' ? 'Both the NEAR account and the Sepolia address hold funds.' : 'At least one side is unfunded.',
    evidence,
    reasons,
  });
  if (status === 'FAIL') printFundingHelp(nearAccount, !nearOk, !sepOk);
  return status === 'PASS' ? 0 : 1;
}

runMain(ID, main);
