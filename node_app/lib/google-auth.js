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

const CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID ?? "").trim();

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

  let payload;
  try {
    // verifyIdToken comprueba la firma, la expiracion, que `aud` sea NUESTRO
    // Client ID y que `iss` sea Google. Sin la comprobacion de `aud`,
    // cualquiera podria entrar con un token emitido para otra aplicacion.
    const ticket = await getClient().verifyIdToken({ idToken: token, audience: CLIENT_ID });
    payload = ticket.getPayload();
  } catch (err) {
    // El detalle tecnico queda en el log del servidor, no en la respuesta.
    // eslint-disable-next-line no-console
    console.error("[google] token rechazado:", err.message);
    throw new Error("No se pudo validar tu cuenta de Google. Intenta de nuevo.");
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

  return {
    email,
    name: String(payload.name ?? "").trim(),
    sub: String(payload.sub ?? ""),
  };
};
