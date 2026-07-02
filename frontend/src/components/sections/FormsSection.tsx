import { useEffect, useState } from "react";
import { Check, KeyRound, Loader2, Server } from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { createApiKey, getApiKeyInfo, revokeApiKey, type ApiKeyInfo } from "../../lib/api";
import { formatDateTime } from "../../lib/helpers";
import type { AuthUser } from "../../lib/types";

// Sección Forms / Integraciones: clave de API para la extensión Tutorica
// Forms. Autocontenida: App la monta cuando la sección está activa, por eso
// carga el estado de la clave en el mount.
export function FormsSection({ apiBaseUrl, authToken, authUser }: {
  apiBaseUrl: string;
  authToken: string;
  authUser: AuthUser;
}) {
  const usesLeft = authUser.role === "admin" ? null : (authUser.formsUsesLeft ?? 0);
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
        <h2 className="text-2xl font-bold tracking-tight">Forms</h2>
        <p className="mt-1 text-sm text-muted-foreground">Servicios incluidos con tu suscripción.</p>
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
              {usesLeft === null ? "Usos ilimitados (admin)" : `${usesLeft} uso${usesLeft === 1 ? "" : "s"} disponible${usesLeft === 1 ? "" : "s"}`}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-xl border border-border bg-background/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Tu clave de API</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {apiKeyInfo === null
                    ? "Cargando estado de tu clave..."
                    : apiKeyInfo.hasKey
                      ? `Clave activa terminada en ···${apiKeyInfo.last4} (creada el ${formatDateTime(apiKeyInfo.createdAt)})`
                      : "Aún no tienes una clave. Genérala para conectar la extensión."}
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
                  Abre la extensión e <strong className="text-foreground">inicia sesión</strong> con tu correo y
                  contraseña de TesisTab: tu clave de API se configura sola. (También puedes pegar una clave
                  manual en "Avanzado".)
                </>,
                <>
                  Verifica que la tarjeta de conexión del popup diga{" "}
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
            Forms funciona por usos: cada corrida de llenado consume 1 uso, sin importar cuántas
            respuestas envíe. Cuando se agoten, solicita una recarga al administrador. La clave además
            requiere que tu suscripción esté vigente.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
