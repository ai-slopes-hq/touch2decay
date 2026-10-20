// Cymatica — мир II: звучащая пластина Хладни. Тап — удар, держишь — смычок, двойной тап — закреплённый смычок
// (долгое касание метки — кольцо), щипок или колесо — размер пластины, то есть высота. Звук — plate-worklet.js.
// Спека: docs/superpowers/specs/2026-10-20-cymatica-design.md, часть 2.
(() => {
  'use strict';
  const T = window.T2D;
  const VER = (document.currentScript && new URL(document.currentScript.src, location.href).searchParams.get('v')) || '0';

  const F_MIN = 55, F_MAX = 880, F_DEF = 110;
  // смычки (живой — держишь палец, закреплённые — двойной тап, кольцо смычка) выключены: апплет — о полиритмах и модах.
  // Код на месте; вернуть — BOWS_ON = true (тесты смычков в tools/shot.py включатся сами)
  const BOWS_ON = false;
  const BOW_AFTER = 150;                     // мс: дольше держишь — удар переходит в смычок
  const TAP_MS = 250, TAP_MOVE = 12, MARK_R = 18;
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const r4 = (x) => Math.round(x * 1e4) / 1e4;

  // ---------- состояние: высота, пластина (веер FX), закреплённые смычки ----------
  const plate = { f0: F_DEF, fx: { structure: 2 / 7, damping: 0.5, brightness: 0.5, hall: 0.25, echo: 0.15, time: 6 / 8 }, bows: [] };
  let bowId = 1;
  const touches = new Map();                 // палец → касание пластины
  let ringF = null, two = null, lastTap = null, labelUntil = 0, gesture = null, twistLabel = null;

  // ---------- секвенсер: одна последовательность ударов, нота удара — клетка пластины под ним; часы — в worklet ----------
  const SLOTS = 16;
  const seq = {
    bpm: 96, playing: false, rec: false,
    rhythm: { len: 16, steps: Array(SLOTS).fill(null) },   // { x, y, vel } — удар в точку пластины (точка = нота и тембр)
  };
  let lastStep = null, lastHit = { x: 0.3, y: 0 }, grid = 1;   // grid — сетка записи в гнёздах: 1/16, 1/8, 1/4          // последний тик { r, m, atMs }; место последнего удара
  let echoBpm = 0;
  // ноты считаются из мест: размер пластины (щипок) — база раскладки, поэтому щипок транспонирует всю музыку
  const fs = () => 12 * Math.log2(plate.f0 / F_MIN);
  const born = { r: new Float64Array(SLOTS), m: new Float64Array(SLOTS) }, pulse = { r: new Float64Array(SLOTS), m: new Float64Array(SLOTS) };
  const sent = { r: [], m: [] };
  let sentSeq = null;
  function notesOf(steps) {                      // нота каждого удара: полутоны от 55 Гц или null (клетка за пределом)
    const list = noteList(), b = nearestIdx(list, fs()), n = degPerOct();
    return steps.map((st) => (st ? noteAt(st.x, st.y, b, n, list) : null));
  }
  function sendSeq() {
    const now = performance.now(), notes = notesOf(seq.rhythm.steps);   // новое в гнезде — вспышка: видно, куда легло
    for (let i = 0; i < SLOTS; i++) {
      if (seq.rhythm.steps[i] && seq.rhythm.steps[i] !== sent.r[i]) born.r[i] = now;
      if (notes[i] != null && notes[i] !== sent.m[i]) born.m[i] = now;
    }
    sent.r = seq.rhythm.steps.slice(); sent.m = notes;
    // в worklet: мелодия той же длины — ноты ударов; удар в молчащей клетке уходит пустым
    const len = seq.rhythm.len, rhythm = { len, steps: seq.rhythm.steps.map((st, i) => (notes[i] == null ? null : st)) };
    sentSeq = { rhythm, melody: { len, steps: notes } };
    send({ t: 'seq', bpm: seq.bpm, playing: seq.playing, ...sentSeq });
    if (nodes && echoBpm !== seq.bpm) { echoBpm = seq.bpm; applyFx(); }   // эхо идёт за темпом
  }
  // ритм по Евклиду: k ударов на n шагов как можно ровнее, первый — удар
  function euclid(k, n) { return Array.from({ length: n }, (_, i) => (i * k) % n < k); }
  // шаг ритма, ближайший ко времени касания: с последнего тика прошло больше полшага — уже следующий
  function nearestStep(nowMs, stepAtMs, idx, stepMs, len) {
    return (idx + Math.round((nowMs - stepAtMs) / stepMs)) % len;
  }
  // мелодия — случайное блуждание по ступеням (scaleSemis — допустимые полутоны по возрастанию)
  function walkMelody(len, startSemi, scaleSemis) {
    let i = 0;
    for (let k = 1; k < scaleSemis.length; k++) if (Math.abs(scaleSemis[k] - startSemi) < Math.abs(scaleSemis[i] - startSemi)) i = k;
    const out = [];
    for (let n = 0; n < len; n++) {
      out.push(scaleSemis[i]);
      const d = [-2, -1, 1, 2][Math.floor(Math.random() * 4)];
      i = Math.min(scaleSemis.length - 1, Math.max(0, i + d));
    }
    return out;
  }
  // поворот кольца: первые len гнёзд сдвигаются по кругу (i → i + k), остальные — как были
  function rotateSteps(steps, len, k) {
    const out = steps.slice();
    for (let i = 0; i < len; i++) out[(((i + k) % len) + len) % len] = steps[i];
    return out;
  }
  // ---------- раскладка ханга: по кругу — ступени лада (n секторов от верха по часовой), от края к центру — 3 октавы ----------
  // кольца равной площади: край r > √(2/3) — кольцо 0 (ниже), до √(1/3) — 1, центр — 2 (выше); b — индекс ступени пластины в списке
  const NOTE_TOP = 60;                           // 55–1760 Гц
  const RING_R = [0.9, 0.7, 0.33];               // середины колец
  function noteList() {
    const out = [];
    for (let s = 0; s <= NOTE_TOP; s++) if (T.scaleOn ? T.snapSemi(s) === s : [0, 3, 5, 7, 10].includes(s % 12)) out.push(s);
    return out;
  }
  const degPerOct = () => (T.scaleOn && T.scalePCs ? T.scalePCs.length : 5);
  function cellIdx(x, y, b, n) {
    const r = Math.hypot(x, y);
    if (r > 1) return null;
    const ring = r > Math.sqrt(2 / 3) ? 0 : r > Math.sqrt(1 / 3) ? 1 : 2;
    const a = r < 1e-9 ? 0 : (Math.atan2(x, -y) + Math.PI * 2) % (Math.PI * 2);   // в самом центре угла нет — сектор 0
    return b + ring * n + (Math.floor((a / (Math.PI * 2)) * n) % n);
  }
  function noteAt(x, y, b, n, list) {
    const i = cellIdx(x, y, b, n);
    return i == null || i >= list.length ? null : list[i];
  }
  function cellOf(idx, b, n) {
    const k = idx - b;
    return k < 0 || k >= 3 * n ? null : { ring: Math.floor(k / n), sector: k % n };
  }
  function cellCenter(ring, sector, n) {
    const a = ((sector + 0.5) / n) * Math.PI * 2, r = RING_R[ring];
    return { x: r * Math.sin(a), y: -r * Math.cos(a) };
  }
  // поворот пластины: каждый удар — на k ступеней, в середину клетки новой ноты (в пределах колец)
  function transposeHits(steps, k, b, n, list) {
    const top = Math.min(b + 3 * n, list.length) - 1;
    return steps.map((st) => {
      if (!st) return st;
      const i = cellIdx(st.x, st.y, b, n);
      if (i == null) return st;
      const c = cellOf(clamp(i + k, b, top), b, n), p = cellCenter(c.ring, c.sector, n);
      return { ...st, x: p.x, y: p.y };
    });
  }
  // два пальца: поворот или щипок — что изменилось сильнее (угол через ±180° — в градусах, расстояние — в px)
  function twistOrPinch(a0, a1, d0, d1) {
    const dA = Math.abs(((((a1 - a0) * 180) / Math.PI + 540) % 360) - 180), dD = Math.abs(d1 - d0);
    if (dA < 10 && dD < 20) return null;
    return dA / 10 >= dD / 20 ? 'twist' : 'pinch';
  }
  // сетка записи: ближайшая доля (кратная g гнёзд) по кругу длины; при равенстве — вперёд
  function snapToGrid(i, g, len) {
    let best = 0, bd = 1e9;
    for (let c = 0; c < len; c += g) {
      const d = Math.min(Math.abs(c - i), len - Math.abs(c - i));
      if (d < bd || (d === bd && c > i)) { bd = d; best = c; }
    }
    return best;
  }
  // причесать ритм: удары — на ближайшие доли сетки; в занятое гнездо встаёт первый, гнёзда за длиной не трогаются
  function quantizeRhythm(steps, len, g) {
    const out = steps.slice();
    for (let i = 0; i < len; i++) out[i] = null;
    for (let i = 0; i < len; i++) { const j = snapToGrid(i, g, len); if (steps[i] && !out[j]) out[j] = steps[i]; }
    return out;
  }
  // ступени для кубика: лад, если включён, иначе пентатоника; 0–48 полутонов от 55 Гц
  function scaleSemis() {
    const out = [];
    for (let s = 0; s <= 48; s++) if (T.scaleOn ? T.snapSemi(s) === s : [0, 3, 5, 7, 10].includes(s % 12)) out.push(s);
    return out;
  }
  // записать удар игрой: в ближайший шаг ритма
  function recordHit(x, y) {
    lastHit = { x, y };
    if (!seq.rec || !seq.playing || !lastStep) return;
    const i = nearestStep(performance.now(), lastStep.atMs, lastStep.r, 60000 / seq.bpm / 4, seq.rhythm.len);
    seq.rhythm.steps[snapToGrid(i, grid, seq.rhythm.len)] = { x, y, vel: 1 };
    sendSeq();
  }
  function play(on = !seq.playing) { seq.playing = on; if (!on) seq.rec = false; sendSeq(); }
  function rec(on = !seq.rec) { seq.rec = on; if (on && !seq.playing) play(true); }
  let energy = new Float32Array(24), level = 0;

  // ---------- звук: worklet, зал и эхо; пока узел грузится, сообщения ждут в очереди ----------
  let node = null, ready = false, nodes = null, actx = null, entered = false, started = false;
  const queue = [];
  function send(msg) { if (ready) node.port.postMessage(msg); else queue.push(msg); }
  function sendParams() {
    const { structure, damping, brightness } = plate.fx;
    send({ t: 'params', structure, damping, brightness });
  }
  function applyFx() {
    if (!nodes) return;
    const t = T.ctx.currentTime;
    nodes.hallSend.gain.setTargetAtTime(plate.fx.hall * plate.fx.hall * 1.4, t, 0.05);
    nodes.echoSend.gain.setTargetAtTime(plate.fx.echo * 0.8, t, 0.05);
    const cur = echoes[echoes.length - 1];
    if (cur) for (const f of cur.fb) f.gain.setTargetAtTime(echoFb(), t, 0.05);
    retime();
  }
  // эхо: на каждую долю — своя пара линий крест-накрест. Сменил долю или темп — звук идёт в новую пару с точным временем,
  // старая больше не принимает и дозванивает своим (время задержки не едет — нет скрежета); живёт до 6 с, не больше 4 пар
  let echoes = [], echoAt = 0, echoTimer = 0;
  function echoPair(sec) {
    const ctx = actx, g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const inp = g(0), dL = ctx.createDelay(3), dR = ctx.createDelay(3), merge = ctx.createChannelMerger(2), outG = g(1);
    dL.delayTime.value = dR.delayTime.value = sec;
    const lp = (n) => { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 3000; n.connect(f); return f; };
    const fb = [g(echoFb()), g(echoFb())], fL = lp(dL), fR = lp(dR);
    inp.connect(dL); fL.connect(fb[0]).connect(dR); fR.connect(fb[1]).connect(dL);
    dL.connect(merge, 0, 0); dR.connect(merge, 0, 1); merge.connect(outG).connect(nodes.out);
    nodes.echoSend.connect(inp);
    inp.gain.setTargetAtTime(1, ctx.currentTime, 0.01);
    return { sec, inp, dL, dR, fb, outG, all: [inp, dL, dR, merge, outG, fL, fR, ...fb] };
  }
  function dropPair(p, fade) {
    const i = echoes.indexOf(p);
    if (i >= 0) echoes.splice(i, 1);
    if (p.gone) return;
    p.gone = true; clearTimeout(p.timer);
    p.inp.gain.setTargetAtTime(0, actx.currentTime, 0.01);
    p.outG.gain.setTargetAtTime(0, actx.currentTime, fade);
    setTimeout(() => { for (const n of p.all) n.disconnect(); }, fade * 6000);
  }
  function retime() {
    if (!nodes) return;
    const cur = echoes[echoes.length - 1], sec = echoSec(), now = performance.now();
    if (cur && Math.abs(cur.sec - sec) < 1e-4) return;
    clearTimeout(echoTimer);
    if (cur && now - echoAt < 90) { echoTimer = setTimeout(retime, 90 - (now - echoAt)); return; }   // тянешь луч или темп — не чаще 11 раз в секунду
    echoAt = now;
    if (cur) {
      cur.inp.gain.setTargetAtTime(0, actx.currentTime, 0.01);
      cur.timer = setTimeout(() => dropPair(cur, 0.3), 6000);
    }
    while (echoes.length >= 4) dropPair(echoes[0], 0.02);
    echoes.push(echoPair(sec));
  }
  function build(ctx, input) {
    const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const out = g(2.5);                          // +8 дБ: пластина вровень с планетами Tenebrae (пики ловит общий ограничитель)
    out.connect(input);
    // зал — общий с Tenebrae по устройству, свой экземпляр; хвост 4 с
    const h = T.hall(), hallSend = g(0);
    for (const l of h.lines) l.g.gain.value = 10 ** ((-3 * l.len) / 4);
    hallSend.connect(h.input); h.out.connect(g(0.9)).connect(out);
    const echoSend = g(0);                       // эхо — пары линий в retime(), доля темпа с луча time (1/4d на 40 BPM — 2.25 с)
    nodes = { out, hallSend, echoSend };
    actx = ctx; echoes = [];                     // новый звуковой контекст — пары эха заводятся заново
    applyFx();
    if (entered) start();
    send({ t: 'f0', hz: plate.f0 });
    sendParams();
    for (const b of plate.bows) sendBow(b, true);
  }
  // модуль пластины — только когда в Cymatica впервые зашли и звук уже есть: тем, кто играет лишь в Tenebrae, он ничего не стоит
  function start() {
    if (started || !actx) return;
    started = true;
    const ctx = actx;
    ctx.audioWorklet.addModule(`plate-worklet.js?v=${VER}`).then(() => {
      node = new AudioWorkletNode(ctx, 'plate', { numberOfInputs: 0, outputChannelCount: [2] });
      node.connect(nodes.out); node.connect(nodes.hallSend); node.connect(nodes.echoSend);
      node.port.onmessage = (e) => onMsg(e.data);
      ready = true;
      for (const m of queue.splice(0)) node.port.postMessage(m);
    });
  }
  function onMsg(d) {
    if (d.t === 'step') {                        // играет шаг — его удар и нота мигают
      const now = performance.now();
      lastStep = { r: d.r, m: d.r, atMs: now };
      if (seq.rhythm.steps[d.r]) pulse.r[d.r] = pulse.m[d.r] = now;
      return;
    }
    if (d.t === 'energy') { energy = d.e; level = d.voices.reduce((s, v) => s + v.level, 0); updateField(); }
    else if (d.t === 'shapes') shapes = d;
  }
  let shapes = null;                         // формы мод на сетке — для песка

  // ---------- песок Хладни: где пластина колеблется — крупинки скачут, в узлах — оседают ----------
  const SAND = 2500, GN = 96, SAND_STEP = 0.06;
  const sand = { x: new Float32Array(SAND), y: new Float32Array(SAND) };
  for (let i = 0; i < SAND; i++) {           // поначалу ровным слоем по кругу
    const r = Math.sqrt(Math.random()), a = Math.random() * Math.PI * 2;
    sand.x[i] = r * Math.cos(a); sand.y[i] = r * Math.sin(a);
  }
  let field = null, quiet = true;
  // поле колебаний A = √(Σ w_k·φ_k²) на сетке, нормировано по максимуму; в тишине не пересчитывается.
  // Вес моды — квадрат её энергии: фигуру, как на настоящей пластине, рисуют главные моды, слабые её не размывают
  function updateField() {
    if (!shapes) return;
    let tot = 0;
    for (let k = 0; k < 24; k++) tot += energy[k];
    quiet = tot < 1e-6;
    if (quiet) return;
    const n2 = GN * GN, grid = shapes.grid;
    if (!field) field = new Float32Array(n2);
    field.fill(0);
    let top = 0;
    for (let k = 0; k < 24; k++) top = Math.max(top, energy[k]);
    for (let k = 0; k < 24; k++) {
      const ek = (energy[k] / top) ** 2;
      if (ek < 1e-4) continue;
      for (let i = 0, o = k * n2; i < n2; i++) { const s = grid[o + i]; field[i] += ek * s * s; }
    }
    let mx = 0;
    for (let i = 0; i < n2; i++) { field[i] = Math.sqrt(field[i]); if (field[i] > mx) mx = field[i]; }
    if (mx > 0) for (let i = 0; i < n2; i++) field[i] /= mx;
  }
  function fieldAt(x, y) {
    const ix = Math.floor(((x + 1) / 2) * GN), iy = Math.floor(((y + 1) / 2) * GN);
    return ix < 0 || iy < 0 || ix >= GN || iy >= GN ? 0 : field[iy * GN + ix];
  }
  function stepSand(dt) {
    if (quiet || !field) return;
    const k = SAND_STEP * Math.min(3, dt * 60);
    for (let i = 0; i < SAND; i++) {
      const s = fieldAt(sand.x[i], sand.y[i]) * k, a = Math.random() * Math.PI * 2;
      const x = sand.x[i] + Math.cos(a) * s, y = sand.y[i] + Math.sin(a) * s;
      if (x * x + y * y < 1) { sand.x[i] = x; sand.y[i] = y; }   // за край не уходит
    }
  }
  function drawSand(g) {
    const c = T.g;
    c.fillStyle = T.ink(0.75);
    for (let i = 0; i < SAND; i++) c.fillRect(g.cx + sand.x[i] * g.r - 0.65, g.cy + sand.y[i] * g.r - 0.65, 1.3, 1.3);
  }
  function sendBow(b, on) { send({ t: 'bow', id: b.id, x: b.x, y: b.y, on, exciter: b.exciter, pressure: b.pressure, amp: b.amp }); }

  // ---------- высота = размер пластины ----------
  function setF0(hz) {
    const s = T.snapSemi(12 * Math.log2(clamp(hz, F_MIN, F_MAX) / F_MIN));
    plate.f0 = clamp(F_MIN * 2 ** (s / 12), F_MIN, F_MAX);
    labelUntil = performance.now() + 1000;
    send({ t: 'f0', hz: plate.f0 });
    if (seq.rhythm.steps.some(Boolean)) sendSeq();   // ноты едут вместе с пластиной
  }
  // щипок: ход пальцев линейный — без лада 12 px на полутон, с ладом 18 px на ступень (лишних ступеней нет, не застревает)
  const PX_SEMI = 12, PX_DEG = 18;
  let shownF0 = F_DEF, wheelAcc = 0;
  function nearestIdx(list, s) {
    let j = 0;
    for (let i = 1; i < list.length; i++) if (Math.abs(list[i] - s) < Math.abs(list[j] - s)) j = i;
    return j;
  }
  function stepScale(fromSemi, steps) {
    const list = scaleSemis();
    setF0(F_MIN * 2 ** (list[clamp(nearestIdx(list, fromSemi) + steps, 0, list.length - 1)] / 12));
  }
  function pinchTo(f00, dd) {
    if (!T.scaleOn) { setF0(f00 * 2 ** (-dd / PX_SEMI / 12)); return; }
    stepScale(12 * Math.log2(f00 / F_MIN), Math.round(-dd / PX_DEG));
  }
  const NOTES = ['A', 'A♯', 'B', 'C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯'];
  function noteName(hz) {
    const s = Math.round(12 * Math.log2(hz / F_MIN));
    return NOTES[((s % 12) + 12) % 12] + (1 + Math.floor((s + 9) / 12));
  }

  // ---------- геометрия: пластина посередине; радиус по высоте: f ∝ 1/r² ----------
  // по высоте — пластина, кольца астролябии над ней (+64), ▶/● под ней (+104): блок по центру между строкой и низом
  function plateGeo() {
    const top = T.topY, bot = T.H - T.safeBot;
    const rMax = Math.max(40, Math.min(T.W / 2 - 64, (bot - top - 176) / 2));
    const cy = top + (bot - top - (2 * rMax + 168)) / 2 + rMax + 64;
    return { cx: T.W / 2, cy, rMax, r: rMax * Math.sqrt(F_MIN / shownF0) };   // размер едет плавно к высоте
  }
  const toPlate = (f, g) => ({ x: (f.x - g.cx) / g.r, y: (f.y - g.cy) / g.r });
  const fromPlate = (b, g) => ({ x: g.cx + b.x * g.r, y: g.cy + b.y * g.r });
  function bowAt(f, g) {
    for (const b of plate.bows) { const p = fromPlate(b, g); if (Math.hypot(f.x - p.x, f.y - p.y) < MARK_R) return b; }
    return null;
  }

  // ---------- астролябия: кольцо мелодии (внутри) и ритма (снаружи), 16 гнёзд от верха по часовой; внизу ▶ и ● ----------
  // кольцо мелодии R1 — ноты сидят на нём, как бусины; кольцо ритма R2 — удары на нём; граница зон между ними — RM
  function astro(g) { return { R1: g.rMax + 22, R2: g.rMax + 48, RM: g.rMax + 35, ty: g.cy + g.rMax + 82, playX: g.cx - 60, recX: g.cx, gridX: g.cx + 60 }; }
  const slotAng = (i) => -Math.PI / 2 + (i * Math.PI * 2) / SLOTS;
  const slotXY = (g, i, R) => ({ x: g.cx + R * Math.cos(slotAng(i)), y: g.cy + R * Math.sin(slotAng(i)) });
  const slotOf = (f, g) => ((((Math.atan2(f.y - g.cy, f.x - g.cx) + Math.PI / 2) / (Math.PI * 2)) * SLOTS) % SLOTS + SLOTS) % SLOTS;
  let bpmUntil = 0, noteEdit = null;            // подписи — только пока правишь
  function astroHit(f, g) {
    const A = astro(g), d = Math.hypot(f.x - g.cx, f.y - g.cy);
    if (Math.hypot(f.x - A.playX, f.y - A.ty) < 22) return { k: 'play' };
    if (Math.hypot(f.x - A.recX, f.y - A.ty) < 22) return { k: 'rec' };
    if (Math.hypot(f.x - A.gridX, f.y - A.ty) < 22) return { k: 'grid' };
    const s = slotOf(f, g), ring = d >= A.RM && d < A.R2 + 14 ? 'rhythm' : d >= A.R1 - 14 && d < A.RM ? 'melody' : null;
    if (ring) {                                  // край заливки длины кольца (между гнёздами) — тянуть по кругу
      const e = Math.abs(((s - (seq.rhythm.len - 0.5)) % SLOTS + SLOTS + SLOTS / 2) % SLOTS - SLOTS / 2);
      if (e < 0.3) return { k: 'len', ring };
    }
    const i = Math.round(s) % SLOTS;
    if (ring === 'rhythm') return { k: 'rtick', i };
    if (ring === 'melody') {                     // бусина — нота удара этого шага: её клетка
      const st = seq.rhythm.steps[i];
      return { k: 'mtick', i, r0: d, ci: st ? cellIdx(st.x, st.y, nearestIdx(noteList(), fs()), degPerOct()) : null };
    }
    return null;
  }
  function astroMove(f, g) {
    const h = f.astro;
    if (h.k === 'play' && f.moved) {             // зажал ▶ и ведёшь — темп
      const bpm = Math.round(clamp(f.bpm0 + (f.x - f.x0) * 0.5, 40, 200));
      if (bpm !== seq.bpm) { seq.bpm = bpm; sendSeq(); }
      bpmUntil = performance.now() + 1000;
    } else if (h.k === 'len') {
      const len = Math.round(clamp(slotOf(f, g) + 0.5, 1, SLOTS));
      if (len !== seq.rhythm.len) { seq.rhythm.len = len; sendSeq(); }   // длина одна на оба кольца
    } else if (h.k === 'mtick' && f.moved && h.ci != null) {   // бусину — от центра выше, к центру ниже на ступени; удар переезжает в клетку ноты
      const st = seq.rhythm.steps[h.i];
      if (!st) return;
      const list = noteList(), b = nearestIdx(list, fs()), n = degPerOct(), top = Math.min(b + 3 * n, list.length) - 1;
      const steps = Math.round((Math.hypot(f.x - g.cx, f.y - g.cy) - h.r0) / 6);
      const cl = cellOf(clamp(h.ci + steps, b, top), b, n), p = cellCenter(cl.ring, cl.sector, n);
      if (p.x !== st.x || p.y !== st.y) { st.x = p.x; st.y = p.y; sendSeq(); }
      noteEdit = { i: h.i, until: performance.now() + 1000 };
    }
  }
  function astroUp(f) {
    const h = f.astro;
    if (h.k === 'grid' && !f.combed) grid = grid === 1 ? 2 : grid === 2 ? 4 : 1;   // тап — сетка 1/16 → 1/8 → 1/4
    if (h.k === 'play' && !f.moved) { cursor = null; play(); }
    else if (h.k === 'rec') { cursor = null; rec(); }
    else if (h.k === 'rtick') { seq.rhythm.steps[h.i] = seq.rhythm.steps[h.i] ? null : { ...lastHit, vel: 1 }; sendSeq(); }
    else if (h.k === 'mtick' && !f.moved && !seq.playing) cursor = h.i % seq.rhythm.len;   // часы стоят — курсор пошагового ввода туда   // тап по гнезду мелодии — курсор пошагового ввода туда
  }
  // пошаговый ввод: курсор появляется тапом по гнезду кольца мелодии (часы стоят); тап по пластине пишет удар в гнездо
  // курсора и двигает его дальше; ▶, ● или тап мимо пластины и колец — курсор убран
  let cursor = null, lastStrike = null;
  function drawCursor(g) {
    if (cursor == null || seq.playing) return;
    const A = astro(g), i = cursor % seq.rhythm.len, p = slotXY(g, i, A.R1);
    T.ring(p.x, p.y, 15, 0.9, 1.6);
    T.mapText(`step ${i + 1} / ${seq.rhythm.len}`, A.playX - 62, A.ty, 13, 0.7, 'center');
  }
  // метка записанного удара на пластине
  function markAt(f, g) {
    for (let i = 0; i < SLOTS; i++) {
      const st = seq.rhythm.steps[i];
      if (!st) continue;
      const p = fromPlate(st, g);
      if (Math.hypot(f.x - p.x, f.y - p.y) < 11) return i;
    }
    return -1;
  }

  // ---------- вращение: кольца — сдвиг узора, пластина — транспонирование; два пальца или Shift-мышь ----------
  const wrapDeg = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
  const origOf = () => ({ r: seq.rhythm.steps.slice() });
  // что крутим — по расстоянию от центра пластины (у двух пальцев — среднее: оно не меняется при повороте), с запасом:
  // внутри стола — пластина, до границы зон между кольцами — мелодия, всё дальше — ритм
  function twistTarget(d, g) {
    const A = astro(g);
    return d < g.rMax ? 'plate' : d < A.RM ? 'melody' : 'rhythm';
  }
  function startTwo(o, f, g) {
    if (o.bowing) { send({ t: 'bow', id: o.bid, on: false }); o.bowing = false; }   // смычок первого пальца гаснет
    o.live = false; o.astro = null; o.mk = null; o.cb = null;
    touches.set(f.id, f);
    o.two = f.two = true;
    two = {
      a: o, b: f, a0: Math.atan2(f.y - o.y, f.x - o.x), d0: Math.max(20, Math.hypot(f.x - o.x, f.y - o.y)),
      kind: null, target: twistTarget((Math.hypot(o.x - g.cx, o.y - g.cy) + Math.hypot(f.x - g.cx, f.y - g.cy)) / 2, g),
      f00: plate.f0, orig: origOf(), deg: 0, k: 0,
    };
    two.last = two.a0;
  }
  function moveTwo(g) {
    const t = two, a1 = Math.atan2(t.b.y - t.a.y, t.b.x - t.a.x), d1 = Math.max(20, Math.hypot(t.b.x - t.a.x, t.b.y - t.a.y));
    if (!t.kind) { t.kind = twistOrPinch(t.a0, a1, t.d0, d1); if (t.kind) gesture = t.kind; }
    if (t.kind === 'pinch') pinchTo(t.f00, d1 - t.d0);   // развёл — пластина больше и ниже
    if (t.kind !== 'twist' || !t.target) return;
    const dd = wrapDeg(((a1 - t.last) * 180) / Math.PI);
    t.last = a1; t.deg += dd;
    if (t.target === 'plate') rotateSand((dd * Math.PI) / 180);   // песок поворачивается вслед за пальцами
    twistTo(t, t.target, t.deg, (t.a.x + t.b.x) / 2, (t.a.y + t.b.y) / 2);
  }
  // поворот относительно начала жеста: кольца — 22.5° на гнездо, пластина — 20° на ступень лада (по часовой — вперёд/вверх)
  const ringTurn = { melody: 0, rhythm: 0 }, ringOrn = { melody: 0, rhythm: 0 };   // ringOrn — накопленный поворот узора кольца    // остаток поворота кольца в градусах — кольцо идёт за пальцами, отпустил — встаёт в гнездо
  function twistTo(t, target, deg, x, y) {
    const k = Math.round(deg / (target === 'plate' ? 20 : 22.5));
    if (target !== 'plate') ringTurn.melody = ringTurn.rhythm = deg - k * 22.5;   // кольца — одна последовательность, крутятся вместе
    twistLabel = { text: `${k > 0 ? '+' : ''}${k}`, x, y, until: performance.now() + 1000 };
    if (k === t.k) return;
    t.k = k;
    if (target !== 'plate') seq.rhythm.steps = rotateSteps(t.orig.r, seq.rhythm.len, k);
    else {                                       // пластина: каждый удар — на k ступеней; вернул в ноль — места как были
      const list = noteList();
      seq.rhythm.steps = k ? transposeHits(t.orig.r, k, nearestIdx(list, fs()), degPerOct(), list) : t.orig.r.slice();
    }
    sendSeq();
  }
  function endTurn(t) {                          // отпустил — кольцо встаёт в гнездо, его узор остаётся повёрнутым
    if (t.target === 'melody' || t.target === 'rhythm') ringOrn.melody = ringOrn.rhythm = (ringOrn.rhythm + t.k * 22.5) % 360;
    ringTurn.melody = ringTurn.rhythm = 0;
  }
  function rotateSand(a) {
    const c = Math.cos(a), s = Math.sin(a);
    for (let i = 0; i < SAND; i++) { const x = sand.x[i], y = sand.y[i]; sand.x[i] = x * c - y * s; sand.y[i] = x * s + y * c; }
  }

  // ---------- касания ----------
  function down(f, e) {
    const g = plateGeo();
    if (e && e.shiftKey) {                       // Shift + мышь — вращение того, что под курсором
      const target = twistTarget(Math.hypot(f.x - g.cx, f.y - g.cy), g);
      if (target) { touches.set(f.id, f); f.twist1 = { target, last: Math.atan2(f.y - g.cy, f.x - g.cx), deg: 0, orig: origOf(), k: 0 }; return; }
    }
    const h0 = astroHit(f, g);                   // ▶ и ● работают и вторым пальцем — в пару не идут
    if (h0 && (h0.k === 'play' || h0.k === 'rec' || h0.k === 'grid')) { touches.set(f.id, f); f.astro = h0; f.bpm0 = seq.bpm; return; }
    for (const o of touches.values()) {          // второй палец — поворот или щипок (решится по первым ~10° / ~20 px)
      if (o === f || o === ringF || two || o.twist1 || (o.astro && (o.astro.k === 'play' || o.astro.k === 'rec' || o.astro.k === 'grid'))) continue;   // ▶ и ● — не в пару
      startTwo(o, f, g);
      return;
    }
    const h = astroHit(f, g);
    if (h) { touches.set(f.id, f); f.astro = h; f.bpm0 = seq.bpm; return; }
    if (Math.hypot(f.x - g.cx, f.y - g.cy) > g.rMax) { touches.set(f.id, f); f.away = true; return; }   // мимо стола: убирает курсор, второй палец — вращение
    touches.set(f.id, f);
    const b = BOWS_ON ? bowAt(f, g) : null;
    if (b) { f.cb = b; return; }
    const mk = seq.rec ? -1 : markAt(f, g);   // при записи метки не мешают: барабанишь в одну точку — каждый тап пишется
    if (mk >= 0) {                              // тап по метке звучит сразу; повёл — тащишь метку
      f.mk = mk;
      const st = seq.rhythm.steps[mk], note = notesOf([st])[0];
      if (note != null) send({ t: 'strike', x: st.x, y: st.y, vel: 1, hard: 0.5, hz: F_MIN * 2 ** (note / 12) });
      return;
    }
    const p = toPlate(f, g);
    if (Math.hypot(p.x, p.y) > 1) { f.away = true; return; }   // вне пластины (но на столе) — только для щипка
    const note = notesOf([p])[0];
    if (note == null) return;                    // клетка за 1760 Гц — молчит
    f.live = true; f.bid = `t${f.id}`;
    lastStrike = { t: 'strike', x: p.x, y: p.y, vel: 1, hard: 0.5, hz: F_MIN * 2 ** (note / 12), rec: seq.rec && seq.playing };
    send(lastStrike);
    recordHit(p.x, p.y);
    if (cursor != null && !seq.playing) {        // пошаговый ввод: удар — в гнездо курсора, курсор дальше
      const len = seq.rhythm.len;
      seq.rhythm.steps[cursor % len] = { x: p.x, y: p.y, vel: 1 };
      cursor = (cursor % len + 1) % len;
      sendSeq();
    }
  }
  function move(f) {
    if (!touches.has(f.id)) return;
    if (f === ringF) { T.menuMove(f); return; }
    const g = plateGeo();
    if (f.astro) { astroMove(f, g); return; }
    if (f.mk != null && f.moved) {               // метку удара тащишь — место удара меняется
      const st = seq.rhythm.steps[f.mk];
      if (st) { const p = toPlate(f, g); st.x = p.x; st.y = p.y; sendSeq(); }
      return;
    }
    if (f.twist1) {                              // Shift-мышь: угол вокруг центра пластины
      const a = Math.atan2(f.y - g.cy, f.x - g.cx), t = f.twist1;
      t.deg += wrapDeg(((a - t.last) * 180) / Math.PI); t.last = a;
      twistTo(t, t.target, t.deg, f.x, f.y);
      return;
    }
    if (f.two && two) { moveTwo(g); return; }
    if (f.cb && f.moved) { const p = toPlate(f, g); f.cb.x = p.x; f.cb.y = p.y; sendBow(f.cb, true); return; }
    if (f.bowing) { const p = toPlate(f, g); send({ t: 'bow', id: f.bid, x: p.x, y: p.y, on: true }); }
  }
  function up(f) {
    if (!touches.has(f.id)) return;
    touches.delete(f.id);
    const now = performance.now();
    if (f === ringF) { ringF = null; return; }
    if (f.astro) { astroUp(f); return; }
    if (f.mk != null) {
      const st = seq.rhythm.steps[f.mk];
      if (st && f.moved && Math.hypot(st.x, st.y) > 1.05) { seq.rhythm.steps[f.mk] = null; sendSeq(); }   // за край — удар удалён
      return;
    }
    if (f.twist1) { endTurn(f.twist1); return; }
    if (f.two) { if (two && (two.a === f || two.b === f)) { endTurn(two); two = null; } return; }
    if (f.cb) {
      if (Math.hypot(f.cb.x, f.cb.y) > 1.05) {   // утащил за край — смычок убран
        sendBow(f.cb, false);
        plate.bows = plate.bows.filter((b) => b !== f.cb);
      }
      return;
    }
    if (f.away) { cursor = null; return; }
    if (!f.live) return;
    if (f.bowing) send({ t: 'bow', id: f.bid, on: false });
    const tap = now - f.t0 < TAP_MS && Math.hypot(f.x - f.x0, f.y - f.y0) < TAP_MOVE;
    if (!tap) return;
    if (BOWS_ON && lastTap && now - lastTap.t < T.DTAP_MS && Math.hypot(f.x - lastTap.x, f.y - lastTap.y) < 30) {
      lastTap = null;
      if (plate.bows.length >= T.PIN_MAX) return;   // закреплённых уже три
      const p = toPlate(f, plateGeo());
      const b = { id: `b${bowId++}`, x: p.x, y: p.y, exciter: 0, pressure: 0.5, amp: 0.8 };
      plate.bows.push(b);
      sendBow(b, true);
      return;
    }
    lastTap = { t: now, x: f.x, y: f.y };
  }
  // корзина или отмена, пока палец держит метку или кольцо открыто: палец отпускает старый смычок,
  // иначе он снова включил бы в worklet смычок, которого больше нет в plate.bows
  function detach() {
    for (const f of touches.values()) { f.cb = null; if (f === ringF) { f.menu = null; ringF = null; } }
  }
  // кольцо закреплённого смычка — на весу, как веер FX: центр — откат, отпустил — значения остаются
  const BOW_SECTORS = [
    { key: 'exciter', label: 'bow ↔ breath', ang: -Math.PI / 2 },
    { key: 'pressure', label: 'pressure', ang: Math.PI / 6 },
    { key: 'amp', label: 'amp', ang: (5 * Math.PI) / 6 },
  ];
  function openRing(f) {
    const b = f.cb, g = plateGeo(), p = fromPlate(b, g), c = T.ringCenter(p.x, p.y), orig = { ...b };
    f.menu = {
      cx: c.cx, cy: c.cy, gx: f.x, gy: f.y, sector: null, sectors: BOW_SECTORS, span: T.MENU_SPAN, fx: true,
      get: (k) => b[k], set: (k, t) => { b[k] = t; sendBow(b, true); },
      text: (k) => (k === 'exciter' ? (b.exciter < 0.5 ? 'bow' : 'breath') : `${Math.round(b[k] * 100)}%`),
      restore: () => { Object.assign(b, orig); sendBow(b, true); },
    };
    ringF = f;
  }
  // каждый кадр: держишь дольше 150 мс — удар становится смычком; держишь метку — кольцо
  function tick(now) {
    const g = plateGeo();
    for (const f of touches.values()) {
      if (BOWS_ON && f.live && !f.bowing && now - f.t0 > BOW_AFTER) {
        const p = toPlate(f, g);
        f.bowing = true;
        send({ t: 'bow', id: f.bid, x: p.x, y: p.y, on: true, exciter: 0, pressure: 0.5, amp: 0.8 });
      }
      if (f.cb && !f.moved && !f.menu && now - f.t0 > T.HOLD_MS) openRing(f);
      if (f.astro && f.astro.k === 'grid' && !f.combed && !f.moved && now - f.t0 > T.HOLD_MS) {   // зажал сетку — причесать ритм
        f.combed = true;
        seq.rhythm.steps = quantizeRhythm(seq.rhythm.steps, seq.rhythm.len, grid);
        sendSeq();
      }
    }
  }

  // ---------- веер FX: пластина и пространство ----------
  const deg = (d) => (d * Math.PI) / 180;
  // доли эха в четвертях: t — триоль, d — с точкой
  const ECHO_DIVS = [['1/16t', 1 / 6], ['1/16', 1 / 4], ['1/8t', 1 / 3], ['1/16d', 3 / 8], ['1/8', 1 / 2], ['1/4t', 2 / 3], ['1/8d', 3 / 4], ['1/4', 1], ['1/4d', 3 / 2]];
  const echoDiv = () => ECHO_DIVS[Math.round(plate.fx.time * (ECHO_DIVS.length - 1))];
  const echoSec = () => (echoDiv()[1] * 60) / seq.bpm;
  const echoFb = () => 0.35 + 0.45 * plate.fx.echo;   // больше эха — дольше тянутся повторы
  const STRUCT = ['string', 'membrane', 'plate', 'bell', 'bowl', 'handpan', 'marimba', 'kalimba'];   // тела по лучу structure
  const fxw = {
    sectors: [
      { key: 'structure', label: 'structure', ang: deg(180) },
      { key: 'damping', label: 'damping', ang: deg(162) },
      { key: 'brightness', label: 'brightness', ang: deg(144) },
      { key: 'hall', label: 'hall', ang: deg(126) },
      { key: 'echo', label: 'echo', ang: deg(108) },
      { key: 'time', label: 'time', ang: deg(90), marks: ECHO_DIVS.map((d) => d[0]) },
    ],
    get: (k) => plate.fx[k],
    set: (k, t) => { plate.fx[k] = t; if (k === 'hall' || k === 'echo' || k === 'time') applyFx(); else sendParams(); },
    text: (k) => {
      const v = plate.fx[k];
      if (k === 'structure') return STRUCT[Math.round(v * (STRUCT.length - 1))];
      if (k === 'time') return echoDiv()[0];
      if (k === 'damping') { const s = 0.08 * 150 ** v; return `${s.toFixed(s < 10 ? 1 : 0)} s`; }
      return `${Math.round(v * 100)}%`;
    },
    arc: () => plate.fx.hall,
    save: () => ({ ...plate.fx }),
    load: (o) => { Object.assign(plate.fx, o); sendParams(); applyFx(); },
  };

  // ---------- рисование: строгая гравюра, как Tenebrae ----------
  function drawPlate(g) {
    const c = T.g;
    T.ring(g.cx, g.cy, g.rMax, 0.08, 1);               // стол — едва видно, сколько места под щипок
    T.ring(g.cx, g.cy, g.r, 0.55, 1);
    T.ring(g.cx, g.cy, g.r + 3, 0.25, 1);
    c.strokeStyle = T.ink(0.3); c.lineWidth = 1;
    c.beginPath();
    for (let d = 0; d < 360; d += 6) {
      const a = (d * Math.PI) / 180, x = Math.cos(a), y = Math.sin(a);
      c.moveTo(g.cx + x * (g.r + 3), g.cy + y * (g.r + 3)); c.lineTo(g.cx + x * (g.r + 7), g.cy + y * (g.r + 7));
    }
    c.stroke();
  }
  function drawBows(g) {
    const c = T.g;
    // закреплённый смычок — гравированный скрипичный смычок по касательной к пластине: трость, волос, колодочка;
    // волос дрожит, пока звучит; «дыхание» — волос пунктиром
    let e = 0;
    for (let k = 0; k < 24; k++) e += energy[k];
    const shake = Math.min(1, Math.sqrt(e) * 2);
    for (const b of plate.bows) {
      const p = fromPlate(b, g), th = Math.hypot(b.x, b.y) > 0.02 ? Math.atan2(b.y, b.x) : 0;
      c.save(); c.translate(p.x, p.y); c.rotate(th + Math.PI / 2);   // x — вдоль касательной, −y — наружу
      c.strokeStyle = T.BG; c.lineWidth = 5;                          // тёмная подложка — смычок читается поверх песка
      c.beginPath(); c.moveTo(-15, -1); c.quadraticCurveTo(0, -8, 15, -1); c.moveTo(-13, 0.5); c.lineTo(14, 0.5); c.stroke();
      c.strokeStyle = T.ink(0.9); c.lineWidth = 1.3;
      c.beginPath(); c.moveTo(-15, -1); c.quadraticCurveTo(0, -8, 15, -1); c.stroke();   // трость
      c.lineWidth = 1; c.beginPath(); c.moveTo(15, -1); c.lineTo(14, 0.5); c.stroke();   // головка
      c.strokeRect(-16.5, -4, 4, 4.5);                                                   // колодочка
      if (b.exciter >= 0.5) c.setLineDash([1.5, 2]);
      const j = (Math.random() - 0.5) * 2 * shake;
      c.strokeStyle = T.ink(0.7); c.beginPath(); c.moveTo(-13, 0.5); c.lineTo(0, 0.5 + j); c.lineTo(14, 0.5); c.stroke();   // волос
      c.restore();
    }
    for (const f of touches.values()) if (f.bowing) T.ring(f.x, f.y, 26, 0.35, 1);   // живой смычок под пальцем
  }
  function flash(t, x, y, now) {                 // запись в гнездо — расходящийся круг, полсекунды
    const k = (now - t) / 500;
    if (k >= 0 && k < 1) T.ring(x, y, 5 + 16 * k, 0.9 * (1 - k), 1.4);
  }
  // астролябия: двойные кольца с засечками гнёзд, удары ритма — точки, ноты мелодии — засечки внутрь по высоте;
  // стрелки — пока часы идут; выступы длины; ▶/■ и ● внизу; метки ударов на пластине вспыхивают на своём шаге
  function drawAstro(g, now) {
    const c = T.g, A = astro(g), stepMs = 60000 / seq.bpm / 4;
    for (const R of [A.R1, A.R2]) { T.ring(g.cx, g.cy, R, 0.6, 1.1); T.ring(g.cx, g.cy, R + 2.5, 0.2, 1); }
    c.lineWidth = 1;
    const tr = (ringTurn.rhythm * Math.PI) / 180, tm = (ringTurn.melody * Math.PI) / 180;
    // узор колец — шкала, как у лимба астролябии: мелкие деления и звезда-указатель; крутится вместе с кольцом
    for (const [R, o, side] of [[A.R2, ringOrn.rhythm + ringTurn.rhythm, 1], [A.R1 - 11, ringOrn.melody + ringTurn.melody, -1]]) {
      const base = (o * Math.PI) / 180;
      c.strokeStyle = T.ink(0.22); c.lineWidth = 0.8; c.beginPath();
      for (let j = 0; j < 64; j++) {
        const a = base + (j * Math.PI) / 32, l = j % 4 ? 2.5 : 4;
        c.moveTo(g.cx + Math.cos(a) * (R + side * 3), g.cy + Math.sin(a) * (R + side * 3));
        c.lineTo(g.cx + Math.cos(a) * (R + side * (3 + l)), g.cy + Math.sin(a) * (R + side * (3 + l)));
      }
      c.stroke();
      for (let q = 0; q < 1; q++) {                 // звезда-указатель — между гнёздами; показывает, насколько кольцо провернули
        const a = base - Math.PI / 2 + Math.PI / 16 + (side < 0 ? Math.PI : 0), px = g.cx + Math.cos(a) * (R + side * 10), py = g.cy + Math.sin(a) * (R + side * 10);
        const ux = Math.cos(a) * 4 * side, uy = Math.sin(a) * 4 * side, vx = -Math.sin(a) * 2, vy = Math.cos(a) * 2;
        c.strokeStyle = T.ink(0.45); c.beginPath();
        c.moveTo(px - ux, py - uy); c.lineTo(px + vx, py + vy); c.lineTo(px + ux, py + uy); c.lineTo(px - vx, py - vy); c.closePath(); c.stroke();
      }
    }
    for (const [ring, R, w] of [['rhythm', A.R2, 16], ['melody', A.R1, 26]]) {   // длина кольца — заливка от начала до края; край тянется
      const rot = ring === 'rhythm' ? tr : tm, a0 = slotAng(-0.5) + rot, a1 = slotAng(seq.rhythm.len - 0.5) + rot;
      const held = [...touches.values()].some((f) => f.astro && f.astro.k === 'len' && f.astro.ring === ring);
      c.strokeStyle = T.ink(held ? 0.2 : 0.09); c.lineWidth = w;   // рисуется до бусин и точек — под ними
      c.beginPath(); c.arc(g.cx, g.cy, R, a0, a1 - (seq.rhythm.len === SLOTS ? 1e-4 : 0)); c.stroke();
      c.strokeStyle = T.ink(held ? 1 : 0.7); c.lineWidth = held ? 2 : 1.4;   // край заливки — за него тянуть
      c.beginPath(); c.moveTo(g.cx + Math.cos(a1) * (R - w / 2), g.cy + Math.sin(a1) * (R - w / 2)); c.lineTo(g.cx + Math.cos(a1) * (R + w / 2), g.cy + Math.sin(a1) * (R + w / 2)); c.stroke();
      const q = { x: g.cx + Math.cos(a1 + 0.09) * R, y: g.cy + Math.sin(a1 + 0.09) * R };
      T.mapText(String(seq.rhythm.len), q.x, q.y, 12, held ? 1 : 0.6, 'center');
    }
    // ритм: удар — крупная точка, пустое гнездо — колечко; мелодия — название ноты у гнезда, пусто — «·»;
    // играющий шаг мигает (точка и нота вспыхивают), новое в гнезде — расходящийся круг
    const blink = (t) => Math.max(0, 1 - (now - t) / 220), notes = notesOf(seq.rhythm.steps);
    for (let i = 0; i < SLOTS; i++) {
      let a = slotAng(i) + tr, x = Math.cos(a), y = Math.sin(a);
      const onR = i < seq.rhythm.len, onM = onR, st = seq.rhythm.steps[i], s = notes[i];
      const lg = i % grid === 0 ? 7 : 4;          // доли сетки записи — засечки длиннее
      c.strokeStyle = T.ink(onR ? 0.45 : 0.12); c.lineWidth = 1;
      c.beginPath(); c.moveTo(g.cx + x * (A.R2 + 8), g.cy + y * (A.R2 + 8)); c.lineTo(g.cx + x * (A.R2 + 8 + lg), g.cy + y * (A.R2 + 8 + lg)); c.stroke();
      const rx = g.cx + x * A.R2, ry = g.cy + y * A.R2, br = blink(pulse.r[i]);
      if (st && onR) { T.dot(rx, ry, 5.5 + 3 * br, 1); if (br) T.ring(rx, ry, 10 + 6 * (1 - br), br, 1.6); }
      else if (onR) { c.fillStyle = T.BG; c.beginPath(); c.arc(rx, ry, 3.5, 0, Math.PI * 2); c.fill(); T.ring(rx, ry, 3.5, 0.6, 1.1); }
      else T.dot(rx, ry, 1, 0.12);                 // за длиной кольца — гаснет
      flash(born.r[i], rx, ry, now);
      a = slotAng(i) + tm; x = Math.cos(a); y = Math.sin(a);
      const mx = g.cx + x * A.R1, my = g.cy + y * A.R1, bm = blink(pulse.m[i]);
      if (!onM) T.dot(mx, my, 1, 0.12);            // за длиной кольца — гаснет, подписи нет
      else {
        c.fillStyle = 'rgba(0,0,0,0.85)'; c.beginPath(); c.arc(mx, my, 11, 0, Math.PI * 2); c.fill();   // тёмная подложка — читается поверх волн
        if (s != null) T.mapText(noteName(F_MIN * 2 ** (s / 12)), mx, my, 14 + 4 * bm, 1, 'center');
        else T.dot(mx, my, 2, 0.6);
        T.ring(mx, my, 11, 0.25 + 0.75 * bm, 1 + 0.6 * bm);
      }
      flash(born.m[i], mx, my, now);
    }
    if (seq.playing && lastStep) {               // стрелки: от края стола к своему кольцу, плавно между тиками
      const fr = clamp((now - lastStep.atMs) / stepMs);
      for (const [i, R, a] of [[lastStep.r, A.R2 + 6, 0.6], [lastStep.m, A.R1 - 12, 0.45]]) {
        const ang = slotAng(i + fr);
        c.strokeStyle = T.ink(a); c.lineWidth = 0.8;
        c.beginPath(); c.moveTo(g.cx + Math.cos(ang) * (g.rMax + 2), g.cy + Math.sin(ang) * (g.rMax + 2)); c.lineTo(g.cx + Math.cos(ang) * R, g.cy + Math.sin(ang) * R); c.stroke();
      }
    }
    for (let i = 0; i < SLOTS; i++) {            // метки ударов на пластине
      const st = seq.rhythm.steps[i];
      if (!st) continue;
      const p = fromPlate(st, g), hot = seq.playing && lastStep && lastStep.r === i && now - lastStep.atMs < 160;
      if (hot) T.ring(p.x, p.y, 7, 0.9, 1.2);
      T.dot(p.x, p.y, 2.2, i < seq.rhythm.len ? 0.8 : 0.25);
    }
    // ▶/■ и ●
    for (const x of [A.playX, A.recX, A.gridX]) {
      c.fillStyle = 'rgba(0,0,0,0.88)'; c.beginPath(); c.arc(x, A.ty, 18, 0, Math.PI * 2); c.fill();
      T.ring(x, A.ty, 17, 0.45, 1.2);
    }
    c.strokeStyle = T.ink(0.85); c.lineWidth = 1.2; c.beginPath();
    if (seq.playing) c.rect(A.playX - 5, A.ty - 5, 10, 10);
    else { c.moveTo(A.playX - 4, A.ty - 6); c.lineTo(A.playX + 5, A.ty); c.lineTo(A.playX - 4, A.ty + 6); c.closePath(); }
    c.stroke();
    if (seq.rec) T.dot(A.recX, A.ty, 5, 0.95); else T.ring(A.recX, A.ty, 5, 0.6, 1.2);
    T.mapText(String(16 / grid), A.gridX, A.ty, 15, 0.8, 'center');   // сетка записи: 16, 8, 4
    if (now < bpmUntil) T.mapText(`${seq.bpm} BPM`, A.playX, A.ty - 30, 14, 0.85, 'center');
    if (noteEdit && now < noteEdit.until) {      // тянешь засечку мелодии — гнездо обведено, нота у гнезда меняется
      const p = slotXY(g, noteEdit.i, A.R1);
      T.ring(p.x, p.y, 13, 0.9, 1.4);
    }
  }
  function drawTwist(now) {
    if (!twistLabel || now > twistLabel.until) return;
    T.mapText(twistLabel.text, twistLabel.x, twistLabel.y - 44, 16, 0.9 * Math.min(1, (twistLabel.until - now) / 400), 'center');
  }
  function drawLabel(g, now) {
    if (now > labelUntil) return;
    const a = Math.min(1, (labelUntil - now) / 400);
    T.mapText(`${noteName(plate.f0)} · ${Math.round(plate.f0)} Hz`, g.cx, g.cy - g.rMax - 50, 15, 0.85 * a, 'center');
  }
  function drawRingHeld() {
    const f = ringF, m = f.menu;
    T.drawRing({
      cx: m.cx, cy: m.cy, span: m.span, sectors: m.sectors, sel: m.sector ? m.sector.key : null, get: m.get,
      pointer: m.sector ? { x: m.cx + (f.x - m.gx), y: m.cy + (f.y - m.gy) } : null,
      readout: m.sector ? `${m.sector.label} · ${m.text(m.sector.key)}` : null, readoutAt: T.readoutAt(m.cx, m.cy),
    });
  }

  // резонатор Гельмгольца: латунный шар с горлышком, выступает из правого нижнего угла на четверть;
  // настроен на основной тон пластины: звучит мода (0,1) — линии ярче, у горлышка дрожит воздух
  function drawResonator() {
    const g = T.g, x = T.W, y = T.H - T.safeBot, L = Math.min(1, Math.sqrt(energy[0]) * 2), a = 0.45 + 0.4 * L;
    g.fillStyle = T.BG; g.beginPath(); g.arc(x, y, 36, 0, Math.PI * 2); g.fill();
    T.ring(x, y, 34, a, 1);
    T.ring(x, y, 30, a * 0.5, 0.8);
    g.strokeStyle = T.ink(a * 0.35); g.lineWidth = 0.8;   // штриховка дугами — объём шара
    for (let k = 1; k <= 5; k++) { g.beginPath(); g.arc(x + k * 2, y + k * 2, 30 - k * 4, Math.PI, Math.PI * 1.5); g.stroke(); }
    // горлышко — к центру экрана (вверх-влево)
    const dx = -Math.SQRT1_2, dy = -Math.SQRT1_2, px = Math.SQRT1_2, py = -Math.SQRT1_2, w = 5, n0 = 33, n1 = 50;
    g.strokeStyle = T.ink(a); g.lineWidth = 1;
    g.beginPath();
    for (const s of [-1, 1]) { g.moveTo(x + dx * n0 + px * w * s, y + dy * n0 + py * w * s); g.lineTo(x + dx * n1 + px * w * s, y + dy * n1 + py * w * s); }
    g.stroke();
    g.beginPath(); g.ellipse(x + dx * n1, y + dy * n1, w, w * 0.45, Math.atan2(py, px), 0, Math.PI * 2); g.stroke();
    for (let k = 1; k <= 2; k++) {                     // воздух в горлышке — дуги у устья, видны, пока звучит
      if (L < 0.03) break;
      g.strokeStyle = T.ink(L * (0.5 - 0.2 * k)); g.beginPath();
      g.arc(x + dx * n1, y + dy * n1, w + 4 * k, Math.PI * 0.95, Math.PI * 1.55); g.stroke();
    }
  }

  // ---------- фон: волны и интерференция ----------
  // из угла резонатора и из противоположного угла расходятся тонкие круги; шаг — длина волны основного тона пластины
  // (больше пластина, ниже звук — реже). Рисуется один раз и пересобирается, когда высота сместится на полутон
  let wavesC = null, wavesKey = '';
  const waveStep = () => 24 * (F_MIN * 2 ** (Math.round(fs()) / 12) / 110) ** (-1 / 3);
  function wavesLayer() {
    const key = `${T.W}x${T.H}x${T.DPR}|${Math.round(fs())}|${T.topY}|${T.safeBot}`;
    if (wavesC && key === wavesKey) return wavesC;
    wavesKey = key;
    if (!wavesC) wavesC = document.createElement('canvas');
    wavesC.width = Math.round(T.W * T.DPR); wavesC.height = Math.round(T.H * T.DPR);
    const x = wavesC.getContext('2d'), step = waveStep(), far = Math.hypot(T.W, T.H);
    x.setTransform(T.DPR, 0, 0, T.DPR, 0, 0);
    x.fillStyle = T.BG; x.fillRect(0, 0, T.W, T.H);
    x.strokeStyle = T.ink(0.045); x.lineWidth = 0.8;
    for (const [sx, sy] of [[T.W, T.H - T.safeBot], [0, T.topY]]) {
      x.beginPath();
      for (let r = step; r < far; r += step) { x.moveTo(sx + r, sy); x.arc(sx, sy, r, 0, Math.PI * 2); }
      x.stroke();
    }
    return wavesC;
  }

  // ---------- мир ----------
  const cymatica = {
    n: 'II', title: 'Cymatica', sub: 'figurae sonorae',
    corner: { hit: (f) => Math.hypot(f.x - T.W, f.y - (T.H - T.safeBot)) < 46, draw: drawResonator },
    fx: fxw,
    build, tick,
    enter() { entered = true; start(); },
    draw(now, dt) {
      const c = T.g, g = plateGeo();
      c.drawImage(wavesLayer(), 0, 0, T.W, T.H);   // фон с волнами — одной готовой картинкой
      drawPlate(g);
      shownF0 += (plate.f0 - shownF0) * (1 - Math.exp(-(dt || 1 / 60) / 0.08));   // пластина плавно доезжает до размера
      stepSand(dt || 1 / 60);
      drawSand(g);
      drawAstro(g, now);
      drawCursor(g);
      drawBows(g);
      drawLabel(g, now);
      drawTwist(now);
      drawResonator();
      if (ringF) drawRingHeld();
    },
    down, move, up,
    wheel(e) {                                   // колесо / щипок тачпада: вверх (развёл) — больше и ниже
      const k = e.ctrlKey ? 0.01 : 0.0025, d = e.deltaMode ? e.deltaY * 16 : e.deltaY;
      const ds = (12 * clamp(d * k, -0.5, 0.5)) / Math.LN2;   // полутонов за щелчок
      if (!T.scaleOn) { setF0(plate.f0 * 2 ** (ds / 12)); return; }
      wheelAcc += (ds * scaleSemis().filter((s) => s < 12).length) / 12;   // с ладом — копим ход, шагаем по ступеням
      const st = Math.trunc(wheelAcc);
      if (st) { wheelAcc -= st; stepScale(fs(), st); }
    },
    dice() {                                     // генеративный узор: Евклид, случайные места, мелодия по ладу; часы идут
      const R = Math.random, n = 8 + Math.floor(R() * 9), k = 3 + Math.floor(R() * (n - 4)), e = euclid(k, n);
      const list = noteList(), b = nearestIdx(list, fs()), dn = degPerOct();   // ноты — блуждание по ладу в двух нижних кольцах
      const w = walkMelody(n, list[b], list.slice(b, Math.min(b + 2 * dn, list.length)));
      seq.rhythm = { len: n, steps: Array.from({ length: SLOTS }, (_, i) => {
        if (i >= n || !e[i]) return null;
        const cl = cellOf(list.indexOf(w[i]), b, dn), p = cellCenter(cl.ring, cl.sector, dn);
        const r = Math.hypot(p.x, p.y) + (R() - 0.5) * 0.1, a = Math.atan2(p.y, p.x) + (R() - 0.5) * 0.6 * ((Math.PI * 2) / dn);   // сдвиг внутри клетки — тембр разный
        return { x: r * Math.cos(a), y: r * Math.sin(a), vel: 1 };
      }) };
      seq.playing = true;
      sendSeq();
    },
    clear() {                                    // узор и смычки — прочь; длины колец и часы остаются
      detach(); for (const b of plate.bows) sendBow(b, false); plate.bows = [];
      seq.rhythm.steps.fill(null);
      sendSeq();
    },
    snapshot: () => JSON.stringify({
      f0: r4(plate.f0),
      fx: Object.fromEntries(Object.entries(plate.fx).map(([k, v]) => [k, r4(v)])),
      bows: plate.bows.map((b) => ({ x: r4(b.x), y: r4(b.y), exciter: r4(b.exciter), pressure: r4(b.pressure), amp: r4(b.amp) })),
      seq: { bpm: seq.bpm, rhythm: seq.rhythm },
    }),
    restore(js) {
      const st = JSON.parse(js);
      detach();
      for (const b of plate.bows) sendBow(b, false);
      plate.f0 = st.f0; Object.assign(plate.fx, st.fx);
      plate.bows = st.bows.map((b) => ({ ...b, id: `b${bowId++}` }));
      seq.bpm = st.seq.bpm;
      seq.rhythm = { len: st.seq.rhythm.len, steps: st.seq.rhythm.steps.slice() };
      send({ t: 'f0', hz: plate.f0 }); sendParams(); applyFx(); sendSeq();
      for (const b of plate.bows) sendBow(b, true);
    },
    sounding: () => touches.size > 0 || plate.bows.length > 0 || level > 1e-4 || (seq.playing && seq.rhythm.steps.some(Boolean)),
  };
  T.registerWorld(2, cymatica);

  // отладка и тесты: window.t2d.cym
  window.t2d.cym = {
    get ready() { return ready; }, get f0() { return plate.f0; }, get fx() { return { ...plate.fx }; },
    get bows() { return plate.bows.map((b) => ({ ...b })); }, get energy() { return Array.from(energy); },
    get ringOpen() { return !!ringF; }, get live() { return [...touches.values()].filter((f) => f.bowing).length; },
    get geo() { return plateGeo(); },
    get seq() { const s = JSON.parse(JSON.stringify(seq)); s.melody = { len: seq.rhythm.len, steps: notesOf(seq.rhythm.steps) }; return s; },   // мелодия — ноты ударов
    get sentSeq() { return JSON.parse(JSON.stringify(sentSeq)); }, get base() { return nearestIdx(noteList(), fs()); },
    get lastStep() { return lastStep; },
    play, rec,
    get astro() { const g = plateGeo(); return { ...astro(g), cx: g.cx, cy: g.cy }; },
    load(o) {                                    // готовый узор (рендер, отладка)
      const pad = (a) => Array.from({ length: SLOTS }, (_, i) => (a[i] === undefined ? null : a[i]));
      if (o.bpm) seq.bpm = o.bpm;
      if (o.rhythm) seq.rhythm = { len: o.rhythm.len, steps: pad(o.rhythm.steps) };
      if (o.fx) fxw.load(o.fx);
      sendSeq();
    },
    core: { euclid, nearestStep, walkMelody, rotateSteps, twistOrPinch, noteList, degPerOct, cellIdx, noteAt, cellOf, cellCenter, transposeHits, scaleSemis, snapToGrid, quantizeRhythm },
    get echo() { return { label: echoDiv()[0], sec: echoSec(), fb: echoFb() }; }, get echoMax() { return echoes.length ? echoes[echoes.length - 1].dL.delayTime.maxValue : 0; },
    get echoChains() { return echoes.map((p) => ({ sec: p.sec, real: p.dL.delayTime.value })); },
    get gesture() { return gesture; }, get shownF0() { return shownF0; }, bowsOn: BOWS_ON, get ringTurn() { return { ...ringTurn }; }, get grid() { return grid; }, get waveStep() { return waveStep(); },
    get cursor() { return cursor; }, get lastStrike() { return lastStrike; },
    strike(x, y) { send({ t: 'strike', x, y, vel: 1, hard: 0.5 }); },
    bow(x, y, on = true) { send({ t: 'bow', id: 'dbg', x, y, on, exciter: 0, pressure: 0.5, amp: 0.8 }); },
    sandSpread() {                               // среднее поле под крупинками: песок в узлах — меньше
      if (!field) return 1;
      let s = 0;
      for (let i = 0; i < SAND; i++) s += fieldAt(sand.x[i], sand.y[i]);
      return s / SAND;
    },
  };
})();
