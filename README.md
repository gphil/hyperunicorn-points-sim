# HyperUnicorn Points Simulator

## Executive Summary

This is a browser-based simulator for exploring HyperUnicorn points campaign mechanics. 

HyperUnicorn is a [fictional DeFi protocol](https://docs.google.com/document/d/1jy9zEgn2gbAQrQvjd1EfbmxHx_4bjJKWZMf7fDGz4R4/edit?tab=t.0#heading=h.7vn9ziiednic).

The goal is to make the points campaign design easier to reason about before it is shipped. The simulator creates synthetic users, gives them bankrolls and behavior patterns, runs them through a points campaign, and shows how points concentrate across traders and vault depositors under tunable assumptions.

A secondary goal is to prototype a leaderboard UX for points campaign participants to understand how they earned their points and where they fall in the points campaign rankings

The current model focuses on these design principles:

- rewarding real direct trading activity with demonstrable risk-taking
- rewarding vault deposits with a duration/consistency component instead of only snapshot TVL
- making it easy to change parameters and re-run the campaign quickly
- making it easy to see and evaluation campaign output as parameters are refined
- making it clear to users which behavior was rewarded and where they stand relative to the rest of the participants

## Install & Run Simulator

This project uses [Bun](https://bun.sh).

```sh
bun install
bun run dev
```

The dev server defaults to `http://localhost:3000`.

If that port is already in use:

```sh
PORT=5177 bun run dev
```

Useful checks:

```sh
bun run check
bun run build
```

Production mode serves the built `dist` output:

```sh
bun run build
bun run start
```

## Points Formula & Rationale

The simulator separates points into direct trading points and vault points:

```text
total_points = trading_points + vault_points
```

Trading points are calculated weekly:

```text
trading_points =
  sum_week(
    (sum_trade(notional_usd * risk_multiplier) * (1 - wash_ratio * wash_discount))
    * (1 + weekly_streak_rate) ^ weekly_streak
  )
```

Vault points are calculated daily:

```text
vault_points =
  sum_day(vault_deposit_usd * (1 + daily_vault_streak_rate) ^ deposit_streak_day)
```

The rationale is:

- raw volume matters, because we want to establish volume as a driver of future protocol revenues
- risk-adjusted volume matters more, because low-risk churn indicates someone trying to farm rather than use the protocol to take risk
- weekly streaks reward repeated participation without requiring every trader to be active every day. we want to reward habitual users that are more likely to stick around.
- vault streaks reward sustained liquidity instead of gameable one-time deposit snapshots or inconsistent liquidity
- wash-like volume is discounted heavily by comparing same-market long and short volume within a user-week to further tip the scales toward rewarding real engagement

The risk multiplier starts after `pnlRiskBasePct`, reaches the maximum at `pnlRiskFullBonusPct`, and is capped by `maxRiskMultiplier`.

```text
risk_multiplier =
  1 + (maxRiskMultiplier - 1) * scaled_abs_pnl ^ 1.35
```

Where `scaled_abs_pnl` is clamped between `0` and `1`.

This is intentionally not a perfect fraud detector. It is a simple pressure against the easiest version of wash volume while keeping the formula inspectable.

## App Architectural Choices

The app is intentionally small and self-contained:

- React and TypeScript for the UI
- Bun for the dev server, build script, and local production server
- Embedded DuckDB Wasm for in-browser analytical tables and leaderboard queries for rapid prototyping and removing backend APIs from scope to focus on the UI and simulator dynamics which are more important for this exercises
- Vega-Lite for charts. I just really like Vega as a charting library
- a deterministic TypeScript simulation function as the source of generated campaign data, determinism matters for shareable results to discuss fine tuning of a points system

The simulation runs in the browser, writes generated rows into DuckDB Wasm, and then queries those rows for the leaderboard and campaign stats views.

I made this architectural decision so the simulation code can stay focused on mechanics, while the app can use SQL for rollups like cumulative volume, active users, protocol TVL, and total points over time.

The UI has three main screens (exlcuding the simulation progress screen):

- `Leaderboard`: selected user totals, points distribution, and sortable leaderboard rows
- `Campaign Stats`: campaign-level metrics and time-series charts
- `Campaign Parameters`: inputs for market assumptions, protocol mechanics, points settings, and user behavior

Errors are shown in the UI, and simulation runs log short timing entries to the console. I did not focus on logging or error handling in the interest of time management.

## Simulation Methodology Notes

This is a scenario simulator, not a historical backtest on empirical data. It's meant to understand the dynamics of the point system's sensitivy to assumptions. I did not go for economic realism, but I wanted to create something complex enough to incrementally refine the point system.

Users are sampled into four behavior types:

- `Pure Noise`: random markets, sides, trade sizes, and holding periods
- `Buy and Hold`: larger long/short exposures that mostly stay open
- `Momentum`: trades in the direction of recent market movement
- `Arbitrageur`: trades triangle dislocations across `ETH/USDC`, `ETH/BTC`, and `BTC/USD`

Bankrolls are sampled from a truncated power law so that the user base includes many smaller wallets and a smaller number of large wallets.

ETH and BTC prices are simulated with geometric Brownian motion. `ETH/BTC` is derived from those paths. LP mark prices move away from fundamentals based on open demand and available depth, with vault TVL adding depth. I tried to use the HyperUnicorn protocol as described, but filled in some blanks to make it work for purposes of getting this done in a reasonable amount of time. I didn't try to design an optimal HyperUnicorn protocol or high fidelity HyperUnicorn protocol simulation. I tried to focus maximally on the points campaign simulation testing and prototyping. 

Trades can generate:

- direct P&L from mark movement
- fees
- synthetic imbalance carry paid by crowded exposure
- arbitrage P&L when triangle dislocations clear the threshold

Vault depositors earn points from deposit size and deposit duration. The vault also receives simulated protocol-side P&L from fees, imbalance carry, and vault arbitrage participation.

## Future Directions / Next Steps

Where I would want to focus next if I had more time to work on this:

- figure out how to prevent the top whales from hogging the points so much (i'm not entirely happy with this aspect of the system currently.) i'm contemplating some kind of additional parameter that creates a decreasing point rewards to marginal volume over a certain threshold. for now i hacked this by capping the max user bankroll at $500k which is not realistic.
- save previous campaign runs for better comparison of parameter sets
- improve economic reality by pulling in empirical market history and trader behavior and using that instead of or in addition to the agent-based simulation approach
- improve economic reality with a finer grained simulation of a stricter HyperUnicorn protocol design
- add more charts and tables to better show which types of users and behaviors are most and least rewarded in the simulation

I think these are the most important directions I left out intentionally.
