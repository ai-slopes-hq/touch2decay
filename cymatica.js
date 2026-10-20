// Cymatica — мир II: звучащая пластина Хладни. Тап — удар, держишь — смычок, двойной тап — закреплённый смычок
// (долгое касание метки — кольцо), щипок или колесо — размер пластины, то есть высота. Звук — plate-worklet.js.
// Спека: docs/superpowers/specs/2026-10-20-cymatica-design.md, часть 2.
(() => {
  'use strict';
  const T = window.T2D;
  const VER = (document.currentScript && new URL(document.currentScript.src, location.href).searchParams.get('v')) || '0';

  const F_MIN = 55, F_MAX = 880, F_DEF = 110;
  const BOW_AFTER = 150;                     // мс: дольше держишь — удар переходит в смычок
  const TAP_MS = 250, TAP_MOVE = 12, MARK_R = 18;
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const r4 = (x) => Math.round(x * 1e4) / 1e4;

  // ---------- состояние: высота, пластина (веер FX), закреплённые смычки ----------
  const plate = { f0: F_DEF, fx: { structure: 0.66, damping: 0.5, brightness: 0.5, hall: 0.25, echo: 0.15 }, bows: [] };
  let bowId = 1;
  const touches = new Map();                 // палец → касание пластины
  let ringF = null, pinch = null, lastTap = null, labelUntil = 0;

  // ---------- секвенсер: узор (ритм и мелодия разной длины), часы — в worklet ----------
  const SLOTS = 16;
  const seq = {
    bpm: 96, playing: false, rec: false,
    rhythm: { len: 16, steps: Array(SLOTS).fill(null) },   // { x, y, vel } — удар в точку пластины
    melody: { len: 7, steps: Array(SLOTS).fill(null) },    // полутоны от 55 Гц; null — текущий размер пластины
  };
  let lastStep = null, lastHit = { x: 0.3, y: 0 };          // последний тик { r, m, atMs }; место последнего удара
  let echoBpm = 0;
  function sendSeq() {
    send({ t: 'seq', bpm: seq.bpm, playing: seq.playing, rhythm: seq.rhythm, melody: seq.melody });
    if (nodes && echoBpm !== seq.bpm) {         // эхо — восьмая с точкой
      echoBpm = seq.bpm;
      for (const d of [nodes.dL, nodes.dR]) d.delayTime.setTargetAtTime((0.75 * 60) / seq.bpm, T.ctx.currentTime, 0.05);
    }
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
    seq.rhythm.steps[nearestStep(performance.now(), lastStep.atMs, lastStep.r, 60000 / seq.bpm / 4, seq.rhythm.len)] = { x, y, vel: 1 };
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
    nodes.echoSend.gain.setTargetAtTime(plate.fx.echo * 0.7, t, 0.05);
  }
  function build(ctx, input) {
    const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const out = g(1);
    out.connect(input);
    // зал — общий с Tenebrae по устройству, свой экземпляр; хвост 4 с
    const h = T.hall(), hallSend = g(0);
    for (const l of h.lines) l.g.gain.value = 10 ** ((-3 * l.len) / 4);
    hallSend.connect(h.input); h.out.connect(g(0.9)).connect(out);
    // эхо: две линии крест-накрест, восьмая с точкой (0.375 с) — до секвенсера
    const echoSend = g(0), dL = ctx.createDelay(2), dR = ctx.createDelay(2), merge = ctx.createChannelMerger(2);
    dL.delayTime.value = (0.75 * 60) / seq.bpm; dR.delayTime.value = (0.75 * 60) / seq.bpm;   // восьмая с точкой
    const lp = (n) => { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 3000; return n.connect(f); };
    echoSend.connect(dL);
    lp(dL).connect(g(0.4)).connect(dR);
    lp(dR).connect(g(0.4)).connect(dL);
    dL.connect(merge, 0, 0); dR.connect(merge, 0, 1); merge.connect(out);
    nodes = { out, hallSend, echoSend, dL, dR };
    actx = ctx;
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
    if (d.t === 'step') { lastStep = { r: d.r, m: d.m, atMs: performance.now() }; return; }
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
  function setF0(hz, record = false) {
    const s = T.snapSemi(12 * Math.log2(clamp(hz, F_MIN, F_MAX) / F_MIN));
    plate.f0 = clamp(F_MIN * 2 ** (s / 12), F_MIN, F_MAX);
    labelUntil = performance.now() + 1000;
    send({ t: 'f0', hz: plate.f0 });
    if (record && seq.rec && seq.playing && lastStep) {   // щипок при записи — нота в текущий шаг мелодии
      seq.melody.steps[lastStep.m % seq.melody.len] = Math.round(12 * Math.log2(plate.f0 / F_MIN));
      sendSeq();
    }
  }
  const NOTES = ['A', 'A♯', 'B', 'C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯'];
  function noteName(hz) {
    const s = Math.round(12 * Math.log2(hz / F_MIN));
    return NOTES[((s % 12) + 12) % 12] + (1 + Math.floor((s + 9) / 12));
  }

  // ---------- геометрия: пластина посередине; радиус по высоте: f ∝ 1/r² ----------
  // по высоте — пластина, кольца астролябии над ней (+36) и ▶/● под ней (+82): весь блок по центру между строкой и низом
  function plateGeo() {
    const top = T.topY, bot = T.H - T.safeBot;
    const rMax = Math.max(40, Math.min(T.W / 2 - 44, (bot - top - 126) / 2));
    const cy = top + (bot - top - (2 * rMax + 118)) / 2 + rMax + 36;
    return { cx: T.W / 2, cy, rMax, r: rMax * Math.sqrt(F_MIN / plate.f0) };
  }
  const toPlate = (f, g) => ({ x: (f.x - g.cx) / g.r, y: (f.y - g.cy) / g.r });
  const fromPlate = (b, g) => ({ x: g.cx + b.x * g.r, y: g.cy + b.y * g.r });
  function bowAt(f, g) {
    for (const b of plate.bows) { const p = fromPlate(b, g); if (Math.hypot(f.x - p.x, f.y - p.y) < MARK_R) return b; }
    return null;
  }

  // ---------- астролябия: кольцо мелодии (внутри) и ритма (снаружи), 16 гнёзд от верха по часовой; внизу ▶ и ● ----------
  function astro(g) { return { R1: g.rMax + 12, R2: g.rMax + 30, ty: g.cy + g.rMax + 64 }; }
  const slotAng = (i) => -Math.PI / 2 + (i * Math.PI * 2) / SLOTS;
  const slotXY = (g, i, R) => ({ x: g.cx + R * Math.cos(slotAng(i)), y: g.cy + R * Math.sin(slotAng(i)) });
  const slotOf = (f, g) => ((((Math.atan2(f.y - g.cy, f.x - g.cx) + Math.PI / 2) / (Math.PI * 2)) * SLOTS) % SLOTS + SLOTS) % SLOTS;
  let bpmUntil = 0, noteEdit = null;            // подписи — только пока правишь
  function astroHit(f, g) {
    const A = astro(g), d = Math.hypot(f.x - g.cx, f.y - g.cy);
    if (Math.hypot(f.x - (g.cx - 30), f.y - A.ty) < 22) return { k: 'play' };
    if (Math.hypot(f.x - (g.cx + 30), f.y - A.ty) < 22) return { k: 'rec' };
    const hr = slotXY(g, seq.rhythm.len - 0.5, A.R2 + 12), hm = slotXY(g, seq.melody.len - 0.5, A.R1 - 11);
    if (Math.hypot(f.x - hr.x, f.y - hr.y) < 16) return { k: 'len', ring: 'rhythm' };
    if (Math.hypot(f.x - hm.x, f.y - hm.y) < 12) return { k: 'len', ring: 'melody' };
    const i = Math.round(slotOf(f, g)) % SLOTS;
    if (Math.abs(d - A.R2) < 11 && Math.abs(d - A.R2) <= Math.abs(d - A.R1)) return { k: 'rtick', i };
    if (Math.abs(d - A.R1) < 8) return { k: 'mtick', i, r0: d, s0: seq.melody.steps[i] ?? Math.round(12 * Math.log2(plate.f0 / F_MIN)) };
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
      if (len !== seq[h.ring].len) { seq[h.ring].len = len; sendSeq(); }
    } else if (h.k === 'mtick' && f.moved) {      // засечку мелодии — от центра выше, к центру ниже (ступень лада или полутон)
      const steps = Math.round((Math.hypot(f.x - g.cx, f.y - g.cy) - h.r0) / 6);
      let s;
      if (T.scaleOn) {
        const list = scaleSemis();
        let j = 0;
        for (let k = 1; k < list.length; k++) if (Math.abs(list[k] - h.s0) < Math.abs(list[j] - h.s0)) j = k;
        s = list[clamp(j + steps, 0, list.length - 1)];
      } else s = clamp(h.s0 + steps, 0, 48);
      if (s !== seq.melody.steps[h.i]) { seq.melody.steps[h.i] = s; sendSeq(); }
      noteEdit = { i: h.i, until: performance.now() + 1000 };
    }
  }
  function astroUp(f) {
    const h = f.astro;
    if (h.k === 'play' && !f.moved) play();
    else if (h.k === 'rec') rec();
    else if (h.k === 'rtick') { seq.rhythm.steps[h.i] = seq.rhythm.steps[h.i] ? null : { ...lastHit, vel: 1 }; sendSeq(); }
    else if (h.k === 'mtick' && !f.moved) { seq.melody.steps[h.i] = null; sendSeq(); }
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

  // ---------- касания ----------
  function down(f) {
    const g = plateGeo();
    const h = astroHit(f, g);
    if (h) { touches.set(f.id, f); f.astro = h; f.bpm0 = seq.bpm; return; }
    if (Math.hypot(f.x - g.cx, f.y - g.cy) > g.rMax) return;   // мимо стола
    touches.set(f.id, f);
    const b = bowAt(f, g);
    if (b) { f.cb = b; return; }
    const mk = seq.rec ? -1 : markAt(f, g);   // при записи метки не мешают: барабанишь в одну точку — каждый тап пишется
    if (mk >= 0) {                              // тап по метке звучит сразу; повёл — тащишь метку
      f.mk = mk;
      const st = seq.rhythm.steps[mk];
      send({ t: 'strike', x: st.x, y: st.y, vel: 1, hard: 0.5 });
      return;
    }
    for (const o of touches.values()) {      // второй палец почти разом — щипок
      if (o !== f && !o.cb && !o.moved && f.t0 - o.t0 < 250 && !pinch) {
        pinch = { a: o, b: f, d0: Math.max(20, Math.hypot(f.x - o.x, f.y - o.y)), f0: plate.f0 };
        if (o.bowing) { send({ t: 'bow', id: o.bid, on: false }); o.bowing = false; }
        o.live = false;
        o.pinch = f.pinch = true;
        return;
      }
    }
    const p = toPlate(f, g);
    if (Math.hypot(p.x, p.y) > 1) return;    // вне пластины (но на столе) — только для щипка
    f.live = true; f.bid = `t${f.id}`;
    send({ t: 'strike', x: p.x, y: p.y, vel: 1, hard: 0.5, rec: seq.rec && seq.playing });
    recordHit(p.x, p.y);
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
    if (f.pinch && pinch) {
      const d = Math.max(20, Math.hypot(pinch.a.x - pinch.b.x, pinch.a.y - pinch.b.y));
      setF0(pinch.f0 * (pinch.d0 / d) ** 2, true);   // развёл — пластина больше и ниже
      return;
    }
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
    if (f.pinch) { if (pinch && (pinch.a === f || pinch.b === f)) pinch = null; return; }
    if (f.cb) {
      if (Math.hypot(f.cb.x, f.cb.y) > 1.05) {   // утащил за край — смычок убран
        sendBow(f.cb, false);
        plate.bows = plate.bows.filter((b) => b !== f.cb);
      }
      return;
    }
    if (!f.live) return;
    if (f.bowing) send({ t: 'bow', id: f.bid, on: false });
    const tap = now - f.t0 < TAP_MS && Math.hypot(f.x - f.x0, f.y - f.y0) < TAP_MOVE;
    if (!tap) return;
    if (lastTap && now - lastTap.t < T.DTAP_MS && Math.hypot(f.x - lastTap.x, f.y - lastTap.y) < 30) {
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
      if (f.live && !f.bowing && now - f.t0 > BOW_AFTER) {
        const p = toPlate(f, g);
        f.bowing = true;
        send({ t: 'bow', id: f.bid, x: p.x, y: p.y, on: true, exciter: 0, pressure: 0.5, amp: 0.8 });
      }
      if (f.cb && !f.moved && !f.menu && now - f.t0 > T.HOLD_MS) openRing(f);
    }
  }

  // ---------- веер FX: пластина и пространство ----------
  const deg = (d) => (d * Math.PI) / 180;
  const STRUCT = ['string', 'membrane', 'plate', 'bell'];
  const fxw = {
    sectors: [
      { key: 'structure', label: 'structure', ang: deg(180) },
      { key: 'damping', label: 'damping', ang: deg(157.5) },
      { key: 'brightness', label: 'brightness', ang: deg(135) },
      { key: 'hall', label: 'hall', ang: deg(112.5) },
      { key: 'echo', label: 'echo', ang: deg(90) },
    ],
    get: (k) => plate.fx[k],
    set: (k, t) => { plate.fx[k] = t; if (k === 'hall' || k === 'echo') applyFx(); else sendParams(); },
    text: (k) => {
      const v = plate.fx[k];
      if (k === 'structure') return STRUCT[Math.min(3, Math.round(v * 3))];
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
    for (const b of plate.bows) {                 // закреплённый смычок — кружок с засечкой-смычком
      const p = fromPlate(b, g);
      c.fillStyle = T.BG; c.beginPath(); c.arc(p.x, p.y, 7, 0, Math.PI * 2); c.fill();
      T.ring(p.x, p.y, 7, 0.9, 1.2);
      c.strokeStyle = T.ink(0.7); c.lineWidth = 1;
      c.beginPath(); c.moveTo(p.x - 11, p.y + 9); c.lineTo(p.x + 11, p.y - 9); c.stroke();
    }
    for (const f of touches.values()) if (f.bowing) T.ring(f.x, f.y, 26, 0.35, 1);   // живой смычок под пальцем
  }
  // астролябия: двойные кольца с засечками гнёзд, удары ритма — точки, ноты мелодии — засечки внутрь по высоте;
  // стрелки — пока часы идут; выступы длины; ▶/■ и ● внизу; метки ударов на пластине вспыхивают на своём шаге
  function drawAstro(g, now) {
    const c = T.g, A = astro(g), stepMs = 60000 / seq.bpm / 4;
    for (const R of [A.R1, A.R2]) { T.ring(g.cx, g.cy, R, 0.4, 1); T.ring(g.cx, g.cy, R + 2.5, 0.15, 1); }
    c.lineWidth = 1;
    for (let i = 0; i < SLOTS; i++) {
      const a = slotAng(i), x = Math.cos(a), y = Math.sin(a);
      const onR = i < seq.rhythm.len, onM = i < seq.melody.len, st = seq.rhythm.steps[i], s = seq.melody.steps[i];
      c.strokeStyle = T.ink(onR ? 0.55 : 0.12);
      c.beginPath(); c.moveTo(g.cx + x * (A.R2 - 4), g.cy + y * (A.R2 - 4)); c.lineTo(g.cx + x * (A.R2 + 4), g.cy + y * (A.R2 + 4)); c.stroke();
      if (st) T.dot(g.cx + x * A.R2, g.cy + y * A.R2, 2.6, onR ? 0.95 : 0.25);
      const l = s == null ? 3 : 3 + (s % 24) * 0.5;
      c.strokeStyle = T.ink(onM ? (s == null ? 0.35 : 0.85) : 0.12);
      c.beginPath(); c.moveTo(g.cx + x * A.R1, g.cy + y * A.R1); c.lineTo(g.cx + x * (A.R1 - l), g.cy + y * (A.R1 - l)); c.stroke();
    }
    for (const [ring, R] of [['rhythm', A.R2 + 12], ['melody', A.R1 - 11]]) {   // выступы длины колец — ромбики
      const p = slotXY(g, seq[ring].len - 0.5, R);
      c.strokeStyle = T.ink(0.6); c.beginPath();
      c.moveTo(p.x, p.y - 4); c.lineTo(p.x + 4, p.y); c.lineTo(p.x, p.y + 4); c.lineTo(p.x - 4, p.y); c.closePath(); c.stroke();
    }
    if (seq.playing && lastStep) {               // стрелки: от края стола к своему кольцу, плавно между тиками
      const fr = clamp((now - lastStep.atMs) / stepMs);
      for (const [i, R, a] of [[lastStep.r, A.R2 + 6, 0.6], [lastStep.m, A.R1 + 4, 0.45]]) {
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
    for (const [x, k] of [[g.cx - 30, 'play'], [g.cx + 30, 'rec']]) {
      c.fillStyle = 'rgba(0,0,0,0.88)'; c.beginPath(); c.arc(x, A.ty, 18, 0, Math.PI * 2); c.fill();
      T.ring(x, A.ty, 17, 0.45, 1.2);
    }
    c.strokeStyle = T.ink(0.85); c.lineWidth = 1.2; c.beginPath();
    if (seq.playing) c.rect(g.cx - 35, A.ty - 5, 10, 10);
    else { c.moveTo(g.cx - 34, A.ty - 6); c.lineTo(g.cx - 25, A.ty); c.lineTo(g.cx - 34, A.ty + 6); c.closePath(); }
    c.stroke();
    if (seq.rec) T.dot(g.cx + 30, A.ty, 5, 0.95); else T.ring(g.cx + 30, A.ty, 5, 0.6, 1.2);
    if (now < bpmUntil) T.mapText(`${seq.bpm} BPM`, g.cx - 30, A.ty - 30, 14, 0.85, 'center');
    if (noteEdit && now < noteEdit.until) {
      const s = seq.melody.steps[noteEdit.i], p = slotXY(g, noteEdit.i, A.R1 - 24);
      T.mapText(s == null ? '—' : noteName(F_MIN * 2 ** (s / 12)), p.x, p.y, 13, 0.85, 'center');
    }
  }
  function drawLabel(g, now) {
    if (now > labelUntil) return;
    const a = Math.min(1, (labelUntil - now) / 400);
    T.mapText(`${noteName(plate.f0)} · ${Math.round(plate.f0)} Hz`, g.cx, g.cy - g.rMax - 18, 15, 0.85 * a, 'center');
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

  // ---------- мир ----------
  const cymatica = {
    n: 'II', title: 'Cymatica', sub: 'figurae sonorae',
    corner: { hit: (f) => Math.hypot(f.x - T.W, f.y - (T.H - T.safeBot)) < 46, draw: drawResonator },
    fx: fxw,
    build, tick,
    enter() { entered = true; start(); },
    draw(now, dt) {
      const c = T.g, g = plateGeo();
      c.fillStyle = T.BG; c.fillRect(0, 0, T.W, T.H);
      drawPlate(g);
      stepSand(dt || 1 / 60);
      drawSand(g);
      drawAstro(g, now);
      drawBows(g);
      drawLabel(g, now);
      drawResonator();
      if (ringF) drawRingHeld();
    },
    down, move, up,
    wheel(e) {                                   // колесо / щипок тачпада: вверх (развёл) — больше и ниже
      const k = e.ctrlKey ? 0.01 : 0.0025, d = e.deltaMode ? e.deltaY * 16 : e.deltaY;
      setF0(plate.f0 * Math.exp(clamp(d * k, -0.5, 0.5)), true);
    },
    dice() {                                     // генеративный узор: Евклид, случайные места, мелодия по ладу; часы идут
      const R = Math.random, n = 8 + Math.floor(R() * 9), k = 3 + Math.floor(R() * (n - 4)), e = euclid(k, n);
      seq.rhythm = { len: n, steps: Array.from({ length: SLOTS }, (_, i) => {
        if (i >= n || !e[i]) return null;
        const r = 0.85 * Math.sqrt(R()), a = R() * Math.PI * 2;
        return { x: r * Math.cos(a), y: r * Math.sin(a), vel: 1 };
      }) };
      const ml = 3 + Math.floor(R() * 7), w = walkMelody(ml, 12 * Math.log2(plate.f0 / F_MIN), scaleSemis());
      seq.melody = { len: ml, steps: Array.from({ length: SLOTS }, (_, i) => (i < ml ? w[i] : null)) };
      seq.playing = true;
      sendSeq();
    },
    clear() {                                    // узор и смычки — прочь; длины колец и часы остаются
      detach(); for (const b of plate.bows) sendBow(b, false); plate.bows = [];
      seq.rhythm.steps.fill(null); seq.melody.steps.fill(null);
      sendSeq();
    },
    snapshot: () => JSON.stringify({
      f0: r4(plate.f0),
      fx: Object.fromEntries(Object.entries(plate.fx).map(([k, v]) => [k, r4(v)])),
      bows: plate.bows.map((b) => ({ x: r4(b.x), y: r4(b.y), exciter: r4(b.exciter), pressure: r4(b.pressure), amp: r4(b.amp) })),
      seq: { bpm: seq.bpm, rhythm: seq.rhythm, melody: seq.melody },
    }),
    restore(js) {
      const st = JSON.parse(js);
      detach();
      for (const b of plate.bows) sendBow(b, false);
      plate.f0 = st.f0; Object.assign(plate.fx, st.fx);
      plate.bows = st.bows.map((b) => ({ ...b, id: `b${bowId++}` }));
      seq.bpm = st.seq.bpm;
      seq.rhythm = { len: st.seq.rhythm.len, steps: st.seq.rhythm.steps.slice() };
      seq.melody = { len: st.seq.melody.len, steps: st.seq.melody.steps.slice() };
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
    get seq() { return JSON.parse(JSON.stringify(seq)); }, get lastStep() { return lastStep; },
    play, rec,
    get astro() { const g = plateGeo(); return { ...astro(g), cx: g.cx, cy: g.cy }; },
    load(o) {                                    // готовый узор (рендер, отладка)
      const pad = (a) => Array.from({ length: SLOTS }, (_, i) => (a[i] === undefined ? null : a[i]));
      if (o.bpm) seq.bpm = o.bpm;
      if (o.rhythm) seq.rhythm = { len: o.rhythm.len, steps: pad(o.rhythm.steps) };
      if (o.melody) seq.melody = { len: o.melody.len, steps: pad(o.melody.steps) };
      sendSeq();
    },
    core: { euclid, nearestStep, walkMelody },
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
