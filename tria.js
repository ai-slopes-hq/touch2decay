// Tria corpora — мир XI: задача трёх тел на земле. Три начала Парацельса — Sal, Sulphur, Mercurius — на алхимическом блюде:
// тянут друг друга и кружат хаотически, а земля в середине тянет всех к себе (чтобы не разлетелись). Каждое тело — генератор:
// ближе к середине — выше (flux), быстрее движется — громче, тела модулируют друг друга по кругу (FM), сила — чем ближе, тем больше
// (nexus); близкий пролёт — всплеск. Тело можно схватить и бросить (щелчок — скорость); двойной тап — тело встаёт на якорь;
// держишь — плашка (mass, note, level). Тап по знаку земли в середине — «Fiat lux»: тела встают на восьмёрку (устойчивая орбита
// Шенсине — Монтгомери) и звучат периодом; тронул тело — снова хаос. Корзина — тела замирают и молчат. Солнце — в левом верхнем углу: карта.
(() => {
  'use strict';
  const T = window.T2D;
  const TAU = Math.PI * 2;
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const INK = '222,198,152', BGC = '#130f0a', PAPER = '19,15,10';
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const TINT = [[240, 234, 222], [236, 192, 84], [196, 210, 224]];   // соль — белая, сера — жёлтая, ртуть — серебро
  const NAMES = ['Sal', 'Sulphur', 'Mercurius'];
  const NOTES = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];
  const EPS = 0.06, KC = 0.35;

  // ---------- состояние ----------
  const rest = () => [0, 1, 2].map((i) => { const a = -Math.PI / 2 + (i * TAU) / 3; return { x: Math.cos(a) * 0.5, y: Math.sin(a) * 0.5 }; });
  const bodies = rest().map((p, i) => ({ ...p, vx: 0, vy: 0, m: 1, fixed: false, semi: [0, 7, 12][i], level: 0.8, trail: [], amp: 0, hz: 110 }));
  const fx = { gravitas: 0.5, flux: 0.5, nexus: 0.35, hall: 0.35 };
  let still = true, lux = false, cadit = false, encounters = 0;   // cadit — тяга выключена: всё падает на дно блюда
  const Gc = () => 0.25 + 0.75 * fx.gravitas;
  const tonic = () => (T.scaleOn ? T.scaleRoot : 0);
  function hzOf(b) {                                     // ближе к земле в середине — выше; с ладом — по ступеням
    const r = Math.hypot(b.x, b.y);
    let s = b.semi + tonic() + fx.flux * 12 * (0.55 - r) * 1.6;
    if (T.scaleOn) s = T.snapSemi(Math.round(s) + 24) - 24;
    return 110 * 2 ** (s / 12);
  }
  const noteName = (f) => { const m = Math.round(12 * Math.log2(f / 55)); return `${NOTES[((m % 12) + 12) % 12]}${Math.floor((m + 9) / 12) + 1}`; };

  // ---------- геометрия ----------
  function geo() {
    const W = T.W, H = T.H, top = T.topY + 6, bot = H - T.safeBot - 8, Ws = Math.min(W, (H - T.safeBot) * 0.62), cx = W / 2, cy = (top + bot) / 2 + 10;
    const ay = bot - 30, cy2 = (top + ay - 40) / 2 + 8, R = Math.min(Ws / 2 - 16, (ay - 40 - top) / 2 - 18);   // внизу — аватары трёх тел и отвес
    const step = Math.min(70, Ws / 4.6), av = [-1.5, -0.5, 0.5].map((k) => ({ x: cx + k * step, y: ay, r: 19 }));
    return { W, H, top, bot, cx, cy: cy2, R, Ws, av, plumb: { x: cx + 1.5 * step, y: ay, r: 19 }, sun: { x: 0, y: T.topY + 2, r: Math.min(56, Ws * 0.15) } };
  }
  const px = (G, b) => ({ x: G.cx + b.x * G.R, y: G.cy + b.y * G.R });

  // ---------- физика ----------
  function accel(i, P) {
    const b = P[i];
    if (cadit) return [0, 1.4];                           // тяга выключена — всё падает вниз
    let ax = -KC * b.x * (lux ? 0 : 1), ay = -KC * b.y * (lux ? 0 : 1);
    const eps2 = lux ? 1e-6 : EPS * EPS, g = Gc();
    for (let j = 0; j < 3; j++) {
      if (j === i) continue;
      const dx = P[j].x - b.x, dy = P[j].y - b.y, d2 = dx * dx + dy * dy + eps2, k = (g * bodies[j].m) / (d2 * Math.sqrt(d2));
      ax += dx * k; ay += dy * k;
    }
    return [ax, ay];
  }
  function physics(dt) {                                  // перешагивание (leapfrog), 8 подшагов за кадр; блюдо держит тела
    if (still) return;
    const n = 8, h = (dt * (0.5 + fx.gravitas)) / n;
    for (let s = 0; s < n; s++) {
      for (let i = 0; i < 3; i++) { const b = bodies[i]; if (b.fixed || b.held) continue; const [ax, ay] = accel(i, bodies); b.vx += ax * h / 2; b.vy += ay * h / 2; }
      for (const b of bodies) { if (b.fixed || b.held) continue; b.x += b.vx * h; b.y += b.vy * h; }
      for (let i = 0; i < 3; i++) { const b = bodies[i]; if (b.fixed || b.held) continue; const [ax, ay] = accel(i, bodies); b.vx += ax * h / 2; b.vy += ay * h / 2; }
      if (cadit) for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {   // на дне тела не проходят друг сквозь друга
        const a = bodies[i], b = bodies[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1e-4, m = 0.19;
        if (d < m) { const push = (m - d) / 2, ux = dx / d, uy = dy / d; if (!a.fixed && !a.held) { a.x -= ux * push; a.y -= uy * push; } if (!b.fixed && !b.held) { b.x += ux * push; b.y += uy * push; } const rv = (b.vx - a.vx) * ux + (b.vy - a.vy) * uy; if (rv < 0) { a.vx += rv * ux * 0.5; a.vy += rv * uy * 0.5; b.vx -= rv * ux * 0.5; b.vy -= rv * uy * 0.5; } }
      }
      for (const b of bodies) {                           // край блюда: отскок с потерей; слишком быстрые — притормаживают
        const r = Math.hypot(b.x, b.y);
        if (r > 0.97) {
          const nx = b.x / r, ny = b.y / r, vn = b.vx * nx + b.vy * ny, k = cadit ? 1.35 : 1.8;
          if (vn > 0) { b.vx -= k * vn * nx; b.vy -= k * vn * ny; }
          if (cadit) { b.vx *= 0.985; b.vy *= 0.985; }   // на дне — трение: тела скатываются и замирают
          b.x = nx * 0.97; b.y = ny * 0.97;
        }
        const v = Math.hypot(b.vx, b.vy); if (v > 4) { b.vx *= 4 / v; b.vy *= 4 / v; }
      }
    }
  }
  function fiatLux() {                                    // восьмёрка Шенсине — Монтгомери: три равных тела гоняются друг за другом по одной кривой
    const s = 0.55, g = Gc(), k = Math.sqrt(g / s), x1 = [-0.97000436, 0.24308753], v3 = [-0.93240737, -0.86473146];
    const P = [[x1[0], x1[1]], [-x1[0], -x1[1]], [0, 0]], V = [[-v3[0] / 2, -v3[1] / 2], [-v3[0] / 2, -v3[1] / 2], v3];
    bodies.forEach((b, i) => { b.x = P[i][0] * s; b.y = P[i][1] * s; b.vx = V[i][0] * k; b.vy = V[i][1] * k; b.m = 1; b.fixed = false; b.trail = []; });
    lux = true; cadit = false; still = false; start(); luxAt = performance.now();
  }
  let luxAt = 0;

  // ---------- звук ----------
  let actx = null, bus = null, vo = null, lastSound = 0, noiseBuf = null;
  function build(ctx, input) {
    actx = ctx;
    const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const pre = g(1), sh = ctx.createWaveShaper(), out = g(1.6), hallSend = g(0), h = T.hall();
    const c = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; c[i] = Math.tanh(1.4 * x) / Math.tanh(1.4); } sh.curve = c;
    pre.connect(sh).connect(out); sh.connect(hallSend); hallSend.connect(h.input); h.out.connect(g(0.9)).connect(out);
    bus = { pre, out, hallSend, hall: h, input, live: false };
    const n = ctx.sampleRate; noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    vo = null;
    applyFx();
  }
  function start() {                                      // три генератора, по кругу модулируют друг друга (в петле — задержка 2 мс, без неё круг запрещён)
    if (!bus) return;
    setLive(true); lastSound = performance.now();
    if (vo) return;
    const ctx = actx, t = ctx.currentTime, g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    vo = bodies.map((b) => { const o = ctx.createOscillator(), vca = g(0), pan = ctx.createStereoPanner(), mg = g(0); o.frequency.value = hzOf(b); o.connect(vca).connect(pan).connect(bus.pre); o.start(t); return { o, vca, pan, mg }; });
    const dl = ctx.createDelay(0.01); dl.delayTime.value = 0.002;
    vo[0].o.connect(vo[0].mg).connect(vo[1].o.frequency); vo[1].o.connect(vo[1].mg).connect(vo[2].o.frequency); vo[2].o.connect(dl).connect(vo[2].mg).connect(vo[0].o.frequency);
    vo.dl = dl;
  }
  function stopVoices() {
    if (!vo) return;
    const t = actx.currentTime;
    for (const v of vo) { v.o.stop(t + 0.05); v.o.onended = () => { v.o.disconnect(); v.vca.disconnect(); v.pan.disconnect(); v.mg.disconnect(); }; }
    vo.dl.disconnect(); vo = null;
  }
  function setLive(on) {
    if (!bus || bus.live === on) return;
    bus.live = on;
    if (on) bus.out.connect(bus.input); else bus.out.disconnect();
  }
  setInterval(() => {
    if (!bus) return;
    if (!still || bodies.some((b) => b.amp > 0.01)) lastSound = performance.now();
    else if (performance.now() - lastSound > 6000) { stopVoices(); setLive(false); }
  }, 1000);
  function applyFx() {
    if (!bus) return;
    const t = actx.currentTime;
    bus.hallSend.gain.setTargetAtTime(fx.hall * fx.hall * 1.4, t, 0.05);
    for (const l of bus.hall.lines) l.g.gain.setTargetAtTime(10 ** ((-3 * l.len) / (1.5 + fx.hall * 4)), t, 0.05);
  }
  function burst(f, pan) {                                // близкий пролёт — всплеск: шум сквозь узкую полосу на средней высоте пары
    if (!bus) return;
    const ctx = actx, t = ctx.currentTime, s = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), gg = ctx.createGain(), p = ctx.createStereoPanner();
    s.buffer = noiseBuf; bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 18; p.pan.value = pan;
    gg.gain.setValueAtTime(0, t); gg.gain.linearRampToValueAtTime(0.9, t + 0.004); gg.gain.exponentialRampToValueAtTime(0.0005, t + 0.35); gg.gain.linearRampToValueAtTime(0, t + 0.36);
    s.connect(bp).connect(gg).connect(p).connect(bus.pre); s.start(t, Math.random() * 0.5); s.stop(t + 0.38);
    s.onended = () => { s.disconnect(); bp.disconnect(); gg.disconnect(); p.disconnect(); };
    encounters++;
  }
  const near = [false, false, false];
  function voice(dt) {                                    // перевод движения в звук: высота, громкость по скорости, FM по близости, панорама
    bodies.forEach((b) => {
      const v = Math.hypot(b.vx, b.vy), target = still ? 0 : b.level * clamp(0.12 + v * 0.55);
      b.amp += (target - b.amp) * (1 - Math.exp(-dt / 0.08)); b.hz = hzOf(b);
    });
    for (let i = 0; i < 3; i++) {                         // близкий пролёт пары — всплеск
      const a = bodies[i], b = bodies[(i + 1) % 3], d = Math.hypot(a.x - b.x, a.y - b.y), cl = d < 0.1;
      if (cl && !near[i] && !still) burst(Math.sqrt(a.hz * b.hz) * 2, clamp((a.x + b.x) / 2, -1, 1));
      near[i] = cl;
    }
    if (!vo) return;
    const t = actx.currentTime;
    bodies.forEach((b, i) => {
      const n = vo[i], src = bodies[(i + 2) % 3], d = Math.hypot(b.x - src.x, b.y - src.y), idx = fx.nexus * b.hz * 2.5 * clamp(0.12 / Math.max(0.03, d), 0, 3);
      if (T.scaleOn) n.o.frequency.setValueAtTime(b.hz, t); else n.o.frequency.setTargetAtTime(b.hz, t, 0.03);
      n.vca.gain.setTargetAtTime(b.amp * 0.22, t, 0.03);
      n.pan.pan.setTargetAtTime(clamp(b.x, -1, 1) * 0.8, t, 0.05);
      vo[(i + 2) % 3].mg.gain.setTargetAtTime(idx, t, 0.04);   // источник модулирует следующего
    });
  }
  function tick(now, dt) {
    physics(dt);
    voice(dt);
    if (!still) for (const b of bodies) { b.trail.push(b.x, b.y); if (b.trail.length > 360) b.trail.splice(0, 2); }
    for (const t of touches.values()) if (t.kind === 'body' && !t.moved && !t.sheet && now - t.t0 > T.HOLD_MS) { t.sheet = true; const b = bodies[t.i]; b.held = false; bodySheet(t.i); }
  }
  const sounding = () => !still;

  // ---------- касания ----------
  const touches = new Map();
  let lastTap = null;
  function bodyAt(G, x, y) { let best = -1, bd = 30; bodies.forEach((b, i) => { const p = px(G, b), d = Math.hypot(x - p.x, y - p.y); if (d < bd) { bd = d; best = i; } }); return best; }
  function down(f) {
    const G = geo(), now = performance.now();
    const ai = G.av.findIndex((a) => Math.hypot(f.x - a.x, f.y - a.y) < a.r + 10);
    if (ai >= 0) { bodySheet(ai); touches.set(f.id, { kind: 'none' }); return; }   // аватар — плашка тела
    if (Math.hypot(f.x - G.plumb.x, f.y - G.plumb.y) < G.plumb.r + 10) {   // отвес: тяга выкл — всё падает на дно; ещё раз — тяга снова
      cadit = !cadit; lux = false; if (still) { still = false; start(); } touches.set(f.id, { kind: 'none' }); return;
    }
    const i = bodyAt(G, f.x, f.y);
    if (i >= 0) {
      const b = bodies[i];
      if (lastTap && lastTap.i === i && now - lastTap.t < T.DTAP_MS) { lastTap = null; b.fixed = !b.fixed; b.vx = b.vy = 0; touches.set(f.id, { kind: 'none' }); return; }   // двойной тап — якорь
      lastTap = { i, t: now };
      b.held = true; lux = false;
      touches.set(f.id, { kind: 'body', i, x0: f.x, y0: f.y, t0: now, moved: false, hist: [[now, f.x, f.y]] });
      return;
    }
    if (Math.hypot(f.x - G.cx, f.y - G.cy) < 26) { fiatLux(); touches.set(f.id, { kind: 'none' }); return; }   // знак земли — Fiat lux
    touches.set(f.id, { kind: 'none' });
  }
  function move(f) {
    const t = touches.get(f.id);
    if (!t || t.kind !== 'body' || t.sheet) return;
    if (Math.hypot(f.x - t.x0, f.y - t.y0) > 8) t.moved = true;
    if (!t.moved) return;
    const G = geo(), b = bodies[t.i], x = (f.x - G.cx) / G.R, y = (f.y - G.cy) / G.R, r = Math.hypot(x, y), k = r > 0.95 ? 0.95 / r : 1;
    b.x = x * k; b.y = y * k; b.vx = b.vy = 0;
    t.hist.push([performance.now(), f.x, f.y]); if (t.hist.length > 6) t.hist.shift();
    if (still) { still = false; start(); }
  }
  function up(f) {
    const t = touches.get(f.id);
    touches.delete(f.id);
    if (!t || t.kind !== 'body') return;
    const b = bodies[t.i], G = geo();
    b.held = false;
    if (t.moved && !b.fixed) {                            // бросок: скорость пальца за последние кадры
      const h = t.hist, a = h[0], z = h[h.length - 1], dtm = Math.max(16, z[0] - a[0]);
      b.vx = clamp(((z[1] - a[1]) / G.R / dtm) * 1000 * 0.5, -3, 3); b.vy = clamp(((z[2] - a[2]) / G.R / dtm) * 1000 * 0.5, -3, 3);
    }
    if (still && t.moved) { still = false; start(); }
  }
  function bodySheet(i) {
    const b = bodies[i];
    T.openSheet({
      title: NAMES[i], hint: 'body — tap outside to close',
      rows: [{ key: 'm', label: 'mass' }, { key: 'semi', label: 'note' }, { key: 'level', label: 'level' }, { key: 'fixed', label: 'anchor' }],
      get: (k) => (k === 'm' ? (b.m - 0.3) / 2.7 : k === 'semi' ? (b.semi + 12) / 36 : k === 'fixed' ? (b.fixed ? 1 : 0) : b.level),
      set: (k, v) => { if (k === 'm') b.m = 0.3 + v * 2.7; else if (k === 'semi') b.semi = Math.round(v * 36) - 12; else if (k === 'fixed') { b.fixed = v >= 0.5; if (b.fixed) b.vx = b.vy = 0; } else b.level = v; },
      text: (k) => (k === 'm' ? b.m.toFixed(1) : k === 'semi' ? noteName(110 * 2 ** ((b.semi + tonic()) / 12)) : k === 'fixed' ? (b.fixed ? 'anchored' : 'free') : `${Math.round(b.level * 100)}%`),
    });
  }

  // ---------- рисование ----------
  const ink = (a) => `rgba(${INK},${a})`;
  let wallC = null, wallKey = '';
  function elem(x, cx, cy, s, up, bar) { x.beginPath(); x.moveTo(cx, cy + (up ? -s : s)); x.lineTo(cx + s * 0.9, cy + (up ? s * 0.6 : -s * 0.6)); x.lineTo(cx - s * 0.9, cy + (up ? s * 0.6 : -s * 0.6)); x.closePath(); if (bar) { x.moveTo(cx - s * 0.7, cy); x.lineTo(cx + s * 0.7, cy); } x.stroke(); }
  function wall(G) {                                      // блюдо: двойной обод с делениями, круги, четыре стихии по сторонам света
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
    x.strokeStyle = ink(0.05); x.beginPath(); for (let k = -G.H; k < G.W; k += 12) { x.moveTo(k, 0); x.lineTo(k + G.H, G.H); } x.stroke();   // камень — косая штриховка
    x.fillStyle = BGC; x.beginPath(); x.arc(cx, cy, R + 8, 0, TAU); x.fill();
    x.strokeStyle = ink(0.75); x.beginPath(); x.arc(cx, cy, R + 8, 0, TAU); x.stroke();
    x.strokeStyle = ink(0.3); x.beginPath(); x.arc(cx, cy, R + 3, 0, TAU); x.stroke();
    x.strokeStyle = ink(0.4); x.beginPath(); for (let k = 0; k < 72; k++) { const a = (k / 72) * TAU, l = k % 6 ? 3 : 6; x.moveTo(cx + Math.cos(a) * (R + 8), cy + Math.sin(a) * (R + 8)); x.lineTo(cx + Math.cos(a) * (R + 8 + l), cy + Math.sin(a) * (R + 8 + l)); } x.stroke();
    x.strokeStyle = ink(0.1); x.setLineDash([2, 5]); for (const k of [0.25, 0.5, 0.75]) { x.beginPath(); x.arc(cx, cy, R * k, 0, TAU); x.stroke(); } x.setLineDash([]);   // круги — ближе к середине выше
    x.strokeStyle = ink(0.5);                                                                                 // стихии: огонь сверху, воздух справа, вода снизу, земля слева
    const S = 7, o = (R + 26) * Math.SQRT1_2;               // стихии по диагоналям: огонь и воздух — над блюдом (лёгкие), вода и земля — под ним
    elem(x, cx - o, cy - o, S, true, false); elem(x, cx + o, cy - o, S, true, true); elem(x, cx - o, cy + o, S, false, false); elem(x, cx + o, cy + o, S, false, true);
    x.font = `italic 10px ${T.MAP}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = ink(0.35);
    x.fillText('ignis', cx - o, cy - o - 16); x.fillText('aer', cx + o, cy - o - 16); x.fillText('aqua', cx - o, cy + o + 16); x.fillText('terra', cx + o, cy + o + 16);
    return wallC;
  }
  function glyph(c, i, x, y, r) {                          // знаки трёх начал: соль ⊖, сера — треугольник над крестом, ртуть — круг с рогами и крестом
    c.beginPath();
    if (i === 0) { c.arc(x, y, r, 0, TAU); c.moveTo(x - r, y); c.lineTo(x + r, y); }
    else if (i === 1) { c.moveTo(x, y - r); c.lineTo(x + r * 0.8, y + r * 0.2); c.lineTo(x - r * 0.8, y + r * 0.2); c.closePath(); c.moveTo(x, y + r * 0.2); c.lineTo(x, y + r * 1.2); c.moveTo(x - r * 0.45, y + r * 0.7); c.lineTo(x + r * 0.45, y + r * 0.7); }
    else { c.moveTo(x + r * 0.55, y); c.arc(x, y, r * 0.55, 0, TAU); c.moveTo(x - r * 0.55, y - r * 1.05); c.arc(x, y - r * 1.05, r * 0.55, Math.PI, 0, true); c.moveTo(x, y + r * 0.55); c.lineTo(x, y + r * 1.3); c.moveTo(x - r * 0.4, y + r * 0.95); c.lineTo(x + r * 0.4, y + r * 0.95); }
    c.stroke();
  }
  let noSun = false;
  function draw(now) {
    const c = T.g, G = geo();
    c.drawImage(wall(G), 0, 0, T.W, T.H);
    const L = lux ? clamp((now - luxAt) / 600) : 0;         // знак земли в середине — Fiat lux; на восьмёрке — золото
    c.strokeStyle = lux ? rgba([236, 204, 120], 0.6 + 0.4 * L) : ink(0.6); c.lineWidth = 1.1;
    elem(c, G.cx, G.cy, 9, false, true);
    if (lux) { c.strokeStyle = rgba([236, 204, 120], 0.25 * L); c.beginPath(); for (let k = 0; k < 12; k++) { const a = (k / 12) * TAU; c.moveTo(G.cx + Math.cos(a) * 14, G.cy + Math.sin(a) * 14); c.lineTo(G.cx + Math.cos(a) * 24, G.cy + Math.sin(a) * 24); } c.stroke(); }
    bodies.forEach((b, i) => {                              // следы — аттрактор, который они рисуют
      const tr = b.trail, n = tr.length / 2;
      if (n < 2) return;
      for (let seg = 0; seg < 4; seg++) {
        const a0 = Math.floor((n * seg) / 4), a1 = Math.floor((n * (seg + 1)) / 4);
        c.strokeStyle = rgba(TINT[i], 0.08 + 0.14 * seg); c.lineWidth = 1; c.beginPath();
        for (let k = a0; k <= Math.min(n - 1, a1); k++) { const X = G.cx + tr[2 * k] * G.R, Y = G.cy + tr[2 * k + 1] * G.R; k === a0 ? c.moveTo(X, Y) : c.lineTo(X, Y); }
        c.stroke();
      }
    });
    for (let i = 0; i < 3; i++) {                           // нити тяги — ярче, когда тела близко (сильнее модулируют)
      const a = px(G, bodies[i]), b = px(G, bodies[(i + 1) % 3]), d = Math.hypot(bodies[i].x - bodies[(i + 1) % 3].x, bodies[i].y - bodies[(i + 1) % 3].y), al = clamp(0.04 + (0.08 / Math.max(0.05, d)) * fx.nexus * 0.6, 0, 0.6);
      c.strokeStyle = ink(al); c.setLineDash([2, 4]); c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); c.setLineDash([]);
    }
    const held = new Set([...touches.values()].filter((t) => t.kind === 'body').map((t) => t.i));
    bodies.forEach((b, i) => {
      const p = px(G, b), r = 8 + 4 * Math.sqrt(b.m);
      if (b.amp > 0.05) T.glowAt(p.x, p.y, r * 2.4, b.amp * 0.35);
      c.fillStyle = BGC; c.beginPath(); c.arc(p.x, p.y, r + 4, 0, TAU); c.fill();
      c.strokeStyle = rgba(TINT[i], 0.5 + 0.5 * clamp(b.amp * 1.5)); c.lineWidth = 1; c.beginPath(); c.arc(p.x, p.y, r + 4, 0, TAU); c.stroke();
      if (b.fixed) { c.beginPath(); c.arc(p.x, p.y, r + 7.5, 0, TAU); c.stroke(); }   // на якоре — двойной обвод
      c.lineWidth = 1.2; glyph(c, i, p.x, p.y - (i === 2 ? 2 : 0), r * 0.55);
      if (held.has(i)) { T.mapText(NAMES[i], p.x, p.y - r - 26, 14, 0.95, 'center'); T.mapText(`${noteName(b.hz)} · ${Math.round(b.hz)} Hz`, p.x, p.y - r - 11, 11, 0.65, 'center'); }
    });
    G.av.forEach((a, i) => {                                // аватары внизу: знак тела, яркость — громкость, двойной обвод — на якоре
      const b = bodies[i];
      if (b.amp > 0.05) T.glowAt(a.x, a.y, 30, b.amp * 0.3);
      c.fillStyle = BGC; c.beginPath(); c.arc(a.x, a.y, a.r, 0, TAU); c.fill();
      c.strokeStyle = rgba(TINT[i], 0.45 + 0.55 * clamp(b.amp * 1.5)); c.lineWidth = 1; c.beginPath(); c.arc(a.x, a.y, a.r, 0, TAU); c.stroke();
      if (b.fixed) { c.beginPath(); c.arc(a.x, a.y, a.r + 3.5, 0, TAU); c.stroke(); }
      c.lineWidth = 1.2; glyph(c, i, a.x, a.y - (i === 2 ? 2 : 0), 7);
    });
    const P = G.plumb;                                      // отвес: тяга выключена — грузик внизу, светится
    c.lineWidth = 1; c.fillStyle = BGC; c.strokeStyle = ink(cadit ? 0.95 : 0.55); c.beginPath(); c.arc(P.x, P.y, P.r, 0, TAU); c.fill(); c.stroke();
    if (cadit) { c.beginPath(); c.arc(P.x, P.y, P.r + 3.5, 0, TAU); c.stroke(); }
    c.beginPath(); c.moveTo(P.x, P.y - 12); c.lineTo(P.x, P.y + 1); c.stroke();
    c.fillStyle = ink(cadit ? 0.95 : 0.6); c.beginPath(); c.moveTo(P.x - 5, P.y + 1); c.lineTo(P.x + 5, P.y + 1); c.lineTo(P.x, P.y + 11); c.closePath(); c.fill();
    if (!noSun) T.quarterSun(c, G.sun.x, G.sun.y, G.sun.r, 1, now, INK, BGC);
  }

  // ---------- мир ----------
  const deg = (d) => (d * Math.PI) / 180;
  const fxw = {
    sectors: [{ key: 'gravitas', label: 'gravitas', ang: deg(190) }, { key: 'flux', label: 'flux', ang: deg(150) }, { key: 'nexus', label: 'nexus', ang: deg(115) }, { key: 'hall', label: 'hall', ang: deg(80) }],
    get: (k) => fx[k], set: (k, v) => { fx[k] = v; applyFx(); }, text: (k) => `${Math.round(fx[k] * 100)}%`,
    arc: () => fx.hall, save: () => ({ ...fx }), load: (o) => { Object.assign(fx, o); applyFx(); },
  };
  function dice() {                                       // тела разбросаны и брошены, массы и ноты — аккорд
    const R = Math.random, chords = [[0, 7, 12], [0, 3, 7], [0, 5, 10], [-5, 0, 7], [0, 4, 11]], ch = chords[Math.floor(R() * chords.length)];
    bodies.forEach((b, i) => { const a = R() * TAU, r = 0.25 + R() * 0.55; b.x = Math.cos(a) * r; b.y = Math.sin(a) * r; b.vx = (R() - 0.5) * 1.6; b.vy = (R() - 0.5) * 1.6; b.m = 0.6 + R() * 1.2; b.semi = ch[i]; b.fixed = false; b.trail = []; });
    lux = false; cadit = false; still = false; start();
  }
  const tria = {
    n: 'XI', title: 'Tria corpora', sub: 'sal · sulphur · mercurius', theme: { ink: INK, bg: BGC, paper: PAPER },
    corner: { hit: (f) => { const G = geo(); return f.y > G.sun.y && Math.hypot(f.x - G.sun.x, f.y - G.sun.y) < G.sun.r + 6; }, draw: () => {} },   // солнце — карта
    fx: fxw,
    legend: [['throw', 'grab a body and throw it', 'the three pull each other — chaos'], ['double', 'double tap a body', 'anchor it · again — let go'],
      ['hold', 'hold a body or tap its medallion below', 'its sheet: mass, note, level, anchor'], ['tap', 'tap the sign of earth', 'Fiat lux: the figure eight'],
      ['tap', 'tap the plumb line', 'gravity off — all falls to the bottom · again — on'],
      ['tap', 'tap the sun', 'map of worlds']],
    build, tick, draw, down, move, up, dice,
    clear() { still = true; lux = false; cadit = false; bodies.forEach((b) => { b.vx = b.vy = 0; b.trail = []; }); },
    snapshot: () => JSON.stringify({ b: bodies.map(({ x, y, vx, vy, m, fixed, semi, level }) => ({ x, y, vx, vy, m, fixed, semi, level })), fx, still, lux, cadit }),
    restore(js) {
      const st = JSON.parse(js);
      st.b.forEach((q, i) => Object.assign(bodies[i], q, { trail: [] }));
      Object.assign(fx, st.fx); still = st.still; lux = st.lux; cadit = !!st.cadit; applyFx();
      if (!still) start();
    },
    sounding, mapShot(on) { noSun = on; },
  };
  T.registerWorld(11, tria);
  window.t2d.tria = {
    bodies, fx, geo, setFx: (k, v) => fxw.set(k, v), get still() { return still; }, get lux() { return lux; }, get cadit() { return cadit; }, get encounters() { return encounters; }, fiatLux,
    at: (i) => px(geo(), bodies[i]),
  };
})();
