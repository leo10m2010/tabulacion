import { useEffect, useRef, useState } from "react";
import type { ThemeMode } from "../lib/types";

// Botón oficial de Google (Google Identity Services).
//
// Entrega un ID token firmado por Google directamente en la página, mediante
// un callback: NO hay redirección, y por eso en Google Cloud Console basta con
// declarar los "Orígenes de JavaScript autorizados" — el campo de URIs de
// redireccionamiento no aplica a este flujo.
//
// El token va al backend, que es quien lo valida. Aquí no se decide nada de
// seguridad: este componente solo lo recoge y lo pasa.

const SCRIPT_SRC = "https://accounts.google.com/gsi/client";

interface GoogleIdApi {
  initialize: (opts: {
    client_id: string;
    callback: (res: { credential?: string }) => void;
    cancel_on_tap_outside?: boolean;
  }) => void;
  renderButton: (parent: HTMLElement, opts: Record<string, unknown>) => void;
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleIdApi } };
  }
}

// El script se carga una sola vez aunque el componente se monte varias veces
// (p. ej. al alternar el tema, que fuerza un re-render del botón).
let scriptPromise: Promise<void> | null = null;
const loadScript = () => {
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    if (window.google?.accounts?.id) { resolve(); return; }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("script")));
      return;
    }
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("script"));
    document.head.appendChild(script);
  });
  return scriptPromise;
};

export function GoogleSignInButton({ clientId, themeMode, onCredential, onError, disabled }: {
  clientId: string;
  themeMode: ThemeMode;
  onCredential: (credential: string) => void;
  onError: (mensaje: string) => void;
  disabled?: boolean;
}) {
  const contenedor = useRef<HTMLDivElement | null>(null);
  const [fallo, setFallo] = useState(false);
  // El callback de Google se registra una sola vez, pero debe llamar SIEMPRE a
  // la última versión de onCredential; con una ref se evita re-inicializar el
  // botón (y que parpadee) cada vez que el padre re-renderiza.
  const alRecibir = useRef(onCredential);
  alRecibir.current = onCredential;

  useEffect(() => {
    let vivo = true;
    loadScript()
      .then(() => {
        if (!vivo || !contenedor.current) return;
        const api = window.google?.accounts?.id;
        if (!api) throw new Error("api");
        api.initialize({
          client_id: clientId,
          callback: (res) => {
            if (res.credential) alRecibir.current(res.credential);
            else onError("Google no devolvió una credencial. Intenta de nuevo.");
          },
        });
        contenedor.current.innerHTML = "";
        api.renderButton(contenedor.current, {
          type: "standard",
          theme: themeMode === "dark" ? "filled_black" : "outline",
          size: "large",
          text: "continue_with",
          shape: "pill",
          logo_alignment: "center",
          locale: "es",
          width: 320,
        });
      })
      .catch(() => {
        if (!vivo) return;
        // Bloqueadores de rastreadores y algunas redes corporativas bloquean el
        // script de Google. Si pasa, hay que decirlo: si no, el usuario ve un
        // hueco vacío donde deberia estar el boton y no entiende nada.
        setFallo(true);
      });
    return () => { vivo = false; };
  }, [clientId, themeMode, onError]);

  if (fallo) {
    return (
      <p className="rounded-xl border border-border/70 bg-muted/40 p-3 text-xs text-muted-foreground">
        No se pudo cargar el acceso con Google (puede que lo bloquee una extensión del navegador).
        Puedes entrar con tu correo y contraseña.
      </p>
    );
  }

  return (
    <div
      className={disabled ? "pointer-events-none opacity-60" : undefined}
      // Centrado: el botón de Google se pinta con un ancho fijo en píxeles.
      style={{ display: "flex", justifyContent: "center", minHeight: 44 }}
    >
      <div ref={contenedor} />
    </div>
  );
}
