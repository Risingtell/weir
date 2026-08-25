/**
 * Chains Nimiq Pay exposes to mini apps, and where USDT lives on each.
 *
 * The Nimiq docs list Ethereum, Arbitrum One, Optimism, Base, BNB and Sepolia
 * as supported networks, then separately claim USDT works "on Polygon", which
 * is not in that list. Until that is checked against the real Nimiq Pay app,
 * both are configured and the app confirms the token on-chain at runtime
 * rather than trusting this table.
 *
 * Every token address below is UNVERIFIED until confirmed against the block
 * explorer for that chain. `verifyToken` in chain.ts reads symbol and decimals
 * back from the contract before the app will show a balance, so a wrong entry
 * surfaces as a visible error instead of a silently wrong number.
 */

export type ChainKey = "localhost" | "sepolia" | "base" | "arbitrum" | "polygon" | "optimism" | "bnb" | "ethereum";

export interface ChainConfig {
  key: ChainKey;
  id: number;
  name: string;
  rpcUrl: string;
  explorer: string;
  /** Weir factory, filled in per chain once deployed. */
  factory: `0x${string}` | null;
  /** Trusted ERC-2771 forwarder, so users with no gas token can still act. */
  forwarder: `0x${string}` | null;
  usdt: `0x${string}` | null;
  /** Expected decimals, confirmed on-chain before use. BNB's USDT is 18, not 6. */
  usdtDecimals: number;
  testnet: boolean;
}

export const CHAINS: Record<ChainKey, ChainConfig> = {
  localhost: {
    key: "localhost",
    id: 31337,
    name: "Localhost",
    rpcUrl: "http://127.0.0.1:8545",
    explorer: "http://127.0.0.1:8545",
    factory: "0xb9bEECD1A582768711dE1EE7B0A1d582D9d72a6C",
    forwarder: "0x2a810409872AfC346F9B5b26571Fd6eC42EA4849",
    usdt: "0x8A93d247134d91e0de6f96547cB0204e5BE8e5D8",
    usdtDecimals: 6,
    testnet: true,
  },
  sepolia: {
    key: "sepolia",
    id: 11155111,
    name: "Sepolia",
    rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    explorer: "https://sepolia.etherscan.io",
    factory: null,
    forwarder: null,
    usdt: null, // a mock USDT is deployed alongside the factory on testnet
    usdtDecimals: 6,
    testnet: true,
  },
  base: {
    key: "base",
    id: 8453,
    name: "Base",
    rpcUrl: "https://mainnet.base.org",
    explorer: "https://basescan.org",
    factory: null,
    forwarder: null,
    usdt: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
    usdtDecimals: 6,
    testnet: false,
  },
  arbitrum: {
    key: "arbitrum",
    id: 42161,
    name: "Arbitrum One",
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    explorer: "https://arbiscan.io",
    factory: null,
    forwarder: null,
    usdt: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
    usdtDecimals: 6,
    testnet: false,
  },
  polygon: {
    key: "polygon",
    id: 137,
    name: "Polygon",
    // polygon-rpc.com returns "API key disabled" for unauthenticated callers,
    // so it is not usable as a default. This one answers without a key.
    rpcUrl: "https://polygon-bor-rpc.publicnode.com",
    explorer: "https://polygonscan.com",
    factory: null,
    forwarder: null,
    usdt: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    usdtDecimals: 6,
    testnet: false,
  },
  optimism: {
    key: "optimism",
    id: 10,
    name: "Optimism",
    rpcUrl: "https://mainnet.optimism.io",
    explorer: "https://optimistic.etherscan.io",
    factory: null,
    forwarder: null,
    usdt: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",
    usdtDecimals: 6,
    testnet: false,
  },
  bnb: {
    key: "bnb",
    id: 56,
    name: "BNB Chain",
    rpcUrl: "https://bsc-dataseed.binance.org",
    explorer: "https://bscscan.com",
    factory: null,
    forwarder: null,
    usdt: "0x55d398326f99059fF775485246999027B3197955",
    usdtDecimals: 18, // deliberately different from every other chain here
    testnet: false,
  },
  ethereum: {
    key: "ethereum",
    id: 1,
    name: "Ethereum",
    rpcUrl: "https://ethereum-rpc.publicnode.com",
    explorer: "https://etherscan.io",
    factory: null,
    forwarder: null,
    usdt: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    usdtDecimals: 6,
    testnet: false,
  },
};

export function chainById(id: number): ChainConfig | undefined {
  return Object.values(CHAINS).find((c) => c.id === id);
}

/** Chains Weir is actually deployed on, in the order we want to offer them. */
export function liveChains(): ChainConfig[] {
  return Object.values(CHAINS).filter((c) => c.factory !== null);
}

export const BPS_TOTAL = 10_000;
