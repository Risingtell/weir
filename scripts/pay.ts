import { ethers } from "hardhat";

/**
 * Simulates a client paying a Weir address with a plain token transfer, the
 * way a real payer would: no approval, no contract call, no knowledge that
 * Weir exists. Then reports what the route did with it.
 *
 * Usage: ROUTE=0x… USDT=0x… AMOUNT=1000 npx hardhat run scripts/pay.ts --network localhost
 */
async function main() {
  const route = process.env.ROUTE;
  const usdtAddress = process.env.USDT;
  const amount = process.env.AMOUNT ?? "1000";

  if (!route || !usdtAddress) throw new Error("Set ROUTE and USDT env vars.");

  const [payer] = await ethers.getSigners();
  const usdt = await ethers.getContractAt("MockUSDT", usdtAddress);
  const decimals = await usdt.decimals();
  const value = ethers.parseUnits(amount, decimals);

  const balance = await usdt.balanceOf(payer.address);
  if (balance < value) {
    await (await usdt.mint(payer.address, value)).wait();
  }

  console.log(`paying ${amount} USDT to ${route} as a plain transfer`);
  await (await usdt.transfer(route, value)).wait();

  const waiting = await usdt.balanceOf(route);
  console.log(`route now holds ${ethers.formatUnits(waiting, decimals)} USDT, undistributed`);

  const weirRoute = await ethers.getContractAt("WeirRoute", route);
  const shares = await weirRoute.shares();

  console.log(`\ntriggering distribute (permissionless, anyone can call this)`);
  await (await weirRoute.distribute(usdtAddress)).wait();

  console.log(`\nafter the split:`);
  for (const s of shares) {
    const got = await usdt.balanceOf(s.account);
    console.log(`  ${s.account}  ${Number(s.bps) / 100}%  balance ${ethers.formatUnits(got, decimals)}`);
  }
  console.log(`  route leftover: ${ethers.formatUnits(await usdt.balanceOf(route), decimals)}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
