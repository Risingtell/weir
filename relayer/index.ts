import {
  createPublicClient,
  createWalletClient,
  http,
  formatUnits,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";

/**
 * The Weir relayer.
 *
 * An ERC-20 transfer does not notify the contract that receives it, so nothing
 * can run the moment a client pays. This service closes that gap: it watches
 * every route the factory has created and calls `distribute` when one is
 * holding money, which is what makes the split feel automatic.
 *
 * It is a convenience and never a dependency. `distribute` is permissionless,
 * so if this process is down any recipient can trigger their own payout from
 * inside the app. The key here pays gas and nothing else: `distribute` can only
 * move funds to the recipients the route owner already configured, so a stolen
 * relayer key cannot redirect a single cent.
 */

interface Config {
  rpcUrl: string;
  factory: Address;
  token: Address;
  privateKey: `0x${string}`;
  pollMs: number;
  minAmount: bigint;
  dryRun: boolean;
}

const factoryAbi = [
  { type: "function", name: "totalRoutes", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "allRoutes",
    stateMutability: "view",
    inputs: [{ name: "offset", type: "uint256" }, { name: "limit", type: "uint256" }],
    outputs: [{ type: "address[]" }],
  },
] as const;

const routeAbi = [
  {
    type: "function",
    name: "distribute",
    stateMutability: "nonpayable",
    inputs: [{ name: "token", type: "address" }],
    outputs: [],
  },
] as const;

const erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "a", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;

function loadConfig(): Config {
  const need = (name: string): string => {
    const v = process.env[name];
    if (!v) throw new Error(`Missing required env var ${name}`);
    return v;
  };

  let privateKey = process.env.RELAYER_KEY;
  if (!privateKey && process.env.RELAYER_KEY_FILE) {
    privateKey = readFileSync(process.env.RELAYER_KEY_FILE, "utf8").trim();
  }
  if (!privateKey) throw new Error("Set RELAYER_KEY or RELAYER_KEY_FILE");
  if (!privateKey.startsWith("0x")) privateKey = `0x${privateKey}`;

  return {
    rpcUrl: need("RPC_URL"),
    factory: need("FACTORY") as Address,
    token: need("TOKEN") as Address,
    privateKey: privateKey as `0x${string}`,
    pollMs: Number(process.env.POLL_MS ?? 12_000),
    // Below this, gas costs more than the payout is worth. Those routes are
    // simply left for the recipient to release themselves when they choose.
    minAmount: BigInt(process.env.MIN_AMOUNT_BASE_UNITS ?? "1000000"),
    dryRun: process.env.DRY_RUN === "1",
  };
}

const log = (msg: string, extra?: unknown) => {
  const line = `[${new Date().toISOString()}] ${msg}`;
  if (extra !== undefined) console.log(line, extra);
  else console.log(line);
};

async function main() {
  const cfg = loadConfig();
  const account = privateKeyToAccount(cfg.privateKey);

  const chain = undefined;
  const pub = createPublicClient({ transport: http(cfg.rpcUrl), chain });
  const wallet = createWalletClient({ account, transport: http(cfg.rpcUrl), chain });

  const chainId = await pub.getChainId();
  const [symbol, decimals] = await Promise.all([
    pub.readContract({ address: cfg.token, abi: erc20Abi, functionName: "symbol" }),
    pub.readContract({ address: cfg.token, abi: erc20Abi, functionName: "decimals" }),
  ]);

  const fmt = (v: bigint) => `${formatUnits(v, decimals)} ${symbol}`;

  log(`Weir relayer starting`);
  log(`  chain     ${chainId}`);
  log(`  factory   ${cfg.factory}`);
  log(`  token     ${cfg.token} (${symbol}, ${decimals} decimals)`);
  log(`  relayer   ${account.address}`);
  log(`  threshold ${fmt(cfg.minAmount)}`);
  if (cfg.dryRun) log(`  DRY RUN, no transactions will be sent`);

  const gas = await pub.getBalance({ address: account.address });
  if (gas === 0n) {
    log(`WARNING: relayer has no gas. It will find work and be unable to do it.`);
  }

  // Routes we have already failed on repeatedly, so one broken route cannot
  // burn the whole budget retrying every cycle.
  const failures = new Map<Address, number>();
  const MAX_FAILURES = 5;

  let tick = 0;
  for (;;) {
    tick++;
    try {
      const routes = await fetchRoutes(pub, cfg.factory);
      const funded = await findFunded(pub, cfg.token, routes, cfg.minAmount);

      if (funded.length) {
        log(`tick ${tick}: ${routes.length} routes, ${funded.length} holding funds`);
      }

      for (const { route, balance } of funded) {
        if ((failures.get(route) ?? 0) >= MAX_FAILURES) continue;

        try {
          if (cfg.dryRun) {
            log(`  would distribute ${fmt(balance)} from ${route}`);
            continue;
          }

          // Simulate first so a route that would revert costs nothing.
          await pub.simulateContract({
            address: route,
            abi: routeAbi,
            functionName: "distribute",
            args: [cfg.token],
            account,
          });

          const hash = await wallet.writeContract({
            address: route,
            abi: routeAbi,
            functionName: "distribute",
            args: [cfg.token],
            chain: null,
          });
          const receipt = await pub.waitForTransactionReceipt({ hash });

          log(`  distributed ${fmt(balance)} from ${route} in ${receipt.transactionHash}`);
          failures.delete(route);
        } catch (e) {
          const n = (failures.get(route) ?? 0) + 1;
          failures.set(route, n);
          log(`  failed on ${route} (${n}/${MAX_FAILURES}): ${describe(e)}`);
          if (n >= MAX_FAILURES) {
            log(`  giving up on ${route}. Recipients can still release it themselves.`);
          }
        }
      }
    } catch (e) {
      log(`tick ${tick} failed: ${describe(e)}`);
    }

    await sleep(cfg.pollMs);
  }
}

async function fetchRoutes(pub: any, factory: Address): Promise<Address[]> {
  const total = (await pub.readContract({
    address: factory,
    abi: factoryAbi,
    functionName: "totalRoutes",
  })) as bigint;

  const routes: Address[] = [];
  const page = 200n;
  for (let offset = 0n; offset < total; offset += page) {
    const chunk = (await pub.readContract({
      address: factory,
      abi: factoryAbi,
      functionName: "allRoutes",
      args: [offset, page],
    })) as Address[];
    routes.push(...chunk);
  }
  return routes;
}

/**
 * Reads balances in bounded chunks rather than through multicall. Multicall3 is
 * not deployed on every chain, and viem needs an explicitly configured chain to
 * use it at all, so a plain chunked read is the option that works everywhere
 * without per-chain configuration.
 */
async function findFunded(
  pub: any,
  token: Address,
  routes: Address[],
  min: bigint,
): Promise<{ route: Address; balance: bigint }[]> {
  if (!routes.length) return [];

  const funded: { route: Address; balance: bigint }[] = [];
  const CHUNK = 25;

  for (let i = 0; i < routes.length; i += CHUNK) {
    const chunk = routes.slice(i, i + CHUNK);
    const results = await Promise.allSettled(
      chunk.map((route) =>
        pub.readContract({
          address: token,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [route],
        }) as Promise<bigint>,
      ),
    );

    results.forEach((r, j) => {
      if (r.status !== "fulfilled") return;
      const balance = r.value as bigint;
      if (balance >= min) funded.push({ route: chunk[j], balance });
    });
  }

  return funded;
}

function describe(e: unknown): string {
  const msg = (e as any)?.shortMessage || (e as any)?.message || String(e);
  return msg.split("\n")[0].slice(0, 200);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

main().catch((e) => {
  log(`fatal: ${describe(e)}`);
  process.exit(1);
});
