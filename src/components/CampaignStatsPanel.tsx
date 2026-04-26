import { useMemo } from "react";
import type { VisualizationSpec } from "vega-embed";

import type { CampaignSeriesRow, CampaignStackedSeriesRow, CampaignStatsRow } from "../duckdb/client";
import { VegaLiteChart } from "./VegaLiteChart";

type Props = {
  metrics?: CampaignStatsRow;
  tradingVolume: CampaignSeriesRow[];
  protocolTvl: CampaignStackedSeriesRow[];
  activeUsers: CampaignSeriesRow[];
  totalPoints: CampaignSeriesRow[];
};

const safeNumber = (value: number) => (Number.isFinite(value) ? value : 0);

const usd = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: safeNumber(value) >= 1000 ? 0 : 2
  }).format(safeNumber(value));

const number = (value: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: safeNumber(value) >= 1000 ? 0 : 2 }).format(safeNumber(value));

const metricCards = (metrics?: CampaignStatsRow) => [
  ["Trading Points", metrics ? number(metrics.trading_points) : "—"],
  ["Vault Points", metrics ? number(metrics.vault_points) : "—"],
  ["Total Points", metrics ? number(metrics.total_points) : "—"],
  ["Total Volume", metrics ? usd(metrics.total_volume_usd) : "—"],
  ["Ending Vault TVL", metrics ? usd(metrics.ending_vault_tvl_usd) : "—"],
  ["Total Trader P&L", metrics ? usd(metrics.total_trader_pnl_usd) : "—"],
  ["Vault P&L", metrics ? usd(metrics.vault_pnl_usd) : "—"]
];

const chartSpec = (values: CampaignSeriesRow[], title: string, yTitle: string, format?: string): VisualizationSpec => ({
  $schema: "https://vega.github.io/schema/vega-lite/v6.json",
  background: "transparent",
  data: { values },
  width: "container",
  height: 240,
  mark: { type: "area", line: { color: "#5eead4" }, color: "#2dd4bf", opacity: 0.32 },
  encoding: {
    x: {
      field: "day",
      type: "quantitative",
      axis: { gridColor: "#25304a", labelColor: "#a8b3cf", title: "Day", titleColor: "#d8e1ff" }
    },
    y: {
      field: "value",
      type: "quantitative",
      axis: { gridColor: "#25304a", labelColor: "#a8b3cf", title: yTitle, titleColor: "#d8e1ff", format }
    },
    tooltip: [
      { field: "day", type: "quantitative", title: "Day" },
      { field: "value", type: "quantitative", title: yTitle, format }
    ]
  },
  title: { text: title, color: "#e5edf9", anchor: "start", fontSize: 16, offset: 12 },
  config: {
    view: { stroke: "transparent" },
    font: "Inter, system-ui, sans-serif"
  }
});

const stackedChartSpec = (values: CampaignStackedSeriesRow[]): VisualizationSpec => ({
  $schema: "https://vega.github.io/schema/vega-lite/v6.json",
  background: "transparent",
  data: { values },
  width: "container",
  height: 240,
  mark: { type: "area", opacity: 0.82 },
  encoding: {
    x: {
      field: "day",
      type: "quantitative",
      axis: { gridColor: "#25304a", labelColor: "#a8b3cf", title: "Day", titleColor: "#d8e1ff" }
    },
    y: {
      field: "value",
      type: "quantitative",
      stack: "zero",
      axis: { gridColor: "#25304a", labelColor: "#a8b3cf", title: "Protocol TVL", titleColor: "#d8e1ff", format: "$,.2s" }
    },
    color: {
      field: "segment",
      type: "nominal",
      scale: { domain: ["Trader Volume", "Vault TVL"], range: ["#5eead4", "#f59e0b"] },
      legend: { labelColor: "#a8b3cf", titleColor: "#d8e1ff", orient: "top" }
    },
    tooltip: [
      { field: "day", type: "quantitative", title: "Day" },
      { field: "segment", type: "nominal", title: "Segment" },
      { field: "value", type: "quantitative", title: "TVL", format: "$,.2s" }
    ]
  },
  title: { text: "Protocol Activity Over Time", color: "#e5edf9", anchor: "start", fontSize: 16, offset: 12 },
  config: {
    view: { stroke: "transparent" },
    font: "Inter, system-ui, sans-serif"
  }
});

const ChartPanel = ({ title, spec, values }: { title: string; spec: VisualizationSpec; values: CampaignSeriesRow[] }) => (
  <article className="stats-chart-panel">
    {values.length > 0 ? <VegaLiteChart spec={spec} /> : <div className="chart empty-chart">Run a simulation to render {title}.</div>}
  </article>
);

const StackedChartPanel = ({ spec, values }: { spec: VisualizationSpec; values: CampaignStackedSeriesRow[] }) => (
  <article className="stats-chart-panel">
    {values.length > 0 ? <VegaLiteChart spec={spec} /> : <div className="chart empty-chart">Run a simulation to render protocol TVL over time.</div>}
  </article>
);

export const CampaignStatsPanel = ({ metrics, tradingVolume, protocolTvl, activeUsers, totalPoints }: Props) => {
  const cards = metricCards(metrics);
  const tradingVolumeSpec = useMemo(
    () => chartSpec(tradingVolume, "Cumulative Trading Volume Over Time", "Cumulative Volume", "$,.2s"),
    [tradingVolume]
  );
  const protocolTvlSpec = useMemo(() => stackedChartSpec(protocolTvl), [protocolTvl]);
  const activeUsersSpec = useMemo(() => chartSpec(activeUsers, "Active Users Over Time", "Active Users", ",.0f"), [activeUsers]);
  const totalPointsSpec = useMemo(() => chartSpec(totalPoints, "Total Points Over Time", "Total Points", ",.2s"), [totalPoints]);

  return (
    <section className="campaign-stats-screen">
      <div className="metric-grid">
        {cards.map(([label, value]) => (
          <article className="metric-card" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </div>

      <div className="stats-chart-grid">
        <ChartPanel title="cumulative trading volume over time" spec={tradingVolumeSpec} values={tradingVolume} />
        <StackedChartPanel spec={protocolTvlSpec} values={protocolTvl} />
        <ChartPanel title="active users over time" spec={activeUsersSpec} values={activeUsers} />
        <ChartPanel title="total points over time" spec={totalPointsSpec} values={totalPoints} />
      </div>
    </section>
  );
};
