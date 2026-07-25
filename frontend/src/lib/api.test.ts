import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, fetchMe, login, setUnauthorizedHandler } from "./api";

// El cliente de API es el sitio donde se decide qué pasa cuando el servidor
// rechaza una sesión. Antes se perdía el código de estado y solo UNA pantalla
// intentaba detectarlo comparando el texto del mensaje en español: en el resto
// de la app la sesión moría en silencio y todo fallaba sin explicar por qué.
const BASE = "https://api.test";

const respuesta = (status: number, body: unknown) => Promise.resolve({
  ok: status >= 200 && status < 300,
  status,
  json: () => Promise.resolve(body),
} as Response);

afterEach(() => {
  setUnauthorizedHandler(null);
  vi.unstubAllGlobals();
});

describe("errores de la API", () => {
  it("conserva el código de estado, no solo el mensaje", async () => {
    vi.stubGlobal("fetch", vi.fn(() => respuesta(400, { error: "Falta el título." })));

    // Sin el status, quien llama no puede distinguir un dato inválido de una
    // sesión caída ni de una caída del servidor.
    await expect(fetchMe(BASE, "tok")).rejects.toBeInstanceOf(ApiError);
    await expect(fetchMe(BASE, "tok")).rejects.toMatchObject({
      status: 400,
      message: "Falta el título.",
    });
  });

  it("usa un mensaje genérico si el servidor no manda ninguno", async () => {
    vi.stubGlobal("fetch", vi.fn(() => respuesta(502, {})));
    await expect(fetchMe(BASE, "tok")).rejects.toMatchObject({ status: 502, message: "Error HTTP 502" });
  });
});

describe("sesión rechazada (401)", () => {
  it("avisa una sola vez y de forma central", async () => {
    const avisos: string[] = [];
    setUnauthorizedHandler((m) => avisos.push(m));
    vi.stubGlobal("fetch", vi.fn(() => respuesta(401, { error: "Token expirado." })));

    await expect(fetchMe(BASE, "tok")).rejects.toBeInstanceOf(ApiError);

    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatch(/sesión expiró/i);
  });

  it("NO se dispara al fallar el inicio de sesión", async () => {
    // Un 401 en /auth/login significa "credenciales incorrectas", no una sesión
    // perdida. Cerrar sesión ahí sería absurdo (no hay ninguna) y borraría el
    // mensaje de error que el usuario necesita leer.
    const avisos: string[] = [];
    setUnauthorizedHandler((m) => avisos.push(m));
    vi.stubGlobal("fetch", vi.fn(() => respuesta(401, { error: "Credenciales invalidas." })));

    await expect(login(BASE, "quien@test.local", "mala")).rejects.toMatchObject({ status: 401 });

    expect(avisos).toHaveLength(0);
  });

  it("no confunde otros errores con una sesión caída", async () => {
    const avisos: string[] = [];
    setUnauthorizedHandler((m) => avisos.push(m));
    vi.stubGlobal("fetch", vi.fn(() => respuesta(403, { error: "No te quedan usos." })));

    await expect(fetchMe(BASE, "tok")).rejects.toMatchObject({ status: 403 });

    // Quedarse sin usos no es quedarse sin sesión: expulsar al usuario aquí
    // sería una regresión muy molesta.
    expect(avisos).toHaveLength(0);
  });
});

describe("construcción de la petición", () => {
  it("manda el token como Bearer y el cuerpo como JSON", async () => {
    const espia = vi.fn((_url: string, _init?: RequestInit) => respuesta(200, { ok: true }));
    vi.stubGlobal("fetch", espia);

    await fetchMe("https://api.test/", "mi-token");

    const [url, init] = espia.mock.calls[0];
    // La barra final de la URL base no debe duplicarse.
    expect(url).toBe("https://api.test/auth/me");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer mi-token");
  });

  it("no manda Content-Type cuando no hay cuerpo", async () => {
    const espia = vi.fn((_url: string, _init?: RequestInit) => respuesta(200, {}));
    vi.stubGlobal("fetch", espia);

    await fetchMe(BASE, "tok");

    const [, init] = espia.mock.calls[0];
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
  });
});
