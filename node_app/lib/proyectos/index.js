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
// El titulo de la tesis es una frase larga; el nombre del proyecto es corto.
export const MAX_TITULO = 300;
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

// Los pasos de una tesis, en el orden en que se hacen. El progreso guarda solo
// la fecha en que cada uno se completo: es lo unico que hace falta para que
// alguien con quince tesis vea de un vistazo en que anda cada una, y no obliga
// a guardar los archivos generados (eso es otra fase).
export const PASOS = [
  "titulos",
  "matriz",
  "instrumento",
  "confiabilidad",
  "tabulacion",
  "descriptiva",
  "humanizador",
];

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

    const inversosRaw = Array.isArray(v?.itemsInversos)
      ? v.itemsInversos
      : (Array.isArray(v?.items_inversos) ? v.items_inversos : []);
    const itemsInversos = inversosRaw.map((value) => Number(value));
    if (itemsInversos.some((value) => !Number.isInteger(value) || value < 1 || value > totalItems)) {
      fallar(`Los ítems inversos de "${nombre}" deben ser posiciones enteras entre 1 y ${totalItems}.`);
    }
    if (new Set(itemsInversos).size !== itemsInversos.length) {
      fallar(`Los ítems inversos de "${nombre}" no pueden repetirse.`);
    }
    itemsInversos.sort((a, b) => a - b);

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
      // Cada nivel es un porcentaje de personas (0-100): validar solo la SUMA
      // deja pasar niveles absurdos que se cancelan entre si (p. ej. -50% y
      // 150%, que suman 100 pero no representan ningun reparto real). La
      // simulacion (ver lib/stats.js, repartirEnteros) asume proporciones
      // no negativas, asi que un valor fuera de rango rompe silenciosamente
      // el reparto en cuanto este instrumento se conecte a esa simulacion.
      if (baremo.some((n) => !Number.isFinite(n.porcentaje) || n.porcentaje < 0 || n.porcentaje > 100)) {
        fallar(`Los porcentajes del baremo de "${nombre}" deben ser números entre 0 y 100.`);
      }
      const suma = baremo.reduce((a, n) => a + n.porcentaje, 0);
      if (Math.round(suma) !== 100) {
        fallar(`Los porcentajes del baremo de "${nombre}" deben sumar 100% (suman ${Math.round(suma)}%).`);
      }
    }

    return { nombre, dimensiones, baremo, itemsInversos, totalItems };
  });

  return { escala, variables };
};

// Solo se conservan los pasos conocidos y con fecha valida: el progreso viene
// del cliente y no puede convertirse en un saco de datos arbitrarios.
export const normalizarProgreso = (raw) => {
  const entrada = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const progreso = {};
  for (const paso of PASOS) {
    const fecha = Date.parse(entrada[paso]);
    if (Number.isFinite(fecha)) progreso[paso] = new Date(fecha).toISOString();
  }
  return progreso;
};

export const marcarPaso = (proyecto, paso) => {
  if (!PASOS.includes(paso)) fallar(`"${paso}" no es un paso conocido.`);
  return {
    ...proyecto,
    progreso: { ...normalizarProgreso(proyecto.progreso), [paso]: new Date().toISOString() },
    updatedAt: new Date().toISOString(),
  };
};

export const crearProyecto = ({ userId, nombre, instrumento }) => {
  const nombreLimpio = limpiar(nombre, MAX_NOMBRE);
  if (!nombreLimpio) fallar("Ponle un nombre a tu proyecto.");
  const ahora = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    userId,
    version: 1,
    nombre: nombreLimpio,
    // El titulo definitivo, el que el usuario ELIGE entre las propuestas. Es
    // la entrada del paso siguiente (la matriz de consistencia parte de el),
    // asi que guardarlo evita copiarlo a mano de una herramienta a otra.
    titulo: "",
    instrumento: normalizarInstrumento(instrumento),
    progreso: {},
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
  if (cambios?.titulo !== undefined) {
    siguiente.titulo = limpiar(cambios.titulo, MAX_TITULO);
    // Elegir el titulo ES el paso, no generarlo: generar tres propuestas y no
    // decidir ninguna no es avanzar. Borrarlo deshace el paso.
    const progreso = normalizarProgreso(siguiente.progreso);
    if (siguiente.titulo) progreso.titulos = new Date().toISOString();
    else delete progreso.titulos;
    siguiente.progreso = progreso;
  }
  if (cambios?.instrumento !== undefined) {
    siguiente.instrumento = normalizarInstrumento(cambios.instrumento);
    // Definir el instrumento ES uno de los pasos: marcarlo aqui evita que el
    // cliente tenga que acordarse de avisar por separado.
    const items = siguiente.instrumento.variables.reduce((a, v) => a + (v.totalItems ?? 0), 0);
    if (items > 0) {
      siguiente.progreso = {
        ...normalizarProgreso(siguiente.progreso),
        instrumento: new Date().toISOString(),
      };
    }
  }
  siguiente.updatedAt = new Date().toISOString();
  return siguiente;
};

export const limiteDelPlan = (plan) => PROYECTOS_POR_PLAN[plan] ?? PROYECTOS_POR_PLAN.free;
