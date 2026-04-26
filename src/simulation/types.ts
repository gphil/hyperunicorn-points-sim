export type UserType = "Pure Noise" | "Buy and Hold" | "Momentum" | "Arbitrageur";
export type MarketId = "ETH/USDC" | "ETH/BTC" | "BTC/USD";
export type Side = "long" | "short";
export type TradeMode = "noise" | "hold" | "momentum" | "arbitrage";

export type SimulationParameters = {
  seed: number;
  userCount: number;
  tradingDays: number;
  bankrollPowerLawAlpha: number;
  minBankrollUsd: number;
  maxBankrollUsd: number;
  ethInitialUsd: number;
  btcInitialUsd: number;
  ethDailyVolatilityPct: number;
  btcDailyVolatilityPct: number;
  ethDailyDriftPct: number;
  btcDailyDriftPct: number;
  baseMarketDepthUsd: number;
  demandMoveAtDepthPct: number;
  fundingK: number;
  tradeFeeBps: number;
  arbitrageThresholdPct: number;
  arbitrageCaptureRatePct: number;
  vaultArbitrageSharePct: number;
  vaultStreakRewardRatePct: number;
  traderWeeklyStreakRewardRatePct: number;
  pnlRiskBasePct: number;
  pnlRiskFullBonusPct: number;
  maxRiskMultiplier: number;
  washTradeDiscountPct: number;
  pureNoiseSharePct: number;
  buyHoldSharePct: number;
  momentumSharePct: number;
  arbitrageurSharePct: number;
  pureNoiseAvgTradePct: number;
  pureNoiseTradesPerWeek: number;
  pureNoiseAvgHoldingDays: number;
  pureNoiseVaultDepositorPct: number;
  pureNoiseVaultDepositAvgPct: number;
  buyHoldAvgTradePct: number;
  buyHoldPositionsPerUser: number;
  buyHoldFearFactorPct: number;
  buyHoldVaultDepositorPct: number;
  buyHoldVaultDepositAvgPct: number;
  momentumAvgTradePct: number;
  momentumTradesPerWeek: number;
  momentumSignalLookbackDays: number;
  momentumExitMoveAvgPct: number;
  momentumVaultDepositorPct: number;
  momentumVaultDepositAvgPct: number;
  arbitrageurAvgTradePct: number;
  arbitrageurVaultDepositorPct: number;
  arbitrageurVaultDepositAvgPct: number;
};

export type SimUser = {
  user_id: string;
  user_type: UserType;
  start_day: number;
  starting_bankroll_usd: number;
  direct_bankroll_usd: number;
  vault_deposit_usd: number;
};

export type TradeEventRow = {
  trade_id: string;
  user_id: string;
  user_type: UserType;
  week: number;
  open_day: number;
  close_day: number;
  market: MarketId;
  side: Side;
  mode: TradeMode;
  notional_usd: number;
  pnl_usd: number;
  pnl_pct: number;
  abs_pnl_pct: number;
  risk_multiplier: number;
  fee_usd: number;
  funding_usd: number;
};

export type VaultDayRow = {
  user_id: string;
  day: number;
  vault_deposit_usd: number;
  streak_day: number;
  vault_points: number;
};

export type MarketDayRow = {
  day: number;
  market: MarketId;
  fundamental_price: number;
  lp_mark_price: number;
  net_demand_usd: number;
  premium_pct: number;
  vault_tvl_usd: number;
  arbitrage_volume_usd: number;
};

export type PointDayRow = {
  day: number;
  trading_points: number;
  vault_points: number;
  total_points: number;
  cumulative_trading_points: number;
  cumulative_vault_points: number;
  cumulative_total_points: number;
};

export type UserResultRow = {
  rank: number;
  user_id: string;
  user_type: UserType;
  starting_bankroll_usd: number;
  final_bankroll_usd: number;
  vault_deposit_usd: number;
  direct_volume_usd: number;
  effective_direct_volume_usd: number;
  cumulative_pnl_usd: number;
  vault_tvl_days: number;
  avg_abs_pnl_pct: number;
  best_trade_pnl_pct: number;
  worst_trade_pnl_pct: number;
  max_weekly_activity_streak: number;
  direct_points: number;
  vault_points: number;
  total_points: number;
  percentile: number;
  vault_arb_pnl_usd: number;
  stopped_out: number;
};

export type SimulationSummary = {
  user_count: number;
  trading_days: number;
  total_points: number;
  direct_points: number;
  vault_points: number;
  direct_volume_usd: number;
  effective_direct_volume_usd: number;
  vault_tvl_days: number;
  vault_arb_pnl_usd: number;
  elapsed_ms: number;
};

export type SimulationOutput = {
  users: SimUser[];
  trades: TradeEventRow[];
  vaultDays: VaultDayRow[];
  marketDays: MarketDayRow[];
  pointDays: PointDayRow[];
  userResults: UserResultRow[];
  summary: SimulationSummary;
};
