import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { AuthUser } from "../../lib/types";
import { AccountSection } from "./AccountSection";

vi.mock("../../lib/api", () => ({
  approveDevicePairing: vi.fn(),
  changePassword: vi.fn(),
  deleteOwnAccount: vi.fn(),
  linkGoogleIdentity: vi.fn(),
  listDevices: vi.fn(async () => ({ devices: [] })),
  listSessions: vi.fn(async () => ({ sessions: [] })),
  revokeDevice: vi.fn(),
  revokeOtherSessions: vi.fn(async () => ({ revoked: 0 })),
}));

const baseUser: AuthUser = {
  id: "account-user",
  email: "ana@test.local",
  role: "user",
  status: "active",
  plan: "free",
  subscriptionEndsAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  lastLoginAt: null,
};

const renderAccount = (authUser: AuthUser) => render(
  <AccountSection
    apiBaseUrl="https://api.test"
    authToken="session"
    authUser={authUser}
    googleClientId="google-client-id"
    themeMode="light"
    onTokenRefresh={vi.fn()}
    onAccountDeleted={vi.fn()}
  />,
);

describe("AccountSection — métodos de acceso", () => {
  test("una cuenta Google no recibe un formulario de contraseña desconocida", () => {
    renderAccount({ ...baseUser, passwordEnabled: false, googleLinked: true });
    expect(screen.getByText(/Google está vinculado/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Cambiar contraseña/i })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Dispositivos de Forms/i })).toBeInTheDocument();
  });

  test("una cuenta manual conserva el cambio de contraseña", () => {
    renderAccount({ ...baseUser, passwordEnabled: true, googleLinked: false });
    expect(screen.getByRole("heading", { name: /Cambiar contraseña/i })).toBeInTheDocument();
    expect(screen.getAllByText(/Contraseña actual/i).length).toBeGreaterThanOrEqual(1);
  });
});
