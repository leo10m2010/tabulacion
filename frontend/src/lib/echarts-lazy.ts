// Módulo intermedio para poder a la vez CARGAR echarts bajo demanda (con un
// único import() dinámico desde PreviewCharts.tsx) y RECORTARLO a las piezas
// que en verdad se usan (barras + título/tooltip/grid + renderer canvas).
//
// Los imports de aquí abajo son estáticos a propósito: si en PreviewCharts.tsx
// se hiciera `import("echarts/charts").then(m => m.BarChart)`, Rollup no puede
// saber en tiempo de build qué exportación se lee de un módulo resuelto en
// tiempo de ejecución y empaqueta "charts.js"/"components.js" completos (line,
// pie, radar, sankey, dataZoom, toolbox...) igual que si se hubiera importado
// el paquete "echarts" entero. Con los imports estáticos de este archivo sí
// puede eliminar el resto; el chunk async al que apunta el import() en
// PreviewCharts.tsx sigue siendo uno solo, así que la carga perezosa no cambia.
import * as echarts from "echarts/core";
import { BarChart } from "echarts/charts";
import { GridComponent, TitleComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([BarChart, GridComponent, TitleComponent, TooltipComponent, CanvasRenderer]);

export default echarts;
