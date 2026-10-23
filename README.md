# The Bookmaker

The betting shop of the Pixel Universe. It prices every Glacial race, takes bets from 48 resident regulars of Pixel City whose money moves the prices, and lets visitors bet alongside them in play money.

Follows the [Pixel Universe Shared Conventions](../Pixel_Universe_Shared_Conventions.md).

## Place in the universe

A **reader**. It reads Glacial (`js/pixels.js`, `js/sim.js`, `js/league.js`), the Weather Bureau, the Senate and Pixel City, and nothing reads it. The Bookmaker's history depends on all of them, so all are hard dependencies: if any fails to load, the shop shuts rather than computing a different history. Visitor balances and slips survive, because they live in the browser.

- Opens: **1 October 2026** (`OPENS` in `universe.js`). Before then it returns empty state and no events.
- Seeds: `bookmaker:regulars`, `bookmaker:bet:<raceId>:<residentId>`.
- Source name in events: `bookmaker`.

## How a market works

- A race's market opens when the previous race starts and closes 30 minutes before its own start.
- Opening prices come from Glacial's ratings, using Glacial's own Elo expectation for Crawls, plus each runner's last five results. The house keeps an 8% margin.
- Each regular decides at the open, from the wallet they hold then, whether to bet, on whom and for how much. Each of them has a style (loyal, chalk, value, longshot, hunch) and possibly a superstition, some of which read the Weather Bureau. Their bets arrive through the day, and each one shifts the price: 55% opening estimate, 45% where the money is.
- **Grand Prix fields are provisional.** Glacial picks the top eight by rating when the previous Crawl finishes, so the market prices the top eight at the open. Bets on any pixel that misses the cut are returned as non-runners, with an event.
- In running, prices are shown for interest only and are computed from positions and naps.
- Regulars receive the same 500 W stipend and 1 January reset as visitors. A regular who can't cover the minimum stake sits out until the next stipend.

## API (`window.PixelUniverse.bookmaker`)

| Member | Returns |
| --- | --- |
| `stateAt(t)` | `{ open, live, regulars, recent }`: the market you can bet on, the race running, every regular's balance and record, the last 12 settled markets |
| `eventsBetween(from, to)` | Shared-format events: `shop.open`, `market.open`, `bet.large`, `market.void`, `market.settled`, `payout.large`, `record.payout`, `record.longshot`, `resident.ruined` |
| `settle(slip, t)` | `{ status: 'pending' \| 'won' \| 'lost' \| 'void', payout }` for a visitor slip |
| `regulars()` | The 48 regulars and their habits |
| `version`, `startDate`, `ready()` | As per the conventions |

## The shared wallet (`js/wallet.js`)

Stored in localStorage under `pixeluniverse.wallet.v1` and shared across the whole `dvexperiments.github.io` origin. Copy the file unchanged into any site that needs it:

- **Glacial** can call `PixelWallet.read()` and show slips whose `raceId` matches the race on screen.
- **Pixel City** can pay for stray sparks with `PixelWallet.catchSpark(wallet, 'city:spark:<hour>', amount, now)`, which pays each spark once.

## Glacial's "Place a bet" button

The only change Glacial needs. Link to the next race by id; the hash is optional.

```html
<a class="bet-link" href="https://dvexperiments.github.io/Bookmaker/#C-2026-10-25">Place a bet</a>
```

## Repo layout

```
index.html      the shop
universe.js     simulation only, no DOM
js/wallet.js    the visitor's wallet (shared across sites)
js/app.js       rendering
css/style.css   Glacial's variables, so Senate laws restyle the shop
```

## Notes for later

- Replaying gets slower each year, about 0.4 s today including Glacial's own replay. If it drags, ship a checkpoint JSON of regulars' balances and records, as the conventions allow.
- A Bookmaker building in Pixel City is still to be placed on the map.
