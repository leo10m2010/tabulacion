// Registro de cuentas eliminadas (lib/deleted-accounts.js): hueco de
// cobertura encontrado en la auditoria de pruebas (2026-07-26). La unica
// cobertura existente era indirecta, a traves de test/eliminar-cuenta.test.js
// (server.js completo), que confirma que borrar y volver a registrarse no
// regala otra cuota gratuita — pero NINGUNA prueba ejercitaba el vencimiento
// del cooldown en si (COOLDOWN_DAYS, por defecto 30 dias): probarlo esperando
// dias reales no es viable, asi que aqui se llama al modulo directamente y se
// inyectan fechas ya vencidas o casi vencidas.
//
// Estas son pruebas unitarias puras (sin levantar servidor): el modulo
// mantiene su estado en una variable de arreglo a nivel de archivo, y
// initDeletedAccounts(...) la reemplaza por completo, asi que cada test la
// reinicia antes de usarla.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  COOLDOWN_DAYS,
  initDeletedAccounts,
  recordDeletedAccount,
  wasRecentlyDeleted,
} from "../lib/deleted-accounts.js";

const DIA_MS = 24 * 60 * 60 * 1000;

// Mismo algoritmo que el modulo usa internamente (sha256 del correo en
// minusculas, sin exponer la funcion): permite construir registros "viejos"
// directamente, sin pasar por recordDeletedAccount (que siempre usa "ahora").
const hashEmail = (email) => crypto
  .createHash("sha256")
  .update(String(email).trim().toLowerCase())
  .digest("hex");

describe("cooldown de cuentas eliminadas", () => {
  test("una cuenta recien borrada cuenta como reciente", () => {
    initDeletedAccounts([]);
    recordDeletedAccount("fresco@test.local");
    assert.equal(wasRecentlyDeleted("fresco@test.local"), true);
  });

  test("una cuenta que nunca se borró no cuenta como reciente", () => {
    initDeletedAccounts([]);
    assert.equal(wasRecentlyDeleted("nunca-existio@test.local"), false);
  });

  test("pasado el cooldown, la cuenta deja de contar como reciente", () => {
    const email = "vencido@test.local";
    const vencido = new Date(Date.now() - (COOLDOWN_DAYS + 1) * DIA_MS).toISOString();
    initDeletedAccounts([{ emailHash: hashEmail(email), at: vencido }]);
    assert.equal(wasRecentlyDeleted(email), false, "ya pasó el cooldown: la cuenta vuelve a ser libre");
  });

  test("un día antes de vencer el cooldown, sigue contando como reciente", () => {
    const email = "casi-vencido@test.local";
    const casiVencido = new Date(Date.now() - (COOLDOWN_DAYS - 1) * DIA_MS).toISOString();
    initDeletedAccounts([{ emailHash: hashEmail(email), at: casiVencido }]);
    assert.equal(wasRecentlyDeleted(email), true);
  });

  test("initDeletedAccounts purga automáticamente lo vencido al arrancar", () => {
    const email = "purgar-al-arrancar@test.local";
    const vencido = new Date(Date.now() - (COOLDOWN_DAYS + 5) * DIA_MS).toISOString();
    initDeletedAccounts([{ emailHash: hashEmail(email), at: vencido }]);
    // Si la purga al arrancar no descartara la entrada vencida, seguiria
    // contando como reciente.
    assert.equal(wasRecentlyDeleted(email), false);
  });

  test("borrar la misma cuenta dos veces reinicia el cooldown (no se ignora ni se duplica)", () => {
    initDeletedAccounts([]);
    recordDeletedAccount("reincidente@test.local");
    recordDeletedAccount("reincidente@test.local");
    assert.equal(wasRecentlyDeleted("reincidente@test.local"), true);
  });

  test("el hash no depende de mayúsculas ni de espacios sobrantes", () => {
    initDeletedAccounts([]);
    recordDeletedAccount("  ConEspacios@Test.Local  ");
    assert.equal(wasRecentlyDeleted("conespacios@test.local"), true);
    assert.equal(wasRecentlyDeleted("CONESPACIOS@TEST.LOCAL"), true);
  });

  test("initDeletedAccounts descarta valores que no son un arreglo", () => {
    initDeletedAccounts(null);
    assert.equal(wasRecentlyDeleted("cualquiera@test.local"), false);
    initDeletedAccounts(undefined);
    assert.equal(wasRecentlyDeleted("cualquiera@test.local"), false);
  });

  test("cuentas distintas no se confunden entre sí", () => {
    initDeletedAccounts([]);
    recordDeletedAccount("uno@test.local");
    assert.equal(wasRecentlyDeleted("uno@test.local"), true);
    assert.equal(wasRecentlyDeleted("dos@test.local"), false);
  });
});
