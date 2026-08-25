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
    const accounts = unwrap<string[]>(await provider.listAccounts());
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
    balanceLunas: await readBalance(provider, address),
    consensus: Boolean(consensus),
    blockNumber: blockNumber as number | null,
  };
}

/**
 * The SDK exposes no balance method. There is a generic `request` passthrough,
 * so try the usual Nimiq RPC names through it. Every one of these may be
 * unavailable, and a missing balance is not fatal: the amount to split is typed
 * in by the user and the wallet rejects the transfer if it is short.
 */
async function readBalance(provider: NimiqProvider, address: string): Promise<bigint | null> {
  const anyProvider = provider as unknown as {
    request?: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  };
  if (typeof anyProvider.request !== "function") return null;

  for (const method of ["getAccountByAddress", "getBalance", "account"]) {
    try {
      const result: any = await anyProvider.request({ method, params: [address] });
      const raw =
        typeof result === "number" || typeof result === "string"
          ? result
          : result?.balance ?? result?.data?.balance;
      if (raw !== undefined && raw !== null && raw !== "") return BigInt(raw);
    } catch {
      /* try the next name */
    }
  }
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
