import { useState } from "react";
import { Eye, EyeOff, FileSpreadsheet, Loader2, Moon, Sun } from "lucide-react";
import { motion } from "motion/react";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Input } from "./ui/input";
import { springSoft } from "./motion-primitives";
import type { ThemeMode } from "../lib/types";

// Pantalla de inicio de sesión. El email/contraseña viven aquí; App recibe
// el submit vía onLogin y mantiene token/usuario.
export function LoginScreen({ apiBaseUrl, onApiBaseUrlChange, themeMode, onToggleTheme, onBackToLanding, authError, authLoading, onLogin }: {
  apiBaseUrl: string;
  onApiBaseUrlChange: (url: string) => void;
  themeMode: ThemeMode;
  onToggleTheme: () => void;
  onBackToLanding: () => void;
  authError: string | null;
  authLoading: boolean;
  onLogin: (email: string, password: string) => void;
}) {
  const [email, setEmail] = useState<string>(() => localStorage.getItem("loginEmail") ?? "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const submit = () => onLogin(email, password);

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[radial-gradient(ellipse_at_top,hsl(var(--accent)/0.55)_0%,hsl(var(--background))_60%)] p-4 transition-colors">
      <motion.div
        className="w-full max-w-sm"
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={springSoft}
      >
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-[0_14px_36px_-14px_hsl(var(--primary)/0.8)]">
            <FileSpreadsheet className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">TesisTab</h1>
          <p className="mt-1 text-sm text-muted-foreground">Ingresa con tu cuenta para continuar</p>
        </div>
        <Card className="rounded-2xl border-border/70 shadow-[0_20px_70px_rgba(15,23,42,0.15)]">
          <CardContent className="space-y-4 pt-6">
            {authError && (
              <div className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{authError}</div>
            )}
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Correo electrónico</span>
              {/* AUTOCOMPLETE: permite que el navegador recuerde el correo.
                  TODO producción: cambiar a autoComplete="off" si se prefiere no guardar */}
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@tu-dominio.com"
                autoComplete="email"
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Contraseña</span>
              {/* AUTOCOMPLETE: permite que el navegador guarde la contraseña.
                  TODO producción: cambiar a autoComplete="new-password" para desactivarlo */}
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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
                className="w-full rounded-lg border border-dashed border-border py-2 text-xs text-muted-foreground hover:border-primary/40 hover:text-primary transition-all"
              >
                Rellenar con datos de prueba
              </button>
            )}
            <div className="flex items-center justify-between">
              <button onClick={onBackToLanding} className="text-xs text-muted-foreground hover:text-foreground">← Volver al inicio</button>
              <button onClick={onToggleTheme} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                {themeMode === "dark" ? <><Sun className="h-3.5 w-3.5" />Modo claro</> : <><Moon className="h-3.5 w-3.5" />Modo oscuro</>}
              </button>
            </div>
          </CardContent>
        </Card>
        {/* Input de API solo visible en dev local (VITE_API_BASE_URL no definida) */}
        {import.meta.env.DEV && (
          <div className="mt-4 space-y-1">
            <p className="text-center text-xs text-muted-foreground">API: {apiBaseUrl}</p>
            <Input value={apiBaseUrl} onChange={(e) => onApiBaseUrlChange(e.target.value)} placeholder="https://tu-api.com" className="text-xs" />
          </div>
        )}
      </motion.div>
    </div>
  );
}
