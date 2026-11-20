# El Juego del Dinero — blog

Blog de finanzas personales en español (dominio: **18puro.com**).
Proyecto hermano de la app Reaviva: mismo patrón (Node + Express + Turso
libSQL, JWT con `uid`, JSON 10 MB, migraciones al arrancar).

## Qué hace

- **Blog público** (`/`): tarjetas de artículos publicados, más recientes
  primero, paginación de 10 por página. Sin artículos publicados muestra
  "Próximamente".
- **Artículo** (`/articulo/<slug>`): título, fecha, portada, cuerpo con
  tipografía legible, enlaces anterior/siguiente, meta SEO (title,
  description, Open Graph).
- **Portadas** (`/cover/<slug>`): imágenes JPG/PNG guardadas como BLOB en
  la base de datos (máx. 1.5 MB, se valida el formato real por magic bytes).
- **SEO**: `/sitemap.xml`, `/robots.txt`, `/rss.xml` generados desde los
  artículos publicados.
- **Panel admin** (`/admin`): login con usuario + contraseña (bcrypt, JWT
  en cookie httpOnly). Lista borradores y publicados, editor con título,
  slug automático (editable), resumen, portada y cuerpo en markdown mínimo
  (`##` subtítulo, `-` lista, `**negrita**`, `*cursiva*`, párrafos por
  líneas en blanco) + vista previa en vivo. Guardar como borrador o publicar.
  Pensado para usar desde el teléfono.
- **API para Muse** (publicación programada, p. ej. desde crons diarios):
  ver abajo. La clave nunca se registra en los logs.
- **Trivia del Dinero** (`/juegos`, pestaña 🎮 Juegos): juego público sin
  cuentas ni RV — 10 preguntas, 3 corazones, 10 puntos por acierto, sin
  repetir preguntas hasta agotar el banco de 100. Ver abajo.

## Ejecutar en local

```bash
npm install
cp .env.example .env   # completar valores
npm start              # http://localhost:3000
```

Sin variables `TURSO_*` usa SQLite local (`blog.db` en esta carpeta).
Contraseña de prueba local: `ADMIN_PASSWORD=Admin123!` (solo desarrollo).

## API de publicación (Muse)

Autenticación: cabecera `X-Publish-Key: <clave>` **o** JWT de admin
(cookie o `Authorization: Bearer`). Clave incorrecta → `401`.

```bash
# Crear artículo (publicado)
curl -s -X POST http://localhost:3000/api/admin/articles \
  -H "X-Publish-Key: $PUBLISH_KEY" -H "Content-Type: application/json" \
  -d '{"title":"Mi primer artículo","excerpt":"Resumen corto.","body":"Primer párrafo.\n\n## Subtítulo\n\nSegundo párrafo.","status":"published"}'
# → {"ok":true,"article":{"id":1,"slug":"mi-primer-articulo","url":"/articulo/mi-primer-articulo",...}}

# Crear borrador con portada (base64 JPG/PNG, máx. 1.5 MB)
curl -s -X POST http://localhost:3000/api/admin/articles \
  -H "X-Publish-Key: $PUBLISH_KEY" -H "Content-Type: application/json" \
  -d "{\"title\":\"Con portada\",\"body\":\"Texto.\",\"status\":\"draft\",\"coverBase64\":\"$(base64 -w0 portada.png)\",\"coverMime\":\"image/png\"}"

# Listar todos (borrador + publicado)
curl -s http://localhost:3000/api/admin/articles -H "X-Publish-Key: $PUBLISH_KEY"

# Publicar un borrador / editar campos
curl -s -X PATCH http://localhost:3000/api/admin/articles/1 \
  -H "X-Publish-Key: $PUBLISH_KEY" -H "Content-Type: application/json" \
  -d '{"status":"published"}'

# Eliminar
curl -s -X DELETE http://localhost:3000/api/admin/articles/1 \
  -H "X-Publish-Key: $PUBLISH_KEY"
```

Campos: `title` (3–200 caracteres, obligatorio al crear), `slug`
(opcional; se genera desde el título y se hace único con `-2`, `-3`…),
`excerpt` (máx. 300), `body` (markdown mínimo, máx. 200.000),
`coverBase64` + `coverMime`, `coverRemove: true` (quitar portada en PATCH),
`status`: `draft` | `published`.

## Trivia del Dinero (🎮 Juegos)

Juego público en `/juegos`, sin cuentas, sin RV y sin premios. Banco de
100 preguntas originales en español (`api/trivia-questions.js`, 5
categorías: Ahorro, Deudas y tarjetas, Casa y auto, Inversión,
El dinero y tú; respuestas correctas balanceadas 25/25/25/25).

**Reglas:**
- 10 preguntas por partida, 10 puntos por acierto.
- 3 corazones: cada error quita medio corazón; 6 errores terminan la
  partida antes de la pregunta 10.
- Sin repetir preguntas hasta agotar el banco: el cliente guarda los ids
  vistos en localStorage y los manda en `exclude`; cuando el banco se
  agota, el servidor devuelve una ronda nueva (`freshRound: true`).
- **Bloqueo de 24 horas (regla de Georges): si pierdes todos los
  corazones, hay que esperar 24 horas para volver a jugar.** La pantalla
  inicial muestra la cuenta atrás ("Vuelve en X h Y min") y bloquea el
  botón de inicio. Si terminas las 10 preguntas con corazones, puedes
  jugar de nuevo de inmediato (sin bloqueo).
- Mejor puntaje y mejor racha se guardan en localStorage.
- Sonidos Web Audio sin archivos: acierto = arpegio ascendente
  659.25/783.99/1046.5 Hz; error = una nota grave (Do3 130.81 Hz +
  armónicos).
- Flechas como en la app Reaviva: pantalla inicial → "→" a la derecha;
  jugando / resultado → "←" a la izquierda.

**Endpoints** (públicos, sin autenticación; las respuestas correctas
nunca salen en `/play`):

```bash
# 10 preguntas al azar (sin respuesta correcta ni explicación)
curl -s "http://localhost:3000/api/trivia/play?exclude=1,2,3"
# → {"questions":[{"id":4,"category":"Ahorro","question":"...","options":[...]}],"total":100,"freshRound":false}

# Con todo el banco excluido → ronda nueva (freshRound: true)
curl -s "http://localhost:3000/api/trivia/play?exclude=$(seq -s, 1 100)"

# Validar una respuesta
curl -s -X POST http://localhost:3000/api/trivia/answer \
  -H "Content-Type: application/json" -d '{"id":4,"choice":3}'
# → {"correct":true,"correctIndex":3,"explanation":"...","points":10}
# id desconocido → 404; choice fuera de 0-3 → 400
```

## Salud

`GET /api/health` → `{"ok":true,"service":"el-juego-del-dinero-blog",...}`

## Estructura

```
server.js        Express: rutas públicas, admin, API y trivia
db.js            Turso / SQLite local + migraciones (tabla articles)
lib.js           slug, markdown mínimo, validación de portadas y artículos
api/
  trivia-questions.js  Banco de 100 preguntas de la Trivia del Dinero
public/
  styles.css     Estilos del blog (verde profundo + dorado, mobile-first)
  trivia.css     Estilos del juego
  trivia.js      Lógica del juego (corazones, bloqueo 24 h, sonidos, récords)
  admin.html     Panel admin (login + lista + editor)
  admin.css      Estilos del panel
  admin.js       Lógica del panel (fetch con cookie, vista previa)
render.yaml      Servicio web gratuito en Render
DEPLOY.md        Pasos exactos de despliegue (GitHub + Render + DNS)
```

## Notas

- Contenido 100% original; sin fotos de stock ni recursos con copyright.
- Interfaz en español. Sin contenido religioso.
- La clave de publicación ya generada vive solo en `PUBLISH_KEY.txt`
  (chmod 600, fuera de Git). No está escrita en ningún otro archivo.
- El plan gratuito de Render se duerme sin tráfico: la primera visita
  tras el reposo tarda ~30–60 s en despertar.
