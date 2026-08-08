import { beforeEach, describe, expect, it } from "vitest";
import { activeProjectStorageKey, clearSensitiveSessionStorage } from "./session-storage";

describe("session storage", () => {
  beforeEach(() => localStorage.clear());

  it("usa una clave de proyecto aislada por usuario", () => {
    expect(activeProjectStorageKey("user-a")).toBe("proyectoActivoId:user-a");
    expect(activeProjectStorageKey("user-b")).not.toBe(activeProjectStorageKey("user-a"));
  });

  it("limpia credenciales y trabajo sin borrar preferencias", () => {
    localStorage.setItem("authToken", "secret");
    localStorage.setItem("authExpiresAt", "tomorrow");
    localStorage.setItem("loginEmail", "persona@example.com");
    localStorage.setItem("proyectoActivoId", "legacy");
    localStorage.setItem("proyectoActivoId:user-a", "project-a");
    localStorage.setItem("tesishub:job:user-a:titulos", "job-a");
    localStorage.setItem("themeMode", "dark");
    localStorage.setItem("apiBaseUrl", "http://localhost:8080");

    clearSensitiveSessionStorage();

    expect(localStorage.getItem("authToken")).toBeNull();
    expect(localStorage.getItem("loginEmail")).toBeNull();
    expect(localStorage.getItem("proyectoActivoId:user-a")).toBeNull();
    expect(localStorage.getItem("tesishub:job:user-a:titulos")).toBeNull();
    expect(localStorage.getItem("themeMode")).toBe("dark");
    expect(localStorage.getItem("apiBaseUrl")).toBe("http://localhost:8080");
  });
});
