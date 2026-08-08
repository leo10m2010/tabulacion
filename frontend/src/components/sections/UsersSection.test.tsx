// La tabla conserva su semántica nativa y expone un botón real para gestionar
// cada usuario. Estas pruebas cubren teclado, apertura y restauración de foco.
import { describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UsersSection } from "./UsersSection";
import type { AuthUser } from "../../lib/types";

vi.mock("../../lib/api", () => ({
  listUsers: vi.fn(async () => ({
    users: [
      {
        id: "u1",
        email: "ana@test.local",
        role: "user",
        status: "active",
        plan: "tesista",
        subscriptionEndsAt: null,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        lastLoginAt: null,
      } satisfies AuthUser,
    ],
  })),
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  getUsersBackup: vi.fn(),
  patchUser: vi.fn(),
  restoreUsersBackup: vi.fn(),
  revokeUserApiKey: vi.fn(),
}));

const admin: AuthUser = {
  id: "admin1",
  email: "admin@test.local",
  role: "admin",
  status: "active",
  plan: "tesista",
  subscriptionEndsAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  lastLoginAt: null,
};

describe("UsersSection — gestión operable por teclado", () => {
  test("Enter en el botón de gestión abre el panel", async () => {
    const user = userEvent.setup();
    render(<UsersSection apiBaseUrl="http://api.local" authToken="tok" authUser={admin} />);

    const boton = await screen.findByRole("button", { name: /Gestionar a ana@test\.local/i });
    boton.focus();
    expect(boton).toHaveFocus();

    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: /Gestionar a ana@test\.local/i })).toBeInTheDocument();
    });
  });

  test("Escape cierra el panel y devuelve el foco al botón que lo abrió", async () => {
    const user = userEvent.setup();
    render(<UsersSection apiBaseUrl="http://api.local" authToken="tok" authUser={admin} />);

    const boton = await screen.findByRole("button", { name: /Gestionar a ana@test\.local/i });
    await user.click(boton);
    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: /Gestionar a ana@test\.local/i })).toBeInTheDocument();
    });

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(boton).toHaveFocus();
    });
  });
});
