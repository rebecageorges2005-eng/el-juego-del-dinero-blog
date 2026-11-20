/* El Juego del Dinero — blog de finanzas personales en español (18puro.com)
 *
 *  npm install
 *  cp .env.example .env   # completar valores (ver DEPLOY.md)
 *  npm start              # http://localhost:3000
 *
 * Patrón heredado de la app Reaviva: Express 4 + Turso libSQL (o SQLite
 * local si no hay variables TURSO_*), JWT con payload { uid }, JSON 10 MB.
 *
 * Rutas públicas (server-rendered, SEO):
 *   GET  /                    portada con artículos publicados
 *   GET  /articulo/<slug>    artículo completo
 *   GET  /cover/<slug>       portada del artículo (JPG/PNG desde la BD)
 *   GET  /sitemap.xml  /robots.txt  /rss.xml
 *   GET  /admin               panel (login + editor)
 *   GET  /api/health
 *
 * Rutas de admin (JWT en cookie httpOnly, o cabecera X-Publish-Key):
 *   POST   /api/admin/login
 *   POST   /api/admin/logout
 *   GET    /api/admin/me
 *   GET    /api/admin/articles
 *   POST   /api/admin/articles
 *   PATCH  /api/admin/articles/:id
 *   DELETE /api/admin/articles/:id
 */
"use strict";

require("dotenv").config();
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const db = require("./db");
const {
  escapeHtml, slugify, isValidSlug, renderBody,
  validateCover, validateArticleInput, formatDate,
} = require("./lib");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const SITE_URL = (process.env.SITE_URL || "https://18puro.com").replace(/\/$/, "");
const PAGE_SIZE = 10;

if (process.env.TRUST_PROXY === "true") app.set("trust proxy", 1);
app.use(express.json({ limit: "10mb" }));

/* Cabeceras de seguridad básicas. */
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "no-referrer-when-downgrade");
  next();
});

/* ---------------- JWT del admin ----------------
 * JWT_SECRET: variable de entorno, o secreto persistente en la tabla
 * settings (se genera una sola vez, como en la app Reaviva), así las
 * sesiones no se invalidan al reiniciar/redesplegar. */
function jwtSecret() {
  return process.env.JWT_SECRET || "dev-secret-change-me";
}
const ADMIN_COOKIE = "ejd_admin";
const ADMIN_TOKEN_TTL = "7d";

/* Contraseña del admin:
 *  - ADMIN_PASSWORD_HASH (bcrypt) tiene prioridad.
 *  - Si no, ADMIN_PASSWORD (texto plano en env; solo para pruebas locales
 *    o primer arranque — en producción usar el hash).
 * El hash efectivo se calcula una sola vez al arrancar. */
let adminPasswordHash = null;
function resolveAdminPassword() {
  if (process.env.ADMIN_PASSWORD_HASH) return process.env.ADMIN_PASSWORD_HASH;
  if (process.env.ADMIN_PASSWORD) {
    console.warn("[admin] ADMIN_PASSWORD en texto plano: en producción usa ADMIN_PASSWORD_HASH.");
    return bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10);
  }
  return null;
}

/* Límite de intentos de login: 10 por IP cada 15 min (en memoria). */
const loginAttempts = new Map(); // ip -> { count, resetAt }
function loginRateLimited(ip) {
  const now = Date.now();
  const rec = loginAttempts.get(ip);
  if (!rec || now > rec.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return false;
  }
  rec.count += 1;
  return rec.count > 10;
}

function signAdminToken() {
  return jwt.sign({ uid: "admin", admin: true }, jwtSecret(), { expiresIn: ADMIN_TOKEN_TTL });
}
function verifyAdminToken(token) {
  try {
    const p = jwt.verify(token, jwtSecret());
    return p && p.admin === true ? p : null;
  } catch (e) {
    return null;
  }
}
function readAdminToken(req) {
  const cookie = String(req.headers.cookie || "");
  const m = new RegExp("(?:^|;\\s*)" + ADMIN_COOKIE + "=([^;]+)").exec(cookie);
  if (m) return decodeURIComponent(m[1]);
  const auth = String(req.headers.authorization || "");
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  return null;
}

/* Autenticación combinada (panel web + API de Muse):
 * acepta JWT de admin (cookie o Bearer) O la X-Publish-Key.
 * Nunca se registra la clave en los logs. */
function requireAdminOrKey(req, res, next) {
  const token = readAdminToken(req);
  if (token && verifyAdminToken(token)) { req.authMethod = "jwt"; return next(); }
  const key = req.headers["x-publish-key"];
  const publishKey = process.env.PUBLISH_KEY;
  if (publishKey && key && String(key).length === publishKey.length && crypto.timingSafeEqual(
    Buffer.from(String(key)), Buffer.from(publishKey))) {
    req.authMethod = "publish-key";
    return next();
  }
  return res.status(401).json({ error: "No autorizado" });
}

/* ---------------- Plantillas HTML públicas ---------------- */

const SITE_NAME = "El Juego del Dinero";
const TAGLINE = "Dinero claro, sin vueltas: aprende a ganar, ahorrar e invertir.";

function pageShell({ title, description, body, ogImage }) {
  const desc = escapeHtml(description || TAGLINE);
  const t = escapeHtml(title || SITE_NAME);
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t}</title>
<meta name="description" content="${desc}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${desc}">
${ogImage ? `<meta property="og:image" content="${escapeHtml(ogImage)}">` : ""}
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<header class="site-header">
  <div class="wrap">
    <a class="brand" href="/"><span class="brand-mark">$</span><span class="brand-text">${SITE_NAME}<small>${escapeHtml(TAGLINE)}</small></span></a>
    <nav><a href="/">Inicio</a><a href="/rss.xml">RSS</a></nav>
  </div>
</header>
<main class="wrap">${body}</main>
<footer class="site-footer">
  <div class="wrap">
    <p><strong>${SITE_NAME}</strong> — Educación financiera en español.</p>
    <p>El contenido de este blog es educativo y no constituye asesoría financiera personalizada.</p>
    <p>© ${new Date().getFullYear()} ${SITE_NAME}</p>
  </div>
</footer>
</body>
</html>`;
}

function coverHtml(article, size) {
  if (article.cover) {
    return `<img class="card-cover" src="/cover/${article.slug}" alt="" loading="lazy">`;
  }
  return `<div class="card-cover card-cover--empty" aria-hidden="true"><span>$</span></div>`;
}

function articleCard(a) {
  const url = `/articulo/${a.slug}`;
  const date = formatDate(a.published_at || a.created_at);
  return `<article class="card">
  <a href="${url}">${coverHtml(a)}</a>
  <div class="card-body">
    <time datetime="${escapeHtml(a.published_at || a.created_at)}">${escapeHtml(date)}</time>
    <h2><a href="${url}">${escapeHtml(a.title)}</a></h2>
    ${a.excerpt ? `<p>${escapeHtml(a.excerpt)}</p>` : ""}
    <a class="read-more" href="${url}">Leer artículo →</a>
  </div>
</article>`;
}

/* ---------------- Rutas públicas ---------------- */

app.get("/api/health", (req, res) =>
  res.json({ ok: true, service: "el-juego-del-dinero-blog", time: new Date().toISOString() }));

app.get("/", db.ah(async (req, res) => {
  const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const total = await db.get(
    "SELECT COUNT(*) AS n FROM articles WHERE status = 'published'");
  const rows = await db.all(
    `SELECT id, slug, title, excerpt, created_at, published_at,
            CASE WHEN cover IS NOT NULL THEN 1 ELSE 0 END AS has_cover
     FROM articles WHERE status = 'published'
     ORDER BY COALESCE(published_at, created_at) DESC
     LIMIT ? OFFSET ?`, PAGE_SIZE, offset);
  const totalPages = Math.max(1, Math.ceil((total ? total.n : 0) / PAGE_SIZE));

  let body;
  if (!rows.length && page === 1) {
    body = `<section class="empty">
      <h1>Próximamente</h1>
      <p>Estamos preparando los primeros artículos de ${SITE_NAME}. Vuelve pronto: dinero claro, sin vueltas.</p>
    </section>`;
  } else {
    body = `<section class="cards">${rows.map(articleCard).join("\n")}</section>`;
    if (totalPages > 1) {
      body += `<nav class="pagination">` +
        (page > 1 ? `<a href="/?page=${page - 1}">← Anterior</a>` : "") +
        `<span>Página ${page} de ${totalPages}</span>` +
        (page < totalPages ? `<a href="/?page=${page + 1}">Siguiente →</a>` : "") +
        `</nav>`;
    }
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(pageShell({ title: SITE_NAME, body }));
}));

app.get("/articulo/:slug", db.ah(async (req, res) => {
  const slug = String(req.params.slug || "");
  if (!isValidSlug(slug)) return res.status(404).send(pageShell({ title: "No encontrado", body: "<p>Artículo no encontrado.</p>" }));
  const a = await db.get(
    "SELECT * FROM articles WHERE slug = ? AND status = 'published'", slug);
  if (!a) return res.status(404).send(pageShell({ title: "No encontrado", body: "<section class='empty'><h1>Artículo no encontrado</h1><p>Es posible que se haya movido o que aún no esté publicado.</p><p><a href='/'>← Volver al inicio</a></p></section>" }));

  // Anterior / siguiente (por fecha de publicación).
  const prev = await db.get(
    `SELECT slug, title FROM articles WHERE status = 'published'
     AND COALESCE(published_at, created_at) < COALESCE(?, created_at)
     ORDER BY COALESCE(published_at, created_at) DESC LIMIT 1`,
    a.published_at || a.created_at);
  const next = await db.get(
    `SELECT slug, title FROM articles WHERE status = 'published'
     AND COALESCE(published_at, created_at) > COALESCE(?, created_at)
     ORDER BY COALESCE(published_at, created_at) ASC LIMIT 1`,
    a.published_at || a.created_at);

  const date = formatDate(a.published_at || a.created_at);
  const body = `<article class="article">
    <time datetime="${escapeHtml(a.published_at || a.created_at)}">${escapeHtml(date)}</time>
    <h1>${escapeHtml(a.title)}</h1>
    ${a.excerpt ? `<p class="lede">${escapeHtml(a.excerpt)}</p>` : ""}
    ${a.cover ? `<img class="article-cover" src="/cover/${a.slug}" alt="">` : ""}
    <div class="article-body">${renderBody(a.body)}</div>
    <nav class="article-nav">
      ${prev ? `<a href="/articulo/${prev.slug}">← ${escapeHtml(prev.title)}</a>` : "<span></span>"}
      ${next ? `<a href="/articulo/${next.slug}">${escapeHtml(next.title)} →</a>` : ""}
    </nav>
    <p><a href="/">← Volver al inicio</a></p>
  </article>`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(pageShell({
    title: `${a.title} — ${SITE_NAME}`,
    description: a.excerpt || a.title,
    ogImage: a.cover ? `${SITE_URL}/cover/${a.slug}` : null,
    body,
  }));
}));

/* Portada servida desde la base de datos (BLOB). */
app.get("/cover/:slug", db.ah(async (req, res) => {
  const slug = String(req.params.slug || "");
  if (!isValidSlug(slug)) return res.status(404).end();
  const a = await db.get("SELECT cover, cover_mime FROM articles WHERE slug = ?", slug);
  if (!a || !a.cover) return res.status(404).end();
  const buf = Buffer.isBuffer(a.cover) ? a.cover : Buffer.from(a.cover);
  res.setHeader("Content-Type", a.cover_mime || "image/png");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.send(buf);
}));

app.get("/robots.txt", (req, res) => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.send(`User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`);
});

app.get("/sitemap.xml", db.ah(async (req, res) => {
  const rows = await db.all(
    `SELECT slug, updated_at FROM articles WHERE status = 'published'
     ORDER BY COALESCE(published_at, created_at) DESC`);
  const urls = [`<url><loc>${SITE_URL}/</loc></url>`].concat(rows.map((r) =>
    `<url><loc>${SITE_URL}/articulo/${r.slug}</loc><lastmod>${String(r.updated_at || "").slice(0, 10)}</lastmod></url>`));
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`);
}));

app.get("/rss.xml", db.ah(async (req, res) => {
  const rows = await db.all(
    `SELECT slug, title, excerpt, body, created_at, published_at
     FROM articles WHERE status = 'published'
     ORDER BY COALESCE(published_at, created_at) DESC LIMIT 20`);
  const items = rows.map((r) => {
    const d = new Date(String(r.published_at || r.created_at).replace(" ", "T") + "Z");
    return `<item>
<title>${escapeHtml(r.title)}</title>
<link>${SITE_URL}/articulo/${r.slug}</link>
<guid>${SITE_URL}/articulo/${r.slug}</guid>
<pubDate>${isNaN(d) ? "" : d.toUTCString()}</pubDate>
<description>${escapeHtml(r.excerpt || "")}</description>
</item>`;
  }).join("\n");
  res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
  res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n<channel>\n<title>${SITE_NAME}</title>\n<link>${SITE_URL}/</link>\n<description>${escapeHtml(TAGLINE)}</description>\n<language>es</language>\n${items}\n</channel>\n</rss>`);
}));

/* ---------------- Admin: login ---------------- */

app.post("/api/admin/login", db.ah(async (req, res) => {
  const ip = req.ip || "unknown";
  if (loginRateLimited(ip)) {
    return res.status(429).json({ error: "Demasiados intentos. Espera 15 minutos." });
  }
  if (!adminPasswordHash) {
    return res.status(503).json({ error: "Acceso de administrador no configurado" });
  }
  const user = String(req.body?.user || "").trim();
  const password = String(req.body?.password || "");
  const expectedUser = process.env.ADMIN_USER || "admin";
  const okUser = user.length === expectedUser.length && crypto.timingSafeEqual(
    Buffer.from(user), Buffer.from(expectedUser));
  const okPass = password && bcrypt.compareSync(password, adminPasswordHash);
  if (!okUser || !okPass) {
    return res.status(401).json({ error: "Usuario o contraseña incorrectos" });
  }
  const token = signAdminToken();
  res.cookie(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
  res.json({ ok: true, user: expectedUser });
}));

app.post("/api/admin/logout", (req, res) => {
  res.clearCookie(ADMIN_COOKIE, { path: "/" });
  res.json({ ok: true });
});

app.get("/api/admin/me", requireAdminOrKey, (req, res) => {
  res.json({ ok: true, user: process.env.ADMIN_USER || "admin", via: req.authMethod });
});

/* ---------------- Admin: artículos ----------------
 * Las mismas rutas sirven al panel web (JWT) y a Muse (X-Publish-Key).
 * GET lista todos (borrador + publicado); POST crea; PATCH edita;
 * DELETE elimina. La clave nunca se registra en los logs. */

function articlePublic(row) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    body: row.body,
    has_cover: row.cover ? 1 : 0,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    published_at: row.published_at,
    url: `/articulo/${row.slug}`,
  };
}

/* Slug único: si ya existe, agrega -2, -3, ... (excluye el propio id). */
async function uniqueSlug(base, excludeId) {
  let slug = base;
  let n = 2;
  for (;;) {
    const row = await db.get("SELECT id FROM articles WHERE slug = ?", slug);
    if (!row || (excludeId && row.id === excludeId)) return slug;
    slug = `${base}-${n++}`;
  }
}

app.get("/api/admin/articles", requireAdminOrKey, db.ah(async (req, res) => {
  const rows = await db.all(
    `SELECT id, slug, title, excerpt, body,
            CASE WHEN cover IS NOT NULL THEN 1 ELSE 0 END AS cover,
            status, created_at, updated_at, published_at
     FROM articles ORDER BY updated_at DESC, id DESC`);
  res.json({ articles: rows.map(articlePublic) });
}));

app.post("/api/admin/articles", requireAdminOrKey, db.ah(async (req, res) => {
  let data;
  try {
    data = validateArticleInput(req.body || {}, false);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  let cover = null;
  try {
    cover = validateCover(req.body?.coverBase64, req.body?.coverMime);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  const slug = await uniqueSlug(data.slug || slugify(data.title), null);
  const status = data.status || "draft";
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  const publishedAt = status === "published" ? now : null;
  const info = await db.run(
    `INSERT INTO articles (slug, title, excerpt, body, cover, cover_mime, status, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    slug, data.title, data.excerpt || "", data.body || "",
    cover ? cover.buffer : null, cover ? cover.mime : null,
    status, publishedAt);
  const row = await db.get("SELECT * FROM articles WHERE id = ?", info.lastInsertRowid);
  res.status(201).json({ ok: true, article: articlePublic(row) });
}));

app.patch("/api/admin/articles/:id", requireAdminOrKey, db.ah(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "ID inválido" });
  const row = await db.get("SELECT * FROM articles WHERE id = ?", id);
  if (!row) return res.status(404).json({ error: "Artículo no encontrado" });

  let data;
  try {
    data = validateArticleInput(req.body || {}, true);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  let cover = null;
  let coverTouched = false;
  if (req.body && Object.prototype.hasOwnProperty.call(req.body, "coverBase64")) {
    coverTouched = true;
    try {
      cover = validateCover(req.body.coverBase64, req.body.coverMime);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
  }

  const sets = [];
  const args = [];
  if (data.title !== undefined) { sets.push("title = ?"); args.push(data.title); }
  if (data.excerpt !== undefined) { sets.push("excerpt = ?"); args.push(data.excerpt); }
  if (data.body !== undefined) { sets.push("body = ?"); args.push(data.body); }
  if (data.slug !== undefined) {
    const slug = await uniqueSlug(data.slug, id);
    sets.push("slug = ?"); args.push(slug);
  }
  if (data.status !== undefined) {
    sets.push("status = ?"); args.push(data.status);
    if (data.status === "published" && !row.published_at) {
      sets.push("published_at = datetime('now')");
    }
    if (data.status === "draft") {
      sets.push("published_at = NULL");
    }
  }
  if (coverTouched || data.coverRemove) {
    sets.push("cover = ?", "cover_mime = ?");
    args.push(cover ? cover.buffer : null, cover ? cover.mime : null);
  }
  sets.push("updated_at = datetime('now')");
  if (sets.length === 1) return res.json({ ok: true, article: articlePublic(row) });
  await db.run(`UPDATE articles SET ${sets.join(", ")} WHERE id = ?`, ...args, id);
  const updated = await db.get("SELECT * FROM articles WHERE id = ?", id);
  res.json({ ok: true, article: articlePublic(updated) });
}));

app.delete("/api/admin/articles/:id", requireAdminOrKey, db.ah(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "ID inválido" });
  const info = await db.run("DELETE FROM articles WHERE id = ?", id);
  if (!info.changes) return res.status(404).json({ error: "Artículo no encontrado" });
  res.json({ ok: true });
}));

/* ---------------- Frontend estático + admin ---------------- */

const PUBLIC_DIR = path.join(__dirname, "public");
app.use(express.static(PUBLIC_DIR, {
  index: false,
  maxAge: "7d",
  setHeaders(res, filePath) {
    if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
  },
}));

app.get("/admin", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "admin.html"));
});

/* Manejo de errores: JSON en la API, texto en el resto. */
app.use((err, req, res, next) => {
  console.error("[error]", err && err.message ? err.message : err);
  if (req.path.startsWith("/api/")) {
    return res.status(500).json({ error: "Error interno del servidor" });
  }
  res.status(500).send("Error interno del servidor");
});

/* ---------------- Arranque ---------------- */

db.ready.then(async () => {
  try {
    if (!process.env.JWT_SECRET) {
      const row = await db.get("SELECT value FROM settings WHERE key = 'jwt_secret'");
      if (row && row.value) {
        process.env.JWT_SECRET = row.value;
        console.log("[seguridad] JWT_SECRET cargado desde la base de datos (persistente).");
      } else {
        const secret = crypto.randomBytes(48).toString("hex");
        await db.run("INSERT INTO settings (key, value) VALUES ('jwt_secret', ?)", secret);
        process.env.JWT_SECRET = secret;
        console.log("[seguridad] JWT_SECRET generado y guardado en la base de datos (persistente).");
      }
    }
  } catch (e) {
    console.error("[seguridad] no se pudo resolver el JWT_SECRET persistente:", e.message);
  }
  adminPasswordHash = resolveAdminPassword();
  if (!adminPasswordHash) {
    console.warn("[admin] Sin ADMIN_PASSWORD ni ADMIN_PASSWORD_HASH: el login del panel devolverá 503 hasta configurarlo.");
  }
  if (!process.env.PUBLISH_KEY) {
    console.warn("[api] Sin PUBLISH_KEY: la publicación por API devolverá 401 hasta configurarla.");
  }
  app.listen(PORT, () => {
    console.log(`[blog] El Juego del Dinero corriendo en http://localhost:${PORT}`);
  });
});
