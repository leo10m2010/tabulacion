import js from "@eslint/js";
import globals from "globals";

// El codigo tenia comentarios `eslint-disable-next-line no-console` repartidos
// sin que ESLint existiera: no desactivaban nada. Esto los vuelve reales.
//
// Se activan reglas que atrapan ERRORES, no estilo. En un servidor, una
// promesa sin manejar o una variable mal escrita se manifiestan como un fallo
// en produccion; la indentacion no.
export default [
  { ignores: ["node_modules/**", "data/**"] },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
      // El servidor usa console a proposito como registro; los avisos van
      // marcados uno a uno con eslint-disable, que ahora si tiene efecto.
      "no-console": "warn",
      "no-undef": "error",
      // Una promesa lanzada sin await ni .catch se traga los errores.
      "no-async-promise-executor": "error",
      "require-atomic-updates": "warn",
    },
  },
  {
    files: ["test/**/*.js"],
    languageOptions: { globals: { ...globals.node } },
    rules: { "no-console": "off" },
  },
];
