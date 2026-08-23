import { ethers } from "hardhat";

/** Creates a team route owned by account 0 that also pays accounts 1 and 2, then funds it. */
async function main() {
  const factoryAddress = process.env.FACTORY!;
  const usdtAddress = process.env.USDT!;
  const [owner, alice, bob] = await ethers.getSigners();

  const factory = await ethers.getContractAt("WeirFactory", factoryAddress);
  const usdt = await ethers.getContractAt("MockUSDT", usdtAddress);

  const receipt = await (
    await factory.createRoute([
      { account: owner.address, bps: 5000 },
      { account: alice.address, bps: 3000 },
      { account: bob.address, bps: 2000 },
    ])
  ).wait();

  const ev = receipt!.logs
    .map((l: any) => { try { return factory.interface.parseLog(l); } catch { return null; } })
    .find((l: any) => l?.name === "RouteCreated");
  const route = ev!.args.route;

  await (await usdt.mint(owner.address, ethers.parseUnits("5000", 6))).wait();
  await (await usdt.transfer(route, ethers.parseUnits("900", 6))).wait();

  console.log(`team route: ${route}`);
  console.log(`  owner ${owner.address} 50%`);
  console.log(`  alice ${alice.address} 30%`);
  console.log(`  bob   ${bob.address} 20%`);
  console.log(`funded with 900 USDT, left undistributed on purpose`);
  console.log(`alice sees routes: ${await factory.routesPaying(alice.address)}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
