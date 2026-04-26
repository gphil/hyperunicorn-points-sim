import { clamp, makeRandom, randomChoice, randomNormal, sampleAroundPct, sampleHoldingDays, sampleTruncatedPareto, sideSign } from "./random";
import type {
  MarketDayRow,
  MarketId,
  PointDayRow,
  Side,
  SimUser,
  SimulationOutput,
  SimulationParameters,
  TradeEventRow,
  TradeMode,
  UserResultRow,
  UserType,
  VaultDayRow
} from "./types";

const markets: readonly MarketId[] = ["ETH/USDC", "ETH/BTC", "BTC/USD"];
const sides: readonly Side[] = ["long", "short"];

type OpenTrade = {
  trade_id: string;
  user_id: string;
  user_type: UserType;
  market: MarketId;
  side: Side;
  mode: TradeMode;
  notional_usd: number;
  open_day: number;
  close_day: number;
  entry_mark: number;
  entry_fundamental: number;
  target_move_pct: number;
  max_holding_days: number;
};

type MarketSnapshot = Record<MarketId, { fundamental: number; mark: number; premiumPct: number }>;
type Exposure = Record<MarketId, number>;
type WeeklyPointScore = {
  userId: string;
  week: number;
  day: number;
  points: number;
  volume: number;
};

type WeeklyPointAccumulator = {
  userId: string;
  week: number;
  day: number;
  totalVolume: number;
  weightedVolume: number;
  longVolume: Exposure;
  shortVolume: Exposure;
};

const emptyExposure = (): Exposure => ({
  "ETH/USDC": 0,
  "ETH/BTC": 0,
  "BTC/USD": 0
});

const pct = (value: number) => value / 100;

const formatUserId = (index: number) => `HU-${String(index + 1).padStart(4, "0")}`;

const weightedType = (randomValue: number, parameters: SimulationParameters): UserType => {
  const shares = [
    ["Pure Noise", parameters.pureNoiseSharePct],
    ["Buy and Hold", parameters.buyHoldSharePct],
    ["Momentum", parameters.momentumSharePct],
    ["Arbitrageur", parameters.arbitrageurSharePct]
  ] as const;
  const total = shares.reduce((sum, [, share]) => sum + Math.max(0, share), 0) || 1;
  const target = randomValue * total;
  const selected = shares.reduce(
    (state, [userType, share]) =>
      state.done || target > state.running + Math.max(0, share)
        ? { ...state, running: state.running + Math.max(0, share) }
        : { userType, running: state.running + Math.max(0, share), done: true },
    { userType: "Pure Noise" as UserType, running: 0, done: false }
  );

  return selected.userType;
};

const vaultProfile = (userType: UserType, parameters: SimulationParameters) => {
  if (userType === "Pure Noise") {
    return [parameters.pureNoiseVaultDepositorPct, parameters.pureNoiseVaultDepositAvgPct];
  }
  if (userType === "Buy and Hold") {
    return [parameters.buyHoldVaultDepositorPct, parameters.buyHoldVaultDepositAvgPct];
  }
  if (userType === "Momentum") {
    return [parameters.momentumVaultDepositorPct, parameters.momentumVaultDepositAvgPct];
  }
  return [parameters.arbitrageurVaultDepositorPct, parameters.arbitrageurVaultDepositAvgPct];
};

const userStartDay = (random: () => number, parameters: SimulationParameters) => {
  const tradingDays = Math.max(1, parameters.tradingDays);
  const dayOneShare = 0.15;
  if (tradingDays === 1 || random() < dayOneShare) return 0;
  const growthRate = 2.75;
  const normalizedDay = Math.log(1 + random() * (Math.exp(growthRate) - 1)) / growthRate;
  return Math.min(tradingDays - 1, 1 + Math.floor(normalizedDay * (tradingDays - 1)));
};

const makeUsers = (parameters: SimulationParameters) => {
  const random = makeRandom(parameters.seed);
  return Array.from({ length: parameters.userCount }, (_, index): SimUser => {
    const userType = weightedType(random(), parameters);
    const bankroll = sampleTruncatedPareto(
      random,
      parameters.bankrollPowerLawAlpha,
      parameters.minBankrollUsd,
      parameters.maxBankrollUsd
    );
    const [vaultDepositorPct, vaultDepositAvgPct] = vaultProfile(userType, parameters);
    const vaultDepositPct = random() < pct(vaultDepositorPct) ? sampleAroundPct(random, vaultDepositAvgPct) : 0;
    const vaultDeposit = bankroll * pct(clamp(vaultDepositPct, 0, 95));

    return {
      user_id: formatUserId(index),
      user_type: userType,
      start_day: userStartDay(random, parameters),
      starting_bankroll_usd: bankroll,
      direct_bankroll_usd: bankroll - vaultDeposit,
      vault_deposit_usd: vaultDeposit
    };
  });
};

const pricePath = (
  days: number,
  initialPrice: number,
  dailyDrift: number,
  dailyVolatility: number,
  random: () => number
) => {
  const prices = [initialPrice];
  for (let day = 1; day <= days; day += 1) {
    prices.push(
      prices[day - 1] *
        Math.exp((dailyDrift - 0.5 * dailyVolatility ** 2) + dailyVolatility * randomNormal(random))
    );
  }
  return prices;
};

const fundamentalPrices = (ethUsd: number, btcUsd: number): Record<MarketId, number> => ({
  "ETH/USDC": ethUsd,
  "ETH/BTC": ethUsd / btcUsd,
  "BTC/USD": btcUsd
});

const marketSnapshot = (
  fundamentals: Record<MarketId, number>,
  exposure: Exposure,
  vaultTvl: number,
  parameters: SimulationParameters
): MarketSnapshot => {
  const depth = parameters.baseMarketDepthUsd + vaultTvl * 0.35;
  const impact = pct(parameters.demandMoveAtDepthPct);

  return markets.reduce((snapshot, market) => {
    const premium = clamp(impact * (exposure[market] / Math.max(1, depth)), -0.3, 0.3);
    const mark = fundamentals[market] * Math.exp(premium);
    snapshot[market] = {
      fundamental: fundamentals[market],
      mark,
      premiumPct: (mark / fundamentals[market] - 1) * 100
    };
    return snapshot;
  }, {} as MarketSnapshot);
};

const openExposure = (openTrades: OpenTrade[]) =>
  openTrades.reduce((exposure, trade) => {
    exposure[trade.market] += sideSign(trade.side) * trade.notional_usd;
    return exposure;
  }, emptyExposure());

const userExposure = (openTrades: OpenTrade[]) =>
  openTrades.reduce<Record<string, number>>((exposure, trade) => {
    exposure[trade.user_id] = (exposure[trade.user_id] ?? 0) + trade.notional_usd;
    return exposure;
  }, {});

const vaultTvlByDay = (users: SimUser[], tradingDays: number) => {
  const deltas = Array.from({ length: tradingDays + 1 }, () => 0);
  users.forEach((user) => {
    if (user.start_day <= tradingDays) {
      deltas[user.start_day] += user.vault_deposit_usd;
    }
  });
  return deltas.reduce<number[]>((totals, delta, day) => {
    totals.push((totals[day - 1] ?? 0) + delta);
    return totals;
  }, []);
};

const makeOpenTrade = (
  tradeId: number,
  user: SimUser,
  day: number,
  market: MarketId,
  side: Side,
  mode: TradeMode,
  notionalUsd: number,
  snapshot: MarketSnapshot,
  closeDay: number,
  targetMovePct: number,
  maxHoldingDays: number
): OpenTrade => ({
  trade_id: `T-${String(tradeId).padStart(7, "0")}`,
  user_id: user.user_id,
  user_type: user.user_type,
  market,
  side,
  mode,
  notional_usd: notionalUsd,
  open_day: day,
  close_day: closeDay,
  entry_mark: snapshot[market].mark,
  entry_fundamental: snapshot[market].fundamental,
  target_move_pct: targetMovePct,
  max_holding_days: maxHoldingDays
});

const markPnlPct = (trade: OpenTrade, snapshot: MarketSnapshot) =>
  sideSign(trade.side) * (snapshot[trade.market].mark / trade.entry_mark - 1);

const riskMultiplier = (absPnlPct: number, parameters: SimulationParameters) => {
  const base = pct(parameters.pnlRiskBasePct);
  const full = pct(parameters.pnlRiskFullBonusPct);
  const scaled = clamp((absPnlPct - base) / Math.max(0.0001, full - base), 0, 1);
  return 1 + (parameters.maxRiskMultiplier - 1) * scaled ** 1.35;
};

const lpImbalanceCarryUsd = (trade: OpenTrade, day: number, snapshot: MarketSnapshot, parameters: SimulationParameters) => {
  const currentPremium = snapshot[trade.market].mark / snapshot[trade.market].fundamental - 1;
  const entryPremium = trade.entry_mark / trade.entry_fundamental - 1;
  const averageDemandImbalance = (entryPremium + currentPremium) / 2;
  const holdingDays = Math.max(1, day - trade.open_day);
  return -sideSign(trade.side) * trade.notional_usd * parameters.fundingK * averageDemandImbalance * holdingDays;
};

const closeTrade = (
  trade: OpenTrade,
  day: number,
  snapshot: MarketSnapshot,
  parameters: SimulationParameters
): TradeEventRow => {
  const rawPnlPct = markPnlPct(trade, snapshot);
  const syntheticCarryUsd = lpImbalanceCarryUsd(trade, day, snapshot, parameters);
  const feeUsd = trade.notional_usd * pct(parameters.tradeFeeBps / 100) * 2;
  const pnlUsd = trade.notional_usd * rawPnlPct + syntheticCarryUsd - feeUsd;
  const pnlPct = pnlUsd / trade.notional_usd;

  return {
    trade_id: trade.trade_id,
    user_id: trade.user_id,
    user_type: trade.user_type,
    week: Math.floor(trade.open_day / 7),
    open_day: trade.open_day,
    close_day: day,
    market: trade.market,
    side: trade.side,
    mode: trade.mode,
    notional_usd: trade.notional_usd,
    pnl_usd: pnlUsd,
    pnl_pct: pnlPct * 100,
    abs_pnl_pct: Math.abs(pnlPct) * 100,
    risk_multiplier: riskMultiplier(Math.abs(pnlPct), parameters),
    fee_usd: feeUsd,
    funding_usd: syntheticCarryUsd
  };
};

const shouldCloseTrade = (
  random: () => number,
  trade: OpenTrade,
  day: number,
  lastDay: number,
  snapshot: MarketSnapshot,
  parameters: SimulationParameters
) => {
  if (day <= trade.open_day) return false;
  if (day >= lastDay) return true;
  if (trade.mode === "noise") return day >= trade.close_day;
  if (trade.mode === "momentum") {
    const absMovePct = Math.abs(markPnlPct(trade, snapshot)) * 100;
    return absMovePct >= trade.target_move_pct || day - trade.open_day >= trade.max_holding_days;
  }
  if (trade.mode === "hold") {
    const excessMove = Math.max(0, Math.abs(markPnlPct(trade, snapshot)) - 0.1);
    return random() < clamp(excessMove * pct(parameters.buyHoldFearFactorPct), 0, 0.8);
  }
  return true;
};

const sumByUser = (rows: TradeEventRow[]) =>
  rows.reduce<Record<string, number>>((sum, row) => {
    sum[row.user_id] = (sum[row.user_id] ?? 0) + row.pnl_usd;
    return sum;
  }, {});

const applyPnlByUser = (cashByUser: Record<string, number>, pnlByUser: Record<string, number>) => {
  Object.entries(pnlByUser).forEach(([userId, pnl]) => {
    cashByUser[userId] = Math.max(0, (cashByUser[userId] ?? 0) + pnl);
  });
  return cashByUser;
};

const maybeNotional = (
  random: () => number,
  user: SimUser,
  cash: number,
  currentExposure: number,
  averageTradePct: number
) => {
  const exposureLimit = Math.max(0, cash);
  const notional = cash * pct(sampleAroundPct(random, averageTradePct));
  return Math.min(notional, Math.max(0, exposureLimit - currentExposure));
};

const openNoiseTrade = (
  random: () => number,
  tradeId: number,
  user: SimUser,
  day: number,
  cash: number,
  exposure: number,
  snapshot: MarketSnapshot,
  parameters: SimulationParameters
) => {
  const notional = maybeNotional(random, user, cash, exposure, parameters.pureNoiseAvgTradePct);
  return notional < 25
    ? undefined
    : makeOpenTrade(
        tradeId,
        user,
        day,
        randomChoice(random, markets),
        randomChoice(random, sides),
        "noise",
        notional,
        snapshot,
        day + sampleHoldingDays(random, parameters.pureNoiseAvgHoldingDays, parameters.tradingDays),
        0,
        parameters.tradingDays
      );
};

const openHoldTrades = (
  random: () => number,
  tradeIdStart: number,
  user: SimUser,
  day: number,
  snapshot: MarketSnapshot,
  parameters: SimulationParameters
) => {
  const count = Math.max(1, Math.round(parameters.buyHoldPositionsPerUser));
  return Array.from({ length: count })
    .map((_, index) => {
      const notional = (user.direct_bankroll_usd * pct(sampleAroundPct(random, parameters.buyHoldAvgTradePct))) / count;
      return notional < 25
        ? undefined
        : makeOpenTrade(
            tradeIdStart + index,
            user,
            day,
            randomChoice(random, markets),
            index % 2 === 0 ? "long" : "short",
            "hold",
            notional,
            snapshot,
            parameters.tradingDays,
            0,
            parameters.tradingDays
          );
    })
    .filter((trade): trade is OpenTrade => Boolean(trade));
};

const recentReturnPct = (prices: number[], day: number, lookbackDays: number) => {
  const priorDay = Math.max(0, day - Math.max(1, Math.round(lookbackDays)));
  return day === priorDay ? 0 : (prices[day] / prices[priorDay] - 1) * 100;
};

const openMomentumTrade = (
  random: () => number,
  tradeId: number,
  user: SimUser,
  day: number,
  cash: number,
  exposure: number,
  snapshot: MarketSnapshot,
  returnsByMarket: Record<MarketId, number>,
  parameters: SimulationParameters
) => {
  const market = markets.reduce((best, next) =>
    Math.abs(returnsByMarket[next]) > Math.abs(returnsByMarket[best]) ? next : best
  );
  if (Math.abs(returnsByMarket[market]) < 0.4) return undefined;

  const notional = maybeNotional(random, user, cash, exposure, parameters.momentumAvgTradePct);
  const targetMovePct = clamp(sampleAroundPct(random, parameters.momentumExitMoveAvgPct, 45), 1, 10);
  return notional < 25
    ? undefined
    : makeOpenTrade(
        tradeId,
        user,
        day,
        market,
        returnsByMarket[market] >= 0 ? "long" : "short",
        "momentum",
        notional,
        snapshot,
        parameters.tradingDays,
        targetMovePct,
        14
      );
};

const trianglePremiumPct = (snapshot: MarketSnapshot) => {
  const impliedEthBtc = snapshot["ETH/USDC"].mark / snapshot["BTC/USD"].mark;
  return (snapshot["ETH/BTC"].mark / impliedEthBtc - 1) * 100;
};

const arbitrageEvents = (
  random: () => number,
  tradeIdStart: number,
  users: SimUser[],
  cashByUser: Record<string, number>,
  day: number,
  snapshot: MarketSnapshot,
  parameters: SimulationParameters
) => {
  const premiumPct = trianglePremiumPct(snapshot);
  const edgePct = Math.max(0, Math.abs(premiumPct) - parameters.arbitrageThresholdPct);
  if (edgePct <= 0) return [] as TradeEventRow[];

  return users
    .filter((user) => user.start_day <= day && user.user_type === "Arbitrageur" && (cashByUser[user.user_id] ?? 0) > 25 && random() < 0.35)
    .map((user, index): TradeEventRow => {
      const notional = (cashByUser[user.user_id] ?? 0) * pct(sampleAroundPct(random, parameters.arbitrageurAvgTradePct, 35));
      const pnlPct = pct(edgePct) * pct(parameters.arbitrageCaptureRatePct);
      const feeUsd = notional * pct(parameters.tradeFeeBps / 100) * 2;
      const pnlUsd = Math.max(0, notional * pnlPct - feeUsd);
      return {
        trade_id: `T-${String(tradeIdStart + index).padStart(7, "0")}`,
        user_id: user.user_id,
        user_type: user.user_type,
        week: Math.floor(day / 7),
        open_day: day,
        close_day: day,
        market: "ETH/BTC",
        side: premiumPct > 0 ? "short" : "long",
        mode: "arbitrage",
        notional_usd: notional,
        pnl_usd: pnlUsd,
        pnl_pct: (pnlUsd / Math.max(1, notional)) * 100,
        abs_pnl_pct: Math.abs(pnlUsd / Math.max(1, notional)) * 100,
        risk_multiplier: riskMultiplier(Math.abs(pnlUsd / Math.max(1, notional)), parameters),
        fee_usd: feeUsd,
        funding_usd: 0
      };
    });
};

const vaultDays = (users: SimUser[], parameters: SimulationParameters) =>
  users.flatMap((user) =>
    user.vault_deposit_usd <= 0
      ? []
      : Array.from({ length: Math.max(0, parameters.tradingDays - user.start_day) }, (_, index): VaultDayRow => {
          const day = user.start_day + index;
          const streakDay = index + 1;
          return {
            user_id: user.user_id,
            day,
            vault_deposit_usd: user.vault_deposit_usd,
            streak_day: streakDay,
            vault_points: user.vault_deposit_usd * (1 + pct(parameters.vaultStreakRewardRatePct)) ** streakDay
          };
        })
  );

const weeklyPointScores = (trades: TradeEventRow[], parameters: SimulationParameters): WeeklyPointScore[] => {
  const byUserWeek = trades.reduce<Record<string, WeeklyPointAccumulator>>((groups, trade) => {
    const key = `${trade.user_id}|${trade.week}`;
    const current =
      groups[key] ??
      {
        userId: trade.user_id,
        week: trade.week,
        day: trade.close_day,
        totalVolume: 0,
        weightedVolume: 0,
        longVolume: emptyExposure(),
        shortVolume: emptyExposure()
      };
    const sideVolume = trade.side === "long" ? current.longVolume : current.shortVolume;
    sideVolume[trade.market] += trade.notional_usd;
    current.day = Math.max(current.day, trade.close_day);
    current.totalVolume += trade.notional_usd;
    current.weightedVolume += trade.notional_usd * trade.risk_multiplier;
    groups[key] = current;
    return groups;
  }, {});

  return Object.values(byUserWeek).map((group) => {
    const washVolume = markets.reduce(
      (sum, market) => sum + Math.min(group.longVolume[market], group.shortVolume[market]) * 2,
      0
    );
    const washRatio = group.totalVolume <= 0 ? 0 : washVolume / group.totalVolume;
    return {
      userId: group.userId,
      week: group.week,
      day: group.day,
      points: group.weightedVolume * (1 - clamp(washRatio, 0, 1) * pct(parameters.washTradeDiscountPct)),
      volume: group.totalVolume
    };
  });
};

const groupWeeklyScoresByUser = (scores: WeeklyPointScore[]) =>
  scores.reduce<Record<string, WeeklyPointScore[]>>((groups, score) => {
    const current = groups[score.userId] ?? [];
    current.push(score);
    groups[score.userId] = current;
    return groups;
  }, {});

const washAdjustedWeeklyPoints = (weekScores: WeeklyPointScore[], parameters: SimulationParameters) => {
  const scoresByUser = groupWeeklyScoresByUser(weekScores);

  return Object.entries(scoresByUser).reduce<Record<string, { points: number; effectiveVolume: number; maxStreak: number }>>(
    (scores, [userId, weeks]) => {
      const orderedWeeks = weeks.sort((a, b) => a.week - b.week);
      const state = orderedWeeks.reduce(
        (acc, week) => {
          const streak = acc.lastWeek === week.week - 1 ? acc.streak + 1 : 1;
          const multiplier = (1 + pct(parameters.traderWeeklyStreakRewardRatePct)) ** streak;
          return {
            lastWeek: week.week,
            streak,
            maxStreak: Math.max(acc.maxStreak, streak),
            points: acc.points + week.points * multiplier,
            effectiveVolume: acc.effectiveVolume + week.volume * (week.points > 0 ? Math.min(1, week.points / Math.max(1, week.volume)) : 0)
          };
        },
        { lastWeek: -2, streak: 0, maxStreak: 0, points: 0, effectiveVolume: 0 }
      );
      scores[userId] = {
        points: state.points,
        effectiveVolume: state.effectiveVolume,
        maxStreak: state.maxStreak
      };
      return scores;
    },
    {}
  );
};

const pointDays = (weekScores: WeeklyPointScore[], vaultRows: VaultDayRow[], parameters: SimulationParameters): PointDayRow[] => {
  const dayCount = Math.max(parameters.tradingDays + 1, 1);
  const tradingPointsByDay = Array.from({ length: dayCount }, () => 0);
  const vaultPointsByDay = Array.from({ length: dayCount }, () => 0);

  Object.values(groupWeeklyScoresByUser(weekScores)).forEach((weeks) => {
    const orderedWeeks = weeks.sort((a, b) => a.week - b.week);
    orderedWeeks.reduce(
      (state, week) => {
        const streak = state.lastWeek === week.week - 1 ? state.streak + 1 : 1;
        const multiplier = (1 + pct(parameters.traderWeeklyStreakRewardRatePct)) ** streak;
        tradingPointsByDay[week.day] = (tradingPointsByDay[week.day] ?? 0) + week.points * multiplier;
        return { lastWeek: week.week, streak };
      },
      { lastWeek: -2, streak: 0 }
    );
  });

  vaultRows.forEach((row) => {
    vaultPointsByDay[row.day] = (vaultPointsByDay[row.day] ?? 0) + row.vault_points;
  });

  return Array.from({ length: dayCount }).reduce<PointDayRow[]>((rows, _, day) => {
    const tradingPoints = tradingPointsByDay[day] ?? 0;
    const vaultPoints = vaultPointsByDay[day] ?? 0;
    const previous = rows[rows.length - 1];
    const cumulativeTrading = (previous?.cumulative_trading_points ?? 0) + tradingPoints;
    const cumulativeVault = (previous?.cumulative_vault_points ?? 0) + vaultPoints;
    rows.push({
      day,
      trading_points: tradingPoints,
      vault_points: vaultPoints,
      total_points: tradingPoints + vaultPoints,
      cumulative_trading_points: cumulativeTrading,
      cumulative_vault_points: cumulativeVault,
      cumulative_total_points: cumulativeTrading + cumulativeVault
    });
    return rows;
  }, []);
};

const vaultFlowPnl = (trades: TradeEventRow[]) =>
  trades.reduce((sum, row) => sum + row.fee_usd - row.funding_usd, 0);

const allocateVaultPnl = (
  users: SimUser[],
  day: number,
  vaultTvl: number,
  pnlByUser: Record<string, number>,
  pnlUsd: number
) => {
  if (vaultTvl <= 0 || pnlUsd === 0) return pnlByUser;
  users.forEach((user) => {
    if (user.start_day <= day && user.vault_deposit_usd > 0) {
      const share = user.vault_deposit_usd / vaultTvl;
      pnlByUser[user.user_id] = (pnlByUser[user.user_id] ?? 0) + pnlUsd * share;
    }
  });
  return pnlByUser;
};

const userResults = (
  users: SimUser[],
  cashByUser: Record<string, number>,
  trades: TradeEventRow[],
  vaultRows: VaultDayRow[],
  weekScores: WeeklyPointScore[],
  vaultArbPnlByUser: Record<string, number>,
  parameters: SimulationParameters
): UserResultRow[] => {
  const directScores = washAdjustedWeeklyPoints(weekScores, parameters);
  const tradeRowsByUser = trades.reduce<Record<string, TradeEventRow[]>>((groups, trade) => {
    const rows = groups[trade.user_id] ?? [];
    rows.push(trade);
    groups[trade.user_id] = rows;
    return groups;
  }, {});
  const vaultRowsByUser = vaultRows.reduce<Record<string, VaultDayRow[]>>((groups, row) => {
    const rows = groups[row.user_id] ?? [];
    rows.push(row);
    groups[row.user_id] = rows;
    return groups;
  }, {});

  const unranked = users.map((user) => {
    const userTrades = tradeRowsByUser[user.user_id] ?? [];
    const userVaultRows = vaultRowsByUser[user.user_id] ?? [];
    const tradeStats = userTrades.reduce(
      (stats, row) => {
        stats.directVolume += row.notional_usd;
        stats.weightedAbsPnl += row.notional_usd * row.abs_pnl_pct;
        stats.directPnl += row.pnl_usd;
        stats.bestTradePnl = Math.max(stats.bestTradePnl, row.pnl_pct);
        stats.worstTradePnl = Math.min(stats.worstTradePnl, row.pnl_pct);
        return stats;
      },
      { directVolume: 0, weightedAbsPnl: 0, directPnl: 0, bestTradePnl: -Infinity, worstTradePnl: Infinity }
    );
    const direct = directScores[user.user_id] ?? { points: 0, effectiveVolume: 0, maxStreak: 0 };
    const vaultArbPnl = vaultArbPnlByUser[user.user_id] ?? 0;
    const vaultPoints = userVaultRows.reduce((sum, row) => sum + row.vault_points, 0);
    const vaultTvlDays = userVaultRows.reduce((sum, row) => sum + row.vault_deposit_usd, 0);
    const totalPoints = direct.points + vaultPoints;

    return {
      rank: 0,
      user_id: user.user_id,
      user_type: user.user_type,
      starting_bankroll_usd: user.starting_bankroll_usd,
      final_bankroll_usd: cashByUser[user.user_id] ?? 0,
      vault_deposit_usd: user.vault_deposit_usd,
      direct_volume_usd: tradeStats.directVolume,
      effective_direct_volume_usd: direct.effectiveVolume,
      cumulative_pnl_usd: tradeStats.directPnl + vaultArbPnl,
      vault_tvl_days: vaultTvlDays,
      avg_abs_pnl_pct: tradeStats.directVolume <= 0 ? 0 : tradeStats.weightedAbsPnl / tradeStats.directVolume,
      best_trade_pnl_pct: userTrades.length ? tradeStats.bestTradePnl : 0,
      worst_trade_pnl_pct: userTrades.length ? tradeStats.worstTradePnl : 0,
      max_weekly_activity_streak: direct.maxStreak,
      direct_points: direct.points,
      vault_points: vaultPoints,
      total_points: totalPoints,
      percentile: 0,
      vault_arb_pnl_usd: vaultArbPnl,
      stopped_out: (cashByUser[user.user_id] ?? 0) <= 25 ? 1 : 0
    };
  });

  return unranked
    .sort((a, b) => b.total_points - a.total_points)
    .map((row, index, rows) => ({
      ...row,
      rank: index + 1,
      percentile: rows.length <= 1 ? 100 : (1 - index / (rows.length - 1)) * 100
    }));
};

export const simulate = (parameters: SimulationParameters): SimulationOutput => {
  const startedAt = performance.now();
  const random = makeRandom(parameters.seed);
  const users = makeUsers(parameters);
  const ethPrices = pricePath(
    parameters.tradingDays,
    parameters.ethInitialUsd,
    pct(parameters.ethDailyDriftPct),
    pct(parameters.ethDailyVolatilityPct),
    random
  );
  const btcPrices = pricePath(
    parameters.tradingDays,
    parameters.btcInitialUsd,
    pct(parameters.btcDailyDriftPct),
    pct(parameters.btcDailyVolatilityPct),
    random
  );
  const ethBtcPrices = ethPrices.map((price, index) => price / btcPrices[index]);
  const vaultTvl = vaultTvlByDay(users, parameters.tradingDays);
  let tradeId = 1;
  let openTrades: OpenTrade[] = [];
  let tradeRows: TradeEventRow[] = [];
  let marketRows: MarketDayRow[] = [];
  let cashByUser = Object.fromEntries(users.map((user) => [user.user_id, user.direct_bankroll_usd]));
  let vaultArbPnl = 0;
  let vaultArbPnlByUser: Record<string, number> = {};

  for (let day = 0; day < parameters.tradingDays; day += 1) {
    const fundamentals = fundamentalPrices(ethPrices[day], btcPrices[day]);
    const vaultTvlDay = vaultTvl[day] ?? 0;
    const snapshot = marketSnapshot(fundamentals, openExposure(openTrades), vaultTvlDay, parameters);
    const newHoldTrades = users
      .filter((user) => user.start_day === day && user.user_type === "Buy and Hold" && user.direct_bankroll_usd > 25)
      .flatMap((user) => {
        const trades = openHoldTrades(random, tradeId, user, day, snapshot, parameters);
        tradeId += trades.length;
        return trades;
      });
    openTrades.push(...newHoldTrades);

    const closingTrades: TradeEventRow[] = [];
    const closingIds = new Set<string>();
    openTrades.forEach((trade) => {
      if (shouldCloseTrade(random, trade, day, parameters.tradingDays - 1, snapshot, parameters)) {
        closingTrades.push(closeTrade(trade, day, snapshot, parameters));
        closingIds.add(trade.trade_id);
      }
    });
    const pnlByUser = sumByUser(closingTrades);
    cashByUser = applyPnlByUser(cashByUser, pnlByUser);
    openTrades = openTrades.filter((trade) => !closingIds.has(trade.trade_id));
    tradeRows.push(...closingTrades);

    const exposureByUser = userExposure(openTrades);
    const marketReturns = {
      "ETH/USDC": recentReturnPct(ethPrices, day, parameters.momentumSignalLookbackDays),
      "BTC/USD": recentReturnPct(btcPrices, day, parameters.momentumSignalLookbackDays),
      "ETH/BTC": recentReturnPct(ethBtcPrices, day, parameters.momentumSignalLookbackDays)
    };

    const newTrades = users
      .filter((user) => user.start_day <= day && (cashByUser[user.user_id] ?? 0) > 25)
      .map((user) => {
        const cash = cashByUser[user.user_id] ?? 0;
        const exposure = exposureByUser[user.user_id] ?? 0;
        if (user.user_type === "Pure Noise" && random() < parameters.pureNoiseTradesPerWeek / 7) {
          return openNoiseTrade(random, tradeId, user, day, cash, exposure, snapshot, parameters);
        }
        if (user.user_type === "Momentum" && random() < parameters.momentumTradesPerWeek / 7) {
          return openMomentumTrade(random, tradeId, user, day, cash, exposure, snapshot, marketReturns, parameters);
        }
        return undefined;
      })
      .filter((trade): trade is OpenTrade => Boolean(trade));

    tradeId += newTrades.length;
    openTrades.push(...newTrades);

    const arbRows = arbitrageEvents(random, tradeId, users, cashByUser, day, snapshot, parameters);
    tradeId += arbRows.length;
    const arbPnlByUser = sumByUser(arbRows);
    cashByUser = applyPnlByUser(cashByUser, arbPnlByUser);
    tradeRows.push(...arbRows);

    const premiumPct = Math.abs(trianglePremiumPct(snapshot));
    const vaultArbNotional = premiumPct > parameters.arbitrageThresholdPct ? vaultTvlDay * pct(parameters.vaultArbitrageSharePct) : 0;
    const vaultArbPnlDay =
      vaultArbNotional *
      pct(Math.max(0, premiumPct - parameters.arbitrageThresholdPct)) *
      pct(parameters.arbitrageCaptureRatePct);
    const vaultFlowPnlDay = vaultFlowPnl(closingTrades);
    const vaultPnlDay = vaultArbPnlDay + vaultFlowPnlDay;
    vaultArbPnl += vaultPnlDay;
    vaultArbPnlByUser = allocateVaultPnl(users, day, vaultTvlDay, vaultArbPnlByUser, vaultPnlDay);

    const endingExposure = openExposure(openTrades);
    const endingSnapshot = marketSnapshot(fundamentals, endingExposure, vaultTvlDay, parameters);
    const arbVolume = arbRows.reduce((sum, row) => sum + row.notional_usd, 0) + vaultArbNotional;
    marketRows.push(
      ...markets.map((market): MarketDayRow => ({
        day,
        market,
        fundamental_price: endingSnapshot[market].fundamental,
        lp_mark_price: endingSnapshot[market].mark,
        net_demand_usd: endingExposure[market],
        premium_pct: endingSnapshot[market].premiumPct,
        vault_tvl_usd: vaultTvlDay,
        arbitrage_volume_usd: arbVolume
      }))
    );
  }

  const finalSnapshot = marketSnapshot(
    fundamentalPrices(ethPrices[parameters.tradingDays], btcPrices[parameters.tradingDays]),
    openExposure(openTrades),
    vaultTvl[parameters.tradingDays] ?? 0,
    parameters
  );
  const finalTrades = openTrades.map((trade) => closeTrade(trade, parameters.tradingDays, finalSnapshot, parameters));
  const finalPnlByUser = sumByUser(finalTrades);
  cashByUser = applyPnlByUser(cashByUser, finalPnlByUser);
  tradeRows.push(...finalTrades);
  const finalVaultTvl = vaultTvl[parameters.tradingDays] ?? 0;
  const finalVaultFlowPnl = vaultFlowPnl(finalTrades);
  vaultArbPnl += finalVaultFlowPnl;
  vaultArbPnlByUser = allocateVaultPnl(users, parameters.tradingDays, finalVaultTvl, vaultArbPnlByUser, finalVaultFlowPnl);

  const vaultRows = vaultDays(users, parameters);
  const weekScores = weeklyPointScores(tradeRows, parameters);
  const pointRows = pointDays(weekScores, vaultRows, parameters);
  const results = userResults(users, cashByUser, tradeRows, vaultRows, weekScores, vaultArbPnlByUser, parameters);
  const summary = {
    user_count: users.length,
    trading_days: parameters.tradingDays,
    total_points: results.reduce((sum, row) => sum + row.total_points, 0),
    direct_points: results.reduce((sum, row) => sum + row.direct_points, 0),
    vault_points: results.reduce((sum, row) => sum + row.vault_points, 0),
    direct_volume_usd: results.reduce((sum, row) => sum + row.direct_volume_usd, 0),
    effective_direct_volume_usd: results.reduce((sum, row) => sum + row.effective_direct_volume_usd, 0),
    vault_tvl_days: results.reduce((sum, row) => sum + row.vault_tvl_days, 0),
    vault_arb_pnl_usd: vaultArbPnl,
    elapsed_ms: performance.now() - startedAt
  };

  return { users, trades: tradeRows, vaultDays: vaultRows, marketDays: marketRows, pointDays: pointRows, userResults: results, summary };
};
