import { test, describe, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  parseUnits,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

/**
 * Exercises the real relay endpoint against a real chain.
 *
 * This is the path a Nimiq Pay user actually takes. Measured on a device: the
 * wallet holds no gas token and rejects eth_sendTransaction outright, but signs
 * typed data happily. So every case here starts from an account whose balance
 * has been set to zero. If any of it quietly needed the user's own gas, these
 * would fail.
 *
 * The handler is imported and driven with stand-in req/res objects, so the
 * validation and allowlist under test are the same code that runs in
 * production rather than a copy of it.
 *
 * Needs a local chain: `npx hardhat node` in another terminal. Skips otherwise
 * rather than failing, so `npm test` stays useful without one.
 */

const RPC = "http://127.0.0.1:8545";

// Hardhat's well-known development accounts. These exist only on a local chain.
const RELAYER_KEY = "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6";
const OWNER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const ALICE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const BOB_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";

const artifact = (name: string, dir = "contracts") =>
  JSON.parse(readFileSync(`../artifacts/${dir}/${name}.sol/${name}.json`, "utf8"));

const owner = privateKeyToAccount(OWNER_KEY);
const alice = privateKeyToAccount(ALICE_KEY);
const bob = privateKeyToAccount(BOB_KEY);

let available = false;
let chainId = 31337;
let chain: any;
let pub: any;
let factory: Address;
let forwarder: Address;
let usdt: Address;
let handler: any;

async function deploy(name: string, args: any[], dir = "contracts"): Promise<Address> {
  const { abi, bytecode } = artifact(name, dir);
  const wallet = createWalletClient({ account: owner, chain, transport: http(RPC) });
  const hash = await wallet.deployContract({ abi, bytecode, args } as any);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  return receipt.contractAddress as Address;
}

async function setBalance(address: Address, hexWei: string) {
  await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "hardhat_setBalance",
      params: [address, hexWei],
    }),
  });
}

interface Reply {
  status: number;
  body: any;
}

async function callHandler(body: any, method = "POST"): Promise<Reply> {
  const reply: Reply = { status: 0, body: undefined };
  const res = {
    setHeader() {},
    status(code: number) {
      reply.status = code;
      return {
        json(payload: any) {
          reply.body = payload;
        },
        end() {},
      };
    },
  };
  await handler({ method, body }, res);
  return reply;
}

async function signRequest(
  signer: typeof alice,
  to: Address,
  data: `0x${string}`,
  overrides: { gas?: bigint; deadline?: number; value?: bigint } = {},
) {
  const gas = overrides.gas ?? 1_000_000n;
  const value = overrides.value ?? 0n;
  const deadline = overrides.deadline ?? Math.floor(Date.now() / 1000) + 3600;

  const nonce = (await pub.readContract({
    address: forwarder,
    abi: [
      {
        type: "function",
        name: "nonces",
        stateMutability: "view",
        inputs: [{ name: "o", type: "address" }],
        outputs: [{ type: "uint256" }],
      },
    ],
    functionName: "nonces",
    args: [signer.address],
  })) as bigint;

  const signature = await signer.signTypedData({
    domain: { name: "Weir", version: "1", chainId, verifyingContract: forwarder },
    types: {
      ForwardRequest: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "gas", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint48" },
        { name: "data", type: "bytes" },
      ],
    },
    primaryType: "ForwardRequest",
    message: { from: signer.address, to, value, gas, nonce, deadline, data },
  });

  return {
    from: signer.address,
    to,
    value: value.toString(),
    gas: gas.toString(),
    deadline: String(deadline),
    data,
    signature,
  };
}

before(async () => {
  try {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    });
    chainId = Number.parseInt((await res.json()).result, 16);
    available = true;
  } catch {
    console.log("  (no local chain on 8545, skipping relay tests)");
    return;
  }

  chain = {
    id: chainId,
    name: "local",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [RPC] } },
  };
  pub = createPublicClient({ chain, transport: http(RPC) });
  handler = (await import("../api/relay.ts")).default;
});

describe("relay endpoint", () => {
  beforeEach(async () => {
    if (!available) return;

    forwarder = await deploy("WeirForwarder", []);
    factory = await deploy("WeirFactory", [forwarder]);
    usdt = await deploy("MockUSDT", [], "contracts/mocks");

    process.env.WEIR_FORWARDER = forwarder;
    process.env.WEIR_FACTORY = factory;
    process.env.WEIR_RELAYER_KEY = RELAYER_KEY;
    process.env.WEIR_RPC_URL = RPC;
    process.env.WEIR_CHAIN_ID = String(chainId);
  });

  test("lets an account with no gas create a route, paid for by the relayer", async (t) => {
    if (!available) return t.skip();

    await setBalance(alice.address, "0x0");
    assert.equal(await pub.getBalance({ address: alice.address }), 0n);

    const data = encodeFunctionData({
      abi: artifact("WeirFactory").abi,
      functionName: "createRoute",
      args: [
        [
          { account: alice.address, bps: 6000 },
          { account: bob.address, bps: 4000 },
        ],
      ],
    });

    const reply = await callHandler({ request: await signRequest(alice, factory, data) });
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    assert.match(reply.body.hash, /^0x[0-9a-f]{64}$/i);

    const routes = (await pub.readContract({
      address: factory,
      abi: artifact("WeirFactory").abi,
      functionName: "routesOf",
      args: [alice.address],
    })) as Address[];
    assert.equal(routes.length, 1);

    const routeOwner = await pub.readContract({
      address: routes[0],
      abi: artifact("WeirRoute").abi,
      functionName: "owner",
    });
    assert.equal(routeOwner, alice.address);
    // The whole point: she paid nothing and still holds nothing.
    assert.equal(await pub.getBalance({ address: alice.address }), 0n);
  });

  test("refuses to pay for a call to a contract it does not know", async (t) => {
    if (!available) return t.skip();

    // MockUSDT is a real contract, just not one of ours. Without the allowlist
    // the relayer key would be a free transaction service for anyone.
    const data = encodeFunctionData({
      abi: artifact("MockUSDT", "contracts/mocks").abi,
      functionName: "mint",
      args: [alice.address, 1_000_000n],
    });

    const reply = await callHandler({ request: await signRequest(alice, usdt, data) });
    assert.equal(reply.status, 403);
    assert.match(reply.body.error, /own contracts/i);
  });

  test("refuses a forged signature", async (t) => {
    if (!available) return t.skip();

    const data = encodeFunctionData({
      abi: artifact("WeirFactory").abi,
      functionName: "createRoute",
      args: [[{ account: bob.address, bps: 10000 }]],
    });

    // Bob signs, then the request claims to come from Alice.
    const request = await signRequest(bob, factory, data);
    request.from = alice.address;

    const reply = await callHandler({ request });
    assert.equal(reply.status, 400);
    assert.match(reply.body.error, /signature|nonce|deadline/i);
  });

  test("refuses a request asking for more gas than the cap", async (t) => {
    if (!available) return t.skip();

    const data = encodeFunctionData({
      abi: artifact("WeirFactory").abi,
      functionName: "createRoute",
      args: [[{ account: alice.address, bps: 10000 }]],
    });
    const reply = await callHandler({
      request: await signRequest(alice, factory, data, { gas: 30_000_000n }),
    });
    assert.equal(reply.status, 400);
    assert.match(reply.body.error, /gas above the cap/i);
  });

  test("refuses a request that carries value", async (t) => {
    if (!available) return t.skip();

    const data = encodeFunctionData({
      abi: artifact("WeirFactory").abi,
      functionName: "createRoute",
      args: [[{ account: alice.address, bps: 10000 }]],
    });
    const reply = await callHandler({
      request: await signRequest(alice, factory, data, { value: 1n }),
    });
    assert.equal(reply.status, 400);
    assert.match(reply.body.error, /never relays value/i);
  });

  test("refuses an expired request", async (t) => {
    if (!available) return t.skip();

    const data = encodeFunctionData({
      abi: artifact("WeirFactory").abi,
      functionName: "createRoute",
      args: [[{ account: alice.address, bps: 10000 }]],
    });
    const reply = await callHandler({
      request: await signRequest(alice, factory, data, {
        deadline: Math.floor(Date.now() / 1000) - 10,
      }),
    });
    assert.equal(reply.status, 400);
    assert.match(reply.body.error, /expired/i);
  });

  test("releases a payment for a recipient who holds no gas", async (t) => {
    if (!available) return t.skip();

    const factoryAbi = artifact("WeirFactory").abi;
    const wallet = createWalletClient({ account: owner, chain, transport: http(RPC) });

    const createHash = await wallet.writeContract({
      address: factory,
      abi: factoryAbi,
      functionName: "createRoute",
      args: [
        [
          { account: alice.address, bps: 5000 },
          { account: bob.address, bps: 5000 },
        ],
      ],
    });
    await pub.waitForTransactionReceipt({ hash: createHash });

    const routes = (await pub.readContract({
      address: factory,
      abi: factoryAbi,
      functionName: "routesOf",
      args: [owner.address],
    })) as Address[];
    const route = routes[routes.length - 1];

    const usdtAbi = artifact("MockUSDT", "contracts/mocks").abi;
    const mintHash = await wallet.writeContract({
      address: usdt,
      abi: usdtAbi,
      functionName: "mint",
      args: [route, parseUnits("1000", 6)],
    });
    await pub.waitForTransactionReceipt({ hash: mintHash });

    await setBalance(alice.address, "0x0");

    const reply = await callHandler({ action: "distribute", route, token: usdt });
    assert.equal(reply.status, 200, JSON.stringify(reply.body));

    const balanceOf = (who: Address) =>
      pub.readContract({ address: usdt, abi: usdtAbi, functionName: "balanceOf", args: [who] });

    assert.equal(await balanceOf(alice.address), parseUnits("500", 6));
    assert.equal(await balanceOf(bob.address), parseUnits("500", 6));
    assert.equal(await balanceOf(route), 0n);
  });

  test("refuses to distribute from an address it did not create", async (t) => {
    if (!available) return t.skip();
    const reply = await callHandler({ action: "distribute", route: usdt, token: usdt });
    assert.equal(reply.status, 403);
  });

  test("answers a GET with a refusal rather than doing anything", async (t) => {
    if (!available) return t.skip();
    const reply = await callHandler({}, "GET");
    assert.equal(reply.status, 405);
  });
});
