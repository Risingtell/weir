/**
 * Pure NIM arithmetic and address handling.
 *
 * Kept free of the Nimiq SDK, and therefore of any DOM, so the money maths can
 * be tested directly in node. Everything that touches the wallet lives in
 * nimiq.ts and imports from here.
 */

/** 1 NIM = 1e5 Lunas. */
export const LUNAS_PER_NIM = 100_000;
const LUNAS = BigInt(LUNAS_PER_NIM);

export function formatNim(lunas: bigint): string {
  const negative = lunas < 0n;
  const abs = negative ? -lunas : lunas;
  const whole = abs / LUNAS;
  const frac = abs % LUNAS;
  const fracStr = frac.toString().padStart(5, "0").replace(/0+$/, "");
  const body = fracStr ? `${whole.toLocaleString("en-US")}.${fracStr}` : whole.toLocaleString("en-US");
  return negative ? `-${body}` : body;
}

export function parseNim(input: string): bigint {
  const cleaned = input.trim().replace(/,/g, "");
  if (cleaned === "" || cleaned === "." || !/^\d*(\.\d*)?$/.test(cleaned)) {
    throw new Error("Enter a number.");
  }
  const [whole, frac = ""] = cleaned.split(".");
  // Anything finer than a Luna cannot be sent, so it is dropped rather than
  // rounded up into money the user did not agree to.
  const padded = frac.slice(0, 5).padEnd(5, "0");
  return BigInt(whole || "0") * LUNAS + BigInt(padded || "0");
}

/** Nimiq addresses are NQ followed by 34 base32 characters, spaces optional. */
export function isNimiqAddress(value: string): boolean {
  return /^NQ[0-9A-Z]{34}$/.test(value.replace(/\s/g, "").toUpperCase());
}

export function normaliseNimiqAddress(value: string): string {
  return value
    .replace(/\s/g, "")
    .toUpperCase()
    .replace(/(.{4})/g, "$1 ")
    .trim();
}

export interface NimSplitRow {
  address: string;
  bps: number;
  lunas: bigint;
}

/**
 * Splits an amount by the same basis points the USDT route uses.
 *
 * The rounding remainder goes to the last row, exactly as WeirRoute.distribute
 * does on chain, so the two halves of the product divide money identically and
 * the full amount is always accounted for.
 */
export function planNimSplit(
  totalLunas: bigint,
  shares: { address: string; bps: number }[],
): NimSplitRow[] {
  if (totalLunas < 0n) throw new Error("Amount cannot be negative.");
  if (!shares.length) return [];

  const sum = shares.reduce((a, s) => a + s.bps, 0);
  if (sum !== 10_000) throw new Error(`Shares must add up to 100%, got ${sum / 100}%.`);

  const rows: NimSplitRow[] = [];
  let allocated = 0n;

  shares.forEach((s, i) => {
    const isLast = i === shares.length - 1;
    const lunas = isLast ? totalLunas - allocated : (totalLunas * BigInt(s.bps)) / 10_000n;
    allocated += lunas;
    rows.push({ address: s.address, bps: s.bps, lunas });
  });

  return rows;
}
