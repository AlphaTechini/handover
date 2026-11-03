// Shared environment loading for the capability checks.
//
// Reads /home/user/handover/.env (the repo root .env, git-ignored) through
// Node's built-in process.loadEnvFile when present. Variables already set in
// the real environment win over the file. Getters are lazy, so a script only
// fails for the variables it actually needs. Errors say which variable is
// missing and point at .env.example. Secret values are never printed.

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ENV_FILE = resolve(REPO_ROOT, '.env');
export const EVIDENCE_DIR = resolve(REPO_ROOT, 'evidence');

/** Thrown for missing or malformed configuration or arguments. Scripts map this to exit code 2. */
export class EnvError extends Error {
  override name = 'EnvError';
}

/** Bad command-line usage. Same exit code as a missing variable. */
export class UsageError extends EnvError {
  override name = 'UsageError';
}

if (existsSync(ENV_FILE)) {
  try {
    process.loadEnvFile(ENV_FILE);
  } catch (err) {
    throw new EnvError(`could not parse ${ENV_FILE}: ${(err as Error).message}`);
  }
}

function read(name: string): string | undefined {
  const v = process.env[name];
  if (v === undefined) return undefined;
  const t = v.trim();
  return t === '' ? undefined : t;
}

export function requireVar(name: string, hint?: string): string {
  const v = read(name);
  if (v === undefined) {
    const extra = hint ? ` (${hint})` : '';
    throw new EnvError(`missing env var ${name}${extra}, see .env.example`);
  }
  return v;
}

export function optionalVar(name: string, fallback: string): string {
  return read(name) ?? fallback;
}

// ---- Typed getters -------------------------------------------------------

/** NEAR testnet account the human controls (e.g. alice.testnet). */
export const getNearAccountId = (): string => requireVar('NEAR_ACCOUNT_ID');

/**
 * Raw NEAR key for scripts that sign directly. None of the checks in this folder
 * sign with it: near-cli-rs keeps keys in ~/.near-credentials. The value is never printed.
 */
export const getNearPrivateKey = (): string => requireVar('NEAR_PRIVATE_KEY');

export const getNearRpc = (): string => optionalVar('NEAR_RPC', 'https://test.rpc.fastnear.com');

export const getMpcContract = (): string => optionalVar('MPC_CONTRACT', 'v1.signer-prod.testnet');

/** Account where checks/02-mpc-sign/ is deployed. */
export const getProbeContract = (): string =>
  requireVar('PROBE_CONTRACT', 'the account the probe contract is deployed to');

export const getHandoverContract = (): string =>
  requireVar('HANDOVER_CONTRACT', 'the account the Handover contract is deployed to');

export const getSepoliaRpc = (): string =>
  optionalVar('SEPOLIA_RPC', 'https://ethereum-sepolia-rpc.publicnode.com');

export const getTokenId = (): string => {
  const v = optionalVar('TOKEN_ID', '0');
  if (!/^\d+$/.test(v)) throw new EnvError(`TOKEN_ID must be a decimal number, got "${v}", see .env.example`);
  return v;
};

/** Sepolia address funded with test ETH (optional fallback for check 1). */
export const getSepoliaFundedAddress = (): string | undefined => read('SEPOLIA_FUNDED_ADDRESS');

/** Parses a 0x-prefixed 20-byte Ethereum address, or throws EnvError. */
export function parseEthAddress(v: string, what: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{40}$/.test(v)) {
    throw new EnvError(`${what} must be a 0x-prefixed 20-byte address, got "${v}"`);
  }
  return v as `0x${string}`;
}

/** Script arguments. pnpm passes a literal "--" through to the script, so drop it. */
export function scriptArgs(): string[] {
  return process.argv.slice(2).filter((a) => a !== '--');
}
