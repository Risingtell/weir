import {
  parseAbiItem,
  encodeFunctionData,
  createPublicClient,
  createWalletClient,
  custom,
  http,
  formatUnits,
  parseUnits,
  type Address,
  type PublicClient,
  type WalletClient,
} from "viem";
import { weirfactoryAbi, weirrouteAbi, weirvaultAbi, erc20Abi } from "./abi";
import { CHAINS, chainById, liveChains, type ChainConfig } from "./config";

/** Where the gas sponsor lives. Same deployment as the app. */
const RELAY_URL = "/api/relay";

const forwarderAbi = [
  {
    type: "function",
    name: "nonces",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

/**
 * Everything that touches a chain or a wallet. The UI layer never talks to
 * viem directly, so the awkward parts (a provider that is not injected, a
 * chain we are not deployed on, a token that is not what config claims) all
 * surface here as plain typed errors the UI can render.
 */

export class NotInNimiqPayError extends Error {
  constructor() {
    super("No wallet found. Open this inside Nimiq Pay.");
    this.name = "NotInNimiqPayError";
  }
}

/** The relayer could not be reached at all, as opposed to refusing the request. */
export class RelayUnreachableError extends Error {
  constructor() {
    super("Could not reach the Weir relayer.");
    this.name = "RelayUnreachableError";
  }
}

export class UnsupportedChainError extends Error {
  constructor(public chainId: number) {
    super(`Weir is not deployed on chain ${chainId} yet.`);
    this.name = "UnsupportedChainError";
  }
}

export interface Share {
  account: Address;
  bps: number;
}

export interface RouteView {
  address: Address;
  owner: Address;
  shares: Share[];
  /** Undistributed balance sitting in the route, in token base units. */
  waiting: bigint;
}

export interface VaultView {
  address: Address;
  owner: Address;
  unlockAt: number;
  goal: string;
  locked: boolean;
  balance: bigint;
}

export type ActivityKind = "received" | "split" | "deferred" | "claimed" | "withdrawn" | "relocked";

export interface ActivityItem {
  kind: ActivityKind;
  /** The contract the event came from. */
  source: Address;
  /** Who the money went to, where the event names one. */
  counterparty?: Address;
  amount: bigint;
  /** Some entries record a decision rather than a movement, and show no amount. */
  hasAmount: boolean;
  /** For "relocked", the new unlock date in unix seconds. */
  detail?: number;
  blockNumber: bigint;
  txHash: `0x${string}`;
  /** Unix seconds. Resolved separately, since logs do not carry a timestamp. */
  timestamp?: number;
}

export interface TokenInfo {
  address: Address;
  symbol: string;
  decimals: number;
}

function provider(): any {
  const eth = (window as any).__weirDevProvider ?? (window as any).ethereum;
  if (!eth) throw new NotInNimiqPayError();
  return eth;
}

/**
 * Nimiq Pay's bridge intermittently answers a request with
 * `[birpc] timeout on calling "handleRequest"`, even when the underlying
 * capability works fine. This was seen on a real device: eth_requestAccounts
 * timed out while signing on the very same account succeeded moments later.
 *
 * Any provider call the app depends on at startup therefore gets retried,
 * because a single unlucky timeout would otherwise present as a broken app.
 */
async function withRetry<T>(fn: () => Promise<T>, attempts = 3, delayMs = 700): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const message = String((e as any)?.message ?? e);
      // A rejection by the user is final; only transport flakiness is worth retrying.
      if (/user rejected|denied|user cancell?ed/i.test(message)) throw e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw last;
}

export function hasWallet(): boolean {
  return Boolean((window as any).__weirDevProvider ?? (window as any).ethereum);
}

export class Weir {
  public chain!: ChainConfig;
  public account!: Address;
  public token!: TokenInfo;

  private pub!: PublicClient;
  private wallet!: WalletClient;

  /** Connect to whatever chain the wallet is currently on. */
  async connect(): Promise<void> {
    const eth = provider();

    const accounts = await withRetry<string[]>(() =>
      eth.request({ method: "eth_requestAccounts" }),
    );
    if (!accounts?.length) throw new Error("No account returned by the wallet.");
    this.account = accounts[0] as Address;

    const chain = await this.selectChain(eth);
    this.chain = chain;

    const viemChain = {
      id: chain.id,
      name: chain.name,
      nativeCurrency:
        chain.id === 137
          ? { name: "POL", symbol: "POL", decimals: 18 }
          : { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [chain.rpcUrl] } },
    } as const;

    // Reads go straight to a public RPC. Routing them through the wallet
    // bridge makes the app feel sluggish inside the WebView, and speed is
    // something this app is judged on.
    this.pub = createPublicClient({ chain: viemChain, transport: http(chain.rpcUrl) }) as PublicClient;
    this.wallet = createWalletClient({ chain: viemChain, transport: custom(eth) });

    this.token = await this.verifyToken();
  }

  /**
   * Nimiq Pay starts a mini app on Ethereum mainnet, not on the chain it holds
   * USDT on, so the app has to ask to be moved. Confirmed on a real device:
   * the wallet reported 0x1 on load and accepted a switch to Polygon.
   */
  private async selectChain(eth: any): Promise<ChainConfig> {
    const read = async () =>
      Number.parseInt(await withRetry<string>(() => eth.request({ method: "eth_chainId" })), 16);

    let chainId = await read();
    const current = chainById(chainId);
    if (current?.factory) return current;

    const target = liveChains()[0];
    if (!target) throw new UnsupportedChainError(chainId);

    await withRetry(() =>
      eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: `0x${target.id.toString(16)}` }],
      }),
    );

    // Trust the wallet's answer rather than assuming the switch took.
    chainId = await read();
    const after = chainById(chainId);
    if (!after?.factory) throw new UnsupportedChainError(chainId);
    return after;
  }

  /**
   * Confirm the configured USDT really is the token we think it is. A wrong
   * address in config would otherwise show a confidently wrong balance.
   */
  private async verifyToken(): Promise<TokenInfo> {
    const address = this.chain.usdt;
    if (!address) throw new Error(`No USDT configured for ${this.chain.name}.`);

    const [symbol, decimals] = await Promise.all([
      this.pub.readContract({ address, abi: erc20Abi, functionName: "symbol" }) as Promise<string>,
      this.pub.readContract({ address, abi: erc20Abi, functionName: "decimals" }) as Promise<number>,
    ]);

    if (decimals !== this.chain.usdtDecimals) {
      throw new Error(
        `${this.chain.name} USDT reports ${decimals} decimals but config expects ${this.chain.usdtDecimals}.`,
      );
    }
    return { address, symbol, decimals };
  }

  // --- formatting ---

  format(amount: bigint): string {
    const s = formatUnits(amount, this.token.decimals);
    const [whole, frac = ""] = s.split(".");
    const grouped = Number(whole).toLocaleString("en-US");
    return frac ? `${grouped}.${frac.slice(0, 2).padEnd(2, "0")}` : `${grouped}.00`;
  }

  parse(amount: string): bigint {
    return parseUnits(amount, this.token.decimals);
  }

  explorerUrl(addressOrTx: string, kind: "address" | "tx" = "address"): string {
    return `${this.chain.explorer}/${kind}/${addressOrTx}`;
  }

  // --- reads ---

  async myRoutes(): Promise<Address[]> {
    return (await this.pub.readContract({
      address: this.chain.factory!,
      abi: weirfactoryAbi,
      functionName: "routesOf",
      args: [this.account],
    })) as Address[];
  }

  /** Routes that pay me, so a teammate finds their split without being told. */
  async routesPayingMe(): Promise<Address[]> {
    return (await this.pub.readContract({
      address: this.chain.factory!,
      abi: weirfactoryAbi,
      functionName: "routesPaying",
      args: [this.account],
    })) as Address[];
  }

  async myVaults(): Promise<Address[]> {
    return (await this.pub.readContract({
      address: this.chain.factory!,
      abi: weirfactoryAbi,
      functionName: "vaultsOf",
      args: [this.account],
    })) as Address[];
  }

  async readRoute(address: Address): Promise<RouteView> {
    const [owner, rawShares, waiting] = await Promise.all([
      this.pub.readContract({ address, abi: weirrouteAbi, functionName: "owner" }) as Promise<Address>,
      this.pub.readContract({ address, abi: weirrouteAbi, functionName: "shares" }) as Promise<
        readonly { account: Address; bps: bigint }[]
      >,
      this.pub.readContract({
        address: this.token.address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
      }) as Promise<bigint>,
    ]);

    return {
      address,
      owner,
      shares: rawShares.map((s) => ({ account: s.account, bps: Number(s.bps) })),
      waiting,
    };
  }

  async readVault(address: Address): Promise<VaultView> {
    const [owner, unlockAt, goal, locked, balance] = await Promise.all([
      this.pub.readContract({ address, abi: weirvaultAbi, functionName: "owner" }) as Promise<Address>,
      this.pub.readContract({ address, abi: weirvaultAbi, functionName: "unlockAt" }) as Promise<bigint>,
      this.pub.readContract({ address, abi: weirvaultAbi, functionName: "goal" }) as Promise<string>,
      this.pub.readContract({ address, abi: weirvaultAbi, functionName: "locked" }) as Promise<boolean>,
      this.pub.readContract({
        address: this.token.address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
      }) as Promise<bigint>,
    ]);

    return { address, owner, unlockAt: Number(unlockAt), goal, locked, balance };
  }

  async pendingFor(route: Address, account: Address): Promise<bigint> {
    return (await this.pub.readContract({
      address: route,
      abi: weirrouteAbi,
      functionName: "pending",
      args: [this.token.address, account],
    })) as bigint;
  }

  // --- activity ---

  /**
   * Reads what actually happened from chain events.
   *
   * Logs carry no timestamp, and public RPCs cap how many blocks a single
   * `getLogs` may span, so this walks backwards in chunks and shrinks the chunk
   * when a provider rejects the range. It stops once it has enough rows or runs
   * out of lookback, rather than trying to reach genesis.
   */
  async readActivity(
    sources: { routes: Address[]; vaults: Address[] },
    opts: { limit?: number; maxLookback?: bigint } = {},
  ): Promise<ActivityItem[]> {
    const limit = opts.limit ?? 40;
    const maxLookback = opts.maxLookback ?? 2_000_000n;
    const all = [...sources.routes, ...sources.vaults];
    if (!all.length) return [];

    const latest = await this.pub.getBlockNumber();
    const floor = latest > maxLookback ? latest - maxLookback : 0n;

    const events = [
      parseAbiItem("event Paid(address indexed token, address indexed to, uint256 amount)"),
      parseAbiItem("event Distributed(address indexed token, uint256 total)"),
      parseAbiItem("event PaymentDeferred(address indexed token, address indexed to, uint256 amount)"),
      parseAbiItem("event Claimed(address indexed token, address indexed to, uint256 amount)"),
      parseAbiItem("event Withdrawn(address indexed token, address indexed to, uint256 amount)"),
      parseAbiItem("event LockExtended(uint64 previousUnlockAt, uint64 newUnlockAt)"),
    ];

    const items: ActivityItem[] = [];
    let chunk = 50_000n;
    let to = latest;

    while (to > floor && items.length < limit) {
      const from = to - chunk > floor ? to - chunk : floor;
      try {
        const batches = await Promise.all(
          events.map((event) =>
            this.pub.getLogs({ address: all, event, fromBlock: from, toBlock: to }).catch(() => []),
          ),
        );

        for (const logs of batches) {
          for (const log of logs as any[]) {
            const name = log.eventName as string;

            if (name === "LockExtended") {
              items.push({
                kind: "relocked",
                source: log.address as Address,
                amount: 0n,
                hasAmount: false,
                detail: Number(log.args?.newUnlockAt ?? 0n),
                blockNumber: log.blockNumber as bigint,
                txHash: log.transactionHash as `0x${string}`,
              });
              continue;
            }

            // Only this token. A route can hold anything someone sends it.
            if (log.args?.token?.toLowerCase() !== this.token.address.toLowerCase()) continue;

            const kind: ActivityKind =
              name === "Distributed" ? "split"
              : name === "PaymentDeferred" ? "deferred"
              : name === "Claimed" ? "claimed"
              : name === "Withdrawn" ? "withdrawn"
              : "received";

            items.push({
              kind,
              source: log.address as Address,
              counterparty: log.args?.to as Address | undefined,
              amount: (log.args?.amount ?? log.args?.total ?? 0n) as bigint,
              hasAmount: true,
              blockNumber: log.blockNumber as bigint,
              txHash: log.transactionHash as `0x${string}`,
            });
          }
        }
      } catch {
        // Provider refused the range. Halve it and retry the same window.
        if (chunk > 1_000n) {
          chunk = chunk / 2n;
          continue;
        }
        break;
      }

      if (from === floor) break;
      to = from - 1n;
    }

    items.sort((a, b) => Number(b.blockNumber - a.blockNumber));
    const page = items.slice(0, limit);
    await this.attachTimestamps(page);
    return page;
  }

  /** Fills in block times, fetching each distinct block only once. */
  private async attachTimestamps(items: ActivityItem[]): Promise<void> {
    const blocks = [...new Set(items.map((i) => i.blockNumber))];
    const times = new Map<bigint, number>();

    await Promise.all(
      blocks.map(async (blockNumber) => {
        try {
          const block = await this.pub.getBlock({ blockNumber });
          times.set(blockNumber, Number(block.timestamp));
        } catch {
          /* a missing timestamp is not worth failing the whole view over */
        }
      }),
    );

    for (const item of items) item.timestamp = times.get(item.blockNumber);
  }

  // --- writes ---

  private async send(hash: `0x${string}`): Promise<void> {
    await this.pub.waitForTransactionReceipt({ hash });
  }

  /**
   * Runs a write, paying for it on the user's behalf wherever possible.
   *
   * A Nimiq Pay wallet holds no gas token. Confirmed on a real device: the
   * wallet rejects `eth_sendTransaction` with "insufficient funds for gas" but
   * signs typed data happily. So the default path is to sign an ERC-2771
   * request for free and let the relayer submit it.
   *
   * If the relayer is unreachable the call falls back to a direct send, which
   * works for anyone who does hold gas. The user is never stuck behind our
   * service being up, which is the same principle that makes `distribute`
   * permissionless.
   */
  private async execute(
    to: Address,
    abi: readonly unknown[],
    functionName: string,
    args: readonly unknown[],
  ): Promise<void> {
    const data = encodeFunctionData({ abi: abi as any, functionName, args: args as any });

    if (this.chain.forwarder && RELAY_URL) {
      try {
        const hash = await this.relay(to, data);
        await this.send(hash);
        return;
      } catch (e) {
        // A refusal by the relayer is worth surfacing; only fall back when it
        // could not be reached at all, otherwise a real error gets replaced by
        // a confusing "insufficient funds".
        if (!(e instanceof RelayUnreachableError)) throw e;
      }
    }

    const hash = await this.wallet.sendTransaction({
      account: this.account,
      to,
      data,
      chain: null,
    });
    await this.send(hash);
  }

  /** Signs an ERC-2771 request and hands it to the relayer to pay for. */
  private async relay(to: Address, data: `0x${string}`): Promise<`0x${string}`> {
    const forwarder = this.chain.forwarder!;

    const nonce = (await this.pub.readContract({
      address: forwarder,
      abi: forwarderAbi,
      functionName: "nonces",
      args: [this.account],
    })) as bigint;

    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const gas = 1_000_000;

    // The nonce is signed but is deliberately not part of the struct sent to
    // the forwarder, which reads it from storage. Getting that wrong makes
    // every signature look invalid, so it is worth being explicit about.
    const typedData = {
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
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
      domain: {
        name: "Weir",
        version: "1",
        chainId: this.chain.id,
        verifyingContract: forwarder,
      },
      message: {
        from: this.account,
        to,
        value: "0",
        gas: String(gas),
        nonce: nonce.toString(),
        deadline: String(deadline),
        data,
      },
    };

    const eth = provider();
    const signature: `0x${string}` = await eth.request({
      method: "eth_signTypedData_v4",
      params: [this.account, JSON.stringify(typedData)],
    });

    let response: Response;
    try {
      response = await fetch(RELAY_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          request: { from: this.account, to, value: "0", gas: String(gas), deadline: String(deadline), data, signature },
        }),
      });
    } catch {
      throw new RelayUnreachableError();
    }

    if (!response.ok) throw await this.relayFailure(response);

    const payload = await response.json().catch(() => ({}));
    if (!payload?.hash) throw new Error("Relayer returned no transaction.");
    return payload.hash as `0x${string}`;
  }

  /**
   * Decides whether a failed relay response means "there is no relayer here"
   * or "the relayer looked at this and refused it".
   *
   * The difference decides whether the app quietly falls back to a direct send
   * or shows the user an error. A 404 from a dev server with no function, or a
   * gateway error from a cold or broken deployment, must not surface as a
   * failure when the user could simply pay their own gas. A 400 or 403 is a
   * deliberate refusal and the user needs to see the reason.
   */
  private async relayFailure(response: Response): Promise<Error> {
    if (response.status === 404 || response.status >= 500) {
      return new RelayUnreachableError();
    }
    const payload = await response.json().catch(() => ({}) as any);
    return new Error(payload?.error ?? `Relayer refused with ${response.status}.`);
  }

  /** Asks the relayer to trigger a distribute, for a recipient holding no gas. */
  private async relayDistribute(route: Address): Promise<`0x${string}`> {
    const response = await fetch(RELAY_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "distribute", route, token: this.token.address }),
    }).catch(() => {
      throw new RelayUnreachableError();
    });

    if (!response.ok) throw await this.relayFailure(response);
    const payload = await response.json().catch(() => ({}));
    return payload.hash as `0x${string}`;
  }

  async createVault(unlockAt: number, goal: string): Promise<void> {
    await this.execute(this.chain.factory!, weirfactoryAbi, "createVault", [BigInt(unlockAt), goal]);
  }

  /**
   * The one tap path: opens the vault and the route that feeds it in a single
   * transaction, so a new user confirms once instead of twice.
   */
  async createSavingsRoute(
    spendTo: Address,
    saveBps: number,
    unlockAt: number,
    goal: string,
  ): Promise<void> {
    await this.execute(this.chain.factory!, weirfactoryAbi, "createSavingsRoute", [
      spendTo,
      BigInt(saveBps),
      BigInt(unlockAt),
      goal,
    ]);
  }

  async createRoute(shares: Share[]): Promise<void> {
    await this.execute(this.chain.factory!, weirfactoryAbi, "createRoute", [
      shares.map((s) => ({ account: s.account, bps: BigInt(s.bps) })),
    ]);
  }

  async setRules(route: Address, shares: Share[]): Promise<void> {
    await this.execute(route, weirrouteAbi, "setRules", [
      shares.map((s) => ({ account: s.account, bps: BigInt(s.bps) })),
    ]);
  }

  /**
   * Releases a payment. Tries the relayer first, because a recipient with no
   * gas cannot trigger this themselves even though the contract lets anyone.
   */
  async distribute(route: Address): Promise<void> {
    if (RELAY_URL) {
      try {
        await this.send(await this.relayDistribute(route));
        return;
      } catch (e) {
        if (!(e instanceof RelayUnreachableError)) throw e;
      }
    }
    await this.execute(route, weirrouteAbi, "distribute", [this.token.address]);
  }

  async claim(route: Address): Promise<void> {
    await this.execute(route, weirrouteAbi, "claim", [this.token.address]);
  }

  async extendLock(vault: Address, newUnlockAt: number): Promise<void> {
    await this.execute(vault, weirvaultAbi, "extendLock", [BigInt(newUnlockAt)]);
  }

  async withdrawVault(vault: Address): Promise<void> {
    await this.execute(vault, weirvaultAbi, "withdraw", [this.token.address]);
  }

}

export { CHAINS };
