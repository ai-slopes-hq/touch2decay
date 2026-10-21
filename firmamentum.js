// Firmamentum — мир X: твердь Фламмариона. Над плоской землёй — купол неба, за ним — свет Эмпирея и колёса небесной механики.
// Звук — пульсарный синтез (pulsar-worklet.js), дрон без секвенсера. Тап по своду — прокол: в тверди звезда, сквозь неё бьёт свет —
// поток пульсаретов. Высота над горизонтом — частота пульсаций: у горизонта звезда мигает ритмом, выше мерцание сливается в тон
// (граница — пунктир limen, около 20 Гц); вбок по своду — формант (окраска). Под звездой — луч: его форма — форма пульсарета.
// Тап по звезде — закрыть дыру; тянешь — двигаешь; держишь — плашка (cycles, window, mask, level). FX: scintilla (пульсы
// сбиваются и пропадают), drift (форманты плывут), spread (стерео), hall. Солнце — под землёй в левом нижнем углу: тап — карта.
(() => {
  'use strict';
  const T = window.T2D;
  const TAU = Math.PI * 2;
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const INK = '232,224,200', BGC = '#0a0914', PAPER = '10,9,20', GOLD = [236, 204, 130];
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const NOTES = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];
  const SMAX = 6;
  const FP_LO = 0.7, FP_HI = 520, FF_LO = 140, FF_HI = 4800;

  // ---------- состояние ----------
  const stars = [];                                       // {slot, h (0 горизонт … 1 зенит), u (−1 … 1 по своду), cyc, win, mask, lvl, flash}
  const fx = { scintilla: 0.1, drift: 0.2, spread: 0.6, hall: 0.45 };
  let counts = new Array(SMAX).fill(0), gains = new Array(SMAX).fill(0);
  function fpOf(s) {                                      // высота — частота пульсаций; в области тона с ладом — по ступеням
    let f = FP_LO * (FP_HI / FP_LO) ** s.h;
    if (T.scaleOn && f > 27.5) { const st = 12 * Math.log2(f / 55); f = 55 * 2 ** ((T.snapSemi(Math.round(st) + 24) - 24) / 12); }
    return f;
  }
  const ffOf = (s) => FF_LO * (FF_HI / FF_LO) ** ((s.u + 1) / 2) * 2 ** (s.dr || 0);
  const LIMEN = Math.log(20 / FP_LO) / Math.log(FP_HI / FP_LO);   // высота, где ритм становится тоном
  const noteName = (f) => { const m = Math.round(12 * Math.log2(f / 55)); return `${NOTES[((m % 12) + 12) % 12]}${Math.floor((m + 9) / 12) + 1}`; };

  // ---------- геометрия: земля внизу, купол над ней; за куполом — Эмпирей ----------
  function geo() {
    const W = T.W, H = T.H, top = T.topY + 6, bot = H - T.safeBot - 8, Ws = Math.min(W, (H - T.safeBot) * 0.62), cx = W / 2;
    const hy = bot - Math.min(90, (bot - top) * 0.13), RX = Ws / 2 - 8, RY = Math.min(hy - top - 150, RX * 1.75);   // свод — высокий купол; над ним — Эмпирей
    return { W, H, top, bot, cx, Ws, hy, RX, RY, sun: { x: 0, y: bot + 8, r: 58 } };   // солнце — под землёй в левом нижнем углу (к центру карты): ночью оно ходит под землёй
  }
  function toSky(G, x, y) {                               // точка → (h, u): высота над горизонтом и место по своду
    const dy = G.hy - y, h = dy / G.RY, e = Math.hypot((x - G.cx) / G.RX, h);
    if (dy < 4 || e > 0.97) return null;
    const half = G.RX * Math.sqrt(Math.max(0.001, 1 - h * h));
    return { h: clamp(h, 0.02, 0.97), u: clamp((x - G.cx) / (half * 0.94), -1, 1) };
  }
  function fromSky(G, s) { const half = G.RX * Math.sqrt(Math.max(0.001, 1 - s.h * s.h)); return { x: G.cx + s.u * half * 0.94, y: G.hy - s.h * G.RY }; }

  // ---------- звук ----------
  let actx = null, node = null, bus = null, ready = false, started = false, lastSound = 0;
  const queue = [];
  const send = (m) => { if (node && ready) node.port.postMessage(m); else queue.push(m); };
  const VER = (document.currentScript && new URL(document.currentScript.src, location.href).searchParams.get('v')) || '0';
  function build(ctx, input) {
    actx = ctx;
    const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const pre = g(1), out = g(2.5), hallSend = g(0), h = T.hall();
    pre.connect(out); pre.connect(hallSend); hallSend.connect(h.input); h.out.connect(g(0.9)).connect(out);
    bus = { pre, out, hallSend, hall: h, input, live: false };
    ready = false; node = null; started = false;
    applyFx();
  }
  function start() {                                       // модуль пульсаров — только когда в мир впервые зашли
    if (started || !actx) return;
    started = true;
    actx.audioWorklet.addModule(`pulsar-worklet.js?v=${VER}`).then(() => {
      node = new AudioWorkletNode(actx, 'pulsar', { numberOfInputs: 0, outputChannelCount: [2] });
      node.connect(bus.pre);
      node.port.onmessage = (e) => {
        const d = e.data;
        if (d.t !== 'p') return;
        for (const s of stars) if (d.c[s.slot] !== counts[s.slot]) s.flash = performance.now();   // прозвучал пульсарет — звезда вспыхнула
        counts = d.c; gains = d.g;
      };
      ready = true;
      applyFx();
      for (const s of stars) sendStar(s);
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
    if (stars.length || gains.some((x) => x > 0.002)) lastSound = performance.now();
    else if (performance.now() - lastSound > 8000) setLive(false);
  }, 1000);
  function applyFx() {
    if (!bus) return;
    const t = actx.currentTime;
    bus.hallSend.gain.setTargetAtTime(fx.hall * fx.hall * 1.5, t, 0.05);
    for (const l of bus.hall.lines) l.g.gain.setTargetAtTime(10 ** ((-3 * l.len) / (1.5 + fx.hall * 5)), t, 0.05);
    send({ t: 'fx', jit: fx.scintilla, spread: fx.spread });
  }
  function sendStar(s, on = true) {
    send({ t: 'voice', i: s.slot, on, fp: fpOf(s), ff: ffOf(s), cyc: s.cyc, win: s.win, mask: s.mask, lvl: s.lvl * 0.55, pan: s.u * 0.8 });
    if (on) { setLive(true); lastSound = performance.now(); }
  }
  function addStar(h, u) {
    const used = new Set(stars.map((s) => s.slot)), slot = [...Array(SMAX).keys()].find((k) => !used.has(k));
    if (slot == null) return null;
    start();
    const s = { slot, h, u, cyc: 3, win: 0.2, mask: 0, lvl: 0.8, flash: 0, dr: 0, ph: Math.random() * TAU, born: performance.now() };
    stars.push(s); sendStar(s);
    return s;
  }
  function closeStar(s) { sendStar(s, false); stars.splice(stars.indexOf(s), 1); }
  const sounding = () => stars.length > 0;
  let driftAt = 0;
  function tick(now, dt) {
    if (fx.drift > 0.01 && now - driftAt > 100) {         // drift: форманты медленно плывут, у каждой звезды своя фаза
      driftAt = now;
      for (const s of stars) { s.dr = 0.6 * fx.drift * Math.sin(now * 0.00021 + s.ph) + 0.25 * fx.drift * Math.sin(now * 0.00057 + s.ph * 2); send({ t: 'voice', i: s.slot, ff: ffOf(s) }); }
    }
    for (const t of touches.values()) if (t.kind === 'star' && !t.moved && !t.sheet && !t.fresh && now - t.t0 > T.HOLD_MS) { t.sheet = true; starSheet(t.s); }
  }

  // ---------- касания ----------
  const touches = new Map();
  function starAt(G, x, y) { let best = null, bd = 24; for (const s of stars) { const p = fromSky(G, s), d = Math.hypot(x - p.x, y - p.y); if (d < bd) { bd = d; best = s; } } return best; }
  function down(f) {
    start();
    const G = geo(), now = performance.now(), hit = starAt(G, f.x, f.y);
    if (hit) { touches.set(f.id, { kind: 'star', s: hit, x0: f.x, y0: f.y, t0: now, moved: false }); return; }
    const q = toSky(G, f.x, f.y);
    if (q) { const s = addStar(q.h, q.u); touches.set(f.id, s ? { kind: 'star', s, x0: f.x, y0: f.y, t0: now, moved: false, fresh: true } : { kind: 'none' }); return; }   // прокол тверди
    touches.set(f.id, { kind: 'none' });
  }
  function move(f) {
    const t = touches.get(f.id);
    if (!t || t.kind !== 'star' || t.sheet) return;
    if (Math.hypot(f.x - t.x0, f.y - t.y0) > 8) t.moved = true;
    if (!t.moved) return;
    const G = geo(), dy = Math.max(6, G.hy - f.y), e = Math.hypot((f.x - G.cx) / G.RX, dy / G.RY), k = e > 0.95 ? 0.95 / e : 1;   // за свод не уйти
    const q = toSky(G, G.cx + (f.x - G.cx) * k, G.hy - dy * k);
    if (q) { t.s.h = q.h; t.s.u = q.u; sendStar(t.s); }
  }
  function up(f) {
    const t = touches.get(f.id);
    touches.delete(f.id);
    if (t && t.kind === 'star' && !t.moved && !t.fresh && !t.sheet && performance.now() - t.t0 < 300 && stars.includes(t.s)) closeStar(t.s);   // тап по звезде — закрыть дыру
  }
  function starSheet(s) {
    T.openSheet({
      title: 'stella', hint: 'star — tap outside to close',
      rows: [{ key: 'cyc', label: 'cycles' }, { key: 'win', label: 'window' }, { key: 'mask', label: 'mask' }, { key: 'lvl', label: 'level' }],
      get: (k) => (k === 'cyc' ? (s.cyc - 1) / 7 : s[k]),
      set: (k, v) => { if (k === 'cyc') s.cyc = 1 + Math.round(v * 7); else s[k] = v; sendStar(s); },
      text: (k) => (k === 'cyc' ? `${s.cyc}` : k === 'win' ? (s.win < 0.33 ? 'bell' : s.win < 0.66 ? 'strike' : 'square') : `${Math.round(s[k] * 100)}%`),
    });
  }

  // ---------- рисование ----------
  const ink = (a) => `rgba(${INK},${a})`;
  let wallC = null, wallKey = '';
  function wall(G) {                                      // Эмпирей за куполом, колёса механики, свод с делениями, неподвижные звёзды, земля
    const key = `${G.W}x${G.H}x${T.DPR}|${G.hy}|${G.RY}`;
    if (wallC && key === wallKey) return wallC;
    wallKey = key;
    wallC = document.createElement('canvas');
    wallC.width = Math.round(G.W * T.DPR); wallC.height = Math.round(G.H * T.DPR);
    const x = wallC.getContext('2d');
    x.setTransform(T.DPR, 0, 0, T.DPR, 0, 0);
    x.fillStyle = BGC; x.fillRect(0, 0, G.W, G.H);
    const { cx, hy, RX, RY } = G, E = (a, k = 0) => [cx + Math.cos(a) * (RX + k), hy + Math.sin(a) * (RY + k)];
    x.lineWidth = 1;
    x.save(); x.beginPath(); x.rect(0, 0, G.W, hy); x.ellipse(cx, hy, RX + 4, RY + 4, 0, Math.PI, 0); x.clip('evenodd');   // за сводом: лучи Эмпирея и колёса
    x.strokeStyle = rgba(GOLD, 0.12); x.beginPath();
    for (let j = 0; j < 60; j++) { const a = Math.PI + (j / 59) * Math.PI, p = E(a, 10); x.moveTo(p[0], p[1]); x.lineTo(p[0] + Math.cos(a) * 600, p[1] + Math.sin(a) * 600); }
    x.stroke();
    const by = (G.top + 20 + hy - RY) / 2, bh = hy - RY - G.top - 20;                   // Эмпирей над сводом: колёса в колёсах
    for (const [wx, wy, wr] of [[cx + RX * 0.55, by, Math.min(bh * 0.42, RX * 0.3)], [cx + RX * 0.05, by + bh * 0.15, Math.min(bh * 0.28, RX * 0.2)]]) {   // колёса в колёсах — механика небес
      x.strokeStyle = rgba(GOLD, 0.35); x.beginPath(); x.arc(wx, wy, wr, 0, TAU); x.stroke();
      x.beginPath(); x.ellipse(wx, wy, wr, wr * 0.35, 0.6, 0, TAU); x.stroke(); x.beginPath(); x.ellipse(wx, wy, wr * 0.35, wr, 0.6, 0, TAU); x.stroke();
      x.fillStyle = rgba(GOLD, 0.35); for (let k = 0; k < 10; k++) { const a = (k / 10) * TAU; x.beginPath(); x.arc(wx + Math.cos(a) * wr, wy + Math.sin(a) * wr, 1.3, 0, TAU); x.fill(); }   // глаза на ободе
    }
    x.restore();
    x.strokeStyle = ink(0.8); x.beginPath(); x.ellipse(cx, hy, RX, RY, 0, Math.PI, 0); x.stroke();          // свод
    x.strokeStyle = ink(0.3); x.beginPath(); x.ellipse(cx, hy, RX - 5, RY - 5, 0, Math.PI, 0); x.stroke();
    x.strokeStyle = ink(0.45); x.beginPath();
    for (let k = 0; k <= 48; k++) { const a = Math.PI + (k / 48) * Math.PI, l = k % 4 ? 3 : 6, p = E(a), q = E(a, l); x.moveTo(p[0], p[1]); x.lineTo(q[0], q[1]); }
    x.stroke();
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);   // неподвижные звёзды — всегда те же
    x.fillStyle = ink(0.4);
    for (let k = 0; k < 180; k++) { const a = Math.PI + rnd() * Math.PI, r = Math.sqrt(rnd()) * 0.95; const px = cx + Math.cos(a) * r * RX, py = hy + Math.sin(a) * r * RY; if (py < hy - 4) { x.globalAlpha = 0.25 + 0.6 * rnd(); x.fillRect(px, py, 1, 1); } }
    x.globalAlpha = 1;
    const ly = hy - LIMEN * RY, lh = RX * Math.sqrt(1 - LIMEN * LIMEN);                                     // limen: ниже — ритм, выше — тон
    x.strokeStyle = ink(0.18); x.setLineDash([2, 5]); x.beginPath(); x.moveTo(cx - lh + 8, ly); x.lineTo(cx + lh - 8, ly); x.stroke(); x.setLineDash([]);
    x.font = `italic 10.5px ${T.MAP}`; x.textBaseline = 'middle'; x.fillStyle = ink(0.32);
    x.textAlign = 'left'; x.fillText('limen', cx - lh + 12, ly - 8);
    x.textAlign = 'center'; x.fillText('rhythmus', cx, hy - LIMEN * RY * 0.45); x.fillText('tonus', cx, hy - RY * 0.62);
    x.strokeStyle = ink(0.75); x.beginPath(); x.moveTo(0, hy + 0.5); x.lineTo(G.W, hy + 0.5); x.stroke();   // земля: горизонт, холмы, штриховка
    x.strokeStyle = ink(0.35); x.beginPath();
    for (let px = 0; px <= G.W; px += 4) { const y = hy + 10 + Math.sin(px * 0.031) * 4 + Math.sin(px * 0.011 + 1) * 6; px ? x.lineTo(px, y) : x.moveTo(px, y); }
    x.stroke();
    x.strokeStyle = ink(0.08); x.beginPath(); for (let y = hy + 18; y < G.H; y += 5) { x.moveTo(0, y); x.lineTo(G.W, y); } x.stroke();
    return wallC;
  }
  function drawStar(c, G, s, now, held) {
    const p = fromSky(G, s), fp = fpOf(s), g = gains[s.slot] || 0;
    const blink = fp < 18 ? Math.exp(-(now - s.flash) / (80 + 300 / Math.max(1, fp))) : 1;   // ритм — вспышка на каждом пульсарете; тон — ровный свет
    const e = clamp(g * 1.4) * (0.35 + 0.65 * blink);
    if (e > 0.05) T.glowAt(p.x, p.y, 22 + 10 * blink, 0.25 * e);
    const len = 30 + 26 * e, w = 6, cyc = s.cyc;                                            // луч вниз — форма пульсарета
    c.strokeStyle = rgba(GOLD, 0.15 + 0.5 * e); c.lineWidth = 1; c.beginPath();
    for (let k = 0; k <= 40; k++) {
      const x = k / 40, w0 = Math.sin(Math.PI * x) ** 2, w1 = Math.min(1, x * 40) * Math.exp(-x * 5), wv = s.win < 0.5 ? w0 + (w1 - w0) * s.win * 2 : w1 + (1 - w1) * (s.win - 0.5) * 2;
      const px = p.x + Math.sin(TAU * cyc * x) * wv * w, py = p.y + 7 + x * len; k ? c.lineTo(px, py) : c.moveTo(px, py);
    }
    c.stroke();
    c.strokeStyle = rgba(GOLD, 0.5 + 0.5 * e); c.beginPath();                                // звезда: прокол с лучами
    for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU, l = (k % 2 ? 4 : 8) * (0.7 + 0.5 * e); c.moveTo(p.x + Math.cos(a) * 2, p.y + Math.sin(a) * 2); c.lineTo(p.x + Math.cos(a) * l, p.y + Math.sin(a) * l); }
    c.stroke();
    c.fillStyle = rgba(GOLD, 0.6 + 0.4 * e); c.beginPath(); c.arc(p.x, p.y, 2.2, 0, TAU); c.fill();
    if (s.mask > 0.05) { c.strokeStyle = ink(0.35); c.setLineDash([1.5, 3]); c.beginPath(); c.arc(p.x, p.y, 11, 0, TAU); c.stroke(); c.setLineDash([]); }   // пропускает — пунктирный ободок
    if (held) {
      c.strokeStyle = ink(0.6); c.beginPath(); c.arc(p.x, p.y, 14, 0, TAU); c.stroke();
      const ff = ffOf(s), top = fp >= 20 ? `${noteName(fp)} · ${Math.round(fp)} Hz` : `${fp.toFixed(fp < 4 ? 1 : 0)} / s`;
      T.mapText(top, p.x, p.y - 30, 14, 0.95, 'center');
      T.mapText(`formant ${Math.round(ff)} Hz`, p.x, p.y - 15, 11, 0.6, 'center');
    }
  }
  let noSun = false;
  function draw(now) {
    const c = T.g, G = geo();
    c.drawImage(wall(G), 0, 0, T.W, T.H);
    const held = new Set([...touches.values()].filter((t) => t.kind === 'star').map((t) => t.s));
    for (const s of stars) drawStar(c, G, s, now, held.has(s));
    if (!noSun) { c.save(); c.beginPath(); c.rect(0, 0, G.W, G.sun.y); c.clip(); T.sunGlyph(c, G.sun.x, G.sun.y, -Math.PI / 2, 0, 1.2, now, INK, BGC); c.restore(); }
  }

  // ---------- мир ----------
  const deg = (d) => (d * Math.PI) / 180;
  const fxw = {
    sectors: [{ key: 'scintilla', label: 'scintilla', ang: deg(190) }, { key: 'drift', label: 'drift', ang: deg(150) }, { key: 'spread', label: 'spread', ang: deg(115) }, { key: 'hall', label: 'hall', ang: deg(80) }],
    get: (k) => fx[k], set: (k, v) => { fx[k] = v; applyFx(); }, text: (k) => `${Math.round(fx[k] * 100)}%`,
    arc: () => fx.hall, save: () => ({ ...fx }), load: (o) => { Object.assign(fx, o); applyFx(); },
  };
  function dice() {                                       // одна звезда — ритм у горизонта, две-три — тоны выше; окна и циклы вразброс
    const R = Math.random;
    while (stars.length) closeStar(stars[0]);
    const s0 = addStar(0.08 + R() * (LIMEN - 0.12), R() * 1.6 - 0.8); if (s0) { s0.cyc = 1 + Math.floor(R() * 3); s0.win = 0.4 + R() * 0.3; sendStar(s0); }
    const n = 2 + Math.floor(R() * 2);
    for (let k = 0; k < n; k++) { const s = addStar(LIMEN + 0.08 + R() * 0.45, R() * 1.8 - 0.9); if (s) { s.cyc = 2 + Math.floor(R() * 6); s.win = R() * 0.6; s.mask = R() < 0.3 ? 0.3 : 0; sendStar(s); } }
  }
  const firm = {
    n: 'X', title: 'Firmamentum', sub: 'stellae · pulsar', theme: { ink: INK, bg: BGC, paper: PAPER },
    corner: { hit: (f) => { const G = geo(); return f.y > G.hy + 6 && Math.hypot(f.x - G.sun.x, f.y - G.sun.y) < G.sun.r + 6; }, draw: () => {} },   // солнце под землёй — карта
    fx: fxw,
    legend: [['tap', 'tap the sky', 'pierce the firmament — a star pulses'], ['up', 'drag a star up', 'faster: low — rhythm, high — a tone'],
      ['drag', 'drag a star sideways', 'formant · colour'], ['tap', 'tap a star', 'close the hole'],
      ['hold', 'hold a star', 'its sheet: cycles, window, mask, level'], ['tap', 'tap the sun', 'map of worlds']],
    build, tick, draw, down, move, up, dice, enter: start,
    clear() { while (stars.length) closeStar(stars[0]); },
    snapshot: () => JSON.stringify({ s: stars.map(({ h, u, cyc, win, mask, lvl }) => ({ h, u, cyc, win, mask, lvl })), fx }),
    restore(js) {
      const st = JSON.parse(js);
      while (stars.length) closeStar(stars[0]);
      for (const q of st.s) { const s = addStar(q.h, q.u); if (s) { Object.assign(s, q); sendStar(s); } }
      Object.assign(fx, st.fx); applyFx();
    },
    sounding, mapShot(on) { noSun = on; },
  };
  T.registerWorld(10, firm);
  window.t2d.firm = {
    stars, fx, geo, setFx: (k, v) => fxw.set(k, v), get ready() { return ready; }, get gains() { return gains; }, get counts() { return counts; }, fp: fpOf, ff: ffOf, LIMEN,
    at: (h, u) => fromSky(geo(), { h, u }),
  };
})();
