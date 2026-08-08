import { useEffect, useState } from "react";
import { Check, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { HierarchyEditor, ListEditorField } from "../wizard-fields";
import * as api from "../../lib/api";
import {
  aEditor,
  baremoPorDefecto,
  contarItems,
  desdeEditor,
  indicesItemsInversos,
} from "../../lib/instrumento";
import type { DimensionDef, Instrumento, InstrumentoNivel, Proyecto } from "../../lib/types";

// Editor del instrumento de un proyecto.
//
// Es el corazón de la Fase 4: aquí se define UNA vez lo que hoy se re-escribe
// en cada herramienta. Reutiliza el mismo HierarchyEditor del asistente de
// tabulación (ver lib/instrumento.ts para la traducción entre la forma que se
// guarda y la que se edita) en vez de tener dos editores que se desincronizan.
export function InstrumentoEditor({ apiBaseUrl, authToken, proyecto, onGuardado, onVolver }: {
  apiBaseUrl: string;
  authToken: string;
  proyecto: Proyecto;
  onGuardado: (p: Proyecto) => void;
  onVolver: () => void;
}) {
  const [escala, setEscala] = useState<string[]>(proyecto.instrumento.escala ?? []);
  const [nombres, setNombres] = useState<string[]>(
    () => proyecto.instrumento.variables.map((v) => v.nombre),
  );
  const [estructuras, setEstructuras] = useState<DimensionDef[][]>(
    () => proyecto.instrumento.variables.map((v) => aEditor(v)),
  );
  const [baremos, setBaremos] = useState<InstrumentoNivel[][]>(
    () => proyecto.instrumento.variables.map((v) => v.baremo ?? []),
  );
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);

  // Si se cambia de proyecto sin desmontar, hay que recargar su contenido.
  useEffect(() => {
    setEscala(proyecto.instrumento.escala ?? []);
    setNombres(proyecto.instrumento.variables.map((v) => v.nombre));
    setEstructuras(proyecto.instrumento.variables.map((v) => aEditor(v)));
    setBaremos(proyecto.instrumento.variables.map((v) => v.baremo ?? []));
  }, [proyecto]);

  const agregarVariable = () => {
    setNombres((n) => [...n, `Variable ${n.length + 1}`]);
    setEstructuras((e) => [...e, []]);
    setBaremos((b) => [...b, []]);
  };

  const quitarVariable = (i: number) => {
    setNombres((n) => n.filter((_, k) => k !== i));
    setEstructuras((e) => e.filter((_, k) => k !== i));
    setBaremos((b) => b.filter((_, k) => k !== i));
  };

  const proponerBaremo = (i: number) => {
    const total = contarItems(estructuras[i] ?? []);
    const propuesta = baremoPorDefecto(total, escala.length || 5);
    setBaremos((b) => b.map((v, k) => (k === i ? propuesta : v)));
  };

  const editarNivel = (vi: number, ni: number, campo: keyof InstrumentoNivel, valor: string) => {
    setBaremos((b) => b.map((niveles, k) => (k !== vi ? niveles : niveles.map((n, j) => (
      j !== ni ? n : { ...n, [campo]: campo === "nombre" ? valor : Number(valor) }
    )))));
  };

  const guardar = async () => {
    setError(null);
    setGuardado(false);
    const instrumento: Instrumento = {
      escala,
      variables: nombres.map((nombre, i) => ({
        nombre,
        dimensiones: desdeEditor(estructuras[i] ?? []),
        baremo: baremos[i] ?? [],
        itemsInversos: indicesItemsInversos(estructuras[i] ?? []),
      })),
    };
    setGuardando(true);
    try {
      const { proyecto: actualizado } = await api.actualizarProyecto(
        apiBaseUrl, authToken, proyecto.id, { instrumento, version: proyecto.version },
      );
      onGuardado(actualizado);
      setGuardado(true);
    } catch (err) {
      // El servidor valida de verdad (porcentajes que suman 100, máximo de
      // ítems...). Su mensaje es el que le sirve al usuario.
      setError(err instanceof Error ? err.message : "No se pudo guardar el instrumento.");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="step-enter mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight">Instrumento</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Proyecto <span className="font-medium text-foreground">{proyecto.nombre}</span>. Defínelo
            una vez y lo reutilizan todas las herramientas.
          </p>
        </div>
        <Button variant="ghost" onClick={onVolver}>Volver a mis proyectos</Button>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</div>
      )}
      {guardado && !error && (
        <div className="flex items-center gap-2 rounded-xl border border-green-500/40 bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-300">
          <Check className="h-4 w-4" />
          Instrumento guardado.
        </div>
      )}

      <Card className="rounded-2xl border-border/70 bg-card/95 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Escala de respuesta</CardTitle>
          <CardDescription>
            Las opciones que tienen tus preguntas, de menor a mayor. Ej: Nunca → Siempre.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ListEditorField
            label="Opciones de respuesta"
            placeholder="Ej: De acuerdo"
            values={escala}
            onChange={setEscala}
          />
        </CardContent>
      </Card>

      {nombres.map((nombre, i) => {
        const total = contarItems(estructuras[i] ?? []);
        const suma = (baremos[i] ?? []).reduce((a, n) => a + (Number(n.porcentaje) || 0), 0);
        return (
          <Card key={i} className="rounded-2xl border-border/70 bg-card/95 shadow-sm">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">Variable {i + 1}</CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-danger hover:bg-danger/10"
                  onClick={() => quitarVariable(i)}
                  aria-label={`Quitar variable ${i + 1}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <Input
                value={nombre}
                onChange={(e) => setNombres((n) => n.map((v, k) => (k === i ? e.target.value : v)))}
                placeholder="Ej: Gestión de abastecimiento"
                aria-label={`Nombre de la variable ${i + 1}`}
                className="mt-2"
              />
            </CardHeader>
            <CardContent className="space-y-5">
              <HierarchyEditor
                label={nombre || `Variable ${i + 1}`}
                totalItems={total}
                estructura={estructuras[i] ?? []}
                onChange={(next) => setEstructuras((e) => e.map((v, k) => (k === i ? next : v)))}
              />

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">Baremo</p>
                  <Button variant="outline" size="sm" onClick={() => proponerBaremo(i)}>
                    Calcular niveles
                  </Button>
                </div>
                {(baremos[i] ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Sin baremo. Pulsa &laquo;Calcular niveles&raquo; para proponer uno a partir de los
                    {" "}{total} ítem(s) y las {escala.length || "?"} opciones de respuesta.
                  </p>
                ) : (
                  <>
                    <div className="space-y-2">
                      {(baremos[i] ?? []).map((n, ni) => (
                        <div key={ni} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                          <Input value={n.nombre} onChange={(e) => editarNivel(i, ni, "nombre", e.target.value)} placeholder="Nivel" aria-label={`Nombre del nivel ${ni + 1} de la variable ${i + 1}`} />
                          <Input value={String(n.desde)} onChange={(e) => editarNivel(i, ni, "desde", e.target.value)} placeholder="Desde" aria-label={`Desde, nivel ${ni + 1} de la variable ${i + 1}`} />
                          <Input value={String(n.hasta)} onChange={(e) => editarNivel(i, ni, "hasta", e.target.value)} placeholder="Hasta" aria-label={`Hasta, nivel ${ni + 1} de la variable ${i + 1}`} />
                          <Input value={String(n.porcentaje)} onChange={(e) => editarNivel(i, ni, "porcentaje", e.target.value)} placeholder="%" aria-label={`Porcentaje, nivel ${ni + 1} de la variable ${i + 1}`} />
                        </div>
                      ))}
                    </div>
                    {/* El porcentaje NO es decorativo: la simulación lo respeta,
                        así que se avisa antes de intentar guardar. */}
                    <p className={suma === 100 ? "text-xs text-muted-foreground" : "text-xs font-medium text-amber-700 dark:text-amber-400"}>
                      Los porcentajes suman {suma}%{suma === 100 ? " ✓" : " — deben sumar exactamente 100%"}
                    </p>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}

      {nombres.length < 2 && (
        <Button variant="outline" className="w-full" onClick={agregarVariable}>
          <Plus className="h-4 w-4" />
          Añadir variable
        </Button>
      )}

      <div className="flex justify-end">
        <Button onClick={guardar} disabled={guardando}>
          {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Guardar instrumento
        </Button>
      </div>
    </div>
  );
}
