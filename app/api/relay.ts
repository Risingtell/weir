import {
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
  getAddress,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";

/**
 * Sponsors gas so a Nimiq Pay user with no POL can still use Weir.
 *
 * Measured on a real device: Nimiq Pay hands a mini app an account holding no
 * gas token and rejects `eth_sendTransaction` with "insufficient funds for gas".
 * It does support `eth_signTypedData_v4`, so the user signs an ERC-2771
 * ForwardRequest for free and this endpoint pays to submit it.
 *
 * What stops this being a free tap into someone else's wallet:
 *
 *  - The forwarder verifies the user's signature and appends their address, so
 *    a relayed call can never act as anybody else. This endpoint cannot forge
 *    a request even if it wanted to.
 *  - `to` must be the Weir factory, or a route or vault the factory created.
 *    Anything else is refused, so the key cannot be aimed at arbitrary
 *    contracts.
 *  - Gas is capped per request and the call is simulated first, so a request
 *    that would revert costs nothing.
 *  - The relayer wallet holds gas and nothing else, and `distribute` can only
 *    ever pay the recipients a route owner already configured.
 */

/**
 * Read lazily rather than at module load, so the handler can be pointed at a
 * local chain in tests and exercised for real instead of only reasoned about.
 */
const forwarderAddress = () => process.env.WEIR_FORWARDER as Address | undefined;
const factoryAddress = () => process.env.WEIR_FACTORY as Address | undefined;
const relayerKey = () => process.env.WEIR_RELAYER_KEY as `0x${string}` | undefined;
const rpcUrl = () => process.env.WEIR_RPC_URL ?? "https://polygon-bor-rpc.publicnode.com";

/** Polygon in production, overridable for local testing. */
function chainFor(): any {
  const id = Number(process.env.WEIR_CHAIN_ID ?? polygon.id);
  if (id === polygon.id) return polygon;
  return {
    id,
    name: `chain-${id}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl()] } },
  };
}

/** Generous enough for creating a route, far below anything alarming. */
const MAX_GAS = 1_500_000n;

const forwarderAbi = [
  {
    type: "function",
    name: "execute",
    stateMutability: "payable",
    inputs: [
      {
        name: "request",
        type: "tuple",
        components: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "gas", type: "uint256" },
          { name: "deadline", type: "uint48" },
          { name: "data", type: "bytes" },
          { name: "signature", type: "bytes" },
        ],
      },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "verify",
    stateMutability: "view",
    inputs: [
      {
        name: "request",
        type: "tuple",
        components: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "gas", type: "uint256" },
          { name: "deadline", type: "uint48" },
          { name: "data", type: "bytes" },
          { name: "signature", type: "bytes" },
        ],
      },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

const factoryAbi = [
  {
    type: "function",
    name: "isRoute",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "isVault",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ type: "bool" }],
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

interface ForwardRequest {
  from: Address;
  to: Address;
  value: string;
  gas: string;
  deadline: string;
  data: `0x${string}`;
  signature: `0x${string}`;
}

function bad(res: any, status: number, message: string) {
  res.status(status).json({ error: message });
}

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return bad(res, 405, "POST only");

  const FORWARDER = forwarderAddress();
  const FACTORY = factoryAddress();
  const KEY = relayerKey();
  if (!FORWARDER || !FACTORY || !KEY) {
    return bad(res, 503, "Relayer is not configured.");
  }

  const chain = chainFor();
  const pub = createPublicClient({ chain, transport: http(rpcUrl()) });
  const account = privateKeyToAccount(KEY);
  const wallet = createWalletClient({ account, chain, transport: http(rpcUrl()) });

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

  try {
    // --- a plain distribute, which needs no signature because the contract
    // --- lets anyone trigger it. A recipient holding no gas cannot self-serve.
    if (body?.action === "distribute") {
      const route = body.route;
      const token = body.token;
      if (!isAddress(route) || !isAddress(token)) return bad(res, 400, "Bad route or token.");
      if (!(await isOurs(pub, FACTORY, getAddress(route)))) return bad(res, 403, "Not a Weir contract.");

      await pub.simulateContract({
        address: getAddress(route),
        abi: routeAbi,
        functionName: "distribute",
        args: [getAddress(token)],
        account,
      });

      const hash = await wallet.writeContract({
        address: getAddress(route),
        abi: routeAbi,
        functionName: "distribute",
        args: [getAddress(token)],
      });
      return res.status(200).json({ hash });
    }

    // --- a signed user action, forwarded ---
    const request = body?.request as ForwardRequest | undefined;
    if (!request) return bad(res, 400, "Missing request.");

    for (const field of ["from", "to", "value", "gas", "deadline", "data", "signature"]) {
      if ((request as any)[field] === undefined) return bad(res, 400, `Missing ${field}.`);
    }
    if (!isAddress(request.from) || !isAddress(request.to)) return bad(res, 400, "Bad address.");
    if (BigInt(request.value) !== 0n) return bad(res, 400, "Weir never relays value.");
    if (BigInt(request.gas) > MAX_GAS) return bad(res, 400, "Gas above the cap.");
    if (BigInt(request.deadline) < BigInt(Math.floor(Date.now() / 1000))) {
      return bad(res, 400, "Request has expired.");
    }

    const to = getAddress(request.to);
    if (to !== getAddress(FACTORY) && !(await isOurs(pub, FACTORY, to))) {
      return bad(res, 403, "Weir only pays for calls to its own contracts.");
    }

    const shaped = {
      from: getAddress(request.from),
      to,
      value: 0n,
      gas: BigInt(request.gas),
      deadline: Number(request.deadline),
      data: request.data,
      signature: request.signature,
    };

    // Let the forwarder judge the signature rather than trusting the caller.
    const valid = await pub.readContract({
      address: FORWARDER,
      abi: forwarderAbi,
      functionName: "verify",
      args: [shaped],
    });
    if (!valid) return bad(res, 400, "Signature, nonce or deadline is not valid.");

    await pub.simulateContract({
      address: FORWARDER,
      abi: forwarderAbi,
      functionName: "execute",
      args: [shaped],
      account,
      value: 0n,
    });

    const hash = await wallet.writeContract({
      address: FORWARDER,
      abi: forwarderAbi,
      functionName: "execute",
      args: [shaped],
      value: 0n,
    });

    return res.status(200).json({ hash });
  } catch (e: any) {
    const message = String(e?.shortMessage ?? e?.message ?? e).split("\n")[0];
    // Never hand back a stack trace; it is noise to the app and detail to an attacker.
    return bad(res, 400, message.slice(0, 200));
  }
}

/** True only for a route or vault this factory created. */
async function isOurs(pub: any, factory: Address, address: Address): Promise<boolean> {
  const [route, vault] = await Promise.all([
    pub.readContract({ address: factory, abi: factoryAbi, functionName: "isRoute", args: [address] }),
    pub.readContract({ address: factory, abi: factoryAbi, functionName: "isVault", args: [address] }),
  ]);
  return Boolean(route || vault);
}
