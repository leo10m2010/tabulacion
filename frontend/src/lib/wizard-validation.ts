import { parseIntSafe, toStringList, toStringValue } from "./helpers";
import type { TabConfig, TemplateInfo } from "./types";

// Validación del asistente de tabulación.
//
// Estaba dentro de App.tsx (2.000 líneas), donde solo se podía probar
// renderizando la aplicación entera. Aquí es una función pura: config +
// límites del servidor -> lista de problemas.
//
// Importa que esté cubierta: un error aquí no rompe ninguna pantalla, deja
// pasar una configuración incoherente y produce un Excel con números
// equivocados. Nadie se entera hasta que lo revisa un asesor de tesis.
export function validarConfig(config: TabConfig, templateInfo: TemplateInfo | null): string[] {
  const issues: string[] = [];
  const quasi = toStringValue(config.diseno) === "cuasiexperimental";
  const hasV2 = !quasi && (parseIntSafe(config.variable) ?? 2) >= 2;
  const muestra = parseIntSafe(config.muestra);
  const item = parseIntSafe(config.item);
  const escala = parseIntSafe(config.escala);
  const respuesta = parseIntSafe(config.respuesta);

  if (quasi) {
    const nExp = parseIntSafe(config.nExperimental);
    const nCtrl = parseIntSafe(config.nControl);
    if (nExp === null || nExp < 2) issues.push("El grupo experimental debe tener 2 o más participantes.");
    if (nCtrl === null || nCtrl < 2) issues.push("El grupo control debe tener 2 o más participantes.");
    const efecto = toStringValue(config.efectoIntervencion).trim();
    if (efecto && !["nulo", "pequeno", "moderado", "grande"].includes(efecto)) {
      const n = Number(efecto);
      if (!Number.isFinite(n) || n < 0 || n > 3) {
        issues.push("El efecto personalizado debe ser un número entre 0 y 3 (ej: 1.5).");
      }
    }
  }

  if (muestra === null || muestra < 2) issues.push("La cantidad de personas debe ser 2 o más.");
  if (item === null || item <= 0) issues.push("Las preguntas de V1 deben ser mayor a 0.");
  if (hasV2) {
    const itemv2 = parseIntSafe(config.itemv2);
    if (itemv2 === null || itemv2 <= 0) issues.push("Las preguntas de V2 deben ser mayor a 0.");
  }

  // Límites que reporta el servidor (/template-info). Se validan aquí para no
  // hacer viajar una generación que el backend va a rechazar igualmente.
  if (templateInfo) {
    if (muestra !== null && muestra > templateInfo.maxMuestra) {
      issues.push(`El sistema soporta máximo ${templateInfo.maxMuestra} personas encuestadas (configuraste ${muestra}).`);
    }
    if (item !== null && item > templateInfo.maxItemsV1) {
      issues.push(`El sistema soporta máximo ${templateInfo.maxItemsV1} preguntas en la Variable 1 (configuraste ${item}).`);
    }
    if (hasV2) {
      const itemv2 = parseIntSafe(config.itemv2);
      if (itemv2 !== null && itemv2 > templateInfo.maxItemsV2) {
        issues.push(`El sistema soporta máximo ${templateInfo.maxItemsV2} preguntas en la Variable 2 (configuraste ${itemv2}).`);
      }
    }
  }

  if (escala === null || escala <= 0) issues.push("Los niveles del baremo (V1) deben ser mayor a 0.");
  if (hasV2) {
    const escala_v2 = parseIntSafe(config.escala_v2);
    if (escala_v2 === null || escala_v2 <= 0) issues.push("Los niveles del baremo (V2) deben ser mayor a 0.");
  }
  if (respuesta === null || respuesta <= 0) issues.push("La escala de respuesta debe ser mayor a 0.");

  const dimensions = toStringList(config.nombre_dimension).filter((v) => v.trim() !== "");
  if (!dimensions.length) issues.push("Debe existir al menos una dimensión.");

  const indicatorNames = toStringList(config.nombre_indicador).filter((v) => v.trim() !== "");
  const indicatorCounts = toStringList(config.numero_indicador0)
    .map((v) => Number.parseInt(v.trim(), 10))
    .filter((v) => Number.isFinite(v) && v >= 0);
  if (indicatorCounts.length > 0 && indicatorNames.length > 0) {
    const total = indicatorCounts.reduce((sum, v) => sum + v, 0);
    if (total !== indicatorNames.length) {
      issues.push("La suma de indicadores por dimensión no coincide con el total de indicadores.");
    }
  }

  // Presupuesto conjunto de complejidad.
  //
  // Los máximos por separado (arriba) no cambian: lo que puede no caber es la
  // COMBINACIÓN de muestra e ítems. Se avisa aquí, mientras el usuario sigue
  // en el formulario, para que no gaste un uso en una generación que el
  // backend va a rechazar igualmente. El backend es la autoridad final; esto
  // es solo el aviso temprano, y usa los mismos números que sirve /template-info.
  if (templateInfo?.presupuestoMaximo && muestra !== null && muestra > 0) {
    const extraPorVariable = templateInfo.itemsEquivalentesPorVariableExtra ?? 30;
    const itemsTotales = (item ?? 0) + (hasV2 ? (parseIntSafe(config.itemv2) ?? 0) : 0);
    const nVariables = hasV2 ? 2 : 1;
    if (itemsTotales > 0) {
      const costo = muestra * (itemsTotales + extraPorVariable * (nVariables - 1));
      if (costo > templateInfo.presupuestoMaximo) {
        const nMax = Math.floor(templateInfo.presupuestoMaximo / (itemsTotales + extraPorVariable * (nVariables - 1)));
        const itemsMax = Math.floor(templateInfo.presupuestoMaximo / muestra) - extraPorVariable * (nVariables - 1);
        const opciones: string[] = [];
        if (nMax >= 2 && nMax < muestra) opciones.push(`baja la muestra a ${nMax} o menos`);
        if (itemsMax >= 1 && itemsMax < itemsTotales) opciones.push(`baja el total de preguntas a ${itemsMax} o menos`);
        if (nVariables > 1) opciones.push("o genera cada variable en un archivo aparte");
        issues.push(
          `Esta combinación de ${muestra} personas y ${itemsTotales} preguntas no cabe en la memoria del `
          + `servidor. Para que quepa, ${opciones.join("; ")}. `
          + "Los límites por separado no cambian: la muestra admite hasta 2.000 y cada variable hasta 60 preguntas.",
        );
      }
    }
  }

  // Dimensiones e indicadores sin ítems.
  //
  // El backend los rechaza (antes producían un .xlsx que Excel marca como
  // dañado), pero llegar hasta allí significa haber gastado un uso y esperado
  // la generación. Aquí se avisa mientras el usuario sigue en el formulario,
  // que es donde puede arreglarlo.
  const revisarEstructura = (key: "estructura_v1" | "estructura_v2", etiqueta: string) => {
    const estructura = config[key];
    if (!Array.isArray(estructura)) return;
    estructura.forEach((dim, i) => {
      if (typeof dim !== "object" || dim === null) return;
      const d = dim as { nombre?: unknown; indicadores?: unknown };
      const nombre = typeof d.nombre === "string" && d.nombre.trim() ? d.nombre.trim() : `Dimensión ${i + 1}`;
      const indicadores = Array.isArray(d.indicadores) ? d.indicadores : [];
      const total = indicadores.reduce((acc: number, ind) => {
        const items = (ind as { items?: unknown })?.items;
        return acc + (typeof items === "number" && Number.isFinite(items) ? items : 0);
      }, 0);
      if (total <= 0) {
        issues.push(`${etiqueta}: la dimensión "${nombre}" no tiene ítems. Añade al menos uno o elimínala.`);
        return;
      }
      indicadores.forEach((ind, j) => {
        const o = ind as { nombre?: unknown; items?: unknown };
        const items = typeof o?.items === "number" ? o.items : 0;
        if (items <= 0) {
          const n = typeof o?.nombre === "string" && o.nombre.trim() ? o.nombre.trim() : `Indicador ${j + 1}`;
          issues.push(`${etiqueta}: el indicador "${n}" (dimensión "${nombre}") no tiene ítems.`);
        }
      });
    });
  };
  revisarEstructura("estructura_v1", "Variable 1");
  if (hasV2) revisarEstructura("estructura_v2", "Variable 2");

  const validatePorcentaje = (key: string, label: string) => {
    const vals = toStringList(config[key]).filter((v) => v.trim() !== "");
    const sum = vals.reduce((acc, v) => {
      const n = Number.parseInt(v.trim(), 10);
      return Number.isFinite(n) ? acc + n : acc;
    }, 0);
    if (vals.length > 0 && sum !== 100) {
      issues.push(`${label}: los porcentajes deben sumar exactamente 100% (actual: ${sum}%).`);
    }
  };

  // El diseño cuasiexperimental no reparte encuestados por baremo: la
  // distribución de puntajes la definen el efecto y la dirección elegidos.
  if (!quasi) {
    validatePorcentaje("porcentaje", "Baremo V1");
    if (hasV2) validatePorcentaje("porcentaje_v2", "Baremo V2");
  }

  return issues;
}
