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

### Nobody needs a gas token

Nimiq Pay holds USDT on Polygon. Polygon charges gas in POL, and a Nimiq Pay
user has no reason to hold any. Telling a freelancer in Lagos to go and acquire
POL before they can be paid would lose most of them at the first step.

So every user action in Weir is relayable. You sign a message, which is free,
and the relayer submits it and pays the gas. Creating a route, changing your
split, claiming, and withdrawing your savings all work with a completely empty
wallet, and there is a test that proves it by zeroing an account's balance
first.

This uses OpenZeppelin's audited `ERC2771Forwarder`. The relayer pays but it
cannot forge anything: the forwarder verifies your signature and appends your
address, so a relayed call can never act as someone else. Direct calls still
work normally if you would rather pay your own gas.

### When a payout fails

A recipient contract cannot reject an ordinary token transfer, so the realistic failure is the token itself refusing. Real USDT can do this: Tether can freeze an address, and `transfer` then reverts.

If that happens to one recipient, everyone else still gets paid. The frozen share is set aside inside the route and that person can `claim` it later. One blocked address does not hold up the other four people.

## Contracts

| Contract | What it does |
| --- | --- |
| `WeirFactory` | Creates routes and vaults, and indexes them so the app can rebuild your state from chain alone, with no server |
| `WeirRoute` | Your payment address. Holds the split rules and pays them out |
| `WeirVault` | Savings. Locked until a date. The lock can be extended, never shortened |
| `WeirForwarder` | Trusted ERC-2771 forwarder, so a user with no gas token can still act |

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

## The relayer

`relayer/` polls every route the factory has created and calls `distribute` on
any that are holding funds. That is what makes the split feel automatic.

```bash
cp .env.example .env      # fill in RPC_URL, FACTORY, TOKEN and a key
npm run relayer
```

It is a convenience and never a dependency. Points worth knowing:

- **Its key pays gas and nothing else.** `distribute` can only move funds to the
  recipients the route owner already configured, so a stolen relayer key cannot
  redirect a single cent.
- **Every call is simulated first**, so a route that would revert costs nothing.
- **A route that keeps failing is dropped** after five attempts, so one broken
  route cannot burn the whole gas budget. Its recipients can still release it
  themselves from inside the app.
- **Amounts below a threshold are left alone**, because gas would cost more than
  the payout is worth.
- `DRY_RUN=1` logs what it would do without sending anything.

## Tests

```
npm test
```

33 tests covering the split maths, rounding dust, permissionless distribution,
a frozen recipient, mainnet style USDT that returns no bool, the savings lock,
recipient discovery, clone safety, and a user with a literally empty wallet
creating a route, changing it, and withdrawing savings without ever holding gas.

## Status

Contracts, the mini app and the relayer all work end to end, verified against a
running chain rather than only in tests: a plain transfer in, a correct split
out, nothing stranded, a teammate who owns nothing able to release their own
share, and the relayer picking up an untriggered payment on its own and paying
everybody their exact percentage.

Target chain is **Polygon**, because that is where Nimiq Pay actually holds
USDT. Verified on Polygon mainnet: USDT at `0xc2132D05D31c914a87C6611C10748AEb04B58e8F`,
symbol USDT, 6 decimals.

Not yet done: mainnet deployment, and wiring the app and relayer to the
gasless path (the contracts support it and are tested, the UI still asks the
user to send their own transaction).

## Licence

MIT.
