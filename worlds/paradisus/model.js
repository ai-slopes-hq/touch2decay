// Paradisus — модель: ангелы на девяти сферах, общие FX, планеты на сферах (полиритм), Gloria. Только данные и алгоритм — без DOM,
// холста и Web Audio. Время — секунды (tick(dt)), случайность — rng, лад — scale { on, root }.
// Звучит ли ангел на самом деле (голос собран — есть контекст), модели говорит склейка: voiced(a, on) → a.sung (как раньше a.n).
// Что должно прозвучать — события слушателям (listen): { t: 'voice', a, on, tau? } — голос ангела, { t: 'angel', a, rebuild? } — перестроить
// (высота, гласная, хор), 'fx', { t: 'grain', hz } — зерно Gloria, { t: 'grains', hz, n, gap } — россыпь (роза), { t: 'chime', a, hz } — планета над ангелом.
const TAU = Math.PI * 2;
export const NAMES = ['Primum Mobile', 'Stellae', 'Saturnus', 'Iuppiter', 'Mars', 'Sol', 'Venus', 'Mercurius', 'Luna'];   // изнутри наружу; гармоника n = 9 − k
export const VOW = ['a', 'e', 'i', 'o', 'u'];
// форманты сопрано (F1–F4: частота, громкость в дБ, ширина) — хор как в соборе
export const FORM = {
  a: [[800, 0, 80], [1150, -6, 90], [2900, -32, 120], [3900, -20, 130]],
  e: [[350, 0, 60], [2000, -20, 100], [2800, -15, 120], [3600, -40, 150]],
  i: [[270, 0, 60], [2140, -12, 90], [2950, -26, 100], [3900, -26, 120]],
  o: [[450, 0, 70], [800, -11, 80], [2830, -22, 100], [3800, -22, 130]],
  u: [[325, 0, 50], [700, -16, 60], [2700, -35, 170], [3800, -40, 180]],
};
export const PIN_MAX = 4;
export const ANGEL_KEYS = ['k', 'v', 'singers', 'detune', 'vib', 'breath', 'reg'];   // что ангела сохраняется в снимке
export const FX_DEF = { shimmer: 0.35, gloria: 0.2, aether: 0.5, vibrato: 0.4, orbits: 0.35 };
export const DRIFT_DT = 0.12;                           // дрейф гласной закреплённых — перестройка голоса раз в 120 мс

export const harm = (k) => 9 - k;
const frac = (x) => x - Math.floor(x);
export const vowelAt = (v) => { const i = Math.floor(v) % 5, j = (i + 1) % 5, t = v - Math.floor(v); return { i, j, t }; };
export const vowelName = (v) => VOW[Math.round(v) % 5];
export function formants(v) {                           // между гласными — плавно: частоты по логарифму, громкость линейно
  const { i, j, t } = vowelAt(v), A = FORM[VOW[i]], B = FORM[VOW[j]];
  return A.map((p, q) => [p[0] * (B[q][0] / p[0]) ** t, p[1] + (B[q][1] - p[1]) * t, p[2] + (B[q][2] - p[2]) * t]);
}

export function createModel({ scale = { on: false, root: 0 }, rng = Math.random } = {}) {
  const angels = [];                                    // { k, v (0..5, по кругу), pinned, singers, detune, vib, breath, reg, lvl, seed, dr, sung }
  const fx = { ...FX_DEF };
  const state = { angels, fx, orbitT: 0, time: 0 };     // orbitT — планеты на сферах; time — секунды модели (дрейф гласной)
  let grainAcc = 0, driftAt = 0;
  const listeners = [];
  const emit = (e) => { for (const fn of listeners) fn(e); };

  const tonic = () => 110 * 2 ** ((scale.on ? scale.root : 0) / 12);   // тоника лада во второй октаве (A2 = 110)
  const hzOf = (a) => tonic() * harm(a.k) * [0.5, 1, 2][a.reg];
  const vEff = (a) => (a.pinned ? (((a.v + 0.45 * fx.vibrato * Math.sin(state.time * 0.25 * a.dr + a.seed)) % 5) + 5) % 5 : a.v);   // оставленный ангел медленно плывёт по гласным
  const planetAt = (k) => frac(state.orbitT * harm(k) + k * 0.13);   // планета сферы: harm(k) оборотов за круг — видимый полиритм
  const pinned = () => angels.filter((a) => a.pinned);

  const newAngel = (k, v) => ({ k, v, pinned: false, singers: 4, detune: 0.5, vib: 0.5, breath: 0.25, reg: 1, lvl: 0, seed: rng() * TAU, dr: 0.7 + rng() * 0.6, sung: false });
  function addAngel(k, v, pin = false) {                // тронул сферу — поёт, пока держишь; pin — остаётся (не больше PIN_MAX, иначе null)
    if (pin && pinned().length >= PIN_MAX) return null;
    const a = newAngel(k, v); a.pinned = pin; angels.push(a);
    emit({ t: 'voice', a, on: true });
    return a;
  }
  function release(a, tau = 0.5) {                      // отпустить: голос гаснет за tau, ангела нет
    const i = angels.indexOf(a);
    if (i < 0) return;
    a.pinned = false; angels.splice(i, 1);
    emit({ t: 'voice', a, on: false, tau });
  }
  function moveAngel(a, k, v) { a.k = k; a.v = v; emit({ t: 'angel', a }); }   // поперёк — сфера (гармоника), вдоль — гласная
  function setAngel(a, key, v) {                        // плашка ангела: хор (1–5 певчих), расстройка, вибрато, дыхание, регистр
    if (key === 'singers') { const n = Math.min(5, Math.max(1, Math.ceil(v * 5))); if (n !== a.singers) { a.singers = n; emit({ t: 'angel', a, rebuild: true }); } return; }
    if (key === 'reg') a.reg = Math.min(2, Math.floor(v * 3)); else a[key] = v;
    emit({ t: 'angel', a });
  }
  function setFx(k, v) { fx[k] = v; emit({ t: 'fx' }); }
  function loadFx(o) { Object.assign(fx, o); emit({ t: 'fx' }); }
  const singing = () => angels.filter((a) => a.sung);
  function rose() {                                     // тап по розе — россыпь зёрен на первом поющем (никого — октава над тоникой)
    const s = singing();
    emit({ t: 'grains', hz: s.length ? hzOf(s[0]) : tonic() * 2, n: 12, gap: 0.035 });
  }
  function clear(tau = 0.4) { for (const a of angels.splice(0)) emit({ t: 'voice', a, on: false, tau }); }

  function tick(dt) {
    const now = (state.time += dt), sing = singing();
    if (fx.gloria > 0.01 && sing.length) {              // Gloria — зёрна хора: ∝ времени и fx.gloria, на гармонике случайного поющего
      grainAcc += dt * fx.gloria * 24;
      while (grainAcc >= 1) { grainAcc -= 1; emit({ t: 'grain', hz: hzOf(sing[Math.floor(rng() * sing.length)]) }); }
    } else grainAcc = 0;
    for (const a of angels) a.lvl += ((a.sung ? 1 : 0) - a.lvl) * (1 - Math.exp(-dt / 0.3));
    if (fx.vibrato > 0.01 && now - driftAt > DRIFT_DT) { driftAt = now; for (const a of angels) if (a.pinned && a.sung) emit({ t: 'angel', a }); }   // гласная плывёт — голос за ней
    if (fx.orbits > 0.01) {                             // планеты: прошла над оставленным ангелом своей сферы — ангел вспыхивает зёрнами
      const pin = pinned(), prev = pin.map((a) => planetAt(a.k));
      state.orbitT += dt / (70 / (0.3 + 1.7 * fx.orbits));
      pin.forEach((a, i) => {
        const p0 = prev[i], p1 = planetAt(a.k), u = a.v / 5, step = frac(p1 - p0);
        if (step < 0.5 && frac(u - p0) < step && a.sung) emit({ t: 'chime', a, hz: hzOf(a) });
      });
    }
  }

  function dice() {                                     // три ангела на сферах аккорда 4 · 5 · 6 — мажорное трезвучие в чистом строе
    clear();
    const chords = [[4, 5, 6], [3, 4, 5], [4, 6, 8], [5, 6, 8], [2, 3, 5]], ch = chords[Math.floor(rng() * chords.length)];
    const v0 = rng() * 5;                               // гласные — вразброс по кругу, ангелы не толпятся
    ch.forEach((n, i) => addAngel(9 - n, (v0 + i * 1.7 + rng() * 0.4) % 5, true));
  }
  const snapshot = () => JSON.stringify({ angels: pinned().map((a) => Object.fromEntries(ANGEL_KEYS.map((k) => [k, a[k]]))), fx });
  function restore(js) {
    const st = JSON.parse(js);
    clear();
    Object.assign(fx, st.fx);
    for (const s of st.angels) { const a = Object.assign(newAngel(s.k, s.v), s, { pinned: true }); angels.push(a); emit({ t: 'voice', a, on: true }); }
    emit({ t: 'fx' });
  }

  return {
    state, tonic, hzOf, vEff, planetAt, pinned,
    addAngel, release, moveAngel, setAngel, setFx, loadFx, rose, clear, dice,
    tick, snapshot, restore, sounding: () => angels.length > 0,
    listen(fn) { listeners.push(fn); },
    voiced(a, on) { a.sung = on; },                     // склейка: голос ангела собран / снят (engine)
    setOrbit(x) { state.orbitT = x; },                  // для тестов и сценария: поставить планеты
  };
}
