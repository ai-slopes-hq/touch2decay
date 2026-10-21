// Oceanus — мир VIII: средневековая карта T-O (Orbis Terrarum): круг земли, разделённый буквой T на Asia, Europa и Africa,
// вокруг — Мировой океан, по краю — двенадцать ветров. Звук — сканирующий синтез (ocean-worklet.js): кольцо океана — цепочка
// масс на пружинах, его форма — форма волны. Голоса — города на земле: тап — город звучит, пока держишь; двойной тап — остаётся
// (до четырёх); место на круге — нота (по часовой от верха — полутоны), климат — октава (у берега низко, к Иерусалиму выше).
// Тронул воду — тянешь её к пальцу, по кольцу бегут волны, тембр живёт и успокаивается; быстрый тап по воде — всплеск.
// Луна обходит карту и тянет воду на себя (tide — чистый тон), ветер — рябь. Солнце — четвертью в левом верхнем углу: тап — карта.
(() => {
  'use strict';
  const T = window.T2D;
  const TAU = Math.PI * 2;
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const N = 64, VMAX = 6, PIN_MAX = 4;
  const INK = '206,222,226', BGC = '#081018', PAPER = '8,16,24';
  const NOTES = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];
  const WINDS = ['Septentrio', 'Aquilo', 'Subsolanus', 'Eurus', 'Auster', 'Africus', 'Favonius', 'Corus'];
  const CLIMA = ['litus', 'medium', 'Hierusalem'];

  // ---------- состояние ----------
  const fx = { tension: 0.45, damping: 0.4, wind: 0, tide: 0.55, hall: 0.4 };
  const voices = [];                                       // {slot, ang, rn, pinned, lvl, oct, held}
  let shape = new Float32Array(N), moon = 0, gains = new Array(VMAX).fill(0);
  const root = () => (T.scaleOn ? T.scaleRoot : 0);
  function semiOf(v) {                                    // климат (три пояса) — октава, угол — полутоны по часовой от верха
    const zone = v.rn > 2 / 3 ? 0 : v.rn > 1 / 3 ? 1 : 2;
    let s = zone * 12 + (v.ang / TAU) * 12 + root();
    if (T.scaleOn) s = T.snapSemi(Math.round(s));
    return s;
  }
  const hzOf = (v) => 55 * 2 ** (semiOf(v) / 12) * 2 ** (v.oct || 0);
  const f0 = hzOf;
  const noteName = (f) => { const m = Math.round(12 * Math.log2(f / 55)); return `${NOTES[((m % 12) + 12) % 12]}${Math.floor((m + 9) / 12) + 1}`; };

  // ---------- геометрия: портрет по центру; земля — круг Rd, океан до Ro, рамка ветров Rf ----------
  function geo() {
    const W = T.W, H = T.H, top = T.topY + 6, bot = H - T.safeBot - 8, h = bot - top, Ws = Math.min(W, (H - T.safeBot) * 0.62), cx = W / 2, cy = top + h * 0.5;
    const Ro = Math.min(Ws / 2 - 42, h * 0.34), Rd = Ro * 0.62, Rr = (Rd + Ro) / 2 + Ro * 0.04, amp = (Ro - Rd) * 0.42;
    return { W, H, top, bot, cx, cy, Ws, Ro, Rd, Rr, amp, Rf: Ro + 16, sun: { x: 0, y: T.topY + 2, r: Math.min(56, Ws * 0.15) } };
  }
  const polar = (G, x, y) => ({ d: Math.hypot(x - G.cx, y - G.cy), a: (Math.atan2(x - G.cx, -(y - G.cy)) + TAU) % TAU });   // угол от верха по часовой
  const at = (G, a, r) => ({ x: G.cx + Math.sin(a) * r, y: G.cy - Math.cos(a) * r });
  const surf = (G, a) => { const p = (a / TAU) * N, i = Math.floor(p), u = p - i; return G.Rr + G.amp * (shape[i % N] * (1 - u) + shape[(i + 1) % N] * u); };

  // ---------- звук ----------
  let actx = null, node = null, bus = null, ready = false, started = false, lastSound = 0, inWorld = false;
  const queue = [];
  const send = (m) => { if (node && ready) node.port.postMessage(m); else queue.push(m); };
  const VER = (document.currentScript && new URL(document.currentScript.src, location.href).searchParams.get('v')) || '0';
  function build(ctx, input) {
    actx = ctx;
    const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const pre = g(1), out = g(1.6), hallSend = g(0), h = T.hall();
    pre.connect(out); pre.connect(hallSend); hallSend.connect(h.input); h.out.connect(g(0.9)).connect(out);
    bus = { pre, out, hallSend, hall: h, input, live: false };
    ready = false; node = null; started = false;
    applyFx();
  }
  function start() {                                       // модуль океана — только когда в мир впервые зашли
    if (started || !actx) return;
    started = true;
    actx.audioWorklet.addModule(`ocean-worklet.js?v=${VER}`).then(() => {
      node = new AudioWorkletNode(actx, 'ocean', { numberOfInputs: 0, outputChannelCount: [2] });
      node.connect(bus.pre);
      node.port.onmessage = (e) => { const d = e.data; if (d.t === 'shape') { shape = Float32Array.from(d.x); moon = d.moon; gains = d.g; } };
      ready = true;
      sendParams();
      for (const v of voices) sendVoice(v);
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
    if (voices.length || gains.some((x) => x > 0.002)) lastSound = performance.now();
    else if (performance.now() - lastSound > 8000) setLive(false);
  }, 1000);
  const luna = { orbit: 0.45, storm: 0, sway: 0, to: 0 };   // луна — LFO мира: орбита, рывки, качание (sway) натяжения, высоты или затухания
  const SWAY_TO = ['tension', 'pitch', 'damping'];
  function lunaSheet() {
    T.openSheet({
      title: 'luna', hint: 'the moon — tap outside to close',
      rows: [{ key: 'orbit', label: 'orbit' }, { key: 'storm', label: 'shape' }, { key: 'pull', label: 'pull' }, { key: 'sway', label: 'sway' }, { key: 'to', label: 'sway to' }],
      get: (k) => (k === 'pull' ? fx.tide : k === 'to' ? (luna.to + 0.5) / 3 : luna[k]),
      set: (k, v) => { if (k === 'pull') fx.tide = v; else if (k === 'storm') luna.storm = v >= 0.5 ? 1 : 0; else if (k === 'to') luna.to = Math.min(2, Math.floor(v * 3)); else luna[k] = v; applyFx(); },
      text: (k) => (k === 'orbit' ? `${(1 / (0.005 * 40 ** luna.orbit)).toFixed(0)} s` : k === 'storm' ? (luna.storm ? 'storm' : 'sine') : k === 'to' ? SWAY_TO[luna.to] : k === 'sway' && luna.sway < 0.01 ? 'off' : `${Math.round((k === 'pull' ? fx.tide : luna[k]) * 100)}%`),
    });
  }
  function sendParams() {
    send({ t: 'params', kt: 0.004 * 60 ** fx.tension, damp: 0.00003 * 300 ** fx.damping, kc: 0.0015 + 0.004 * fx.tide, wind: fx.wind * fx.wind, tide: fx.tide * 0.9, moonRate: 0.005 * 40 ** luna.orbit, storm: luna.storm, sway: luna.sway, swayTo: luna.to });
  }
  function applyFx() {
    if (!bus) return;
    const t = actx.currentTime;
    bus.hallSend.gain.setTargetAtTime(fx.hall * fx.hall * 1.4, t, 0.05);
    for (const l of bus.hall.lines) l.g.gain.setTargetAtTime(10 ** ((-3 * l.len) / (1.5 + fx.hall * 4)), t, 0.05);
    sendParams();
  }
  const PATHS = ['orbis', 'retro', 'pendulum'];             // путь скана: по кругу, против, туда-обратно
  function sendVoice(v, on = true) { send({ t: 'voice', i: v.slot, on, f: hzOf(v), lvl: v.lvl * 0.8, path: v.path || 0 }); if (on) { setLive(true); lastSound = performance.now(); } }
  function addVoice(ang, rn, pinned) {
    const used = new Set(voices.map((v) => v.slot)), slot = [...Array(VMAX).keys()].find((k) => !used.has(k));
    if (slot == null) return null;
    start();
    const v = { slot, ang, rn, pinned, lvl: 0.8, oct: 0, path: 0 };
    voices.push(v); sendVoice(v);
    return v;
  }
  function dropVoice(v) { sendVoice(v, false); voices.splice(voices.indexOf(v), 1); }
  const sounding = () => voices.length > 0;

  // ---------- касания ----------
  const touches = new Map();
  let lastTap = null;
  function voiceAt(G, x, y) {
    let best = null, bd = 26;
    for (const v of voices) { const p = at(G, v.ang, v.rn * G.Rd); const d = Math.hypot(x - p.x, y - p.y); if (d < bd) { bd = d; best = v; } }
    return best;
  }
  function down(f) {
    start();
    const G = geo(), P = polar(G, f.x, f.y), now = performance.now(), mp = at(G, moon * TAU, G.Rf + 22);
    if (Math.hypot(f.x - mp.x, f.y - mp.y) < 26) { touches.set(f.id, { kind: 'moon', t0: now }); return; }   // луна: держишь — её плашка
    if (P.d < G.Rd - 2) {                                  // земля: города-голоса
      const near = voiceAt(G, f.x, f.y);
      if (near && near.pinned) {
        if (lastTap && lastTap.v === near && now - lastTap.t < T.DTAP_MS) { lastTap = null; dropVoice(near); touches.set(f.id, { kind: 'none' }); return; }   // двойной тап по оставленному — отпустить
        lastTap = { v: near, t: now };
        touches.set(f.id, { kind: 'voice', v: near, x0: f.x, y0: f.y, t0: now, moved: false });
        return;
      }
      const rn = clamp(P.d / G.Rd, 0, 0.98);
      if (lastTap && !lastTap.v && now - lastTap.t < T.DTAP_MS && Math.hypot(f.x - lastTap.x, f.y - lastTap.y) < 34 && voices.filter((v) => v.pinned).length < PIN_MAX) {
        lastTap = null; addVoice(P.a, rn, true); touches.set(f.id, { kind: 'none' }); return;   // двойной тап — город остаётся и звучит
      }
      lastTap = { x: f.x, y: f.y, t: now };
      const v = addVoice(P.a, rn, false);
      touches.set(f.id, v ? { kind: 'voice', v, temp: true, x0: f.x, y0: f.y, t0: now, moved: false } : { kind: 'none' });
      return;
    }
    if (P.d < G.Rf + 8) {                                  // вода: тянешь к пальцу; быстрый тап — всплеск
      touches.set(f.id, { kind: 'water', t0: now, x0: f.x, y0: f.y, moved: false });
      pushTo(f.id, G, P);
      return;
    }
    touches.set(f.id, { kind: 'none' });
  }
  function pushTo(id, G, P) { send({ t: 'push', id, a: P.a / TAU, d: clamp((P.d - G.Rr) / G.amp, -2.5, 2.5), k: 0.06 }); }
  function move(f) {
    const t = touches.get(f.id);
    if (!t || t.kind === 'none' || t.sheet) return;
    const G = geo();
    if (Math.hypot(f.x - t.x0, f.y - t.y0) > 8) t.moved = true;
    if (t.kind === 'water') { pushTo(f.id, G, polar(G, f.x, f.y)); return; }
    if (t.kind === 'voice' && t.moved) {                   // ведёшь город — нота
      const P = polar(G, f.x, f.y);
      t.v.ang = P.a; t.v.rn = clamp(P.d / G.Rd, 0, 0.98); sendVoice(t.v);
    }
  }
  function up(f) {
    const t = touches.get(f.id);
    touches.delete(f.id);
    if (!t) return;
    if (t.kind === 'water') {
      send({ t: 'push', id: f.id, off: true });
      if (!t.moved && performance.now() - t.t0 < 220) { const G = geo(), P = polar(G, t.x0, t.y0); send({ t: 'splash', a: P.a / TAU, amt: P.d > G.Rr ? 0.35 : -0.35 }); ripple(t.x0, t.y0, 1); }
      else if (t.moved) ripple(f.x, f.y, 0.5);
    }
    if (t.kind === 'voice' && t.temp && voices.includes(t.v)) dropVoice(t.v);
  }
  function voiceSheet(v) {
    T.openSheet({
      title: 'civitas', hint: 'city — tap outside to close',
      rows: [{ key: 'lvl', label: 'level' }, { key: 'oct', label: 'octave' }, { key: 'path', label: 'path' }],
      get: (k) => (k === 'oct' ? (v.oct + 1) / 2 : k === 'path' ? v.path / 2 : v.lvl),
      set: (k, x) => { if (k === 'oct') v.oct = Math.round(x * 2) - 1; else if (k === 'path') v.path = Math.round(x * 2); else v.lvl = x; sendVoice(v); },
      text: (k) => (k === 'oct' ? ['octave −1', 'octave 0', 'octave +1'][v.oct + 1] : k === 'path' ? PATHS[v.path] : `${Math.round(v.lvl * 100)}%`),
    });
  }
  function tick(now) {
    for (const t of touches.values()) if (t.kind === 'moon' && !t.sheet && now - t.t0 > T.HOLD_MS * 0.6) { t.sheet = true; lunaSheet(); }
    for (const t of touches.values()) if (t.kind === 'voice' && !t.temp && !t.moved && !t.sheet && now - t.t0 > T.HOLD_MS) { t.sheet = true; voiceSheet(t.v); }   // держишь оставленный город — плашка
  }

  // ---------- рисование ----------
  let wallC = null, wallKey = '';
  const ink = (a) => `rgba(${INK},${a})`;
  function wall(G) {                                      // рамка ветров с румбами, земля T-O с климатами, деления нот по краю земли
    const pcs = T.scalePCs, key = `${G.W}x${G.H}x${T.DPR}|${G.cy}|${pcs ? pcs.join(',') : '-'}|${root()}`;
    if (wallC && key === wallKey) return wallC;
    wallKey = key;
    wallC = document.createElement('canvas');
    wallC.width = Math.round(G.W * T.DPR); wallC.height = Math.round(G.H * T.DPR);
    const x = wallC.getContext('2d');
    x.setTransform(T.DPR, 0, 0, T.DPR, 0, 0);
    x.fillStyle = BGC; x.fillRect(0, 0, G.W, G.H);
    const { cx, cy, Rf, Rd } = G;
    x.lineWidth = 1;
    x.strokeStyle = ink(0.07); x.beginPath();               // румбы портолана — из центра и с 16 точек рамки
    for (let k = 0; k < 16; k++) { const a = (k / 16) * TAU, p = at(G, a, Rf); x.moveTo(cx, cy); x.lineTo(p.x, p.y); for (let j = k + 3; j < k + 14; j += 5) { const q = at(G, (j / 16) * TAU, Rf); x.moveTo(p.x, p.y); x.lineTo(q.x, q.y); } }
    x.stroke();
    x.strokeStyle = ink(0.6); x.beginPath(); x.arc(cx, cy, Rf, 0, TAU); x.stroke();
    x.strokeStyle = ink(0.25); x.beginPath(); x.arc(cx, cy, Rf - 4, 0, TAU); x.stroke();
    x.strokeStyle = ink(0.4); x.beginPath();
    for (let k = 0; k < 32; k++) { const a = (k / 32) * TAU, l = k % 4 ? 2.5 : 5, p = at(G, a, Rf), q = at(G, a, Rf + l); x.moveTo(p.x, p.y); x.lineTo(q.x, q.y); }
    x.stroke();
    x.fillStyle = BGC; x.beginPath(); x.arc(cx, cy, Rd, 0, TAU); x.fill();                 // земля
    x.strokeStyle = ink(0.75); x.beginPath(); x.arc(cx, cy, Rd, 0, TAU); x.stroke();
    x.strokeStyle = ink(0.16); x.setLineDash([2, 4]);                                         // климаты — октавы
    for (const k of [1 / 3, 2 / 3]) { x.beginPath(); x.arc(cx, cy, Rd * k, 0, TAU); x.stroke(); }
    x.setLineDash([]);
    x.strokeStyle = ink(0.5); x.beginPath();                                                  // T: Танаис — Нил поперёк, Средиземное море вниз
    x.moveTo(cx - Rd, cy); x.lineTo(cx + Rd, cy); x.moveTo(cx, cy); x.lineTo(cx, cy + Rd); x.stroke();
    x.strokeStyle = ink(0.6); x.beginPath(); x.arc(cx, cy, 3, 0, TAU); x.stroke();          // Иерусалим — пуп земли
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = `italic 11px ${T.MAP}`; x.fillStyle = ink(0.42);                                // воды буквы T: Танаис и Нил — поперёк, Великое море — вниз
    x.fillText('Tanais', cx - Rd * 0.5, cy - 8); x.fillText('Nilus', cx + Rd * 0.5, cy - 8);
    x.save(); x.translate(cx + 8, cy + Rd * 0.55); x.rotate(Math.PI / 2); x.fillText('Mare Magnum', 0, 0); x.restore();
    x.font = `italic 10px ${T.MAP}`; x.fillStyle = ink(0.26);                                // части света — по сыновьям Ноя
    x.fillText('Sem', cx - Rd * 0.42, cy - Rd * 0.3); x.fillText('Iafeth', cx - Rd * 0.42, cy + Rd * 0.62); x.fillText('Cham', cx + Rd * 0.42, cy + Rd * 0.62);
    x.fillText('Hierusalem', cx, cy + 11);
    const py = cy - Rd * 0.68, pr = Math.max(7, Rd * 0.07);                                   // земной рай на востоке (наверху): ограда и четыре реки
    x.strokeStyle = ink(0.55); x.beginPath(); x.arc(cx, py, pr, 0, TAU); x.stroke();
    x.strokeStyle = ink(0.25); x.beginPath(); x.arc(cx, py, pr - 2.5, 0, TAU); x.stroke();
    x.strokeStyle = ink(0.35); x.beginPath();
    for (const a of [-0.9, -0.3, 0.3, 0.9]) { const sx = cx + Math.sin(a) * pr, sy = py + Math.cos(a) * pr; x.moveTo(sx, sy); x.quadraticCurveTo(sx + Math.sin(a) * 10, sy + 8, sx + Math.sin(a) * 16, sy + 16 + Math.abs(a) * 4); }
    x.stroke();
    x.fillStyle = ink(0.4); x.fillText('Paradisus', cx, py + pr + 27);
    for (let k = 0; k < 12; k++) {                        // полутоны по краю земли; ступени лада — длиннее
      const pc = (k + root()) % 12, inScale = !pcs || pcs.includes(pc), a = (k / 12) * TAU, p = at(G, a, Rd), q = at(G, a, Rd - (inScale ? 7 : 3));
      x.strokeStyle = ink(inScale ? 0.55 : 0.22); x.beginPath(); x.moveTo(p.x, p.y); x.lineTo(q.x, q.y); x.stroke();
    }
    return wallC;
  }
  const ripples = [], foam = Array.from({ length: 44 }, (_, i) => ({ a: Math.random() * TAU, lane: 0.2 + 0.7 * Math.random(), dir: i % 2 ? 1 : -1, len: 0.03 + Math.random() * 0.05 }));
  let foamT = 0;
  function ripple(x, y, k) { ripples.push({ x, y, t: performance.now(), k }); if (ripples.length > 12) ripples.shift(); }
  function drawCurrents(c, G, now) {                      // течения: пена бежит по кругу двумя потоками — быстрее с натяжением; круги от всплесков
    const dt = foamT ? Math.min(0.1, (now - foamT) / 1000) : 0, w = 0.05 + 0.35 * fx.tension;
    foamT = now;
    c.lineWidth = 0.8;
    for (const f of foam) {
      f.a = (f.a + f.dir * w * dt * (0.6 + f.lane) + TAU) % TAU;
      const r = G.Rd + (surf(G, f.a) - G.Rd) * f.lane, al = 0.1 + 0.25 * f.lane + 0.25 * fx.wind;
      c.strokeStyle = ink(al); c.beginPath(); c.arc(G.cx, G.cy, r, f.a - Math.PI / 2, f.a - Math.PI / 2 + f.len * f.dir, f.dir < 0); c.stroke();
    }
    for (let i = ripples.length - 1; i >= 0; i--) {
      const q = ripples[i], k = (now - q.t) / 1300;
      if (k >= 1) { ripples.splice(i, 1); continue; }
      c.strokeStyle = ink(0.5 * (1 - k) * q.k); c.lineWidth = 1;
      for (const m of [1, 0.6]) { c.beginPath(); c.arc(q.x, q.y, 4 + 30 * k * m, 0, TAU); c.stroke(); }
    }
  }
  function drawReflection(c, G, now) {                    // луна отражается в воде: дрожащие штрихи под поверхностью, по форме кольца
    if (fx.tide < 0.03) return;
    const ma = moon * TAU, r0 = surf(G, ma);
    c.lineWidth = 1;
    for (let j = 0; j < 5; j++) {
      const r = r0 - 6 - j * 5, wob = Math.sin(now * 0.004 + j * 1.7) * 0.02 + (shape[Math.floor((ma / TAU) * N + j) % N] || 0) * 0.03, half = (0.07 - j * 0.011) * (0.6 + 0.4 * fx.tide);
      if (r < G.Rd + 3) break;
      c.strokeStyle = ink((0.4 - j * 0.06) * Math.min(1, fx.tide * 1.5)); c.beginPath(); c.arc(G.cx, G.cy, r, ma + wob - half - Math.PI / 2, ma + wob + half - Math.PI / 2); c.stroke();
    }
  }
  function drawOcean(c, G, now) {                         // вода: поверхность — форма кольца, две линии штриховки следуют за ней
    drawCurrents(c, G, now); drawReflection(c, G, now);
    const M = 96;
    for (const [k, al] of [[1, 0.85], [0.66, 0.3], [0.33, 0.18]]) {
      c.strokeStyle = ink(al); c.lineWidth = k === 1 ? 1.2 : 0.8; c.beginPath();
      for (let i = 0; i <= M; i++) { const a = (i / M) * TAU, r = G.Rd + (surf(G, a) - G.Rd) * k, p = at(G, a, r); i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y); }
      c.closePath(); c.stroke();
    }
    c.strokeStyle = ink(0.22); c.lineWidth = 0.8; c.beginPath();   // гребешки волн: короткие штрихи там, где вода круче
    for (let i = 0; i < N; i++) {
      const d = shape[(i + 1) % N] - shape[i], a = ((i + 0.5) / N) * TAU;
      if (Math.abs(d) < 0.06) continue;
      const r = surf(G, a) + 3, p = at(G, a, r), q = at(G, a + Math.sign(d) * 0.05, r + Math.min(6, Math.abs(d) * 30));
      c.moveTo(p.x, p.y); c.lineTo(q.x, q.y);
    }
    c.stroke();
    const ma = moon * TAU, mp = at(G, ma, G.Rf + 22), mr = 5 + 4 * fx.tide;   // луна тянет воду на себя
    if (luna.sway > 0.01) { c.strokeStyle = ink(0.15 + 0.35 * luna.sway); c.lineWidth = 1; c.setLineDash(luna.storm ? [2, 3] : []); c.beginPath(); c.arc(mp.x, mp.y, mr + 4 + 6 * luna.sway * (0.5 + 0.5 * Math.sin(ma)), 0, TAU); c.stroke(); c.setLineDash([]); }   // качание: ореол дышит с луной
    c.fillStyle = ink(0.85); c.beginPath(); c.arc(mp.x, mp.y, mr, 0, TAU); c.fill();
    c.fillStyle = BGC; c.beginPath(); c.arc(mp.x + mr * 0.45, mp.y - mr * 0.2, mr * 0.88, 0, TAU); c.fill();
    if (fx.tide > 0.05) { c.strokeStyle = ink(0.12 + 0.2 * fx.tide); c.setLineDash([2, 5]); c.beginPath(); const q = at(G, ma, surf(G, ma) + 4); c.moveTo(mp.x, mp.y); c.lineTo(q.x, q.y); c.stroke(); c.setLineDash([]); }
    c.font = `italic 10.5px ${T.MAP}`; c.textAlign = 'center'; c.textBaseline = 'middle';   // ветры по кругу: ярче с ветром
    WINDS.forEach((nm, k) => {
      const a = (k / 8) * TAU, p = at(G, a, G.Rf + 10);
      c.save(); c.translate(p.x, p.y); c.rotate(a > Math.PI / 2 && a < Math.PI * 1.5 ? a + Math.PI : a);
      c.fillStyle = ink(0.28 + 0.6 * fx.wind * (0.6 + 0.4 * Math.sin(now * 0.002 + k))); c.fillText(nm, 0, k % 2 ? 0 : 0); c.restore();
    });
  }
  function drawVoices(c, G, now) {
    for (const v of voices) {
      const ph = (now * 0.00025 * Math.sqrt(f0(v) / 55)) % 1, qq = v.path === 1 ? 1 - ph : v.path === 2 ? (ph < 0.5 ? 2 * ph : 2 - 2 * ph) : ph;   // луч скана идёт по своему пути
      const p = at(G, v.ang, v.rn * G.Rd), g = gains[v.slot] || 0, f = hzOf(v), sa = qq * TAU, q = at(G, sa, surf(G, sa));
      c.strokeStyle = ink(0.12 + 0.35 * g); c.lineWidth = 0.8; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(q.x, q.y); c.stroke();   // луч скана: голос читает кольцо по кругу
      if (g > 0.05) T.glowAt(p.x, p.y, 18, g * 0.35);
      c.fillStyle = BGC; c.strokeStyle = ink(0.9); c.lineWidth = 1;
      c.beginPath(); c.arc(p.x, p.y, 6, 0, TAU); c.fill(); c.stroke();
      if (v.pinned) { c.beginPath(); c.arc(p.x, p.y, 9, 0, TAU); c.stroke(); }
      c.beginPath(); c.moveTo(p.x, p.y - 4); c.lineTo(p.x, p.y + 4); c.moveTo(p.x - 4, p.y); c.lineTo(p.x + 4, p.y); c.stroke();   // город: крест в круге
    }
    for (const t of touches.values()) {                   // подписи — только пока трогаешь
      if (t.kind !== 'voice') continue;
      const v = t.v, p = at(G, v.ang, v.rn * G.Rd), f = hzOf(v), zone = v.rn > 2 / 3 ? 0 : v.rn > 1 / 3 ? 1 : 2;
      T.mapText(`${noteName(f)} · ${Math.round(f)} Hz`, p.x, p.y - 26, 14, 0.95, 'center');
      T.mapText(`clima ${CLIMA[zone]}`, p.x, p.y - 12, 11, 0.55, 'center');
    }
  }
  let noSun = false;
  function draw(now) {
    const c = T.g, G = geo();
    c.drawImage(wall(G), 0, 0, T.W, T.H);
    drawOcean(c, G, now);
    drawVoices(c, G, now);
    if (!noSun) T.quarterSun(c, G.sun.x, G.sun.y, G.sun.r, 1, now, INK, BGC);
  }

  // ---------- мир ----------
  const deg = (d) => (d * Math.PI) / 180;
  const fxw = {
    sectors: [
      { key: 'tension', label: 'tension', ang: deg(200) }, { key: 'damping', label: 'damping', ang: deg(170) }, { key: 'tide', label: 'tide', ang: deg(140) },
      { key: 'wind', label: 'wind', ang: deg(110) }, { key: 'hall', label: 'hall', ang: deg(80) },
    ],
    get: (k) => fx[k], set: (k, v) => { fx[k] = v; applyFx(); }, text: (k) => `${Math.round(fx[k] * 100)}%`,
    lfo: { keys: ['tension', 'damping', 'tide', 'wind', 'hall'], shapes: 'classic' },
    arc: () => fx.hall, save: () => ({ ...fx }), load: (o) => { Object.assign(fx, o); applyFx(); },
  };
  function dice() {                                       // два-три города на ступенях лада, натяжение и затухание — вразброс, всплеск
    const R = Math.random;
    while (voices.length) dropVoice(voices[0]);
    const n = 2 + Math.floor(R() * 2);
    for (let k = 0; k < n; k++) addVoice(Math.floor(R() * 12) / 12 * TAU + 0.01, [0.84, 0.5, 0.18][Math.floor(R() * 3)], true);
    fx.tension = 0.2 + 0.6 * R(); fx.damping = 0.15 + 0.6 * R(); applyFx();
    send({ t: 'splash', a: R(), amt: 0.4 });
    for (const v of voices) { v.path = Math.floor(R() * 3); sendVoice(v); }
  }
  const ocean = {
    n: 'VIII', title: 'Oceanus', sub: 'orbis terrarum', theme: { ink: INK, bg: BGC, paper: PAPER },
    corner: { hit: (f) => { const G = geo(); return f.y > G.sun.y && Math.hypot(f.x - G.sun.x, f.y - G.sun.y) < G.sun.r + 6; }, draw: () => {} },   // солнце — карта
    fx: fxw,
    legend: [['tap', 'touch the land', 'a city sings while you hold it'], ['double', 'double tap the land', 'the city stays (up to four)'],
      ['drag', 'drag a city', 'pitch · clockwise — semitones, inland — octave up'], ['hold', 'hold a staying city', 'its sheet: level, octave'],
      ['drag', 'touch the ocean', 'pull the water · waves run round — the timbre lives'], ['tap', 'quick tap on the water', 'splash'],
      ['hold', 'hold the moon', 'its sheet: orbit, shape, pull, sway — the moon as an LFO'], ['tap', 'tap the sun', 'map of worlds']],
    build, tick, draw, down, move, up, dice, enter: () => { inWorld = true; start(); }, leave: () => { inWorld = false; },
    clear() { while (voices.length) dropVoice(voices[0]); },
    snapshot: () => JSON.stringify({ v: voices.filter((v) => v.pinned).map(({ ang, rn, lvl, oct, path }) => ({ ang, rn, lvl, oct, path })), fx, luna: { ...luna } }),
    restore(js) {
      const st = JSON.parse(js);
      while (voices.length) dropVoice(voices[0]);
      for (const q of st.v) { const v = addVoice(q.ang, q.rn, true); if (v) { v.lvl = q.lvl; v.oct = q.oct; v.path = q.path || 0; sendVoice(v); } }
      Object.assign(fx, st.fx); if (st.luna) Object.assign(luna, st.luna); applyFx();
    },
    sounding, mapShot(on) { noSun = on; },
  };
  T.registerWorld(8, ocean);
  window.t2d.ocean = {
    voices, fx, geo, setFx: (k, v) => fxw.set(k, v), get ready() { return ready; }, get live() { return !!(bus && bus.live); },
    luna, moonAt: () => { const G = geo(); return at(G, moon * TAU, G.Rf + 22); }, get shape() { return shape; }, get ripples() { return ripples.length; }, send: (v) => sendVoice(v), get gains() { return gains; }, hz: hzOf,
    at: (a, rn) => at(geo(), a, rn * geo().Rd), water: (a, k) => { const G = geo(); return at(G, a, G.Rd + (G.Ro - G.Rd) * k); },
  };
})();
