# Runbook de producción

Este documento separa lo automatizado por el repositorio de las confirmaciones
que solo pueden hacerse en Neon, Render, Cloudflare, Taypi y GitHub. No copies
secretos, cuestionarios, respuestas ni URLs firmadas en tickets o logs.

## 1. Preparar staging

1. Crea una rama Neon exclusiva para staging/CI y guarda su endpoint pooled con
   `sslmode=require` únicamente en los secretos del entorno correspondiente.
2. Despliega API y worker desde el mismo SHA. Ambos deben usar Node 24 LTS,
   Oregon inicialmente, una instancia Starter y `STORE_AUTO_MIGRATE=false`.
3. Protege `main` en GitHub y exige los checks `API (node_app)`, `Forms`,
   `Frontend (tipos + pruebas + build)` y `Vulnerabilidades` antes del merge.
4. Mantén `COMMERCIAL_LAUNCH_ENABLED=false` y Taypi en sandbox.

## 2. Migrar Neon

1. Genera un respaldo lógico identificable y comprueba que puede abrirse.
2. Ejecuta `npm run db:inventory --prefix node_app` contra la rama objetivo y
   archiva conteos, propietarios, saldos y huérfanos sin datos personales.
3. Define `NEON_BACKUP_REFERENCE` con el identificador del respaldo y
   `NEON_BACKUP_CONFIRMED=true` en Render. El Blueprint deja ambas variables
   bajo control operativo (`sync:false`) para no sobrescribir esta evidencia.
4. Promueve el mismo SHA. Solo el pre-deploy de la API ejecuta la migración; el
   worker espera `schema_migrations` y nunca ejecuta DDL.
5. Repite el inventario y compara conteos, saldos y propietarios antes de abrir
   tráfico. Rota la referencia del respaldo en cada migración.

## 3. Verificar R2

1. Usa un token S3 `Object Read & Write` limitado exclusivamente al bucket de
   artefactos; nunca un token administrativo de cuenta.
2. Configura una regla lifecycle que elimine objetos a los 30 días y confirma
   `R2_BUCKET_SCOPE_CONFIRMED=true` y `R2_LIFECYCLE_CONFIRMED=true`.
3. `/ready` debe responder `r2.ok=true`. La prueba realiza `HeadBucket` y un
   ciclo temporal de escritura, lectura y borrado, cacheado 60 segundos, por lo
   que detecta permisos incompletos sin dejar un objeto permanente.
4. Comprueba que una descarga expira a los cinco minutos, no funciona para otro
   usuario y que los logs no conservan su query firmada.

## 4. Verificar Taypi

1. En sandbox prueba creación idempotente, `429`, `5xx`, expiración, cancelación,
   rechazo, firma inválida y replay del mismo webhook.
2. Registra el webhook HTTPS del API. Solo `payment.completed`, con HMAC vigente,
   PEN, monto coincidente y estado coherente, puede acreditar un plan o saldo.
3. Antes de pasar a live rota las tres credenciales, define
   `TAYPI_SANDBOX=false`, confirma la URL de webhook y conserva
   `TAYPI_TIMEOUT_MS=10000` salvo evidencia de otra necesidad.
4. Comprueba que `/config` mantiene `taypiPayments=false` mientras
   `COMMERCIAL_LAUNCH_ENABLED=false`, incluso con credenciales cargadas. El
   checkout solo se publica con gate comercial y Taypi live; el webhook queda
   activo para no perder una confirmacion ya emitida.

## 5. Carga, observabilidad y promoción

1. Ejecuta en staging un trabajo Forms de 1,200 respuestas autorizado y una
   generación pesada; reinicia API y worker durante la prueba y verifica 1,200
   aceptadas únicas, liquidación exacta y artefactos descargables.
2. Observa `neon_latency_ms`, colas, memoria, respuestas Forms, bloqueos y
   webhooks. Configura alertas externas para `/ready` fallido, latencia API-Neon
   mediana mayor a 100 ms, crecimiento sostenido de cola, memoria mayor a 80%,
   errores 5xx y discrepancias de pago.
3. Si la mediana API-Neon supera 100 ms, mueve API y worker juntos a la región
   Render disponible más cercana a la región real de Neon.
4. Confirma en Render los dos servicios Starter y en GitHub los required checks;
   después define las attestations `*_CONFIRMED=true`. El dominio propio y CORS
   HTTPS propio son obligatorios antes de cambiar
   `COMMERCIAL_LAUNCH_ENABLED=true`.
5. Verifica el estado realmente desplegado, no solo `render.yaml`: deben existir
   API y worker, el trigger debe ser `checksPass`, `/ready` debe responder 200 y
   `/config` no debe publicar Institucion ni cuotas Forms antiguas.

## 6. Rollback

1. Cierra el lanzamiento comercial sin borrar jobs ni saldos.
2. Revierte API y worker al mismo SHA compatible con el esquema ya aplicado.
3. No reviertas DDL destructivamente. Restaura el respaldo en una rama Neon
   nueva, valida inventarios y cambia el endpoint solo tras comprobarlos.
4. Conserva eventos de auditoría y métricas, pero elimina cualquier secreto o
   dato de formulario que haya entrado accidentalmente a un log.
