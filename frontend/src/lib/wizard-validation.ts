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
