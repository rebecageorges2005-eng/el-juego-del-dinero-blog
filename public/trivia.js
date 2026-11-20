/* Trivia del Dinero — lógica del juego (sin cuentas, sin RV).
 *
 * Reglas: 10 preguntas por partida, 10 puntos por acierto, 3 corazones
 * (cada error quita medio corazón; 6 errores = partida terminada).
 * Sin repetir preguntas hasta agotar el banco de 100: los ids vistos se
 * guardan en localStorage y se mandan como `exclude` a /api/trivia/play;
 * cuando el banco se agota, el servidor devuelve una ronda nueva.
 *
 * REGLA DE GEORGES: si pierdes todos los corazones, hay que esperar
 * 24 HORAS para volver a jugar (bloqueo en localStorage). Si terminas
 * las 10 preguntas con corazones, puedes jugar de nuevo de inmediato.
 *
 * Sonidos con Web Audio, sin archivos (como la Trivia de Sanación de la
 * app Reaviva): acierto = arpegio ascendente 659.25/783.99/1046.5 Hz;
 * error = UNA nota grave (Do3 130.81 Hz + armónicos). Todo con try/catch.
 *
 * Flechas (como Reaviva): pantalla inicial → "→" a la derecha;
 * jugando / resultado → "←" a la izquierda.
 */
"use strict";

/* ---------- Persistencia local ---------- */
const SEEN_KEY = "ejd_trivia_seen";
const BEST_KEY = "ejd_trivia_best";
const BEST_STREAK_KEY = "ejd_trivia_best_streak";
const LOCKOUT_KEY = "ejd_trivia_lockout_until";
const LOCKOUT_MS = 24 * 60 * 60 * 1000; // 24 horas

function store() {
  try { return window.localStorage; } catch (e) { return null; }
}
function storeGet(key) {
  const s = store();
  if (!s) return null;
  try { return s.getItem(key); } catch (e) { return null; }
}
function storeSet(key, value) {
  const s = store();
  if (!s) return;
  try { s.setItem(key, value); } catch (e) { /* almacenamiento lleno o bloqueado */ }
}

/* ---------- Bloqueo de 24 horas ---------- */
function lockoutUntil() {
  const v = parseInt(storeGet(LOCKOUT_KEY) || "", 10);
  return Number.isFinite(v) ? v : 0;
}
function lockoutRemainingMs(now) {
  return Math.max(0, lockoutUntil() - (now || Date.now()));
}
function isLockedOut(now) {
  return lockoutRemainingMs(now) > 0;
}
function setLockout(now) {
  storeSet(LOCKOUT_KEY, String((now || Date.now()) + LOCKOUT_MS));
}
function formatLockout(ms) {
  const totalMin = Math.ceil(ms / 60000);
  if (totalMin <= 0) return "menos de 1 minuto";
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return m + (m === 1 ? " minuto" : " minutos");
  return h + " h" + (m > 0 ? " " + m + " min" : "");
}

/* ---------- Preguntas vistas / récords ---------- */
function getSeen() {
  try {
    const arr = JSON.parse(storeGet(SEEN_KEY) || "[]");
    return Array.isArray(arr) ? arr.filter((n) => Number.isInteger(n)) : [];
  } catch (e) { return []; }
}
function saveSeen(ids) {
  storeSet(SEEN_KEY, JSON.stringify(ids));
}
function markSeen(ids) {
  const seen = new Set(getSeen());
  ids.forEach((id) => seen.add(id));
  saveSeen(Array.from(seen));
}
function getBest() {
  return parseInt(storeGet(BEST_KEY) || "0", 10) || 0;
}
function getBestStreak() {
  return parseInt(storeGet(BEST_STREAK_KEY) || "0", 10) || 0;
}

/* ---------- Sonidos (Web Audio, sin archivos) ---------- */
let audioCtx = null;
function getAudioCtx() {
  try {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    }
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    return audioCtx;
  } catch (e) { return null; }
}
function playTone(freq, startAt, duration, gainValue) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const t = ctx.currentTime + startAt;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(gainValue, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  } catch (e) { /* sin sonido, el juego sigue */ }
}
function playCorrect() {
  if (!state.soundOn) return;
  [659.25, 783.99, 1046.5].forEach((f, i) => playTone(f, i * 0.09, 0.35, 0.25));
}
function playWrong() {
  if (!state.soundOn) return;
  const ctx = getAudioCtx();
  if (!ctx) return;
  try {
    const base = 130.81; // Do3
    const peaks = [0.7, 0.35, 0.18, 0.09];
    const t = ctx.currentTime;
    peaks.forEach((peak, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = base * (i + 1);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(peak * 0.4, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 1);
    });
  } catch (e) { /* sin sonido, el juego sigue */ }
}

/* ---------- Estado del juego ---------- */
const state = {
  questions: [],
  index: 0,
  score: 0,
  correctCount: 0,
  halfHearts: 6, // 3 corazones = 6 medios corazones
  streak: 0,
  bestStreak: 0,
  answered: false,
  over: false,
  soundOn: true,
};

function $(id) {
  return document.getElementById(id);
}
function showPanel(name) {
  ["start", "play", "end"].forEach((n) => {
    const el = $("trivia-" + n);
    if (el) el.hidden = n !== name;
  });
  if (name === "start") refreshStartScreen();
}
function showError(msg) {
  const el = $("trivia-error");
  if (!el) return;
  el.textContent = msg;
  el.hidden = !msg;
}

/* ---------- Pantalla inicial + bloqueo ---------- */
let lockoutTimer = null;
function refreshStartScreen() {
  const remaining = lockoutRemainingMs();
  const btn = $("trivia-start-btn");
  const lockEl = $("trivia-lockout");
  const bestScoreEl = $("trivia-best-score");
  const bestStreakEl = $("trivia-best-streak");
  if (bestScoreEl) bestScoreEl.textContent = String(getBest());
  if (bestStreakEl) bestStreakEl.textContent = String(getBestStreak());
  if (remaining > 0) {
    if (btn) btn.disabled = true;
    if (lockEl) {
      lockEl.hidden = false;
      lockEl.textContent = "⏳ Te quedaste sin corazones. Vuelve en " + formatLockout(remaining) + " para jugar de nuevo.";
    }
    if (!lockoutTimer) lockoutTimer = setInterval(refreshStartScreen, 30000);
  } else {
    if (btn) btn.disabled = false;
    if (lockEl) lockEl.hidden = true;
    if (lockoutTimer) { clearInterval(lockoutTimer); lockoutTimer = null; }
  }
}

/* ---------- Partida ---------- */
async function startGame() {
  if (isLockedOut()) { refreshStartScreen(); return; }
  showError("");
  const btn = $("trivia-start-btn");
  if (btn) btn.disabled = true;
  try {
    const seen = getSeen();
    const res = await fetch("/api/trivia/play?exclude=" + encodeURIComponent(seen.join(",")));
    if (!res.ok) throw new Error("No se pudo cargar el juego");
    const data = await res.json();
    if (!data.questions || !data.questions.length) throw new Error("No se pudo cargar el juego");
    if (data.freshRound) saveSeen([]); // banco agotado: ronda nueva
    state.questions = data.questions;
    markSeen(data.questions.map((q) => q.id));
    state.index = 0;
    state.score = 0;
    state.correctCount = 0;
    state.halfHearts = 6;
    state.streak = 0;
    state.bestStreak = 0;
    state.answered = false;
    state.over = false;
    showPanel("play");
    renderQuestion();
  } catch (e) {
    showError("No se pudo cargar la trivia. Revisa tu conexión e inténtalo de nuevo.");
    if (btn) btn.disabled = false;
  }
}

function renderHearts() {
  const el = $("trivia-hearts");
  if (!el) return;
  let html = "";
  for (let i = 0; i < 3; i++) {
    const halves = state.halfHearts - i * 2;
    const cls = halves >= 2 ? "full" : halves === 1 ? "half" : "empty";
    html += '<span class="heart ' + cls + '" aria-hidden="true">♥</span>';
  }
  el.innerHTML = html;
}

function renderQuestion() {
  const q = state.questions[state.index];
  state.answered = false;
  $("trivia-progress").textContent = "Pregunta " + (state.index + 1) + "/" + state.questions.length;
  $("trivia-score").textContent = state.score + " pts";
  $("trivia-category").textContent = q.category;
  $("trivia-question").textContent = q.question;
  $("trivia-bar-fill").style.width = (state.index / state.questions.length * 100) + "%";
  renderHearts();
  const box = $("trivia-options");
  box.innerHTML = "";
  q.options.forEach((opt, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "trivia-option";
    b.textContent = String.fromCharCode(65 + i) + ". " + opt;
    b.addEventListener("click", () => answer(i));
    box.appendChild(b);
  });
  const fb = $("trivia-feedback");
  fb.hidden = true;
  fb.textContent = "";
  fb.className = "trivia-feedback";
  $("trivia-next-btn").hidden = true;
}

async function answer(choice) {
  if (state.answered || state.over) return;
  state.answered = true;
  const q = state.questions[state.index];
  const buttons = Array.from(document.querySelectorAll("#trivia-options .trivia-option"));
  buttons.forEach((b) => { b.disabled = true; });
  try {
    const res = await fetch("/api/trivia/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: q.id, choice }),
    });
    if (!res.ok) throw new Error("No se pudo validar la respuesta");
    const data = await res.json();
    buttons.forEach((b, i) => {
      if (i === data.correctIndex) b.classList.add("correct");
      else if (i === choice) b.classList.add("wrong");
      else b.classList.add("dim");
    });
    const fb = $("trivia-feedback");
    if (data.correct) {
      playCorrect();
      state.score += data.points || 10;
      state.correctCount++;
      state.streak++;
      if (state.streak > state.bestStreak) state.bestStreak = state.streak;
      fb.textContent = "✅ ¡Correcto! +10 puntos. " + (data.explanation || "");
      fb.classList.add("ok");
    } else {
      playWrong();
      state.halfHearts = Math.max(0, state.halfHearts - 1);
      state.streak = 0;
      fb.textContent = "❌ Incorrecto. " + (data.explanation || "");
      fb.classList.add("bad");
    }
    fb.hidden = false;
    $("trivia-score").textContent = state.score + " pts";
    renderHearts();
    const nextBtn = $("trivia-next-btn");
    nextBtn.hidden = false;
    nextBtn.textContent = state.index + 1 >= state.questions.length ? "Ver resultado →" : "Siguiente →";
  } catch (e) {
    state.answered = false;
    buttons.forEach((b) => { b.disabled = false; });
    showError("No se pudo validar la respuesta. Inténtalo de nuevo.");
  }
}

function nextQuestion() {
  if (state.halfHearts <= 0) return endGame(true);
  if (state.index + 1 >= state.questions.length) return endGame(false);
  state.index++;
  renderQuestion();
}

function endGame(heartsOut) {
  state.over = true;
  if (heartsOut) {
    // REGLA DE GEORGES: sin corazones = 24 horas de espera.
    setLockout(Date.now());
  }
  const best = getBest();
  if (state.score > best) storeSet(BEST_KEY, String(state.score));
  if (state.bestStreak > getBestStreak()) storeSet(BEST_STREAK_KEY, String(state.bestStreak));
  $("trivia-end-title").textContent = heartsOut ? "¡Sin corazones!" : "¡Partida terminada!";
  $("trivia-end-score").textContent = state.score + " puntos · " + state.correctCount + " de " + state.questions.length + " correctas";
  $("trivia-end-detail").textContent = heartsOut
    ? "Perdiste tus 3 corazones. Cada error quita medio corazón: 6 errores terminan la partida."
    : (state.correctCount === state.questions.length
      ? "¡Perfecto! 10 de 10. Eres un crack del dinero."
      : "Buen juego. Cada respuesta trae una explicación: vuelve a jugar y supera tu puntaje.");
  const lockEl = $("trivia-end-lockout");
  if (heartsOut) {
    lockEl.hidden = false;
    lockEl.textContent = "⏳ Podrás jugar de nuevo en " + formatLockout(lockoutRemainingMs()) + ".";
  } else {
    lockEl.hidden = true;
  }
  $("trivia-end-best").textContent = "Mejor puntaje: " + Math.max(best, state.score) + " · Mejor racha: " + Math.max(getBestStreak(), state.bestStreak);
  showPanel("end");
}

function toggleSound() {
  state.soundOn = !state.soundOn;
  const b = $("trivia-sound");
  if (b) b.textContent = state.soundOn ? "🔊" : "🔇";
}

function init() {
  const startBtn = $("trivia-start-btn");
  if (startBtn) startBtn.addEventListener("click", startGame);
  const nextBtn = $("trivia-next-btn");
  if (nextBtn) nextBtn.addEventListener("click", nextQuestion);
  const againBtn = $("trivia-again-btn");
  if (againBtn) againBtn.addEventListener("click", () => showPanel("start"));
  const soundBtn = $("trivia-sound");
  if (soundBtn) soundBtn.addEventListener("click", toggleSound);
  showPanel("start");
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}

/* Expuesto para pruebas automatizadas (Node + vm). */
if (typeof window !== "undefined") {
  window.EJDTrivia = {
    isLockedOut, lockoutRemainingMs, setLockout, formatLockout,
    lockoutUntil, LOCKOUT_MS, endGame, refreshStartScreen, _state: state,
  };
}
