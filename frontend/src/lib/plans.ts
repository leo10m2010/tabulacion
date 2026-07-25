import type { LucideIcon } from "lucide-react";
import { Building2, GraduationCap, UserRound } from "lucide-react";

// Fuente única de los planes de pago: la consumen la sección "Planes y precios"
// de la landing y la página "Mejorar mi plan" de dentro de la app.
//
// Estaban solo en LandingPage.tsx. Al aparecer una segunda pantalla que los
// necesita, se extraen aquí: duplicarlos habría repetido el problema que ya
// tuvimos con PLAN_PRESETS (dos copias sincronizadas a mano por un comentario),
// y aquí el coste de que se desincronicen es cobrar un precio equivocado.
//
// Las cuotas por herramienta viven en el backend (PLAN_PRESETS, servidas por
// GET /config). Lo de aquí es la parte comercial: precios y argumentos.

export interface Plan {
  id: string;
  name: string;
  audience: string;
  icon: LucideIcon;
  priceMonthlyUsd: string;
  priceYearlyUsd: string;
  priceMonthlyPen: string;
  priceYearlyPen: string;
  description: string;
  highlights: string[];
  cta: string;
  featured: boolean;
  // true = no se contrata solo, se habla con una persona.
  contactOnly?: boolean;
}

export const PLANS: Plan[] = [
  {
    id: "esencial",
    name: "Plan Esencial",
    audience: "Para empezar",
    icon: UserRound,
    priceMonthlyUsd: "USD 15",
    priceYearlyUsd: "USD 150",
    priceMonthlyPen: "S/ 49",
    priceYearlyPen: "S/ 490",
    description: "Para trabajos académicos puntuales o para probar el sistema en serio.",
    highlights: [
      "2 tabulaciones y 2 pruebas de confiabilidad",
      "3 bases descriptivas con IA",
      "3 generaciones de títulos y 1 matriz",
      "5 humanizaciones de texto",
      "2 corridas de Forms",
    ],
    cta: "Avanzar mi tesis",
    featured: false,
  },
  {
    id: "tesista",
    name: "Plan Tesista",
    audience: "Tesistas y asesores",
    icon: GraduationCap,
    priceMonthlyUsd: "USD 29",
    priceYearlyUsd: "USD 290",
    priceMonthlyPen: "S/ 109",
    priceYearlyPen: "S/ 1,090",
    description: "La cuota completa para sacar adelante una tesis de principio a fin.",
    highlights: [
      "10 tabulaciones y 10 pruebas de confiabilidad",
      "10 bases descriptivas y 10 generaciones de títulos",
      "5 matrices de consistencia",
      "30 humanizaciones de texto",
      "10 corridas de Forms",
    ],
    cta: "Avanzar mi tesis",
    featured: true,
  },
  {
    id: "institucion",
    name: "Plan Institución",
    audience: "Universidades y consultoras",
    icon: Building2,
    priceMonthlyUsd: "USD 129",
    priceYearlyUsd: "USD 1,290",
    priceMonthlyPen: "S/ 485",
    priceYearlyPen: "S/ 4,850",
    description: "Para equipos que gestionan múltiples tesis con control administrativo.",
    highlights: [
      "Hasta 20 cuentas, cada una con cuota Tesista",
      "Panel de administrador",
      "Recargas por herramienta para el equipo",
      "Soporte prioritario",
    ],
    cta: "Contáctanos",
    featured: false,
    contactOnly: true,
  },
];

export const CONTACT_WHATSAPP = "51975212132"; // +51 975 212 132

// Mientras no exista la pasarela de pago (Fase 3 del roadmap), contratar es
// escribir por WhatsApp. El mensaje va prerrellenado con el contexto que hace
// falta para atender sin preguntar de nuevo: qué plan y desde qué cuenta.
export const openWhatsAppPlan = (opts: { plan?: string; email?: string; herramienta?: string } = {}) => {
  const partes = [
    opts.plan ? `Hola, me interesa el ${opts.plan} de TesisHub.` : "Hola, quiero ampliar mi plan de TesisHub.",
    opts.herramienta ? `Me quedé sin usos de ${opts.herramienta}.` : "",
    opts.email ? `Mi cuenta es ${opts.email}.` : "",
  ].filter(Boolean);
  const text = encodeURIComponent(partes.join(" "));
  window.open(`https://wa.me/${CONTACT_WHATSAPP}?text=${text}`, "_blank", "noopener");
};
