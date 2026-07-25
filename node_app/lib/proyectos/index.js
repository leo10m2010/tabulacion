// Proyecto de tesis: el objeto que faltaba.
//
// El problema que resuelve (recomendacion #1 de la auditoria UX): hoy el
// instrumento —variables, dimensiones, indicadores, items y escala— se
// re-escribe DESDE CERO en cada herramienta. Quien usa Tabulacion y luego
// Confiabilidad teclea lo mismo dos veces, y si el jurado observa algo tiene
// que reconstruirlo entero.
//
// Aqui el instrumento se define UNA vez, vive en el proyecto, y las
// herramientas lo leen.
import crypto from "crypto";

export const MAX_NOMBRE = 120;
export const MAX_VARIABLES = 2;
export const MAX_DIMENSIONES = 20;
export const MAX_INDICADORES = 30;
export const MAX_ITEMS_POR_VARIABLE = 60;
export const MAX_OPCIONES_ESCALA = 10;

// Cuantos proyectos puede tener a la vez cada plan. No es por espacio (un
// proyecto completo ronda 0,4 MB y en R2 caben decenas de miles), sino para
// que nadie lo use como disco duro.
export const PROYECTOS_POR_PLAN = {
  free: 1,
  esencial: 3,
  tesista: 10,
  institucion: 10,
  enterprise: 100,
};

const limpiar = (v, max) => String(v ?? "").trim().slice(0, max);

class ProyectoError extends Error {}
export const esErrorDeUsuario = (err) => err instanceof ProyectoError;
const fallar = (msg) => { throw new ProyectoError(msg); };

// ── Instrumento ─────────────────────────────────────────────────────────────
// Se normaliza y valida en el servidor: es la fuente de la que van a beber
// todas las herramientas, asi que no puede entrar deformado.
export const normalizarInstrumento = (raw) => {
  const entrada = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};

  // Escala de respuesta (comun a todo el instrumento).
  const opciones = Array.isArray(entrada.escala) ? entrada.escala : [];
  const escala = opciones
    .map((o, i) => limpiar(typeof o === "string" ? o : o?.etiqueta, 80) || `Opción ${i + 1}`)
    .slice(0, MAX_OPCIONES_ESCALA);
  if (escala.length === 1) fallar("La escala de respuesta necesita al menos 2 opciones.");

  const variablesRaw = Array.isArray(entrada.variables) ? entrada.variables : [];
  if (variablesRaw.length > MAX_VARIABLES) {
    fallar(`Un instrumento admite como máximo ${MAX_VARIABLES} variables.`);
  }

  const variables = variablesRaw.map((v, vi) => {
    const nombre = limpiar(v?.nombre, MAX_NOMBRE) || `Variable ${vi + 1}`;
    const dimsRaw = Array.isArray(v?.dimensiones) ? v.dimensiones : [];
    if (dimsRaw.length > MAX_DIMENSIONES) {
      fallar(`"${nombre}" supera el máximo de ${MAX_DIMENSIONES} dimensiones.`);
    }

    let totalItems = 0;
    const dimensiones = dimsRaw.map((d, di) => {
      const dNombre = limpiar(d?.nombre, MAX_NOMBRE) || `Dimensión ${di + 1}`;
      const indsRaw = Array.isArray(d?.indicadores) ? d.indicadores : [];
      if (indsRaw.length > MAX_INDICADORES) {
        fallar(`"${dNombre}" supera el máximo de ${MAX_INDICADORES} indicadores.`);
      }
      const indicadores = indsRaw.map((ind, ii) => {
        const items = (Array.isArray(ind?.items) ? ind.items : [])
          .map((it, ti) => limpiar(typeof it === "string" ? it : it?.nombre, 300) || `Ítem ${ti + 1}`);
        totalItems += items.length;
        return { nombre: limpiar(ind?.nombre, MAX_NOMBRE) || `Indicador ${ii + 1}`, items };
      });
      return { nombre: dNombre, indicadores };
    });

    if (totalItems > MAX_ITEMS_POR_VARIABLE) {
      fallar(`"${nombre}" tiene ${totalItems} ítems; el máximo es ${MAX_ITEMS_POR_VARIABLE}.`);
    }

    // Baremo: niveles con su rango y el porcentaje de personas que debe caer
    // en cada uno. El porcentaje NO es decorativo: la simulacion lo respeta
    // (ver lib/stats.js), asi que se valida que sume 100.
    const nivelesRaw = Array.isArray(v?.baremo) ? v.baremo : [];
    const baremo = nivelesRaw.map((n, ni) => ({
      nombre: limpiar(n?.nombre, 60) || `Nivel ${ni + 1}`,
      desde: Number(n?.desde),
      hasta: Number(n?.hasta),
      porcentaje: Number(n?.porcentaje),
    }));
    if (baremo.length > 0) {
      if (baremo.some((n) => !Number.isFinite(n.desde) || !Number.isFinite(n.hasta))) {
        fallar(`El baremo de "${nombre}" tiene rangos incompletos.`);
      }
      const suma = baremo.reduce((a, n) => a + (Number.isFinite(n.porcentaje) ? n.porcentaje : 0), 0);
      if (Math.round(suma) !== 100) {
        fallar(`Los porcentajes del baremo de "${nombre}" deben sumar 100% (suman ${Math.round(suma)}%).`);
      }
    }

    return { nombre, dimensiones, baremo, totalItems };
  });

  return { escala, variables };
};

export const crearProyecto = ({ userId, nombre, instrumento }) => {
  const nombreLimpio = limpiar(nombre, MAX_NOMBRE);
  if (!nombreLimpio) fallar("Ponle un nombre a tu proyecto.");
  const ahora = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    userId,
    nombre: nombreLimpio,
    instrumento: normalizarInstrumento(instrumento),
    createdAt: ahora,
    updatedAt: ahora,
  };
};

export const aplicarCambios = (proyecto, cambios) => {
  const siguiente = { ...proyecto };
  if (cambios?.nombre !== undefined) {
    const nombreLimpio = limpiar(cambios.nombre, MAX_NOMBRE);
    if (!nombreLimpio) fallar("El nombre del proyecto no puede quedar vacío.");
    siguiente.nombre = nombreLimpio;
  }
  if (cambios?.instrumento !== undefined) {
    siguiente.instrumento = normalizarInstrumento(cambios.instrumento);
  }
  siguiente.updatedAt = new Date().toISOString();
  return siguiente;
};

export const limiteDelPlan = (plan) => PROYECTOS_POR_PLAN[plan] ?? PROYECTOS_POR_PLAN.free;
