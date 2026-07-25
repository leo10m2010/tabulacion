import { ArrowRight, Check, FolderOpen, Plus } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import { NAV_GROUPS, NAV_TOOLS } from "../../lib/nav";
import { RUTA, hecho, pasosHechos, siguientePaso } from "../../lib/ruta";
import { tiempoRelativo } from "../../lib/helpers";
import type { AppSection, AuthUser, Proyecto, UseTool } from "../../lib/types";

// Inicio.
//
// Primera versión: una rejilla de siete tarjetas idénticas que no sabía nada de
// quien la miraba. Segunda: la ruta como lista vertical de siete filas, que
// arreglaba el fondo pero no la forma — al entrecerrar los ojos, el único dato
// que importa ("qué me toca ahora") tenía exactamente el mismo tamaño que los
// seis pasos que NO tocan, y gastaba media pantalla en decir una frase.
//
// Esta versión parte de que el progreso es una POSICIÓN, y una posición se lee
// horizontal: la ruta cabe en una franja delgada y el paso siguiente se queda
// con el peso visual entero.
export function HomeSection({ user, proyecto, proyectosTotal, onNavigate }: {
  user: AuthUser;
  proyecto: Proyecto | null;
  proyectosTotal: number;
  onNavigate: (section: AppSection) => void;
}) {
  const rawName = user.email.split("@")[0];
  const firstName = rawName.charAt(0).toUpperCase() + rawName.slice(1);

  if (!proyecto) return <SinProyecto nombre={firstName} proyectosTotal={proyectosTotal} onNavigate={onNavigate} user={user} />;

  const siguiente = siguientePaso(proyecto);
  const hechos = pasosHechos(proyecto);

  return (
    <div className="step-enter mx-auto max-w-4xl">
      {/* Contexto: pequeño a propósito. Dice de qué tesis hablamos, no compite
          con la acción. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="min-w-0 truncate font-display text-lg font-semibold tracking-tight">
          {proyecto.nombre}
        </h2>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="tabular-nums">{hechos} de {RUTA.length} pasos</span>
          {proyectosTotal > 1 && (
            <button
              onClick={() => onNavigate("proyectos")}
              className="rounded font-medium text-primary underline-offset-4 hover:underline"
            >
              Cambiar de tesis
            </button>
          )}
        </div>
      </div>
      {/* El título elegido, cuando ya lo hay: es el dato que el tesista repite
          en cada documento y tenerlo a la vista ahorra ir a buscarlo. */}
      {proyecto.titulo && (
        <p className="mt-1 max-w-[70ch] text-sm text-muted-foreground">{proyecto.titulo}</p>
      )}

      <Ruta proyecto={proyecto} siguienteId={siguiente?.id ?? null} onNavigate={onNavigate} />

      {/* La acción. Es lo único grande de la pantalla, y por eso se ve primero. */}
      {siguiente ? (
        <div className="mt-8 rounded-3xl border border-border/60 bg-card p-6 shadow-sm sm:p-8">
          <p className="text-sm text-muted-foreground">Lo que sigue</p>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <h3 className="font-display text-[1.75rem] font-bold leading-tight tracking-tight sm:text-4xl">
                {siguiente.label}
              </h3>
              <p className="mt-2 max-w-[52ch] text-sm text-muted-foreground">{siguiente.resultado}</p>
            </div>
            <Button size="lg" className="shrink-0" onClick={() => onNavigate(siguiente.seccion)}>
              Empezar
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
          {siguiente.opcional && (
            <p className="mt-4 border-t border-border/50 pt-3 text-xs text-muted-foreground">
              Este paso es opcional: no todas las tesis lo llevan.
            </p>
          )}
        </div>
      ) : (
        <div className="mt-8 rounded-3xl border border-primary/30 bg-primary/[0.06] p-6 sm:p-8">
          <h3 className="font-display text-[1.75rem] font-bold leading-tight tracking-tight sm:text-4xl">
            Ruta completa
          </h3>
          <p className="mt-2 max-w-[52ch] text-sm text-muted-foreground">
            Pasaste por los siete pasos de esta tesis. Puedes volver a cualquiera para rehacerlo,
            o empezar otra.
          </p>
          <Button variant="outline" className="mt-4" onClick={() => onNavigate("proyectos")}>
            <Plus className="h-4 w-4" />
            Empezar otra tesis
          </Button>
        </div>
      )}

      {/* Las herramientas ya están en la barra lateral, siempre visibles.
          Repetirlas como siete tarjetas grandes no informaba de nada: aquí van
          como accesos compactos, secundarios. */}
      <div className="mt-10 border-t border-border/60 pt-5">
        <p className="text-sm text-muted-foreground">Ir directo a una herramienta</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {NAV_TOOLS.map((tool) => (
            <button
              key={tool.id}
              onClick={() => onNavigate(tool.id)}
              className="flex items-center gap-2 rounded-full border border-border/60 bg-card px-3.5 py-2 text-sm font-medium transition-colors hover:border-primary/40 hover:bg-accent active:scale-[0.99]"
            >
              <tool.icon className="h-4 w-4 text-muted-foreground" />
              {tool.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// La ruta como franja: siete segmentos en fila. Ocupa una décima parte de lo
// que ocupaba en vertical y se lee de un golpe, que es lo propio de una
// posición. En pantallas angostas se desplaza en horizontal en vez de apilarse
// (apilada volvería a ser la lista que no funcionaba).
function Ruta({ proyecto, siguienteId, onNavigate }: {
  proyecto: Proyecto;
  siguienteId: string | null;
  onNavigate: (section: AppSection) => void;
}) {
  return (
    <div className="scroll-discreto -mx-1 mt-5 flex gap-1.5 overflow-x-auto px-1 pb-1">
      {RUTA.map((paso) => {
        const listo = hecho(proyecto, paso.id);
        const actual = siguienteId === paso.id;
        return (
          <button
            key={paso.id}
            onClick={() => onNavigate(paso.seccion)}
            title={listo ? `${paso.label}: hecho ${tiempoRelativo(proyecto.progreso[paso.id])}` : paso.resultado}
            className="group min-w-[5.5rem] flex-1 rounded-xl px-1.5 pb-1.5 pt-2 text-left transition-colors hover:bg-accent"
          >
            <span
              className={cn(
                "block h-1.5 rounded-full transition-colors",
                listo ? "bg-primary" : actual ? "bg-primary/40" : "bg-muted-foreground/20",
              )}
            />
            <span className="mt-2 flex items-center gap-1">
              {listo && <Check className="h-3 w-3 shrink-0 text-primary" />}
              <span
                className={cn(
                  "truncate text-xs",
                  actual ? "font-semibold text-foreground" : listo ? "text-muted-foreground" : "text-muted-foreground/70",
                )}
              >
                {paso.corto ?? paso.label}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

// Sin proyecto activo. Aquí las tarjetas SÍ hacen falta: es la pantalla donde
// alguien descubre qué hay, y la descripción de cada herramienta es lo que
// enseña el producto.
function SinProyecto({ nombre, proyectosTotal, onNavigate, user }: {
  nombre: string;
  proyectosTotal: number;
  onNavigate: (section: AppSection) => void;
  user: AuthUser;
}) {
  return (
    <div className="step-enter mx-auto max-w-5xl space-y-8">
      <div>
        <h2 className="font-display text-2xl font-bold tracking-tight">
          Hola, <span className="text-primary">{nombre}</span>
        </h2>
        <p className="mt-1 max-w-[62ch] text-sm text-muted-foreground">
          Elige una herramienta y empieza. Si abres una tesis, la app recuerda tu instrumento y te
          va marcando por dónde vas.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-border/70 px-5 py-4">
        <div className="flex min-w-0 items-start gap-2.5">
          <FolderOpen className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {proyectosTotal > 0
              ? "Tienes tesis guardadas. Abre una y esta pantalla te lleva por el siguiente paso."
              : "Una tesis guarda tu instrumento y lleva la cuenta de lo que ya hiciste."}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => onNavigate("proyectos")}>
          {proyectosTotal > 0 ? "Abrir una tesis" : <><Plus className="h-4 w-4" />Crear mi primera tesis</>}
        </Button>
      </div>

      {NAV_GROUPS.map((group) => (
        <section key={group.id}>
          <p className="mb-3 text-sm font-medium">{group.label}</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {group.tools.map((tool) => (
              <button
                key={tool.id}
                onClick={() => onNavigate(tool.id)}
                className="group rounded-3xl border border-border/60 bg-card p-6 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-soft active:scale-[0.99]"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <tool.icon className="h-5 w-5" />
                  </div>
                  {user.role !== "admin" && (() => {
                    const left = user.uses?.[tool.id as UseTool] ?? 0;
                    return (
                      <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium tabular-nums text-muted-foreground">
                        {left} {left === 1 ? "uso" : "usos"}
                      </span>
                    );
                  })()}
                </div>
                <h3 className="mt-4 font-display text-base font-semibold tracking-tight">{tool.label}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{tool.description}</p>
                <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary">
                  Abrir
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
