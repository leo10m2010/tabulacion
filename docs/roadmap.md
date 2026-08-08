# Roadmap de TesisHub

Acordado el 2026-07-18. Cada fase funciona por sí sola y deja valor aunque se pare ahí. El orden respeta las dependencias reales (no empezar una fase sin la anterior salvo que se indique).

## Ya hecho (base para todo lo demás)

- Rediseño visual completo (esmeralda/hueso, Space Grotesk, hero con screenshot real).
- **Sistema de usos por herramienta**: todo el acceso funciona por usos (1 uso = 1 generación/corrida), con reembolso automático si el job de IA falla, presets por plan (Esencial / Tesista / Institución) y selector de recargas por herramienta en el panel admin.
- Rename a **TesisHub** (decisión cerrada: el hub NO se llamará Tutorica).
- Auditoría UX en `docs/ux-audit.md` (cuello de botella: el instrumento se re-define en cada herramienta).

### Añadido el 2026-07-25 (revisión técnica + Fases 1 y 2 parciales)

- **Persistencia en Postgres (Neon, región Oregon)**: `lib/store/` con dos backends (Postgres si hay `DATABASE_URL`, archivo JSON si no, para tests y desarrollo local). Antes, el disco efímero de Render borraba todas las cuentas en cada deploy. Escritura diferida con cola ordenada; se espera confirmación solo donde al usuario se le confirma algo irreproducible. Apagado ordenado en `SIGTERM`.
- **Login con Google** (`POST /auth/google` + botón en la pantalla de acceso). Con Google, entrar y registrarse son la misma acción; el correo llega verificado sin necesitar dominio propio.
- **Plan `free` y auto-registro**: cuotas repartidas por costo real — Tabulación y Confiabilidad (sin IA, solo CPU) se regalan; Descriptiva, Títulos y Matriz quedan en 0 porque cuestan dinero por generación. Límite de altas por IP.
- **Eliminación de la propia cuenta** (`DELETE /auth/me`): requisito de la política de datos de Google y del RGPD, no una cortesía. Se confirma escribiendo el correo (no la contraseña: quien entró con Google no conoce la suya). Guarda solo un hash del correo borrado para no regalar otra cuota gratuita a quien borre y vuelva a registrarse.
- **Herramientas bloqueadas visibles**: candado en la barra lateral y aviso dentro de la herramienta, en vez de esconderlas.
- **Correcciones**: la generación del Excel salió a un worker (ya no degrada el servidor ni lo tumba por falta de memoria); race que hacía que un cambio de contraseña respondiera 200 sin cambiar nada; límite de login evadible rotando el correo; 0 vulnerabilidades en backend y Forms.
- **CI en GitHub Actions** (Node 24 LTS, igual que Render) y chequeo de tipos en el build del frontend.

## Bloqueado por no tener dominio propio

Todo esto espera a comprar un dominio (~$10/año). Es la dependencia más barata que queda y desbloquea varias cosas a la vez:

- **Correo transaccional** (Resend: 3.000/mes gratis, pero exige dominio verificado; `.vercel.app` no sirve para enviar correo). Sin él no hay:
  - Verificación de correo → por eso el registro por correo está **apagado** (`REGISTRATION_ENABLED=false`) y el auto-registro va solo por Google.
  - Recuperación de contraseña (hoy quien la olvida depende del admin).
  - Avisos de renovación de la Fase 3.
- **Marca propia** en vez de `tabulacion.vercel.app`, que resta credibilidad para cobrar.

## Pendiente en el frontend

- **Peso del bundle**: 1,13 MB (382 kB comprimido). Las 9 secciones se importan estáticamente, así que la landing carga hasta el panel de administración. Con visitantes llegando de fuera, esto ya importa: `React.lazy` por sección.
- **Tests**: ya hay Vitest con 20 pruebas sobre `lib/api.ts` y `lib/helpers.ts` (lógica pura y manejo de sesión), y corren en CI. Falta cubrir los componentes.
- **Sesión**: el token sigue sin refrescarse; a las 24 h caduca. Ya no rompe la app (se cierra la sesión con un mensaje claro), pero el usuario tiene que volver a entrar.
- **Duplicación de polling**: cuatro secciones de IA repiten el mismo bucle (extraer un hook `useAiJob`).
- **Página de "Mejorar plan"** con los precios, hoy inexistente (el aviso solo dice "escríbenos").

## Pendiente en el backend

- **`server.js` tiene ~2.100 líneas** y cuatro bloques de gestión de jobs de IA casi idénticos (~360 líneas repetidas). Extraer un `createJobRunner` deja cada herramienta en ~10 líneas; conviene hacerlo *cuando* se añada la herramienta siguiente.
- **`MAX_MUESTRA` promete 2.000 encuestados**, pero con la memoria del plan gratis el máximo real medido es ~800. Hoy falla con un mensaje claro en vez de tumbar el proceso, pero la promesa sigue siendo falsa.
- **`xlsx@0.18.5`** (frontend) tiene vulnerabilidad alta sin parche en npm; habría que pasar al paquete oficial de SheetJS o a `exceljs`.
- **Sin logging estructurado**: no hay forma de rastrear el fallo de un usuario concreto.
- **ESLint no existe**, pese a los comentarios `eslint-disable` repartidos por el código.

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

**Estado (2026-07-25): backend hecho.** El objeto Proyecto existe, con su
Instrumento (escala, variables, dimensiones, indicadores, ítems y baremo con
porcentajes), persistido en Postgres y con sus endpoints (`GET/POST /proyectos`,
`GET/PATCH/DELETE /proyectos/:id`). Un proyecto es privado: ni siquiera un
administrador puede leerlo. Al eliminar la cuenta se borran sus proyectos.
Límite por plan (free 1, esencial 3, tesista 10). 11 pruebas, más una que
verifica contra Postgres real que el instrumento sobrevive a un reinicio con el
disco borrado.

A diferencia del almacén de usuarios, los proyectos se escriben **fila a fila**:
son muchos y cada uno lleva su instrumento dentro, así que reescribir el arreglo
completo en cada cambio mandaría megas a Neon por renombrar algo.

**Interfaz hecha (2026-07-25)**: seccion "Mis proyectos" con crear, listar,
elegir el activo y eliminar (con confirmacion). El proyecto activo se recuerda
entre visitas y da nombre a su entrada en la barra lateral; si se borro, se
olvida en silencio en vez de dejar la app apuntando a la nada.

**Falta**: el editor del instrumento y conectar las herramientas para que lo
lean en vez de pedirlo de nuevo (Tabulacion, Confiabilidad, Descriptiva y
Matriz).

**Retención de archivos (decidido)**: sin caducidad por tiempo. Los archivos
viven mientras exista el proyecto y el usuario los borra cuando quiera; cada
plan tendrá su cuota de espacio. Se descartó caducar a los 5 días: una tesis
dura meses y el historial existe justamente para "regenerar tras observaciones
del jurado". Los números lo respaldan — un proyecto completo ronda 0,4 MB y en
los 10 GB gratis de R2 caben ~24.600, así que 200 usuarios con 3 proyectos cada
uno ocupan el 2,5% del plan gratuito.

**Objetivo**: la recomendación #1 de la auditoría UX; habilita el "Continuar proyecto" del mock.

- Nuevo objeto **Proyecto** con su **Instrumento** (variables → dimensiones → indicadores → ítems + escala) definido UNA vez y reutilizado por Tabulación, Confiabilidad, Descriptiva y Matriz (hoy se re-tipea en cada herramienta).
- **Historial de generaciones** por proyecto: re-descargar Exceles, ver actividad reciente, regenerar tras observaciones del jurado sin reconfigurar.
- URLs por sección (`/app/tabulacion`, `/app/proyecto/:id`) para deep-links y soporte.
- Requiere la base de datos de la Fase 1.

## Fase 5 — Almacenamiento de archivos

**Objetivo**: los archivos del proyecto viven en la nube; el medidor "X GB de Y GB" del mock.

**Cuenta de R2 ya creada** (Account ID `2953e58cfc392b7a60cc0850b069abe7`, endpoint S3 `https://2953e58cfc392b7a60cc0850b069abe7.r2.cloudflarestorage.com`). Faltan las llaves (Access Key ID y Secret), que se generan cuando se vaya a implementar — **no antes**: hoy no hay nada que guardar, porque los Excel y Word se generan, viajan en base64 y se descartan. El almacenamiento necesita primero el objeto Proyecto de la Fase 4, que es lo que le da dueño y sitio a cada archivo.

- **Cloudflare R2 (recomendado sobre S3)**: API compatible con S3, 10 GB gratis y sin costo de egreso — relevante porque el producto descarga Exceles. **AWS S3** es la alternativa directa si se prefiere el ecosistema AWS: su capa gratuita es limitada (5 GB) y, sobre todo, **cobra por egreso**, que es justo lo que más hace este producto (descargar archivos). Con R2 esa factura no existe. Si ya se usa AWS para otra cosa, S3 simplifica la operación; si no, R2 sale más barato.
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
