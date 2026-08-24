import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-verify";
import "@nomicfoundation/hardhat-chai-matchers";
import "@typechain/hardhat";
import * as fs from "fs";
import "dotenv/config";

// Throwaway deploy key, never committed. See .gitignore.
function loadDeployerKey(): string[] {
  const envKey = process.env.PRIVATE_KEY;
  if (envKey) return [envKey];
  const path = ".throwaway-key.local";
  if (fs.existsSync(path)) return [fs.readFileSync(path, "utf8").trim()];
  return [];
}

const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY ?? "";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.25",
    settings: {
      // Paris keeps the bytecode portable across every EVM chain Nimiq Pay
      // exposes, including the ones slower to adopt Cancun opcodes.
      evmVersion: "paris",
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com",
      accounts: loadDeployerKey(),
      chainId: 11155111,
    },
    base: {
      url: process.env.BASE_RPC_URL ?? "https://mainnet.base.org",
      accounts: loadDeployerKey(),
      chainId: 8453,
    },
    arbitrum: {
      url: process.env.ARBITRUM_RPC_URL ?? "https://arb1.arbitrum.io/rpc",
      accounts: loadDeployerKey(),
      chainId: 42161,
    },
    polygon: {
      url: process.env.POLYGON_RPC_URL ?? "https://polygon-rpc.com",
      accounts: loadDeployerKey(),
      chainId: 137,
    },
  },
  etherscan: { apiKey: ETHERSCAN_API_KEY },
  paths: { sources: "./contracts/", tests: "./test/", cache: "./cache", artifacts: "./artifacts" },
};

export default config;
