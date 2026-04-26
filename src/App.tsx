import { useCallback, useEffect, useRef, useState } from "react";

import {
  activeUsersSeriesQuery,
  campaignStatsQuery,
  leaderboardQuery,
  loadSimulation,
  protocolTvlSeriesQuery,
  totalPointsSeriesQuery,
  tradingVolumeSeriesQuery,
  type CampaignStackedSeriesRow,
  type CampaignSeriesRow,
  type CampaignStatsRow
} from "./duckdb/client";
import { CampaignStatsPanel } from "./components/CampaignStatsPanel";
import { ParameterPanel } from "./components/ParameterPanel";
import { PointsPanel } from "./components/PointsPanel";
import { defaultParameters } from "./simulation/defaults";
import { simulate } from "./simulation/simulate";
import type { SimulationParameters, UserResultRow } from "./simulation/types";

type Tab = "leaderboard" | "stats" | "parameters";

const simulationSteps = [
  "Load simulation parameters",
  "Generate users, trades, and vault activity",
  "Save simulation results to database",
  "Query leaderboard and campaign stats",
  "Render campaign simulation output"
];

const waitForPaint = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });

export const App = () => {
  const [parameters, setParameters] = useState(defaultParameters);
  const [activeTab, setActiveTab] = useState<Tab>("leaderboard");
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [campaignStats, setCampaignStats] = useState<CampaignStatsRow | undefined>();
  const [tradingVolume, setTradingVolume] = useState<CampaignSeriesRow[]>([]);
  const [protocolTvl, setProtocolTvl] = useState<CampaignStackedSeriesRow[]>([]);
  const [activeUsers, setActiveUsers] = useState<CampaignSeriesRow[]>([]);
  const [totalPoints, setTotalPoints] = useState<CampaignSeriesRow[]>([]);
  const [leaderboard, setLeaderboard] = useState<UserResultRow[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | undefined>();
  const [simulationStepIndex, setSimulationStepIndex] = useState(0);
  const didRunInitialSimulation = useRef(false);

  const updateParameter = (key: keyof SimulationParameters, value: number) => {
    setParameters((current) => ({ ...current, [key]: value }));
  };

  const runSimulation = useCallback(async () => {
    setIsRunning(true);
    setError(undefined);
    setSimulationStepIndex(0);
    await waitForPaint();
    const startedAt = performance.now();
    console.info(`[sim] start users=${parameters.userCount} days=${parameters.tradingDays}`);

    try {
      setSimulationStepIndex(1);
      await waitForPaint();
      const output = simulate(parameters);
      setSimulationStepIndex(2);
      await waitForPaint();
      await loadSimulation(output);
      setSimulationStepIndex(3);
      await waitForPaint();
      const [rows, stats, tradingVolumeRows, protocolTvlRows, activeUserRows, totalPointRows] = await Promise.all([
        leaderboardQuery(),
        campaignStatsQuery(),
        tradingVolumeSeriesQuery(),
        protocolTvlSeriesQuery(),
        activeUsersSeriesQuery(),
        totalPointsSeriesQuery()
      ]);
      setLeaderboard(rows);
      setCampaignStats(stats);
      setTradingVolume(tradingVolumeRows);
      setProtocolTvl(protocolTvlRows);
      setActiveUsers(activeUserRows);
      setTotalPoints(totalPointRows);
      setSelectedUserId((current) => current ?? rows[0]?.user_id);
      setSimulationStepIndex(4);
      await waitForPaint();
      setActiveTab("leaderboard");
      console.info(`[sim] done total_ms=${(performance.now() - startedAt).toFixed(0)} rows=${rows.length}`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Simulation failed";
      setError(message);
      console.error(`[sim] error ${message}`);
    } finally {
      setIsRunning(false);
    }
  }, [parameters]);

  useEffect(() => {
    if (didRunInitialSimulation.current) return;
    didRunInitialSimulation.current = true;
    void runSimulation();
  }, [runSimulation]);

  const panel = () => {
    if (isRunning) {
      return (
        <section className="simulation-running">
          <strong>Simulation running</strong>
          <span>Simulating trades and vault activity...</span>
          <ol className="simulation-checklist">
            {simulationSteps.map((step, index) => (
              <li
                className={index < simulationStepIndex ? "is-complete" : index === simulationStepIndex ? "is-active" : ""}
                key={step}
              >
                <span>{index < simulationStepIndex ? "✓" : index === simulationStepIndex ? "•" : ""}</span>
                {step}
              </li>
            ))}
          </ol>
        </section>
      );
    }

    if (activeTab === "parameters") {
      return (
        <ParameterPanel
          parameters={parameters}
          isRunning={isRunning}
          onChange={updateParameter}
          onSimulate={runSimulation}
        />
      );
    }

    if (activeTab === "stats") {
      return (
        <CampaignStatsPanel
          metrics={campaignStats}
          tradingVolume={tradingVolume}
          protocolTvl={protocolTvl}
          activeUsers={activeUsers}
          totalPoints={totalPoints}
        />
      );
    }

    return (
      <PointsPanel
        rows={leaderboard}
        selectedUserId={selectedUserId}
        parameters={parameters}
        onSelectUser={setSelectedUserId}
      />
    );
  };

  return (
    <main>
      <nav className="top-nav">
        <div className="brand">
          <span className="brand-mark">HU</span>
          <div>
            <strong>HyperUnicorn</strong>
            <small>Points Campaign Simulator</small>
          </div>
        </div>
        <div className="tabs" role="tablist" aria-label="Simulator sections">
          <button className={activeTab === "leaderboard" ? "active" : ""} onClick={() => setActiveTab("leaderboard")}>
            Leaderboard
          </button>
          <button className={activeTab === "stats" ? "active" : ""} onClick={() => setActiveTab("stats")}>
            Campaign Stats
          </button>
          <button className={activeTab === "parameters" ? "active" : ""} onClick={() => setActiveTab("parameters")}>
            Campaign Parameters
          </button>
        </div>
      </nav>

      {error && <div className="error-banner">{error}</div>}
      {panel()}
    </main>
  );
};
