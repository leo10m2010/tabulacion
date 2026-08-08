import assert from "node:assert/strict";
import test from "node:test";
import { isEmailRegistrationEnabled, isRestorableUser } from "../lib/auth-policy.js";

test("el registro por correo nunca se habilita en produccion", () => {
  assert.equal(isEmailRegistrationEnabled({ NODE_ENV: "production", REGISTRATION_ENABLED: "true" }), false);
  assert.equal(isEmailRegistrationEnabled({ NODE_ENV: "test", REGISTRATION_ENABLED: "true" }), true);
  assert.equal(isEmailRegistrationEnabled({ NODE_ENV: "development" }), false);
});

test("los respaldos aceptan identidades Google sin contrasena y usuarios manuales con hash", () => {
  assert.equal(isRestorableUser({
    id: "google-user",
    emailLower: "google@test.local",
    passwordEnabled: false,
    googleSub: "google-sub-1",
  }), true);
  assert.equal(isRestorableUser({
    id: "manual-user",
    emailLower: "manual@test.local",
    passwordEnabled: true,
    passwordHash: "hash",
    passwordSalt: "salt",
  }), true);
  assert.equal(isRestorableUser({
    id: "broken-google-user",
    emailLower: "broken@test.local",
    passwordEnabled: false,
  }), false);
});
