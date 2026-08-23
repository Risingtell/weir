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

  console.info(`[weir] dev wallet installed, acting as account #${index}`);
  return true;
}
