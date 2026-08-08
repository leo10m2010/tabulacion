# Backend de TesisHub

API Node y motores de generación. Requiere Node 24 LTS en local, CI y Render.

## Comandos

```bash
npm ci
npm run api
npm run generate
npm run plantilla
npm run lint
npm test
npm run db:inventory
npm run db:migrate
npm run test:db
```

`generate` usa `../Tabulacion.json`; `plantilla` conserva la estructura pero
deja la base vacía para ingreso manual.

## Persistencia

Neon PostgreSQL es obligatorio en producción. `schema_migrations` controla el
DDL; el proceso productivo no crea ni altera tablas al arrancar. El backend de
archivo queda limitado a desarrollo y pruebas locales.

Tablas principales: `users`, `identities`, `sessions`, `device_credentials`,
`projects`, `entitlement_balances`, `entitlement_ledger`, `jobs`, `job_batches`,
`artifacts`, `payments` y `audit_events`. Los saldos se reservan, consumen,
devuelven y acreditan dentro de transacciones.

## Endpoints relevantes

- `GET /config`, `/health`, `/ready` y `/metrics` (admin).
- `POST /auth/google`, `/auth/login`, `/auth/logout` y `GET /auth/me`.
- Emparejamiento `/auth/device-pairings` y revocación `/auth/devices/:id`.
- CRUD `/proyectos` con control optimista por `version`.
- `POST /generate`: acepta `seed` e `idempotencyKey`; devuelve la semilla.
- `/artifacts/:id[/download]`: exige propietario o administrador.
- `/payments/taypi/checkout` y `/payments/taypi/webhook`.
- Rutas `/api/forms/*`, montadas desde `../forms`.

El registro por email está desactivado en `/config`. `/auth/register` existe
solo como adaptador local temporal cuando `REGISTRATION_ENABLED=true`; nunca se
habilita en producción.

## Generador

El Excel se construye por código con fórmulas y gráficos. La base usa un modelo
latente reproducible: rasgo general, factores por dimensión, parámetros por
ítem, ruido, inversión y conversión ordinal. Frecuencias, porcentajes, niveles,
correlación, alfa y efectos se calculan desde las filas resultantes.

Opciones principales:

- `config.seed` o `config.semilla`: reproducibilidad.
- `config.controlCorrelacion`: orienta el rango objetivo.
- `config.nivelCorrelacion`: `muy_alta`, `alta`, `moderada`, `baja`,
  `muy_baja` o `nula`.
- `config.metodoCorrelacion`: `auto`, `spearman` o `pearson`.
- `responseMode`: `links` usa R2 en producción; `inline` conserva el contrato
  para desarrollo y compatibilidad.

El campo interno histórico `datos_simulados` se conserva únicamente como
contrato de compatibilidad entre el orquestador y el generador.

## Producción

Variables imprescindibles: `DATABASE_URL` pooled con SSL,
`AUTH_TOKEN_SECRET`, `PUBLIC_BASE_URL`, CORS explícito, `R2_BUCKET` y
credenciales S3 limitadas al bucket. Taypi solo se habilita cuando existen sus
tres secretos. `/ready` valida Neon, R2 y capacidad de cola.
