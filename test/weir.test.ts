import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import type { Signer } from "ethers";

const USDT = (n: string) => ethers.parseUnits(n, 6);

async function deployFixture() {
  const [owner, alice, bob, carol, stranger, relayer] = await ethers.getSigners();
  const forwarder = await (await ethers.getContractFactory("WeirForwarder")).deploy();
  await forwarder.waitForDeployment();
  const factory = await (
    await ethers.getContractFactory("WeirFactory")
  ).deploy(await forwarder.getAddress());
  const usdt = await (await ethers.getContractFactory("MockUSDT")).deploy();
  return { factory, usdt, forwarder, owner, alice, bob, carol, stranger, relayer };
}

/**
 * Signs an ERC-2771 request so `from` can act without holding any gas, and
 * submits it through `relayer`, who pays. This is the path a real Weir user
 * takes: they hold USDT and no POL.
 */
async function relay(
  forwarder: any,
  relayer: Signer,
  from: any,
  to: string,
  data: string,
) {
  const nonce = await forwarder.nonces(from.address);
  const deadline = (await time.latest()) + 3600;
  const gas = 1_000_000n;

  const domain = {
    name: "Weir",
    version: "1",
    chainId: (await ethers.provider.getNetwork()).chainId,
    verifyingContract: await forwarder.getAddress(),
  };
  const types = {
    ForwardRequest: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "gas", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint48" },
      { name: "data", type: "bytes" },
    ],
  };
  const request = {
    from: from.address,
    to,
    value: 0n,
    gas,
    nonce,
    deadline,
    data,
  };
  const signature = await from.signTypedData(domain, types, request);
  return forwarder.connect(relayer).execute({ ...request, signature });
}

function pickEvent(factory: any, receipt: any, name: string) {
  return receipt.logs
    .map((l: any) => {
      try {
        return factory.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((l: any) => l?.name === name);
}

async function makeRoute(factory: any, signer: Signer, shares: { account: string; bps: number }[]) {
  const receipt = await (await factory.connect(signer).createRoute(shares)).wait();
  const ev = pickEvent(factory, receipt, "RouteCreated");
  return ethers.getContractAt("WeirRoute", ev.args.route);
}

async function makeVault(factory: any, signer: Signer, unlockAt: number, goal: string) {
  const receipt = await (await factory.connect(signer).createVault(unlockAt, goal)).wait();
  const ev = pickEvent(factory, receipt, "VaultCreated");
  return ethers.getContractAt("WeirVault", ev.args.vault);
}

describe("Weir", () => {
  describe("route rules", () => {
    it("rejects shares that do not sum to 100 percent", async () => {
      const { factory, alice, bob } = await loadFixture(deployFixture);
      const RouteF = await ethers.getContractFactory("WeirRoute");
      await expect(
        factory.createRoute([
          { account: alice.address, bps: 5000 },
          { account: bob.address, bps: 4000 },
        ]),
      ).to.be.revertedWithCustomError(RouteF, "SharesMustSumToTotal");
    });

    it("rejects an empty recipient list", async () => {
      const { factory } = await loadFixture(deployFixture);
      const RouteF = await ethers.getContractFactory("WeirRoute");
      await expect(factory.createRoute([])).to.be.revertedWithCustomError(RouteF, "NoRecipients");
    });

    it("rejects a zero address and a zero share", async () => {
      const { factory, alice } = await loadFixture(deployFixture);
      const RouteF = await ethers.getContractFactory("WeirRoute");
      await expect(
        factory.createRoute([{ account: ethers.ZeroAddress, bps: 10000 }]),
      ).to.be.revertedWithCustomError(RouteF, "ZeroAddressRecipient");
      await expect(
        factory.createRoute([
          { account: alice.address, bps: 0 },
          { account: alice.address, bps: 10000 },
        ]),
      ).to.be.revertedWithCustomError(RouteF, "ZeroShare");
    });

    it("lets only the owner change the rules", async () => {
      const { factory, owner, alice, bob, stranger } = await loadFixture(deployFixture);
      const route = await makeRoute(factory, owner, [{ account: alice.address, bps: 10000 }]);
      await expect(
        route.connect(stranger).setRules([{ account: bob.address, bps: 10000 }]),
      ).to.be.revertedWithCustomError(route, "NotOwner");
      await route.connect(owner).setRules([{ account: bob.address, bps: 10000 }]);
      expect((await route.shares())[0].account).to.equal(bob.address);
    });
  });

  describe("distribution", () => {
    it("splits an incoming payment by the rules", async () => {
      const { factory, usdt, owner, alice, bob, carol } = await loadFixture(deployFixture);
      const route = await makeRoute(factory, owner, [
        { account: alice.address, bps: 5000 },
        { account: bob.address, bps: 3000 },
        { account: carol.address, bps: 2000 },
      ]);

      // A client pays with a plain transfer, knowing nothing about Weir.
      await usdt.mint(await route.getAddress(), USDT("1000"));
      await route.distribute(await usdt.getAddress());

      expect(await usdt.balanceOf(alice.address)).to.equal(USDT("500"));
      expect(await usdt.balanceOf(bob.address)).to.equal(USDT("300"));
      expect(await usdt.balanceOf(carol.address)).to.equal(USDT("200"));
      expect(await usdt.balanceOf(await route.getAddress())).to.equal(0n);
    });

    it("strands no dust when the split does not divide evenly", async () => {
      const { factory, usdt, owner, alice, bob, carol } = await loadFixture(deployFixture);
      const route = await makeRoute(factory, owner, [
        { account: alice.address, bps: 3333 },
        { account: bob.address, bps: 3333 },
        { account: carol.address, bps: 3334 },
      ]);

      const amount = 1000001n; // deliberately awkward
      await usdt.mint(await route.getAddress(), amount);
      await route.distribute(await usdt.getAddress());

      const paid =
        (await usdt.balanceOf(alice.address)) +
        (await usdt.balanceOf(bob.address)) +
        (await usdt.balanceOf(carol.address));

      expect(paid).to.equal(amount);
      expect(await usdt.balanceOf(await route.getAddress())).to.equal(0n);
    });

    it("can be triggered by anyone, so funds never depend on a relayer", async () => {
      const { factory, usdt, owner, alice, stranger } = await loadFixture(deployFixture);
      const route = await makeRoute(factory, owner, [{ account: alice.address, bps: 10000 }]);
      await usdt.mint(await route.getAddress(), USDT("50"));

      await route.connect(stranger).distribute(await usdt.getAddress());
      expect(await usdt.balanceOf(alice.address)).to.equal(USDT("50"));
    });

    it("reverts when there is nothing to distribute", async () => {
      const { factory, usdt, owner, alice } = await loadFixture(deployFixture);
      const route = await makeRoute(factory, owner, [{ account: alice.address, bps: 10000 }]);
      await expect(route.distribute(await usdt.getAddress())).to.be.revertedWithCustomError(
        route,
        "NothingToDistribute",
      );
    });

    it("applies new rules to money that arrives after the change", async () => {
      const { factory, usdt, owner, alice, bob } = await loadFixture(deployFixture);
      const route = await makeRoute(factory, owner, [{ account: alice.address, bps: 10000 }]);

      await usdt.mint(await route.getAddress(), USDT("100"));
      await route.distribute(await usdt.getAddress());

      await route.connect(owner).setRules([{ account: bob.address, bps: 10000 }]);
      await usdt.mint(await route.getAddress(), USDT("100"));
      await route.distribute(await usdt.getAddress());

      expect(await usdt.balanceOf(alice.address)).to.equal(USDT("100"));
      expect(await usdt.balanceOf(bob.address)).to.equal(USDT("100"));
    });
  });

  describe("when one payout fails", () => {
    it("still pays everyone else and sets the failed share aside", async () => {
      const { factory, usdt, owner, alice, bob } = await loadFixture(deployFixture);
      const route = await makeRoute(factory, owner, [
        { account: alice.address, bps: 5000 },
        { account: bob.address, bps: 5000 },
      ]);

      // Tether freezes Bob. Alice must still get paid.
      await usdt.setBlocked(bob.address, true);
      await usdt.mint(await route.getAddress(), USDT("1000"));
      await route.distribute(await usdt.getAddress());

      expect(await usdt.balanceOf(alice.address)).to.equal(USDT("500"));
      expect(await usdt.balanceOf(bob.address)).to.equal(0n);
      expect(await route.pending(await usdt.getAddress(), bob.address)).to.equal(USDT("500"));
    });

    it("lets that recipient claim once they are unblocked", async () => {
      const { factory, usdt, owner, alice, bob } = await loadFixture(deployFixture);
      const route = await makeRoute(factory, owner, [
        { account: alice.address, bps: 5000 },
        { account: bob.address, bps: 5000 },
      ]);
      await usdt.setBlocked(bob.address, true);
      await usdt.mint(await route.getAddress(), USDT("1000"));
      await route.distribute(await usdt.getAddress());

      await usdt.setBlocked(bob.address, false);
      await route.connect(bob).claim(await usdt.getAddress());

      expect(await usdt.balanceOf(bob.address)).to.equal(USDT("500"));
      expect(await route.pending(await usdt.getAddress(), bob.address)).to.equal(0n);
    });

    it("does not let anyone else claim that share", async () => {
      const { factory, usdt, owner, alice, bob, stranger } = await loadFixture(deployFixture);
      const route = await makeRoute(factory, owner, [
        { account: alice.address, bps: 5000 },
        { account: bob.address, bps: 5000 },
      ]);
      await usdt.setBlocked(bob.address, true);
      await usdt.mint(await route.getAddress(), USDT("1000"));
      await route.distribute(await usdt.getAddress());

      await expect(
        route.connect(stranger).claim(await usdt.getAddress()),
      ).to.be.revertedWithCustomError(route, "NothingToClaim");
    });
  });

  describe("tokens that do not return a bool", () => {
    it("handles mainnet style USDT through SafeERC20", async () => {
      const { factory, owner, alice, bob } = await loadFixture(deployFixture);
      const odd = await (await ethers.getContractFactory("MockNoReturnUSDT")).deploy();
      const route = await makeRoute(factory, owner, [
        { account: alice.address, bps: 2500 },
        { account: bob.address, bps: 7500 },
      ]);

      await odd.mint(await route.getAddress(), USDT("400"));
      await route.distribute(await odd.getAddress());

      expect(await odd.balanceOf(alice.address)).to.equal(USDT("100"));
      expect(await odd.balanceOf(bob.address)).to.equal(USDT("300"));
    });
  });

  describe("vault", () => {
    it("refuses to unlock in the past", async () => {
      const { factory } = await loadFixture(deployFixture);
      const VaultF = await ethers.getContractFactory("WeirVault");
      const past = (await time.latest()) - 1;
      await expect(factory.createVault(past, "rent")).to.be.revertedWithCustomError(
        VaultF,
        "UnlockMustBeFuture",
      );
    });

    it("holds funds until the unlock date, then releases them", async () => {
      const { factory, usdt, owner } = await loadFixture(deployFixture);
      const unlockAt = (await time.latest()) + 30 * 24 * 3600;
      const vault = await makeVault(factory, owner, unlockAt, "six months of runway");

      await usdt.mint(await vault.getAddress(), USDT("250"));
      expect(await vault.locked()).to.equal(true);
      await expect(vault.withdraw(await usdt.getAddress())).to.be.revertedWithCustomError(
        vault,
        "StillLocked",
      );

      await time.increaseTo(unlockAt + 1);
      await vault.withdraw(await usdt.getAddress());
      expect(await usdt.balanceOf(owner.address)).to.equal(USDT("250"));
    });

    it("lets the owner extend the lock but never shorten it", async () => {
      const { factory, owner } = await loadFixture(deployFixture);
      const unlockAt = (await time.latest()) + 30 * 24 * 3600;
      const vault = await makeVault(factory, owner, unlockAt, "goal");

      await vault.extendLock(unlockAt + 1000);
      expect(await vault.unlockAt()).to.equal(unlockAt + 1000);
      await expect(vault.extendLock(unlockAt)).to.be.revertedWithCustomError(
        vault,
        "CannotShortenLock",
      );
    });

    it("does not let a stranger withdraw", async () => {
      const { factory, usdt, owner, stranger } = await loadFixture(deployFixture);
      const unlockAt = (await time.latest()) + 100;
      const vault = await makeVault(factory, owner, unlockAt, "goal");

      await usdt.mint(await vault.getAddress(), USDT("10"));
      await time.increaseTo(unlockAt + 1);
      await expect(
        vault.connect(stranger).withdraw(await usdt.getAddress()),
      ).to.be.revertedWithCustomError(vault, "NotOwner");
    });
  });

  describe("pay yourself first, end to end", () => {
    it("routes a slice of a client payment straight into the locked vault", async () => {
      const { factory, usdt, owner, alice } = await loadFixture(deployFixture);
      const unlockAt = (await time.latest()) + 90 * 24 * 3600;
      const vault = await makeVault(factory, owner, unlockAt, "dollar savings");

      // 80 percent to the spending wallet, 20 percent saved before it can be touched.
      const route = await makeRoute(factory, owner, [
        { account: alice.address, bps: 8000 },
        { account: await vault.getAddress(), bps: 2000 },
      ]);

      await usdt.mint(await route.getAddress(), USDT("2000"));
      await route.distribute(await usdt.getAddress());

      expect(await usdt.balanceOf(alice.address)).to.equal(USDT("1600"));
      expect(await vault.balanceOf(await usdt.getAddress())).to.equal(USDT("400"));
      expect(await vault.locked()).to.equal(true);
    });
  });

  describe("factory bookkeeping", () => {
    it("indexes routes by owner and by who gets paid", async () => {
      const { factory, owner, alice, bob } = await loadFixture(deployFixture);
      const route = await makeRoute(factory, owner, [
        { account: alice.address, bps: 6000 },
        { account: bob.address, bps: 4000 },
      ]);
      const addr = await route.getAddress();

      expect(await factory.routesOf(owner.address)).to.deep.equal([addr]);
      expect(await factory.routesPaying(alice.address)).to.deep.equal([addr]);
      expect(await factory.routesPaying(bob.address)).to.deep.equal([addr]);
      expect(await factory.totalRoutes()).to.equal(1n);
    });

    it("pages through every route", async () => {
      const { factory, owner, alice } = await loadFixture(deployFixture);
      for (let i = 0; i < 3; i++) {
        await makeRoute(factory, owner, [{ account: alice.address, bps: 10000 }]);
      }
      expect((await factory.allRoutes(0, 2)).length).to.equal(2);
      expect((await factory.allRoutes(2, 10)).length).to.equal(1);
      expect((await factory.allRoutes(99, 10)).length).to.equal(0);
    });
  });

  describe("one tap setup", () => {
    it("opens the vault and the route that feeds it in a single transaction", async () => {
      const { factory, usdt, owner, alice } = await loadFixture(deployFixture);
      const unlockAt = (await time.latest()) + 90 * 24 * 3600;

      const receipt = await (
        await factory.createSavingsRoute(alice.address, 2000, unlockAt, "dollar savings")
      ).wait();

      const routeEv = pickEvent(factory, receipt, "RouteCreated");
      const vaultEv = pickEvent(factory, receipt, "VaultCreated");
      expect(routeEv, "RouteCreated missing").to.not.equal(undefined);
      expect(vaultEv, "VaultCreated missing").to.not.equal(undefined);

      const route = await ethers.getContractAt("WeirRoute", routeEv.args.route);
      const vault = await ethers.getContractAt("WeirVault", vaultEv.args.vault);

      const shares = await route.shares();
      expect(shares.length).to.equal(2);
      expect(shares[0].account).to.equal(alice.address);
      expect(shares[0].bps).to.equal(8000n);
      expect(shares[1].account).to.equal(await vault.getAddress());
      expect(shares[1].bps).to.equal(2000n);

      await usdt.mint(await route.getAddress(), USDT("500"));
      await route.distribute(await usdt.getAddress());

      expect(await usdt.balanceOf(alice.address)).to.equal(USDT("400"));
      expect(await vault.balanceOf(await usdt.getAddress())).to.equal(USDT("100"));
      expect(await vault.locked()).to.equal(true);
      expect(await vault.owner()).to.equal(owner.address);
      expect(await route.owner()).to.equal(owner.address);
    });

    it("indexes the new route under both the spender and the vault", async () => {
      const { factory, owner, alice } = await loadFixture(deployFixture);
      const unlockAt = (await time.latest()) + 30 * 24 * 3600;
      const receipt = await (
        await factory.createSavingsRoute(alice.address, 1000, unlockAt, "goal")
      ).wait();
      const routeAddr = pickEvent(factory, receipt, "RouteCreated").args.route;
      const vaultAddr = pickEvent(factory, receipt, "VaultCreated").args.vault;

      expect(await factory.routesOf(owner.address)).to.deep.equal([routeAddr]);
      expect(await factory.routesPaying(alice.address)).to.deep.equal([routeAddr]);
      expect(await factory.routesPaying(vaultAddr)).to.deep.equal([routeAddr]);
      expect(await factory.vaultsOf(owner.address)).to.deep.equal([vaultAddr]);
    });

    it("refuses a savings slice of nothing or everything", async () => {
      const { factory, alice } = await loadFixture(deployFixture);
      const unlockAt = (await time.latest()) + 30 * 24 * 3600;
      await expect(
        factory.createSavingsRoute(alice.address, 0, unlockAt, "goal"),
      ).to.be.revertedWithCustomError(factory, "SaveShareOutOfRange");
      await expect(
        factory.createSavingsRoute(alice.address, 10000, unlockAt, "goal"),
      ).to.be.revertedWithCustomError(factory, "SaveShareOutOfRange");
    });
  });

  describe("finding a split that pays you", () => {
    it("indexes someone added to the split after the route was created", async () => {
      const { factory, owner, alice, bob, carol } = await loadFixture(deployFixture);
      const route = await makeRoute(factory, owner, [
        { account: alice.address, bps: 5000 },
        { account: bob.address, bps: 5000 },
      ]);
      const addr = await route.getAddress();

      // Carol is nowhere near this route yet.
      expect(await factory.routesPaying(carol.address)).to.deep.equal([]);

      await route.connect(owner).setRules([
        { account: alice.address, bps: 4000 },
        { account: bob.address, bps: 3000 },
        { account: carol.address, bps: 3000 },
      ]);

      // Without the factory callback she would have no way to discover it.
      expect(await factory.routesPaying(carol.address)).to.deep.equal([addr]);
    });

    it("does not list the same route twice for one recipient", async () => {
      const { factory, owner, alice, bob } = await loadFixture(deployFixture);
      const route = await makeRoute(factory, owner, [
        { account: alice.address, bps: 5000 },
        { account: bob.address, bps: 5000 },
      ]);
      const addr = await route.getAddress();

      await route.connect(owner).setRules([
        { account: alice.address, bps: 6000 },
        { account: bob.address, bps: 4000 },
      ]);
      await route.connect(owner).setRules([
        { account: alice.address, bps: 7000 },
        { account: bob.address, bps: 3000 },
      ]);

      expect(await factory.routesPaying(alice.address)).to.deep.equal([addr]);
      expect(await factory.routesPaying(bob.address)).to.deep.equal([addr]);
    });

    it("refuses index writes from anything the factory did not create", async () => {
      const { factory, alice, stranger } = await loadFixture(deployFixture);
      await expect(
        factory.connect(stranger).indexRecipients([alice.address]),
      ).to.be.revertedWithCustomError(factory, "NotAKnownRoute");
    });
  });

  describe("working with no gas at all", () => {
    it("lets someone with an empty wallet create a route, paid for by a relayer", async () => {
      const { factory, forwarder, alice, bob, relayer } = await loadFixture(deployFixture);

      // Alice is a brand new Nimiq Pay user: stablecoins, no gas token.
      // Give her literally nothing and prove she can still onboard.
      await ethers.provider.send("hardhat_setBalance", [alice.address, "0x0"]);
      expect(await ethers.provider.getBalance(alice.address)).to.equal(0n);

      const data = factory.interface.encodeFunctionData("createRoute", [
        [
          { account: alice.address, bps: 7000 },
          { account: bob.address, bps: 3000 },
        ],
      ]);

      await relay(forwarder, relayer, alice, await factory.getAddress(), data);

      // The route must belong to Alice, not to whoever paid the gas.
      const routes = await factory.routesOf(alice.address);
      expect(routes.length).to.equal(1);
      const route = await ethers.getContractAt("WeirRoute", routes[0]);
      expect(await route.owner()).to.equal(alice.address);
      expect(await factory.routesOf(relayer.address)).to.deep.equal([]);
      expect(await ethers.provider.getBalance(alice.address)).to.equal(0n);
    });

    it("lets her change her own split with no gas", async () => {
      const { factory, forwarder, alice, bob, carol, relayer } = await loadFixture(deployFixture);
      const route = await makeRoute(factory, alice, [{ account: alice.address, bps: 10000 }]);

      await ethers.provider.send("hardhat_setBalance", [alice.address, "0x0"]);

      const data = route.interface.encodeFunctionData("setRules", [
        [
          { account: bob.address, bps: 5000 },
          { account: carol.address, bps: 5000 },
        ],
      ]);
      await relay(forwarder, relayer, alice, await route.getAddress(), data);

      const shares = await route.shares();
      expect(shares[0].account).to.equal(bob.address);
      expect(shares[1].account).to.equal(carol.address);
    });

    it("lets her withdraw her savings with no gas", async () => {
      const { factory, usdt, forwarder, alice, relayer } = await loadFixture(deployFixture);
      const unlockAt = (await time.latest()) + 100;
      const vault = await makeVault(factory, alice, unlockAt, "goal");
      await usdt.mint(await vault.getAddress(), USDT("75"));

      await time.increaseTo(unlockAt + 1);
      await ethers.provider.send("hardhat_setBalance", [alice.address, "0x0"]);

      const data = vault.interface.encodeFunctionData("withdraw", [await usdt.getAddress()]);
      await relay(forwarder, relayer, alice, await vault.getAddress(), data);

      expect(await usdt.balanceOf(alice.address)).to.equal(USDT("75"));
    });

    it("does not let a relayed call impersonate someone else", async () => {
      const { factory, forwarder, alice, bob, relayer } = await loadFixture(deployFixture);
      const route = await makeRoute(factory, alice, [{ account: alice.address, bps: 10000 }]);

      // Bob signs a request to change Alice's rules. He is not the owner, so
      // the forwarded sender must be Bob and the call must be rejected.
      const data = route.interface.encodeFunctionData("setRules", [
        [{ account: bob.address, bps: 10000 }],
      ]);

      // The forwarder wraps the inner revert, so assert the property that
      // actually matters: Bob cannot change Alice's rules, and the split is
      // untouched afterwards.
      await expect(relay(forwarder, relayer, bob, await route.getAddress(), data)).to.be.reverted;

      const shares = await route.shares();
      expect(shares.length).to.equal(1);
      expect(shares[0].account).to.equal(alice.address);
    });
  });

  describe("what the factory will vouch for", () => {
    it("recognises the routes and vaults it created, and nothing else", async () => {
      const { factory, owner, alice, stranger } = await loadFixture(deployFixture);
      const route = await makeRoute(factory, owner, [{ account: alice.address, bps: 10000 }]);
      const vault = await makeVault(factory, owner, (await time.latest()) + 1000, "goal");

      // A relayer pays gas for these, so it has to be able to tell ours apart
      // from any address a stranger asks it to call.
      expect(await factory.isRoute(await route.getAddress())).to.equal(true);
      expect(await factory.isVault(await vault.getAddress())).to.equal(true);

      expect(await factory.isRoute(stranger.address)).to.equal(false);
      expect(await factory.isVault(stranger.address)).to.equal(false);
      expect(await factory.isRoute(await vault.getAddress())).to.equal(false);
      expect(await factory.isVault(await route.getAddress())).to.equal(false);
    });
  });

  describe("clone safety", () => {
    it("cannot initialize the implementation itself", async () => {
      const { factory, alice } = await loadFixture(deployFixture);
      const impl = await ethers.getContractAt("WeirRoute", await factory.routeImplementation());
      await expect(
        impl.initialize(alice.address, [{ account: alice.address, bps: 10000 }]),
      ).to.be.revertedWithCustomError(impl, "InvalidInitialization");
    });

    it("cannot re-initialize a live route", async () => {
      const { factory, owner, alice, stranger } = await loadFixture(deployFixture);
      const route = await makeRoute(factory, owner, [{ account: alice.address, bps: 10000 }]);
      await expect(
        route
          .connect(stranger)
          .initialize(stranger.address, [{ account: stranger.address, bps: 10000 }]),
      ).to.be.revertedWithCustomError(route, "InvalidInitialization");
    });

    it("refuses a selfTransfer call from outside the contract", async () => {
      const { factory, usdt, owner, alice, stranger } = await loadFixture(deployFixture);
      const route = await makeRoute(factory, owner, [{ account: alice.address, bps: 10000 }]);
      await usdt.mint(await route.getAddress(), USDT("10"));
      await expect(
        route.connect(stranger).selfTransfer(await usdt.getAddress(), stranger.address, USDT("10")),
      ).to.be.revertedWithCustomError(route, "NotSelf");
    });
  });
});
