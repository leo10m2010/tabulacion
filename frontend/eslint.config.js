import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

// El proyecto tenía comentarios `eslint-disable` repartidos por el código sin
// que ESLint existiera: no desactivaban nada. Esta configuración los vuelve
// reales.
//
// Criterio: se activan las reglas que atrapan ERRORES (dependencias de efectos,
// promesas sin manejar, variables sin usar), no las de estilo. El formato no
// causa fallos en producción; un efecto con dependencias mal declaradas sí.
export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "public/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaVersion: "latest", sourceType: "module" },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      // La más valiosa aquí: App.tsx tiene muchos useEffect, y una dependencia
      // que falta produce datos obsoletos en pantalla sin ningún error visible.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // Un argumento sin usar suele señalar un parámetro que se dejó de pasar.
      // Se permite el prefijo _ para los que son deliberados (firmas de espías).
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrors: "none",
      }],
      // `any` desactiva el chequeo de tipos justo donde más hace falta.
      "@typescript-eslint/no-explicit-any": "warn",
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  {
    // Las pruebas corren en Node y usan las globales de Vitest.
    files: ["**/*.test.ts"],
    languageOptions: { globals: { ...globals.node } },
  },
);
