import { useEffect, useMemo, useState } from "react";
import { Check, FolderOpen, Loader2, Plus, Search, SlidersHorizontal, Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { InstrumentoEditor } from "./InstrumentoEditor";
import * as api from "../../lib/api";
import { tiempoRelativo } from "../../lib/helpers";
import { RUTA, hecho, pasosHechos, siguientePaso } from "../../lib/ruta";
import { cn } from "../../lib/utils";
import type { AuthUser, Proyecto } from "../../lib/types";

// A partir de esta cantidad de proyectos aparece el buscador. Con tres tesis
// buscar sobra; con quince, recorrer la lista a ojo es el problema.
const MINIMO_PARA_BUSCAR = 6;

// "Mis proyectos".
//
// Esta pantalla tiene que servir a dos personas distintas: al tesista con UNA
// tesis y al asesor con quince. Antes solo servía al primero: tarjetas grandes,
// tres botones por fila y ninguna señal de en qué anda cada trabajo, así que
// con diez proyectos era un muro que había que leer entero.
//
// Ahora cada proyecto es una fila escaneable que dice lo único que importa de
// un vistazo: cómo se llama, cuántos pasos lleva y cuál le toca. Las acciones
// secundarias aparecen en la fila activa, no repetidas quince veces.
export function ProyectosSection({ apiBaseUrl, authToken, authUser, proyectoActivoId, onSeleccionar }: {
  apiBaseUrl: string;
  authToken: string;
  authUser: AuthUser;
  proyectoActivoId: string | null;
  onSeleccionar: (proyecto: Proyecto | null) => void;
}) {
  const [proyectos, setProyectos] = useState<Proyecto[] | null>(null);
  const [limite, setLimite] = useState<number>(0);
  const [busqueda, setBusqueda] = useState("");
  const [nombre, setNombre] = useState("");
  const [creando, setCreando] = useState(false);
  // El formulario de crear no vive abierto: con muchos proyectos, listar es lo
  // frecuente y crear lo raro.
  const [creandoAbierto, setCreandoAbierto] = useState(false);
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

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const filtrados = q
      ? (proyectos ?? []).filter((p) => p.nombre.toLowerCase().includes(q))
      : (proyectos ?? []);
    // El servidor ya los manda por fecha, pero la tesis abierta va primero:
    // con quince proyectos, tener que buscarla para cerrarla o ver su
    // instrumento es justo lo que hace pesada la pantalla.
    return [...filtrados].sort((a, b) => {
      if (a.id === proyectoActivoId) return -1;
      if (b.id === proyectoActivoId) return 1;
      return 0;
    });
  }, [proyectos, busqueda, proyectoActivoId]);

  const crear = async () => {
    setError(null);
    if (!nombre.trim()) { setError("Ponle un nombre a tu proyecto."); return; }
    setCreando(true);
    try {
      const { proyecto } = await api.crearProyecto(apiBaseUrl, authToken, { nombre: nombre.trim() });
      setNombre("");
      setCreandoAbierto(false);
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

  const total = proyectos?.length ?? 0;
  const alLimite = proyectos !== null && limite > 0 && total >= limite;

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
    <div className="step-enter mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight">Mis proyectos</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Cada proyecto guarda el instrumento de una tesis y lleva la cuenta de lo que ya hiciste.
            Las herramientas también funcionan sueltas, sin crear ninguno.
          </p>
        </div>
        <Button onClick={() => setCreandoAbierto((v) => !v)} disabled={alLimite} className="shrink-0">
          <Plus className="h-4 w-4" />
          Nueva tesis
        </Button>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</div>
      )}

      {creandoAbierto && !alLimite && (
        <div className="flex flex-wrap gap-2 rounded-2xl border border-primary/30 bg-primary/[0.05] p-3">
          <Input
            autoFocus
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Ej: Clima laboral en la Municipalidad de Lima"
            className="h-10 min-w-[16rem] flex-1"
            onKeyDown={(e) => {
              if (e.key === "Enter") crear();
              if (e.key === "Escape") setCreandoAbierto(false);
            }}
          />
          <Button onClick={crear} disabled={creando}>
            {creando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Crear
          </Button>
          <Button variant="ghost" onClick={() => setCreandoAbierto(false)}>Cancelar</Button>
        </div>
      )}

      {alLimite && (
        <p className="rounded-xl border border-border/70 bg-muted/40 p-3 text-sm text-muted-foreground">
          Llegaste a los {limite} proyectos de tu plan {authUser.plan}. Elimina uno o amplía tu plan
          para empezar otra tesis.
        </p>
      )}

      {total >= MINIMO_PARA_BUSCAR && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder={`Buscar entre ${total} proyectos`}
            className="h-10 pl-9"
            aria-label="Buscar proyectos por nombre"
          />
        </div>
      )}

      {proyectos === null ? (
        // El esqueleto tiene la forma de las filas reales, para que la lista no
        // salte cuando lleguen.
        <div className="space-y-2" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[68px] animate-pulse rounded-2xl border border-border/50 bg-muted/40" />
          ))}
        </div>
      ) : total === 0 ? (
        <div className="rounded-3xl border border-dashed border-border/70 p-10 text-center">
          <FolderOpen className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">Todavía no tienes proyectos</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Crea el primero y define su instrumento una sola vez: la Tabulación y la Confiabilidad
            lo van a leer de ahí.
          </p>
          <Button className="mt-4" onClick={() => setCreandoAbierto(true)}>
            <Plus className="h-4 w-4" />
            Crear mi primera tesis
          </Button>
        </div>
      ) : visibles.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border/70 p-8 text-center text-sm text-muted-foreground">
          Ningún proyecto se llama así.
        </p>
      ) : (
        <ul className="space-y-2">
          {visibles.map((p) => {
            const activo = p.id === proyectoActivoId;
            const hechos = pasosHechos(p);
            const siguiente = siguientePaso(p);
            return (
              <li
                key={p.id}
                className={cn(
                  "rounded-2xl border transition-colors",
                  activo ? "border-primary/50 bg-primary/[0.04]" : "border-border/60 bg-card hover:border-border",
                )}
              >
                <button
                  onClick={() => onSeleccionar(activo ? null : p)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left"
                  aria-pressed={activo}
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2">
                      {activo && <Check className="h-4 w-4 shrink-0 text-primary" />}
                      <span className="truncate font-medium">{p.nombre}</span>
                    </p>
                    <p
                      className="mt-0.5 truncate text-xs text-muted-foreground"
                      title={new Date(p.updatedAt).toLocaleString()}
                    >
                      {siguiente ? `Sigue: ${siguiente.label}` : "Ruta completa"}
                      {" · "}{tiempoRelativo(p.updatedAt)}
                    </p>
                  </div>

                  {/* Progreso como puntos, uno por paso. Con quince proyectos,
                      comparar formas es mucho más rápido que leer textos. */}
                  <span
                    className="hidden shrink-0 items-center gap-1 sm:flex"
                    title={`${hechos} de ${RUTA.length} pasos`}
                  >
                    {RUTA.map((paso) => (
                      <span
                        key={paso.id}
                        className={cn(
                          "h-1.5 w-4 rounded-full",
                          hecho(p, paso.id) ? "bg-primary" : "bg-muted-foreground/25",
                        )}
                      />
                    ))}
                    <span className="ml-1.5 w-8 text-right text-xs tabular-nums text-muted-foreground">
                      {hechos}/{RUTA.length}
                    </span>
                  </span>
                </button>

                {/* Las acciones aparecen solo en el proyecto abierto: repetirlas
                    en cada fila era lo que convertía la lista en un muro. */}
                {activo && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-border/50 px-4 py-2.5">
                    <Button variant="outline" size="sm" onClick={() => setEditando(p)}>
                      <SlidersHorizontal className="h-4 w-4" />
                      {p.instrumento.variables.length === 0 ? "Definir instrumento" : "Instrumento"}
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      {p.instrumento.variables.length === 0
                        ? "Sin instrumento todavía"
                        : `${p.instrumento.variables.length} variable(s) · ${
                          p.instrumento.variables.reduce((a, v) => a + (v.totalItems ?? 0), 0)} ítem(s)`}
                    </span>
                    <span className="flex-1" />
                    {confirmando === p.id ? (
                      <>
                        <span className="text-xs text-muted-foreground">Se borra con su instrumento</span>
                        <Button
                          size="sm"
                          className="bg-danger-deep text-white hover:bg-danger-deep/90"
                          onClick={() => eliminar(p)}
                          onKeyDown={(e) => e.key === "Escape" && setConfirmando(null)}
                        >
                          Eliminar
                        </Button>
                        {/* autoFocus en "Cancelar", no en "Eliminar": el botón que
                            abrió esta confirmación (el icono de papelera) se
                            desmonta al confirmar, así que el foco se perdía
                            (caía al body). Se enfoca la opción segura y no la
                            destructiva, para que un Enter de más no borre nada. */}
                        <Button
                          variant="ghost"
                          size="sm"
                          autoFocus
                          onClick={() => setConfirmando(null)}
                          onKeyDown={(e) => e.key === "Escape" && setConfirmando(null)}
                        >
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
                )}
              </li>
            );
          })}
        </ul>
      )}

      {total > 0 && (
        <p className="text-center text-xs text-muted-foreground">
          {total} de {limite} proyectos de tu plan {authUser.plan}. Son privados: nadie más puede
          verlos, ni el administrador.
        </p>
      )}
    </div>
  );
}
