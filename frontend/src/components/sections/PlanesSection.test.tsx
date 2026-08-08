import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { AuthUser } from "../../lib/types";
import { PlanesSection } from "./PlanesSection";

const { createCheckout } = vi.hoisted(() => ({
  createCheckout: vi.fn((
    _apiBaseUrl: string,
    _token: string,
    _purchase: { plan: string; billingCycle: "monthly" | "yearly"; idempotencyKey: string },
  ) => new Promise<never>(() => {})),
}));

vi.mock("../../lib/api", () => ({
  createTaypiCheckout: createCheckout,
  createFormsTopupCheckout: vi.fn(),
}));

const user: AuthUser = {
  id: "user-planes",
  email: "ana@test.local",
  role: "user",
  status: "active",
  plan: "free",
  subscriptionEndsAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  lastLoginAt: null,
  uses: { forms: 0 },
};

describe("PlanesSection — checkout autenticado", () => {
  beforeEach(() => {
    createCheckout.mockClear();
    sessionStorage.clear();
  });

  test("inicia Taypi en PEN con una clave idempotente y bloquea dobles clics", async () => {
    const actor = userEvent.setup();
    render(
      <PlanesSection
        apiBaseUrl="https://api.test"
        authToken="session-token"
        authUser={user}
        paymentsEnabled
      />,
    );

    const buttons = screen.getAllByRole("button", { name: /Pagar con Taypi/i });
    await actor.click(buttons[0]);

    await waitFor(() => expect(createCheckout).toHaveBeenCalledTimes(1));
    const [baseUrl, token, purchase] = createCheckout.mock.calls[0];
    expect(baseUrl).toBe("https://api.test");
    expect(token).toBe("session-token");
    expect(purchase).toMatchObject({ plan: "esencial", billingCycle: "monthly" });
    expect(purchase.idempotencyKey).toMatch(/^[a-zA-Z0-9._:-]{8,128}$/);
    expect(screen.getByRole("button", { name: /Abriendo pago/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Pagar con Taypi/i })).toBeDisabled();
  });
});
