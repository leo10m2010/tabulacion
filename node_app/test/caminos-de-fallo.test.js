// Que pasa cuando algo de fuera falla.
//
// Es la zona con menos cobertura y donde el fallo le llega directo al usuario:
// la IA se cae a mitad de una generacion, la base de datos no responde, o el
// Word que suben esta corrupto. Hoy mismo aparecio un ReferenceError escondido
// en uno de estos caminos, asi que aqui se fijan.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "node:url";
import { docxToMarkdown } from "../lib/descriptiva/docx.js";
import { esperarSalud } from "./helpers/servidor.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(SCRIPT_DIR, "..", "server.js");

// ── La base de datos no responde al arrancar ────────────────────────────────
describe("almacen inalcanzable al arrancar", () => {
  test("el servidor NO arranca, en vez de empezar vacio", async () => {
    // Esta es la garantia mas cara del sistema. Si el servidor arrancara con
    // la lista de usuarios vacia, la primera escritura la persistiria y
    // BORRARIA TODAS LAS CUENTAS: el SQL de guardado elimina las filas que no
    // esten en el arreglo entrante. Fallar ruidosamente es lo correcto.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tabulacion-fallo-"));
    const hijo = spawn(process.execPath, [SERVER], {
      env: {
        ...process.env,
        // Puerto 1: la conexion se rechaza al instante, sin esperas largas.
        DATABASE_URL: "postgresql://usuario:clave@127.0.0.1:1/basedatos",
        PORT: "18291",
        AUTH_REQUIRED: "true",
        AUTH_TOKEN_SECRET: "secreto-de-prueba",
        USER_STORE_PATH: path.join(tmpDir, "users.json"),
        ADMIN_EMAIL: "admin@test.local",
        ADMIN_PASSWORD: "ClaveDePrueba123!",
      },
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";
    hijo.stderr.on("data", (c) => { stderr += String(c); });

    const codigo = await new Promise((resolve) => {
      hijo.on("exit", resolve);
      // Red de seguridad: si siguiera vivo pasado el tiempo, el test falla.
      setTimeout(() => { hijo.kill(); resolve("seguia-vivo"); }, 20000);
    });

    assert.notEqual(codigo, "seguia-vivo", "el proceso no se queda levantado con la base caida");
    assert.notEqual(codigo, 0, "sale con codigo de error");
    assert.match(stderr, /ECONNREFUSED|connect|Error/i, "explica por que no arranco");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ── El .docx que sube el usuario no sirve ───────────────────────────────────
describe("archivo .docx invalido", () => {
  test("un archivo que no es Word da un error entendible, no un fallo tecnico", async () => {
    // Aqui vivia un ReferenceError: se relanzaba el error con `{ cause: err }`
    // dentro de un `catch` SIN variable. Con un Word corrupto reventaba con un
    // fallo del servidor en vez del mensaje al usuario.
    const basura = Buffer.from("esto no es un documento de Word").toString("base64");

    await assert.rejects(
      () => docxToMarkdown(basura),
      (err) => {
        assert.ok(err instanceof Error);
        assert.doesNotMatch(err.message, /is not defined|undefined/i, "no es un fallo tecnico");
        assert.match(err.message, /docx|Word/i, "le dice al usuario que pasa con su archivo");
        return true;
      },
    );
  });

  test("un archivo vacio se rechaza con su propio mensaje", async () => {
    await assert.rejects(() => docxToMarkdown(""), /vacio/i);
  });

  test("un archivo demasiado grande se rechaza antes de intentar leerlo", async () => {
    // 4 MB supera el limite de 3 MB. Se comprueba el limite ANTES de pasarselo
    // al lector para no gastar CPU en algo que ya se va a rechazar.
    const grande = Buffer.alloc(4 * 1024 * 1024, 0x41).toString("base64");
    await assert.rejects(() => docxToMarkdown(grande), /3 MB/i);
  });
});

// ── La IA falla a mitad de un job ───────────────────────────────────────────
describe("la IA falla durante una generacion", () => {
  test("el uso vuelve al usuario y no queda anotado como pendiente", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tabulacion-ia-"));
    const PORT = 18292;
    const BASE = `http://127.0.0.1:${PORT}`;
    const hijo = spawn(process.execPath, [SERVER], {
      env: {
        ...process.env,
        DATABASE_URL: "",
        PORT: String(PORT),
        AUTH_REQUIRED: "true",
        AUTH_TOKEN_SECRET: "secreto-de-prueba",
        USER_STORE_PATH: path.join(tmpDir, "users.json"),
        ADMIN_EMAIL: "admin@test.local",
        ADMIN_PASSWORD: "ClaveDePrueba123!",
        // Sin clave, la llamada a la IA falla nada mas empezar: es la forma
        // mas fiel de provocar el fallo sin depender de la red.
        OPENROUTER_API_KEY: "",
      },
      stdio: "ignore",
    });

    try {
      await esperarSalud(BASE, hijo);

      const admin = await (await fetch(`${BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "admin@test.local", password: "ClaveDePrueba123!" }),
      })).json();

      const crear = await fetch(`${BASE}/auth/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${admin.token}` },
        body: JSON.stringify({
          email: "victima@test.local",
          password: "ClaveDePrueba123!",
          role: "user",
          plan: "tesista",
          uses: { descriptiva: 3 },
        }),
      });
      const usuario = (await crear.json()).user;
      assert.equal(usuario.uses.descriptiva, 3);

      const sesion = await (await fetch(`${BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "victima@test.local", password: "ClaveDePrueba123!" }),
      })).json();

      const inicio = await fetch(`${BASE}/descriptiva`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sesion.token}` },
        body: JSON.stringify({
          texto: "1. ¿Con que frecuencia usa el servicio? a) Nunca b) A veces c) Siempre. "
            + "2. ¿Como califica la atencion recibida en la oficina? a) Mala b) Regular c) Buena.",
          config: { n: 20 },
        }),
      });
      assert.equal(inicio.status, 202, "el job se crea");
      const { jobId } = await inicio.json();

      let estado = null;
      for (let i = 0; i < 50; i += 1) {
        const job = await (await fetch(`${BASE}/descriptiva/jobs/${jobId}`, {
          headers: { Authorization: `Bearer ${sesion.token}` },
        })).json();
        if (job.status !== "processing") { estado = job; break; }
        await new Promise((r) => setTimeout(r, 300));
      }

      assert.ok(estado, "el job termina");
      assert.equal(estado.status, "error");
      // El detalle tecnico (que falta la clave de OpenRouter) no se le cuenta
      // al usuario; si se le dice que no perdio su uso.
      assert.doesNotMatch(estado.error, /OPENROUTER|API_KEY/i, "no se filtra el detalle interno");
      assert.match(estado.error, /no se descont/i);

      const despues = await (await fetch(`${BASE}/auth/users`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      })).json();
      assert.equal(
        despues.users.find((u) => u.email === "victima@test.local").uses.descriptiva,
        3,
        "el uso vuelve: el usuario no recibio nada",
      );

      // El ciclo completo queda en el historial. Se comprueba asi y no
      // consultando el saldo a mitad del job: sin clave de IA el fallo es
      // inmediato, y entre el POST y la consulta ya se habia reembolsado. La
      // actividad demuestra que SI se descontó y luego se devolvio.
      const actividad = despues.users
        .find((u) => u.email === "victima@test.local").activity
        .map((a) => a.detail);
      assert.ok(
        actividad.some((d) => /Uso de Descriptiva \(quedan/i.test(d)),
        `se descontó el uso (actividad: ${actividad.join(" | ")})`,
      );
      assert.ok(
        actividad.some((d) => /devuelto/i.test(d)),
        `y se devolvio (actividad: ${actividad.join(" | ")})`,
      );

      // Y no queda anotado como pendiente, o al reiniciar se le devolveria
      // OTRA vez el mismo uso.
      const pendientes = JSON.parse(fs.readFileSync(path.join(tmpDir, "pending-uses.json"), "utf-8"));
      assert.deepEqual(pendientes, [], "la anotacion pendiente se limpio");
    } finally {
      hijo.kill();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
