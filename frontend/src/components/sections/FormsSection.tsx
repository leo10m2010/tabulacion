import { useEffect, useState } from "react";
import { Check, KeyRound, Loader2, Server } from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { createApiKey, getApiKeyInfo, revokeApiKey, type ApiKeyInfo } from "../../lib/api";
import { formatDateTime } from "../../lib/helpers";
import { getFormsBalance } from "../../lib/usage";
import type { AuthUser } from "../../lib/types";

// Sección Forms / Integraciones: clave de API para la extensión Tutorica
// Forms. Autocontenida: App la monta cuando la sección está activa, por eso
// carga el estado de la clave en el mount.
export function FormsSection({ apiBaseUrl, authToken, authUser, onUpgrade }: {
  apiBaseUrl: string;
  authToken: string;
  authUser: AuthUser;
  onUpgrade?: (tool?: string) => void;
}) {
  const formsBalance = getFormsBalance(authUser);
  const [apiKeyInfo, setApiKeyInfo] = useState<ApiKeyInfo | null>(null);
  const [newApiKey, setNewApiKey] = useState<string | null>(null);
  const [apiKeyBusy, setApiKeyBusy] = useState(false);
  const [apiKeyCopied, setApiKeyCopied] = useState(false);

  useEffect(() => {
    if (!authToken) return;
    let isMounted = true;
    getApiKeyInfo(apiBaseUrl, authToken)
      .then((info) => { if (isMounted) setApiKeyInfo(info); })
      .catch(() => {
        // Sin conexion: se reintenta al volver a entrar a la seccion.
      });
    return () => { isMounted = false; };
  }, [apiBaseUrl, authToken]);

  const generateKey = async () => {
    if (!authToken) return;
    if (apiKeyInfo?.hasKey && !window.confirm("Regenerar la clave invalida la anterior en tu extensión. ¿Continuar?")) return;
    setApiKeyBusy(true);
    setNewApiKey(null);
    setApiKeyCopied(false);
    try {
      const body = await createApiKey(apiBaseUrl, authToken);
      setNewApiKey(body.apiKey);
      setApiKeyInfo({ hasKey: true, last4: body.last4 ?? null, createdAt: body.createdAt ?? null });
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "No se pudo generar la clave.");
    } finally {
      setApiKeyBusy(false);
    }
  };

  const revokeKey = async () => {
    if (!authToken || !window.confirm("¿Revocar tu clave de API? La extensión dejará de funcionar hasta que generes una nueva.")) return;
    setApiKeyBusy(true);
    try {
      await revokeApiKey(apiBaseUrl, authToken);
      setNewApiKey(null);
      setApiKeyInfo({ hasKey: false, last4: null, createdAt: null });
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "No se pudo revocar la clave.");
    } finally {
      setApiKeyBusy(false);
    }
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setApiKeyCopied(true);
      window.setTimeout(() => setApiKeyCopied(false), 2000);
    } catch {
      window.alert("No se pudo copiar; selecciona el texto manualmente.");
    }
  };

  return (
    <div className="step-enter mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="font-display text-2xl font-bold tracking-tight">Forms</h2>
        <p className="mt-1 text-sm text-muted-foreground">Rellena tus Google Forms usando tu saldo de respuestas.</p>
      </div>

      <Card className="rounded-2xl border-border/70 bg-card/95 shadow-sm">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Server className="h-4 w-4 text-primary" />
                Tutorica Forms
              </CardTitle>
              <CardDescription className="mt-1 max-w-[52ch]">
                Rellena tu encuesta de Google Forms automáticamente, con perfiles y distribuciones
                configurables, desde una extensión de Chrome conectada a tu cuenta.
              </CardDescription>
            </div>
            <Badge>
              {formsBalance.available === null
                ? "Respuestas ilimitadas (admin)"
                : `${formsBalance.available.toLocaleString("es-PE")} respuesta${formsBalance.available === 1 ? "" : "s"} disponible${formsBalance.available === 1 ? "" : "s"}`}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-xl border border-border bg-background/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Conexión manual (opcional)</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {apiKeyInfo === null
                    ? "Cargando estado de tu clave..."
                    : apiKeyInfo.hasKey
                      ? `Clave activa terminada en ···${apiKeyInfo.last4} (creada el ${formatDateTime(apiKeyInfo.createdAt)})`
                      : "Puedes generar una clave si prefieres conectarla manualmente."}
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={generateKey} disabled={apiKeyBusy}>
                  {apiKeyBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                  {apiKeyInfo?.hasKey ? "Regenerar" : "Generar clave"}
                </Button>
                {apiKeyInfo?.hasKey && (
                  <Button size="sm" variant="outline" onClick={revokeKey} disabled={apiKeyBusy}>
                    Revocar
                  </Button>
                )}
              </div>
            </div>

            {newApiKey && (
              <div className="step-enter mt-4 rounded-lg border border-primary/40 bg-accent/60 p-3">
                <p className="text-xs font-semibold text-accent-foreground">
                  Copia tu clave ahora: por seguridad no volverá a mostrarse.
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <code className="flex-1 overflow-x-auto whitespace-nowrap rounded-md border border-border bg-background px-3 py-2 font-mono text-xs">
                    {newApiKey}
                  </code>
                  <Button size="sm" variant="outline" onClick={() => copyText(newApiKey)}>
                    {apiKeyCopied ? <Check className="h-4 w-4 text-primary" /> : null}
                    {apiKeyCopied ? "Copiada" : "Copiar"}
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div>
            <p className="text-sm font-semibold">Cómo conectar la extensión</p>
            <ol className="mt-3 space-y-3 text-sm text-muted-foreground">
              {[
                <>
                  Instala la extensión <strong className="text-foreground">Tutorica Forms</strong> desde la{" "}
                  <a
                    href="https://chromewebstore.google.com/detail/tutorica-forms/kdppbednjfajcjogdajmagfabidfjmem"
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-primary underline underline-offset-2 hover:opacity-80"
                  >
                    Chrome Web Store
                  </a>.
                </>,
                <>
                  Pulsa <strong className="text-foreground">Vincular con TesisHub</strong> y copia el código que aparece.
                </>,
                <>
                  Abre <strong className="text-foreground">Mi cuenta → Dispositivos de Forms</strong>, pega el código y aprueba la instalación.
                </>,
                <>
                  Vuelve a la extensión y verifica que la tarjeta de conexión diga{" "}
                  <strong className="text-foreground">Conectado</strong>.
                </>,
                <>Abre tu encuesta de Google Forms y configura el llenado desde el panel de la extensión.</>,
              ].map((paso, i) => (
                <li key={i} className="flex gap-3">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
                    {i + 1}
                  </span>
                  <span>{paso}</span>
                </li>
              ))}
            </ol>
          </div>

          <p className="text-xs text-muted-foreground">
            Forms descuenta únicamente las respuestas confirmadas como enviadas. Puedes solicitar
            cualquier cantidad cubierta por tu saldo; los trabajos grandes se procesan por lotes.
            {formsBalance.reserved > 0 && ` Tienes ${formsBalance.reserved.toLocaleString("es-PE")} respuestas reservadas en trabajos activos.`}
          </p>
          {formsBalance.available === 0 && onUpgrade && (
            <Button variant="outline" onClick={() => onUpgrade("Forms")}>
              Ampliar saldo de respuestas
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
