import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Button, type ButtonProps } from "./button";
import { cn } from "../../lib/utils";

// Botón "mágico" para los generadores: chispas que flotan al pasar el mouse y
// una ráfaga tipo despegue (escape hacia abajo + salto del botón) al
// presionar. Mantiene el color y las clases del Button normal; las partículas
// usan solo transform/opacity (GPU) y se desactivan con prefers-reduced-motion.

interface Particle {
  id: number;
  left: number; // % a lo ancho del botón
  edge: "top" | "bottom";
  dx: number; // deriva horizontal en px
  dy: number; // recorrido vertical en px (negativo = sube)
  size: number;
  duration: number;
  star: boolean; // rombo (estrella) o punto
  bright: boolean;
}

let particleSeq = 0;
const rand = (min: number, max: number) => min + Math.random() * (max - min);

export function MagicButton({ className, children, disabled, onPointerDown, ...props }: ButtonProps) {
  const reduce = useReducedMotion() ?? false;
  const [particles, setParticles] = useState<Particle[]>([]);
  const [hovered, setHovered] = useState(false);
  const cleanups = useRef<number[]>([]);

  useEffect(() => () => cleanups.current.forEach((t) => window.clearTimeout(t)), []);

  const spawn = (batch: Particle[]) => {
    setParticles((prev) => [...prev, ...batch].slice(-48));
    const maxMs = Math.max(...batch.map((p) => p.duration)) * 1000 + 120;
    cleanups.current.push(window.setTimeout(() => {
      setParticles((prev) => prev.filter((p) => !batch.some((b) => b.id === p.id)));
    }, maxMs));
  };

  // Chispas suaves que suben mientras el cursor está encima.
  useEffect(() => {
    if (!hovered || disabled || reduce) return;
    const timer = window.setInterval(() => {
      spawn([{
        id: particleSeq += 1,
        left: rand(6, 94),
        edge: "top",
        dx: rand(-12, 12),
        dy: rand(-38, -16),
        size: rand(2.5, 4.5),
        duration: rand(0.7, 1.1),
        star: Math.random() < 0.35,
        bright: Math.random() < 0.5,
      }]);
    }, 150);
    return () => window.clearInterval(timer);
  }, [hovered, disabled, reduce]);

  // Despegue: ráfaga de escape por el borde inferior + un par de chispas
  // que salen disparadas hacia arriba.
  const launch = () => {
    if (disabled || reduce) return;
    const exhaust: Particle[] = Array.from({ length: 14 }, () => ({
      id: particleSeq += 1,
      left: rand(10, 90),
      edge: "bottom" as const,
      dx: rand(-30, 30),
      dy: rand(16, 44),
      size: rand(3, 6),
      duration: rand(0.45, 0.8),
      star: Math.random() < 0.25,
      bright: Math.random() < 0.7,
    }));
    const sparks: Particle[] = Array.from({ length: 5 }, () => ({
      id: particleSeq += 1,
      left: rand(15, 85),
      edge: "top" as const,
      dx: rand(-22, 22),
      dy: rand(-55, -30),
      size: rand(2.5, 4),
      duration: rand(0.5, 0.85),
      star: Math.random() < 0.5,
      bright: true,
    }));
    spawn([...exhaust, ...sparks]);
  };

  return (
    <Button
      {...props}
      disabled={disabled}
      className={cn("relative", className)}
      onPointerEnter={(e) => { setHovered(true); props.onPointerEnter?.(e); }}
      onPointerLeave={(e) => { setHovered(false); props.onPointerLeave?.(e); }}
      onPointerDown={(e) => { launch(); onPointerDown?.(e); }}
    >
      {/* Capa de partículas: no captura eventos ni lectores de pantalla. */}
      <span aria-hidden className="pointer-events-none absolute inset-0">
        {particles.map((p) => (
          <motion.span
            key={p.id}
            className={cn(
              "absolute block",
              p.star ? "rotate-45 rounded-[1px]" : "rounded-full",
              p.bright ? "bg-primary-foreground" : "bg-primary-foreground/50",
            )}
            style={{
              left: `${p.left}%`,
              ...(p.edge === "top" ? { top: "18%" } : { bottom: -3 }),
              width: p.size,
              height: p.size,
            }}
            initial={{ opacity: 0.95, x: 0, y: 0, scale: 1 }}
            animate={{ opacity: 0, x: p.dx, y: p.dy, scale: 0.15 }}
            transition={{ duration: p.duration, ease: "easeOut" }}
          />
        ))}
      </span>
      <span className="relative inline-flex items-center gap-2">{children}</span>
    </Button>
  );
}
