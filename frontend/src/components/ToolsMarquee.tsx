import { NAV_TOOLS } from "../lib/nav";

// Marquee infinito con las herramientas del producto. Animación CSS pura
// (keyframes en index.css): la pista lleva la lista duplicada y se desplaza
// -50%, con pausa on hover y máscara de desvanecido en los bordes.
export function ToolsMarquee() {
  const chips = (hidden: boolean) => (
    <div className="flex shrink-0 gap-4 pr-4" aria-hidden={hidden || undefined}>
      {NAV_TOOLS.map((tool) => (
        <div
          key={tool.id}
          className="group relative flex h-24 w-44 shrink-0 flex-col items-center justify-center gap-2 overflow-hidden rounded-full border border-border/60 bg-card px-4 shadow-sm transition-all hover:border-primary/30"
        >
          <span className="absolute inset-0 scale-150 rounded-full bg-gradient-to-br from-primary/10 to-transparent opacity-0 transition-all duration-300 group-hover:scale-100 group-hover:opacity-100" />
          <tool.icon className="relative h-5 w-5 text-primary" />
          <span className="relative text-center text-xs font-medium leading-tight text-foreground">{tool.label}</span>
        </div>
      ))}
    </div>
  );

  return (
    <div className="marquee relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]">
      <div className="marquee-track flex w-max">
        {chips(false)}
        {chips(true)}
      </div>
    </div>
  );
}
