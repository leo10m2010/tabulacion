import crypto from "node:crypto";
import {
  DeleteObjectsCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_SIGNED_URL_SECONDS = 300;
const DEFAULT_READINESS_CACHE_SECONDS = 60;

const cleanSegment = (value, label) => {
  const segment = String(value ?? "").trim();
  if (!/^[a-zA-Z0-9-]{1,128}$/.test(segment)) {
    throw new Error(`${label} no tiene un formato válido.`);
  }
  return segment;
};

const cleanFilename = (value) => {
  const normalized = String(value ?? "archivo.bin")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._-]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 160);
  return normalized || "archivo.bin";
};

const positiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const artifactKey = (value) => {
  const key = String(value ?? "").trim();
  const segments = key.split("/");
  if (segments.length !== 5
    || segments[0] !== "users"
    || segments[2] !== "jobs"
    || !/^[a-zA-Z0-9-]{1,128}$/.test(segments[1])
    || !/^[a-zA-Z0-9-]{1,128}$/.test(segments[3])
    || !segments[4]
    || key.includes("..")
    || key.includes("\\")
    || [...key].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
    throw new Error("La clave del artefacto no es válida.");
  }
  return key;
};

export const r2ConfigFromEnv = (env = process.env) => {
  const accountId = String(env.R2_ACCOUNT_ID ?? "").trim();
  const endpoint = String(env.R2_ENDPOINT ?? "").trim()
    || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");
  const bucket = String(env.R2_BUCKET ?? "").trim();
  const accessKeyId = String(env.R2_ACCESS_KEY_ID ?? "").trim();
  const secretAccessKey = String(env.R2_SECRET_ACCESS_KEY ?? "").trim();
  const missing = [
    ["R2_ENDPOINT o R2_ACCOUNT_ID", endpoint],
    ["R2_BUCKET", bucket],
    ["R2_ACCESS_KEY_ID", accessKeyId],
    ["R2_SECRET_ACCESS_KEY", secretAccessKey],
  ].filter(([, value]) => !value).map(([name]) => name);

  return {
    enabled: missing.length === 0,
    missing,
    endpoint,
    bucket,
    accessKeyId,
    secretAccessKey,
    retentionDays: positiveInt(env.ARTIFACT_RETENTION_DAYS, DEFAULT_RETENTION_DAYS),
    signedUrlSeconds: Math.min(
      3600,
      positiveInt(env.ARTIFACT_SIGNED_URL_SECONDS, DEFAULT_SIGNED_URL_SECONDS),
    ),
    readinessCacheSeconds: Math.min(
      300,
      positiveInt(env.R2_READINESS_CACHE_SECONDS, DEFAULT_READINESS_CACHE_SECONDS),
    ),
  };
};

export const createR2ArtifactStore = ({
  env = process.env,
  client: injectedClient,
  signer = getSignedUrl,
  now = () => new Date(),
} = {}) => {
  const config = r2ConfigFromEnv(env);
  if (!config.enabled) {
    return {
      enabled: false,
      missing: config.missing,
      async readiness() {
        return { ok: false, enabled: false, missing: config.missing };
      },
    };
  }

  const client = injectedClient ?? new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  const readinessState = { result: null, expiresAt: 0 };

  const put = async ({
    ownerUserId,
    jobId,
    filename,
    body,
    contentType = "application/octet-stream",
  }) => {
    const owner = cleanSegment(ownerUserId, "ownerUserId");
    const job = cleanSegment(jobId, "jobId");
    const safeName = cleanFilename(filename);
    const createdAt = now();
    const expiresAt = new Date(
      createdAt.getTime() + config.retentionDays * 24 * 60 * 60 * 1000,
    );
    const key = `users/${owner}/jobs/${job}/${crypto.randomUUID()}-${safeName}`;

    await client.send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      ContentDisposition: `attachment; filename="${safeName}"`,
      Metadata: {
        owner_user_id: owner,
        job_id: job,
        expires_at: expiresAt.toISOString(),
      },
    }));

    return {
      storage: "r2",
      key,
      filename: safeName,
      contentType,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
  };

  const signedDownloadUrl = async (key) => {
    const normalized = artifactKey(key);
    return signer(
      client,
      new GetObjectCommand({ Bucket: config.bucket, Key: normalized }),
      { expiresIn: config.signedUrlSeconds },
    );
  };

  const readBuffer = async (key) => {
    const normalized = artifactKey(key);
    const response = await client.send(new GetObjectCommand({
      Bucket: config.bucket,
      Key: normalized,
    }));
    if (!response.Body) throw new Error("El artefacto no tiene contenido.");
    if (typeof response.Body.transformToByteArray === "function") {
      return Buffer.from(await response.Body.transformToByteArray());
    }
    const chunks = [];
    for await (const chunk of response.Body) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  };

  const deleteArtifact = async (key) => {
    const normalized = artifactKey(key);
    await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: normalized }));
  };

  const deletePrefix = async (prefix) => {
    const normalized = String(prefix ?? "").trim();
    if (!/^users\/[a-zA-Z0-9-]{1,128}\/$/.test(normalized)) {
      throw new Error("El prefijo de artefactos no es válido.");
    }

    let continuationToken;
    let deleted = 0;
    do {
      const listed = await client.send(new ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: normalized,
        ContinuationToken: continuationToken,
      }));
      const objects = (listed.Contents ?? [])
        .map((item) => item.Key)
        .filter(Boolean)
        .map((Key) => ({ Key }));
      if (objects.length > 0) {
        await client.send(new DeleteObjectsCommand({
          Bucket: config.bucket,
          Delete: { Objects: objects, Quiet: true },
        }));
        deleted += objects.length;
      }
      continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (continuationToken);
    return deleted;
  };

  return {
    enabled: true,
    retentionDays: config.retentionDays,
    signedUrlSeconds: config.signedUrlSeconds,
    put,
    readBuffer,
    signedDownloadUrl,
    deleteArtifact,
    deleteUserArtifacts: (userId) => deletePrefix(
      `users/${cleanSegment(userId, "userId")}/`,
    ),
    async readiness() {
      const currentTime = now().getTime();
      if (readinessState.result?.ok && currentTime < readinessState.expiresAt) {
        return readinessState.result;
      }
      const probeKey = `_health/read-write-${crypto.randomUUID()}`;
      let probeCreated = false;
      try {
        await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
        await client.send(new PutObjectCommand({
          Bucket: config.bucket,
          Key: probeKey,
          Body: Buffer.alloc(0),
          ContentType: "application/octet-stream",
        }));
        probeCreated = true;
        await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: probeKey }));
        await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: probeKey }));
        // Dos probes simultáneos solo pueden publicar el mismo estado exitoso;
        // la escritura no depende del valor leído antes del await.
        // eslint-disable-next-line require-atomic-updates
        readinessState.result = { ok: true, enabled: true };
        // eslint-disable-next-line require-atomic-updates
        readinessState.expiresAt = currentTime + config.readinessCacheSeconds * 1000;
        return readinessState.result;
      } catch (error) {
        if (probeCreated) {
          try {
            await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: probeKey }));
          } catch {
            // El resultado ya es no-ready. No se filtra el error ni una URL firmada.
          }
        }
        return {
          ok: false,
          enabled: true,
          code: String(error?.name || error?.code || "R2_UNAVAILABLE"),
        };
      }
    },
  };
};
