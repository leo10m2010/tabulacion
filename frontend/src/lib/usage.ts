import type { AuthUser } from "./types";

export interface FormsBalance {
  available: number | null;
  consumed: number;
  reserved: number;
}

export const getFormsBalance = (user: AuthUser): FormsBalance => {
  if (user.role === "admin") return { available: null, consumed: 0, reserved: 0 };
  if (typeof user.formsResponses === "number") {
    return {
      available: user.formsResponses,
      consumed: user.usesConsumed?.forms ?? user.formsUsesUsed ?? 0,
      reserved: 0,
    };
  }
  if (user.formsResponses && typeof user.formsResponses === "object") {
    return {
      available: user.formsResponses.available,
      consumed: user.formsResponses.consumed ?? user.usesConsumed?.forms ?? user.formsUsesUsed ?? 0,
      reserved: user.formsResponses.reserved ?? 0,
    };
  }
  return {
    available: user.uses?.forms ?? user.formsUsesLeft ?? 0,
    consumed: user.usesConsumed?.forms ?? user.formsUsesUsed ?? 0,
    reserved: 0,
  };
};
