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

## Salud

`GET /api/health` → `{"ok":true,"service":"el-juego-del-dinero-blog",...}`

## Estructura

```
server.js        Express: rutas públicas, admin y API
db.js            Turso / SQLite local + migraciones (tabla articles)
lib.js           slug, markdown mínimo, validación de portadas y artículos
public/
  styles.css     Estilos del blog (verde profundo + dorado, mobile-first)
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
