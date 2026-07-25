import { defineConfig } from "vitest/config";

// El frontend no tenía ninguna prueba pese a rondar las 8.000 líneas. Se
// empieza por la lógica pura y el cliente de API, que es donde un fallo pasa
// desapercibido y hace daño: cálculo de baremos, conversión de archivos y
// manejo de sesión.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
    restoreMocks: true,
  },
});
