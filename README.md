# Weir

**Rules for the money you get paid.** Give a client one address. The moment they pay it, the money splits between your team and puts a slice into savings you cannot raid on a bad day.

A [Nimiq Pay](https://nimiq.com) Mini App.

---

## The problem

If you get paid in stablecoins by clients abroad, two things happen every time.

The first is that one lump lands in one wallet and then you do three or four manual transfers to the people who worked on it, from memory, and someone gets it wrong.

The second is quieter. You mean to keep some of it in dollars, because that is the whole reason you wanted to be paid in dollars. Then the month's bills arrive, and the entire payment gets converted, and the saving never happens. Not because you lack discipline, but because the money passes through your spending wallet on its way to anywhere else.

Weir fixes the second one by never letting it land there in the first place.

## How it works

You get a payment address of your own. It is an ordinary address: a client can pay it from any wallet or any exchange, and they never need to know Weir exists.

When money arrives, it is split according to rules you set in advance. Some to each teammate. A slice into a vault that stays locked until a date you chose.

```
                          ┌─────────────► 50%  you
client pays ──► your Weir ├─────────────► 30%  teammate
                 address  ├─────────────► 10%  teammate
                          └─────────────► 10%  savings vault (locked)
```

### The honest part about "automatic"

An ERC-20 transfer does not notify the contract that receives it. There is no hook. Nothing can execute the moment money lands, and any project claiming otherwise is doing something else under the hood.

So Weir does this instead. Your address is a contract that holds what arrives, and `distribute` is **permissionless**: anybody can call it. A relayer normally calls it within seconds, so it feels automatic. But your teammates can each trigger it themselves, from inside the app, which means your money never depends on our service being alive.

### When a payout fails

A recipient contract cannot reject an ordinary token transfer, so the realistic failure is the token itself refusing. Real USDT can do this: Tether can freeze an address, and `transfer` then reverts.

If that happens to one recipient, everyone else still gets paid. The frozen share is set aside inside the route and that person can `claim` it later. One blocked address does not hold up the other four people.

## Contracts

| Contract | What it does |
| --- | --- |
| `WeirFactory` | Creates routes and vaults, and indexes them so the app can rebuild your state from chain alone, with no server |
| `WeirRoute` | Your payment address. Holds the split rules and pays them out |
| `WeirVault` | Savings. Locked until a date. The lock can be extended, never shortened |

Each user gets their own `WeirRoute` and `WeirVault` as [minimal proxies](https://eips.ethereum.org/EIPS/eip-1167), so creating one on a phone costs very little gas.

A few decisions worth knowing about:

- **Rounding dust goes to the last recipient.** A three way split of an odd number leaves a remainder. Rather than let it accumulate in the contract forever, the final recipient absorbs it, so the route always empties completely.
- **`SafeERC20` everywhere.** USDT on Ethereum mainnet returns nothing from `transfer` instead of a bool, which breaks naive integrations. There is a test that deploys a mock behaving exactly that way.
- **The savings lock only moves forwards.** You can push the date further out. There is deliberately no way to bring it closer, because a lock you can undo on a bad day is not a lock.
- **Changing your split re-indexes recipients.** Someone added to a split after the route was created can still discover the route that pays them.

## Running it

```bash
npm install
npm run compile
npm test
```

To drive the whole thing locally, in three terminals:

```bash
npx hardhat node                                    # 1. a local chain
npx hardhat run scripts/deploy.ts --network localhost   # 2. contracts + a mock USDT
cd app && npm install && npm run dev                # 3. the mini app
```

Then open `http://localhost:5173/?devwallet=1`.

That query parameter installs a stand-in for the wallet Nimiq Pay injects, so the full flow works in a desktop browser. It is dropped from production builds entirely. Add `&account=1` to act as a different person and see the same split from a teammate's side.

To simulate a client paying you:

```bash
ROUTE=0x… USDT=0x… AMOUNT=1000 npx hardhat run scripts/pay.ts --network localhost
```

That sends a plain token transfer, exactly as a real payer would, then shows what the route did with it.

## Inside Nimiq Pay

The app is opened with a deeplink:

```
https://nimpay.app/miniapps/open/<your-domain>
```

It uses the injected `window.ethereum` provider for everything on the EVM side, and `@nimiq/mini-app-sdk` for Nimiq native features.

## Tests

```
npm test
```

29 tests covering the split maths, rounding dust, permissionless distribution, a frozen recipient, mainnet style USDT that returns no bool, the savings lock, recipient discovery, and clone safety.

## Status

Contracts and the mini app both work end to end, verified against a live chain rather than only in tests: a plain transfer in, a correct split out, nothing stranded, and a teammate who owns nothing able to release their own share.

Not yet done: mainnet deployment and the relayer.

## Licence

MIT.
