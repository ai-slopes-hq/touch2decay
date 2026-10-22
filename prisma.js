// Prisma — мир XVII (в Таро XVII — Звезда): опыт Ньютона. Солнце в левом верхнем углу бьёт в отверстие ставня, луч идёт в тёмную
// комнату на призму, призма раскладывает его веером на 16 цветных лучей — 16 гармоник (аддитивный синтез, дрон).
// Отверстие — тап: открыть/закрыть свет (звук); вверх-вниз по ставню — высота. Призма — вбок: поворот, какие гармоники ярче
// (центр спектра), вверх-вниз: веер раскрывается — гармоники растягиваются в негармонику (колокол). Тап по лучу — заслонка, гармоника
// гаснет. Держишь отверстие или призму — плашка. FX: scintilla (гармоники мерцают), impar (только нечётные — к квадрату), spread, hall.
// Яркость луча — громкость его гармоники; пятна на стене справа — спектр. Солнце — карта.
(() => {
  'use strict';
  const T = window.T2D;
  const TAU = Math.PI * 2;
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const INK = '226,226,236', BGC = '#07080d', PAPER = '7,8,13';
  const NH = 16;
  const NOTES = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];
  const hue = (k) => `hsla(${Math.round((k / (NH - 1)) * 275)},85%,62%,`;    // 0 — красный, 15 — фиолетовый
  const noteName = (st) => { const m = Math.round(st); return `${NOTES[((m % 12) + 12) % 12]}${Math.floor((m + 9) / 12) + 1}`; };

  // ---------- состояние ----------
  const st = { on: false, semi: 12, rot: 0, stretch: 0, width: 0.9, lvl: 0.8 };    // semi — от 55 Гц; rot −1…1 — центр спектра; stretch 0…1
  const blocked = new Array(NH).fill(false);
  const fx = { scintilla: 0.15, impar: 0, spread: 0.5, hall: 0.4 };
  const semiOf = () => (T.scaleOn ? T.snapSemi(st.semi + 24) - 24 : st.semi);
  const f0 = () => 55 * 2 ** (semiOf() / 12);
  const fk = (k) => f0() * (k + 1) ** (1 + 0.14 * st.stretch);               // k = 0 — основной тон
  const center = () => ((st.rot + 1) / 2) * 4;                                  // центр спектра в октавах над основным: 0…4
  function amps() {                                     // окно по октавам вокруг центра, наклон 1/√k, заслонки, impar, выше 16 кГц — тишина
    const a = [], c = center(), w = 0.25 + st.width * 1.6;
    for (let k = 0; k < NH; k++) {
      const o = Math.log2(k + 1), odd = k % 2 === 0;
      let v = Math.exp(-((o - c) ** 2) / (2 * w * w)) / Math.sqrt(k + 1);
      if (!odd) v *= 1 - fx.impar;
      if (blocked[k] || fk(k) > 16000) v = 0;
      a.push(v);
    }
    return a;
  }

  // ---------- геометрия: ставень слева с отверстием, призма, веер лучей, стена справа ----------
  function geo() {
    const W = T.W, H = T.H, top = T.topY + 6, bot = H - T.safeBot - 8, Ws = Math.min(W, (H - T.safeBot) * 0.62), cx = W / 2;
    const wallX = cx - Ws / 2 + 64, railT = top + 70, railB = bot - 70, screenX = cx + Ws / 2 - 14;
    const holeY = railB - ((st.semi + 12) / 36) * (railB - railT);                // выше — выше
    const px = cx - Ws * 0.08, py = (top + bot) / 2 + 10, ps = Math.min(48, Ws * 0.13);
    return { W, H, top, bot, cx, Ws, wallX, railT, railB, screenX, holeY, px, py, ps, sun: { x: 0, y: top - 4, r: 58 } };
  }
  function rays(G) {                                    // концы лучей на стене: веер вокруг направления, которое задаёт поворот
    const out = [], ax = G.px + G.ps * 0.35, ay = G.py, L = G.screenX - ax, spread = 0.05 + 0.05 * st.stretch, dir = st.rot * 0.35;
    for (let k = 0; k < NH; k++) { const a = dir + (k - (NH - 1) / 2) * spread * 0.32; out.push({ x0: ax, y0: ay, x1: G.screenX, y1: ay + Math.tan(a) * L }); }
    return out;
  }

  // ---------- звук: 16 синусов, у каждого громкость и место в стерео ----------
  let actx = null, bus = null, osc = null, lastSound = 0, gainsNow = new Array(NH).fill(0);
  function build(ctx, input) {
    actx = ctx;
    const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const pre = g(1), out = g(1), hallSend = g(0), h = T.hall();
    pre.connect(out); pre.connect(hallSend); hallSend.connect(h.input); h.out.connect(g(0.9)).connect(out);
    bus = { pre, out, hallSend, hall: h, input, live: false, master: g(0) };
    bus.master.connect(pre);
    osc = null;
    applyFx();
    if (st.on) lightOn();
  }
  function setLive(on) {
    if (!bus || bus.live === on) return;
    bus.live = on;
    if (on) bus.out.connect(bus.input); else bus.out.disconnect();
  }
  setInterval(() => { if (!bus) return; if (st.on) lastSound = performance.now(); else if (performance.now() - lastSound > 9000) { setLive(false); stopOsc(); } }, 1000);
  function startOsc() {
    if (osc || !actx) return;
    osc = [];
    for (let k = 0; k < NH; k++) {
      const o = actx.createOscillator(), gn = actx.createGain(), pn = actx.createStereoPanner();
      o.frequency.value = fk(k); gn.gain.value = 0; pn.pan.value = 0;
      o.connect(gn).connect(pn).connect(bus.master); o.start();
      osc.push({ o, gn, pn, a: 0 });
    }
  }
  function stopOsc() { if (!osc) return; for (const v of osc) { try { v.o.stop(); } catch (e) {} v.o.disconnect(); v.pn.disconnect(); } osc = null; }
  function lightOn() { st.on = true; startOsc(); setLive(true); lastSound = performance.now(); update(true); }
  function lightOff() { st.on = false; update(true); }
  let shimmer = new Array(NH).fill(1), shAt = 0;
  function update(now) {                                // частоты, громкости, стерео; мерцание — в tick
    if (!osc || !actx) return;
    const t = actx.currentTime, a = amps(), norm = 1 / Math.max(0.35, Math.sqrt(a.reduce((s, v) => s + v * v, 0)));
    bus.master.gain.setTargetAtTime(st.on ? st.lvl * 0.22 : 0, t, st.on ? 0.08 : 0.25);
    for (let k = 0; k < NH; k++) {
      const v = osc[k];
      v.o.frequency.setTargetAtTime(fk(k), t, 0.03);
      v.a = a[k] * norm;
      v.gn.gain.setTargetAtTime(v.a * shimmer[k], t, now === true ? 0.02 : 0.06);
      v.pn.pan.setTargetAtTime((k % 2 ? 1 : -1) * Math.min(1, 0.15 + k * 0.06) * fx.spread, t, 0.05);
      gainsNow[k] = st.on ? v.a * shimmer[k] : 0;
    }
  }
  function applyFx() {
    if (!bus) return;
    const t = actx.currentTime;
    bus.hallSend.gain.setTargetAtTime(fx.hall * fx.hall * 1.5, t, 0.05);
    for (const l of bus.hall.lines) l.g.gain.setTargetAtTime(10 ** ((-3 * l.len) / (1.5 + fx.hall * 5)), t, 0.05);
    update();
  }
  function tick(now) {
    if (now - shAt > 70) {                              // scintilla: каждая гармоника случайно приседает, плавно
      shAt = now;
      for (let k = 0; k < NH; k++) shimmer[k] += ((1 - fx.scintilla * Math.random() ** 1.5) - shimmer[k]) * 0.5;
      if (st.on) update();
    }
    for (const t of touches.values()) if ((t.kind === 'hole' || t.kind === 'prism') && !t.moved && !t.sheet && now - t.t0 > T.HOLD_MS) { t.sheet = true; t.kind === 'hole' ? holeSheet() : prismSheet(); }
  }
  const sounding = () => st.on;

  // ---------- касания ----------
  const touches = new Map();
  function rayAt(G, x, y) {
    if (x < G.px + G.ps) return -1;
    let best = -1, bd = 9;
    rays(G).forEach((r, k) => { const u = (x - r.x0) / (r.x1 - r.x0), yy = r.y0 + (r.y1 - r.y0) * u, d = Math.abs(y - yy); if (d < bd) { bd = d; best = k; } });
    return best;
  }
  function down(f) {
    const G = geo(), now = performance.now();
    if (Math.abs(f.x - G.wallX) < 30 && f.y > G.railT - 30 && f.y < G.railB + 30) { touches.set(f.id, { kind: 'hole', y0: f.y, semi0: st.semi, t0: now, moved: false }); return; }
    if (Math.hypot(f.x - G.px, f.y - G.py) < G.ps * 1.1) { touches.set(f.id, { kind: 'prism', x0: f.x, y0: f.y, rot0: st.rot, str0: st.stretch, t0: now, moved: false, axis: null }); return; }
    const k = rayAt(G, f.x, f.y);
    if (k >= 0 && st.on) { blocked[k] = !blocked[k]; update(true); touches.set(f.id, { kind: 'none' }); return; }   // заслонка
    touches.set(f.id, { kind: 'none' });
  }
  function move(f) {
    const t = touches.get(f.id);
    if (!t || t.sheet) return;
    if (t.kind === 'hole') {
      if (Math.abs(f.y - t.y0) > 8) t.moved = true;
      if (!t.moved) return;
      const G = geo(), semi = clamp(Math.round(t.semi0 - ((f.y - t.y0) / (G.railB - G.railT)) * 36), -12, 24);
      if (semi !== st.semi) { st.semi = semi; if (!st.on) lightOn(); else update(); }
    } else if (t.kind === 'prism') {
      const dx = f.x - t.x0, dy = f.y - t.y0;
      if (!t.moved && Math.hypot(dx, dy) > 8) { t.moved = true; t.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'; }
      if (!t.moved) return;
      if (t.axis === 'x') st.rot = clamp(t.rot0 + dx / 140, -1, 1); else st.stretch = clamp(t.str0 + dy / 160);
      update();
    }
  }
  function up(f) {
    const t = touches.get(f.id);
    touches.delete(f.id);
    if (t && t.kind === 'hole' && !t.moved && !t.sheet && performance.now() - t.t0 < 300) (st.on ? lightOff : lightOn)();   // тап — ставень открыть/закрыть
  }
  function holeSheet() {
    T.openSheet({
      title: 'foramen', hint: 'the hole — tap outside to close',
      rows: [{ key: 'semi', label: 'pitch' }, { key: 'width', label: 'width' }, { key: 'lvl', label: 'level' }],
      lfo: { id: 'prisma-hole', keys: ['semi', 'width', 'lvl'], shapes: 'random' },
      get: (k) => (k === 'semi' ? (st.semi + 12) / 36 : st[k]),
      set: (k, v) => { if (k === 'semi') st.semi = Math.round(v * 36) - 12; else st[k] = v; update(); },
      text: (k) => (k === 'semi' ? `${noteName(semiOf())} · ${Math.round(f0())} Hz` : k === 'width' ? `${(0.25 + st.width * 1.6).toFixed(1)} oct` : `${Math.round(st.lvl * 100)}%`),
    });
  }
  function prismSheet() {
    T.openSheet({
      title: 'prisma', hint: 'tap outside to close',
      rows: [{ key: 'rot', label: 'colour' }, { key: 'stretch', label: 'stretch' }, { key: 'width', label: 'width' }],
      lfo: { id: 'prisma-prism', keys: ['rot', 'stretch', 'width'], shapes: 'random' },
      get: (k) => (k === 'rot' ? (st.rot + 1) / 2 : st[k]),
      set: (k, v) => { if (k === 'rot') st.rot = v * 2 - 1; else st[k] = v; update(); },
      text: (k) => (k === 'rot' ? `harmonic ${Math.round(2 ** center())}` : k === 'stretch' ? (st.stretch < 0.02 ? 'harmonic' : `${Math.round(st.stretch * 100)}%`) : `${(0.25 + st.width * 1.6).toFixed(1)} oct`),
    });
  }

  // ---------- рисование ----------
  const ink = (a) => `rgba(${INK},${a})`;
  let wallC = null, wallKey = '';
  function wall(G) {                                    // тёмная комната: ставень со шкалой, пол, стена справа с делениями
    const key = `${G.W}x${G.H}x${T.DPR}|${G.railT}|${G.railB}|${G.screenX}`;
    if (wallC && key === wallKey) return wallC;
    wallKey = key;
    wallC = document.createElement('canvas'); wallC.width = Math.round(G.W * T.DPR); wallC.height = Math.round(G.H * T.DPR);
    const x = wallC.getContext('2d'); x.setTransform(T.DPR, 0, 0, T.DPR, 0, 0);
    x.fillStyle = BGC; x.fillRect(0, 0, G.W, G.H);
    x.lineWidth = 1;
    x.strokeStyle = ink(0.7); x.beginPath(); x.moveTo(G.wallX, G.top + 40); x.lineTo(G.wallX, G.bot); x.stroke();       // ставень
    x.strokeStyle = ink(0.25); x.beginPath(); x.moveTo(G.wallX - 5, G.top + 40); x.lineTo(G.wallX - 5, G.bot); x.stroke();
    x.strokeStyle = ink(0.3); x.beginPath();
    for (let s = -12; s <= 24; s++) { const y = G.railB - ((s + 12) / 36) * (G.railB - G.railT), l = s % 12 === 0 ? 8 : 3; x.moveTo(G.wallX + 2, y); x.lineTo(G.wallX + 2 + l, y); }
    x.stroke();
    x.strokeStyle = ink(0.55); x.beginPath(); x.moveTo(G.screenX, G.top + 40); x.lineTo(G.screenX, G.bot); x.stroke();   // стена-экран
    x.strokeStyle = ink(0.07); x.beginPath(); for (let y = G.top + 44; y < G.bot; y += 6) { x.moveTo(G.screenX + 2, y); x.lineTo(G.W, y); } x.stroke();
    x.strokeStyle = ink(0.07); x.beginPath(); for (let px = 0; px < G.wallX - 6; px += 6) { x.moveTo(px, G.top + 40); x.lineTo(px, G.bot); } x.stroke();
    x.strokeStyle = ink(0.4); x.beginPath(); x.moveTo(G.wallX, G.bot - 0.5); x.lineTo(G.screenX, G.bot - 0.5); x.stroke();   // пол
    return wallC;
  }
  let noSun = false;
  function draw(now) {
    const c = T.g, G = geo(), R = rays(G), a = gainsNow, amax = Math.max(0.05, ...a);
    c.drawImage(wall(G), 0, 0, T.W, T.H);
    const hx = G.wallX, hy = G.holeY;
    if (st.on) {                                        // белый луч: от солнца к отверстию бледно, от отверстия к призме ярко
      c.strokeStyle = ink(0.12); c.lineWidth = 6; c.beginPath(); c.moveTo(G.sun.x + 20, G.sun.y + 20); c.lineTo(hx, hy); c.stroke();
      c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(hx, hy); c.lineTo(G.px - G.ps * 0.3, G.py); c.stroke();
      c.strokeStyle = 'rgba(255,255,255,0.12)'; c.lineWidth = 5; c.stroke(); c.lineWidth = 1;
      R.forEach((r, k) => {
        const v = a[k] / amax;
        if (blocked[k]) {                               // заслонка: луч обрывается у карточки
          const u = 0.35, xb = r.x0 + (r.x1 - r.x0) * u, yb = r.y0 + (r.y1 - r.y0) * u;
          c.strokeStyle = `${hue(k)}0.35)`; c.beginPath(); c.moveTo(r.x0, r.y0); c.lineTo(xb, yb); c.stroke();
          c.fillStyle = BGC; c.strokeStyle = ink(0.6); c.fillRect(xb, yb - 5, 3, 10); c.strokeRect(xb, yb - 5, 3, 10);
          return;
        }
        c.strokeStyle = `${hue(k)}${0.06 + 0.85 * v})`; c.lineWidth = 0.8 + 1.2 * v; c.beginPath(); c.moveTo(r.x0, r.y0); c.lineTo(r.x1, r.y1); c.stroke();
        if (v > 0.05) { c.fillStyle = `${hue(k)}${0.3 + 0.7 * v})`; c.fillRect(r.x1 - 1, r.y1 - 1.5, 3 + 9 * v, 3); }   // пятно на стене — спектр
      });
      c.lineWidth = 1;
    }
    c.fillStyle = st.on ? 'rgba(255,255,255,0.95)' : BGC; c.strokeStyle = ink(0.8);   // отверстие в ставне
    c.beginPath(); c.arc(hx, hy, 5, 0, TAU); c.fill(); c.stroke();
    if (st.on) T.glowAt(hx, hy, 18, 0.3);
    const held = [...touches.values()].find((t) => t.kind !== 'none');
    c.save(); c.translate(G.px, G.py); c.rotate(st.rot * 0.35);   // призма
    c.fillStyle = 'rgba(180,200,230,0.06)'; c.strokeStyle = ink(0.9); c.beginPath();
    for (let k = 0; k < 3; k++) { const ang = -Math.PI / 2 + (k / 3) * TAU; k ? c.lineTo(Math.cos(ang) * G.ps, Math.sin(ang) * G.ps) : c.moveTo(Math.cos(ang) * G.ps, Math.sin(ang) * G.ps); }
    c.closePath(); c.fill(); c.stroke();
    c.strokeStyle = ink(0.25); c.beginPath(); for (let k = 0; k < 3; k++) { const ang = -Math.PI / 2 + (k / 3) * TAU; k ? c.lineTo(Math.cos(ang) * (G.ps - 6), Math.sin(ang) * (G.ps - 6)) : c.moveTo(Math.cos(ang) * (G.ps - 6), Math.sin(ang) * (G.ps - 6)); } c.closePath(); c.stroke();
    c.restore();
    if (held && held.kind === 'hole') T.mapText(`${noteName(semiOf())} · ${Math.round(f0())} Hz`, hx + 16, hy - 16, 13, 0.9, 'left');
    if (held && held.kind === 'prism') { T.mapText(`harmonic ${Math.round(2 ** center())}`, G.px, G.py - G.ps - 26, 13, 0.9, 'center'); T.mapText(st.stretch < 0.02 ? 'harmonia' : `stretch ${Math.round(st.stretch * 100)}%`, G.px, G.py - G.ps - 11, 11, 0.6, 'center'); }
    if (!noSun) { c.save(); c.beginPath(); c.rect(0, 0, G.wallX - 6, G.H); c.clip(); T.sunGlyph(c, G.sun.x, G.sun.y, 0, Math.PI / 2, 1.2, now, INK, BGC); c.restore(); }
  }

  // ---------- мир ----------
  const deg = (d) => (d * Math.PI) / 180;
  const fxw = {
    sectors: [{ key: 'scintilla', label: 'scintilla', ang: deg(170) }, { key: 'impar', label: 'impar', ang: deg(140) }, { key: 'spread', label: 'spread', ang: deg(110) }, { key: 'hall', label: 'hall', ang: deg(80) }],
    get: (k) => fx[k], set: (k, v) => { fx[k] = v; applyFx(); }, text: (k) => `${Math.round(fx[k] * 100)}%`,
    lfo: { keys: ['scintilla', 'impar', 'spread', 'hall'], shapes: 'random' },
    arc: () => fx.hall, save: () => ({ ...fx }), load: (o) => { Object.assign(fx, o); applyFx(); },
  };
  function dice() {
    const R = Math.random;
    st.semi = [-5, 0, 3, 5, 7, 12][Math.floor(R() * 6)]; st.rot = R() * 1.6 - 0.8; st.stretch = R() < 0.6 ? 0 : R() * 0.7; st.width = 0.3 + R() * 0.7;
    for (let k = 0; k < NH; k++) blocked[k] = k > 0 && R() < 0.2;
    lightOn();
  }
  const prisma = {
    n: 'XVII', title: 'Prisma', sub: 'lux · harmonia', theme: { ink: INK, bg: BGC, paper: PAPER },
    corner: { hit: (f) => { const G = geo(); return f.x < G.wallX - 8 && Math.hypot(f.x - G.sun.x, f.y - G.sun.y) < G.sun.r; }, draw: () => {} },   // солнце — карта
    fx: fxw,
    legend: [['tap', 'tap the hole in the shutter', 'light on / off — the beam sounds'], ['up', 'drag the hole up or down', 'pitch'],
      ['drag', 'drag the prism sideways', 'which harmonics are bright'], ['up', 'drag the prism up or down', 'the fan opens — a bell'],
      ['tap', 'tap a ray', 'a shutter — that harmonic goes dark'], ['hold', 'hold the hole or the prism', 'its sheet'], ['tap', 'tap the sun', 'map of worlds']],
    build, tick, draw, down, move, up, dice,
    clear() { blocked.fill(false); lightOff(); },
    snapshot: () => JSON.stringify({ st, b: blocked, fx }),
    restore(js) { const s = JSON.parse(js); Object.assign(st, s.st); s.b.forEach((v, k) => (blocked[k] = v)); Object.assign(fx, s.fx); applyFx(); (st.on ? lightOn : lightOff)(); },
    sounding, mapShot(on) { noSun = on; },
  };
  T.registerWorld(17, prisma);
  window.t2d.prisma = { st, blocked, fx, geo, rays: () => rays(geo()), amps, f0, fk, setFx: (k, v) => fxw.set(k, v), get gains() { return gainsNow; }, get osc() { return !!osc; } };
})();
