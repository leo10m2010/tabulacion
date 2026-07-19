# Roadmap de TesisHub

Acordado el 2026-07-18. Cada fase funciona por sí sola y deja valor aunque se pare ahí. El orden respeta las dependencias reales (no empezar una fase sin la anterior salvo que se indique).

## Ya hecho (base para todo lo demás)

- Rediseño visual completo (esmeralda/hueso, Space Grotesk, hero con screenshot real).
- **Sistema de usos por herramienta**: todo el acceso funciona por usos (1 uso = 1 generación/corrida), con reembolso automático si el job de IA falla, presets por plan (Esencial / Tesista / Institución) y selector de recargas por herramienta en el panel admin.
- Rename a **TesisHub** (decisión cerrada: el hub NO se llamará Tutorica).
- Auditoría UX en `docs/ux-audit.md` (cuello de botella: el instrumento se re-define en cada herramienta).

## Fase 1 — Login con Google + persistencia de usuarios

**Objetivo**: registro sin fricción y cuentas que no se borren al reiniciar Render.

1. **Persistencia primero** (bloqueante): `users.json` en Render free es efímero. Opciones:
   - Disco persistente de Render (plan pago) — cambio cero de código.
   - **Postgres administrado de Render (recomendado)** — migrar el store de usuarios a una tabla; deja lista la base para la Fase 3.
2. **Google OAuth**:
   - Crear OAuth Client ID en Google Cloud Console (gratis, ~15 min): consent screen + orígenes autorizados (dominio de Vercel + `http://localhost:5173`).
   - Frontend: botón oficial de Google Identity Services en el login → entrega un ID token.
   - Backend: endpoint nuevo `POST /auth/google` que verifica el ID token con `google-auth-library`, busca o crea el usuario por email y emite el token propio de siempre. Todo lo demás (usos, roles, claves ttab_) queda igual.
   - Decisión pendiente al implementar: qué usos iniciales recibe un usuario nuevo por Google (propuesta: plan free de la Fase 2; mientras no exista, crear con 0 usos y que el admin recargue).

## Fase 2 — Freemium (probar gratis → convertir)

**Objetivo**: que cualquiera pruebe sin pagar y se convierta cuando ya vio valor.

- Plan **free** auto-asignado al registrarse con Google, con usos de cortesía por herramienta (definir cuotas; propuesta inicial: 1 tabulación con marca de agua o muestra reducida, 1 descriptiva, 2 humanizaciones cortas, 1 títulos).
- El muro de pago aparece **después** de mostrar un resultado parcial (convierte mejor que bloquear antes de generar).
- Control de abuso del modo gratuito: límite por IP/dispositivo.
- Card "Mejora tu plan" al pie de la sidebar (estilo Platzi) visible solo para usuarios free.

## Fase 3 — Pagos y renovaciones (Taypi + PayPal)

**Objetivo**: que el usuario compre usos y renueve su plan solo, sin escribirle al admin por WhatsApp.

**Pasarela elegida: [Taypi](https://taypi.pe/)** (investigada el 2026-07-18):
- Cobra con **QR interoperable**: cubre Yape, Plin y las billeteras compatibles de BCP, BBVA, Interbank y Scotiabank con un solo QR.
- Comisión: **2.50% + S/ 0.20 + IGV por cobro confirmado**, sin mensualidad ni permanencia.
- Integración: panel web, **links de pago** y **API REST con firma HMAC-SHA256 + webhooks** (integrable "en una tarde" según su doc).
- **Ojo**: Taypi NO soporta pagos recurrentes nativos ni PayPal/tarjetas. Implicancias:
  - **Renovaciones**: se implementan de nuestro lado — un cron en el backend genera el cobro/link de cada mes y avisa al usuario (correo/WhatsApp); cuando el webhook confirma el pago, el sistema **recarga los usos del plan automáticamente**. Es "renovación asistida" (el usuario aprueba el QR cada mes), no débito automático — con Yape/Plin no existe débito automático real.
  - **PayPal**: integración aparte (PayPal Checkout) para pagos en USD del extranjero; PayPal SÍ tiene suscripciones nativas si se quiere débito automático en dólares.

**Flujo a construir**:
1. Página "Comprar usos / Mejorar plan" dentro de la app: elegir plan o paquete de usos por herramienta → botón de pago → QR de Taypi (o botón PayPal).
2. Webhook `POST /payments/taypi` (verificar firma HMAC): pago confirmado → acreditar usos según lo comprado + registrar en la actividad del usuario.
3. Recordatorio de renovación: cron mensual que genera el cobro del plan del usuario y le envía el link; al pagarse, recarga automática.
4. Historial de pagos visible en "Mi cuenta" y en el panel admin.
- Requiere la persistencia de la Fase 1 (los pagos no pueden vivir en un JSON efímero).

## Fase 4 — Objeto "Proyecto de tesis" + historial

**Objetivo**: la recomendación #1 de la auditoría UX; habilita el "Continuar proyecto" del mock.

- Nuevo objeto **Proyecto** con su **Instrumento** (variables → dimensiones → indicadores → ítems + escala) definido UNA vez y reutilizado por Tabulación, Confiabilidad, Descriptiva y Matriz (hoy se re-tipea en cada herramienta).
- **Historial de generaciones** por proyecto: re-descargar Exceles, ver actividad reciente, regenerar tras observaciones del jurado sin reconfigurar.
- URLs por sección (`/app/tabulacion`, `/app/proyecto/:id`) para deep-links y soporte.
- Requiere la base de datos de la Fase 1.

## Fase 5 — Almacenamiento de archivos

**Objetivo**: los archivos del proyecto viven en la nube; el medidor "X GB de Y GB" del mock.

- **Cloudflare R2 (recomendado sobre S3)**: API compatible con S3, 10 GB gratis y sin costo de egreso — relevante porque el producto descarga Exceles. AWS S3 es la alternativa directa si se prefiere el ecosistema AWS.
- URLs prefirmadas para subir/descargar; cuota de GB por plan; medidor en la sidebar.
- Requiere Proyectos (Fase 4) para tener dónde colgar los archivos.

## Fase 6 — Hub TesisHub multi-app

**Objetivo**: el mock del dashboard tipo Platzi (sidebar con grupos + card de plan, grid de apps con estados Disponible/Nuevo/Próximamente, "Continuar proyecto", atajos rápidos, almacenamiento).

- Solo cuando existan 2+ apps además de las actuales (p. ej. Referencias APA, Instrumentos).
- Con las Fases 1-5 hechas, el hub es principalmente una capa de presentación.

## Referencias

- Auditoría UX: `docs/ux-audit.md`
- Presets de planes: `node_app/server.js` (`PLAN_PRESETS`) y `frontend/src/lib/constants.ts` (mantener sincronizados)
- Mocks de referencia del hub: capturas compartidas por WhatsApp/screenshot el 2026-07-18 (estilo Platzi + dashboard de apps)
