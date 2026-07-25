// Espera a que el servidor de pruebas este listo.
//
// Existe por dos fallos reales que solo aparecieron en CI:
//
// 1. Cada archivo de prueba tenia su propia copia de "levanta y espera", con
//    una espera de ~12 s. En local sobra; en GitHub Actions los archivos
//    corren EN PARALELO, cada uno levantando su servidor sobre una maquina
//    compartida y mas lenta, y esos 12 s se quedaban cortos: la suite fallaba
//    en CI mientras pasaba en local.
//
// 2. Cuando no arrancaba, el unico mensaje era "La API no levanto a tiempo".
//    Sin salida del proceso no habia forma de saber por que. Aqui, si el
//    proceso murio, se dice con su codigo y su salida.

// Generoso a proposito: esperar de mas no cuesta nada (se sale en cuanto
// responde), y quedarse corto convierte la suite en intermitente.
const ESPERA_MAX_MS = 60_000;
const INTERVALO_MS = 200;

export const esperarSalud = async (base, child) => {
  // Se acumula la salida solo si el proceso se lanzo con tuberias; con
  // stdio "ignore" simplemente no habra nada que mostrar.
  let salida = "";
  child?.stdout?.on("data", (c) => { salida += String(c); });
  child?.stderr?.on("data", (c) => { salida += String(c); });

  let murio = null;
  child?.on("exit", (code, signal) => { murio = { code, signal }; });

  const limite = Date.now() + ESPERA_MAX_MS;
  while (Date.now() < limite) {
    // Si el proceso ya murio no tiene sentido seguir esperando: se falla al
    // instante y con el motivo, en vez de agotar el minuto entero.
    if (murio) {
      throw new Error(
        `El servidor murio al arrancar (code=${murio.code}, signal=${murio.signal}).\n`
        + `Salida:\n${salida || "(sin salida; el proceso se lanzo con stdio ignore)"}`,
      );
    }
    try {
      if ((await fetch(`${base}/health`)).ok) return;
    } catch { /* aun no escucha */ }
    await new Promise((r) => setTimeout(r, INTERVALO_MS));
  }

  throw new Error(
    `La API no levanto en ${ESPERA_MAX_MS / 1000}s.\n`
    + `Salida:\n${salida || "(sin salida; el proceso se lanzo con stdio ignore)"}`,
  );
};
