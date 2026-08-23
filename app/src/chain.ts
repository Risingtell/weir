import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  formatUnits,
  parseUnits,
  parseEventLogs,
  type Address,
  type PublicClient,
  type WalletClient,
} from "viem";
import { weirfactoryAbi, weirrouteAbi, weirvaultAbi, erc20Abi } from "./abi";
import { CHAINS, chainById, type ChainConfig } from "./config";

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
    const accounts: string[] = await eth.request({ method: "eth_requestAccounts" });
    if (!accounts?.length) throw new Error("No account returned by the wallet.");
    this.account = accounts[0] as Address;

    const hexChainId: string = await eth.request({ method: "eth_chainId" });
    const chainId = Number.parseInt(hexChainId, 16);
    const chain = chainById(chainId);
    if (!chain || !chain.factory) throw new UnsupportedChainError(chainId);
    this.chain = chain;

    const viemChain = {
      id: chain.id,
      name: chain.name,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
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

  // --- writes ---

  private async send(hash: `0x${string}`): Promise<void> {
    await this.pub.waitForTransactionReceipt({ hash });
  }

  async createVault(unlockAt: number, goal: string): Promise<Address> {
    const hash = await this.wallet.writeContract({
      address: this.chain.factory!,
      abi: weirfactoryAbi,
      functionName: "createVault",
      args: [BigInt(unlockAt), goal],
      account: this.account,
      chain: null,
    });
    const receipt = await this.pub.waitForTransactionReceipt({ hash });
    return this.addressFromLogs(receipt.logs, "VaultCreated");
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
  ): Promise<{ route: Address; vault: Address }> {
    const hash = await this.wallet.writeContract({
      address: this.chain.factory!,
      abi: weirfactoryAbi,
      functionName: "createSavingsRoute",
      args: [spendTo, BigInt(saveBps), BigInt(unlockAt), goal],
      account: this.account,
      chain: null,
    });
    const receipt = await this.pub.waitForTransactionReceipt({ hash });
    return {
      route: this.addressFromLogs(receipt.logs, "RouteCreated"),
      vault: this.addressFromLogs(receipt.logs, "VaultCreated"),
    };
  }

  async createRoute(shares: Share[]): Promise<Address> {
    const hash = await this.wallet.writeContract({
      address: this.chain.factory!,
      abi: weirfactoryAbi,
      functionName: "createRoute",
      args: [shares.map((s) => ({ account: s.account, bps: BigInt(s.bps) }))],
      account: this.account,
      chain: null,
    });
    const receipt = await this.pub.waitForTransactionReceipt({ hash });
    return this.addressFromLogs(receipt.logs, "RouteCreated");
  }

  async setRules(route: Address, shares: Share[]): Promise<void> {
    const hash = await this.wallet.writeContract({
      address: route,
      abi: weirrouteAbi,
      functionName: "setRules",
      args: [shares.map((s) => ({ account: s.account, bps: BigInt(s.bps) }))],
      account: this.account,
      chain: null,
    });
    await this.send(hash);
  }

  async distribute(route: Address): Promise<void> {
    const hash = await this.wallet.writeContract({
      address: route,
      abi: weirrouteAbi,
      functionName: "distribute",
      args: [this.token.address],
      account: this.account,
      chain: null,
    });
    await this.send(hash);
  }

  async claim(route: Address): Promise<void> {
    const hash = await this.wallet.writeContract({
      address: route,
      abi: weirrouteAbi,
      functionName: "claim",
      args: [this.token.address],
      account: this.account,
      chain: null,
    });
    await this.send(hash);
  }

  async withdrawVault(vault: Address): Promise<void> {
    const hash = await this.wallet.writeContract({
      address: vault,
      abi: weirvaultAbi,
      functionName: "withdraw",
      args: [this.token.address],
      account: this.account,
      chain: null,
    });
    await this.send(hash);
  }

  /**
   * Pull a created address out of a receipt by decoding the event properly.
   * `createSavingsRoute` emits VaultCreated before RouteCreated, so matching
   * on "first log from the factory" would hand back the wrong contract.
   */
  private addressFromLogs(logs: readonly any[], eventName: "RouteCreated" | "VaultCreated"): Address {
    const decoded = parseEventLogs({ abi: weirfactoryAbi, logs: logs as any, eventName: eventName as any });
    const first = decoded[0] as any;
    if (!first) throw new Error(`Could not find ${eventName} in the transaction receipt.`);
    return (eventName === "RouteCreated" ? first.args.route : first.args.vault) as Address;
  }
}

export { CHAINS };
