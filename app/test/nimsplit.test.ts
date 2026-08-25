import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  LUNAS_PER_NIM,
  formatNim,
  parseNim,
  isNimiqAddress,
  normaliseNimiqAddress,
  planNimSplit,
} from "../src/nimsplit.ts";

const NIM = (n: number) => BigInt(Math.round(n * LUNAS_PER_NIM));
const A = "NQ07 0000 0000 0000 0000 0000 0000 0000 0000";
const B = "NQ11 1111 1111 1111 1111 1111 1111 1111 1111";
const C = "NQ22 2222 2222 2222 2222 2222 2222 2222 2222";

describe("parseNim", () => {
  test("reads whole and fractional NIM", () => {
    assert.equal(parseNim("1"), 100_000n);
    assert.equal(parseNim("0.5"), 50_000n);
    assert.equal(parseNim("12.34567"), 1_234_567n);
    assert.equal(parseNim(" 1,234 "), 123_400_000n);
  });

  test("drops anything finer than a Luna rather than rounding up", () => {
    // Rounding up would send money the user never agreed to.
    assert.equal(parseNim("0.123456789"), 12_345n);
  });

  test("rejects things that are not numbers", () => {
    for (const bad of ["", ".", "abc", "1.2.3", "-5", "1e5"]) {
      assert.throws(() => parseNim(bad), undefined, `should reject ${JSON.stringify(bad)}`);
    }
  });
});

describe("formatNim", () => {
  test("round trips through parseNim without drift", () => {
    for (const v of ["0", "1", "0.5", "1234.56789", "1000000"]) {
      const lunas = parseNim(v);
      assert.equal(parseNim(formatNim(lunas)), lunas, `drifted on ${v}`);
    }
  });

  test("trims trailing zeros but keeps significant ones", () => {
    assert.equal(formatNim(100_000n), "1");
    assert.equal(formatNim(150_000n), "1.5");
    assert.equal(formatNim(100_001n), "1.00001");
    assert.equal(formatNim(0n), "0");
  });

  test("groups thousands", () => {
    assert.equal(formatNim(NIM(1_234_567)), "1,234,567");
  });
});

describe("isNimiqAddress", () => {
  test("accepts real addresses with or without spaces", () => {
    assert.equal(isNimiqAddress(A), true);
    assert.equal(isNimiqAddress(A.replace(/\s/g, "")), true);
    assert.equal(isNimiqAddress(A.toLowerCase()), true);
  });

  test("rejects an EVM address and other near misses", () => {
    assert.equal(isNimiqAddress("0x76196d00685AFe2d1aab8AbdfdD4f38b1407FDFb"), false);
    assert.equal(isNimiqAddress("NQ07"), false);
    assert.equal(isNimiqAddress(""), false);
    assert.equal(isNimiqAddress("NQ07 0000 0000 0000 0000 0000 0000 0000 00000"), false);
  });
});

describe("normaliseNimiqAddress", () => {
  test("regroups into blocks of four", () => {
    assert.equal(normaliseNimiqAddress(A.replace(/\s/g, "").toLowerCase()), A);
  });
});

describe("planNimSplit", () => {
  test("splits by basis points", () => {
    const rows = planNimSplit(NIM(1000), [
      { address: A, bps: 5000 },
      { address: B, bps: 3000 },
      { address: C, bps: 2000 },
    ]);
    assert.deepEqual(
      rows.map((r) => r.lunas),
      [NIM(500), NIM(300), NIM(200)],
    );
  });

  test("never loses or invents a Luna on an awkward amount", () => {
    // A three way split of a prime number of Lunas is the case that would
    // strand dust if the remainder were simply dropped.
    const total = 1_000_003n;
    const rows = planNimSplit(total, [
      { address: A, bps: 3333 },
      { address: B, bps: 3333 },
      { address: C, bps: 3334 },
    ]);
    assert.equal(
      rows.reduce((a, r) => a + r.lunas, 0n),
      total,
    );
  });

  test("gives the remainder to the last row, matching the on-chain rule", () => {
    const rows = planNimSplit(10n, [
      { address: A, bps: 3333 },
      { address: B, bps: 6667 },
    ]);
    assert.equal(rows[0].lunas, 3n); // floor(10 * 0.3333)
    assert.equal(rows[1].lunas, 7n); // the rest, not floor(10 * 0.6667) = 6
    assert.equal(rows[0].lunas + rows[1].lunas, 10n);
  });

  test("handles a single recipient taking everything", () => {
    const rows = planNimSplit(NIM(42), [{ address: A, bps: 10000 }]);
    assert.equal(rows[0].lunas, NIM(42));
  });

  test("handles zero", () => {
    const rows = planNimSplit(0n, [
      { address: A, bps: 5000 },
      { address: B, bps: 5000 },
    ]);
    assert.deepEqual(rows.map((r) => r.lunas), [0n, 0n]);
  });

  test("refuses shares that do not add up to 100 percent", () => {
    assert.throws(
      () => planNimSplit(NIM(1), [{ address: A, bps: 5000 }, { address: B, bps: 4000 }]),
      /100%/,
    );
  });

  test("refuses a negative amount", () => {
    assert.throws(() => planNimSplit(-1n, [{ address: A, bps: 10000 }]), /negative/);
  });
});
