// Goetia — мир XV (в Таро XV — Дьявол): круг заклинателя из «Малого ключа Соломона». Звук — bytebeat (goetia-worklet.js):
// формула от счётчика t. На круге восемь узлов, у каждого знак (| & ^ + × − % ») и сдвиг (IV…XI). Ведёшь пальцем от узла
// к узлу — чертишь печать; со второго узла дух уже звучит, каждый новый узел дописывает в формулу член (t >> сдвиг) через свой знак.
// Печать сама называет духа (один из 72), он встаёт в треугольник над кругом. Духов — до трёх, у каждого свой цвет; четвёртый
// изгоняет самого старого. Тап по треугольнику — изгнать; тянешь вверх-вниз — выше/ниже (и тон, и ритм); держишь — плашка
// (pitch, tone, release, legio, level); вбок — release: влево — треск и удары (на подъёме бита самого медленного узла, не чаще бита IX; четыре на круг огонька), вправо —
// дольше, до ровного дрона. Узлы печати мигают своими битами: медленный сдвиг — ритм, быстрый — ровный свет; по печати бежит
// огонёк — цикл самого медленного члена. FX: legio (хор расходится по фазе), echo, spread, hall. Медный сосуд в углу — карта.
(() => {
  'use strict';
  const T = window.T2D;
  const TAU = Math.PI * 2;
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const INK = '226,214,190', BGC = '#0c0807', PAPER = '12,8,7';
  const SLOTC = [[206, 66, 48], [224, 184, 100], [168, 190, 214]];        // кровь, золото, серебро
  const BRASS = [196, 150, 82];
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const NOTES = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];
  const SMAX = 3, PMAX = 8;
  // узлы по кругу от верха по часовой: знак (как соединяется с набранным) и сдвиг члена t >> s
  const NODES = [['|', 8], ['&', 5], ['^', 10], ['+', 6], ['*', 11], ['-', 4], ['%', 9], ['>', 7]].map(([op, s]) => ({ op, s }));
  const GLYPH = { '|': '|', '&': '&', '^': '^', '+': '+', '*': '×', '-': '−', '%': '%', '>': '»' };
  const OPTXT = { '|': '|', '&': '&', '^': '^', '+': '+', '*': '*', '-': '-', '%': '%', '>': '>>' };
  const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
  const RANK = { R: 'rex', D: 'dux', P: 'princeps', M: 'marchio', S: 'praeses', C: 'comes', E: 'eques' };
  const SPIRITS = ('Bael R,Agares D,Vassago P,Samigina M,Marbas S,Valefor D,Amon M,Barbatos D,Paimon R,Buer S,Gusion D,Sitri P,Beleth R,Leraje M,Eligos D,Zepar D,' +
    'Botis S,Bathin D,Sallos D,Purson R,Marax C,Ipos C,Aim D,Naberius M,Glasya-Labolas S,Bune D,Ronove M,Berith D,Astaroth D,Forneus M,Foras S,Asmoday R,' +
    'Gaap S,Furfur C,Marchosias M,Stolas P,Phenex M,Halphas C,Malphas S,Raum C,Focalor D,Vepar D,Sabnock M,Shax M,Vine R,Bifrons C,Vual D,Haagenti S,' +
    'Crocell D,Furcas E,Balam R,Alloces D,Camio S,Murmur D,Orobas P,Gremory D,Ose S,Amy S,Oriax M,Vapula D,Zagan R,Volac S,Andras M,Haures D,' +
    'Andrealphus M,Cimejes M,Amdusias D,Belial R,Decarabia M,Seere P,Dantalion D,Andromalius C').split(',').map((q) => { const [n, r] = q.split(' '); return { name: n, rank: RANK[r] }; });

  // ---------- состояние ----------
  const spirits = [];                                     // {slot, path [узлы], semi, tone, rel, legio, lvl, born, t0, tAt, g}
  const fx = { legio: 0.35, echo: 0.2, spread: 0.6, hall: 0.4 };
  let gains = new Array(SMAX).fill(0);
  const numOf = (path) => 1 + (path.reduce((h, k) => (h * 8 + k + 1) % 7919, path.length * 13) % 72);   // печать сама называет духа
  const spiritOf = (s) => SPIRITS[numOf(s.path) - 1];
  const semiOf = (s) => (T.scaleOn ? T.snapSemi(s.semi + 24) - 24 : s.semi);
  const rateOf = (s) => 128 * 55 * 2 ** (semiOf(s) / 12);                  // semi 0 — 7 040 отсчётов t в секунду
  const fcOf = (s) => 250 * (12000 / 250) ** s.tone;
  const relText = (s) => { if (s.rel >= 0.97) return 'drone'; const t = 0.004 * 500 ** s.rel; return t < 1 ? `${Math.round(t * 1000)} ms` : `${t.toFixed(1)} s`; };
  const trigOf = (s) => Math.max(9, ...s.path.map((k) => NODES[k].s));   // удар — по самому медленному члену (не чаще, чем бит IX): четыре удара на круг огонька
  const noteName = (st) => { const m = Math.round(st); return `${NOTES[((m % 12) + 12) % 12]}${Math.floor((m + 9) / 12) + 1}`; };
  function formula(path) {                                // как её читать: свёртка слева, t·(…) & 255
    if (!path.length) return '';
    let str = `t>>${NODES[path[0]].s}`;
    for (let i = 1; i < path.length; i++) { const n = NODES[path[i]], term = n.op === '>' ? `(t>>${n.s}&7)` : '+-*%'.includes(n.op) ? `(t>>${n.s})` : `t>>${n.s}`; str = `${i > 1 ? `(${str})` : str}${OPTXT[n.op]}${term}`; }
    return `t*(${str})`;
  }

  // ---------- геометрия: треугольники вызова наверху, круг под ними, сосуд в углу ----------
  function geo() {
    const W = T.W, H = T.H, top = T.topY + 6, bot = H - T.safeBot - 8, Ws = Math.min(W, (H - T.safeBot) * 0.62), cx = W / 2;
    const ts = Math.min(Ws * 0.11, 40), triB = ts * 1.5 + 50, gap = 34;          // блок: треугольники с именами, зазор, круг, строка формулы
    const R = Math.max(80, Math.min(Ws / 2 - 12, (bot - 70 - top - triB - gap - 34) / 2));
    const y0 = top + Math.max(4, (bot - 70 - top - (triB + gap + 2 * R + 34)) / 2), triY = y0 + ts, cy = y0 + triB + gap + R;
    const Rn = R * 0.64;
    const tris = [0, 1, 2].map((k) => ({ x: cx + (k - 1) * Ws * 0.31, y: triY }));
    return { W, H, top, bot, cx, cy, R, Rn, Ws, ts, tris, vessel: { x: cx - Ws / 2 + 30, y: bot - 26, r: 30 } };
  }
  const nodeXY = (G, k) => { const a = -Math.PI / 2 + (k / 8) * TAU; return { x: G.cx + Math.cos(a) * G.Rn, y: G.cy + Math.sin(a) * G.Rn }; };
  function nodeAt(G, x, y, r = 24) { let best = -1, bd = r; for (let k = 0; k < 8; k++) { const p = nodeXY(G, k), d = Math.hypot(x - p.x, y - p.y); if (d < bd) { bd = d; best = k; } } return best; }
  function triAt(G, x, y) { for (const s of spirits) { const p = G.tris[s.slot]; if (Math.hypot(x - p.x, y - p.y) < G.ts * 1.1) return s; } return null; }

  // ---------- звук ----------
  let actx = null, node = null, bus = null, ready = false, started = false, lastSound = 0;
  const queue = [];
  const send = (m) => { if (node && ready) node.port.postMessage(m); else queue.push(m); };
  const VER = (document.currentScript && new URL(document.currentScript.src, location.href).searchParams.get('v')) || '0';
  function build(ctx, input) {
    actx = ctx;
    const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const pre = g(1), out = g(1.6), hallSend = g(0), h = T.hall(), echoSend = g(0), dl = ctx.createDelay(1.5), fb = g(0), damp = ctx.createBiquadFilter();
    dl.delayTime.value = 0.375; damp.type = 'lowpass'; damp.frequency.value = 2600;
    pre.connect(out); pre.connect(hallSend); hallSend.connect(h.input); h.out.connect(g(0.9)).connect(out);
    pre.connect(echoSend); echoSend.connect(dl); dl.connect(damp); damp.connect(fb); fb.connect(dl); damp.connect(out);
    bus = { pre, out, hallSend, hall: h, echoSend, fb, input, live: false };
    ready = false; node = null; started = false;
    applyFx();
  }
  function start() {                                       // модуль — только когда в мир впервые зашли
    if (started || !actx) return;
    started = true;
    actx.audioWorklet.addModule(`goetia-worklet.js?v=${VER}`).then(() => {
      node = new AudioWorkletNode(actx, 'goetia', { numberOfInputs: 0, outputChannelCount: [2] });
      node.connect(bus.pre);
      node.port.onmessage = (e) => {
        const d = e.data;
        if (d.t !== 'p') return;
        const now = performance.now();
        for (const s of spirits) { s.t0 = d.tt[s.slot]; s.tAt = now; }
        gains = d.g;
      };
      ready = true;
      applyFx();
      for (const s of spirits) sendSpirit(s);
      while (queue.length) node.port.postMessage(queue.shift());
    }).catch(() => { started = false; });
  }
  function setLive(on) {
    if (!bus || bus.live === on) return;
    bus.live = on;
    if (on) bus.out.connect(bus.input); else bus.out.disconnect();
  }
  setInterval(() => {
    if (!bus) return;
    if (spirits.length || gains.some((x) => x > 0.002)) lastSound = performance.now();
    else if (performance.now() - lastSound > 9000) setLive(false);
  }, 1000);
  function applyFx() {
    if (!bus) return;
    const t = actx.currentTime;
    bus.hallSend.gain.setTargetAtTime(fx.hall * fx.hall * 1.5, t, 0.05);
    for (const l of bus.hall.lines) l.g.gain.setTargetAtTime(10 ** ((-3 * l.len) / (1.5 + fx.hall * 5)), t, 0.05);
    bus.echoSend.gain.setTargetAtTime(fx.echo * 0.8, t, 0.05); bus.fb.gain.setTargetAtTime(fx.echo * 0.55, t, 0.05);
    send({ t: 'fx', spread: fx.spread, wide: fx.legio });
  }
  function sendSpirit(s, on = true) {
    const sr = actx ? actx.sampleRate : 48000;
    send({ t: 'voice', i: s.slot, on, prog: s.path.map((k) => [NODES[k].op, NODES[k].s]), rate: rateOf(s), lp: 1 - Math.exp((-TAU * fcOf(s)) / sr), lvl: s.lvl * 0.3, legio: s.legio, rel: s.rel, trig: trigOf(s), pan: [-0.6, 0, 0.6][s.slot] });
    if (on) { setLive(true); lastSound = performance.now(); }
  }
  function summon(path, opt = {}) {                        // дух в свободный треугольник; все заняты — уходит самый старый
    start();
    const used = new Set(spirits.map((s) => s.slot));
    let slot = [...Array(SMAX).keys()].find((k) => !used.has(k));
    if (slot == null) { const old = spirits.reduce((a, b) => (a.born < b.born ? a : b)); slot = old.slot; banish(old); }
    const s = { slot, path: [...path], semi: 0, tone: 0.45, rel: 1, legio: 1, lvl: 0.8, born: performance.now() + ++bornSeq * 1e-3, t0: 0, tAt: performance.now(), ...opt };
    spirits.push(s); sendSpirit(s);
    return s;
  }
  function banish(s) { T.lfoClear(`goe-s${s.slot}-${s.born}`); sendSpirit(s, false); spirits.splice(spirits.indexOf(s), 1); }
  let bornSeq = 0;                                         // порядок призыва — кто старше (born растёт строго)
  const sounding = () => spirits.length > 0;
  const tNow = (s, now) => s.t0 + (rateOf(s) * (now - s.tAt)) / 1000;

  // ---------- касания ----------
  const touches = new Map();
  let drawing = null;                                     // {s | null, path, x, y} — печать, которую сейчас чертят
  function down(f) {
    start();
    const G = geo(), now = performance.now(), tri = triAt(G, f.x, f.y);
    if (tri) { touches.set(f.id, { kind: 'tri', s: tri, x0: f.x, y0: f.y, semi0: tri.semi, rel0: tri.rel, t0: now, moved: false, axis: null }); return; }
    const k = nodeAt(G, f.x, f.y);
    if (k >= 0 && !drawing) { drawing = { s: null, path: [k], x: f.x, y: f.y }; touches.set(f.id, { kind: 'seal' }); return; }
    touches.set(f.id, { kind: 'none' });
  }
  function move(f) {
    const t = touches.get(f.id);
    if (!t) return;
    if (t.kind === 'seal' && drawing) {
      drawing.x = f.x; drawing.y = f.y;
      const G = geo(), k = nodeAt(G, f.x, f.y, 20), P = drawing.path;
      if (k >= 0 && k !== P[P.length - 1] && P.length < PMAX) {
        P.push(k);
        if (!drawing.s || !spirits.includes(drawing.s)) drawing.s = summon(P);   // со второго узла — уже звучит
        else { drawing.s.path = [...P]; sendSpirit(drawing.s); }
      }
      return;
    }
    if (t.kind === 'tri' && !t.sheet) {
      const dx = f.x - t.x0, dy = f.y - t.y0;
      if (!t.moved && Math.hypot(dx, dy) > 8) { t.moved = true; t.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'; }   // ось — по первому движению
      if (!t.moved || !spirits.includes(t.s)) return;
      if (t.axis === 'x') { const rel = clamp(t.rel0 + dx / 160); if (Math.abs(rel - t.s.rel) > 0.004) { t.s.rel = rel; sendSpirit(t.s); } return; }   // вбок — release
      const semi = clamp(t.semi0 + Math.round(-dy / 12), -12, 24);
      if (semi !== t.s.semi) { t.s.semi = semi; sendSpirit(t.s); }
    }
  }
  function up(f) {
    const t = touches.get(f.id);
    touches.delete(f.id);
    if (!t) return;
    if (t.kind === 'seal') { drawing = null; return; }
    if (t.kind === 'tri' && !t.moved && !t.sheet && performance.now() - t.t0 < 300 && spirits.includes(t.s)) banish(t.s);   // тап — изгнать
  }
  function tick(now) {
    for (const t of touches.values()) if (t.kind === 'tri' && !t.moved && !t.sheet && now - t.t0 > T.HOLD_MS && spirits.includes(t.s)) { t.sheet = true; spiritSheet(t.s); }
  }
  function spiritSheet(s) {
    const sp = spiritOf(s);
    T.openSheet({
      title: sp.name.toLowerCase(), hint: `${sp.rank} — tap outside to close`,
      rows: [{ key: 'semi', label: 'pitch' }, { key: 'tone', label: 'tone' }, { key: 'rel', label: 'release' }, { key: 'legio', label: 'legio' }, { key: 'lvl', label: 'level' }],
      lfo: { id: `goe-s${s.slot}-${s.born}`, keys: ['semi', 'tone', 'rel', 'lvl'], shapes: 'random' },
      get: (k) => (k === 'semi' ? (s.semi + 12) / 36 : k === 'legio' ? (s.legio - 1) / 3 : s[k]),
      set: (k, v) => { if (!spirits.includes(s)) return; if (k === 'semi') s.semi = Math.round(v * 36) - 12; else if (k === 'legio') s.legio = 1 + Math.round(v * 3); else s[k] = v; sendSpirit(s); },
      text: (k) => (k === 'semi' ? `${noteName(semiOf(s))} · ${(rateOf(s) / 1000).toFixed(1)} kHz` : k === 'tone' ? `${Math.round(fcOf(s))} Hz` : k === 'rel' ? relText(s) : k === 'legio' ? `${s.legio}` : `${Math.round(s.lvl * 100)}%`),
    });
  }

  // ---------- рисование ----------
  const ink = (a) => `rgba(${INK},${a})`;
  const WORDS = ['TETRAGRAMMATON', 'ELOHIM', 'ADONAI', 'SABAOTH', 'AGLA', 'EHEIEH', 'SHADDAI', 'IAH', 'PRIMEUMATON', 'ANAPHAXETON'];
  let wallC = null, wallKey = '';
  function wall(G) {                                      // круг заклинателя: двойное кольцо, имена по кругу, внутренний круг, место в центре, пустые треугольники
    const key = `${G.W}x${G.H}x${T.DPR}|${G.cy}|${G.R}`;
    if (wallC && key === wallKey) return wallC;
    wallKey = key;
    wallC = document.createElement('canvas');
    wallC.width = Math.round(G.W * T.DPR); wallC.height = Math.round(G.H * T.DPR);
    const x = wallC.getContext('2d');
    x.setTransform(T.DPR, 0, 0, T.DPR, 0, 0);
    x.fillStyle = BGC; x.fillRect(0, 0, G.W, G.H);
    const { cx, cy, R } = G;
    x.lineWidth = 1;
    x.strokeStyle = ink(0.85); x.beginPath(); x.arc(cx, cy, R, 0, TAU); x.stroke();
    x.strokeStyle = ink(0.35); x.beginPath(); x.arc(cx, cy, R - 4, 0, TAU); x.stroke();
    x.strokeStyle = ink(0.6); x.beginPath(); x.arc(cx, cy, R - 26, 0, TAU); x.stroke();
    x.strokeStyle = ink(0.22); x.beginPath(); x.arc(cx, cy, R - 29, 0, TAU); x.stroke();
    const words = WORDS.join(' · ') + ' · ', rt = R - 15;     // имена по кругу — каждая буква повёрнута к центру
    let sz = 10; x.font = `${sz}px ${T.MAP}`;
    const need = x.measureText(words).width, room = TAU * rt;
    if (need > room) { sz = Math.max(7, sz * room / need); x.font = `${sz}px ${T.MAP}`; }
    const chars = [...words], step = TAU / chars.length;
    x.fillStyle = ink(0.5); x.textAlign = 'center'; x.textBaseline = 'middle';
    chars.forEach((ch, i) => { const a = -Math.PI / 2 + i * step; x.save(); x.translate(cx + Math.cos(a) * rt, cy + Math.sin(a) * rt); x.rotate(a + Math.PI / 2); x.fillText(ch, 0, 0); x.restore(); });
    x.strokeStyle = ink(0.12); x.beginPath(); for (let k = 0; k < 8; k++) { const p = nodeXY(G, k), q = nodeXY(G, (k + 3) % 8); x.moveTo(p.x, p.y); x.lineTo(q.x, q.y); } x.stroke();   // восьмиугольная звезда — подмалёвок
    x.strokeStyle = ink(0.45); x.beginPath(); x.arc(cx, cy, 9, 0, TAU); x.stroke();   // место заклинателя
    x.beginPath(); x.moveTo(cx - 5, cy); x.lineTo(cx + 5, cy); x.moveTo(cx, cy - 5); x.lineTo(cx, cy + 5); x.stroke();
    x.font = `italic 9px ${T.MAP}`; x.fillStyle = ink(0.32);       // сдвиги узлов римскими — ближе к центру
    for (let k = 0; k < 8; k++) { const a = -Math.PI / 2 + (k / 8) * TAU, r = G.Rn - 24; x.fillText(ROMAN[NODES[k].s], cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
    x.setLineDash([2, 4]); x.strokeStyle = ink(0.16);
    for (const p of G.tris) triPath(x, p.x, p.y, G.ts), x.stroke();
    x.setLineDash([]);
    return wallC;
  }
  function triPath(c, x, y, ts) { c.beginPath(); c.moveTo(x, y - ts); c.lineTo(x + ts * 0.87, y + ts * 0.5); c.lineTo(x - ts * 0.87, y + ts * 0.5); c.closePath(); }
  function sealLine(c, pts, col, a, w, inset = 0) {       // печать: кружок в начале, черта поперёк в конце (в круге — у края узла, inset)
    if (pts.length < 2) return;
    c.strokeStyle = rgba(col, a); c.lineWidth = w; c.beginPath();
    pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.stroke();
    const p0 = pts[0], p1 = pts[1], d0 = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1, r0 = Math.max(2.5, w * 3);
    c.beginPath(); c.arc(p0.x + ((p1.x - p0.x) / d0) * (r0 + inset), p0.y + ((p1.y - p0.y) / d0) * (r0 + inset), r0, 0, TAU); c.stroke();
    const a1 = pts[pts.length - 2], b1 = pts[pts.length - 1], d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y) || 1, ux = (b1.x - a1.x) / d1, uy = (b1.y - a1.y) / d1, bl = r0 * 1.6;
    const bx = b1.x - ux * inset, by = b1.y - uy * inset; c.beginPath(); c.moveTo(bx - uy * bl, by + ux * bl); c.lineTo(bx + uy * bl, by - ux * bl); c.stroke();
  }
  function trimmed(G, path) {                             // точки печати — центры узлов (линии уходят под кружки узлов)
    return path.map((k) => nodeXY(G, k));
  }
  function playhead(G, s, now) {                          // огонёк бежит по печати — один круг на цикл самого медленного члена
    const P = trimmed(G, s.path); if (P.length < 2) return null;
    const sMax = Math.max(...s.path.map((k) => NODES[k].s)), per = 2 ** (Math.max(sMax, 9) + 2);
    const u = (tNow(s, now) / per) % 1, segs = []; let L = 0;
    for (let i = 1; i < P.length; i++) { const l = Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y); segs.push(l); L += l; }
    let d = u * L;
    for (let i = 0; i < segs.length; i++) { if (d <= segs[i]) { const k = d / segs[i]; return { x: P[i].x + (P[i + 1].x - P[i].x) * k, y: P[i].y + (P[i + 1].y - P[i].y) * k }; } d -= segs[i]; }
    return P[P.length - 1];
  }
  function drawNodes(c, G, now) {                         // узел: кружок со знаком; в печати духа — мигает своим битом его цветом
    for (let k = 0; k < 8; k++) {
      const p = nodeXY(G, k), n = NODES[k];
      let lit = 0, col = null;
      for (const s of spirits) {
        if (!s.path.includes(k)) continue;
        const r = rateOf(s), hz = r / 2 ** (n.s + 1), bit = hz > 12 ? 0.55 : (Math.floor(tNow(s, now)) >> n.s) & 1, a = bit * clamp((gains[s.slot] || 0) * 1.6);
        if (a >= lit) { lit = a; col = SLOTC[s.slot]; }
      }
      const drawingHere = drawing && drawing.path.includes(k);
      if (lit > 0.05) T.glowAt(p.x, p.y, 24, 0.22 * lit);
      c.fillStyle = BGC; c.beginPath(); c.arc(p.x, p.y, 13, 0, TAU); c.fill();
      c.lineWidth = 1; c.strokeStyle = col ? rgba(col, 0.35 + 0.6 * lit) : ink(drawingHere ? 0.9 : 0.55); c.beginPath(); c.arc(p.x, p.y, 13, 0, TAU); c.stroke();
      c.strokeStyle = ink(0.2); c.beginPath(); c.arc(p.x, p.y, 16, 0, TAU); c.stroke();
      const caret = n.op === '^'; c.font = `${caret ? 24 : 16}px ${T.MAP}`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = col && lit > 0.05 ? rgba(col, 0.6 + 0.4 * lit) : ink(drawingHere ? 0.95 : 0.75); c.fillText(GLYPH[n.op], p.x, p.y + (caret ? 6 : 1));
    }
  }
  function drawTri(c, G, s, now, held) {                  // треугольник вызова: в нём — печать духа малым кругом, под ним — имя и чин
    const p = G.tris[s.slot], col = SLOTC[s.slot], g = clamp((gains[s.slot] || 0) * 1.6), ts = G.ts;
    if (g > 0.05) T.glowAt(p.x, p.y, ts * 1.2, 0.18 * g);
    c.lineWidth = 1; c.strokeStyle = rgba(col, 0.55 + 0.4 * g); triPath(c, p.x, p.y, ts); c.stroke();
    c.strokeStyle = rgba(col, 0.25); triPath(c, p.x, p.y, ts + 4); c.stroke();
    if (s.rel < 0.97) {                                  // не дрон — у основания треугольника огибающая удара: короче хвост — суше удар
      const bx = p.x - ts * 0.87, bw = ts * 1.74, by = p.y + ts * 0.5 + 4, k = 1.5 + 22 * (1 - s.rel) ** 2;
      c.strokeStyle = rgba(col, 0.6); c.beginPath(); c.moveTo(bx, by + 5);
      for (let i = 0; i <= 24; i++) { const u = i / 24; c.lineTo(bx + u * bw, by + 5 - 5 * Math.exp(-k * u)); } c.stroke();
    }
    const mr = ts * 0.4, my = p.y + ts * 0.08;
    c.strokeStyle = ink(0.3); c.beginPath(); c.arc(p.x, my, mr, 0, TAU); c.stroke();
    const mini = s.path.map((k) => { const a = -Math.PI / 2 + (k / 8) * TAU; return { x: p.x + Math.cos(a) * mr * 0.8, y: my + Math.sin(a) * mr * 0.8 }; });
    sealLine(c, mini, col, 0.85, 1);
    const sp = spiritOf(s);
    T.mapText(sp.name, p.x, p.y + ts * 0.5 + 20, 12, 0.85, 'center');
    T.mapText(sp.rank, p.x, p.y + ts * 0.5 + 34, 10, 0.4, 'center');
    if (held) { c.strokeStyle = ink(0.6); c.beginPath(); c.arc(p.x, my, ts * 1.15, 0, TAU); c.stroke(); T.mapText(`${noteName(semiOf(s))} · ${(rateOf(s) / 1000).toFixed(1)} kHz · ${relText(s)}`, p.x, p.y - ts - 12, 12, 0.9, 'center'); }
  }
  function drawVessel(c, G) {                             // медный сосуд Соломона — в нём держали духов; тап — карта
    const v = G.vessel, x = v.x, y = v.y;
    c.lineWidth = 1; c.strokeStyle = rgba(BRASS, 0.85); c.fillStyle = BGC;
    c.beginPath(); c.moveTo(x - 7, y - 18); c.quadraticCurveTo(x - 7, y - 12, x - 15, y - 6); c.quadraticCurveTo(x - 22, y + 4, x - 14, y + 13); c.lineTo(x + 14, y + 13); c.quadraticCurveTo(x + 22, y + 4, x + 15, y - 6); c.quadraticCurveTo(x + 7, y - 12, x + 7, y - 18); c.closePath(); c.fill(); c.stroke();
    c.beginPath(); c.ellipse(x, y - 20, 10, 3, 0, 0, TAU); c.stroke();                       // крышка с печатью
    c.beginPath(); c.moveTo(x, y - 23); c.lineTo(x, y - 28); c.stroke(); c.beginPath(); c.arc(x, y - 30, 2, 0, TAU); c.stroke();
    c.strokeStyle = rgba(BRASS, 0.45); c.beginPath(); c.moveTo(x - 17, y + 2); c.lineTo(x + 17, y + 2); c.stroke();
    c.beginPath(); for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + (k * 2 * TAU) / 5, px = x + Math.cos(a) * 4.5, py = y + 7 + Math.sin(a) * 4.5; k ? c.lineTo(px, py) : c.moveTo(px, py); } c.closePath(); c.stroke();
  }
  function draw(now) {
    const c = T.g, G = geo();
    c.drawImage(wall(G), 0, 0, T.W, T.H);
    for (const s of spirits) {                            // печати духов в круге — их цветом, ярче, пока звучат
      const g = clamp((gains[s.slot] || 0) * 1.6), P = trimmed(G, s.path);
      sealLine(c, P, SLOTC[s.slot], 0.3 + 0.5 * g, 1.3, 19);
    }
    if (drawing) {                                        // чертят: путь ярко, от последнего узла — к пальцу
      const P = trimmed(G, drawing.path), col = drawing.s && spirits.includes(drawing.s) ? SLOTC[drawing.s.slot] : [255, 255, 255];
      if (P.length > 1) sealLine(c, P, col, 0.95, 1.6, 19);
      const l = P[P.length - 1]; c.strokeStyle = rgba(col, 0.45); c.lineWidth = 1; c.setLineDash([3, 4]); c.beginPath(); c.moveTo(l.x, l.y); c.lineTo(drawing.x, drawing.y); c.stroke(); c.setLineDash([]);
    }
    drawNodes(c, G, now);
    for (const s of spirits) {
      const h = playhead(G, s, now), g = clamp((gains[s.slot] || 0) * 1.6);
      if (h && g > 0.05) { T.glowAt(h.x, h.y, 12, 0.3 * g); c.fillStyle = rgba(SLOTC[s.slot], 0.9 * g); c.beginPath(); c.arc(h.x, h.y, 2.4, 0, TAU); c.fill(); }
    }
    const held = new Set([...touches.values()].filter((t) => t.kind === 'tri').map((t) => t.s));
    for (const s of spirits) drawTri(c, G, s, now, held.has(s));
    const show = drawing && drawing.path.length > 1 ? drawing.path : held.size ? [...held][0].path : null;   // формула — только пока чертишь или держишь
    if (show) T.mapText(formula(show), G.cx, G.cy + G.R + 22, 14, 0.9, 'center', false);
    drawVessel(c, G);
  }

  // ---------- мир ----------
  const deg = (d) => (d * Math.PI) / 180;
  const fxw = {
    sectors: [{ key: 'legio', label: 'legio', ang: deg(170) }, { key: 'echo', label: 'echo', ang: deg(140) }, { key: 'spread', label: 'spread', ang: deg(110) }, { key: 'hall', label: 'hall', ang: deg(80) }],
    get: (k) => fx[k], set: (k, v) => { fx[k] = v; applyFx(); }, text: (k) => `${Math.round(fx[k] * 100)}%`,
    lfo: { keys: ['legio', 'echo', 'spread', 'hall'], shapes: 'random' },
    arc: () => fx.hall, save: () => ({ ...fx }), load: (o) => { Object.assign(fx, o); applyFx(); },
  };
  function randPath(R) {                                  // печать: 3–5 узлов, без повторов подряд
    const n = 3 + Math.floor(R() * 3), p = [Math.floor(R() * 8)];
    while (p.length < n) { const k = Math.floor(R() * 8); if (k !== p[p.length - 1] && !p.includes(k)) p.push(k); }
    return p;
  }
  function dice() {                                       // два-три духа: случайные печати, высоты — кварта/квинта/октава от тоники; половина — удары
    const R = Math.random;
    while (spirits.length) banish(spirits[0]);
    const n = 2 + (R() < 0.4 ? 1 : 0), SEMIS = [-12, -5, 0, 0, 7, 12];
    for (let k = 0; k < n; k++) summon(randPath(R), { semi: SEMIS[Math.floor(R() * SEMIS.length)], tone: 0.3 + R() * 0.3, rel: R() < 0.5 ? 1 : 0.1 + R() * 0.55, legio: R() < 0.5 ? 1 : 2, lvl: 0.7 });
  }
  const goe = {
    n: 'XV', title: 'Goetia', sub: 'sigilla · bytebeat', theme: { ink: INK, bg: BGC, paper: PAPER },
    corner: { hit: (f) => { const v = geo().vessel; return Math.hypot(f.x - v.x, f.y - v.y) < v.r; }, draw: () => {} },   // медный сосуд — карта
    fx: fxw,
    legend: [['drag', 'draw from sign to sign', 'a seal — each sign adds to the formula; a spirit answers'], ['tap', 'tap a triangle', 'banish the spirit'],
      ['up', 'drag a triangle up or down', 'higher, lower — pitch and rhythm together'], ['drag', 'drag a triangle sideways', 'release: left — crackle and strikes, right — drone'],
      ['hold', 'hold a triangle', 'its sheet: pitch, tone, release, legio, level'],
      ['tap', 'tap the brass vessel', 'map of worlds']],
    build, tick, draw, down, move, up, dice, enter: start,
    clear() { drawing = null; while (spirits.length) banish(spirits[0]); },
    snapshot: () => JSON.stringify({ s: spirits.map(({ slot, path, semi, tone, rel, legio, lvl }) => ({ slot, path, semi, tone, rel, legio, lvl })), fx }),
    restore(js) {
      const st = JSON.parse(js);
      drawing = null; while (spirits.length) banish(spirits[0]);
      for (const q of st.s) summon(q.path, { semi: q.semi, tone: q.tone, rel: q.rel != null ? q.rel : 1, legio: q.legio, lvl: q.lvl });
      Object.assign(fx, st.fx); applyFx();
    },
    sounding,
  };
  T.registerWorld(15, goe);
  window.t2d.goe = {
    spirits, fx, geo, NODES, formula, numOf, setFx: (k, v) => fxw.set(k, v), get ready() { return ready; }, get gains() { return gains; }, get drawing() { return drawing; },
    node: (k) => nodeXY(geo(), k), tri: (slot) => geo().tris[slot], name: (s) => spiritOf(s).name, rate: rateOf, seal: (path, opt) => summon(path, opt),
  };
})();
