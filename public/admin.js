/* El Juego del Dinero — lógica del panel admin.
 * Login por cookie httpOnly (JWT). Todas las llamadas usan credentials:'include'.
 * La portada se envía como base64 dentro del JSON (máx. 1.5 MB, JPG/PNG).
 * La vista previa replica en el navegador el render mínimo del servidor.
 */
"use strict";

const $ = (s) => document.querySelector(s);

const loginView = $("#loginView");
const dashView = $("#dashView");
const editorView = $("#editorView");
const logoutBtn = $("#logoutBtn");

let articles = [];
let coverData = null;   // { base64, mime } de la portada elegida (o null)
let coverRemove = false;
let submitStatus = "draft";

async function api(path, opts) {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...(opts || {}),
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* sin JSON */ }
  if (!res.ok) throw new Error((data && data.error) || ("Error " + res.status));
  return data;
}

function show(view) {
  loginView.hidden = view !== "login";
  dashView.hidden = view !== "dash";
  editorView.hidden = view !== "editor";
  logoutBtn.hidden = view !== "dash" && view !== "editor";
}

/* ---------- Login ---------- */

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#loginError");
  err.hidden = true;
  try {
    await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({
        user: $("#loginUser").value.trim(),
        password: $("#loginPass").value,
      }),
    });
    $("#loginPass").value = "";
    await loadList();
    show("dash");
  } catch (e2) {
    err.textContent = e2.message;
    err.hidden = false;
  }
});

logoutBtn.addEventListener("click", async () => {
  try { await api("/api/admin/logout", { method: "POST", body: "{}" }); } catch (e) { /* igual salimos */ }
  show("login");
});

/* ---------- Lista de artículos ---------- */

async function loadList() {
  const err = $("#dashError");
  err.hidden = true;
  try {
    const data = await api("/api/admin/articles");
    articles = data.articles || [];
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
    return;
  }
  const ul = $("#articleList");
  ul.innerHTML = "";
  if (!articles.length) {
    ul.innerHTML = "<li><p class='muted'>Aún no hay artículos. Crea el primero con el botón de arriba.</p></li>";
    return;
  }
  for (const a of articles) {
    const li = document.createElement("li");
    const badge = a.status === "published"
      ? "<span class='badge badge--pub'>Publicado</span>"
      : "<span class='badge badge--draft'>Borrador</span>";
    li.innerHTML =
      `<div class="item-title"></div>
       <div class="item-meta">${badge} · ${esc(a.updated_at || "")}${a.has_cover ? " · con portada" : ""}</div>
       <div class="row">
         <button class="btn" data-act="edit">Editar</button>
         ${a.status === "published"
           ? `<button class="btn" data-act="unpublish">Quitar de publicado</button>`
           : `<button class="btn btn--primary" data-act="publish">Publicar</button>`}
         <button class="btn btn--danger" data-act="delete">Eliminar</button>
         ${a.status === "published" ? `<a class="btn" href="${esc(a.url)}" target="_blank" rel="noopener">Ver</a>` : ""}
       </div>`;
    li.querySelector(".item-title").textContent = a.title;
    li.querySelector("[data-act=edit]").addEventListener("click", () => openEditor(a));
    const pubBtn = li.querySelector("[data-act=publish]");
    if (pubBtn) pubBtn.addEventListener("click", () => setStatus(a, "published"));
    const unpubBtn = li.querySelector("[data-act=unpublish]");
    if (unpubBtn) unpubBtn.addEventListener("click", () => setStatus(a, "draft"));
    li.querySelector("[data-act=delete]").addEventListener("click", async () => {
      if (!confirm("¿Eliminar este artículo? Esta acción no se puede deshacer.")) return;
      try {
        await api("/api/admin/articles/" + a.id, { method: "DELETE" });
        await loadList();
      } catch (e2) { alert(e2.message); }
    });
    ul.appendChild(li);
  }
}

async function setStatus(a, status) {
  try {
    await api("/api/admin/articles/" + a.id, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    await loadList();
  } catch (e) { alert(e.message); }
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* ---------- Editor ---------- */

function slugify(text) {
  return String(text || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
}

$("#newBtn").addEventListener("click", () => openEditor(null));

function openEditor(a) {
  $("#editorTitle").textContent = a ? "Editar artículo" : "Nuevo artículo";
  $("#editId").value = a ? a.id : "";
  $("#editTitle").value = a ? a.title : "";
  $("#editSlug").value = a ? a.slug : "";
  $("#editExcerpt").value = a ? a.excerpt : "";
  $("#editBody").value = a ? a.body : "";
  $("#editCover").value = "";
  $("#editorError").hidden = true;
  $("#previewBox").hidden = true;
  coverData = null;
  coverRemove = false;
  updateCoverPreview(a && a.has_cover ? ("/cover/" + a.slug) : null);
  show("editor");
  $("#editTitle").focus();
}

$("#editTitle").addEventListener("input", (e) => {
  // El slug se genera solo mientras el usuario no lo haya editado a mano.
  if (!$("#editSlug").dataset.touched) $("#editSlug").value = slugify(e.target.value);
});
$("#editSlug").addEventListener("input", (e) => { e.target.dataset.touched = "1"; });

$("#editCover").addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) { coverData = null; updateCoverPreview(null); return; }
  if (file.size > 1500 * 1024) {
    alert("La portada no puede pesar más de 1.5 MB.");
    e.target.value = "";
    return;
  }
  if (file.type !== "image/jpeg" && file.type !== "image/png") {
    alert("La portada debe ser JPG o PNG.");
    e.target.value = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = String(reader.result);
    coverData = { base64: dataUrl.split(",")[1], mime: file.type };
    coverRemove = false;
    updateCoverPreview(dataUrl);
  };
  reader.readAsDataURL(file);
});

$("#coverRemoveBtn").addEventListener("click", () => {
  coverData = null;
  coverRemove = true;
  $("#editCover").value = "";
  updateCoverPreview(null);
});

function updateCoverPreview(src) {
  const box = $("#coverPreview");
  if (!src) { box.hidden = true; return; }
  $("#coverPreviewImg").src = src;
  box.hidden = false;
}

$("#cancelBtn").addEventListener("click", async () => {
  await loadList();
  show("dash");
});

/* Vista previa: replica el render mínimo del servidor. */
function renderPreview(text) {
  const esc2 = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s) => s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\*([^*]+)\*/g, "<em>$1</em>");
  const lines = String(text || "").split("\n");
  const out = [];
  let para = [], list = [];
  const fp = () => { if (para.length) { out.push("<p>" + inline(para.join(" ")) + "</p>"); para = []; } };
  const fl = () => { if (list.length) { out.push("<ul>" + list.map((i) => "<li>" + inline(i) + "</li>").join("") + "</ul>"); list = []; } };
  for (const raw of lines) {
    const line = esc2(raw).trim();
    if (!line) { fp(); fl(); continue; }
    if (line.startsWith("## ")) { fp(); fl(); out.push("<h2>" + inline(line.slice(3).trim()) + "</h2>"); continue; }
    if (line.startsWith("- ")) { fp(); list.push(line.slice(2).trim()); continue; }
    fl(); para.push(line);
  }
  fp(); fl();
  return out.join("\n");
}

$("#previewBtn").addEventListener("click", () => {
  $("#previewContent").innerHTML =
    "<h1 style='font-size:24px'>" + esc($("#editTitle").value || "(sin título)") + "</h1>" +
    renderPreview($("#editBody").value);
  $("#previewBox").hidden = false;
  $("#previewBox").scrollIntoView({ behavior: "smooth" });
});

$("#editorForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.submitter;
  submitStatus = (btn && btn.dataset.status) || "draft";
  const err = $("#editorError");
  err.hidden = true;
  const id = $("#editId").value;
  const payload = {
    title: $("#editTitle").value.trim(),
    slug: $("#editSlug").value.trim(),
    excerpt: $("#editExcerpt").value.trim(),
    body: $("#editBody").value,
    status: submitStatus,
  };
  if (coverData) { payload.coverBase64 = coverData.base64; payload.coverMime = coverData.mime; }
  if (coverRemove) payload.coverRemove = true;
  try {
    if (id) {
      await api("/api/admin/articles/" + id, { method: "PATCH", body: JSON.stringify(payload) });
    } else {
      await api("/api/admin/articles", { method: "POST", body: JSON.stringify(payload) });
    }
    await loadList();
    show("dash");
  } catch (e2) {
    err.textContent = e2.message;
    err.hidden = false;
  }
});

/* ---------- Arranque: si ya hay sesión, ir al dashboard ---------- */

(async () => {
  try {
    await api("/api/admin/me");
    await loadList();
    show("dash");
  } catch (e) {
    show("login");
  }
})();
