import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

/**
 * Fails when the committed ABI no longer matches the compiled contracts.
 *
 * This exists because it already happened. `npm run compile` regenerates
 * app/src/abi.ts, but running `npx hardhat compile` directly skips that step,
 * and a stale ABI missing an entire constructor argument and two new contract
 * members was committed and pushed. Nothing broke loudly: the app kept building
 * and every test kept passing, because nothing compared the two.
 *
 * A cold-clone review caught it. This makes the consistency an assertion rather
 * than a convention, so the next drift names itself instead of shipping.
 */

const ABI_PATH = "src/abi.ts";
const ARTIFACTS = "../artifacts/contracts";

describe("generated ABI", () => {
  test("matches the compiled contracts", (t) => {
    if (!existsSync(ARTIFACTS)) {
      // Nothing has been compiled in this checkout, so there is nothing to
      // compare against. Skipping is honest; passing would be a false green.
      return t.skip("contracts not compiled, run npm run compile at the repo root");
    }

    const committed = readFileSync(ABI_PATH, "utf8");

    // Regenerate into a temporary location and compare, rather than trusting
    // that whoever last touched the contracts remembered to run the generator.
    const regenerated = execFileSync(
      process.execPath,
      // Path is relative to cwd, which is the repo root here, not app/.
      ["scripts/export-abi.mjs", "--stdout"],
      { cwd: "..", encoding: "utf8" },
    );

    const normalise = (s: string) => s.replace(/\r\n/g, "\n").trim();

    assert.equal(
      normalise(committed),
      normalise(regenerated),
      "app/src/abi.ts is stale. Run `npm run compile` at the repo root and commit the result.",
    );
  });
});
