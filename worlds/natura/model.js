// Natura — фасад модели. Сама модель живёт в ядре (core/worlds/natura → t2d.wasm, узел t2d-worklet.js хоста, слот 4), здесь — её зеркало и
// действия касаний. API — прежней JS-модели (эталон — tools/ref/natura-model.js), без DOM, холста и Web Audio: state.pads.at — живые кувшинки
// (view держит ссылки), fx, seq, shake правятся на месте из зеркала.
// Действия применяются к state сразу и уходят в ядро через send (порт узла ядра, асинхронно; send → номер сообщения). Зеркало (sync) приходит
// ~60 раз в секунду с числом уже применённых ядром сообщений: поле, которое здесь правили, а ядро ещё не видело, зеркало не перетирает (как
// фасады Portus, Monochordum, Firmamentum и Goetia). Кубик — здесь (алгоритм эталона на rng), в ядро — одним restore; шаги, шанс (chance), высота
// ноты в момент удара, глайд, дерево (затухает в ядре) и звук — в ядре. События listen — как у прежней модели: 'play', 'fx', 'hear', 'skiff',
// 'wave', 'croak', 'laser', 'scene'; 'shake' больше не шлётся — дерево ведёт ядро (state.shake — зеркало).
// Что остаётся здесь: время для картинки (state.time, goneAt — утки улетели), noteHz / skiffHz (подпись ноты и положение кораблика), stepNote /
// voice — тот же алгоритм, что в ядре, для тестов.
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
// пять волн — пять цветов: ромашка — sine, тюльпан — square, звёздочка — triangle, вертушка — saw, чертополох — sharp (треугольник в насыщение, как у Лиры)
export const WAVES = ['sine', 'square', 'triangle', 'saw', 'sharp'];
// у кувшинки могут быть свои cutoff / res / att / rel (pd.lock — задаются в её плашке), иначе — общие из пейзажа
export const LOCKS = ['cutoff', 'res', 'att', 'rel'];
// огибающая: attack 2 мс … 0.6 с, release 50 мс … 1.9 с
export const attOf = (v) => 0.002 + v * v * 0.6, relOf = (v) => 0.05 + v * v * 1.85;
export const DIVS = [['1/16', 1 / 4], ['1/8', 1 / 2], ['1/8d', 3 / 4], ['1/4', 1], ['1/4d', 1.5], ['1/2', 2]];
export const GONE_S = 4;                                  // утки улетели (в них кинули кораблик): огибающая открыта 4 с — пока не вернутся

// ядро: слот мира в хосте, коды action, ключи, раскладка зеркала — core/worlds/natura/world.hpp
export const SLOT = 4;
export const ACT = {
  STATE: 0, PLAY: 1, HEAR: 2, SHAKE: 3, SKIFF: 4, SKIFF_OFF: 5, WAVE: 6, CROAK: 7, LASER: 8, SCARE: 9,
  PLANT: 10, REMOVE: 11, MOVE: 12, NOTE: 13, LEN: 14, PGLIDE: 15, PWAVE: 16, PCHANCE: 17, PLOCK: 18, PUNLOCK: 19, SETFX: 20, SETBPM: 21, SHAKEBY: 22, CLEAR: 23,
};
export const FX_KEYS = ['reverb', 'delay', 'time', 'chorus', 'cutoff', 'res', 'att', 'rel', 'chance'];
export const NPAD = 16;
export const MIRROR_HEAD = 16, MIRROR_PAD = 9, MIRROR_N = MIRROR_HEAD + NPAD * MIRROR_PAD;   // бегунок, играет, голосов, кораблик, bpm, len, дерево, fx×9; затем 16 × (занято, note, wave, glide, chance, cutoff, res, att, rel)

export function createModel({ scale = { on: false, root: 0, pcs: null }, rng = Math.random, send = () => 0 } = {}) {
  // ---------- состояние (демо) ----------
  const fx = { reverb: 0.4, delay: 0.45, time: 0.5, chorus: 0.4, cutoff: 0.62, res: 0.25, att: 0.08, rel: 0.45, chance: 1 };
  const seq = { playing: false, bpm: 96 };               // где часы (next, step) — в ядре
  // кувшинки: место по течению — шаг; note — ступень лада (0–14); wave — какой цветок (голос)
  const pads = { len: 12, at: [
    { note: 2, wave: 0 }, null, { note: 7, wave: 1 }, { note: 5, wave: 0 }, null, { note: 11, wave: 2 }, { note: 9, wave: 0 }, null,
    { note: 4, wave: 1 }, { note: 7, wave: 2 }, null, { note: 0, wave: 0 }, null, { note: 12, wave: 1 }, null, null] };
  // lastWave — последний выбранный цветок (новая кувшинка, голос кораблика); shake — как сильно тормошат дерево (0…1, затухает в ядре, здесь — зеркало);
  // goneAt — когда спугнули уток (время модели); prevHz — прошлая нота для voice() (в ядре она своя)
  const state = { fx, seq, pads, lastWave: 0, shake: 0, goneAt: null, prevHz: 0, time: 0 };
  const listeners = [];
  const emit = (e) => { for (const fn of listeners) fn(e); };
  let post = send;
  let parAt = 0, padAt = 0, playAt = 0, shakeAt = 0;     // номер последнего сообщения, правившего параметры сцены / кувшинки / пуск / дерево
  const act = (kind, i = 0, a = []) => post({ t: 'action', slot: SLOT, kind, i, a });
  const idx = (pd) => pads.at.indexOf(pd);

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

  // ---------- что играет шаг: тот же алгоритм, что в ядре (для тестов; звук ставит ядро) ----------
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
  function play(on = !seq.playing) { seq.playing = on; playAt = act(ACT.PLAY, 0, [on ? 1 : 0]); emit({ t: 'play', on }); }   // ядро заводит часы с начала
  function setBpm(bpm) { seq.bpm = bpm; parAt = act(ACT.SETBPM, 0, [bpm]); emit({ t: 'fx' }); }   // время задержки — доля темпа
  function put(k, v) { fx[k] = v; const i = FX_KEYS.indexOf(k); if (i >= 0) parAt = act(ACT.SETFX, i, [v]); }
  function setFx(k, v) { put(k, v); emit({ t: 'fx' }); }
  function loadFx(o) { for (const [k, v] of Object.entries(o || {})) put(k, v); emit({ t: 'fx' }); }
  function setScene(k, v) { put(k, v); emit({ t: 'scene', k }); }   // туча, горы, утки: cutoff / res / att / rel — ядро читает на каждой ноте

  // ---------- кувшинки ----------
  function hear(pd) { emit({ t: 'hear', pd }); const i = idx(pd); if (i >= 0) act(ACT.HEAR, i); }   // послушать: нота сейчас
  function plant(i, note) { if (!pads.at[i]) { pads.at[i] = { note, wave: state.lastWave }; padAt = act(ACT.PLANT, i, [note, state.lastWave]); hear(pads.at[i]); } }
  function remove(i) { pads.at[i] = null; padAt = act(ACT.REMOVE, i); }
  function movePad(i, j) { if (j === i || pads.at[j]) return false; pads.at[j] = pads.at[i]; pads.at[i] = null; padAt = act(ACT.MOVE, i, [j]); return true; }   // на другое место — если свободно
  function setNote(i, n) { const pd = pads.at[i]; if (pd && n !== pd.note) { pd.note = n; padAt = act(ACT.NOTE, i, [n]); hear(pd); } }
  function setLen(n) { pads.len = n; parAt = act(ACT.LEN, 0, [n]); }   // запруда
  function glide(ix) {                                   // провёл по воде через кувшинки — глайд в них; все уже скользили — снять
    const hit = ix.filter((i) => pads.at[i]), on = !hit.every((i) => pads.at[i].glide);
    for (const i of hit) { pads.at[i].glide = on; padAt = act(ACT.PGLIDE, i, [on ? 1 : 0]); }
  }
  function setWave(pd, w) { if (w === pd.wave) return false; pd.wave = w; state.lastWave = w; const i = idx(pd); if (i >= 0) padAt = act(ACT.PWAVE, i, [w]); return true; }
  function setChance(pd, v) { pd.chance = v; const i = idx(pd); if (i >= 0) padAt = act(ACT.PCHANCE, i, [v]); }
  function setLock(pd, k, v) { pd.lock = pd.lock || {}; pd.lock[k] = v; const i = idx(pd); if (i >= 0) padAt = act(ACT.PLOCK, i, [LOCKS.indexOf(k), v]); }
  function resetPad(pd, k) {                             // снова общее
    if (k === 'chance') pd.chance = 1; else if (pd.lock) { delete pd.lock[k]; if (!Object.keys(pd.lock).length) delete pd.lock; }
    const i = idx(pd); if (i >= 0) padAt = act(ACT.PUNLOCK, i, [k === 'chance' ? LOCKS.length : LOCKS.indexOf(k)]);
  }
  function pickWave(k, pd) {                             // меню волн: цветок кувшинки или голос кораблика
    state.lastWave = k;
    if (pd) { pd.wave = k; const i = idx(pd); if (i >= 0) padAt = act(ACT.PWAVE, i, [k]); hear(pd); } else { emit({ t: 'wave', w: k }); act(ACT.WAVE, 0, [k]); }
  }

  // ---------- кораблик, дерево, птицы, лягушка, утки ----------
  function skiff(o) {                                    // o = { t, q } — на воде, null — убрали с воды
    emit({ t: 'skiff', o });
    if (o) act(ACT.SKIFF, 0, [o.q, o.t, state.lastWave]); else act(ACT.SKIFF_OFF);
  }
  function shakeBy(a) { state.shake = Math.min(1, state.shake + a); shakeAt = act(ACT.SHAKEBY, 0, [a]); }
  function scatter() { emit({ t: 'laser' }); act(ACT.LASER); }   // спугнули птиц
  function croak(pd) { if (pd) { emit({ t: 'croak', pd }); act(ACT.CROAK, 0, [pd.note]); } }
  function scare() { state.goneAt = state.time; act(ACT.SCARE); }   // кораблик в заводи — утки улетают

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
    parAt = padAt = post({ t: 'restore', slot: SLOT, js: snapshot() });   // сцена — в ядро одним сообщением (пуск не трогаем)
    emit({ t: 'fx' });
    if (!seq.playing) play(true);
  }
  function clear() { pads.at = Array(16).fill(null); padAt = act(ACT.CLEAR); }
  const snapshot = () => JSON.stringify({ fx, len: pads.len, at: pads.at, bpm: seq.bpm });
  function restore(js) {
    const st = JSON.parse(js);
    Object.assign(fx, { chance: 1 }, st.fx); delete fx.env; pads.len = st.len; pads.at = st.at.map((p) => (p ? { ...p, ...(p.lock ? { lock: { ...p.lock } } : {}) } : null)); seq.bpm = st.bpm;
    parAt = padAt = post({ t: 'restore', slot: SLOT, js });
    emit({ t: 'fx' });
  }

  function sync(m, applied) {                            // зеркало ядра → state; applied — сколько сообщений ядро уже применило
    if (!m || m.length < MIRROR_N) return;               // старый t2d.wasm без слота 4 (или этапа 1) отвечает пустым зеркалом
    if (applied >= playAt) seq.playing = m[1] !== 0;
    if (applied >= parAt) {
      seq.bpm = m[4]; pads.len = m[5];
      for (let k = 0; k < FX_KEYS.length; k++) fx[FX_KEYS[k]] = m[7 + k];
    }
    if (applied >= shakeAt) state.shake = m[6];
    if (applied >= padAt) {                              // кувшинки: по месту — те же объекты, лишние уходят, новые всплывают
      for (let i = 0; i < NPAD; i++) {
        const o = MIRROR_HEAD + i * MIRROR_PAD, pd = pads.at[i];
        if (m[o] === 0) { if (pd) pads.at[i] = null; continue; }
        const g = m[o + 3] !== 0, ch = m[o + 4], q = pd || { note: m[o + 1], wave: m[o + 2] };
        q.note = m[o + 1]; q.wave = m[o + 2];
        if (!!q.glide !== g) q.glide = g;
        if (ch < 0) { if (q.chance != null) delete q.chance; } else if (q.chance !== ch) q.chance = ch;
        for (let l = 0; l < LOCKS.length; l++) {
          const v = m[o + 5 + l], key = LOCKS[l];
          if (v >= 0) { if (!q.lock) q.lock = {}; if (q.lock[key] !== v) q.lock[key] = v; }
          else if (q.lock && key in q.lock) { delete q.lock[key]; if (!Object.keys(q.lock).length) delete q.lock; }
        }
        if (!pd) pads.at[i] = q;
      }
    }
  }
  function bind(fn) {                                    // новый узел ядра (новый контекст): счёт сообщений — заново, сцена и пуск — туда целиком
    post = fn;
    parAt = padAt = playAt = shakeAt = post({ t: 'restore', slot: SLOT, js: snapshot() });
    if (seq.playing) playAt = act(ACT.PLAY, 0, [1]);
    if (state.shake > 0.0005) shakeAt = act(ACT.SHAKE, 0, [state.shake]);
  }

  return {
    state, val, envOpen, attSec, relSec, stepSec, div, delaySec, noteHz, skiffHz, voice, stepNote,
    play, setBpm, setFx, loadFx, setScene, hear, plant, remove, movePad, setNote, setLen, glide, setWave, setChance, setLock, resetPad, pickWave,
    skiff, shakeBy, scatter, croak, scare, dice, clear, snapshot, restore, sounding,
    tick(dt) {                                           // dt — секунды кадра без обрезки (утки); дерево затихает и в ядре — здесь для вида между зеркалами
      state.time += dt;
      state.shake *= Math.exp(-Math.min(0.1, dt) / 1.4);
    },
    listen(fn) { listeners.push(fn); },
    sync, bind,
  };
}
