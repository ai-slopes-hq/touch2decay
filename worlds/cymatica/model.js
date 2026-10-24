// Cymatica — фасад модели. Сама модель живёт в ядре (core/worlds/cymatica/model.cpp → t2d.wasm, узел t2d-worklet.js хоста, слот 2); здесь —
// её зеркало и действия касаний. API — прежней JS-модели (эталон — tools/ref/cymatica-model.js), без DOM, холста и Web Audio:
// state — живые объекты (view держит ссылки), правятся на месте. Действия сразу применяются к state и уходят в ядро через send (порт
// узла, асинхронно; send → номер сообщения); зеркало (sync) приходит ~60 раз в секунду с числом уже применённых ядром сообщений: поле,
// которое здесь правили, а ядро ещё не видело, зеркало не перетирает (как фасады Monochordum, Firmamentum, Goetia).
// Что считает только ядро: луна (качает пластину от часов ядра — drift.k приходит из зеркала), запись игрой (удар привязывается к шагу
// по часам ядра — `now` и `last` у strikeAt больше не нужны, оставлены для прежних вызовов), ноты при смене лада и «отзыв» резонатора.
// Кубик — здесь (алгоритм эталона на rng с зерном) и в ядре тем же зерном: одно зерно — один узор.
// События listen — как у прежней модели: { t: 'seq', msg, born {r, m} } (msg — только для тестов; ядро получает действия, не узор),
// 'f0', 'params', 'fx' (зал, эхо), { t: 'bow', msg } (смычки пока на уровне пластины), { t: 'strike', msg } (удар по метке места).
import {
  SLOTS, F_MIN, F_MAX, F_DEF, ECHO_DIVS, clamp, wrap, nearestIdx, euclid, walkMelody, rotateSteps,
  noteList as noteListOf, degPerOct as degOf, scaleSemis as semisOf, cellIdx, noteAt, cellOf, cellCenter, transposeHits, snapToGrid, quantizeRhythm, seqMessage,
} from './core.js';
import { SLOT, ACT, FX_KEYS, DRIFT_KEYS, parseModel } from './bridge.js';

const r4 = (x) => Math.round(x * 1e4) / 1e4;
export const DRIFT_RATES = [['4 bars', 16], ['2 bars', 8], ['1 bar', 4], ['1/2', 2], ['1/4', 1]];
// mulberry32 — тот же ГСЧ, что у ядра (sdk::Rng): зерно кубика уходит в ядро, оба считают один узор
function mulberry32(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function createModel({ scale = { on: false, pcs: null, snap: (s) => s }, rng = Math.random, send = () => 0 } = {}) {
  // ---------- состояние: высота, пластина (веер FX), закреплённые смычки ----------
  const plate = { f0: F_DEF, fx: { structure: 2 / 7, damping: 0.5, brightness: 0.5, hall: 0.25, echo: 0.15, time: 6 / 8, chance: 1 }, bows: [] };
  let bowId = 1;
  // ---------- секвенсер: ритм (удары) и мелодия (места на пластине) — у каждой своя длина, отсюда полиритм; часы — в ядре ----------
  const seq = {
    bpm: 96, playing: false, rec: false,
    rhythm: { len: 16, steps: Array(SLOTS).fill(null) },   // { vel } — удар
    melody: { len: 7, steps: Array(SLOTS).fill(null) },    // { x, y } — куда бьёт удар этого шага: клетка — нота, точка — тембр; пусто — пауза
  };
  // луна у кнопок: медленно качает размер пластины по ступеням лада (sine) или прыгает случайно (random); такт — от темпа; считает ядро (k — из зеркала)
  const drift = { on: false, depth: 0.3, rate: 0.5, shape: 0, k: 0 };
  // grid — сетка записи в гнёздах: 1/16, 1/8, 1/4; lastHit — место последнего удара; cursor — пошаговый ввод (часы стоят);
  // stepRec — запись по шагам: { r, m } — куда ляжет следующий удар; sentSeq — какие ноты и места ядро получило (для тестов)
  const state = { plate, seq, drift, grid: 1, lastHit: { x: 0.3, y: 0 }, cursor: null, stepRec: null, lastStrike: null, sentSeq: null, time: 0 };
  const listeners = [];
  const emit = (e) => { for (const fn of listeners) fn(e); };
  let post = send;
  let at = 0;                                    // номер последнего сообщения, правившего модель: пока ядро его не применило, зеркало состояние не перетирает
  const act = (kind, i = 0, a = []) => post({ t: 'action', slot: SLOT, kind, i, a });
  let preAct = null;                             // хук перед каждым действием: engine ставит сетку MIDI-часов раньше пуска (иначе первый шаг — не на узле)
  const go = (kind, i, a) => { if (preAct) preAct(); at = act(kind, i, a); return at; };

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
  const scaleKey = () => `${!!scale.on}|${scale.pcs}`;   // лад меняется в общей строке — ядро переписывает ноты само, здесь — вспышки и sentSeq
  function notesOf(steps) {                      // нота каждого места: полутоны от 55 Гц или null (клетка за пределом)
    const list = noteList(), b = nearestIdx(list, fs()), n = degPerOct();
    return steps.map((st) => (st ? noteAt(st.x, st.y, b, n, list) : null));
  }
  // узор изменился: считаем, что у ядра то же (оно получило действие), и говорим слушателям, где новое (вспышка)
  function sendSeq() {
    const notes = notesOf(seq.melody.steps), born = { r: [], m: [] };   // новое в гнезде — вспышка: видно, куда легло
    // нота сменила клетку — вспышка; щипок двигает базу, клетки те же — без вспышек
    const n = degPerOct(), offs = seq.melody.steps.map((st) => (st ? cellIdx(st.x, st.y, 0, n) : null));
    for (let i = 0; i < SLOTS; i++) {
      if (seq.rhythm.steps[i] && seq.rhythm.steps[i] !== sent.r[i]) born.r.push(i);
      if (notes[i] != null && offs[i] !== sent.o[i]) born.m.push(i);
    }
    sent.r = seq.rhythm.steps.slice(); sent.o = offs; sentKey = scaleKey();
    const msg = seqMessage(seq, notes, plate.fx.chance);
    state.sentSeq = { rhythm: msg.rhythm, melody: msg.melody };
    emit({ t: 'seq', msg, born });               // view: вспышки
  }
  const sendF0 = () => emit({ t: 'f0', hz: effF0() });
  const anyMark = () => seq.melody.steps.some(Boolean);

  // пустое второе кольцо не должно глушить первое: удары без мест — все места в последнюю точку, места без ударов — удар на каждом шаге
  function fillMelody() {
    if (!anyMark()) for (let i = 0; i < seq.melody.len; i++) seq.melody.steps[i] = { ...state.lastHit };
  }
  function fillRhythm() {
    if (!seq.rhythm.steps.some(Boolean)) for (let i = 0; i < seq.rhythm.len; i++) seq.rhythm.steps[i] = { vel: 1 };
  }
  function play(on = !seq.playing) { seq.playing = on; if (!on) seq.rec = false; if (on) state.stepRec = null; go(ACT.PLAY, 0, [on ? 1 : 0]); sendSeq(); }
  function rec(on = !seq.rec) { seq.rec = on; if (on && !seq.playing) play(true); go(ACT.REC, 0, [on ? 1 : 0]); }
  function stepRecToggle() {
    state.stepRec = state.stepRec ? null : { r: 0, m: 0 }; state.cursor = null;
    const sr = state.stepRec;
    go(ACT.STEPREC, 0, [sr ? 1 : 0, sr ? sr.r : 0, sr ? sr.m : 0]);
  }
  const setCursor = (i) => { state.cursor = i; go(ACT.CURSOR, 0, [i == null ? -1 : i]); };
  const cycleGrid = () => { state.grid = state.grid === 1 ? 2 : state.grid === 2 ? 4 : 1; go(ACT.GRID, 0, [state.grid]); };   // сетка 1/16 → 1/8 → 1/4

  // ---------- высота = размер пластины ----------
  function applyF0(hz) {
    const s = scale.snap(12 * Math.log2(clamp(hz, F_MIN, F_MAX) / F_MIN));
    plate.f0 = clamp(F_MIN * 2 ** (s / 12), F_MIN, F_MAX);
    sendF0();
    if (anyMark()) sendSeq();                    // ноты едут вместе с пластиной
  }
  function setF0(hz) { applyF0(hz); go(ACT.SET_F0, 0, [hz]); }
  function stepScale(fromSemi, steps) {
    const list = scaleSemis();
    applyF0(F_MIN * 2 ** (list[clamp(nearestIdx(list, fromSemi) + steps, 0, list.length - 1)] / 12));
    go(ACT.STEP_SCALE, 0, [fromSemi, steps]);
  }

  // ---------- удары: живой по пластине, по метке места ----------
  // живой удар (тап по пластине): звук, запись игрой, запись по шагам, пошаговый ввод; null — клетка за 1760 Гц молчит.
  // Привязку к шагу при записи игрой делает ядро (по своим часам) — now и last не нужны; запись игрой — в узор приходит из зеркала
  function strikeAt(p, now, last) {
    const note = notesOf([p])[0];
    if (note == null) return null;
    state.lastStrike = { t: 'strike', x: p.x, y: p.y, vel: 1, hard: 0.5, hz: F_MIN * 2 ** (note / 12), rec: seq.rec && seq.playing };
    state.lastHit = { x: p.x, y: p.y };
    go(ACT.STRIKE_AT, 0, [p.x, p.y]);
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
  function markStrike(i) {                       // тап по метке места звучит сразу (уровень пластины, без записи и отзыва резонатора)
    const st = seq.melody.steps[i], note = notesOf([st])[0];
    if (note != null) emit({ t: 'strike', msg: { t: 'strike', x: st.x, y: st.y, vel: 1, hard: 0.5, hz: F_MIN * 2 ** (note / 12) } });
  }
  function skipStep() {                          // запись по шагам: тап мимо пластины — пауза, курсоры дальше
    const sr = state.stepRec;
    seq.rhythm.steps[sr.r] = null; sr.r = (sr.r + 1) % seq.rhythm.len; sr.m = (sr.m + 1) % seq.melody.len; go(ACT.SKIP); sendSeq();
  }

  // ---------- правка узора: кольца, метки, поворот ----------
  function setBpm(bpm) { seq.bpm = bpm; go(ACT.BPM, 0, [bpm]); sendSeq(); }
  function setLen(ring, len) { if (len !== seq[ring].len) { seq[ring].len = len; go(ACT.LEN, ring === 'rhythm' ? 0 : 1, [len]); sendSeq(); } }   // у каждого кольца своя длина
  function setChance(i, ch) { const st = seq.rhythm.steps[i]; if (st && ch !== (st.chance ?? 1)) { st.chance = ch; go(ACT.CHANCE_AT, i, [ch]); sendSeq(); } }
  function toggleBeat(i) { seq.rhythm.steps[i] = seq.rhythm.steps[i] ? null : { vel: 1 }; fillMelody(); go(ACT.BEAT, i); sendSeq(); }
  function nudgeNote(i, ci, steps) {             // бусина: место переезжает в клетку на steps ступеней от ci
    const st = seq.melody.steps[i];
    if (!st) return;
    const list = noteList(), b = nearestIdx(list, fs()), n = degPerOct(), top = Math.min(b + 3 * n, list.length) - 1;
    const cl = cellOf(clamp(ci + steps, b, top), b, n), p = cellCenter(cl.ring, cl.sector, n);
    if (p.x !== st.x || p.y !== st.y) { st.x = p.x; st.y = p.y; go(ACT.NUDGE, i, [ci, steps]); sendSeq(); }
  }
  function moveMark(i, x, y) { const st = seq.melody.steps[i]; if (st) { st.x = x; st.y = y; go(ACT.MOVE_MARK, i, [x, y]); sendSeq(); } }
  function dropMark(i) { seq.melody.steps[i] = null; go(ACT.DROP_MARK, i); sendSeq(); }   // за край — место удалено, шаг — пауза
  function comb() { seq.rhythm.steps = quantizeRhythm(seq.rhythm.steps, seq.rhythm.len, state.grid); go(ACT.COMB); sendSeq(); }   // причесать ритм
  const rhyArgs = (steps) => steps.flatMap((st) => (st ? [1, st.vel ?? 1, st.chance ?? 1, st.chance !== undefined ? 1 : 0] : [0, 0, 1, 0]));
  const melArgs = (steps) => steps.flatMap((st) => (st ? [1, st.x, st.y] : [0, 0, 0]));
  // поворот на k: кольцо — сдвиг его узора от orig, пластина — каждое место на k ступеней (k = 0 — места как были)
  function turn(target, orig, k) {
    if (target === 'rhythm') seq.rhythm.steps = rotateSteps(orig.r, seq.rhythm.len, k);
    else if (target === 'melody') seq.melody.steps = rotateSteps(orig.m, seq.melody.len, k);
    else {
      const list = noteList();
      seq.melody.steps = k ? transposeHits(orig.m, k, nearestIdx(list, fs()), degPerOct(), list) : orig.m.slice();
    }
    go(ACT.TURN, target === 'rhythm' ? 0 : target === 'melody' ? 1 : 2, [k, ...(target === 'rhythm' ? rhyArgs(orig.r) : melArgs(orig.m))]);
    sendSeq();
  }

  // ---------- луна (считает ядро) ----------
  function toggleDrift() { drift.on = !drift.on; drift.k = 0; go(ACT.DRIFT_TOGGLE); sendF0(); sendSeq(); }
  function setDrift(k, t) { drift[k] = t; drift.on = true; go(ACT.DRIFT_SET, DRIFT_KEYS.indexOf(k), [t]); }

  // ---------- закреплённые смычки (выключены во view флагом BOWS_ON): в ядре; гнездо — по порядку списка, у фасада тот же порядок ----------
  const BOWS_MAX = 6;                            // MAX_PBOWS ядра
  const bowSet = (b) => { const i = plate.bows.indexOf(b); if (i >= 0) go(ACT.BOW_SET, i, [b.x, b.y, b.exciter, b.pressure, b.amp]); };
  function addBow(x, y) { if (plate.bows.length >= BOWS_MAX) return null; const b = { id: `b${bowId++}`, x, y, exciter: 0, pressure: 0.5, amp: 0.8 }; plate.bows.push(b); go(ACT.BOW_ADD, 0, [x, y]); return b; }
  function moveBow(b, x, y) { b.x = x; b.y = y; bowSet(b); }
  function setBow(b, patch) { Object.assign(b, patch); bowSet(b); }
  function dropBow(b) { const i = plate.bows.indexOf(b); if (i < 0) return; go(ACT.BOW_DROP, i); plate.bows.splice(i, 1); }
  // живой смычок под пальцем: id — палец
  const bowStart = (id, x, y) => emit({ t: 'bow', msg: { t: 'bow', id, x, y, on: true, exciter: 0, pressure: 0.5, amp: 0.8 } });
  const bowMove = (id, x, y) => emit({ t: 'bow', msg: { t: 'bow', id, x, y, on: true } });
  const bowOff = (id) => emit({ t: 'bow', msg: { t: 'bow', id, on: false } });

  // ---------- веер FX: пластина и пространство ----------
  const echoDiv = () => ECHO_DIVS[Math.round(plate.fx.time * (ECHO_DIVS.length - 1))];
  const echoSec = () => (echoDiv()[1] * 60) / seq.bpm;
  const echoFb = () => 0.35 + 0.45 * plate.fx.echo;   // больше эха — дольше тянутся повторы
  function setFx(k, t) {
    plate.fx[k] = t; go(ACT.SET_FX, FX_KEYS.indexOf(k), [t]);
    if (k === 'chance') sendSeq(); else if (k === 'hall' || k === 'echo' || k === 'time') emit({ t: 'fx' }); else emit({ t: 'params' });
  }
  function loadFx(o) {
    Object.assign(plate.fx, { chance: 1 }, o); go(ACT.LOAD_FX, 0, FX_KEYS.map((k) => plate.fx[k]));
    emit({ t: 'params' }); emit({ t: 'fx' }); sendSeq();
  }

  // ---------- патч ----------
  function dice() {                              // генеративный узор: ритм по Евклиду, мелодия другой длины по ладу — полиритм; часы идут
    const seed = Math.floor(rng() * 4294967296) >>> 0;
    go(ACT.DICE, 0, [seed]);                     // ядро считает по тому же зерну тот же узор
    const R = mulberry32(seed), n = 8 + Math.floor(R() * 9), k = 3 + Math.floor(R() * (n - 4)), e = euclid(k, n);
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
    plate.bows = [];
    seq.rhythm.steps.fill(null); seq.melody.steps.fill(null);
    go(ACT.CLEAR); sendSeq();
  }
  const snapshot = () => JSON.stringify({
    f0: r4(plate.f0),
    fx: Object.fromEntries(Object.entries(plate.fx).map(([k, v]) => [k, r4(v)])),
    bows: plate.bows.map((b) => ({ x: r4(b.x), y: r4(b.y), exciter: r4(b.exciter), pressure: r4(b.pressure), amp: r4(b.amp) })),
    seq: { bpm: seq.bpm, rhythm: seq.rhythm, melody: seq.melody },
    drift: { on: drift.on, depth: drift.depth, rate: drift.rate, shape: drift.shape },
  });
  function restore(js) {                         // как прежняя модель — здесь; в ядро — одним restore (там то же самое)
    const st = JSON.parse(js);
    plate.f0 = st.f0; Object.assign(plate.fx, { chance: 1 }, st.fx);
    if (st.drift) Object.assign(drift, st.drift); drift.k = 0; state.stepRec = null;
    plate.bows = st.bows.slice(0, BOWS_MAX).map((b) => ({ ...b, id: `b${bowId++}` }));
    seq.bpm = st.seq.bpm;
    seq.rhythm = { len: st.seq.rhythm.len, steps: st.seq.rhythm.steps.slice() };
    seq.melody = { len: st.seq.melody.len, steps: st.seq.melody.steps.slice() };
    at = post({ t: 'restore', slot: SLOT, js });
    sendF0(); emit({ t: 'params' }); emit({ t: 'fx' }); sendSeq();
  }
  function load(o) {                             // готовый узор (рендер, отладка)
    const pad = (a) => Array.from({ length: SLOTS }, (_, i) => (a[i] === undefined ? null : a[i]));
    if (o.bpm) seq.bpm = o.bpm;
    if (o.rhythm) seq.rhythm = { len: o.rhythm.len, steps: pad(o.rhythm.steps) };
    if (o.melody) seq.melody = { len: o.melody.len, steps: pad(o.melody.steps) };
    if (o.fx) loadFx(o.fx);
    go(ACT.LOAD, 0, [seq.bpm, seq.rhythm.len, seq.melody.len, ...rhyArgs(seq.rhythm.steps), ...melArgs(seq.melody.steps)]);
    sendSeq();
  }
  // без касаний и уровня из ядра (их добавляет склейка): смычки или идущие часы с ударами и местами
  const sounding = () => plate.bows.length > 0 || (seq.playing && seq.rhythm.steps.some(Boolean) && seq.melody.steps.some(Boolean));

  // ---------- зеркало ядра → state ----------
  // mb — зеркало ядра (числа; parseModel — bridge.js); applied — сколько сообщений порта ядро уже применило. Что изменилось не здесь
  // (запись игрой, луна) — в state и слушателям (вспышки, эхо); пока у ядра в пути наши действия — не трогаем
  const sameR = (st, q) => (q.on ? !!st && st.vel === q.vel && (st.chance !== undefined) === q.has && (!q.has || st.chance === q.chance) : !st);
  const sameM = (st, q) => (q.on ? !!st && st.x === q.x && st.y === q.y : !st);
  function sync(mb, applied) {
    if (applied < at) return;
    const m = parseModel(mb);
    let patCh = false, fxCh = false, kCh = false;
    if (plate.f0 !== m.f0) { plate.f0 = m.f0; kCh = true; }
    for (const k of FX_KEYS) if (plate.fx[k] !== m.fx[k]) { plate.fx[k] = m.fx[k]; fxCh = true; if (k === 'chance') patCh = true; }
    if (seq.bpm !== m.bpm || seq.playing !== m.playing || seq.rec !== m.rec || seq.rhythm.len !== m.rlen || seq.melody.len !== m.mlen) {
      seq.bpm = m.bpm; seq.playing = m.playing; seq.rec = m.rec; seq.rhythm.len = m.rlen; seq.melody.len = m.mlen; patCh = true;
    }
    for (let i = 0; i < SLOTS; i++) {
      const q = m.rhythm[i], p = m.melody[i];
      if (!sameR(seq.rhythm.steps[i], q)) { seq.rhythm.steps[i] = q.on ? (q.has ? { vel: q.vel, chance: q.chance } : { vel: q.vel }) : null; patCh = true; }
      if (!sameM(seq.melody.steps[i], p)) { seq.melody.steps[i] = p.on ? { x: p.x, y: p.y } : null; patCh = true; }
    }
    for (const k of ['on', 'depth', 'rate', 'shape']) if (drift[k] !== m.drift[k]) drift[k] = m.drift[k];
    if (drift.k !== m.drift.k) { drift.k = m.drift.k; kCh = true; }
    state.grid = m.grid; state.cursor = m.cursor;
    if (!!state.stepRec !== !!m.stepRec || (m.stepRec && (state.stepRec.r !== m.stepRec.r || state.stepRec.m !== m.stepRec.m))) state.stepRec = m.stepRec;
    state.lastHit = { x: m.lastHit.x, y: m.lastHit.y };
    if (kCh) { sendF0(); if (anyMark()) patCh = true; }
    if (fxCh) { emit({ t: 'params' }); emit({ t: 'fx' }); }
    if (patCh) sendSeq();
  }
  function bind(fn) {                            // новый узел ядра (новый контекст): счёт сообщений — заново, сцена — туда целиком
    post = fn;
    at = post({ t: 'restore', slot: SLOT, js: snapshot() });
    if (seq.playing) go(ACT.PLAY, 0, [1]);
    if (seq.rec) go(ACT.REC, 0, [1]);
    go(ACT.GRID, 0, [state.grid]);
    if (state.stepRec) go(ACT.STEPREC, 0, [1, state.stepRec.r, state.stepRec.m]);
    else if (state.cursor != null) go(ACT.CURSOR, 0, [state.cursor]);
  }

  return {
    state, noteList, degPerOct, scaleSemis, effF0, fs, base, notesOf, driftRate, driftDepth, echoDiv, echoSec, echoFb,
    fillMelody, fillRhythm, play, rec, stepRecToggle, setCursor, cycleGrid, setF0, stepScale,
    strikeAt, markStrike, skipStep, setBpm, setLen, setChance, toggleBeat, nudgeNote, moveMark, dropMark, comb, turn,
    toggleDrift, setDrift, addBow, moveBow, setBow, dropBow, bowStart, bowMove, bowOff, setFx, loadFx,
    dice, clear, snapshot, restore, load, sounding,
    tick(dt) {                                   // время — для подписей; луну и смену лада в ядре считает оно само, здесь — вспышки и sentSeq
      state.time += dt;
      if (scaleKey() !== sentKey && anyMark()) sendSeq();
    },
    listen(fn) { listeners.push(fn); },
    sync, bind, onAct(fn) { preAct = fn; },
  };
}
