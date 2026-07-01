import { useEffect, useRef, useState } from "react";
import type { ChartPreview } from "../lib/types";

// echarts se carga bajo demanda (igual que xlsx): solo hace falta cuando hay
// un resultado con gráficos y pesa demasiado para el bundle inicial.
type EChartsModule = typeof import("echarts");
let echartsPromise: Promise<EChartsModule> | null = null;
const loadECharts = () => {
  echartsPromise ??= import("echarts");
  return echartsPromise;
};

function BarChart({ chart, palette }: { chart: ChartPreview; palette: string[] }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let instance: ReturnType<EChartsModule["init"]> | null = null;
    let observer: ResizeObserver | null = null;

    loadECharts().then((echarts) => {
      if (disposed || !containerRef.current) return;
      instance = echarts.init(containerRef.current);
      instance.setOption({
        color: palette,
        title: {
          text: chart.title,
          left: "center",
          textStyle: { fontSize: 12, fontWeight: 600, color: "#6b7280" },
        },
        grid: { left: 8, right: 8, top: 36, bottom: 4, containLabel: true },
        tooltip: {
          trigger: "axis",
          valueFormatter: (v: unknown) => `${Number(v).toFixed(1)}%`,
        },
        xAxis: {
          type: "category",
          data: chart.categories,
          axisLabel: {
            fontSize: 10,
            color: "#9ca3af",
            interval: 0,
            width: 72,
            overflow: "truncate",
            rotate: chart.categories.length > 3 ? 24 : 0,
          },
          axisLine: { lineStyle: { color: "rgba(128,128,128,0.35)" } },
          axisTick: { show: false },
        },
        yAxis: {
          type: "value",
          axisLabel: { fontSize: 10, color: "#9ca3af", formatter: "{value}%" },
          splitLine: { lineStyle: { color: "rgba(128,128,128,0.15)" } },
        },
        series: [{
          type: "bar",
          data: chart.values.map((v) => Math.round(v * 1000) / 10),
          colorBy: palette.length > 1 ? "data" : "series",
          barMaxWidth: 46,
          itemStyle: { borderRadius: [3, 3, 0, 0] },
          label: {
            show: true,
            position: "top",
            fontSize: 10,
            color: "#6b7280",
            formatter: ({ value }: { value: unknown }) => `${Number(value).toFixed(1)}%`,
          },
        }],
      });
      observer = new ResizeObserver(() => instance?.resize());
      observer.observe(containerRef.current);
    });

    return () => {
      disposed = true;
      observer?.disconnect();
      instance?.dispose();
    };
  }, [chart, palette]);

  return <div ref={containerRef} className="h-56 w-full" />;
}

export function PreviewCharts({ charts, palette, maxCharts = 6 }: {
  charts: ChartPreview[];
  palette: string[];
  maxCharts?: number;
}) {
  const [showAll, setShowAll] = useState(false);
  if (charts.length === 0) return null;
  const visible = showAll ? charts : charts.slice(0, maxCharts);
  return (
    <div className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-2">
        {visible.map((chart, i) => (
          <div key={`${chart.title}-${i}`} className="rounded-md border border-border bg-background/60 p-2">
            <BarChart chart={chart} palette={palette} />
          </div>
        ))}
      </div>
      {charts.length > maxCharts && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="text-xs font-medium text-primary hover:underline"
        >
          {showAll ? "Mostrar menos" : `Ver los ${charts.length - maxCharts} gráficos restantes`}
        </button>
      )}
    </div>
  );
}
