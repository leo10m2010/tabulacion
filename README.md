# TesisHub

SaaS en español para preparar instrumentos, generar bases y libros Excel de
tabulación, calcular confiabilidad, trabajar matrices y títulos, y administrar
envíos autorizados a Google Forms.

## Arquitectura

- `frontend/`: React, Vite y Tailwind; desplegado en Vercel.
- `node_app/`: API Node, autenticación, proyectos, ledger, pagos, generación y
  acceso a artefactos.
- `forms/`: API compatible, extensión Chrome y worker durable de Forms.
- Neon PostgreSQL: fuente de verdad para usuarios, identidades, sesiones,
  dispositivos, proyectos, saldos, ledger, jobs, artefactos y pagos.
- Cloudflare R2: Excel, CSV y DOCX por 30 días; descarga mediante URL firmada
  de cinco minutos.
- Render: un servicio web Starter para la API y un worker Starter para Forms.

En producción no existe fallback a archivos: si falta `DATABASE_URL`, R2,
`PUBLIC_BASE_URL`, un secreto estable o un CORS explícito, el servicio no queda
listo o falla al arrancar.

## Acceso

- Google es el único alta pública y crea una cuenta Free en el primer acceso.
- Las contraseñas quedan para administradores y cuentas manuales.
- Compartir correo no vincula automáticamente una identidad Google con una
  cuenta manual.
- El registro, recuperación y verificación pública por correo permanecen
  desactivados hasta contar con dominio y correo transaccional.
- La extensión se vincula con un código de dispositivo; cada instalación tiene
  una credencial revocable independiente.

## Desarrollo local

```bash
cd node_app
npm ci
npm run api

cd ../frontend
npm ci
npm run dev

cd ../forms
npm ci
npm test
npm run build:extension
```

El backend de archivo solo se usa sin `DATABASE_URL` en desarrollo y tests.
Para PostgreSQL usa una rama Neon de staging o una instancia local aislada;
nunca ejecutes pruebas contra producción.

## Neon y migraciones

```bash
cd node_app
npm run db:inventory   # inventario/dry-run antes de migrar
npm run db:migrate     # aplica schema_migrations una sola vez
npm run test:db        # exige una DATABASE_URL exclusiva de pruebas
```

Producción usa el endpoint pooled de Neon, SSL, máximo cuatro conexiones por
proceso y timeouts de sentencia, lock y transacción. El Blueprint ejecuta la
migración como `preDeployCommand`; el servidor solo verifica la versión.

## Generación y tabulación

Se conservan muestra, escalas, dimensiones, ítems, baremos, plantilla vacía,
porcentajes objetivo, correlación, alfa, efecto, vistas previas y exportaciones.
El generador usa perfiles latentes por encuestado, factores por dimensión,
dificultad/discriminación, ruido, ítems inversos y conversión ordinal. Todos los
estadísticos se recalculan desde las filas finales.

`seed` es opcional. Si se envía, la misma configuración reproduce la base; si
se omite se genera una semilla segura y se devuelve en la respuesta. El análisis
cuasiexperimental incluye cambio pre–post, interacción grupo × tiempo, ANCOVA
cuando corresponde, intervalos y tamaños de efecto.

## Forms por respuestas

La cuota es una cantidad de respuestas, no un número de corridas:

- Free: 0 respuestas iniciales.
- Esencial: 500 respuestas iniciales.
- Tesista: 2,500 respuestas iniciales.
- Recargas: cualquier entero positivo.

Un job puede solicitar cualquier cantidad cubierta por el saldo. El sistema
reserva el total, trabaja internamente en lotes de 100, consume solo respuestas
aceptadas y devuelve las no utilizadas. Pausa, reanudación, cancelación, cursor,
intentos, lease, progreso y liquidación se guardan en Neon.

Los envíos requieren confirmación de propiedad o autorización. Ante CAPTCHA,
bloqueo o controles del proveedor, el job se pausa y diagnostica; no intenta
evadirlos. Se respeta `Retry-After` y se aplica backoff para `429/5xx`.

## API principal

- `GET /config`, `/health`, `/ready`.
- `POST /auth/google`, `/auth/login`, `/auth/logout`.
- `GET /auth/me`, `/auth/devices`; emparejamiento y revocación de dispositivos.
- CRUD `/proyectos` con `version`; una edición obsoleta responde `409`.
- `POST /generate` con `idempotencyKey` y `seed` opcional.
- `POST /api/forms/jobs`; consulta y acciones `/pause`, `/resume`, `/cancel`.
- `POST /payments/taypi/checkout` y webhook HMAC idempotente.
- `GET /artifacts/:id/download` para descargas autorizadas.

Los errores nuevos usan `{ code, message, field?, retryable?, requestId }`. Los
contratos antiguos se mantienen como adaptadores temporales, pero no son la
fuente principal.

## Calidad y despliegue

```bash
cd node_app && npm run lint && npm test
cd ../forms && npm test && npm run build:extension
cd ../frontend && npm run lint && npm run typecheck && npm test && npm run build
```

CI añade PostgreSQL 16 aislado, auditoría de dependencias y publica el ZIP de
la extensión construido desde la misma fuente. `render.yaml` despliega solo
cuando los checks pasan. Antes de producción comercial deben configurarse el
ID exacto de la extensión, credenciales R2 limitadas al bucket, secretos Taypi,
la rama Neon de producción y el ciclo de vida de R2 a 30 días. Antes de cada
migración de producción genera el respaldo lógico, guarda su identificador en
`NEON_BACKUP_REFERENCE` y recién entonces activa `NEON_BACKUP_CONFIRMED=true`;
el migrador rechaza ejecutarse si falta cualquiera de esas dos evidencias.

El procedimiento verificable de staging, migración, R2, Taypi, observabilidad,
promoción y rollback está en `docs/PRODUCTION_RUNBOOK.md`.
