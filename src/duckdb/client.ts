import * as duckdb from "@duckdb/duckdb-wasm";

import type { SimulationOutput, UserResultRow } from "../simulation/types";

export type CampaignStatsRow = {
  trading_points: number;
  vault_points: number;
  total_points: number;
  total_volume_usd: number;
  ending_vault_tvl_usd: number;
  total_trader_pnl_usd: number;
  vault_pnl_usd: number;
};

export type CampaignSeriesRow = {
  day: number;
  value: number;
};

export type CampaignStackedSeriesRow = CampaignSeriesRow & {
  segment: string;
};

export type DuckDbStore = {
  db: duckdb.AsyncDuckDB;
  conn: duckdb.AsyncDuckDBConnection;
};

let storePromise: Promise<DuckDbStore> | undefined;

const bundles = {
  mvp: {
    mainModule: "/vendor/duckdb/duckdb-mvp.wasm",
    mainWorker: "/vendor/duckdb/duckdb-browser-mvp.worker.js"
  },
  eh: {
    mainModule: "/vendor/duckdb/duckdb-eh.wasm",
    mainWorker: "/vendor/duckdb/duckdb-browser-eh.worker.js"
  }
};

const cell = (value: unknown) => {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "0";
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
};

const csv = <T extends Record<string, unknown>>(rows: T[], columns: (keyof T)[]) => [
  columns.join(","),
  ...rows.map((row) => columns.map((column) => cell(row[column])).join(","))
].join("\n");

const normalizeDuckDbValue = (value: unknown): unknown => {
  if (typeof value === "bigint") return Number(value);
  if (Array.isArray(value)) return value.map(normalizeDuckDbValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeDuckDbValue(item)]));
  }
  return value;
};

const arrowRows = <T>(table: { toArray: () => unknown[] }) =>
  table.toArray().map((row) => {
    const value = typeof (row as { toJSON?: () => T }).toJSON === "function" ? (row as { toJSON: () => T }).toJSON() : row;
    return normalizeDuckDbValue(value) as T;
  });

export const getDuckDbStore = async (): Promise<DuckDbStore> => {
  if (!storePromise) {
    storePromise = (async () => {
      const selectedBundle = await duckdb.selectBundle(bundles);
      const worker = new Worker(selectedBundle.mainWorker ?? bundles.mvp.mainWorker);
      const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
      const db = new duckdb.AsyncDuckDB(logger, worker);
      await db.instantiate(selectedBundle.mainModule, selectedBundle.pthreadWorker);
      const conn = await db.connect();
      return { db, conn };
    })();
  }

  return storePromise;
};

const replaceTable = async <T extends Record<string, unknown>>(
  store: DuckDbStore,
  tableName: string,
  fileName: string,
  rows: T[],
  columns: (keyof T)[]
) => {
  await store.conn.query(`DROP TABLE IF EXISTS ${tableName}`);
  await store.db.registerFileText(fileName, csv(rows, columns));
  await store.conn.query(`CREATE TABLE ${tableName} AS SELECT * FROM read_csv_auto('${fileName}', HEADER = TRUE)`);
};

export const loadSimulation = async (output: SimulationOutput) => {
  const store = await getDuckDbStore();

  await replaceTable(store, "user_results", "user_results.csv", output.userResults, [
    "rank",
    "user_id",
    "user_type",
    "starting_bankroll_usd",
    "final_bankroll_usd",
    "vault_deposit_usd",
    "direct_volume_usd",
    "effective_direct_volume_usd",
    "cumulative_pnl_usd",
    "vault_tvl_days",
    "avg_abs_pnl_pct",
    "best_trade_pnl_pct",
    "worst_trade_pnl_pct",
    "max_weekly_activity_streak",
    "direct_points",
    "vault_points",
    "total_points",
    "percentile",
    "vault_arb_pnl_usd",
    "stopped_out"
  ]);
  await replaceTable(store, "users", "users.csv", output.users, [
    "user_id",
    "user_type",
    "start_day",
    "starting_bankroll_usd",
    "direct_bankroll_usd",
    "vault_deposit_usd"
  ]);
  await replaceTable(store, "trade_events", "trade_events.csv", output.trades, [
    "trade_id",
    "user_id",
    "user_type",
    "week",
    "open_day",
    "close_day",
    "market",
    "side",
    "mode",
    "notional_usd",
    "pnl_usd",
    "pnl_pct",
    "abs_pnl_pct",
    "risk_multiplier",
    "fee_usd",
    "funding_usd"
  ]);
  await replaceTable(store, "vault_days", "vault_days.csv", output.vaultDays, [
    "user_id",
    "day",
    "vault_deposit_usd",
    "streak_day",
    "vault_points"
  ]);
  await replaceTable(store, "market_days", "market_days.csv", output.marketDays, [
    "day",
    "market",
    "fundamental_price",
    "lp_mark_price",
    "net_demand_usd",
    "premium_pct",
    "vault_tvl_usd",
    "arbitrage_volume_usd"
  ]);
  await replaceTable(store, "point_days", "point_days.csv", output.pointDays, [
    "day",
    "trading_points",
    "vault_points",
    "total_points",
    "cumulative_trading_points",
    "cumulative_vault_points",
    "cumulative_total_points"
  ]);

  return store;
};

export const queryRows = async <T>(sql: string) => {
  const store = await getDuckDbStore();
  const result = await store.conn.query(sql);
  return arrowRows<T>(result);
};

export const leaderboardQuery = () =>
  queryRows<UserResultRow>("SELECT * FROM user_results ORDER BY rank ASC");

export const campaignStatsQuery = async () => {
  const rows = await queryRows<CampaignStatsRow>(`
    SELECT
      COALESCE(SUM(direct_points), 0) AS trading_points,
      COALESCE(SUM(vault_points), 0) AS vault_points,
      COALESCE(SUM(total_points), 0) AS total_points,
      COALESCE(SUM(direct_volume_usd), 0) AS total_volume_usd,
      COALESCE((SELECT SUM(vault_deposit_usd) FROM users), 0) AS ending_vault_tvl_usd,
      COALESCE((SELECT SUM(pnl_usd) FROM trade_events), 0) AS total_trader_pnl_usd,
      COALESCE(SUM(CASE WHEN vault_arb_pnl_usd = vault_arb_pnl_usd THEN vault_arb_pnl_usd ELSE 0 END), 0) AS vault_pnl_usd
    FROM user_results
  `);
  return rows[0];
};

export const tradingVolumeSeriesQuery = () =>
  queryRows<CampaignSeriesRow>(`
    WITH daily_volume AS (
      SELECT point_days.day, COALESCE(SUM(trade_events.notional_usd), 0) AS value
      FROM point_days
      LEFT JOIN trade_events ON trade_events.close_day = point_days.day
      GROUP BY point_days.day
    )
    SELECT
      day,
      SUM(value) OVER (ORDER BY day ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS value
    FROM daily_volume
    ORDER BY day ASC
  `);

export const protocolTvlSeriesQuery = () =>
  queryRows<CampaignStackedSeriesRow>(`
    WITH days AS (
      SELECT day FROM point_days
    ),
    trader_tvl AS (
      SELECT days.day, COALESCE(SUM(trade_events.notional_usd), 0) AS value
      FROM days
      LEFT JOIN trade_events
        ON trade_events.open_day <= days.day
        AND trade_events.close_day >= days.day
      GROUP BY days.day
    ),
    vault_tvl AS (
      SELECT days.day, COALESCE(SUM(users.vault_deposit_usd), 0) AS value
      FROM days
      LEFT JOIN users ON users.start_day <= days.day
      GROUP BY days.day
    )
    SELECT day, 'Trader Volume' AS segment, value FROM trader_tvl
    UNION ALL
    SELECT day, 'Vault TVL' AS segment, value FROM vault_tvl
    ORDER BY day ASC, segment ASC
  `);

export const activeUsersSeriesQuery = () =>
  queryRows<CampaignSeriesRow>(`
    SELECT point_days.day, COALESCE(COUNT(DISTINCT users.user_id), 0) AS value
    FROM point_days
    LEFT JOIN users ON users.start_day <= point_days.day
    GROUP BY point_days.day
    ORDER BY point_days.day ASC
  `);

export const totalPointsSeriesQuery = () =>
  queryRows<CampaignSeriesRow>(`
    SELECT day, cumulative_total_points AS value
    FROM point_days
    ORDER BY day ASC
  `);
