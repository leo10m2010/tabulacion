import { useState } from "react";
import { ArrowLeft, Eye, EyeOff, FileSpreadsheet, Loader2, Moon, Sun } from "lucide-react";
import { motion } from "motion/react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { springSoft } from "./motion-primitives";
import { GoogleSignInButton } from "./GoogleSignInButton";
import type { ThemeMode } from "../lib/types";

// Pantalla de acceso. Con Google NO hay pantalla de registro aparte: entrar y
// registrarse son la misma acción (si la cuenta no existe, el backend la crea
// con el plan gratuito). Por eso hay un solo botón arriba.
//
// El formulario de correo se queda debajo, más discreto, porque es por donde
// entran las cuentas que crea el administrador (las de pago e instituciones).
export function LoginScreen({ apiBaseUrl, onApiBaseUrlChange, themeMode, onToggleTheme, onBackToLanding, authError, authLoading, onLogin, googleClientId, onGoogleCredential, onAuthErrorChange }: {
  apiBaseUrl: string;
  onApiBaseUrlChange: (url: string) => void;
  themeMode: ThemeMode;
  onToggleTheme: () => void;
  onBackToLanding: () => void;
  authError: string | null;
  authLoading: boolean;
  onLogin: (email: string, password: string) => void;
  // Vacío si el servidor no tiene Google configurado: en ese caso no se
  // muestra el botón, en vez de pintar uno que fallaría al pulsarlo.
  googleClientId: string;
  onGoogleCredential: (credential: string) => void;
  onAuthErrorChange: (mensaje: string) => void;
}) {
  const [email, setEmail] = useState<string>(() => localStorage.getItem("loginEmail") ?? "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const submit = () => onLogin(email, password);

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[radial-gradient(ellipse_at_top,hsl(var(--accent)/0.7)_0%,hsl(var(--background))_60%)] p-4 transition-colors">
      <motion.div
        className="w-full max-w-sm"
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={springSoft}
      >
        <div className="rounded-2xl border border-border/70 bg-card p-8 shadow-hero">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <FileSpreadsheet className="h-5 w-5" />
          </span>
          <h1 className="mt-5 font-display text-2xl font-bold tracking-tighter">
            {googleClientId ? "Entra o crea tu cuenta" : "Bienvenido de vuelta"}
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {googleClientId
              ? "Con Google entras al instante. Si es tu primera vez, te creamos la cuenta gratis."
              : "Ingresa con tu cuenta para continuar con tu tesis."}
          </p>

          <div className="mt-7 space-y-4">
            {authError && (
              <div className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{authError}</div>
            )}

            {googleClientId && (
              <>
                <GoogleSignInButton
                  clientId={googleClientId}
                  themeMode={themeMode}
                  onCredential={onGoogleCredential}
                  onError={onAuthErrorChange}
                  disabled={authLoading}
                />
                <div className="flex items-center gap-3">
                  <span className="h-px flex-1 bg-border" />
                  <span className="text-xs text-muted-foreground">o con tu correo</span>
                  <span className="h-px flex-1 bg-border" />
                </div>
              </>
            )}

            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Correo electrónico</span>
              {/* AUTOCOMPLETE: permite que el navegador recuerde el correo. */}
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@correo.com"
                autoComplete="email"
                className="h-11"
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Contraseña</span>
              {/* AUTOCOMPLETE: permite que el navegador guarde la contraseña. */}
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="h-11 pr-10"
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </label>
            <Button className="h-11 w-full" onClick={submit} disabled={authLoading}>
              {authLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Entrar
            </Button>
            {import.meta.env.DEV && (
              <button
                onClick={() => { setEmail("admin@tabulacion.local"); setPassword("Admin12345!"); }}
                className="w-full rounded-xl border border-dashed border-border py-2 text-xs text-muted-foreground hover:border-primary/40 hover:text-primary transition-all"
              >
                Rellenar con datos de prueba
              </button>
            )}
            {/* URL de la API: editable solo en dev local, nunca visible en producción */}
            {import.meta.env.DEV && (
              <Input value={apiBaseUrl} onChange={(e) => onApiBaseUrlChange(e.target.value)} placeholder="URL de la API (solo dev)" className="text-xs" />
            )}
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between px-2">
          <button onClick={onBackToLanding} className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" />
            Volver al inicio
          </button>
          <button onClick={onToggleTheme} className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
            {themeMode === "dark" ? <><Sun className="h-3.5 w-3.5" />Modo claro</> : <><Moon className="h-3.5 w-3.5" />Modo oscuro</>}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
