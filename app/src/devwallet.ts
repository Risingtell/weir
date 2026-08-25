/**
 * A stand-in for the wallet Nimiq Pay injects, so the whole flow can be driven
 * in a desktop browser against a local Hardhat node.
 *
 * This is development scaffolding and nothing else. It is imported behind
 * `import.meta.env.DEV`, so it is dropped from the production bundle entirely,
 * and it only activates when the page is opened with `?devwallet=1`.
 *
 * Hardhat's node keeps its accounts unlocked, so `eth_sendTransaction` is
 * simply forwarded. No key ever exists in the browser.
 */

const RPC = "http://127.0.0.1:8545";

export function installDevWallet(): boolean {
  const params = new URLSearchParams(window.location.search);
  if (params.get("devwallet") !== "1") return false;

  // Which of the node's accounts to act as, so team splits can be checked
  // from more than one side.
  const index = Number(params.get("account") ?? "0");
  let accounts: string[] = [];

  const call = async (method: string, rpcParams: unknown[] = []) => {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params: rpcParams }),
    });
    const json = await res.json();
    if (json.error) throw new Error(json.error.message);
    return json.result;
  };

  // Deliberately NOT window.ethereum. A real wallet extension in the developer's
  // browser re-injects that property after page scripts run and silently wins,
  // which looks exactly like the app being broken. chain.ts prefers this handle.
  (window as any).__weirDevProvider = {
    isDevWallet: true,
    async request({ method, params: p = [] }: { method: string; params?: unknown[] }) {
      if (method === "eth_requestAccounts" || method === "eth_accounts") {
        if (!accounts.length) accounts = await call("eth_accounts");
        return [accounts[index]];
      }
      return call(method, p);
    },
    on() {},
    removeListener() {},
  };

  installMockNimiq(params.get("nim") === "1");

  console.info(`[weir] dev wallet installed, acting as account #${index}`);
  return true;
}

/**
 * A stand-in for the Nimiq provider, so the NIM half of the UI can be driven
 * without a phone. Off unless `&nim=1` is passed.
 *
 * It deliberately makes `request` fail, because the real SDK exposes no balance
 * method and the app has to look right when the balance is unknown. Transfers
 * are logged and never sent anywhere.
 */
function installMockNimiq(enabled: boolean) {
  if (!enabled) return;

  const address = "NQ07 0000 0000 0000 0000 0000 0000 0000 0001";
  let block = 3_100_000;

  (window as any).nimiq = {
    listAccounts: async () => [address],
    isConsensusEstablished: async () => true,
    getBlockNumber: async () => block++,
    sign: async () => ({ signature: "0x" + "11".repeat(32) }),
    sendBasicTransaction: async (tx: { recipient: string; value: number }) => {
      console.info(`[weir] mock NIM transfer ${tx.value} Lunas -> ${tx.recipient}`);
      // One recipient always refuses, so the partial-failure path is exercised
      // rather than only ever seeing the happy case.
      if (tx.recipient.includes("9999")) throw new Error("user rejected");
      return "mock-tx-" + Math.random().toString(16).slice(2, 10);
    },
    request: async () => {
      throw new Error("no balance method, as in the real SDK");
    },
  };

  (window as any).nimiqPay = {
    language: "en",
    requestDeviceIdentifier: async () => "0".repeat(64),
  };

  console.info("[weir] mock Nimiq provider installed");
}
