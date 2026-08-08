import { describe, expect, it } from "vitest";
import { getFormsBalance } from "./usage";
import type { AuthUser } from "./types";

const user = (patch: Partial<AuthUser>): AuthUser => ({
  id: "u1",
  email: "u@example.com",
  role: "user",
  status: "active",
  plan: "free",
  subscriptionEndsAt: null,
  createdAt: "",
  updatedAt: "",
  lastLoginAt: null,
  ...patch,
});

describe("getFormsBalance", () => {
  it("prefiere el saldo nuevo de respuestas", () => {
    expect(getFormsBalance(user({
      formsResponses: { available: 450, consumed: 50, reserved: 100 },
      uses: { forms: 2 },
    }))).toEqual({ available: 450, consumed: 50, reserved: 100 });
  });

  it("mantiene compatibilidad con uses.forms", () => {
    expect(getFormsBalance(user({
      uses: { forms: 250 },
      usesConsumed: { forms: 20 },
    }))).toEqual({ available: 250, consumed: 20, reserved: 0 });
  });

  it("presenta saldo ilimitado para administradores", () => {
    expect(getFormsBalance(user({ role: "admin" })).available).toBeNull();
  });
});
