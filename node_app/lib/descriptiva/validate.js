// Validacion estructural del JSON de la IA antes de tocar el generador de
// Excel. El sistema nunca genera un Excel desde un JSON que no paso TODOS
// estos checks; ante fallo se reintenta una vez y luego error controlado.

const TIPOS_INSTRUMENTO = new Set(["independiente", "puntaje_sumado", "conocimiento"]);
const TIPOS_PREGUNTA = new Set(["numerica", "nominal_unica", "ordinal_unica", "multirrespuesta"]);

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// Columnas de multirrespuesta: la IA abrevia cada opcion a su manera
// ({id}__{opcion_abreviada}), asi que se descubren por prefijo en la primera
// fila y se exige que TODAS las filas tengan exactamente esas claves.
export const multiColumnsOf = (pregunta, firstRow) => Object.keys(firstRow ?? {})
  .filter((k) => k.startsWith(`${pregunta.id}__`));

export const validateSimulation = (data) => {
  const errors = [];
  if (!isPlainObject(data)) return ["la respuesta no es un objeto JSON"];

  const { metadata, preguntas, datos_simulados: datos, baremo } = data;

  if (!isPlainObject(metadata)) errors.push("falta metadata");
  if (!Array.isArray(preguntas) || preguntas.length === 0) errors.push("falta preguntas (array no vacio)");
  if (!Array.isArray(datos) || datos.length === 0) errors.push("falta datos_simulados (array no vacio)");
  if (errors.length > 0) return errors;

  const tipo = metadata.tipo_instrumento;
  if (!TIPOS_INSTRUMENTO.has(tipo)) {
    errors.push(`metadata.tipo_instrumento invalido: "${tipo}"`);
  }
  const n = Number(metadata.n_encuestados);
  if (!Number.isInteger(n) || n <= 0) {
    errors.push(`metadata.n_encuestados invalido: ${metadata.n_encuestados}`);
  } else if (datos.length < Math.ceil(n / 2)) {
    // Los LLM no cuentan filas con exactitud (visto en produccion: pide 60 y
    // entrega 65-72). El conteo exacto lo reconcilia el orquestador
    // (recorta/completa); solo un deficit grave amerita reintentar.
    errors.push(`datos_simulados tiene solo ${datos.length} filas de las ${n} pedidas (menos de la mitad)`);
  }

  // Preguntas bien formadas.
  const ids = new Set();
  preguntas.forEach((p, i) => {
    if (!isPlainObject(p) || !p.id || typeof p.id !== "string") {
      errors.push(`pregunta ${i + 1} sin id`);
      return;
    }
    if (ids.has(p.id)) errors.push(`id de pregunta duplicado: ${p.id}`);
    ids.add(p.id);
    if (!TIPOS_PREGUNTA.has(p.tipo)) {
      errors.push(`pregunta ${p.id} con tipo invalido: "${p.tipo}"`);
      return;
    }
    if (p.tipo !== "numerica" && (!Array.isArray(p.opciones) || p.opciones.length < 2)) {
      errors.push(`pregunta ${p.id} (${p.tipo}) sin opciones suficientes`);
    }
  });
  if (errors.length > 0) return errors;

  // Cada fila debe traer todas las columnas de todas las preguntas
  // (multirrespuesta expandida a columnas binarias por prefijo).
  const firstRow = datos[0];
  const multiCols = new Map();
  for (const p of preguntas) {
    if (p.tipo === "multirrespuesta") {
      const cols = multiColumnsOf(p, firstRow);
      if (cols.length !== p.opciones.length) {
        errors.push(
          `multirrespuesta ${p.id}: se esperaban ${p.opciones.length} columnas ${p.id}__* y hay ${cols.length}`,
        );
      }
      multiCols.set(p.id, cols);
    }
  }
  if (errors.length > 0) return errors;

  const opcionesDe = new Map(preguntas.map((p) => [p.id, p.opciones ? p.opciones.map(String) : null]));
  for (let i = 0; i < datos.length; i += 1) {
    const row = datos[i];
    if (!isPlainObject(row)) {
      errors.push(`fila ${i + 1} no es un objeto`);
      break;
    }
    for (const p of preguntas) {
      if (p.tipo === "multirrespuesta") {
        for (const col of multiCols.get(p.id)) {
          const v = row[col];
          if (v !== 0 && v !== 1) {
            errors.push(`fila ${i + 1}: columna binaria ${col} con valor no 0/1 (${v})`);
          }
        }
      } else if (row[p.id] === undefined || row[p.id] === null || row[p.id] === "") {
        errors.push(`fila ${i + 1}: falta la respuesta de ${p.id}`);
      } else if (p.tipo === "numerica") {
        if (!Number.isFinite(Number(row[p.id]))) {
          errors.push(`fila ${i + 1}: ${p.id} deberia ser numerico (${row[p.id]})`);
        }
      } else if (!opcionesDe.get(p.id).includes(String(row[p.id]))) {
        errors.push(`fila ${i + 1}: ${p.id} con valor fuera de las opciones ("${row[p.id]}")`);
      }
      if (errors.length >= 8) break; // suficiente evidencia para reintentar
    }
    if (errors.length >= 8) break;
  }
  if (errors.length > 0) return errors;

  // Capa condicional: si hay puntaje o respuestas correctas, el baremo es
  // obligatorio y debe permitir recalcular todo desde las filas crudas.
  if (tipo !== "independiente") {
    if (!isPlainObject(baremo)) {
      errors.push(`tipo_instrumento=${tipo} exige un bloque baremo no nulo`);
      return errors;
    }
    if (!Array.isArray(baremo.rangos) || baremo.rangos.length === 0) {
      errors.push("baremo.rangos vacio");
    } else {
      baremo.rangos.forEach((r, i) => {
        if (!isPlainObject(r) || !Number.isFinite(Number(r.min)) || !Number.isFinite(Number(r.max)) || !r.categoria) {
          errors.push(`baremo.rangos[${i}] invalido (min/max/categoria)`);
        }
      });
    }
    if (tipo === "puntaje_sumado") {
      const conPuntos = preguntas.filter(
        (p) => Array.isArray(p.puntos_por_opcion) && p.puntos_por_opcion.length === (p.opciones?.length ?? -1),
      );
      if (conPuntos.length === 0) {
        errors.push("puntaje_sumado sin ninguna pregunta con puntos_por_opcion valido");
      }
    }
    if (tipo === "conocimiento") {
      const conCorrecta = preguntas.filter(
        (p) => p.respuesta_correcta !== undefined && p.respuesta_correcta !== null && p.respuesta_correcta !== "",
      );
      if (conCorrecta.length === 0) {
        errors.push("conocimiento sin ninguna pregunta con respuesta_correcta");
      }
    }
  }

  return errors;
};
