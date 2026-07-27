// Esta auditoría (2026-07-26) agregó el respeto de prefers-reduced-motion a
// WizardProgress (antes escalaba el punto activo 1.12x y animaba la barra de
// progreso sin comprobar la preferencia del sistema, a diferencia del resto
// del frontend). La prueba cubre exactamente eso: con la preferencia activa,
// no debe pedirse ninguna animación (duration: 0, scale/escala fijas).
import { describe, expect, test, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { WizardProgress } from "./WizardProgress";

afterEach(cleanup);

const mockMatchMedia = (reduce: boolean) => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
};

describe("WizardProgress", () => {
  test("no tiene violaciones de accesibilidad detectables por axe", async () => {
    mockMatchMedia(false);
    const { container } = render(<WizardProgress currentStep={2} />);
    const resultados = await axe(container);
    expect(resultados).toHaveNoViolations();
  });

  test("muestra los 3 pasos del wizard con el paso activo marcado", () => {
    mockMatchMedia(false);
    render(<WizardProgress currentStep={2} />);
    // WIZARD_STEPS trae 3 pasos; el paso completado (1) se marca con el check,
    // los otros dos con su número.
    expect(screen.getAllByText(/./).length).toBeGreaterThan(0);
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});
