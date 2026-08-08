import assert from "node:assert/strict";
import test from "node:test";
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { createR2ArtifactStore, r2ConfigFromEnv } from "../lib/artifacts/r2.js";

const ENV = {
  R2_ENDPOINT: "https://example.r2.cloudflarestorage.com",
  R2_BUCKET: "tesis",
  R2_ACCESS_KEY_ID: "key",
  R2_SECRET_ACCESS_KEY: "secret",
  ARTIFACT_RETENTION_DAYS: "30",
  ARTIFACT_SIGNED_URL_SECONDS: "300",
};

test("R2 queda desactivado de forma explícita cuando falta configuración", () => {
  const config = r2ConfigFromEnv({});
  assert.equal(config.enabled, false);
  assert.ok(config.missing.includes("R2_BUCKET"));
});

test("sube con clave aislada por usuario/trabajo y firma por cinco minutos", async () => {
  const commands = [];
  const client = {
    async send(command) {
      commands.push(command);
      return {};
    },
  };
  let signed = null;
  const store = createR2ArtifactStore({
    env: ENV,
    client,
    now: () => new Date("2026-07-29T12:00:00.000Z"),
    signer: async (_client, command, options) => {
      signed = { command, options };
      return "https://signed.example/download";
    },
  });

  const artifact = await store.put({
    ownerUserId: "user-1",
    jobId: "job-1",
    filename: "Resultado final.xlsx",
    body: Buffer.from("xlsx"),
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  assert.equal(commands[0] instanceof PutObjectCommand, true);
  assert.match(artifact.key, /^users\/user-1\/jobs\/job-1\//);
  assert.equal(artifact.filename, "Resultado_final.xlsx");
  assert.equal(artifact.expiresAt, "2026-08-28T12:00:00.000Z");

  const url = await store.signedDownloadUrl(artifact.key);
  assert.equal(url, "https://signed.example/download");
  assert.equal(signed.command instanceof GetObjectCommand, true);
  assert.equal(signed.options.expiresIn, 300);
});

test("el borrado de cuenta pagina y elimina solo su prefijo", async () => {
  const commands = [];
  const client = {
    async send(command) {
      commands.push(command);
      if (command instanceof ListObjectsV2Command) {
        return { Contents: [{ Key: "users/user-1/jobs/a/file.xlsx" }], IsTruncated: false };
      }
      return {};
    },
  };
  const store = createR2ArtifactStore({ env: ENV, client });
  const deleted = await store.deleteUserArtifacts("user-1");

  assert.equal(deleted, 1);
  assert.equal(commands[0] instanceof ListObjectsV2Command, true);
  assert.equal(commands[0].input.Prefix, "users/user-1/");
  assert.equal(commands[1] instanceof DeleteObjectsCommand, true);
});

test("un job recuperado puede volver a leer su artefacto sin depender de memoria", async () => {
  const client = {
    async send(command) {
      if (command instanceof GetObjectCommand) {
        return {
          Body: {
            async transformToByteArray() {
              return new Uint8Array(Buffer.from("contenido-durable"));
            },
          },
        };
      }
      return {};
    },
  };
  const store = createR2ArtifactStore({ env: ENV, client });
  const body = await store.readBuffer("users/user-1/jobs/job-1/resultado.docx");
  assert.equal(body.toString("utf8"), "contenido-durable");
});

test("readiness comprueba acceso real al bucket sin filtrar secretos", async () => {
  const commands = [];
  const readyStore = createR2ArtifactStore({
    env: ENV,
    client: { send: async (command) => { commands.push(command); return {}; } },
  });
  assert.deepEqual(await readyStore.readiness(), { ok: true, enabled: true });
  assert.deepEqual(await readyStore.readiness(), { ok: true, enabled: true });
  assert.equal(commands.filter((command) => command instanceof HeadBucketCommand).length, 1);
  assert.equal(commands.filter((command) => command instanceof PutObjectCommand).length, 1);
  assert.equal(commands.filter((command) => command instanceof GetObjectCommand).length, 1);
  assert.equal(commands.filter((command) => command instanceof DeleteObjectCommand).length, 1);

  const failedStore = createR2ArtifactStore({
    env: ENV,
    client: {
      send: async () => {
        const error = new Error("https://bucket.test?signature=secret");
        error.name = "AccessDenied";
        throw error;
      },
    },
  });
  assert.deepEqual(await failedStore.readiness(), {
    ok: false,
    enabled: true,
    code: "AccessDenied",
  });
});

test("readiness rechaza credenciales R2 de solo lectura", async () => {
  const store = createR2ArtifactStore({
    env: ENV,
    client: {
      async send(command) {
        if (command instanceof PutObjectCommand) {
          const error = new Error("denied");
          error.name = "AccessDenied";
          throw error;
        }
        return {};
      },
    },
  });
  assert.deepEqual(await store.readiness(), {
    ok: false,
    enabled: true,
    code: "AccessDenied",
  });
});

test("R2 rechaza claves o prefijos capaces de escapar del usuario", async () => {
  const store = createR2ArtifactStore({
    env: ENV,
    client: { send: async () => ({}) },
    signer: async () => "https://signed.example",
  });
  await assert.rejects(() => store.signedDownloadUrl("users/user-1/../user-2/file.xlsx"));
  await assert.rejects(() => store.deleteArtifact("users/user-1"));
});
