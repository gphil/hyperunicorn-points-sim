import type { SimulationParameters } from "../simulation/types";

type Field = {
  key: keyof SimulationParameters;
  label: string;
  detail: string;
  min?: number;
  max?: number;
  step?: number;
};

type Group = {
  title: string;
  description?: string;
  fields: Field[];
};

type Props = {
  parameters: SimulationParameters;
  isRunning: boolean;
  onChange: (key: keyof SimulationParameters, value: number) => void;
  onSimulate: () => void;
};

const marketCampaignGroups: Group[] = [
  {
    title: "Campaign",
    description: "Controls the size and length of the campaign, plus the bankroll distribution across users. We can specify how many users we expect to show up and how concentrated their funds are.",
    fields: [
      { key: "seed", label: "Seed", detail: "Deterministic random seed for repeatable simulations.", min: 1, step: 1 },
      { key: "userCount", label: "Users", detail: "Total simulated wallets.", min: 25, max: 25000, step: 25 },
      { key: "tradingDays", label: "Trading days", detail: "Length of the points campaign.", min: 7, max: 365, step: 1 },
      { key: "bankrollPowerLawAlpha", label: "Bankroll alpha", detail: "Higher alpha concentrates more users near the minimum bankroll.", min: 1.05, max: 3, step: 0.05 },
      { key: "minBankrollUsd", label: "Min bankroll", detail: "Smallest direct plus vault bankroll in USD.", min: 50, step: 50 },
      { key: "maxBankrollUsd", label: "Max bankroll", detail: "Largest bankroll sampled from the truncated power law.", min: 1000, step: 1000 }
    ]
  },
  {
    title: "Underlying Markets",
    description: "Controls the underlying ETH and BTC price paths used by the simulation. The defaults are intended to be realistic, but also to let us test campaigns across diverse market conditions.",
    fields: [
      { key: "ethInitialUsd", label: "ETH initial", detail: "Starting ETH/USD price.", min: 1, step: 1 },
      { key: "btcInitialUsd", label: "BTC initial", detail: "Starting BTC/USD price.", min: 1, step: 1 },
      { key: "ethDailyVolatilityPct", label: "ETH daily vol", detail: "Geometric Brownian motion daily volatility.", min: 0, max: 20, step: 0.1 },
      { key: "btcDailyVolatilityPct", label: "BTC daily vol", detail: "Geometric Brownian motion daily volatility.", min: 0, max: 20, step: 0.1 },
      { key: "ethDailyDriftPct", label: "ETH daily drift", detail: "Expected daily log-price drift.", min: -1, max: 1, step: 0.005 },
      { key: "btcDailyDriftPct", label: "BTC daily drift", detail: "Expected daily log-price drift.", min: -1, max: 1, step: 0.005 }
    ]
  },
  {
    title: "Protocol Mechanics",
    description: "Controls how LP marks move in response to demand, how crowded exposure pays imbalance carry, and how fees and arbitrage flow through the protocol.",
    fields: [
      { key: "baseMarketDepthUsd", label: "Market depth", detail: "Synthetic LP depth that dampens demand-driven mark moves.", min: 10000, step: 10000 },
      { key: "demandMoveAtDepthPct", label: "Demand impact", detail: "Approximate mark move when net demand equals market depth.", min: 0, max: 50, step: 0.25 },
      { key: "fundingK", label: "LP imbalance carry", detail: "How strongly crowded synthetic LP exposure pays protocol-side liquidity.", min: 0, max: 2, step: 0.01 },
      { key: "tradeFeeBps", label: "Fee bps", detail: "Round-trip trading fees reduce realized P&L.", min: 0, max: 100, step: 1 },
      { key: "arbitrageThresholdPct", label: "Arb threshold", detail: "Triangle mispricing needed before arbitrageurs and the vault act.", min: 0, max: 5, step: 0.05 },
      { key: "arbitrageCaptureRatePct", label: "Arb capture", detail: "Share of available triangle edge captured after costs.", min: 0, max: 100, step: 1 },
      { key: "vaultArbitrageSharePct", label: "Vault arb size", detail: "Vault notional deployed when the arbitrage threshold is crossed.", min: 0, max: 100, step: 1 }
    ]
  },
  {
    title: "Points",
    description: "Controls how activity turns into points. These parameters determine how much we reward long-lived vault TVL, weekly trading consistency, realized risk, and how aggressively we discount wash-like volume.",
    fields: [
      { key: "vaultStreakRewardRatePct", label: "Vault daily streak", detail: "Weak exponential on full-day TVL deposits.", min: 0, max: 2, step: 0.01 },
      { key: "traderWeeklyStreakRewardRatePct", label: "Trader weekly streak", detail: "Weekly activity streak multiplier for direct trading.", min: 0, max: 25, step: 0.25 },
      { key: "pnlRiskBasePct", label: "Risk base P&L", detail: "Below this absolute P&L, trades receive no P&L risk bonus.", min: 0, max: 10, step: 0.1 },
      { key: "pnlRiskFullBonusPct", label: "Full risk P&L", detail: "At or above this absolute P&L, trades reach the max risk multiplier.", min: 1, max: 50, step: 0.25 },
      { key: "maxRiskMultiplier", label: "Max risk multiplier", detail: "Multiplier applied at the full risk P&L threshold.", min: 1, max: 25, step: 0.25 },
      { key: "washTradeDiscountPct", label: "Wash discount", detail: "Discount on same-market opposite-side weekly volume.", min: 0, max: 100, step: 1 }
    ]
  }
];

const userBehaviorGroups: Group[] = [
  {
    title: "Pure Noise Users",
    description: "These vibe-trading users trade entirely randomly: random markets, sides, sizes, and holding periods",
    fields: [
      { key: "pureNoiseAvgTradePct", label: "Noise trade size", detail: "Average trade as percent of bankroll.", min: 0, max: 100, step: 1 },
      { key: "pureNoiseTradesPerWeek", label: "Noise trades/wk", detail: "Expected random entries each week.", min: 0, max: 14, step: 0.25 },
      { key: "pureNoiseAvgHoldingDays", label: "Noise hold days", detail: "Average random holding period.", min: 1, max: 90, step: 1 },
      { key: "pureNoiseVaultDepositorPct", label: "Noise vault users", detail: "Pure noise users who also deposit.", min: 0, max: 100, step: 1 },
      { key: "pureNoiseVaultDepositAvgPct", label: "Noise vault size", detail: "Average deposit as percent of bankroll.", min: 0, max: 100, step: 1 }
    ]
  },
  {
    title: "Buy & Hold Users",
    description: "These users open larger long and short LP-style exposures and mostly hold them. If P&L moves far enough beyond the comfort zone, their fear factor controls how likely they are to take profit or panic sell.",
    fields: [
      { key: "buyHoldAvgTradePct", label: "Hold trade size", detail: "Average buy-and-hold exposure chunk.", min: 0, max: 100, step: 1 },
      { key: "buyHoldPositionsPerUser", label: "Hold positions", detail: "Starting LP-style long/short positions per buy-and-hold user.", min: 1, max: 10, step: 1 },
      { key: "buyHoldFearFactorPct", label: "Fear factor", detail: "Probability sensitivity to taking profit or panic selling beyond +/-10% P&L.", min: 0, max: 100, step: 1 },
      { key: "buyHoldVaultDepositorPct", label: "Hold vault users", detail: "Buy-and-hold users who also deposit.", min: 0, max: 100, step: 1 },
      { key: "buyHoldVaultDepositAvgPct", label: "Hold vault size", detail: "Average deposit as percent of bankroll.", min: 0, max: 100, step: 1 }
    ]
  },
  {
    title: "Momentum Users",
    description: "These users trade in the direction of recent price movement and exit once the move is large enough in either direction. They are meant to model active traders taking shorter-duration directional risk.",
    fields: [
      { key: "momentumAvgTradePct", label: "Momentum size", detail: "Average momentum trade as percent of bankroll.", min: 0, max: 100, step: 1 },
      { key: "momentumTradesPerWeek", label: "Momentum trades/wk", detail: "Expected momentum entries each week.", min: 0, max: 14, step: 0.25 },
      { key: "momentumSignalLookbackDays", label: "Momentum lookback", detail: "Days used to determine recent price movement.", min: 1, max: 30, step: 1 },
      { key: "momentumExitMoveAvgPct", label: "Momentum exit", detail: "Average absolute P&L move where momentum exits.", min: 1, max: 10, step: 0.1 },
      { key: "momentumVaultDepositorPct", label: "Momentum vault users", detail: "Momentum users who also deposit.", min: 0, max: 100, step: 1 },
      { key: "momentumVaultDepositAvgPct", label: "Momentum vault size", detail: "Average deposit as percent of bankroll.", min: 0, max: 100, step: 1 }
    ]
  },
  {
    title: "Arbitrageur Users",
    description: "These users look for triangle dislocations across the three markets and trade when the edge clears costs. They help keep the simulated markets better aligned while still requiring enough edge to participate.",
    fields: [
      { key: "arbitrageurAvgTradePct", label: "Arb size", detail: "Average arbitrage notional as percent of bankroll.", min: 0, max: 100, step: 1 },
      { key: "arbitrageurVaultDepositorPct", label: "Arb vault users", detail: "Arbitrageurs who also deposit.", min: 0, max: 100, step: 1 },
      { key: "arbitrageurVaultDepositAvgPct", label: "Arb vault size", detail: "Average deposit as percent of bankroll.", min: 0, max: 100, step: 1 }
    ]
  },
  {
    title: "User Mix",
    description: "Controls the share of each user type in the simulated campaign. This is useful for testing whether the points design still behaves well as the user base shifts between passive depositors, directional traders, noise, and arbitrage.",
    fields: [
      { key: "pureNoiseSharePct", label: "Pure noise share", detail: "Users who trade random side, market, size, and holding period.", min: 0, max: 100, step: 1 },
      { key: "buyHoldSharePct", label: "Buy & hold share", detail: "Users who open larger directional LP exposures and mostly hold.", min: 0, max: 100, step: 1 },
      { key: "momentumSharePct", label: "Momentum share", detail: "Users who follow recent price movement.", min: 0, max: 100, step: 1 },
      { key: "arbitrageurSharePct", label: "Arbitrageur share", detail: "Users who trade triangle dislocations across the three markets.", min: 0, max: 100, step: 1 }
    ]
  }
];

const NumberField = ({ field, value, onChange }: { field: Field; value: number; onChange: (value: number) => void }) => (
  <label className="field">
    <span className="field-label">
      <strong>{field.label}</strong>
      <span className="info-tooltip" tabIndex={0} aria-label={field.detail}>
        i
        <span className="tooltip-content" role="tooltip">
          {field.detail}
        </span>
      </span>
    </span>
    <input
      type="number"
      value={Number.isInteger(value) ? value : Number(value.toFixed(5))}
      min={field.min}
      max={field.max}
      step={field.step ?? 1}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  </label>
);

const ParameterSection = ({
  title,
  groups,
  parameters,
  onChange
}: {
  title: string;
  groups: Group[];
  parameters: SimulationParameters;
  onChange: (key: keyof SimulationParameters, value: number) => void;
}) => (
  <div className="parameter-section">
    <h2 className="parameter-section-title">{title}</h2>
    <div className="parameter-grid">
      {groups.map((group) => (
        <article className="config-panel" key={group.title}>
          <h3>{group.title}</h3>
          {group.description ? <p className="config-panel-description">{group.description}</p> : undefined}
          <div className="field-grid">
            {group.fields.map((field) => (
              <NumberField
                field={field}
                key={field.key}
                value={parameters[field.key]}
                onChange={(value) => onChange(field.key, value)}
              />
            ))}
          </div>
        </article>
      ))}
    </div>
  </div>
);

export const ParameterPanel = ({ parameters, isRunning, onChange, onSimulate }: Props) => (
  <section className="parameters">
    <div className="section-heading">
      <div>
        <p className="eyebrow">Simulation controls</p>
      </div>
      <button className="primary-action" disabled={isRunning} onClick={onSimulate}>
        {isRunning ? "Simulating" : "Simulate"}
      </button>
    </div>

    <ParameterSection
      title="Market & Campaign Parameters"
      groups={marketCampaignGroups}
      parameters={parameters}
      onChange={onChange}
    />
    <ParameterSection
      title="User Behavior Parameters"
      groups={userBehaviorGroups}
      parameters={parameters}
      onChange={onChange}
    />
  </section>
);
