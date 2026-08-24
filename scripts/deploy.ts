import { ethers, network } from "hardhat";
import { writeFileSync, readFileSync } from "node:fs";

/**
 * Deploys the Weir factory, and on a test network a mock USDT to exercise it
 * with. Writes the resulting addresses straight into the app config so the
 * frontend and the chain can never disagree about where the contracts are.
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const net = network.name;
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log(`network:  ${net}`);
  console.log(`deployer: ${deployer.address}`);
  console.log(`balance:  ${ethers.formatEther(balance)}`);

  if (balance === 0n) {
    throw new Error("Deployer has no gas. Fund it before deploying.");
  }

  // The forwarder has to exist first: both implementations bake its address in
  // as an immutable, which is what lets a clone read it.
  const forwarder = await (await ethers.getContractFactory("WeirForwarder")).deploy();
  await forwarder.waitForDeployment();
  const forwarderAddress = await forwarder.getAddress();
  console.log(`\nWeirForwarder:       ${forwarderAddress}`);

  const factory = await (await ethers.getContractFactory("WeirFactory")).deploy(forwarderAddress);
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();

  console.log(`WeirFactory:         ${factoryAddress}`);
  console.log(`  routeImplementation: ${await factory.routeImplementation()}`);
  console.log(`  vaultImplementation: ${await factory.vaultImplementation()}`);

  let usdtAddress: string | null = null;
  const isTestnet = net === "sepolia" || net === "localhost" || net === "hardhat";

  if (isTestnet) {
    const usdt = await (await ethers.getContractFactory("MockUSDT")).deploy();
    await usdt.waitForDeployment();
    usdtAddress = await usdt.getAddress();
    console.log(`MockUSDT:            ${usdtAddress}`);

    // Seed the deployer so the flow can be exercised end to end immediately.
    await (await usdt.mint(deployer.address, ethers.parseUnits("100000", 6))).wait();
    console.log(`  minted 100,000 test USDT to the deployer`);
  }

  patchConfig(net, factoryAddress, usdtAddress, forwarderAddress);

  console.log(`\nDone. Update app/src/config.ts is handled automatically.`);
}

/** Rewrites the factory and usdt fields for this network in app/src/config.ts. */
function patchConfig(net: string, factory: string, usdt: string | null, forwarder: string) {
  const path = "app/src/config.ts";
  const key = net === "hardhat" ? "localhost" : net;

  let src: string;
  try {
    src = readFileSync(path, "utf8");
  } catch {
    console.warn(`could not read ${path}, skipping config patch`);
    return;
  }

  const block = new RegExp(`(  ${key}: \\{[\\s\\S]*?\\n  \\},)`);
  const match = src.match(block);
  if (!match) {
    console.warn(`no config block for "${key}", skipping config patch`);
    return;
  }

  let updated = match[1]
    .replace(/factory: [^,]+,/, `factory: "${factory}",`)
    .replace(/forwarder: [^,]+,/, `forwarder: "${forwarder}",`)
    .replace(/usdt: [^,]+,/, usdt ? `usdt: "${usdt}",` : "$&");

  src = src.replace(block, updated);
  writeFileSync(path, src);
  console.log(`patched ${path} for "${key}"`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
