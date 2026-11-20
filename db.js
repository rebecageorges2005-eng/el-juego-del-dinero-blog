/* El Juego del Dinero — capa de base de datos (dual backend, interfaz async).
 *
 * Copia el patrón probado de la app Reaviva (~/workspace/reaviva-app/api/db.js):
 *   - db.get(sql, ...args)  → Promise<row|undefined>
 *   - db.all(sql, ...args)  → Promise<row[]>
 *   - db.run(sql, ...args)  → Promise<{lastInsertRowid, changes}>
 *   - db.exec(sql)          → Promise<void> (varios statements)
 *   - db.ready              → Promise que se resuelve cuando las migraciones terminan
 *   - ah(fn)                → wrapper para handlers async en Express 4
 *
 * Backend:
 *   - Si existen TURSO_DATABASE_URL y TURSO_AUTH_TOKEN → Turso (nube).
 *   - Si no → node:sqlite con archivo local (desarrollo).
 * La interfaz es idéntica en ambos casos; las consultas SQL no cambian.
 *
 * Nota: libsql devuelve lastInsertRowid como BigInt; el wrapper lo convierte
 * a Number. Los BLOB (portadas) se pasan como Buffer: @libsql/client los
 * acepta como Uint8Array y node:sqlite como Buffer.
 */
"use strict";

const path = require("path");

const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;
const isTurso = !!(TURSO_URL && TURSO_TOKEN);

let client = null;   // @libsql/client (modo Turso)
let localDb = null;  // node:sqlite DatabaseSync (modo local)

if (isTurso) {
  const { createClient } = require("@libsql/client");
  client = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });
  console.log("[db] backend: Turso (nube)");
} else {
  const { DatabaseSync } = require("node:sqlite");
  const DB_PATH = process.env.DB_PATH || path.join(__dirname, "blog.db");
  localDb = new DatabaseSync(DB_PATH);
  console.log("[db] backend: SQLite local (" + DB_PATH + ")");
}

/* Divide un script SQL en statements individuales, respetando
 * strings entre comillas simples/dobles (que pueden contener ';'). */
function splitStatements(sql) {
  const out = [];
  let cur = "", q = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (q) {
      cur += ch;
      if (ch === q) {
        if (q === "'" && sql[i + 1] === "'") { cur += sql[++i]; }
        else q = null;
      }
    } else if (ch === "'" || ch === '"') {
      q = ch; cur += ch;
    } else if (ch === ";") {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const toNum = (v) => (typeof v === "bigint" ? Number(v) : v);

async function tGet(sql, args) {
  const r = await client.execute({ sql, args: args || [] });
  return r.rows[0];
}
async function tAll(sql, args) {
  const r = await client.execute({ sql, args: args || [] });
  return r.rows;
}
async function tRun(sql, args) {
  const r = await client.execute({ sql, args: args || [] });
  return { lastInsertRowid: toNum(r.lastInsertRowid), changes: toNum(r.rowsAffected) };
}
async function tExec(sql) {
  const stmts = splitStatements(sql);
  if (stmts.length === 0) return;
  if (stmts.length === 1) {
    await client.execute(stmts[0]);
  } else {
    await client.batch(stmts.map((s) => ({ sql: s, args: [] })));
  }
}

const db = {
  isTurso,
  async get(sql, ...args) {
    if (isTurso) return tGet(sql, args);
    return localDb.prepare(sql).get(...args);
  },
  async all(sql, ...args) {
    if (isTurso) return tAll(sql, args);
    return localDb.prepare(sql).all(...args);
  },
  async run(sql, ...args) {
    if (isTurso) return tRun(sql, args);
    const r = localDb.prepare(sql).run(...args);
    return { lastInsertRowid: toNum(r.lastInsertRowid), changes: toNum(r.changes) };
  },
  async exec(sql) {
    if (isTurso) return tExec(sql);
    localDb.exec(sql);
  },
};

/* Wrapper para handlers async en Express 4: un rechazo se convierte en
 * next(err) en vez de dejar la petición colgada. */
function ah(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/* ---------------- MIGRACIONES ---------------- */

async function tableCols(table) {
  const rows = await db.all(`PRAGMA table_info(${table})`);
  return rows.map((c) => c.name);
}

async function migrate() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS articles (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      slug         TEXT UNIQUE NOT NULL,
      title        TEXT NOT NULL,
      excerpt      TEXT NOT NULL DEFAULT '',
      body         TEXT NOT NULL DEFAULT '',
      cover        BLOB,
      cover_mime   TEXT,
      status       TEXT NOT NULL DEFAULT 'draft',
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
      published_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status, published_at);
    CREATE INDEX IF NOT EXISTS idx_articles_slug ON articles(slug);

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  console.log("[db] migración: tabla articles lista");
}

const ready = migrate().then(
  () => console.log("[db] migraciones completadas (" + (isTurso ? "Turso" : "local") + ")"),
  (e) => console.error("[db] ERROR en migraciones:", e.message)
);

module.exports = { ...db, ready, ah, isTurso, tableCols };
