import { useEffect, useState } from "react";
import { Check, FolderOpen, Loader2, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { InstrumentoEditor } from "./InstrumentoEditor";
import * as api from "../../lib/api";
import { formatDateTime } from "../../lib/helpers";
import { cn } from "../../lib/utils";
import type { AuthUser, Proyecto } from "../../lib/types";

// Sección "Mis proyectos".
//
// El proyecto es el sitio donde el instrumento (escala, variables, dimensiones,
// indicadores e ítems) se define UNA vez. Hoy cada herramienta lo pide de nuevo
// desde cero, y tras las observaciones del jurado hay que reconstruirlo entero:
// es la recomendación #1 de la auditoría UX.
//
// Los archivos de un proyecto NO caducan: viven mientras exista el proyecto y
// se borran cuando su dueño lo borra. Una tesis dura meses.
export function ProyectosSection({ apiBaseUrl, authToken, authUser, proyectoActivoId, onSeleccionar }: {
  apiBaseUrl: string;
  authToken: string;
  authUser: AuthUser;
  proyectoActivoId: string | null;
  onSeleccionar: (proyecto: Proyecto | null) => void;
}) {
  const [proyectos, setProyectos] = useState<Proyecto[] | null>(null);
  const [limite, setLimite] = useState<number>(0);
  const [nombre, setNombre] = useState("");
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Se confirma antes de borrar: es irreversible y se lleva el instrumento.
  const [confirmando, setConfirmando] = useState<string | null>(null);
  // Proyecto cuyo instrumento se está editando (null = se ve la lista).
  const [editando, setEditando] = useState<Proyecto | null>(null);

  // Un contador en vez de una función suelta: así las dependencias del efecto
  // quedan declaradas de verdad (sin silenciar la regla) y recargar es
  // simplemente incrementarlo.
  const [recarga, setRecarga] = useState(0);
  const recargar = () => setRecarga((n) => n + 1);

  useEffect(() => {
    let vivo = true;
    api.listarProyectos(apiBaseUrl, authToken)
      .then((r) => {
        if (!vivo) return;
        setProyectos(r.proyectos);
        setLimite(r.limite);
      })
      .catch((err) => {
        if (!vivo) return;
        setError(err instanceof Error ? err.message : "No se pudieron cargar tus proyectos.");
        setProyectos([]);
      });
    return () => { vivo = false; };
  }, [apiBaseUrl, authToken, recarga]);

  const crear = async () => {
    setError(null);
    if (!nombre.trim()) { setError("Ponle un nombre a tu proyecto."); return; }
    setCreando(true);
    try {
      const { proyecto } = await api.crearProyecto(apiBaseUrl, authToken, { nombre: nombre.trim() });
      setNombre("");
      recargar();
      // Recién creado se vuelve el activo: es lo que el usuario espera.
      onSeleccionar(proyecto);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear el proyecto.");
    } finally {
      setCreando(false);
    }
  };

  const eliminar = async (p: Proyecto) => {
    setError(null);
    try {
      await api.eliminarProyecto(apiBaseUrl, authToken, p.id);
      if (proyectoActivoId === p.id) onSeleccionar(null);
      setConfirmando(null);
      recargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar el proyecto.");
    }
  };

  const alLimite = proyectos !== null && limite > 0 && proyectos.length >= limite;

  if (editando) {
    return (
      <InstrumentoEditor
        apiBaseUrl={apiBaseUrl}
        authToken={authToken}
        proyecto={editando}
        onGuardado={(actualizado) => {
          setEditando(actualizado);
          // Si es el proyecto activo, lo que tiene App en memoria acaba de
          // quedar viejo: las herramientas leerían el instrumento anterior.
          if (proyectoActivoId === actualizado.id) onSeleccionar(actualizado);
          recargar();
        }}
        onVolver={() => setEditando(null)}
      />
    );
  }

  return (
    <div className="step-enter mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="font-display text-2xl font-bold tracking-tight">Mis proyectos</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Un proyecto guarda tu instrumento —variables, dimensiones, indicadores e ítems— para no
          volver a escribirlo en cada herramienta.
        </p>
        {/* El proyecto acelera, no obliga: quien solo quiere una tabulación
            suelta entra a la herramienta y listo. */}
        <p className="mt-1 text-sm text-muted-foreground">
          Es opcional: todas las herramientas funcionan por su cuenta, sin crear ningún proyecto.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</div>
      )}

      <Card className="rounded-2xl border-border/70 bg-card/95 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Nuevo proyecto</CardTitle>
          <CardDescription>
            {limite > 0
              ? `Tu plan ${authUser.plan} permite ${limite} proyecto${limite === 1 ? "" : "s"} a la vez.`
              : "Empieza por darle un nombre; el instrumento se define después."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Ej: Clima laboral en la Municipalidad de Lima"
            className="h-10 min-w-[16rem] flex-1"
            disabled={alLimite}
            onKeyDown={(e) => e.key === "Enter" && !alLimite && crear()}
          />
          <Button onClick={crear} disabled={creando || alLimite}>
            {creando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Crear
          </Button>
        </CardContent>
      </Card>

      {proyectos === null ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : proyectos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/70 p-8 text-center">
          <FolderOpen className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            Todavía no tienes proyectos. Crea el primero arriba.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {proyectos.map((p) => {
            const activo = p.id === proyectoActivoId;
            const items = p.instrumento.variables.reduce((a, v) => a + (v.totalItems ?? 0), 0);
            return (
              <Card
                key={p.id}
                className={cn(
                  "rounded-2xl shadow-sm transition-colors",
                  activo ? "border-primary/50 bg-primary/[0.04]" : "border-border/70 bg-card/95",
                )}
              >
                <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 font-medium">
                      {activo && <Check className="h-4 w-4 shrink-0 text-primary" />}
                      <span className="truncate">{p.nombre}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {p.instrumento.variables.length === 0
                        ? "Sin instrumento todavía"
                        : `${p.instrumento.variables.length} variable(s) · ${items} ítem(s)`}
                      {" · "}actualizado {formatDateTime(p.updatedAt)}
                    </p>
                  </div>

                  <div className="flex shrink-0 gap-2">
                    {!activo && (
                      <Button variant="outline" size="sm" onClick={() => onSeleccionar(p)}>
                        Usar este
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => setEditando(p)}>
                      <SlidersHorizontal className="h-4 w-4" />
                      {p.instrumento.variables.length === 0 ? "Definir instrumento" : "Instrumento"}
                    </Button>
                    {confirmando === p.id ? (
                      <>
                        <Button
                          size="sm"
                          className="bg-danger text-white hover:bg-danger/90"
                          onClick={() => eliminar(p)}
                        >
                          Confirmar
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setConfirmando(null)}>
                          Cancelar
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-danger hover:bg-danger/10"
                        onClick={() => setConfirmando(p.id)}
                        aria-label={`Eliminar ${p.nombre}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <p className="text-center text-xs text-muted-foreground">
        Tus proyectos son privados: nadie más puede verlos, ni el administrador.
      </p>
    </div>
  );
}
