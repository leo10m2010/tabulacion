import { validateDeploymentEnvironment } from "./config.js";

const roleArg = process.argv.find((arg) => arg.startsWith("--role="));
const role = roleArg ? roleArg.slice("--role=".length) : "api";
const env = process.argv.includes("--commercial")
  ? { ...process.env, COMMERCIAL_LAUNCH_ENABLED: "true" }
  : process.env;

try {
  const summary = validateDeploymentEnvironment(env, { role });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    event: "deployment.preflight",
    role: summary.role,
    databaseHost: summary.database?.host,
    pooled: summary.database?.pooled,
    commercial: summary.commercial ?? false,
  })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    event: "deployment.preflight",
    role,
    code: error.code ?? "DEPLOYMENT_PREFLIGHT_FAILED",
    issues: error.issues ?? ["La configuracion no paso el preflight."],
  })}\n`);
  process.exitCode = 1;
}
