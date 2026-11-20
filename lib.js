/* El Juego del Dinero — utilidades compartidas (slug, markdown ligero,
 * portadas, validación). Sin dependencias externas.
 */
"use strict";

/* Escapa HTML para que el texto del artículo nunca se interprete como
 * código (el cuerpo se guarda como texto plano y se renderiza seguro). */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* Slug a partir del título: minúsculas, sin acentos, guiones.
 * Ej: "¿Comprar auto nuevo es un error?" → "comprar-auto-nuevo-es-un-error" */
function slugify(text) {
  return String(text || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // quita acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "articulo";
}

function isValidSlug(s) {
  return typeof s === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s) && s.length <= 100;
}

/* Formato en línea: **negrita** y *cursiva* (el texto ya viene escapado). */
function inlineFmt(s) {
  return s
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

/* Renderiza el cuerpo del artículo (markdown mínimo):
 *   - líneas en blanco separan párrafos
 *   - "## " al inicio de línea → subtítulo <h2>
 *   - líneas que empiezan con "- " seguidas → lista <ul>
 *   - **negrita** y *cursiva* dentro del texto
 * El panel admin usa la misma lógica en el navegador para la vista previa. */
function renderBody(body) {
  const lines = String(body || "").replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let para = [];
  let list = [];

  const flushPara = () => {
    if (para.length) { out.push("<p>" + inlineFmt(para.join(" ")) + "</p>"); para = []; }
  };
  const flushList = () => {
    if (list.length) {
      out.push("<ul>" + list.map((i) => "<li>" + inlineFmt(i) + "</li>").join("") + "</ul>");
      list = [];
    }
  };

  for (const raw of lines) {
    const line = escapeHtml(raw).trim();
    if (line === "") { flushPara(); flushList(); continue; }
    if (line.startsWith("## ")) { flushPara(); flushList(); out.push("<h2>" + inlineFmt(line.slice(3).trim()) + "</h2>"); continue; }
    if (line.startsWith("- ")) { flushPara(); list.push(line.slice(2).trim()); continue; }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return out.join("\n");
}

/* -------- Portadas (JPG/PNG, máx 1.5 MB, magic bytes reales) -------- */

const MAX_COVER_BYTES = 1500 * 1024; // 1.5 MB
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

function detectImageMime(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 3) return null;
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_MAGIC)) return "image/png";
  if (buf.subarray(0, 3).equals(JPEG_MAGIC)) return "image/jpeg";
  return null; // no es JPG ni PNG real (aunque la extensión diga otra cosa)
}

/* Valida una portada enviada como base64 (+ mime declarado).
 * Devuelve { buffer, mime } o lanza Error con el mensaje para el usuario. */
function validateCover(coverBase64, coverMime) {
  if (coverBase64 == null || coverBase64 === "") return null;
  if (typeof coverBase64 !== "string") throw new Error("Portada inválida.");
  const buf = Buffer.from(coverBase64, "base64");
  if (buf.length === 0) throw new Error("Portada inválida.");
  if (buf.length > MAX_COVER_BYTES) throw new Error("La portada no puede pesar más de 1.5 MB.");
  const realMime = detectImageMime(buf);
  if (!realMime) throw new Error("La portada debe ser una imagen JPG o PNG real.");
  if (coverMime && coverMime !== realMime) throw new Error("El tipo de imagen declarado no coincide con el archivo.");
  return { buffer: buf, mime: realMime };
}

/* -------- Validación de artículos -------- */

function validateArticleInput(input, isPatch) {
  const out = {};
  const has = (k) => input && Object.prototype.hasOwnProperty.call(input, k);

  if (has("title")) {
    const t = String(input.title || "").trim();
    if (!isPatch && !t) throw new Error("El título es obligatorio.");
    if (t && (t.length < 3 || t.length > 200)) throw new Error("El título debe tener entre 3 y 200 caracteres.");
    if (t) out.title = t;
  } else if (!isPatch) {
    throw new Error("El título es obligatorio.");
  }

  if (has("slug")) {
    const s = String(input.slug || "").trim().toLowerCase();
    if (s && !isValidSlug(s)) throw new Error("El slug solo puede tener letras minúsculas, números y guiones.");
    if (s) out.slug = s;
  }

  if (has("excerpt")) {
    const e = String(input.excerpt || "").trim();
    if (e.length > 300) throw new Error("El resumen no puede pasar de 300 caracteres.");
    out.excerpt = e;
  }

  if (has("body")) {
    const b = String(input.body || "");
    if (b.length > 200000) throw new Error("El cuerpo es demasiado largo.");
    out.body = b;
  } else if (!isPatch) {
    out.body = "";
  }

  if (has("status")) {
    const st = String(input.status || "");
    if (st !== "draft" && st !== "published") throw new Error("Estado inválido (usa draft o published).");
    out.status = st;
  }

  if (has("coverRemove")) out.coverRemove = input.coverRemove === true;

  return out;
}

/* Fecha legible en español (America/La_Paz), ej. "19 de noviembre de 2026". */
function formatDate(isoText) {
  if (!isoText) return "";
  const d = new Date(String(isoText).replace(" ", "T") + "Z");
  if (isNaN(d)) return String(isoText).slice(0, 10);
  return d.toLocaleDateString("es-ES", {
    timeZone: "America/La_Paz",
    day: "numeric", month: "long", year: "numeric",
  });
}

module.exports = {
  escapeHtml, slugify, isValidSlug, renderBody,
  validateCover, validateArticleInput, detectImageMime,
  MAX_COVER_BYTES, formatDate,
};
