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
  const plate = { f0: F_DEF, fx: { structure: 2 / 7, damping: 0.5, brightness: 0.5, hall: 0.25, echo: 0.15, time: 6 / 8, chance: 1 }, bows: [] };
  let bowId = 1;
  const touches = new Map();                 // палец → касание пластины
  let ringF = null, two = null, lastTap = null, labelUntil = 0, gesture = null, twistLabel = null;

  // ---------- секвенсер: ритм (удары) и мелодия (места на пластине) — у каждой своя длина, отсюда полиритм; часы — в worklet ----------
  const SLOTS = 16;
  const seq = {
    bpm: 96, playing: false, rec: false,
    rhythm: { len: 16, steps: Array(SLOTS).fill(null) },   // { vel } — удар
    melody: { len: 7, steps: Array(SLOTS).fill(null) },    // { x, y } — куда бьёт удар этого шага: клетка — нота, точка — тембр; пусто — пауза
  };
  let lastStep = null, lastHit = { x: 0.3, y: 0 }, grid = 1;   // grid — сетка записи в гнёздах: 1/16, 1/8, 1/4          // последний тик { r, m, atMs }; место последнего удара
  let echoBpm = 0;
  // ноты считаются из мест: размер пластины (щипок) — база раскладки, поэтому щипок транспонирует всю музыку
  // луна у кнопок: медленно качает размер пластины по ступеням лада (sine) или прыгает случайно (random); такт — от темпа
  const drift = { on: false, depth: 0.3, rate: 0.5, shape: 0, k: 0, t0: 0, last: -1 };
  const DRIFT_RATES = [['4 bars', 16], ['2 bars', 8], ['1 bar', 4], ['1/2', 2], ['1/4', 1]];
  const driftRate = () => DRIFT_RATES[Math.round(drift.rate * (DRIFT_RATES.length - 1))];
  const driftDepth = () => Math.max(1, Math.round(drift.depth * 7));
  function effF0() {                              // высота с луной: база (щипок) + k ступеней
    if (!drift.on || !drift.k) return plate.f0;
    const list = scaleSemis(), i = clamp(nearestIdx(list, 12 * Math.log2(plate.f0 / F_MIN)) + drift.k, 0, list.length - 1);
    return clamp(F_MIN * 2 ** (list[i] / 12), F_MIN, F_MAX);
  }
  const fs = () => 12 * Math.log2(effF0() / F_MIN);
  const born = { r: new Float64Array(SLOTS), m: new Float64Array(SLOTS) }, pulse = { r: new Float64Array(SLOTS), m: new Float64Array(SLOTS) };
  const sent = { r: [], o: [] };
  const wrap = (i, n) => ((i % n) + n) % n;
  let sentSeq = null, sentKey = '';
  const scaleKey = () => `${!!T.scaleOn}|${T.scalePCs}`;   // лад меняется в общей строке — ноты надо переслать
  function notesOf(steps) {                      // нота каждого места: полутоны от 55 Гц или null (клетка за пределом)
    const list = noteList(), b = nearestIdx(list, fs()), n = degPerOct();
    return steps.map((st) => (st ? noteAt(st.x, st.y, b, n, list) : null));
  }
  function sendSeq() {
    const now = performance.now(), notes = notesOf(seq.melody.steps);   // новое в гнезде — вспышка: видно, куда легло
    // нота сменила клетку — вспышка; щипок двигает базу, клетки те же — без вспышек
    const n = degPerOct(), offs = seq.melody.steps.map((st) => (st ? cellIdx(st.x, st.y, 0, n) : null));
    for (let i = 0; i < SLOTS; i++) {
      if (seq.rhythm.steps[i] && seq.rhythm.steps[i] !== sent.r[i]) born.r[i] = now;
      if (notes[i] != null && offs[i] !== sent.o[i]) born.m[i] = now;
    }
    sent.r = seq.rhythm.steps.slice(); sent.o = offs; sentKey = scaleKey();
    // в worklet: место с нотой и точкой удара; место в молчащей клетке (за 1760 Гц) уходит пустым — пауза
    sentSeq = {
      rhythm: { len: seq.rhythm.len, steps: seq.rhythm.steps.map((st) => (st ? { vel: st.vel, chance: st.chance ?? 1 } : null)) },
      melody: { len: seq.melody.len, steps: seq.melody.steps.map((st, i) => (notes[i] == null ? null : { s: notes[i], x: st.x, y: st.y })) },
    };
    send({ t: 'seq', bpm: seq.bpm, playing: seq.playing, chance: plate.fx.chance, ...sentSeq });
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
  // записать удар игрой: удар — в ближайший шаг ритма (по сетке), место — в шаг мелодии, что играет в тот же миг
  function recordHit(x, y) {
    lastHit = { x, y };
    if (!seq.rec || !seq.playing || !lastStep) return;
    const now = performance.now(), stepMs = 60000 / seq.bpm / 4, R = seq.rhythm.len, h = Math.floor(R / 2);
    const i = nearestStep(now, lastStep.atMs, lastStep.r, stepMs, R), j = snapToGrid(i, grid, R);
    const sh = ((j - i + R + h) % R) - h;         // сетка сдвинула удар — мелодия сдвигается так же
    seq.rhythm.steps[j] = { vel: 1 };
    seq.melody.steps[wrap(nearestStep(now, lastStep.atMs, lastStep.m, stepMs, seq.melody.len) + sh, seq.melody.len)] = { x, y };
    sendSeq();
  }
  // пустое второе кольцо не должно глушить первое: удары без мест — все места в последнюю точку, места без ударов — удар на каждом шаге
  function fillMelody() {
    if (!seq.melody.steps.some(Boolean)) for (let i = 0; i < seq.melody.len; i++) seq.melody.steps[i] = { ...lastHit };
  }
  function fillRhythm() {
    if (!seq.rhythm.steps.some(Boolean)) for (let i = 0; i < seq.rhythm.len; i++) seq.rhythm.steps[i] = { vel: 1 };
  }
  let stepRec = null;                            // запись по шагам (часы стоят): { r, m } — куда ляжет следующий удар
  function play(on = !seq.playing) { seq.playing = on; if (!on) seq.rec = false; if (on) stepRec = null; sendSeq(); }
  function rec(on = !seq.rec) { seq.rec = on; if (on && !seq.playing) play(true); }
  function stepRecToggle() { stepRec = stepRec ? null : { r: 0, m: 0 }; cursor = null; }
  let energy = new Float32Array(24), level = 0, voices = [];

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
    started = false; ready = false; node = null;  // и модуль пластины — заново (перезапуск звука после смены выхода)
    applyFx();
    if (entered) start();
    send({ t: 'f0', hz: effF0() });
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
      lastStep = { r: d.r, m: d.m, atMs: now };
      if (seq.rhythm.steps[d.r] && d.hit !== false) {
        pulse.r[d.r] = now;
        const st = seq.melody.steps[d.m];
        if (st) { pulse.m[d.m] = now; starPush(st, now); const n = sentSeq && sentSeq.melody.steps[d.m]; if (n) answer(n.s); }
      }
      return;
    }
    if (d.t === 'energy') { voices = d.voices; energy = d.e; level = d.voices.reduce((s, v) => s + v.level, 0); }   // формы мод (shapes) больше не нужны: песка нет
  }

  // созвездия: сыгранные места соединяются тонкими линиями, фигура медленно гаснет (полиритм виден рисунком)
  const stars = [];
  function starPush(st, now) { stars.push({ x: st.x, y: st.y, t: now }); while (stars.length > 24) stars.shift(); }
  function drawStars(g, now) {
    const c = T.g, LIFE = 5000;
    while (stars.length && now - stars[0].t > LIFE) stars.shift();
    c.lineWidth = 0.8;
    for (let i = 1; i < stars.length; i++) {
      const a = stars[i - 1], b = stars[i], k = 1 - (now - a.t) / LIFE;
      if (a.x === b.x && a.y === b.y) continue;
      const p = fromPlate(a, g), q = fromPlate(b, g);
      c.strokeStyle = T.ink(0.3 * k); c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(q.x, q.y); c.stroke();
    }
    for (const s of stars) { const k = 1 - (now - s.t) / LIFE, p = fromPlate(s, g); T.dot(p.x, p.y, 1.4, 0.55 * k); }
  }
  // резонатор отзывается: нота удара совпала с его собственной (класс высоты основного тона пластины) — тихий гул и подпись ноты
  let answerAt = -1e9, answerNote = '';
  function answer(semi) {
    const own = Math.round(fs());
    if (((semi - own) % 12 + 12) % 12 !== 0) return;
    const now = performance.now();
    answerAt = now; answerNote = noteName(F_MIN * 2 ** (semi / 12));
    if (!nodes || !actx || now - (answer.last || 0) < 250) return;
    answer.last = now;
    const t = actx.currentTime, o = actx.createOscillator(), o2 = actx.createOscillator(), gn = actx.createGain();
    const hz = F_MIN * 2 ** (own / 12);
    o.frequency.value = hz / 2; o2.frequency.value = hz; o2.detune.value = 4;
    gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(0.05, t + 0.15); gn.gain.exponentialRampToValueAtTime(0.0001, t + 1.6); gn.gain.linearRampToValueAtTime(0, t + 1.62);
    o.connect(gn); o2.connect(gn); gn.connect(nodes.out); gn.connect(nodes.hallSend);
    o.start(t); o2.start(t); o.stop(t + 1.65); o2.stop(t + 1.65);
    o.onended = () => { o.disconnect(); o2.disconnect(); gn.disconnect(); };
  }
  function sendBow(b, on) { send({ t: 'bow', id: b.id, x: b.x, y: b.y, on, exciter: b.exciter, pressure: b.pressure, amp: b.amp }); }

  // ---------- высота = размер пластины ----------
  function setF0(hz) {
    const s = T.snapSemi(12 * Math.log2(clamp(hz, F_MIN, F_MAX) / F_MIN));
    plate.f0 = clamp(F_MIN * 2 ** (s / 12), F_MIN, F_MAX);
    labelUntil = performance.now() + 1000;
    send({ t: 'f0', hz: effF0() });
    if (seq.melody.steps.some(Boolean)) sendSeq();   // ноты едут вместе с пластиной
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

  // ---------- геометрия: пластина посередине; радиус по высоте: r ∝ f^−1/4 ----------
  // по высоте — пластина, кольца астролябии над ней (+64), ▶/● под ней (+104): блок по центру между строкой и низом
  function plateGeo() {
    const top = T.topY, bot = T.H - T.safeBot;
    const rMax = Math.max(40, Math.min(T.W / 2 - 64, (bot - top - 176) / 2));
    const cy = top + (bot - top - (2 * rMax + 168)) / 2 + rMax + 64;
    return { cx: T.W / 2, cy, rMax, r: rMax * (F_MIN / shownF0) ** 0.25 };   // размер едет плавно к высоте; закон мягче физического (f ∝ 1/r²) — клетки ханга остаются под палец
  }
  const toPlate = (f, g) => ({ x: (f.x - g.cx) / g.r, y: (f.y - g.cy) / g.r });
  const fromPlate = (b, g) => ({ x: g.cx + b.x * g.r, y: g.cy + b.y * g.r });
  function bowAt(f, g) {
    for (const b of plate.bows) { const p = fromPlate(b, g); if (Math.hypot(f.x - p.x, f.y - p.y) < MARK_R) return b; }
    return null;
  }

  // ---------- астролябия: кольцо мелодии (внутри) и ритма (снаружи), 16 гнёзд от верха по часовой; внизу ▶ и ● ----------
  // кольцо мелодии R1 — ноты сидят на нём, как бусины; кольцо ритма R2 — удары на нём; граница зон между ними — RM
  function astro(g) { return { R1: g.rMax + 22, R2: g.rMax + 48, RM: g.rMax + 35, ty: g.cy + g.rMax + 82, playX: g.cx - 90, recX: g.cx - 30, gridX: g.cx + 30, driftX: g.cx + 90 }; }
  const slotAng = (i) => -Math.PI / 2 + (i * Math.PI * 2) / SLOTS;
  const slotXY = (g, i, R) => ({ x: g.cx + R * Math.cos(slotAng(i)), y: g.cy + R * Math.sin(slotAng(i)) });
  const slotOf = (f, g) => ((((Math.atan2(f.y - g.cy, f.x - g.cx) + Math.PI / 2) / (Math.PI * 2)) * SLOTS) % SLOTS + SLOTS) % SLOTS;
  let bpmUntil = 0, noteEdit = null, chanceEdit = null;            // подписи — только пока правишь
  function astroHit(f, g) {
    const A = astro(g), d = Math.hypot(f.x - g.cx, f.y - g.cy);
    if (Math.hypot(f.x - A.playX, f.y - A.ty) < 22) return { k: 'play' };
    if (Math.hypot(f.x - A.recX, f.y - A.ty) < 22) return { k: 'rec' };
    if (Math.hypot(f.x - A.gridX, f.y - A.ty) < 22) return { k: 'grid' };
    if (Math.hypot(f.x - A.driftX, f.y - A.ty) < 22) return { k: 'drift' };
    const s = slotOf(f, g), ring = d >= A.RM && d < A.R2 + 14 ? 'rhythm' : d >= A.R1 - 14 && d < A.RM ? 'melody' : null;
    if (ring) {                                  // край заливки длины кольца (между гнёздами) — тянуть по кругу
      const e = Math.abs(((s - (seq[ring].len - 0.5)) % SLOTS + SLOTS + SLOTS / 2) % SLOTS - SLOTS / 2);
      if (e < 0.3) return { k: 'len', ring };
    }
    const i = Math.round(s) % SLOTS;
    if (ring === 'rhythm') return { k: 'rtick', i, r0: d, c0: seq.rhythm.steps[i] ? seq.rhythm.steps[i].chance ?? 1 : 1 };
    if (ring === 'melody') {                     // бусина — нота места этого шага: его клетка
      const st = seq.melody.steps[i];
      return { k: 'mtick', i, r0: d, ci: st ? cellIdx(st.x, st.y, nearestIdx(noteList(), fs()), degPerOct()) : null };
    }
    return null;
  }
  function astroMove(f, g) {
    const h = f.astro;
    if (h.k === 'play' && f.moved) {             // зажал ▶ и ведёшь — темп
      const bpm = Math.round(clamp(f.bpm0 + (f.x - f.x0) * 0.5, 40, 200));
      if (bpm !== seq.bpm) { seq.bpm = bpm; sendSeq(); T.tempoFrom(2, bpm); }
      bpmUntil = performance.now() + 1000;
    } else if (h.k === 'len') {
      const len = Math.round(clamp(slotOf(f, g) + 0.5, 1, SLOTS));
      if (len !== seq[h.ring].len) { seq[h.ring].len = len; sendSeq(); }   // у каждого кольца своя длина
    } else if (h.k === 'rtick' && f.moved && seq.rhythm.steps[h.i]) {   // удар тянешь к центру — реже (шанс), наружу — чаще
      const st = seq.rhythm.steps[h.i], ch = Math.round(clamp(h.c0 + (Math.hypot(f.x - g.cx, f.y - g.cy) - h.r0) / 70, 0.05, 1) * 20) / 20;
      if (ch !== (st.chance ?? 1)) { st.chance = ch; sendSeq(); }
      chanceEdit = { i: h.i, until: performance.now() + 1000 };
    } else if (h.k === 'drift' && f.moved) {
    } else if (h.k === 'mtick' && f.moved && h.ci != null) {   // бусину — от центра выше, к центру ниже на ступени; место переезжает в клетку ноты
      const st = seq.melody.steps[h.i];
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
    if (h.k === 'play' && !f.moved) { cursor = null; play(); T.tempoFrom(2, seq.bpm); T.transportFrom(2, seq.playing); }
    else if (h.k === 'rec') { cursor = null; if (seq.playing) rec(); else stepRecToggle(); }   // часы стоят — запись по шагам
    else if (h.k === 'rtick' && !f.moved) { seq.rhythm.steps[h.i] = seq.rhythm.steps[h.i] ? null : { vel: 1 }; fillMelody(); sendSeq(); }
    else if (h.k === 'drift' && !f.moved && !f.menu && !T.sheetOpen) { drift.on = !drift.on; drift.k = 0; drift.t0 = performance.now(); drift.last = -1; send({ t: 'f0', hz: effF0() }); sendSeq(); }
    else if (h.k === 'mtick' && !f.moved && !seq.playing) cursor = h.i % seq.melody.len;   // тап по гнезду мелодии, часы стоят — курсор пошагового ввода туда
  }
  // пошаговый ввод: курсор появляется тапом по гнезду кольца мелодии (часы стоят); тап по пластине пишет место в гнездо
  // курсора и двигает его дальше; ▶, ● или тап мимо пластины и колец — курсор убран
  let cursor = null, lastStrike = null;
  function drawCursor(g) {
    if (cursor == null || seq.playing) return;
    const A = astro(g), i = cursor % seq.melody.len, p = slotXY(g, i, A.R1);
    T.ring(p.x, p.y, 15, 0.9, 1.6);
    T.mapText(`step ${i + 1} / ${seq.melody.len}`, A.playX - 62, A.ty, 13, 0.7, 'center');
  }
  // метка места мелодии на пластине
  function markAt(f, g) {
    for (let i = 0; i < SLOTS; i++) {
      const st = seq.melody.steps[i];
      if (!st) continue;
      const p = fromPlate(st, g);
      if (Math.hypot(f.x - p.x, f.y - p.y) < 11) return i;
    }
    return -1;
  }

  // ---------- вращение: кольца — сдвиг узора, пластина — транспонирование; два пальца или Shift-мышь ----------
  const wrapDeg = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
  const origOf = () => ({ r: seq.rhythm.steps.slice(), m: seq.melody.steps.slice() });
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
    twistTo(t, t.target, t.deg, (t.a.x + t.b.x) / 2, (t.a.y + t.b.y) / 2);
  }
  // поворот относительно начала жеста: кольца — 22.5° на гнездо, пластина — 20° на ступень лада (по часовой — вперёд/вверх)
  const ringTurn = { melody: 0, rhythm: 0 }, ringOrn = { melody: 0, rhythm: 0 };   // ringOrn — накопленный поворот узора кольца    // остаток поворота кольца в градусах — кольцо идёт за пальцами, отпустил — встаёт в гнездо
  function twistTo(t, target, deg, x, y) {
    const k = Math.round(deg / (target === 'plate' ? 20 : 22.5));
    if (target !== 'plate') ringTurn[target] = deg - k * 22.5;   // кольца крутятся порознь — сдвиг ритма против мелодии
    twistLabel = { text: `${k > 0 ? '+' : ''}${k}`, x, y, until: performance.now() + 1000 };
    if (k === t.k) return;
    t.k = k;
    if (target === 'rhythm') seq.rhythm.steps = rotateSteps(t.orig.r, seq.rhythm.len, k);
    else if (target === 'melody') seq.melody.steps = rotateSteps(t.orig.m, seq.melody.len, k);
    else {                                       // пластина: каждое место — на k ступеней; вернул в ноль — места как были
      const list = noteList();
      seq.melody.steps = k ? transposeHits(t.orig.m, k, nearestIdx(list, fs()), degPerOct(), list) : t.orig.m.slice();
    }
    sendSeq();
  }
  function endTurn(t) {                          // отпустил — кольцо встаёт в гнездо, его узор остаётся повёрнутым
    if (t.target === 'melody' || t.target === 'rhythm') ringOrn[t.target] = (ringOrn[t.target] + t.k * 22.5) % 360;
    ringTurn.melody = ringTurn.rhythm = 0;
  }
  // ---------- касания ----------
  function down(f, e) {
    const g = plateGeo();
    if (e && e.shiftKey) {                       // Shift + мышь — вращение того, что под курсором
      const target = twistTarget(Math.hypot(f.x - g.cx, f.y - g.cy), g);
      if (target) { touches.set(f.id, f); f.twist1 = { target, last: Math.atan2(f.y - g.cy, f.x - g.cx), deg: 0, orig: origOf(), k: 0 }; return; }
    }
    const h0 = astroHit(f, g);                   // ▶ и ● работают и вторым пальцем — в пару не идут
    if (h0 && (h0.k === 'play' || h0.k === 'rec' || h0.k === 'grid' || h0.k === 'drift')) { touches.set(f.id, f); f.astro = h0; f.bpm0 = seq.bpm; return; }
    for (const o of touches.values()) {          // второй палец — поворот или щипок (решится по первым ~10° / ~20 px)
      if (o === f || o === ringF || two || o.twist1 || (o.astro && (o.astro.k === 'play' || o.astro.k === 'rec' || o.astro.k === 'grid' || o.astro.k === 'drift'))) continue;   // ▶ и ● — не в пару
      startTwo(o, f, g);
      return;
    }
    const h = astroHit(f, g);
    if (h) { touches.set(f.id, f); f.astro = h; f.bpm0 = seq.bpm; return; }
    if (Math.hypot(f.x - g.cx, f.y - g.cy) > g.rMax) { touches.set(f.id, f); f.away = true; return; }   // мимо стола: убирает курсор, второй палец — вращение
    touches.set(f.id, f);
    const b = BOWS_ON ? bowAt(f, g) : null;
    if (b) { f.cb = b; return; }
    const mk = seq.rec || (cursor != null && !seq.playing) ? -1 : markAt(f, g);   // при записи и пошаговом вводе метки не мешают: тап в ту же точку — снова пишется
    if (mk >= 0) {                              // тап по метке звучит сразу; повёл — тащишь метку
      f.mk = mk;
      const st = seq.melody.steps[mk], note = notesOf([st])[0];
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
    starPush(p, performance.now()); answer(note);
    recordHit(p.x, p.y);
    if (stepRec) {                                // запись по шагам: удар — в шаг ритма, место — в шаг мелодии; оба курсора дальше
      seq.rhythm.steps[stepRec.r] = { vel: 1 }; seq.melody.steps[stepRec.m] = { x: p.x, y: p.y };
      stepRec.r = (stepRec.r + 1) % seq.rhythm.len; stepRec.m = (stepRec.m + 1) % seq.melody.len;
      sendSeq();
    }
    if (cursor != null && !seq.playing && !stepRec) {   // пошаговый ввод: место — в гнездо курсора, курсор дальше
      const len = seq.melody.len;
      seq.melody.steps[cursor % len] = { x: p.x, y: p.y };
      cursor = (cursor % len + 1) % len;
      fillRhythm();
      sendSeq();
    }
  }
  function move(f) {
    if (!touches.has(f.id)) return;
    if (f === ringF) { T.menuMove(f); return; }
    const g = plateGeo();
    if (f.astro) { astroMove(f, g); return; }
    if (f.mk != null && f.moved) {               // метку тащишь — место меняется
      const st = seq.melody.steps[f.mk];
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
      const st = seq.melody.steps[f.mk];
      if (st && f.moved && Math.hypot(st.x, st.y) > 1.05) { seq.melody.steps[f.mk] = null; sendSeq(); }   // за край — место удалено, шаг — пауза
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
    if (f.away) {
      if (stepRec && Math.hypot(f.x - f.x0, f.y - f.y0) < TAP_MOVE) {   // запись по шагам: тап мимо пластины — пауза, курсоры дальше
        seq.rhythm.steps[stepRec.r] = null; stepRec.r = (stepRec.r + 1) % seq.rhythm.len; stepRec.m = (stepRec.m + 1) % seq.melody.len; sendSeq();
        return;
      }
      cursor = null; return;
    }
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
  const DRIFT_SECTORS = [
    { key: 'depth', label: 'depth', ang: -Math.PI / 2 },
    { key: 'rate', label: 'rate', ang: -Math.PI / 6 - Math.PI / 3, marks: DRIFT_RATES.map((r) => r[0]) },
    { key: 'shape', label: 'shape', ang: -Math.PI / 6 },
  ];
  function openDrift() {                          // плашка луны снизу (как FX): depth, rate, sine ↔ random
    T.openSheet({
      title: 'luna', hint: 'plate drift — tap outside to close', rows: DRIFT_SECTORS,
      get: (k) => drift[k],
      set: (k, t) => { drift[k] = t; if (!drift.on) { drift.on = true; drift.t0 = performance.now(); drift.last = -1; } },
      text: (k) => (k === 'depth' ? `±${driftDepth()} steps` : k === 'rate' ? driftRate()[0] : drift.shape < 0.5 ? 'sine' : 'random'),
    });
  }
  function driftTick(now) {                       // луна качает пластину: новая ступень — пластина и ноты едут
    if (!drift.on) { if (drift.k) { drift.k = 0; send({ t: 'f0', hz: effF0() }); sendSeq(); } return; }
    const per = (driftRate()[1] * 60000) / seq.bpm, ph = (now - drift.t0) / per, D = driftDepth();
    let k;
    if (drift.shape < 0.5) k = Math.round(D * Math.sin(ph * Math.PI * 2));
    else { const n = Math.floor(ph * 2); if (n !== drift.last) { drift.last = n; drift.rk = Math.round((Math.random() * 2 - 1) * D); } k = drift.rk || 0; }   // random — новая ступень дважды за период
    if (k !== drift.k) { drift.k = k; send({ t: 'f0', hz: effF0() }); if (seq.melody.steps.some(Boolean)) sendSeq(); }
  }
  // каждый кадр: держишь дольше 150 мс — удар становится смычком; держишь метку — кольцо
  function tick(now) {
    driftTick(now);
    if (scaleKey() !== sentKey && seq.melody.steps.some(Boolean)) sendSeq();   // лад сменили (здесь, в Tenebrae или отменой) — ноты в worklet заново
    const g = plateGeo();
    for (const f of touches.values()) {
      if (BOWS_ON && f.live && !f.bowing && now - f.t0 > BOW_AFTER) {
        const p = toPlate(f, g);
        f.bowing = true;
        send({ t: 'bow', id: f.bid, x: p.x, y: p.y, on: true, exciter: 0, pressure: 0.5, amp: 0.8 });
      }
      if (f.cb && !f.moved && !f.menu && now - f.t0 > T.HOLD_MS) openRing(f);
      if (f.astro && f.astro.k === 'drift' && !f.menu && !f.moved && now - f.t0 > T.HOLD_MS) { f.menu = true; openDrift(); }   // зажал луну — плашка: глубина, такт, форма
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
      { key: 'damping', label: 'damping', ang: deg(165) },
      { key: 'brightness', label: 'brightness', ang: deg(150) },
      { key: 'hall', label: 'hall', ang: deg(135) },
      { key: 'echo', label: 'echo', ang: deg(120) },
      { key: 'chance', label: 'chance', ang: deg(105) },
      { key: 'time', label: 'time', ang: deg(90), marks: ECHO_DIVS.map((d) => d[0]) },
    ],
    get: (k) => plate.fx[k],
    set: (k, t) => { plate.fx[k] = t; if (k === 'chance') sendSeq(); else if (k === 'hall' || k === 'echo' || k === 'time') applyFx(); else sendParams(); },
    text: (k) => {
      const v = plate.fx[k];
      if (k === 'structure') return STRUCT[Math.round(v * (STRUCT.length - 1))];
      if (k === 'time') return echoDiv()[0];
      if (k === 'damping') { const s = 0.08 * 150 ** v; return `${s.toFixed(s < 10 ? 1 : 0)} s`; }
      return `${Math.round(v * 100)}%`;
    },
    arc: () => plate.fx.hall,
    save: () => ({ ...plate.fx }),
    load: (o) => { Object.assign(plate.fx, { chance: 1 }, o); sendParams(); applyFx(); sendSeq(); },
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
  // клетки ханга: сетка видна всегда; клетка горит, пока звучит её нота (гейт — по уровню голоса из worklet: −50…−10 дБ);
  // названия нот — только пока играешь (палец на пластине, метка, бусина, жест, секунда после щипка)
  const glowOf = (lv) => clamp((10 * Math.log10(lv + 1e-20) + 50) / 40);
  function litCells() {                          // 'кольцо,сектор' → яркость
    const out = new Map(), list = noteList(), b = nearestIdx(list, fs()), n = degPerOct();
    for (const v of voices) {
      const gl = glowOf(v.level);
      if (gl < 0.02) continue;
      const s = 12 * Math.log2(v.hz / F_MIN), cl = cellOf(list.findIndex((x) => Math.abs(x - s) < 0.05), b, n);
      if (!cl) continue;                         // нота не из раскладки (удар без клетки) — не горит
      const key = `${cl.ring},${cl.sector}`;
      out.set(key, Math.max(out.get(key) || 0, gl));
    }
    return out;
  }
  function showNotes(now) {
    return !!two || now < labelUntil || [...touches.values()].some((f) => f.live || f.mk != null || (f.astro && f.astro.k === 'mtick'));
  }
  const RINGS = [1, Math.sqrt(2 / 3), Math.sqrt(1 / 3), 0];   // границы колец: край, 0|1, 1|2, центр
  function cellPath(c, g, ring, sector, n) {     // контур клетки: дуга снаружи, дуга внутри, два луча
    const a0 = (sector / n) * Math.PI * 2 - Math.PI / 2, a1 = ((sector + 1) / n) * Math.PI * 2 - Math.PI / 2;
    const ro = RINGS[ring] * g.r, ri = RINGS[ring + 1] * g.r;
    c.beginPath(); c.arc(g.cx, g.cy, ro, a0, a1);
    if (ri > 0) c.arc(g.cx, g.cy, ri, a1, a0, true); else c.lineTo(g.cx, g.cy);
    c.closePath();
  }
  function drawCells(g, now) {
    const c = T.g, n = degPerOct();
    c.strokeStyle = T.ink(0.25); c.lineWidth = 1; c.beginPath();
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 - Math.PI / 2;
      c.moveTo(g.cx, g.cy); c.lineTo(g.cx + Math.cos(a) * g.r, g.cy + Math.sin(a) * g.r);
    }
    for (const r of [RINGS[1], RINGS[2]]) { c.moveTo(g.cx + r * g.r, g.cy); c.arc(g.cx, g.cy, r * g.r, 0, Math.PI * 2); }
    c.stroke();
    for (const [key, gl] of litCells()) {        // звучит — клетка светится и гаснет вместе с нотой
      const [ring, sector] = key.split(',').map(Number);
      cellPath(c, g, ring, sector, n);
      c.fillStyle = T.ink(0.12 * gl); c.fill();
      c.strokeStyle = T.ink(0.3 + 0.6 * gl); c.lineWidth = 1 + 0.6 * gl; c.stroke();
    }
    if (!showNotes(now)) return;
    const list = noteList(), b = nearestIdx(list, fs());
    for (let ring = 0; ring < 3; ring++) {
      for (let s = 0; s < n; s++) {
        const note = list[b + ring * n + s];
        if (note == null) continue;              // за 1760 Гц — без подписи
        const p = cellCenter(ring, s, n), x = g.cx + p.x * g.r, y = g.cy + p.y * g.r;
        c.fillStyle = 'rgba(0,0,0,0.6)'; c.beginPath(); c.arc(x, y, 9, 0, Math.PI * 2); c.fill();
        T.mapText(noteName(F_MIN * 2 ** (note / 12)), x, y, 10, 0.5, 'center');
      }
    }
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
      const rot = ring === 'rhythm' ? tr : tm, len = seq[ring].len, a0 = slotAng(-0.5) + rot, a1 = slotAng(len - 0.5) + rot;
      const held = [...touches.values()].some((f) => f.astro && f.astro.k === 'len' && f.astro.ring === ring);
      c.strokeStyle = T.ink(held ? 0.2 : 0.09); c.lineWidth = w;   // рисуется до бусин и точек — под ними
      c.beginPath(); c.arc(g.cx, g.cy, R, a0, a1 - (len === SLOTS ? 1e-4 : 0)); c.stroke();
      c.strokeStyle = T.ink(held ? 1 : 0.7); c.lineWidth = held ? 2 : 1.4;   // край заливки — за него тянуть
      c.beginPath(); c.moveTo(g.cx + Math.cos(a1) * (R - w / 2), g.cy + Math.sin(a1) * (R - w / 2)); c.lineTo(g.cx + Math.cos(a1) * (R + w / 2), g.cy + Math.sin(a1) * (R + w / 2)); c.stroke();
      const q = { x: g.cx + Math.cos(a1 + 0.09) * R, y: g.cy + Math.sin(a1 + 0.09) * R };
      T.mapText(String(len), q.x, q.y, 12, held ? 1 : 0.6, 'center');
    }
    // ритм: удар — крупная точка, пустое гнездо — колечко; мелодия — название ноты у гнезда, пусто — «·»;
    // играющий шаг мигает (точка и нота вспыхивают), новое в гнезде — расходящийся круг
    const blink = (t) => Math.max(0, 1 - (now - t) / 220), notes = notesOf(seq.melody.steps);
    for (let i = 0; i < SLOTS; i++) {
      let a = slotAng(i) + tr, x = Math.cos(a), y = Math.sin(a);
      const onR = i < seq.rhythm.len, onM = i < seq.melody.len, st = seq.rhythm.steps[i], s = notes[i];
      const lg = i % grid === 0 ? 7 : 4;          // доли сетки записи — засечки длиннее
      c.strokeStyle = T.ink(onR ? 0.45 : 0.12); c.lineWidth = 1;
      c.beginPath(); c.moveTo(g.cx + x * (A.R2 + 8), g.cy + y * (A.R2 + 8)); c.lineTo(g.cx + x * (A.R2 + 8 + lg), g.cy + y * (A.R2 + 8 + lg)); c.stroke();
      const rx = g.cx + x * A.R2, ry = g.cy + y * A.R2, br = blink(pulse.r[i]);
      if (st && onR) {
        const ch = st.chance ?? 1;                 // шанс < 100 % — точка меньше и бледнее, вокруг пунктир
        T.dot(rx, ry, (5.5 + 3 * br) * (0.55 + 0.45 * ch), 0.45 + 0.55 * ch); if (br) T.ring(rx, ry, 10 + 6 * (1 - br), br, 1.6);
        if (ch < 1) { c.save(); c.setLineDash([1.5, 2.5]); T.ring(rx, ry, 8, 0.6, 1); c.restore(); }
      }
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
    for (let i = 0; i < SLOTS; i++) {            // метки мест мелодии на пластине; вспыхивает та, по которой бьёт удар
      const st = seq.melody.steps[i];
      if (!st) continue;
      const p = fromPlate(st, g), hot = seq.playing && lastStep && lastStep.m === i && seq.rhythm.steps[lastStep.r] && now - lastStep.atMs < 160;
      if (hot) T.ring(p.x, p.y, 7, 0.9, 1.2);
      T.dot(p.x, p.y, 2.2, i < seq.melody.len ? 0.8 : 0.25);
    }
    // ▶/■ и ●
    for (const x of [A.playX, A.recX, A.gridX, A.driftX]) {
      c.fillStyle = 'rgba(0,0,0,0.88)'; c.beginPath(); c.arc(x, A.ty, 18, 0, Math.PI * 2); c.fill();
      T.ring(x, A.ty, 17, 0.45, 1.2);
    }
    {                                              // луна на орбите вокруг пластины: ширина орбиты — глубина, место на ней и фаза — где сейчас пластина в качании
      const x0 = A.driftX, y0 = A.ty, a = drift.on ? 0.95 : 0.45, ph = drift.on ? clamp(drift.k / Math.max(1, driftDepth()), -1, 1) : 0.6;
      const ox = 6 + 8 * drift.depth, oy = ox * 0.5, r = 3.4;
      c.setLineDash([1.5, 2.5]); c.strokeStyle = T.ink(a * 0.5); c.lineWidth = 1; c.beginPath(); c.ellipse(x0, y0, ox, oy, 0, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
      T.dot(x0, y0, 1.6, a * 0.7);                                       // пластина
      const x = x0 + ph * ox, y = y0 - Math.sqrt(Math.max(0, 1 - ph * ph)) * oy;
      c.fillStyle = 'rgba(0,0,0,1)'; c.beginPath(); c.arc(x, y, r + 1.5, 0, Math.PI * 2); c.fill();
      T.ring(x, y, r, a, 1);
      c.fillStyle = T.ink(a * 0.8); c.beginPath(); c.arc(x, y, r, -Math.PI / 2, Math.PI / 2); c.ellipse(x, y, Math.abs(ph) * r, r, 0, Math.PI / 2, -Math.PI / 2, ph > 0); c.fill();
      if (drift.on && drift.shape >= 0.5) { T.dot(x0 - 11, y0 - 10, 1.2, 0.7); T.dot(x0 + 11, y0 - 10, 1.2, 0.7); }   // random — две звёздочки
    }
    {                                              // подписи под кнопками — тихо, латынью
      const cy = A.ty + 30;
      T.mapText(`${seq.bpm} bpm`, A.playX, cy, 12, 0.5, 'center');
      if (!stepRec) T.mapText(seq.playing ? 'scribe' : 'per gradus', A.recX, cy, 12, seq.rec ? 0.85 : 0.5, 'center');
      T.mapText('grid', A.gridX, cy, 12, 0.5, 'center');
      T.mapText(drift.on ? `luna ±${driftDepth()}` : 'luna', A.driftX, cy, 12, drift.on ? 0.75 : 0.5, 'center');
    }
    if (stepRec) {                                 // запись по шагам: курсоры на обоих кольцах, подпись
      const pr = slotXY(g, stepRec.r, A.R2), pm = slotXY(g, stepRec.m, A.R1);
      T.ring(pr.x, pr.y, 12, 0.9, 1.4); T.ring(pm.x, pm.y, 15, 0.9, 1.4);
      T.mapText(`step ${stepRec.r + 1} · ${stepRec.m + 1}`, A.recX, A.ty + 30, 13, 0.75, 'center');
    }
    if (chanceEdit && now < chanceEdit.until && seq.rhythm.steps[chanceEdit.i]) {
      const p = slotXY(g, chanceEdit.i, A.R2 + 26);
      T.mapText(`chance ${Math.round((seq.rhythm.steps[chanceEdit.i].chance ?? 1) * 100)}%`, p.x, p.y, 13, 0.9, 'center');
    }
    c.strokeStyle = T.ink(0.85); c.lineWidth = 1.2; c.beginPath();
    if (seq.playing) c.rect(A.playX - 5, A.ty - 5, 10, 10);
    else { c.moveTo(A.playX - 4, A.ty - 6); c.lineTo(A.playX + 5, A.ty); c.lineTo(A.playX - 4, A.ty + 6); c.closePath(); }
    c.stroke();
    if (seq.rec) T.dot(A.recX, A.ty, 5, 0.95); else if (stepRec) { T.ring(A.recX, A.ty, 5, 0.95, 1.4); T.dot(A.recX, A.ty, 2, 0.95); } else T.ring(A.recX, A.ty, 5, 0.6, 1.2);
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
    const ak = (performance.now() - answerAt) / 1400;   // отозвался своей нотой — подпись проступает на шаре
    if (ak >= 0 && ak < 1) { T.ring(x, y, 38 + 8 * ak, 0.5 * (1 - ak), 1); T.mapText(answerNote, x - 18, y - 16, 15, 0.95 * (1 - ak), 'center'); }
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
    tempo: { set: (bpm) => { seq.bpm = bpm; sendSeq(); }, play: (on) => { if (on !== seq.playing) play(on); } },   // общие часы (карта → concordia)
    enter() { entered = true; start(); },
    draw(now, dt) {
      const c = T.g, g = plateGeo();
      c.drawImage(wavesLayer(), 0, 0, T.W, T.H);   // фон с волнами — одной готовой картинкой
      drawPlate(g);
      shownF0 += (effF0() - shownF0) * (1 - Math.exp(-(dt || 1 / 60) / 0.08));   // пластина плавно доезжает до размера
      drawCells(g, now);
      drawStars(g, now);
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
    dice() {                                     // генеративный узор: ритм по Евклиду, мелодия другой длины по ладу — полиритм; часы идут
      const R = Math.random, n = 8 + Math.floor(R() * 9), k = 3 + Math.floor(R() * (n - 4)), e = euclid(k, n);
      let m = 3 + Math.floor(R() * 6);
      while (n % m === 0) m++;                   // длина мелодии не делит ритм — ноты ложатся на удары по-новому каждый круг
      const list = noteList(), b = nearestIdx(list, fs()), dn = degPerOct();   // ноты — блуждание по ладу по всем трём кольцам
      const span = list.slice(b, Math.min(b + 3 * dn, list.length));          // со случайной ноты — иначе от края до центра не дойдёт
      const w = walkMelody(m, span[Math.floor(R() * span.length)], span);
      seq.rhythm = { len: n, steps: Array.from({ length: SLOTS }, (_, i) => (i < n && e[i] ? { vel: 1 } : null)) };
      seq.melody = { len: m, steps: Array.from({ length: SLOTS }, (_, i) => {
        if (i >= m) return null;
        const cl = cellOf(list.indexOf(w[i]), b, dn), p = cellCenter(cl.ring, cl.sector, dn);
        const r = Math.hypot(p.x, p.y) + (R() - 0.5) * 0.1, a = Math.atan2(p.y, p.x) + (R() - 0.5) * 0.6 * ((Math.PI * 2) / dn);   // сдвиг внутри клетки — тембр разный
        return { x: r * Math.cos(a), y: r * Math.sin(a) };
      }) };
      seq.playing = true; stepRec = null;
      sendSeq(); T.transportFrom(2, true);
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
      drift: { on: drift.on, depth: drift.depth, rate: drift.rate, shape: drift.shape },
    }),
    restore(js) {
      const st = JSON.parse(js);
      detach();
      for (const b of plate.bows) sendBow(b, false);
      plate.f0 = st.f0; Object.assign(plate.fx, { chance: 1 }, st.fx);
      if (st.drift) Object.assign(drift, st.drift); drift.k = 0; stepRec = null;
      plate.bows = st.bows.map((b) => ({ ...b, id: `b${bowId++}` }));
      seq.bpm = st.seq.bpm;
      seq.rhythm = { len: st.seq.rhythm.len, steps: st.seq.rhythm.steps.slice() };
      seq.melody = { len: st.seq.melody.len, steps: st.seq.melody.steps.slice() };
      send({ t: 'f0', hz: effF0() }); sendParams(); applyFx(); sendSeq();
      for (const b of plate.bows) sendBow(b, true);
    },
    sounding: () => touches.size > 0 || plate.bows.length > 0 || level > 1e-4 || (seq.playing && seq.rhythm.steps.some(Boolean) && seq.melody.steps.some(Boolean)),
  };
  T.registerWorld(2, cymatica);

  // отладка и тесты: window.t2d.cym
  window.t2d.cym = {
    get ready() { return ready; }, get f0() { return plate.f0; }, get fx() { return { ...plate.fx }; },
    get bows() { return plate.bows.map((b) => ({ ...b })); }, get energy() { return Array.from(energy); },
    get ringOpen() { return !!ringF; }, get live() { return [...touches.values()].filter((f) => f.bowing).length; },
    get geo() { return plateGeo(); },
    get seq() { return JSON.parse(JSON.stringify(seq)); }, get notes() { return notesOf(seq.melody.steps); },   // notes — ноты мест мелодии
    get sentSeq() { return JSON.parse(JSON.stringify(sentSeq)); }, get base() { return nearestIdx(noteList(), fs()); },
    get lastStep() { return lastStep; },
    play, rec,
    get astro() { const g = plateGeo(); return { ...astro(g), cx: g.cx, cy: g.cy }; },
    load(o) {                                    // готовый узор (рендер, отладка)
      const pad = (a) => Array.from({ length: SLOTS }, (_, i) => (a[i] === undefined ? null : a[i]));
      if (o.bpm) seq.bpm = o.bpm;
      if (o.rhythm) seq.rhythm = { len: o.rhythm.len, steps: pad(o.rhythm.steps) };
      if (o.melody) seq.melody = { len: o.melody.len, steps: pad(o.melody.steps) };
      if (o.fx) fxw.load(o.fx);
      sendSeq();
    },
    core: { euclid, nearestStep, walkMelody, rotateSteps, twistOrPinch, noteList, degPerOct, cellIdx, noteAt, cellOf, cellCenter, transposeHits, scaleSemis, snapToGrid, quantizeRhythm },
    get echo() { return { label: echoDiv()[0], sec: echoSec(), fb: echoFb() }; }, get echoMax() { return echoes.length ? echoes[echoes.length - 1].dL.delayTime.maxValue : 0; },
    get echoChains() { return echoes.map((p) => ({ sec: p.sec, real: p.dL.delayTime.value })); },
    get gesture() { return gesture; }, get shownF0() { return shownF0; }, bowsOn: BOWS_ON, get ringTurn() { return { ...ringTurn }; }, get grid() { return grid; }, get waveStep() { return waveStep(); },
    get cursor() { return cursor; }, get stepRec() { return stepRec && { ...stepRec }; }, get drift() { return { ...drift }; }, get effF0() { return effF0(); }, get stars() { return stars.length; }, get answerAt() { return answerAt; }, get lit() { return [...litCells().keys()]; }, get bornM() { return Array.from(born.m); }, get showNotes() { return showNotes(performance.now()); }, get lastStrike() { return lastStrike; },
    strike(x, y) { send({ t: 'strike', x, y, vel: 1, hard: 0.5 }); },
    bow(x, y, on = true) { send({ t: 'bow', id: 'dbg', x, y, on, exciter: 0, pressure: 0.5, amp: 0.8 }); },
  };
})();
