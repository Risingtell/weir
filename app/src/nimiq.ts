import { init, getHostLanguage, requestDeviceIdentifier } from "@nimiq/mini-app-sdk";
import type { NimiqProvider } from "@nimiq/mini-app-sdk";
import type { NimSplitRow } from "./nimsplit";

export {
  LUNAS_PER_NIM,
  formatNim,
  parseNim,
  isNimiqAddress,
  normaliseNimiqAddress,
  planNimSplit,
} from "./nimsplit";
export type { NimSplitRow } from "./nimsplit";

/**
 * The Nimiq-native half of Weir.
 *
 * Nimiq has no smart contracts, so a NIM split cannot be enforced the way the
 * USDT one is. There is no contract to hold the money and pay it out. What the
 * app can do is compute the same split and send one transfer per recipient,
 * each through its own Nimiq Pay confirmation.
 *
 * That difference is real and the UI says so plainly rather than implying the
 * two work alike.
 */

export interface NimiqSession {
  provider: NimiqProvider;
  address: string;
  /** Null when the wallet exposes no way to read a balance. */
  balanceLunas: bigint | null;
  consensus: boolean;
  blockNumber: number | null;
}

/**
 * The Nimiq Pay bridge intermittently answers with
 * `[birpc] timeout on calling "handleRequest"` even when the call is fine.
 * Measured on a real device: listAccounts timed out once and then returned a
 * perfectly good address on the retry.
 */
async function withRetry<T>(fn: () => Promise<T>, attempts = 3, delayMs = 700): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const message = String((e as any)?.message ?? e);
      if (/user rejected|denied|user cancell?ed/i.test(message)) throw e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw last;
}

/** Anything the SDK may hand back instead of a value. */
function unwrap<T>(value: T | { error?: unknown; message?: string }): T {
  if (value && typeof value === "object" && ("error" in value || "message" in value)) {
    const e = value as { error?: unknown; message?: string };
    throw new Error(e.message ?? String(e.error ?? "Nimiq request failed"));
  }
  return value as T;
}

export function hostLanguage(): string | undefined {
  try {
    return getHostLanguage();
  } catch {
    return undefined;
  }
}

export async function deviceIdentifier(reason: string): Promise<string | null> {
  try {
    return await requestDeviceIdentifier({ reason });
  } catch {
    return null;
  }
}

/**
 * Connects to the Nimiq side. Resolves null rather than throwing when the app
 * is not running inside Nimiq Pay, because the USDT half must keep working on
 * its own.
 */
export async function connectNimiq(timeout = 4000): Promise<NimiqSession | null> {
  let provider: NimiqProvider;
  try {
    provider = await init({ timeout });
  } catch {
    return null;
  }

  let address: string;
  try {
    const accounts = await withRetry(async () => unwrap<string[]>(await provider.listAccounts()));
    if (!accounts?.length) return null;
    address = accounts[0];
  } catch {
    return null;
  }

  const [consensus, blockNumber] = await Promise.all([
    provider.isConsensusEstablished().catch(() => false),
    provider.getBlockNumber().catch(() => null),
  ]);

  return {
    provider,
    address,
    balanceLunas: balanceIsUnavailable(),
    consensus: Boolean(consensus),
    blockNumber: blockNumber as number | null,
  };
}

/**
 * Nimiq Pay exposes no way to read a NIM balance to a mini app.
 *
 * This is not an assumption. All three plausible RPC names were tried against
 * the real wallet on a real device and every one answered "Load failed":
 * getAccountByAddress, getBalance and account. Retrying them on every launch
 * would only add three doomed round trips to startup, so the app asks the user
 * for the amount instead and lets the wallet reject a transfer it cannot cover.
 */
function balanceIsUnavailable(): null {
  return null;
}

export interface NimSendProgress {
  index: number;
  total: number;
  address: string;
  lunas: bigint;
}

/**
 * Sends the planned split, one transfer at a time.
 *
 * Each transfer is a separate Nimiq Pay confirmation, and there is no way to
 * batch them, so a partial result is a real outcome rather than an edge case:
 * the caller is told exactly which rows went through and which did not.
 */
export async function sendNimSplit(
  session: NimiqSession,
  rows: NimSplitRow[],
  onProgress?: (p: NimSendProgress) => void,
): Promise<{ sent: NimSplitRow[]; failed: { row: NimSplitRow; reason: string }[] }> {
  const sent: NimSplitRow[] = [];
  const failed: { row: NimSplitRow; reason: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.lunas <= 0n) continue;

    onProgress?.({ index: i + 1, total: rows.length, address: row.address, lunas: row.lunas });

    try {
      unwrap<string>(
        await session.provider.sendBasicTransaction({
          recipient: row.address.replace(/\s/g, ""),
          value: Number(row.lunas),
        }),
      );
      sent.push(row);
    } catch (e) {
      failed.push({ row, reason: (e as Error)?.message ?? "rejected" });
    }
  }

  return { sent, failed };
}
