// Regenerates app/src/abi.ts from the compiled artifacts, so the frontend can
// never drift from the deployed contracts. Run after `npm run compile`.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const contracts = ["WeirFactory", "WeirRoute", "WeirVault"];
const out = [
  "// GENERATED FILE. Do not edit by hand.",
  "// Regenerate with: npm run export-abi",
  "",
];

for (const name of contracts) {
  const path = `artifacts/contracts/${name}.sol/${name}.json`;
  if (!existsSync(path)) {
    console.error(`missing artifact: ${path}. Run 'npm run compile' first.`);
    process.exit(1);
  }
  const { abi } = JSON.parse(readFileSync(path, "utf8"));
  out.push(`export const ${name.toLowerCase()}Abi = ${JSON.stringify(abi, null, 2)} as const;`, "");
}

out.push(
  `export const erc20Abi = [`,
  `  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },`,
  `  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },`,
  `  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },`,
  `  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "v", type: "uint256" }], outputs: [{ type: "bool" }] },`,
  `] as const;`,
  "",
);

const rendered = out.join("\n");

// --stdout lets a test regenerate and compare without writing, so a stale
// committed ABI is reported rather than silently overwritten by the check
// that was supposed to catch it.
if (process.argv.includes("--stdout")) {
  process.stdout.write(rendered);
} else {
  writeFileSync("app/src/abi.ts", rendered);
  console.log(`wrote app/src/abi.ts (${contracts.join(", ")})`);
}
