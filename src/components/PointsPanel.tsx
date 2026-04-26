import { useMemo, useState } from "react";
import type { VisualizationSpec } from "vega-embed";

import type { SimulationParameters, UserResultRow } from "../simulation/types";
import { VegaLiteChart } from "./VegaLiteChart";

type Props = {
  rows: UserResultRow[];
  selectedUserId?: string;
  parameters: SimulationParameters;
  onSelectUser: (userId: string) => void;
};

type SortDirection = "asc" | "desc";

type SortColumn = {
  key: keyof UserResultRow;
  label: string;
  align: "left" | "right";
};

const sortColumns: SortColumn[] = [
  { key: "rank", label: "Rank", align: "left" },
  { key: "user_id", label: "User", align: "left" },
  { key: "user_type", label: "Type", align: "left" },
  { key: "direct_points", label: "Trading points", align: "right" },
  { key: "vault_points", label: "Vault points", align: "right" },
  { key: "total_points", label: "Total points", align: "right" },
  { key: "cumulative_pnl_usd", label: "Cumulative P&L", align: "right" },
  { key: "effective_direct_volume_usd", label: "Volume", align: "right" },
  { key: "vault_tvl_days", label: "Vault TVL days", align: "right" },
  { key: "avg_abs_pnl_pct", label: "Avg abs P&L", align: "right" }
];

const pageSize = 10;

const usd = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 1000 ? 0 : 2
  }).format(value);

const number = (value: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: value >= 1000 ? 0 : 2 }).format(value);

const pct = (value: number) => `${number(value)}%`;
const signedPct = (value: number) => `${value > 0 ? "+" : ""}${pct(value)}`;

const pnlClassName = (value: number) => (value > 0 ? "positive" : value < 0 ? "negative" : "neutral");

const userReturnPct = (row: UserResultRow) =>
  row.starting_bankroll_usd <= 0 ? 0 : (row.cumulative_pnl_usd / row.starting_bankroll_usd) * 100;

const vaultStreakDays = (row: UserResultRow) =>
  row.vault_deposit_usd <= 0 ? 0 : row.vault_tvl_days / row.vault_deposit_usd;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const riskMultiplier = (absPnlPct: number, parameters: SimulationParameters) => {
  const scaled = clamp(
    (absPnlPct - parameters.pnlRiskBasePct) / Math.max(0.0001, parameters.pnlRiskFullBonusPct - parameters.pnlRiskBasePct),
    0,
    1
  );
  return 1 + (parameters.maxRiskMultiplier - 1) * scaled ** 1.35;
};

const pointFormulaInputs = (row: UserResultRow, parameters: SimulationParameters) => [
  ["TP", "Total points", number(row.total_points)],
  ["TR", "Trading points", number(row.direct_points)],
  ["VP", "Vault points", number(row.vault_points)],
  ["N_t", "Raw direct trade notional", usd(row.direct_volume_usd)],
  ["M_t", "Typical risk multiplier from avg abs P&L", `${number(riskMultiplier(row.avg_abs_pnl_pct, parameters))}x`],
  ["wash_w", "Wash-like volume share", "Calculated per user-week"],
  ["W", "Wash-like opposite-side volume discount", pct(parameters.washTradeDiscountPct)],
  ["r_w", "Weekly trader streak reward", pct(parameters.traderWeeklyStreakRewardRatePct)],
  ["S_w", "Max weekly trading streak", number(row.max_weekly_activity_streak)],
  ["D", "Vault deposit", usd(row.vault_deposit_usd)],
  ["r_d", "Daily vault streak reward", pct(parameters.vaultStreakRewardRatePct)],
  ["S_d", "Vault deposit streak days", number(vaultStreakDays(row))]
];

const pointFormulaConstraints = (parameters: SimulationParameters) => [
  ["R_base", "Risk bonus starts at abs P&L", pct(parameters.pnlRiskBasePct)],
  ["R_full", "Full risk bonus starts at abs P&L", pct(parameters.pnlRiskFullBonusPct)],
  ["M_max", "Maximum risk multiplier", `${number(parameters.maxRiskMultiplier)}x`]
];

const defaultDirection = (key: keyof UserResultRow): SortDirection =>
  key === "rank" || key === "user_id" || key === "user_type" ? "asc" : "desc";

const compareValues = (left: string | number, right: string | number) =>
  typeof left === "string" && typeof right === "string" ? left.localeCompare(right) : Number(left) - Number(right);

const sortedRows = (rows: UserResultRow[], key: keyof UserResultRow, direction: SortDirection) =>
  [...rows].sort((left, right) => {
    const comparison = compareValues(left[key] as string | number, right[key] as string | number);
    return direction === "asc" ? comparison : -comparison;
  });

const pageForUser = (rows: UserResultRow[], userId?: string) => {
  const selectedIndex = userId ? rows.findIndex((row) => row.user_id === userId) : -1;
  return selectedIndex >= 0 ? Math.floor(selectedIndex / pageSize) + 1 : undefined;
};

const logBucketStep = 0.5;

const pointBucket = (points: number) => {
  const bucketIndex = Math.floor(Math.log10(points + 1) / logBucketStep);
  const bucketStartLog = bucketIndex * logBucketStep;
  const bucketEndLog = (bucketIndex + 1) * logBucketStep;
  const start = Math.max(0, 10 ** (bucketIndex * logBucketStep) - 1);
  const end = 10 ** ((bucketIndex + 1) * logBucketStep) - 1;
  return {
    bucketIndex,
    bucketStartLog,
    bucketEndLog,
    bucketLabel: `${number(start)}-${number(end)}`,
    bucketStart: start,
    bucketEnd: end
  };
};

const chartBuckets = (rows: UserResultRow[]) => {
  const buckets = rows.reduce<Map<number, ReturnType<typeof pointBucket> & { users: number }>>((bucketMap, row) => {
    const bucket = pointBucket(row.total_points);
    const current = bucketMap.get(bucket.bucketIndex);
    bucketMap.set(bucket.bucketIndex, { ...bucket, users: (current?.users ?? 0) + 1 });
    return bucketMap;
  }, new Map());

  return [...buckets.values()].sort((left, right) => left.bucketIndex - right.bucketIndex);
};

const chartSpec = (rows: UserResultRow[], selected?: UserResultRow): VisualizationSpec => {
  const buckets = chartBuckets(rows);
  const selectedBucket = selected ? pointBucket(selected.total_points) : undefined;
  const selectedBucketUsers = selectedBucket
    ? (buckets.find((bucket) => bucket.bucketIndex === selectedBucket.bucketIndex)?.users ?? 0)
    : 0;

  return {
    $schema: "https://vega.github.io/schema/vega-lite/v6.json",
    background: "transparent",
    width: "container",
    height: 260,
    layer: [
      {
        data: { values: buckets },
        mark: { type: "bar", color: "#2dd4bf", opacity: 0.72, cornerRadiusTopLeft: 2, cornerRadiusTopRight: 2 },
        encoding: {
          x: {
            field: "bucketStartLog",
            type: "quantitative",
            axis: {
              gridColor: "#25304a",
              labelColor: "#a8b3cf",
              labelExpr: "format(pow(10, datum.value) - 1, ',.0f')",
              title: "Total Points Accumulated",
              titleColor: "#d8e1ff"
            }
          },
          x2: { field: "bucketEndLog" },
          y: {
            field: "users",
            type: "quantitative",
            axis: { labelColor: "#a8b3cf", titleColor: "#d8e1ff", gridColor: "#25304a", title: "# of Users" }
          },
          y2: { datum: 0 },
          tooltip: [
            { field: "bucketLabel", type: "nominal", title: "Points bucket" },
            { field: "users", type: "quantitative", title: "Users" }
          ]
        }
      },
      {
        data: {
          values:
            selected && selectedBucket
              ? [
                  {
                    logPoints: Math.log10(selected.total_points + 1),
                    points: selected.total_points,
                    userId: selected.user_id,
                    users: selectedBucketUsers
                  }
                ]
              : []
        },
        mark: { type: "point", shape: "triangle-down", filled: true, size: 180, color: "#f59e0b", yOffset: -9 },
        encoding: {
          x: { field: "logPoints", type: "quantitative" },
          y: { field: "users", type: "quantitative" },
          tooltip: [
            { field: "userId", type: "nominal", title: "Selected user" },
            { field: "points", type: "quantitative", title: "Total points", format: "," }
          ]
        }
      }
    ],
    config: {
      view: { stroke: "transparent" },
      font: "Inter, system-ui, sans-serif"
    }
  };
};

export const PointsPanel = ({ rows, selectedUserId, parameters, onSelectUser }: Props) => {
  const [sortKey, setSortKey] = useState<keyof UserResultRow>("rank");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [page, setPage] = useState(1);
  const [pageTargetUserId, setPageTargetUserId] = useState<string | undefined>();
  const [showFormula, setShowFormula] = useState(false);
  const selected = rows.find((row) => row.user_id === selectedUserId) ?? rows[0];
  const spec = useMemo(() => chartSpec(rows, selected), [rows, selected]);
  const leaderboardRows = useMemo(() => sortedRows(rows, sortKey, sortDirection), [rows, sortDirection, sortKey]);
  const pageCount = Math.max(1, Math.ceil(leaderboardRows.length / pageSize));
  const targetedPage = pageForUser(leaderboardRows, pageTargetUserId);
  const currentPage = Math.min(targetedPage ?? page, pageCount);
  const pageStart = (currentPage - 1) * pageSize;
  const pageRows = leaderboardRows.slice(pageStart, pageStart + pageSize);
  const pageEnd = Math.min(pageStart + pageSize, leaderboardRows.length);

  const updateSort = (key: keyof UserResultRow) => {
    const direction = sortKey === key ? (sortDirection === "asc" ? "desc" : "asc") : defaultDirection(key);
    setSortKey(key);
    setSortDirection(direction);
    setPage(1);
    setPageTargetUserId(undefined);
  };

  const shuffleRandomUser = () => {
    if (leaderboardRows.length === 0) return;

    const selectedIndex = Math.floor(Math.random() * leaderboardRows.length);
    const userId = leaderboardRows[selectedIndex]?.user_id;
    if (!userId) return;

    onSelectUser(userId);
    setPageTargetUserId(userId);
  };

  const updatePage = (nextPage: number) => {
    setPage(nextPage);
    setPageTargetUserId(undefined);
  };

  const selectUser = (userId: string) => {
    onSelectUser(userId);
    setPageTargetUserId(undefined);
  };

  return (
    <section className="points-screen">
      {selected && (
        <section className="selected-user-section">
          <div className="compact-section-heading">
            <h2>Selected User Totals</h2>
            <button className="secondary-action" onClick={shuffleRandomUser} disabled={rows.length === 0}>
              Shuffle Random User
            </button>
          </div>
          <div className="selected-user">
            <div>
              <span className="rank-chip">#{selected.rank}</span>
              <h2>{selected.user_id}</h2>
              <p>
                {selected.user_type} · {pct(selected.percentile)} percentile · {selected.stopped_out ? "stopped out" : "active"}
              </p>
            </div>
            <dl>
              <div>
                <dt>Rank</dt>
                <dd>#{selected.rank}</dd>
              </div>
              <div>
                <dt>Percentile</dt>
                <dd>{pct(selected.percentile)}</dd>
              </div>
              <div>
                <dt>Trading points</dt>
                <dd>{number(selected.direct_points)}</dd>
              </div>
              <div>
                <dt>Vault points</dt>
                <dd>{number(selected.vault_points)}</dd>
              </div>
              <div>
                <dt>Total points</dt>
                <dd>{number(selected.total_points)}</dd>
              </div>
              <div>
                <dt>Cumulative P&L</dt>
                <dd>
                  <span className={`pnl-value ${pnlClassName(selected.cumulative_pnl_usd)}`}>
                    {usd(selected.cumulative_pnl_usd)}
                  </span>
                  <span className={`pnl-return ${pnlClassName(userReturnPct(selected))}`}>
                    {signedPct(userReturnPct(selected))}
                  </span>
                </dd>
              </div>
              <div>
                <dt>Avg abs P&L</dt>
                <dd>{pct(selected.avg_abs_pnl_pct)}</dd>
              </div>
              <div>
                <dt>Weekly streak</dt>
                <dd>{number(selected.max_weekly_activity_streak)}</dd>
              </div>
              <div>
                <dt>Effective volume</dt>
                <dd>{usd(selected.effective_direct_volume_usd)}</dd>
              </div>
            </dl>
            <div className="formula-toggle-panel">
              <button className="secondary-action" type="button" aria-expanded={showFormula} onClick={() => setShowFormula(!showFormula)}>
                {showFormula ? "Hide Points Formula" : "Show Points Formula"}
              </button>
              {showFormula && (
                <article className="points-formula-card">
                  <div>
                    <h3>Selected User Points Formula</h3>
                    <p>
                      The simulation calculates trading points by week and vault points by full deposit day, then adds them
                      together for the selected user's total.
                    </p>
                  </div>
                  <div className="formula-stack" aria-label="Selected user points formulas">
                    <div className="formula-line">
                      <span>TP</span>
                      <strong>=</strong>
                      <span>TR + VP</span>
                    </div>
                    <div className="formula-line">
                      <span>TR</span>
                      <strong>=</strong>
                      <span>sum_week((sum_trade(N_t * M_t) * (1 - wash_w * W)) * (1 + r_w)^S_w)</span>
                    </div>
                    <div className="formula-line">
                      <span>VP</span>
                      <strong>=</strong>
                      <span>sum_day(D * (1 + r_d)^S_d)</span>
                    </div>
                  </div>
                  <div className="formula-input-grid">
                    {pointFormulaInputs(selected, parameters).map(([symbol, label, value]) => (
                      <div key={symbol}>
                        <span>{symbol}</span>
                        <strong>{value}</strong>
                        <small>{label}</small>
                      </div>
                    ))}
                  </div>
                  <div className="formula-constraint-section">
                    <h4>Variable Constraints</h4>
                    <div className="formula-input-grid compact">
                      {pointFormulaConstraints(parameters).map(([symbol, label, value]) => (
                        <div key={symbol}>
                          <span>{symbol}</span>
                          <strong>{value}</strong>
                          <small>{label}</small>
                        </div>
                      ))}
                    </div>
                  </div>
                </article>
              )}
            </div>
          </div>
        </section>
      )}

      <article className="distribution-panel">
        <div className="panel-title-row">
          <h2>Points Distribution</h2>
        </div>
        {rows.length > 0 ? <VegaLiteChart spec={spec} /> : <div className="chart empty-chart">Run a simulation to render the distribution.</div>}
      </article>

      <article className="leaderboard-panel">
        <div className="panel-title-row">
          <h2>Leaderboard</h2>
          <div className="pagination-controls">
            <span>
              Rows {leaderboardRows.length === 0 ? "0" : `${pageStart + 1}-${pageEnd}`} of {leaderboardRows.length}
            </span>
            <button disabled={currentPage === 1} type="button" onClick={() => updatePage(Math.max(1, currentPage - 1))}>
              Previous
            </button>
            <button disabled={currentPage === pageCount} type="button" onClick={() => updatePage(Math.min(pageCount, currentPage + 1))}>
              Next
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {sortColumns.map((column) => (
                  <th
                    aria-sort={sortKey === column.key ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
                    className={column.align === "left" ? "align-left" : undefined}
                    key={column.key}
                  >
                    <button
                      className="sort-button"
                      type="button"
                      onClick={() => updateSort(column.key)}
                    >
                      <span>{column.label}</span>
                      <span className="sort-indicator">{sortKey === column.key ? (sortDirection === "asc" ? "↑" : "↓") : ""}</span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row) => (
                <tr
                  className={row.user_id === selected?.user_id ? "is-selected" : ""}
                  key={row.user_id}
                  onClick={() => selectUser(row.user_id)}
                >
                  <td>#{row.rank}</td>
                  <td>{row.user_id}</td>
                  <td>{row.user_type}</td>
                  <td>{number(row.direct_points)}</td>
                  <td>{number(row.vault_points)}</td>
                  <td>{number(row.total_points)}</td>
                  <td>
                    <span className={`pnl-value ${pnlClassName(row.cumulative_pnl_usd)}`}>
                      {usd(row.cumulative_pnl_usd)}
                    </span>
                    <span className={`pnl-return ${pnlClassName(userReturnPct(row))}`}>
                      {signedPct(userReturnPct(row))}
                    </span>
                  </td>
                  <td>{usd(row.effective_direct_volume_usd)}</td>
                  <td>{usd(row.vault_tvl_days)}</td>
                  <td>{pct(row.avg_abs_pnl_pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
};
