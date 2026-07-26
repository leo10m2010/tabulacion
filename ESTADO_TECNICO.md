# Estado técnico del proyecto

Actualizado: 2026-07-25.

## Auditoría y endurecimiento (2026-07-25)

Pasada de auditoría con verificación reproducible. Línea base antes de tocar
nada: 247 tests de backend, 6 de Forms, 64 de frontend, build y tipos OK.
Después: **274 / 16 / 83**, todo en verde.

### Seguridad

- **Aislamiento de los jobs de Forms (crítico).** `forms/server.js` guardaba
  los jobs en un único almacén sin dueño: cualquier cuenta con clave `ttab_`
  válida leía las corridas de todos (URL del formulario, etiqueta, resultado),
  las cancelaba y podía vaciar el historial completo del servicio con un solo
  `DELETE`. Ahora cada job lleva `ownerEmail` y las cuatro rutas filtran por él
  (404, no 403, para no revelar existencia). El modo legado y la llave maestra
  siguen viéndolo todo. Cubierto por `forms/tests/tesistab-aislamiento.test.js`
  (5 de sus 7 pruebas fallan sin el arreglo).
- **XSS reflejado en `/_submit`.** La página interpolaba `req.query.id` dentro
  de un `<script>` con `JSON.stringify`, que no escapa la barra: un id con
  `</script>` cerraba el bloque. Ruta pública, sin autenticación. Los ids son
  UUID, así que se validan con regex y la inyección se cierra en origen; además
  la página fija su propia CSP. Cubierto por `forms/tests/submit-xss.test.js`.
- **Tope de entrada en Descriptiva.** No había límite de longitud: un uso podía
  empujar ~4 MB de texto a OpenRouter. Ahora 40.000 caracteres (~6.000
  palabras), aplicado también al `.docx` **después** de convertirlo (3 MB
  comprimidos se expanden sin tope). Títulos y matriz ya acotaban a 200; el
  humanizador a 3.000 palabras.
- **Cabeceras de seguridad.** No había ninguna. Se añaden en la API
  (`setSecurityHeaders`: CSP `default-src 'none'`, nosniff, `X-Frame-Options`,
  `Referrer-Policy`, HSTS) y en `frontend/vercel.json` (CSP completa,
  `frame-ancestors 'none'`, HSTS, `Permissions-Policy`).
- **TOCTOU en los cuatro endpoints de IA.** El control de concurrencia se hacía
  contra un mapa que solo se poblaba *después* de `await writeUsers()`. El
  registro se movió antes del await, así que comprobar y registrar ocurren en el
  mismo turno del event loop. *Nota honesta*: la ventana era estrecha y no se
  consiguió dispararla desde fuera; la prueba asociada es un guardián del
  invariante, no una demostración del fallo.

### Exactitud y honestidad estadística

- **El control del patrón de resultados se declara siempre.** El
  cuasiexperimental genera hasta 80 muestras y conserva la que minimiza un
  puntaje que premia `p < α` — es muestreo por rechazo condicionado al
  resultado del contraste. Antes solo avisaba cuando **fallaba**: el caso que
  hay que declarar (que lo consiguiera) salía mudo. Ahora el aviso se emite
  siempre, con el número real de intentos, y la hoja "Información" explica qué
  significa "Activado" en lugar de solo escribir la palabra.
- **La nota de significación dejó de mentir.** `sheets.js` escribía "la
  correlación es significativa en el nivel 0,01" como texto fijo bajo *todas*
  las tablas, incluso con `Sig. = 0,96` dos filas más arriba. Ahora es una
  fórmula que lee ese Sig. y contempla los tres desenlaces. Verificado
  recalculando con `scripts/recalc.py`: con nivel "nula" dice "no es
  estadísticamente significativa"; con nivel "muy alta" sigue diciendo 0,01.
- **El aviso de datos simulados vivía dentro del bloque del control de
  correlación**, que es `null` con una sola variable: ese archivo salía con la
  base inventada y sin ninguna marca. Ahora depende de `conDatos`.

### Generador de Excel

- **Dimensión o indicador con 0 ítems producía un archivo ilegible** (crítico).
  El rango de columnas salía invertido (`endCol = startCol - 1`) y el `.xlsx`
  incluía `mergeCell ref="B2:A2"` y `SUM(K34:J34)`; openpyxl se niega a abrirlo.
  Era alcanzable desde la interfaz y el usuario gastaba un uso. Se valida en
  `config.js` (backend) y en `wizard-validation.ts` (antes de gastar el uso).
- **Baremos imposibles.** Con más niveles que puntajes alcanzables, la ficha
  mostraba filas "Desde 3, Hasta 2" y el IF anidado tenía umbrales muertos.
  `computeNiveles` ya no puede devolver rangos invertidos, y `config.js` rechaza
  la configuración explicando por qué.
- **Nombres de hoja.** `sanitizeSheetName` hacía `trim()` **antes** del
  `slice(0,31)`, dejando espacios finales, y no saneaba el apóstrofo — que el
  truncado podía *crear* al final de un nombre legítimo, produciendo fórmulas
  con triple apóstrofo y cientos de `#REF!`.
- **N=2.** `IFERROR(...,0)` convertía el `#DIV/0!` de 0 grados de libertad en
  `Sig. = 0.0000`, que se lee como la significación más fuerte posible justo
  donde no hay información. Ahora queda vacío.

### Frontend

- **El asistente ya no pierde el trabajo.** `TabulacionSection` guardaba todo en
  `useState` y `App.tsx` la renderiza condicionalmente: cambiar de sección la
  desmontaba y borraba la configuración entera; recargar, también. Hay borrador
  por cuenta en `lib/wizard-draft.ts` (guardado con retardo, aviso visible al
  recuperar, "Empezar de cero", `beforeunload` mientras hay trabajo sin generar,
  y limpieza de todos los borradores al cerrar sesión — el instrumento no debe
  sobrevivir en un equipo compartido).
- **Bundle inicial: 583 kB → 386 kB (167 → 122 KB gzip).** Las once secciones
  viajaban en el chunk inicial; ahora cada una es su propio chunk con
  `React.lazy` y un esqueleto de carga. La landing y el acceso siguen en el
  bundle inicial a propósito (ruta crítica).
- **Accesibilidad.** Todo el frontend tenía 10 atributos ARIA, cero `aria-live`
  y cero `aria-current`: errores y progreso eran invisibles para un lector de
  pantalla y la navegación no decía dónde estabas. Se añaden `role="alert"` a
  los errores, `aria-live` al progreso de generación, `aria-current="page"` a
  toda la navegación y landmarks `<nav aria-label>`.

### Riesgo operativo a tener presente

`frontend/vercel.json` fija el dominio de la API en `connect-src`
(`https://tabulacion-api.onrender.com`). **Si se cambia `VITE_API_BASE_URL` a
otro dominio hay que añadirlo ahí**, o el navegador bloqueará todas las
peticiones de la app en producción. Verificado contra el servicio real: ese es
el dominio que Render sirve hoy.

## Presupuesto de generación y condiciones reales de producción (2026-07-25)

### Lo que dice Render (consultado por su API, sin modificar nada)

| | `tabulacion-api` |
|---|---|
| Plan / región | free / oregon, 1 instancia |
| **Memoria** | **512 MB** (`memory_limit` = 536.870.900 bytes) |
| **CPU** | **0,15** (`cpu_limit`) — tan restrictiva como la memoria |
| Node | 20 (declarado en `render.yaml`) |
| Build / start | coinciden exactamente con `render.yaml` |
| Healthcheck | `/health` |
| Memoria en reposo | ~48-51 MB |
| Reinicios | cada 2-3 h, arranques limpios (spin-down del plan free) |
| OOM en los últimos 30 días | ninguno |

Dos matices importantes sobre ese "ningún OOM": en la ventana consultada **no
hay tráfico real de generación**, así que producción no puede confirmar ni
desmentir el riesgo de memoria; y la CPU de 0,15 significa que una generación
que aquí tarda 2 s puede tardar del orden de 15-20 s allí.

Diferencias detectadas con `render.yaml`:

- Existe un **segundo servicio** `tutorica-forms` (rootDir `forms`, creado el
  2026-06-12), hoy **suspendido a propósito**, que `render.yaml` no declara. Es
  la arquitectura anterior, de cuando Forms corría como servicio aparte; hoy el
  servicio activo lo monta dentro del mismo proceso.

  **Se conserva, y no hay motivo técnico para borrarlo.** Nada del código
  apunta a `tutorica-forms.onrender.com` (la extensión usa
  `tabulacion-api.onrender.com` por defecto, y su lista de migración de URLs
  antiguas solo contiene variantes de `localhost:5000`), suspendido en plan
  free no cuesta nada, mantiene reservado ese nombre en Render y deja abierta
  la vuelta atrás. Lo único que faltaba era que estuviera escrito en algún
  sitio: esto es ese sitio.

  Sí conviene comprobar, antes de volver a sincronizar el blueprint desde
  `render.yaml`, si esa sincronización podría eliminar servicios no declarados.
  No se verificó.
- El servicio corre el commit `0424037`; el repositorio local va por delante.

### El presupuesto conjunto

`node_app/lib/presupuesto.js` es la fuente de verdad. **No reduce ningún
máximo**: la muestra sigue admitiendo 2.000 encuestados y cada variable 60
ítems. Lo que se rechaza es la combinación que no cabe, y el mensaje dice qué
reducir y hasta cuánto.

Calibrado midiendo, no con una fórmula teórica
(`scripts/benchmark-generacion.mjs`, con el heap real de producción):

| N | ítems | vars | resultado | pico RSS |
|---|---|---|---|---|
| 300 | 60 | 2 | ok | 423 MB |
| 1000 | 18 | 1 | ok | 444 MB |
| 2000 | 18 | 1 | ok | 478 MB |
| 500 | 40 | 2 | ok | **534 MB** — no cabe |
| 1000 | 15 | 2 | ok | **572 MB** — no cabe |
| 800 | 27 | 2 | ok | **612 MB** — no cabe |
| 1500 | 15 | 2 | **OOM** | — |

Dos conclusiones que corrigen lo que se suponía:

1. **El coste no es proporcional al número de celdas.** 1000×15 son 15.000
   celdas y gasta 572 MB; 300×60 son 18.000 y gasta 423 MB. Pesa más el número
   de encuestados, porque cada uno añade filas de fórmulas.
2. **"ok" en local no significa "cabe en producción".** El worker comparte los
   512 MB con el servidor HTTP (~50 MB): un pico de 534 MB suma ~584 MB y el
   contenedor lo mata aunque Node no se haya quedado sin heap.

El backend rechaza en la normalización, **antes** de descontar el uso y de
arrancar el worker; `/template-info` publica el presupuesto para que el
asistente avise mientras el usuario sigue en el formulario.

## Validación de Excel con LibreOffice (2026-07-25)

`scripts/validar-excel-libreoffice.mjs` genera una matriz de 19 casos y, por
cada uno: valida el OOXML sin abrirlo, deja que **LibreOffice 26.2 lo abra,
recalcule y lo guarde**, cuenta las celdas que quedaron en error y lo convierte
a PDF. Un caso solo es válido si supera los cinco pasos.

Esto cierra un hueco real: hasta ahora los archivos se validaban parseando su
XML, lo que prueba que la estructura es correcta pero no que una hoja de
cálculo resuelva las fórmulas ni que el documento se vea bien impreso.

Resultado sobre el código actual: **19/19 casos, cero celdas en error** tras el
recálculo. Cubre una y dos variables, Pearson y Spearman, correlación positiva,
negativa y nula, con y sin control de resultados, Likert de 3/5/7, escala
personalizada, baremo automático y manual, muestra mínima y mediana, nombres
largos, caracteres especiales y los dos flujos cuasiexperimentales.

La revisión visual de los PDF encontró un defecto que ninguna validación
automática detectaba: en las hojas de medición del cuasiexperimental los
nombres de ítem se **cortaban a media palabra** porque el alto de fila era fijo.
Corregido calculando el alto del texto real. Queda pendiente lo cosmético: con
columnas de ancho 8 las palabras largas siguen partiéndose, pero ya no se
pierde texto.

---

Actualizado antes: 2026-07-01.

## Resumen

- Generación **100% por código** (`node_app/generator.js` orquesta módulos en `node_app/lib/`): `xlsx-populate` construye celdas/fórmulas/estilos y un post-procesado con `jszip` deduplica estilos e inyecta los gráficos OOXML. **No existe plantilla**: `Tabulacion.xlsx` fue eliminada del repositorio.
- API HTTP propia (`node_app/server.js`) con auth por tokens, roles, suscripciones y rate limiting.
- Frontend React/Vite en `frontend/` consumiendo la API (`POST /generate` en modo `inline`); envía la estructura jerárquica en `estructura_v1`/`estructura_v2`.
- Suite de tests con `node:test` (`cd node_app && npm test`): 28 tests de generador y API.
- Verificación de fórmulas: `python scripts/recalc.py archivo.xlsx` recalcula todas las fórmulas del Excel (librería `formulas`) y reporta celdas con error; `--show PATRON` imprime valores recalculados de celdas clave.

## Landing multi-producto + limpieza (2026-07-02)

- **Landing actualizada** (`LandingPage.tsx`): dejó de ser mono-producto. Hero con copy de suite ("La estadística de tu tesis"), nav de anclas en el header, FAQ con 2 preguntas nuevas (confiabilidad y Forms), highlights de planes y footer actualizados.
- **Sección `#herramientas` = showcase interactivo** (`ToolsShowcase.tsx`): tabs verticales con el flujo Recolecta → Valida → Tabula y un panel donde cada herramienta tiene su viñeta en vivo (formulario Likert respondiéndose, medidor de α con semáforo sobre el rango 0.50–1.00 y datos de una corrida real α=0.963, tabla baremada con interpretación narrativa). Auto-avanza cada 6 s con barra de progreso, clic fija la pestaña, `prefers-reduced-motion` desactiva el auto-avance. Verificado con capturas (Brave headless + puppeteer-core) en claro/oscuro y móvil.
- **Refactors**: navegación de la app data-driven (`NAV_TOOLS` en `App.tsx` reemplaza 8 botones duplicados de sidebar+tabs móviles; las tabs móviles ahora hacen scroll horizontal); `SubscriptionWarning` compartido (App y CronbachSection); `ALPHA_LEVELS` en `lib/constants.ts` (junto a `CORRELATION_LEVELS`); `registerGeneration()` en `server.js` deduplica las métricas de `/generate` y `/cronbach`.
- Pendiente conocido (sin cambios): extraer los pasos del wizard de `App.tsx` (~1,500 líneas) a componentes.

## Prueba de confiabilidad — Alfa de Cronbach (2026-07-02)

- **Nuevo apartado "Confiabilidad"** en la web (`CronbachSection.tsx`, entre Tabulación y Forms): la prueba se hace **por variable** con los mismos datos del instrumento (nombre, dimensiones y cantidad de ítems) más el N de encuestados y el **nivel de alfa deseado** (excelente 0.90–0.97 / bueno 0.80–0.89 / aceptable 0.70–0.79, escala de George y Mallery).
- **Backend**: `node_app/lib/cronbach.js` (`normalizeCronbachConfig`, `generateCronbachData`, `buildCronbachWorkbook`, `generateCronbach`) + `POST /cronbach` (misma suscripción vigente que `/generate`; incrementa `generationsCount` y registra actividad). `/template-info` expone `nivelesAlfa`.
- **Simulación adaptativa**: rasgo latente por encuestado (variación normal entre sujetos) + sesgo leve por ítem + ruido intra-sujeto que se ajusta hasta que el α (calculado con varianza poblacional, igual que VARP) cae en el rango pedido. El α nunca llega a 1.0 (datos idénticos serían sospechosos).
- **Excel de una sola hoja** ("Alfa de Cronbach", Calibri, sin cuadrícula, encabezados congelados): título azul marino, subtítulo celeste, tabla de datos con bandas alternadas y columna SUMA resaltada, fila VARIANZA (fórmula `VARP`) en naranja claro, panel de tarjetas con K (`=COUNT()` sobre la fila de varianzas, nunca fijo), ΣSi², St² y α=(K/(K-1))*(1-(ΣSi²/St²)) **como fórmulas vivas**, interpretación automática con SI anidado + TEXTO, escala de interpretación con semáforo de colores y leyenda Likert a la derecha. Estilos deduplicados con el mismo post-procesado OOXML.
- Verificado con `scripts/recalc.py` (nuevo): 0 errores de fórmula; el α recalculado en celda coincide con el del generador.

## Auditoría de seguridad del sistema de usuarios (2026-07-02)

- **Hallazgo**: el repo es público y commits antiguos (hasta `7884f4b`) contienen `node_app/data/users.json` con el hash scrypt del admin **de desarrollo** (`admin@tabulacion.local`, contraseña de dev visible en el autofill DEV del login). Nunca hubo datos de clientes ni secretos de producción en el historial (`frontend/.env` histórico solo tenía `VITE_API_BASE_URL=/api`). Regla operativa: **la contraseña/email del admin de producción (Render, sync:false) jamás debe coincidir con los valores de desarrollo.**
- Los usuarios de los tests (`*@test.local`) viven en un `USER_STORE_PATH` temporal por proceso y nunca tocan producción.
- **Endurecimiento aplicado**: `tokenVersion` por usuario — cambiar o restablecer la contraseña (self-service, admin o sync del bootstrap) invalida todas las sesiones anteriores (el claim `ver` del token se verifica en `requireAuth`); el self-service devuelve un token fresco para no cortar la sesión actual, y tiene rate limiting propio (mismo límite que el login) para que un token robado no pueda probar contraseñas sin freno.

## Acceso desacoplado, dashboard tabla+panel y self-service (2026-07-02)

- **Productos desacoplados**: el login solo exige cuenta activa; `/generate` exige suscripción vigente (`requireAuth(req, { requireSubscription: true })`); Forms va por usos aunque la suscripción esté vencida (el validador de claves ya no rechaza por vencimiento). La web muestra un aviso ámbar en Tabulación cuando la suscripción venció.
- **Dashboard admin = tabla + panel lateral**: tabla compacta (usuario/suscripción/usos/Excel/último acceso) con filtros (incluye "Por vencer" ≤7 días con chip ámbar) y panel lateral (Escape o backdrop para cerrar) con resumen, recargas de días/usos, rol/plan, reset de contraseña, revocar clave API, eliminar e **historial de actividad** (`activity` por usuario, últimos 30 eventos: cuenta creada, recargas del admin, corridas de Forms, Excel generados, cambios de contraseña/clave).
- **Respaldo del almacén**: `GET /auth/users/backup` y `POST /auth/users/restore` (admin) + botones Exportar/Importar en el dashboard con confirmación inline — mitiga el disco efímero de Render free.
- **Contraseña self-service**: `POST /auth/change-password` + sección "Mi cuenta" (resumen de cuenta, usos, suscripción y cambio de contraseña); accesible desde la caja de usuario del sidebar y la pestaña móvil "Cuenta".

## Forms por usos + dashboard de administración (2026-07-02)

- **Forms funciona por usos**: 1 uso = 1 corrida de llenado (job). El consumo ocurre en `POST /api/tesistab/submit` y en la ruta de compatibilidad, tras pasar todas las validaciones; los admins tienen usos ilimitados (`usesLeft: null`). El anfitrión inyecta `formsApp.setUsageConsumer(fn)` junto al validador en memoria; sin consumidor (modo legado/tests) no se descuenta. La extensión (v1.3.0, zip regenerado) muestra los usos restantes en la tarjeta de conexión (`/api/tesistab/config` ahora incluye `user.usesLeft`), y la sección Forms de la web muestra el saldo del usuario. Tabulación sigue por suscripción (días).
- **Usuarios**: `users.json` guarda `formsUsesLeft/formsUsesUsed` y métricas `generationsCount/lastGenerationAt` (se incrementan en `/generate`). `sanitizeUser` expone además `hasApiKey`/`apiKeyLast4`. `PATCH /auth/users/:id` acepta `role`, `plan`, `password` (reset), `formsUses`/`formsUsesDelta`; nuevo `DELETE /auth/users/:id/api-key` (admin revoca la clave de la extensión de un usuario).
- **Dashboard admin rediseñado** (`UsersSection.tsx`): tarjetas de métricas globales (activos, vencidos, Excel generados, usos de Forms), buscador por email y filtros por estado/rol, formulario de creación plegable con usos iniciales, y por usuario: chips de estado/rol, métricas con `tabular-nums`, recargas rápidas de días y usos, y panel "Gestionar" expandible (rol, plan, reset de contraseña, revocar clave API, eliminar con confirmación inline). Skeletons de carga y estados vacíos diferenciados.
- El ítem "Análisis (Pronto)" del menú pasó a "Generador de títulos" (sigue Pronto).

## Hojas de conteo eliminadas + método de correlación explícito (2026-07-01)

- Se eliminaron las hojas "Conteo <Variable>": contaban las respuestas Likert agregadas por dimensión, pero la escala Likert es exclusivamente de los ítems — las dimensiones se miden por **niveles de baremo** (tabla baremada de la hoja Dimensiones). El Excel queda en 9 hojas / 33 gráficos con la config clásica.
- `metodoCorrelacion` ahora es `auto` (default) | `pearson` | `spearman`. En `auto` la prueba de normalidad decide el método de las hojas (comportamiento anterior). Con un método explícito, **ese método manda** en Relaciones/Correlación y la narrativa lo justifica sin contradecir la tabla de normalidad (p. ej. Pearson con normalidad rechazada → "considerando el tamaño de la muestra y la robustez del estimador… conforme al diseño metodológico"). Con `pearson` los ítems se discretizan con umbrales lineales (forma cuasi-normal) y el lazo de control además prefiere bases que pasan la normalidad — a N chico/medio la normalidad pasa de verdad; a N grande (~300) las sumas Likert discretas rechazan KS/SW casi siempre (propiedad estadística real), y ahí aplica la narrativa justificada.

## Control opcional de correlación (2026-07-01)

- Interruptor `controlCorrelacion` (default activado por compatibilidad): activado, el usuario elige `nivelCorrelacion` (muy_alta/alta/moderada/baja/muy_baja/nula, rangos en valor absoluto) y el generador busca adaptativamente el peso del factor compartido hasta que la correlación de las sumas caiga en el rango; desactivado, la correlación es el resultado natural (fuerza aleatoria por generación). El signo lo aporta `relacionversa` (no se vuelve a preguntar). Verificación con `metodoCorrelacion`: Spearman (default, adecuado para Likert) o Pearson. El resultado (`correlationControl`: activo, nivel, dirección, método, obtenido, rango esperado, cumple) viaja en la respuesta inline, se muestra en el paso 3 del frontend y se documenta en la hoja "Información" con el disclaimer de datos simulados.

## Simulación de datos con dispersión realista (2026-07-01)

- `generateBaseData` (`node_app/lib/stats.js`) dejó de concentrar todas las respuestas en el centro: cada ítem recibe un **perfil de distribución** aleatorio (campana, polarizado, sesgado alto/bajo o disperso, con parámetros aleatorios por ítem) aplicado como warp monótono sobre el percentil, y hay **heterogeneidad entre encuestados** (rasgo individual de estilo de respuesta + grupos latentes con medias distintas). Como los warps son monótonos sobre el mismo factor latente, la correlación objetivo se conserva (|r| ≈ 0.97-0.98, inversa incluida) y los valores siempre caen dentro del rango de la escala.

## Refactor por módulos (2026-07-01)

- `node_app/generator.js` (antes ~1,800 líneas) quedó como orquestador de ~70 líneas que **re-exporta la API pública** (los imports de server/tests/CLI no cambian). La lógica vive en `node_app/lib/`: `config.js` (normalización, límites, temas), `stats.js` (simulación, correlación, normalidad), `sheet-style.js` (estilos y utilidades), `narratives.js` (interpretaciones), `sheets.js` (las hojas + `buildWorkbook`) y `ooxml.js` (dedupe de estilos + gráficos).
- `frontend/src/App.tsx` (antes ~1,800 líneas) bajó a ~1,280: `lib/api.ts` centraliza todas las llamadas HTTP; `components/LoginScreen.tsx`, `components/sections/UsersSection.tsx` y `components/sections/FormsSection.tsx` son autocontenidos (estado + API propios). App conserva el wizard de 3 pasos; la siguiente pasada natural es extraer los pasos del wizard.
- Pendiente de refactor (baja prioridad, código estable): `forms/server.js` y la extensión (`content.js`).

## Migración a generador sin plantilla (2026-06-11)

- Reescritura completa de `generator.js`: el Excel se construye desde cero en cada generación (por variable: hoja base, "Ítems", "Dimensiones" y "Conteo"; globales: "Relaciones", "Correlación" e "Información"). Sin límites heredados de la plantilla: muestra 2–2,000, hasta 60 ítems por variable, escala y niveles de baremo libres.
- Formato de tesis replicado del Excel original: rótulos "Tabla N"/"Figura N", "Fuente: Encuesta aplicada"/"Elaboración: Propia", encabezados amarillos por bloque, marco verde, tabla de normalidad (KS-Lilliefors/Shapiro-Wilk calculada por el generador; en blanco con `conDatos: "0"`) y correlaciones Pearson/Spearman con Sig. bilateral.
- **Interpretaciones narrativas automáticas** por ítem, dimensión y conteo, redactadas en JS con los porcentajes reales de los datos generados (con base vacía se emite un texto guía).
- Gráficos generados por código (barras con etiquetas de datos): uno por ítem, uno por dimensión (conteo), uno por dimensión y uno consolidado por variable (frecuencia baremada).
- Deduplicación de estilos en post-procesado (xlsx-populate crea un estilo por celda: styles.xml pasaba de ~10 MB a ~5 KB).
- `conDatos: "0"` genera la base vacía para ingreso manual (las fórmulas muestran vacío, nunca errores).
- `GET /template-info` ahora reporta los límites del generador.
- Despliegue sin Docker (2026-06-11): frontend en Vercel (`frontend/vercel.json`) y API en Render (`render.yaml`, Node directo con healthcheck y disco persistente para `users.json`). Dockerfile, docker-compose y netlify.toml eliminados.
- Eliminados: `Tabulacion.xlsx`, salidas versionadas (`Tabulacion_generada.xlsx`, `Tabulacion_base.csv`), restos de la era Python en los ignores y ~800 líneas de maquinaria de adaptación de plantilla.

## Seguridad (auditoría 2026-06)

- Sin secretos por defecto: `AUTH_TOKEN_SECRET` y `ADMIN_PASSWORD` se exigen por entorno (con fallback aleatorio por arranque); `users.json` y `.env` fuera de git.
- El rol `user` puede generar (la suscripción se valida en cada request); la gestión de usuarios sigue siendo solo admin.
- El historial de git contiene un `users.json` antiguo con hash del admin y la contraseña documentada `Admin12345!`: cualquier despliegue que conserve ese usuario debe rotar la contraseña.

## Riesgos y pendientes conocidos

- Los resultados en modo `links` viven en memoria: se pierden al reiniciar y no escalan a múltiples réplicas (el frontend usa modo `inline`, que no depende de esto).
- Los gráficos se validaron estructuralmente (openpyxl los parsea contra el esquema OOXML) pero conviene una verificación visual en Excel de escritorio tras cambios al XML de charts.
- `frontend/src/App.tsx` quedó en ~1,600 líneas tras extraer `lib/` y `components/` (2026-06-11); segunda fase pendiente: extraer los pasos del wizard y la sección de usuarios.
