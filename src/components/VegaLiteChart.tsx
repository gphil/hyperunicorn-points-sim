import embed, { type VisualizationSpec } from "vega-embed";
import { useEffect, useRef } from "react";

type Props = {
  spec: VisualizationSpec;
};

export const VegaLiteChart = ({ spec }: Props) => {
  const chartRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let finalized = false;
    let cleanup: (() => void) | undefined;

    if (chartRef.current) {
      embed(chartRef.current, spec, { actions: false, renderer: "canvas", tooltip: { theme: "dark" } }).then((result) => {
        if (finalized) {
          result.finalize();
          return;
        }
        cleanup = result.finalize;
      });
    }

    return () => {
      finalized = true;
      cleanup?.();
    };
  }, [spec]);

  return <div className="chart" ref={chartRef} />;
};
