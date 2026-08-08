// Verificacion del ID token de Google (Google Identity Services).
//
// El flujo es el del boton de Google en el navegador: el frontend obtiene un
// ID token firmado por Google y lo manda aqui. Este modulo comprueba que sea
// autentico y que fuera emitido PARA esta aplicacion, y devuelve la identidad.
//
// No hace falta client secret: ese solo se usa en el flujo de codigo de
// autorizacion del lado servidor. Aqui basta el Client ID, que es publico.
//
// La verificacion se hace en local contra las claves publicas de Google (la
// libreria las cachea), no llamando a su endpoint de tokeninfo: evita una ida
// y vuelta a Google en cada inicio de sesion.
import { OAuth2Client } from "google-auth-library";
import { errorLogFields, metrics, structuredLog } from "./observability.js";

const CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID ?? "").trim();
const TEST_PROFILES = (() => {
  if (process.env.NODE_ENV !== "test") return null;
  try {
    const parsed = JSON.parse(String(process.env.GOOGLE_TEST_PROFILES_JSON ?? "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
})();

export const googleEnabled = Boolean(CLIENT_ID);
export const googleClientId = CLIENT_ID;

let client = null;
const getClient = () => {
  client ??= new OAuth2Client(CLIENT_ID);
  return client;
};

// Devuelve { email, emailVerified, name, sub } o lanza con un motivo claro.
export const verifyGoogleIdToken = async (idToken) => {
  if (!CLIENT_ID) {
    throw new Error("El inicio de sesion con Google no esta configurado en el servidor.");
  }
  const token = String(idToken ?? "").trim();
  if (!token) {
    throw new Error("Falta el token de Google.");
  }

  // Solo para pruebas de integración locales: permite recorrer el flujo
  // posterior a una firma válida sin fabricar ni aceptar JWT falsos. En
  // cualquier NODE_ENV distinto de test esta vía ni siquiera se construye.
  if (TEST_PROFILES?.[token]) {
    const profile = TEST_PROFILES[token];
    if (!profile.email || !profile.sub || profile.email_verified !== true) {
      throw new Error("El perfil Google de prueba no es válido.");
    }
    return {
      email: String(profile.email).trim(),
      name: String(profile.name ?? "").trim(),
      sub: String(profile.sub),
    };
  }

  let payload;
  try {
    // verifyIdToken comprueba la firma, la expiracion, que `aud` sea NUESTRO
    // Client ID y que `iss` sea Google. Sin la comprobacion de `aud`,
    // cualquiera podria entrar con un token emitido para otra aplicacion.
    const ticket = await getClient().verifyIdToken({ idToken: token, audience: CLIENT_ID });
    payload = ticket.getPayload();
  } catch (err) {
    metrics.increment("google_auth_verifications_total", 1, { outcome: "rejected" });
    structuredLog("warn", "auth.google_token_rejected", errorLogFields(err));
    throw new Error("No se pudo validar tu cuenta de Google. Intenta de nuevo.", { cause: err });
  }

  const email = String(payload?.email ?? "").trim();
  if (!email) {
    throw new Error("Tu cuenta de Google no expone un correo.");
  }
  // Google marca email_verified=false en algunas cuentas de Workspace con
  // dominios no verificados. Aceptarlas romperia la premisa de la que depende
  // todo esto: que entrar con Google prueba que el correo es tuyo.
  if (payload.email_verified !== true) {
    throw new Error("Tu correo de Google no esta verificado.");
  }
  const sub = String(payload.sub ?? "").trim();
  if (!sub) {
    throw new Error("La identidad de Google no incluye un identificador estable.");
  }

  return {
    email,
    name: String(payload.name ?? "").trim(),
    sub,
  };
};
