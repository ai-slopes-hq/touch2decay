// Natura — модель: секвенсер-река. Кувшинки на 16 местах (шаг — место по течению, нота — ступень лада поперёк, цветок — голос),
// запруда — длина петли, темп; общие fx (веер и пейзаж: туча — cutoff, горы — res, утки — attack / release) и свои значения кувшинки.
// Только данные и алгоритм — без DOM, холста и Web Audio. Время — секунды (tick(dt)), случайность — rng, лад — scale { on, root, pcs }.
// Что должно прозвучать — события слушателям (listen): 'play' {on}, 'fx', 'hear' {pd} — послушать кувшинку сейчас, 'skiff' {o} — голос кораблика
// ({t, q} на воде или null), 'wave' {w}, 'croak' {pd}, 'laser', 'shake' {v}, 'scene' {k}.
// Часы — в engine (ctx.currentTime): модель говорит, что играет шаг (stepNote) и сколько он длится (stepSec).
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
// пять волн — пять цветов: ромашка — sine, тюльпан — square, звёздочка — triangle, вертушка — saw, чертополох — sharp (треугольник в насыщение, как у Лиры)
export const WAVES = ['sine', 'square', 'triangle', 'saw', 'sharp'];
// у кувшинки могут быть свои cutoff / res / att / rel (pd.lock — задаются в её плашке), иначе — общие из пейзажа
export const LOCKS = ['cutoff', 'res', 'att', 'rel'];
// огибающая: attack 2 мс … 0.6 с, release 50 мс … 1.9 с
export const attOf = (v) => 0.002 + v * v * 0.6, relOf = (v) => 0.05 + v * v * 1.85;
export const DIVS = [['1/16', 1 / 4], ['1/8', 1 / 2], ['1/8d', 3 / 4], ['1/4', 1], ['1/4d', 1.5], ['1/2', 2]];
export const GONE_S = 4;                                  // утки улетели (в них кинули кораблик): огибающая открыта 4 с — пока не вернутся

export function createModel({ scale = { on: false, root: 0, pcs: null }, rng = Math.random } = {}) {
  // ---------- состояние (демо) ----------
  const fx = { reverb: 0.4, delay: 0.45, time: 0.5, chorus: 0.4, cutoff: 0.62, res: 0.25, att: 0.08, rel: 0.45, chance: 1 };
  const seq = { playing: false, bpm: 96 };               // где часы (next, step) — в engine
  // кувшинки: место по течению — шаг; note — ступень лада (0–14); wave — какой цветок (голос)
  const pads = { len: 12, at: [
    { note: 2, wave: 0 }, null, { note: 7, wave: 1 }, { note: 5, wave: 0 }, null, { note: 11, wave: 2 }, { note: 9, wave: 0 }, null,
    { note: 4, wave: 1 }, { note: 7, wave: 2 }, null, { note: 0, wave: 0 }, null, { note: 12, wave: 1 }, null, null] };
  // lastWave — последний выбранный цветок (новая кувшинка, голос кораблика); shake — как сильно тормошат дерево (0…1, само затихает);
  // goneAt — когда спугнули уток (время модели); prevHz — прошлая сыгранная нота (откуда глайд)
  const state = { fx, seq, pads, lastWave: 0, shake: 0, goneAt: null, prevHz: 0, time: 0 };
  const listeners = [];
  const emit = (e) => { for (const fn of listeners) fn(e); };

  const val = (pd, k) => (pd && pd.lock && pd.lock[k] != null ? pd.lock[k] : fx[k]);
  const envOpen = () => state.goneAt != null && state.time - state.goneAt < GONE_S;   // утки улетели — attack в ноль, release до конца
  const attSec = (pd) => attOf(envOpen() ? 0 : val(pd, 'att')), relSec = (pd) => relOf(envOpen() ? 1 : val(pd, 'rel'));
  const stepSec = () => 60 / seq.bpm / 4;
  const div = () => DIVS[Math.round(fx.time * (DIVS.length - 1))];
  const delaySec = () => (div()[1] * 60) / seq.bpm;
  // нота кувшинки: ступень лада от тоники (без лада — ля минор), две октавы с лишним
  function noteHz(n) {
    const root = scale.root, pcs = scale.pcs;
    const steps = pcs ? pcs.map((pc) => (pc - root + 12) % 12).sort((a, b) => a - b) : [0, 2, 3, 5, 7, 8, 10];
    const semis = steps[n % steps.length] + 12 * Math.floor(n / steps.length);
    return 110 * 2 ** ((root + semis) / 12);
  }
  // голос кораблика: поперёк реки — высота (с ладом по ступеням, без — плавно между ступенями)
  function skiffHz(q) {
    const d = clamp((q / 0.78 + 0.5) * 14, 0, 14);
    if (scale.on) return noteHz(Math.round(d));
    const lo = Math.floor(d), hi = Math.min(14, lo + 1), a = Math.log2(noteHz(lo)), b = Math.log2(noteHz(hi));
    return 2 ** (a + (b - a) * (d - lo));
  }

  // ---------- что играет: нота кувшинки (engine зовёт, когда она звучит — от неё глайд следующей) ----------
  function voice(pd) {
    const hz = noteHz(pd.note), from = pd.glide && state.prevHz ? state.prevHz : 0;   // глайд из прошлой ноты
    state.prevHz = hz;
    return { pd, wave: pd.wave, hz, from, glide: stepSec() * 0.8, cutoff: val(pd, 'cutoff'), res: val(pd, 'res'), att: attSec(pd), rel: relSec(pd) };
  }
  function stepNote(step) {                              // шаг петли: пустое место — пауза; шанс — свой кувшинки × общий; null — молчит
    const i = step % pads.len, pd = pads.at[i];
    if (!pd || !(rng() < (pd.chance ?? 1) * fx.chance)) return null;
    return { i, ...voice(pd) };
  }

  // ---------- транспорт, fx ----------
  function play(on = !seq.playing) { seq.playing = on; emit({ t: 'play', on }); }   // engine заводит часы с начала
  function setBpm(bpm) { seq.bpm = bpm; emit({ t: 'fx' }); }   // время задержки — доля темпа
  function setFx(k, v) { fx[k] = v; emit({ t: 'fx' }); }
  function loadFx(o) { Object.assign(fx, o); emit({ t: 'fx' }); }
  function setScene(k, v) { fx[k] = v; emit({ t: 'scene', k }); }   // туча, горы, утки: cutoff / res / att / rel — читаются на каждой ноте

  // ---------- кувшинки ----------
  const hear = (pd) => emit({ t: 'hear', pd });          // послушать: нота сейчас
  function plant(i, note) { if (!pads.at[i]) { pads.at[i] = { note, wave: state.lastWave }; hear(pads.at[i]); } }
  function remove(i) { pads.at[i] = null; }
  function movePad(i, j) { if (j === i || pads.at[j]) return false; pads.at[j] = pads.at[i]; pads.at[i] = null; return true; }   // на другое место — если свободно
  function setNote(i, n) { const pd = pads.at[i]; if (pd && n !== pd.note) { pd.note = n; hear(pd); } }
  function setLen(n) { pads.len = n; }                   // запруда
  function glide(idx) {                                  // провёл по воде через кувшинки — глайд в них; все уже скользили — снять
    const hit = idx.map((i) => pads.at[i]).filter(Boolean), on = !hit.every((pd) => pd.glide);
    for (const pd of hit) pd.glide = on;
  }
  function setWave(pd, w) { if (w === pd.wave) return false; pd.wave = w; state.lastWave = w; return true; }
  function setChance(pd, v) { pd.chance = v; }
  function setLock(pd, k, v) { pd.lock = pd.lock || {}; pd.lock[k] = v; }
  function resetPad(pd, k) { if (k === 'chance') pd.chance = 1; else if (pd.lock) { delete pd.lock[k]; if (!Object.keys(pd.lock).length) delete pd.lock; } }   // снова общее
  function pickWave(k, pd) {                             // меню волн: цветок кувшинки или голос кораблика
    state.lastWave = k;
    if (pd) { pd.wave = k; hear(pd); } else emit({ t: 'wave', w: k });
  }

  // ---------- кораблик, дерево, птицы, лягушка, утки ----------
  const skiff = (o) => emit({ t: 'skiff', o });          // o = { t, q } — на воде, null — убрали с воды
  function shakeBy(a) { state.shake = Math.min(1, state.shake + a); }
  const scatter = () => emit({ t: 'laser' });            // спугнули птиц
  function croak(pd) { if (pd) emit({ t: 'croak', pd }); }
  function scare() { state.goneAt = state.time; }        // кораблик в заводи — утки улетают

  // ---------- патч ----------
  const sounding = () => seq.playing && pads.at.slice(0, pads.len).some(Boolean);
  function dice() {                                      // кувшинки по Евклиду, ноты — блуждание по ступеням, цветы — случайно; лодочка плывёт
    const R = rng, n = 8 + Math.floor(R() * 9), k = 3 + Math.floor(R() * (n - 4));
    let note = Math.floor(R() * 8);
    pads.len = n;
    pads.at = Array.from({ length: 16 }, (_, i) => {
      if (i >= n || (i * k) % n >= k) return null;
      note = clamp(note + [-2, -1, 1, 2][Math.floor(R() * 4)], 0, 14);
      const pd = { note, wave: Math.floor(R() * WAVES.length) };
      if (R() < 0.35) {                                  // своё значение у трети кувшинок — одно-два из четырёх
        pd.lock = {};
        for (const k of LOCKS) if (R() < 0.4) pd.lock[k] = k === 'res' ? R() * 0.85 : k === 'att' ? R() * 0.6 : R();
        if (!Object.keys(pd.lock).length) pd.lock.cutoff = R();
      }
      if (R() < 0.2) pd.chance = 0.5 + Math.round(R() * 8) / 20;
      return pd;
    });
    Object.assign(fx, { chance: 1, cutoff: 0.35 + R() * 0.5, res: R() * 0.6, att: R() * R() * 0.5, rel: 0.2 + R() * 0.6 });   // туча, горы и утки тоже
    emit({ t: 'fx' });
    if (!seq.playing) play(true);
  }
  function clear() { pads.at = Array(16).fill(null); }
  const snapshot = () => JSON.stringify({ fx, len: pads.len, at: pads.at, bpm: seq.bpm });
  function restore(js) {
    const st = JSON.parse(js);
    Object.assign(fx, { chance: 1 }, st.fx); delete fx.env; pads.len = st.len; pads.at = st.at.map((p) => (p ? { ...p, ...(p.lock ? { lock: { ...p.lock } } : {}) } : null)); seq.bpm = st.bpm;
    emit({ t: 'fx' });
  }

  return {
    state, val, envOpen, attSec, relSec, stepSec, div, delaySec, noteHz, skiffHz, voice, stepNote,
    play, setBpm, setFx, loadFx, setScene, hear, plant, remove, movePad, setNote, setLen, glide, setWave, setChance, setLock, resetPad, pickWave,
    skiff, shakeBy, scatter, croak, scare, dice, clear, snapshot, restore, sounding,
    tick(dt) {                                           // dt — секунды кадра без обрезки; дерево затихает (τ 1.4 с, шаг не длиннее 0.1 с, как было)
      state.time += dt;
      state.shake *= Math.exp(-Math.min(0.1, dt) / 1.4);
      emit({ t: 'shake', v: state.shake });
    },
    listen(fn) { listeners.push(fn); },
  };
}
