// Harmonica vitrea — мир XVIII (в Таро XVIII — Луна): ночью на столе шесть бокалов с водой, в углу луна. Звук — трение по стеклу:
// шум трения гонит банк резонаторов бокала (моды стекла 1 : 2.32 : 4.25 : 6.63, добротность — decay). Ведёшь пальцем по ободу —
// бокал поёт, громче, чем быстрее ведёшь; отпустил — звенит и гаснет. Двойной тап по ободу — палец остаётся (бокал поёт сам,
// по ободу бежит огонёк), ещё раз — отпустить. Тап по бокалу — звон. Тянешь в бокале вверх-вниз — вода: больше воды — ниже (с ладом —
// по ступеням). Держишь бокал — плашка (water, decay, level). FX: crystal (верхние моды), tremor (биения), spread, hall. Луна — карта.
// Картинка: обод светится громкостью, на воде — рябь (стоячие волны), пока бокал поёт.
(() => {
  'use strict';
  const T = window.T2D;
  const TAU = Math.PI * 2;
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const INK = '214,222,236', BGC = '#0a0e16', PAPER = '10,14,22', MOON = [238, 226, 186], WATER = [120, 164, 210];
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const NOTES = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];
  const noteName = (st) => { const m = Math.round(st); return `${NOTES[((m % 12) + 12) % 12]}${Math.floor((m + 9) / 12) + 1}`; };
  const NG = 6, DRY = [36, 38, 41, 43, 45, 48], WMAX = 0.85;                  // сухой бокал — полутоны от 55 Гц (A4…A5); вода — до −8
  const MR = [1, 2.32, 4.25, 6.63], MG = [1, 0.32, 0.14, 0.06];

  // ---------- состояние ----------
  const glasses = Array.from({ length: NG }, (_, k) => ({ k, w: 0.15 + 0.1 * (k % 3), dec: 0.55, lvl: 0.8, pin: false, exc: 0, en: 0, sp: 0, ph: Math.random() * TAU }));
  const fx = { crystal: 0.4, tremor: 0.3, spread: 0.5, hall: 0.5 };
  const semiOf = (g) => { const s = DRY[g.k] - 8 * g.w ** 1.3; return T.scaleOn ? T.snapSemi(s) : s; };
  const freqOf = (g) => 55 * 2 ** (semiOf(g) / 12);
  const t60 = (g) => 0.6 + 6 * g.dec ** 1.5;                                   // звон, с

  // ---------- геометрия ----------
  function geo() {
    const W = T.W, H = T.H, top = T.topY + 6, bot = H - T.safeBot - 8, Ws = Math.min(W, (H - T.safeBot) * 0.62), cx = W / 2;
    const tableY = bot - 70, sp = Ws / 6.3, bw = sp * 0.8, bh = Math.min(200, (tableY - top) * 0.42), rimY = tableY - 52 - bh;
    const gl = glasses.map((g) => ({ x: cx + (g.k - 2.5) * sp, rx: bw / 2 }));
    return { W, H, top, bot, cx, Ws, tableY, sp, bw, bh, rimY, gl, moon: { x: cx - Ws / 2 + 40, y: top + 40, r: 40 } };
  }
  const waterY = (G, g) => G.rimY + G.bh * (1 - g.w);
  const halfW = (G, y) => G.bw / 2 * Math.sqrt(Math.max(0, 1 - ((y - G.rimY) / G.bh) ** 2));

  // ---------- звук ----------
  let actx = null, bus = null, noise = null, lastSound = 0;
  function build(ctx, input) {
    actx = ctx;
    const gn = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const pre = gn(1), out = gn(1), hallSend = gn(0), h = T.hall(), lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 6000;
    pre.connect(out); pre.connect(hallSend); hallSend.connect(h.input); h.out.connect(gn(0.9)).connect(out);
    bus = { pre, out, hallSend, hall: h, input, lp, live: false };
    for (const g of glasses) {                          // бокал: возбуждение → моды (bandpass) → громкость → стерео
      const exc = gn(0), sum = gn(1), pan = ctx.createStereoPanner();
      lp.connect(exc);
      const modes = MR.map(() => { const f = ctx.createBiquadFilter(), m = gn(0); f.type = 'bandpass'; exc.connect(f); f.connect(m); m.connect(sum); return { f, m }; });
      const tr = ctx.createBiquadFilter(), trg = gn(0); tr.type = 'bandpass'; exc.connect(tr); tr.connect(trg); trg.connect(sum);   // tremor — двойник основной моды
      sum.connect(pan); pan.connect(pre);
      g.au = { exc, sum, pan, modes, tr, trg };
    }
    noise = null;
    applyAll();
  }
  function start() {                                    // шум трения — один на мир, только пока что-то звучит
    if (noise || !actx) return;
    const len = actx.sampleRate * 2, b = actx.createBuffer(1, len, actx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    noise = actx.createBufferSource(); noise.buffer = b; noise.loop = true; noise.connect(bus.lp); noise.start();
  }
  function stopNoise() { if (!noise) return; try { noise.stop(); } catch (e) {} noise.disconnect(); noise = null; }
  function setLive(on) {
    if (!bus || bus.live === on) return;
    bus.live = on;
    if (on) bus.out.connect(bus.input); else bus.out.disconnect();
  }
  setInterval(() => { if (!bus) return; if (sounding()) lastSound = performance.now(); else if (performance.now() - lastSound > 9000) { setLive(false); stopNoise(); } }, 1000);
  function wake() { start(); setLive(true); lastSound = performance.now(); }
  function applyGlass(g) {                              // частоты мод, добротность по звону, нормировка: узкая полоса шума — громче
    if (!g.au || !actx) return;
    const t = actx.currentTime, f = freqOf(g), sr = actx.sampleRate, tau = t60(g) / 6.9, Q = Math.PI * f * tau;
    g.au.modes.forEach((m, i) => {
      const fm = f * MR[i], bw = fm / Q, norm = 0.4 / Math.sqrt((1.5708 * bw) / (sr / 2)), cr = i ? (0.25 + 1.75 * fx.crystal) : 1;
      m.f.frequency.setTargetAtTime(Math.min(fm, sr * 0.45), t, 0.02); m.f.Q.setTargetAtTime(Q, t, 0.02);
      m.m.gain.setTargetAtTime(fm < sr * 0.45 ? MG[i] * cr * norm : 0, t, 0.05);
    });
    const ft = f * (1 + 0.005 * fx.tremor), bwt = ft / Q;
    g.au.tr.frequency.setTargetAtTime(ft, t, 0.02); g.au.tr.Q.setTargetAtTime(Q, t, 0.02);
    g.au.trg.gain.setTargetAtTime(0.8 * fx.tremor * 0.4 / Math.sqrt((1.5708 * bwt) / (sr / 2)), t, 0.05);
    g.au.sum.gain.setTargetAtTime(g.lvl * 0.5, t, 0.05);
    g.au.pan.pan.setTargetAtTime(((g.k - 2.5) / 2.5) * fx.spread * 0.8, t, 0.05);
  }
  function applyAll() {
    if (!bus) return;
    const t = actx.currentTime;
    bus.hallSend.gain.setTargetAtTime(fx.hall * fx.hall * 1.5, t, 0.05);
    for (const l of bus.hall.lines) l.g.gain.setTargetAtTime(10 ** ((-3 * l.len) / (1.5 + fx.hall * 5)), t, 0.05);
    for (const g of glasses) applyGlass(g);
  }
  function excite(g, v) {                               // трение: громкость шума, плавно
    g.exc = v;
    if (g.au && actx) g.au.exc.gain.setTargetAtTime(v, actx.currentTime, 0.06);
  }
  function ping(g, a = 1) {                             // звон: короткий всплеск шума в резонаторы
    wake();
    if (!g.au) return;
    const t = actx.currentTime, e = g.au.exc.gain;
    e.cancelScheduledValues(t); e.setValueAtTime(g.exc, t); e.linearRampToValueAtTime(4 * a, t + 0.002); e.linearRampToValueAtTime(g.exc, t + 0.006);
    g.en = Math.max(g.en, 0.8 * a);
  }

  // ---------- касания ----------
  const touches = new Map();
  let lastTap = { k: -1, t: 0 };
  function glassAt(G, x, y) {                           // {g, zone: 'rim' | 'body'}
    for (const g of glasses) {
      const p = G.gl[g.k];
      if (Math.abs(x - p.x) > G.bw / 2 + 8) continue;
      if (Math.abs(y - G.rimY) < 20) return { g, zone: 'rim' };
      if (y > G.rimY && y < G.rimY + G.bh + 24) return { g, zone: 'body' };
    }
    return null;
  }
  function down(f) {
    const G = geo(), now = performance.now(), hit = glassAt(G, f.x, f.y);
    if (!hit) { touches.set(f.id, { kind: 'none' }); return; }
    wake();
    touches.set(f.id, { kind: hit.zone, g: hit.g, x0: f.x, y0: f.y, x: f.x, y: f.y, t: now, t0: now, moved: false, dist: 0 });
  }
  function move(f) {
    const t = touches.get(f.id);
    if (!t || t.kind === 'none' || t.sheet) return;
    const now = performance.now(), d = Math.hypot(f.x - t.x, f.y - t.y), dt = Math.max(8, now - t.t);
    t.dist += d; t.x = f.x; t.y = f.y; t.t = now;
    if (t.dist > 8) t.moved = true;
    if (t.kind === 'rim') { const v = (d / dt) * 1000; t.g.sp = Math.max(t.g.sp * 0.6, clamp(v / 700) ** 0.7); if (!t.g.pin) excite(t.g, 0.15 + 0.85 * t.g.sp); }   // быстрее ведёшь — громче
    else if (t.kind === 'body' && t.moved) {
      const G = geo(), w = clamp((G.rimY + G.bh - f.y) / G.bh, 0, WMAX);
      if (Math.abs(w - t.g.w) > 0.003) { t.g.w = w; applyGlass(t.g); }
    }
  }
  function up(f) {
    const t = touches.get(f.id);
    touches.delete(f.id);
    if (!t || t.kind === 'none' || t.sheet) return;
    const now = performance.now(), quick = !t.moved && now - t.t0 < 300;
    if (t.kind === 'rim') {
      if (!t.g.pin) excite(t.g, 0);
      if (quick) {
        if (lastTap.k === t.g.k && now - lastTap.t < T.DTAP_MS + 150) { togglePin(t.g); lastTap = { k: -1, t: 0 }; return; }   // двойной тап — палец остаётся
        lastTap = { k: t.g.k, t: now }; ping(t.g, 0.7);
      }
    } else if (quick) ping(t.g, 0.7);
  }
  function togglePin(g) { g.pin = !g.pin; wake(); excite(g, g.pin ? 0.55 : 0); }
  function tick(now, dt) {
    const d = Math.min(0.1, dt || 0.016);                  // dt хоста — в секундах
    for (const g of glasses) {
      g.sp *= Math.exp(-d / 0.08);                      // палец встал — трение гаснет
      const held = [...touches.values()].some((t) => t.kind === 'rim' && t.g === g);
      if (!g.pin && held && g.exc > 0.01) excite(g, 0.1 + 0.9 * g.sp);
      if (g.pin) { const v = 0.5 + 0.08 * Math.sin(now * 0.0009 + g.ph); if (Math.abs(v - g.exc) > 0.02) excite(g, v); }   // палец-призрак
      const target = g.exc > 0.02 ? 0.25 + 0.75 * g.exc : 0;
      g.en = target > g.en ? g.en + (target - g.en) * Math.min(1, d / 0.25) : g.en * Math.exp(-d / (t60(g) / 6.9));
    }
    for (const t of touches.values()) if ((t.kind === 'body' || t.kind === 'rim') && !t.moved && !t.sheet && now - t.t0 > T.HOLD_MS) { t.sheet = true; if (!t.g.pin) excite(t.g, 0); glassSheet(t.g); }
  }
  function glassSheet(g) {
    T.openSheet({
      title: `poculum ${['I', 'II', 'III', 'IV', 'V', 'VI'][g.k]}`, hint: 'glass — tap outside to close',
      rows: [{ key: 'w', label: 'water' }, { key: 'dec', label: 'decay' }, { key: 'lvl', label: 'level' }],
      lfo: { id: `vitrea-g${g.k}`, keys: ['w', 'lvl'], shapes: 'random' },
      get: (k) => (k === 'w' ? g.w / WMAX : g[k]),
      set: (k, v) => { if (k === 'w') g.w = v * WMAX; else g[k] = v; applyGlass(g); },
      text: (k) => (k === 'w' ? `${noteName(semiOf(g))} · ${Math.round(freqOf(g))} Hz` : k === 'dec' ? `${t60(g).toFixed(1)} s` : `${Math.round(g.lvl * 100)}%`),
    });
  }
  const sounding = () => glasses.some((g) => g.pin || g.en > 0.01 || g.exc > 0.01);

  // ---------- рисование ----------
  const ink = (a) => `rgba(${INK},${a})`;
  let wallC = null, wallKey = '';
  function wall(G) {                                    // ночь: стол, его кромка штриховкой, звёзды
    const key = `${G.W}x${G.H}x${T.DPR}|${G.tableY}`;
    if (wallC && key === wallKey) return wallC;
    wallKey = key;
    wallC = document.createElement('canvas'); wallC.width = Math.round(G.W * T.DPR); wallC.height = Math.round(G.H * T.DPR);
    const x = wallC.getContext('2d'); x.setTransform(T.DPR, 0, 0, T.DPR, 0, 0);
    x.fillStyle = BGC; x.fillRect(0, 0, G.W, G.H);
    let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    x.fillStyle = ink(0.5); for (let k = 0; k < 70; k++) { x.globalAlpha = 0.2 + 0.5 * rnd(); x.fillRect(rnd() * G.W, G.top + rnd() * (G.rimY - G.top - 20), 1, 1); } x.globalAlpha = 1;
    x.lineWidth = 1; x.strokeStyle = ink(0.7); x.beginPath(); x.moveTo(0, G.tableY + 0.5); x.lineTo(G.W, G.tableY + 0.5); x.stroke();
    x.strokeStyle = ink(0.09); x.beginPath(); for (let y = G.tableY + 6; y < G.H; y += 5) { x.moveTo(0, y); x.lineTo(G.W, y); } x.stroke();
    return wallC;
  }
  function drawGlass(c, G, g, now, held) {
    const p = G.gl[g.k], x = p.x, rx = G.bw / 2, ry = G.bh, rim = G.rimY, e = clamp(g.en);
    if (e > 0.05) T.glowAt(x, rim, rx * 1.4, 0.22 * e);
    const wy = waterY(G, g), hw = halfW(G, wy);         // вода: заливка под поверхностью, рябь — стоячие волны, пока поёт
    c.save(); c.beginPath(); c.ellipse(x, rim, rx - 1, ry - 1, 0, 0, Math.PI); c.clip();
    c.fillStyle = rgba(WATER, 0.16 + 0.1 * e); c.fillRect(x - rx, wy, rx * 2, ry + 2);
    c.restore();
    if (g.w > 0.01) {
      c.strokeStyle = rgba(WATER, 0.55 + 0.4 * e); c.lineWidth = 1; c.beginPath();
      for (let i = 0; i <= 30; i++) { const u = i / 30, px = x - hw + u * 2 * hw, yy = wy + Math.sin(u * Math.PI * 4 + now * 0.03) * 2.2 * e * Math.sin(u * Math.PI); i ? c.lineTo(px, yy) : c.moveTo(px, yy); }
      c.stroke();
    }
    c.lineWidth = 1; c.strokeStyle = ink(0.8); c.beginPath(); c.ellipse(x, rim, rx, ry, 0, 0, Math.PI); c.stroke();   // чаша
    c.strokeStyle = e > 0.05 ? rgba(MOON, 0.5 + 0.5 * e) : ink(0.85); c.lineWidth = 1 + 1.2 * e;                   // обод светится громкостью
    c.beginPath(); c.ellipse(x, rim, rx, 3.5, 0, 0, TAU); c.stroke(); c.lineWidth = 1;
    c.strokeStyle = ink(0.7); c.beginPath(); c.moveTo(x, rim + ry); c.lineTo(x, G.tableY - 4); c.stroke();          // ножка и подставка
    c.beginPath(); c.ellipse(x, G.tableY - 2, rx * 0.55, 2.5, 0, 0, TAU); c.stroke();
    c.strokeStyle = ink(0.25); c.beginPath(); c.arc(x - rx * 0.45, rim + ry * 0.4, ry * 0.35, Math.PI * 0.75, Math.PI * 1.05); c.stroke();   // блик
    if (g.pin) { const a = now * 0.004 + g.ph; c.fillStyle = rgba(MOON, 0.95); c.beginPath(); c.arc(x + Math.cos(a) * rx, rim + Math.sin(a) * 3.5, 2.6, 0, TAU); c.fill(); }   // палец-призрак
    if (held) T.mapText(`${noteName(semiOf(g))} · ${Math.round(freqOf(g))} Hz`, x, rim - 22, 12, 0.9, 'center');
  }
  function drawMoon(c, G) {                             // луна-серп и её дорожка на столе; тап — карта
    const m = G.moon;
    T.glowAt(m.x, m.y, 40, 0.15);
    c.fillStyle = rgba(MOON, 0.9); c.beginPath(); c.arc(m.x, m.y, 16, 0, TAU); c.fill();
    c.fillStyle = BGC; c.beginPath(); c.arc(m.x + 7, m.y - 4, 14, 0, TAU); c.fill();
    c.strokeStyle = rgba(MOON, 0.25); c.beginPath(); for (let k = 0; k < 4; k++) { const y = G.tableY + 10 + k * 7, w = 30 - k * 6; c.moveTo(m.x - w / 2, y); c.lineTo(m.x + w / 2, y); } c.stroke();
  }
  function draw(now) {
    const c = T.g, G = geo();
    c.drawImage(wall(G), 0, 0, T.W, T.H);
    drawMoon(c, G);
    const held = new Set([...touches.values()].filter((t) => t.kind === 'body' && t.moved).map((t) => t.g));
    for (const g of glasses) drawGlass(c, G, g, now, held.has(g));
  }

  // ---------- мир ----------
  const deg = (d) => (d * Math.PI) / 180;
  const fxw = {
    sectors: [{ key: 'crystal', label: 'crystal', ang: deg(170) }, { key: 'tremor', label: 'tremor', ang: deg(140) }, { key: 'spread', label: 'spread', ang: deg(110) }, { key: 'hall', label: 'hall', ang: deg(80) }],
    get: (k) => fx[k], set: (k, v) => { fx[k] = v; applyAll(); }, text: (k) => `${Math.round(fx[k] * 100)}%`,
    lfo: { keys: ['crystal', 'tremor', 'spread', 'hall'], shapes: 'random' },
    arc: () => fx.hall, save: () => ({ ...fx }), load: (o) => { Object.assign(fx, o); applyAll(); },
  };
  function dice() {                                     // вода вразброс, один-два бокала поют сами, ещё один звенит
    const R = Math.random;
    for (const g of glasses) { g.w = R() * WMAX; g.pin = false; excite(g, 0); g.dec = 0.4 + R() * 0.5; applyGlass(g); }
    const a = Math.floor(R() * NG), b = (a + 2 + Math.floor(R() * 3)) % NG;
    togglePin(glasses[a]); if (R() < 0.7) togglePin(glasses[b]);
    ping(glasses[(b + 1) % NG], 0.8);
  }
  const vitrea = {
    n: 'XVIII', title: 'Vitrea', sub: 'harmonica · frictio', theme: { ink: INK, bg: BGC, paper: PAPER },
    corner: { hit: (f) => { const m = geo().moon; return Math.hypot(f.x - m.x, f.y - m.y) < m.r; }, draw: () => {} },   // луна — карта
    fx: fxw,
    legend: [['drag', 'rub a rim', 'the glass sings — faster, louder'], ['tap', 'double-tap a rim', 'the finger stays: it sings by itself · again — let go'],
      ['tap', 'tap a glass', 'it rings'], ['up', 'drag inside a glass', 'water: more — lower'], ['hold', 'hold a glass', 'its sheet: water, decay, level'], ['tap', 'tap the moon', 'map of worlds']],
    build, tick, draw, down, move, up, dice, enter: () => {},
    clear() { for (const g of glasses) { g.pin = false; excite(g, 0); } },
    snapshot: () => JSON.stringify({ g: glasses.map(({ w, dec, lvl, pin }) => ({ w, dec, lvl, pin })), fx }),
    restore(js) {
      const s = JSON.parse(js);
      s.g.forEach((q, k) => { const g = glasses[k]; Object.assign(g, { w: q.w, dec: q.dec, lvl: q.lvl, pin: false }); excite(g, 0); if (q.pin) togglePin(g); });
      Object.assign(fx, s.fx); applyAll();
    },
    sounding,
  };
  T.registerWorld(18, vitrea);
  window.t2d.vitrea = { glasses, fx, geo, freq: freqOf, setFx: (k, v) => fxw.set(k, v), ping: (k) => ping(glasses[k]), pin: (k) => togglePin(glasses[k]), get noise() { return !!noise; } };
})();
