// Cymatica — модель: пластина (высота, веер FX), секвенсер — ритм и мелодия своей длины (полиритм), луна, смычки.
// Только данные и алгоритм — без DOM, холста, Web Audio. Время — секунды (tick(dt)), случайность — rng, лад — scale { on, pcs, snap }.
// Время касания для записи игрой (recordHit) приходит снаружи (мс, как у часов шагов из worklet) — модель его не берёт сама.
// Что должно прозвучать — события слушателям (listen): { t: 'seq', msg, born {r, m} } — узор целиком (msg — сообщение worklet,
// born — гнёзда, где новое: вспышка), { t: 'f0', hz }, 'params', 'fx' (зал, эхо), { t: 'bow', msg }, { t: 'strike', msg, answer? }.
import {
  SLOTS, F_MIN, F_MAX, F_DEF, ECHO_DIVS, clamp, wrap, nearestIdx, euclid, nearestStep, walkMelody, rotateSteps,
  noteList as noteListOf, degPerOct as degOf, scaleSemis as semisOf, cellIdx, noteAt, cellOf, cellCenter, transposeHits, snapToGrid, quantizeRhythm, seqMessage,
} from './core.js';

const r4 = (x) => Math.round(x * 1e4) / 1e4;
export const DRIFT_RATES = [['4 bars', 16], ['2 bars', 8], ['1 bar', 4], ['1/2', 2], ['1/4', 1]];

export function createModel({ scale = { on: false, pcs: null, snap: (s) => s }, rng = Math.random } = {}) {
  // ---------- состояние: высота, пластина (веер FX), закреплённые смычки ----------
  const plate = { f0: F_DEF, fx: { structure: 2 / 7, damping: 0.5, brightness: 0.5, hall: 0.25, echo: 0.15, time: 6 / 8, chance: 1 }, bows: [] };
  let bowId = 1;
  // ---------- секвенсер: ритм (удары) и мелодия (места на пластине) — у каждой своя длина, отсюда полиритм; часы — в worklet ----------
  const seq = {
    bpm: 96, playing: false, rec: false,
    rhythm: { len: 16, steps: Array(SLOTS).fill(null) },   // { vel } — удар
    melody: { len: 7, steps: Array(SLOTS).fill(null) },    // { x, y } — куда бьёт удар этого шага: клетка — нота, точка — тембр; пусто — пауза
  };
  // ноты считаются из мест: размер пластины (щипок) — база раскладки, поэтому щипок транспонирует всю музыку
  // луна у кнопок: медленно качает размер пластины по ступеням лада (sine) или прыгает случайно (random); такт — от темпа; t0 — секунды модели
  const drift = { on: false, depth: 0.3, rate: 0.5, shape: 0, k: 0, t0: 0, last: -1 };
  // grid — сетка записи в гнёздах: 1/16, 1/8, 1/4; lastHit — место последнего удара; cursor — пошаговый ввод (часы стоят);
  // stepRec — запись по шагам: { r, m } — куда ляжет следующий удар; sentSeq — что ушло в worklet (для тестов и отзыва резонатора)
  const state = { plate, seq, drift, grid: 1, lastHit: { x: 0.3, y: 0 }, cursor: null, stepRec: null, lastStrike: null, sentSeq: null, time: 0 };
  const listeners = [];
  const emit = (e) => { for (const fn of listeners) fn(e); };

  const noteList = () => noteListOf(scale);
  const degPerOct = () => degOf(scale);
  const scaleSemis = () => semisOf(scale);
  const driftRate = () => DRIFT_RATES[Math.round(drift.rate * (DRIFT_RATES.length - 1))];
  const driftDepth = () => Math.max(1, Math.round(drift.depth * 7));
  function effF0() {                              // высота с луной: база (щипок) + k ступеней
    if (!drift.on || !drift.k) return plate.f0;
    const list = scaleSemis(), i = clamp(nearestIdx(list, 12 * Math.log2(plate.f0 / F_MIN)) + drift.k, 0, list.length - 1);
    return clamp(F_MIN * 2 ** (list[i] / 12), F_MIN, F_MAX);
  }
  const fs = () => 12 * Math.log2(effF0() / F_MIN);
  const base = () => nearestIdx(noteList(), fs());
  const sent = { r: [], o: [] };
  let sentKey = '';
  const scaleKey = () => `${!!scale.on}|${scale.pcs}`;   // лад меняется в общей строке — ноты надо переслать
  function notesOf(steps) {                      // нота каждого места: полутоны от 55 Гц или null (клетка за пределом)
    const list = noteList(), b = nearestIdx(list, fs()), n = degPerOct();
    return steps.map((st) => (st ? noteAt(st.x, st.y, b, n, list) : null));
  }
  function sendSeq() {
    const notes = notesOf(seq.melody.steps), born = { r: [], m: [] };   // новое в гнезде — вспышка: видно, куда легло
    // нота сменила клетку — вспышка; щипок двигает базу, клетки те же — без вспышек
    const n = degPerOct(), offs = seq.melody.steps.map((st) => (st ? cellIdx(st.x, st.y, 0, n) : null));
    for (let i = 0; i < SLOTS; i++) {
      if (seq.rhythm.steps[i] && seq.rhythm.steps[i] !== sent.r[i]) born.r.push(i);
      if (notes[i] != null && offs[i] !== sent.o[i]) born.m.push(i);
    }
    sent.r = seq.rhythm.steps.slice(); sent.o = offs; sentKey = scaleKey();
    // в worklet: место с нотой и точкой удара; место в молчащей клетке (за 1760 Гц) уходит пустым — пауза
    const msg = seqMessage(seq, notes, plate.fx.chance);
    state.sentSeq = { rhythm: msg.rhythm, melody: msg.melody };
    emit({ t: 'seq', msg, born });               // engine: в worklet (и эхо идёт за темпом)
  }
  const bowMsg = (b, on) => ({ t: 'bow', id: b.id, x: b.x, y: b.y, on, exciter: b.exciter, pressure: b.pressure, amp: b.amp });
  const sendBow = (b, on) => emit({ t: 'bow', msg: bowMsg(b, on) });
  const sendF0 = () => emit({ t: 'f0', hz: effF0() });

  // записать удар игрой: удар — в ближайший шаг ритма (по сетке), место — в шаг мелодии, что играет в тот же миг
  // now — время касания, last — последний тик часов { r, m, atMs } (мс одной шкалы)
  function recordHit(x, y, now, last) {
    state.lastHit = { x, y };
    if (!seq.rec || !seq.playing || !last) return;
    const stepMs = 60000 / seq.bpm / 4, R = seq.rhythm.len, h = Math.floor(R / 2);
    const i = nearestStep(now, last.atMs, last.r, stepMs, R), j = snapToGrid(i, state.grid, R);
    const sh = ((j - i + R + h) % R) - h;         // сетка сдвинула удар — мелодия сдвигается так же
    seq.rhythm.steps[j] = { vel: 1 };
    seq.melody.steps[wrap(nearestStep(now, last.atMs, last.m, stepMs, seq.melody.len) + sh, seq.melody.len)] = { x, y };
    sendSeq();
  }
  // пустое второе кольцо не должно глушить первое: удары без мест — все места в последнюю точку, места без ударов — удар на каждом шаге
  function fillMelody() {
    if (!seq.melody.steps.some(Boolean)) for (let i = 0; i < seq.melody.len; i++) seq.melody.steps[i] = { ...state.lastHit };
  }
  function fillRhythm() {
    if (!seq.rhythm.steps.some(Boolean)) for (let i = 0; i < seq.rhythm.len; i++) seq.rhythm.steps[i] = { vel: 1 };
  }
  function play(on = !seq.playing) { seq.playing = on; if (!on) seq.rec = false; if (on) state.stepRec = null; sendSeq(); }
  function rec(on = !seq.rec) { seq.rec = on; if (on && !seq.playing) play(true); }
  function stepRecToggle() { state.stepRec = state.stepRec ? null : { r: 0, m: 0 }; state.cursor = null; }
  const setCursor = (i) => { state.cursor = i; };
  const cycleGrid = () => { state.grid = state.grid === 1 ? 2 : state.grid === 2 ? 4 : 1; };   // сетка 1/16 → 1/8 → 1/4

  // ---------- высота = размер пластины ----------
  function setF0(hz) {
    const s = scale.snap(12 * Math.log2(clamp(hz, F_MIN, F_MAX) / F_MIN));
    plate.f0 = clamp(F_MIN * 2 ** (s / 12), F_MIN, F_MAX);
    sendF0();
    if (seq.melody.steps.some(Boolean)) sendSeq();   // ноты едут вместе с пластиной
  }
  function stepScale(fromSemi, steps) {
    const list = scaleSemis();
    setF0(F_MIN * 2 ** (list[clamp(nearestIdx(list, fromSemi) + steps, 0, list.length - 1)] / 12));
  }

  // ---------- удары: живой по пластине, по метке места ----------
  // живой удар (тап по пластине): звук, запись игрой, запись по шагам, пошаговый ввод; null — клетка за 1760 Гц молчит
  function strikeAt(p, now, last) {
    const note = notesOf([p])[0];
    if (note == null) return null;
    state.lastStrike = { t: 'strike', x: p.x, y: p.y, vel: 1, hard: 0.5, hz: F_MIN * 2 ** (note / 12), rec: seq.rec && seq.playing };
    emit({ t: 'strike', msg: state.lastStrike, answer: note });   // answer — резонатор, может, отзовётся
    recordHit(p.x, p.y, now, last);
    const sr = state.stepRec;
    if (sr) {                                      // запись по шагам: удар — в шаг ритма, место — в шаг мелодии; оба курсора дальше
      seq.rhythm.steps[sr.r] = { vel: 1 }; seq.melody.steps[sr.m] = { x: p.x, y: p.y };
      sr.r = (sr.r + 1) % seq.rhythm.len; sr.m = (sr.m + 1) % seq.melody.len;
      sendSeq();
    }
    if (state.cursor != null && !seq.playing && !state.stepRec) {   // пошаговый ввод: место — в гнездо курсора, курсор дальше
      const len = seq.melody.len;
      seq.melody.steps[state.cursor % len] = { x: p.x, y: p.y };
      state.cursor = (state.cursor % len + 1) % len;
      fillRhythm();
      sendSeq();
    }
    return note;
  }
  function markStrike(i) {                       // тап по метке места звучит сразу
    const st = seq.melody.steps[i], note = notesOf([st])[0];
    if (note != null) emit({ t: 'strike', msg: { t: 'strike', x: st.x, y: st.y, vel: 1, hard: 0.5, hz: F_MIN * 2 ** (note / 12) } });
  }
  function skipStep() {                          // запись по шагам: тап мимо пластины — пауза, курсоры дальше
    const sr = state.stepRec;
    seq.rhythm.steps[sr.r] = null; sr.r = (sr.r + 1) % seq.rhythm.len; sr.m = (sr.m + 1) % seq.melody.len; sendSeq();
  }

  // ---------- правка узора: кольца, метки, поворот ----------
  function setBpm(bpm) { seq.bpm = bpm; sendSeq(); }
  function setLen(ring, len) { if (len !== seq[ring].len) { seq[ring].len = len; sendSeq(); } }   // у каждого кольца своя длина
  function setChance(i, ch) { const st = seq.rhythm.steps[i]; if (st && ch !== (st.chance ?? 1)) { st.chance = ch; sendSeq(); } }
  function toggleBeat(i) { seq.rhythm.steps[i] = seq.rhythm.steps[i] ? null : { vel: 1 }; fillMelody(); sendSeq(); }
  function nudgeNote(i, ci, steps) {             // бусина: место переезжает в клетку на steps ступеней от ci
    const st = seq.melody.steps[i];
    if (!st) return;
    const list = noteList(), b = nearestIdx(list, fs()), n = degPerOct(), top = Math.min(b + 3 * n, list.length) - 1;
    const cl = cellOf(clamp(ci + steps, b, top), b, n), p = cellCenter(cl.ring, cl.sector, n);
    if (p.x !== st.x || p.y !== st.y) { st.x = p.x; st.y = p.y; sendSeq(); }
  }
  function moveMark(i, x, y) { const st = seq.melody.steps[i]; if (st) { st.x = x; st.y = y; sendSeq(); } }
  function dropMark(i) { seq.melody.steps[i] = null; sendSeq(); }   // за край — место удалено, шаг — пауза
  function comb() { seq.rhythm.steps = quantizeRhythm(seq.rhythm.steps, seq.rhythm.len, state.grid); sendSeq(); }   // причесать ритм
  // поворот на k: кольцо — сдвиг его узора от orig, пластина — каждое место на k ступеней (k = 0 — места как были)
  function turn(target, orig, k) {
    if (target === 'rhythm') seq.rhythm.steps = rotateSteps(orig.r, seq.rhythm.len, k);
    else if (target === 'melody') seq.melody.steps = rotateSteps(orig.m, seq.melody.len, k);
    else {
      const list = noteList();
      seq.melody.steps = k ? transposeHits(orig.m, k, nearestIdx(list, fs()), degPerOct(), list) : orig.m.slice();
    }
    sendSeq();
  }

  // ---------- луна ----------
  function toggleDrift() { drift.on = !drift.on; drift.k = 0; drift.t0 = state.time; drift.last = -1; sendF0(); sendSeq(); }
  function setDrift(k, t) { drift[k] = t; if (!drift.on) { drift.on = true; drift.t0 = state.time; drift.last = -1; } }
  function driftTick() {                          // луна качает пластину: новая ступень — пластина и ноты едут
    if (!drift.on) { if (drift.k) { drift.k = 0; sendF0(); sendSeq(); } return; }
    const per = (driftRate()[1] * 60) / seq.bpm, ph = (state.time - drift.t0) / per, D = driftDepth();
    let k;
    if (drift.shape < 0.5) k = Math.round(D * Math.sin(ph * Math.PI * 2));
    else { const n = Math.floor(ph * 2); if (n !== drift.last) { drift.last = n; drift.rk = Math.round((rng() * 2 - 1) * D); } k = drift.rk || 0; }   // random — новая ступень дважды за период
    if (k !== drift.k) { drift.k = k; sendF0(); if (seq.melody.steps.some(Boolean)) sendSeq(); }
  }

  // ---------- смычки (выключены во view флагом BOWS_ON) ----------
  function addBow(x, y) { const b = { id: `b${bowId++}`, x, y, exciter: 0, pressure: 0.5, amp: 0.8 }; plate.bows.push(b); sendBow(b, true); return b; }
  function moveBow(b, x, y) { b.x = x; b.y = y; sendBow(b, true); }
  function setBow(b, patch) { Object.assign(b, patch); sendBow(b, true); }
  function dropBow(b) { sendBow(b, false); plate.bows = plate.bows.filter((q) => q !== b); }
  // живой смычок под пальцем: id — палец
  const bowStart = (id, x, y) => emit({ t: 'bow', msg: { t: 'bow', id, x, y, on: true, exciter: 0, pressure: 0.5, amp: 0.8 } });
  const bowMove = (id, x, y) => emit({ t: 'bow', msg: { t: 'bow', id, x, y, on: true } });
  const bowOff = (id) => emit({ t: 'bow', msg: { t: 'bow', id, on: false } });

  // ---------- веер FX: пластина и пространство ----------
  const echoDiv = () => ECHO_DIVS[Math.round(plate.fx.time * (ECHO_DIVS.length - 1))];
  const echoSec = () => (echoDiv()[1] * 60) / seq.bpm;
  const echoFb = () => 0.35 + 0.45 * plate.fx.echo;   // больше эха — дольше тянутся повторы
  function setFx(k, t) { plate.fx[k] = t; if (k === 'chance') sendSeq(); else if (k === 'hall' || k === 'echo' || k === 'time') emit({ t: 'fx' }); else emit({ t: 'params' }); }
  function loadFx(o) { Object.assign(plate.fx, { chance: 1 }, o); emit({ t: 'params' }); emit({ t: 'fx' }); sendSeq(); }

  // ---------- патч ----------
  function dice() {                              // генеративный узор: ритм по Евклиду, мелодия другой длины по ладу — полиритм; часы идут
    const R = rng, n = 8 + Math.floor(R() * 9), k = 3 + Math.floor(R() * (n - 4)), e = euclid(k, n);
    let m = 3 + Math.floor(R() * 6);
    while (n % m === 0) m++;                   // длина мелодии не делит ритм — ноты ложатся на удары по-новому каждый круг
    const list = noteList(), b = nearestIdx(list, fs()), dn = degPerOct();   // ноты — блуждание по ладу по всем трём кольцам
    const span = list.slice(b, Math.min(b + 3 * dn, list.length));          // со случайной ноты — иначе от края до центра не дойдёт
    const w = walkMelody(m, span[Math.floor(R() * span.length)], span, R);
    seq.rhythm = { len: n, steps: Array.from({ length: SLOTS }, (_, i) => (i < n && e[i] ? { vel: 1 } : null)) };
    seq.melody = { len: m, steps: Array.from({ length: SLOTS }, (_, i) => {
      if (i >= m) return null;
      const cl = cellOf(list.indexOf(w[i]), b, dn), p = cellCenter(cl.ring, cl.sector, dn);
      const r = Math.hypot(p.x, p.y) + (R() - 0.5) * 0.1, a = Math.atan2(p.y, p.x) + (R() - 0.5) * 0.6 * ((Math.PI * 2) / dn);   // сдвиг внутри клетки — тембр разный
      return { x: r * Math.cos(a), y: r * Math.sin(a) };
    }) };
    seq.playing = true; state.stepRec = null;
    sendSeq();
  }
  function clear() {                             // узор и смычки — прочь; длины колец и часы остаются
    for (const b of plate.bows) sendBow(b, false); plate.bows = [];
    seq.rhythm.steps.fill(null); seq.melody.steps.fill(null);
    sendSeq();
  }
  const snapshot = () => JSON.stringify({
    f0: r4(plate.f0),
    fx: Object.fromEntries(Object.entries(plate.fx).map(([k, v]) => [k, r4(v)])),
    bows: plate.bows.map((b) => ({ x: r4(b.x), y: r4(b.y), exciter: r4(b.exciter), pressure: r4(b.pressure), amp: r4(b.amp) })),
    seq: { bpm: seq.bpm, rhythm: seq.rhythm, melody: seq.melody },
    drift: { on: drift.on, depth: drift.depth, rate: drift.rate, shape: drift.shape },
  });
  function restore(js) {
    const st = JSON.parse(js);
    for (const b of plate.bows) sendBow(b, false);
    plate.f0 = st.f0; Object.assign(plate.fx, { chance: 1 }, st.fx);
    if (st.drift) Object.assign(drift, st.drift); drift.k = 0; state.stepRec = null;
    plate.bows = st.bows.map((b) => ({ ...b, id: `b${bowId++}` }));
    seq.bpm = st.seq.bpm;
    seq.rhythm = { len: st.seq.rhythm.len, steps: st.seq.rhythm.steps.slice() };
    seq.melody = { len: st.seq.melody.len, steps: st.seq.melody.steps.slice() };
    sendF0(); emit({ t: 'params' }); emit({ t: 'fx' }); sendSeq();
    for (const b of plate.bows) sendBow(b, true);
  }
  function load(o) {                             // готовый узор (рендер, отладка)
    const pad = (a) => Array.from({ length: SLOTS }, (_, i) => (a[i] === undefined ? null : a[i]));
    if (o.bpm) seq.bpm = o.bpm;
    if (o.rhythm) seq.rhythm = { len: o.rhythm.len, steps: pad(o.rhythm.steps) };
    if (o.melody) seq.melody = { len: o.melody.len, steps: pad(o.melody.steps) };
    if (o.fx) loadFx(o.fx);
    sendSeq();
  }
  // без касаний и уровня из worklet (их добавляет склейка): смычки или идущие часы с ударами и местами
  const sounding = () => plate.bows.length > 0 || (seq.playing && seq.rhythm.steps.some(Boolean) && seq.melody.steps.some(Boolean));

  return {
    state, noteList, degPerOct, scaleSemis, effF0, fs, base, notesOf, driftRate, driftDepth, echoDiv, echoSec, echoFb, bowMsg,
    recordHit, fillMelody, fillRhythm, play, rec, stepRecToggle, setCursor, cycleGrid, setF0, stepScale,
    strikeAt, markStrike, skipStep, setBpm, setLen, setChance, toggleBeat, nudgeNote, moveMark, dropMark, comb, turn,
    toggleDrift, setDrift, addBow, moveBow, setBow, dropBow, bowStart, bowMove, bowOff, setFx, loadFx,
    dice, clear, snapshot, restore, load, sounding,
    tick(dt) {                                   // луна; лад сменили (здесь, в Tenebrae или отменой) — ноты в worklet заново
      state.time += dt;
      driftTick();
      if (scaleKey() !== sentKey && seq.melody.steps.some(Boolean)) sendSeq();
    },
    listen(fn) { listeners.push(fn); },
  };
}
