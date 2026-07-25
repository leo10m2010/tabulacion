import type { AppView, AuthUser, ConfigValue, DownloadLinks, TableCell, TableRows } from "./types";
import { DEFAULT_LEVEL_NAMES } from "./constants";

// ─── Utilities ───────────────────────────────────────────────────────────────
let _eid = 0;
export const eid = () => String(++_eid);

export function toStringValue(value: ConfigValue): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return String(value[0] ?? "");
  return String(value);
}

export function toStringList(value: ConfigValue): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? ""));
}

export function normalizeList(values: string[]): string[] {
  const cleaned = values.map((item) => item ?? "");
  while (cleaned.length > 0 && cleaned[cleaned.length - 1].trim() === "") {
    cleaned.pop();
  }
  return cleaned;
}

export function parseIntSafe(value: ConfigValue): number | null {
  const s = String(value ?? "").trim();
  if (!/^-?\d+$/.test(s)) return null;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

export function formatDateTime(dateIso: string | null | undefined): string {
  if (!dateIso) return "Sin fecha";
  const date = new Date(dateIso);
  if (Number.isNaN(date.getTime())) return "Fecha inválida";
  return date.toLocaleString();
}

// "hace 2 h" en vez de "25/7/2026, 3:13:31 p. m.".
//
// En una lista de proyectos lo que importa es cuál se tocó hace poco, no el
// segundo exacto. La fecha completa queda en el `title` para quien la necesite.
export function tiempoRelativo(dateIso: string | null | undefined): string {
  if (!dateIso) return "sin fecha";
  const fecha = new Date(dateIso);
  if (Number.isNaN(fecha.getTime())) return "fecha inválida";

  const segundos = Math.round((Date.now() - fecha.getTime()) / 1000);
  // Una fecha futura (relojes desfasados) no debe salir como "hace -3 min".
  if (segundos < 60) return "recién";
  const minutos = Math.round(segundos / 60);
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.round(horas / 24);
  if (dias === 1) return "ayer";
  if (dias < 30) return `hace ${dias} días`;
  return fecha.toLocaleDateString();
}

export function getSubscriptionLabel(user: AuthUser): string {
  if (user.role === "admin") return "Sin vencimiento";
  if (!user.subscriptionEndsAt) return "Sin fecha";
  const expiresAt = new Date(user.subscriptionEndsAt);
  if (Number.isNaN(expiresAt.getTime())) return "Fecha inválida";
  if (expiresAt.getTime() < Date.now()) return `Vencida: ${expiresAt.toLocaleString()}`;
  return `Vence: ${expiresAt.toLocaleString()}`;
}

export function revokeDownloadLinks(links: DownloadLinks | null) {
  if (!links) return;
  URL.revokeObjectURL(links.json);
  URL.revokeObjectURL(links.csv);
  URL.revokeObjectURL(links.xlsx);
}

export function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i += 1) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// xlsx se carga bajo demanda: solo hace falta para la vista previa del
// resultado y pesa ~400 kB, no debe ir en el bundle inicial.
export async function csvToRows(csvText: string): Promise<TableRows> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(csvText, { type: "string" });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) return [];
  return XLSX.utils.sheet_to_json<TableCell[]>(workbook.Sheets[firstSheet], {
    header: 1,
    raw: false,
    defval: "",
  });
}

export async function workbookToSheetRows(arrayBuffer: Uint8Array): Promise<{ names: string[]; data: Record<string, TableRows> }> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(arrayBuffer, { type: "array" });
  const data: Record<string, TableRows> = {};
  workbook.SheetNames.forEach((name) => {
    data[name] = XLSX.utils.sheet_to_json<TableCell[]>(workbook.Sheets[name], {
      header: 1,
      raw: false,
      defval: "",
    });
  });
  return { names: workbook.SheetNames, data };
}


export function defaultLevelName(index: number, total: number): string {
  return DEFAULT_LEVEL_NAMES[total]?.[index] ?? `Nivel ${index + 1}`;
}

export function calcBaremoRange(items: string, respuesta: string): string {
  const n = parseInt(items, 10);
  const r = parseInt(respuesta, 10);
  if (!Number.isFinite(n) || !Number.isFinite(r) || n <= 0 || r <= 0) return "";
  return `Rango sugerido: ${n} (mínimo) a ${n * r} (máximo)`;
}

export function correlationInfo(r: number): { label: string; colorClass: string; explanation: string } {
  const abs = Math.abs(r);
  if (abs >= 0.8) return { label: "Muy alta", colorClass: "text-green-600 dark:text-green-400", explanation: "Relación muy fuerte entre las variables." };
  if (abs >= 0.6) return { label: "Alta", colorClass: "text-green-500 dark:text-green-300", explanation: "Relación fuerte entre las variables." };
  if (abs >= 0.4) return { label: "Moderada", colorClass: "text-yellow-600 dark:text-yellow-400", explanation: "Relación moderada entre las variables." };
  if (abs >= 0.2) return { label: "Baja", colorClass: "text-orange-500", explanation: "Relación débil entre las variables." };
  return { label: "Muy baja", colorClass: "text-red-500", explanation: "Relación muy débil o casi nula entre las variables." };
}

export function resolveViewFromPath(): AppView {
  return window.location.pathname.startsWith("/app") ? "app" : "landing";
}

export function calcBaremoIntervalos(preguntas: number, respuesta: number, niveles: number): { desde: string[]; hasta: string[] } {
  const pMin = preguntas;
  const pMax = preguntas * respuesta;
  const amplitud = Math.max(1, Math.ceil((pMax - pMin) / niveles));
  const desde: string[] = [];
  const hasta: string[] = [];
  for (let i = 0; i < niveles; i++) {
    const d = pMin + i * amplitud;
    desde[i] = String(d);
    hasta[i] = String(i === niveles - 1 ? pMax : d + amplitud - 1);
  }
  return { desde, hasta };
}

