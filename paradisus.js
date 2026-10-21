// Paradisus — мир VI, рай Данте над Cymatica: девять небесных сфер вокруг Небесной розы. Звук — хор гласных (vowel synth)
// в натуральном ряду, дрон без секвенсера. Сфера n — n-я гармоника тоники лада (без лада — от A2): Luna снаружи — основной тон,
// Primum Mobile у самого света — девятая. Тронул сферу — там ангел и поёт, пока держишь; вдоль сферы — гласная (a сверху, дальше
// по часовой e, i, o, u); поперёк — на другую сферу (прилипает к ближайшей). Двойной тап — ангел остаётся и поёт сам (до 4); держишь
// закреплённого — его плашка: хор (1–5 певчих), расстройка, вибрато, дыхание, регистр. Роза в центре — Gloria: облако зёрен хора,
// тап по ней — россыпь. FX: shimmer (октава вверх в зале), gloria, aether (зал), vibrato, ascensio (бесконечный подъём — Шепард).
// В правом нижнем углу (к центру карты) — божественный свет: тап — карта. Спека: docs/superpowers/specs/2026-10-20-paradisus-design.md
(() => {
  'use strict';
  const T = window.T2D;
  const TAU = Math.PI * 2;
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const INK = '94,69,32', BGC = '#f5efe1', PAPER = '245,239,225', GOLD = [176, 131, 44], LIGHT = [201, 154, 60];
  const NAMES = ['Primum Mobile', 'Stellae', 'Saturnus', 'Iuppiter', 'Mars', 'Sol', 'Venus', 'Mercurius', 'Luna'];   // изнутри наружу; гармоника n = 9 − k
  const VOW = ['a', 'e', 'i', 'o', 'u'];
  // форманты сопрано (F1–F4: частота, громкость в дБ, ширина) — хор как в соборе
  const FORM = {
    a: [[800, 0, 80], [1150, -6, 90], [2900, -32, 120], [3900, -20, 130]],
    e: [[350, 0, 60], [2000, -20, 100], [2800, -15, 120], [3600, -40, 150]],
    i: [[270, 0, 60], [2140, -12, 90], [2950, -26, 100], [3900, -26, 120]],
    o: [[450, 0, 70], [800, -11, 80], [2830, -22, 100], [3800, -22, 130]],
    u: [[325, 0, 50], [700, -16, 60], [2700, -35, 170], [3800, -40, 180]],
  };
  const HALO = { a: [6.5, 2.2], e: [5, 2.6], i: [2.4, 4.2], o: [3.6, 3.6], u: [2.2, 2.2] };   // нимб — форма гласной
  const PIN_MAX = 4;
  const NOTES = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];

  // ---------- состояние ----------
  const fx = { shimmer: 0.35, gloria: 0.2, aether: 0.5, vibrato: 0.4, ascensio: 0 };
  const angels = [];                                      // { k, v (0..5, по кругу), pinned, singers, detune, vib, breath, reg, n: узлы, lvl }
  let glitter = [];                                       // вспышки зёрен на розе: { t, a, r }
  const tonic = () => 110 * 2 ** ((T.scaleOn ? T.scaleRoot : 0) / 12);   // тоника лада во второй октаве (A2 = 110)
  const harm = (k) => 9 - k;
  const hzOf = (a) => tonic() * harm(a.k) * [0.5, 1, 2][a.reg];
  const vowelAt = (v) => { const i = Math.floor(v) % 5, j = (i + 1) % 5, t = v - Math.floor(v); return { i, j, t }; };
  const vowelName = (v) => VOW[Math.round(v) % 5];
  function formants(v) {                                  // между гласными — плавно: частоты по логарифму, громкость линейно
    const { i, j, t } = vowelAt(v), A = FORM[VOW[i]], B = FORM[VOW[j]];
    return A.map((p, q) => [p[0] * (B[q][0] / p[0]) ** t, p[1] + (B[q][1] - p[1]) * t, p[2] + (B[q][2] - p[2]) * t]);
  }

  // ---------- геометрия: девять эллипсов-сфер вокруг розы, выше по экрану — шире ----------
  function geo() {
    const W = T.W, H = T.H, top = T.topY + 6, bot = H - T.safeBot - 8, h = bot - top, cx = W / 2, cy = top + h * 0.48;
    const RX = W / 2 - 14, RY = Math.min(cy - top - 10, bot - cy - 10), rx0 = W * 0.13, ry0 = rx0 * 1.6;
    const sph = NAMES.map((_, k) => ({ rx: rx0 + ((RX - rx0) * k) / 8, ry: ry0 + ((RY - ry0) * k) / 8 }));
    return { W, H, top, bot, cx, cy, sph, rose: rx0 * 0.72, light: { x: W, y: H - T.safeBot, r: Math.min(100, W * 0.26) } };
  }
  const angleAt = (G, k, x, y) => { const s = G.sph[k]; return (Math.atan2((x - G.cx) / s.rx, -(y - G.cy) / s.ry) + TAU) % TAU; };
  const vOf = (ang) => (ang / TAU) * 5;
  function sphereAt(G, x, y) {                            // ближайшая сфера (по расстоянию до эллипса вдоль луча из центра)
    const dx = x - G.cx, dy = y - G.cy, r = Math.hypot(dx, dy);
    let best = -1, bd = 1e9;
    G.sph.forEach((s, k) => { const rho = Math.hypot(dx / s.rx, dy / s.ry), d = Math.abs(r - r / Math.max(rho, 1e-6)); if (d < bd) { bd = d; best = k; } });
    return bd < 30 ? best : -1;
  }
  function anglePos(G, k, v) { const s = G.sph[k], a = (v / 5) * TAU; return { x: G.cx + Math.sin(a) * s.rx, y: G.cy - Math.cos(a) * s.ry }; }

  // ---------- звук ----------
  let actx = null, bus = null, lastSound = 0, ascPh = 0, grainAcc = 0, noiseBuf = null;
  // собор: свёртка с длинным отзвуком, который считается здесь же (шум со спадом, чем дальше — тем темнее; каналы — разный шум).
  // Свёртку браузер считает сам, быстро; отзвук пересчитывается только при смене aether
  function cathedralIR(ctx, t60) {
    const sr = ctx.sampleRate, len = Math.round(sr * (t60 + 0.3)), buf = ctx.createBuffer(2, len, sr), pre = Math.round(sr * 0.022), fade = sr * 0.03;
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let y = 0, e = 0;
      for (let i = pre; i < len; i++) {
        const t = (i - pre) / sr, fc = 9000 * Math.pow(1200 / 9000, Math.min(1, t / t60)), a = Math.exp((-2 * Math.PI * fc) / sr);
        y = (1 - a) * (Math.random() * 2 - 1) + a * y;
        const v = y * Math.exp((-6.9 * t) / t60) * Math.min(1, (i - pre) / fade);
        d[i] = v; e += v * v;
      }
      const k = 1 / Math.sqrt(e || 1);                    // энергия отзвука — единица: шум проходит с прежней громкостью
      for (let i = 0; i < len; i++) d[i] *= k;
    }
    return buf;
  }
  // сдвиг на октаву вверх: две линии задержки, время бежит вниз пилой (окно 60 мс), окна вполнакладку — косинус², сумма — единица
  function octaver(ctx, inp, out) {
    const w = 0.06, t0 = ctx.currentTime + 0.05, win = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = (i / 255) * 2 - 1; win[i] = Math.cos((Math.PI * x) / 2) ** 2; }
    const n = Math.round(w * ctx.sampleRate), ramp = ctx.createBuffer(1, n, ctx.sampleRate), rd = ramp.getChannelData(0);
    for (let i = 0; i < n; i++) rd[i] = (i / n) * 2 - 1;   // точная пила из буфера: у осциллятора-пилы склон не ровный (Гиббс) — октава уезжала на 1.84
    return [0, w / 2].map((off) => {
      const saw = ctx.createBufferSource(), dt = ctx.createGain(), dl = ctx.createDelay(0.2), sh = ctx.createWaveShaper(), tg = ctx.createGain();
      saw.buffer = ramp; saw.loop = true;
      dl.delayTime.value = w / 2; dt.gain.value = -w / 2; tg.gain.value = 0; sh.curve = win;
      saw.connect(dt).connect(dl.delayTime); saw.connect(sh).connect(tg.gain);
      inp.connect(dl).connect(tg).connect(out);
      saw.start(t0, off);
      return { saw, dl, tg };
    });
  }
  let irAt = 0, irT60 = 0, irTimer = 0;
  function setIR(now = false) {                           // aether — длина отзвука; пересчёт не чаще раза в 250 мс
    if (!bus) return;
    const t60 = 2.5 + fx.aether * 7;
    if (Math.abs(t60 - irT60) < 0.3 && bus.conv.buffer) return;
    clearTimeout(irTimer);
    const go = () => { irT60 = t60; irAt = performance.now(); bus.conv.buffer = cathedralIR(actx, t60); };
    if (now || performance.now() - irAt > 250) go(); else irTimer = setTimeout(go, 250);
  }
  function build(ctx, input) {
    actx = ctx;
    const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const inp = g(1), out = g(2.2), send = g(0), revIn = g(1), conv = ctx.createConvolver(), wet = g(1), fb = g(0), hp = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter(), oct = g(1);
    conv.normalize = false; hp.type = 'highpass'; hp.frequency.value = 160; lp.type = 'lowpass'; lp.frequency.value = 7000;
    inp.connect(out); inp.connect(send).connect(hp).connect(revIn).connect(conv).connect(wet).connect(out);
    conv.connect(lp); octaver(ctx, lp, oct); oct.connect(fb).connect(revIn);   // шиммер: хвост собора на октаву вверх — снова в собор
    const n = ctx.sampleRate * 2; noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    bus = { inp, out, send, conv, wet, fb, input, live: false, asc: null };
    irT60 = 0; setIR(true);
    for (const a of angels) { a.n = null; if (a.pinned) voiceOn(a); }
    applyFx();
  }
  function setLive(on) {
    if (!bus || bus.live === on) return;
    bus.live = on;
    if (on) bus.out.connect(bus.input); else bus.out.disconnect();
  }
  setInterval(() => {
    if (!bus) return;
    if (angels.length || fx.ascensio > 0.01) lastSound = performance.now();
    else if (performance.now() - lastSound > 9000) setLive(false);
  }, 1000);
  const vibCents = (a) => 30 * fx.vibrato * (0.3 + a.vib * 1.4);
  function voiceOn(a) {                                   // ангел: певчие — пилы с расстройкой и вибрато → четыре форманты гласной → громкость
    if (!bus || a.n) return;
    setLive(true); lastSound = performance.now();
    const ctx = actx, t = ctx.currentTime, g = (v) => { const x = ctx.createGain(); x.gain.value = v; return x; };
    const f = hzOf(a), N = a.singers, src = g(1 / Math.sqrt(N)), vca = g(0), vib = ctx.createOscillator(), vg = g(vibCents(a));
    vib.frequency.value = 5 + Math.random() * 1.2; vib.connect(vg);
    const oscs = Array.from({ length: N }, (_, i) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      o.detune.value = N > 1 ? (i / (N - 1) - 0.5) * 2 * (4 + a.detune * 22) : 0;
      vg.connect(o.detune); o.connect(src); o.start(t); return o;
    });
    const ns = ctx.createBufferSource(), ng = g(a.breath * 0.25); ns.buffer = noiseBuf; ns.loop = true; ns.connect(ng); ns.start(t, Math.random() * 1.5);
    const fs = formants(a.v).map(([fr, db, bw]) => {
      const bp = ctx.createBiquadFilter(), fg = g(10 ** (db / 20) * 2.2); bp.type = 'bandpass'; bp.frequency.value = fr; bp.Q.value = fr / bw;
      src.connect(bp); ng.connect(bp); bp.connect(fg).connect(vca); return { bp, fg };
    });
    const sh = [];
    vib.start(t);
    vca.connect(bus.inp);
    vca.gain.setTargetAtTime(0.5, t, 0.25);              // хор вступает мягко
    a.n = { oscs, src, vca, vib, vg, ns, ng, fs, sh };
  }
  function voiceOff(a, tau = 0.5) {
    const n = a.n;
    if (!n) return;
    a.n = null;
    const t = actx.currentTime, end = t + tau * 6;
    n.vca.gain.setTargetAtTime(0, t, tau);
    for (const o of [...n.oscs, n.vib, n.ns, ...n.sh.map((s) => s.o)]) o.stop(end);
    n.vib.onended = () => { for (const x of [...n.oscs, n.src, n.vca, n.vib, n.vg, n.ns, n.ng, ...n.fs.map((q) => q.bp), ...n.fs.map((q) => q.fg), ...n.sh.flatMap((s) => [s.o, s.og])]) x.disconnect(); };
  }
  function retune(a) {                                    // высота (сфера, регистр) и гласная — плавно
    const n = a.n;
    if (!n) return;
    const t = actx.currentTime, f = hzOf(a);
    for (const o of n.oscs) o.frequency.setTargetAtTime(f, t, 0.04);
    for (const s of n.sh) s.o.frequency.setTargetAtTime(f * s.m, t, 0.04);
    formants(a.v).forEach(([fr, db, bw], q) => {
      n.fs[q].bp.frequency.setTargetAtTime(fr, t, 0.05); n.fs[q].bp.Q.setTargetAtTime(fr / bw, t, 0.05); n.fs[q].fg.gain.setTargetAtTime(10 ** (db / 20) * 2.2, t, 0.05);
    });
    n.vg.gain.setTargetAtTime(vibCents(a), t, 0.1);
    n.ng.gain.setTargetAtTime(a.breath * 0.25, t, 0.1);
    N_detune(a);
  }
  function N_detune(a) { const n = a.n, N = n.oscs.length; n.oscs.forEach((o, i) => { o.detune.value = N > 1 ? (i / (N - 1) - 0.5) * 2 * (4 + a.detune * 22) : 0; }); }
  function applyFx() {
    if (!bus) return;
    const t = actx.currentTime;
    bus.send.gain.setTargetAtTime(0.35 + fx.aether * 0.5, t, 0.05);
    bus.wet.gain.setTargetAtTime(0.9 + fx.aether * 0.5, t, 0.05);
    bus.fb.gain.setTargetAtTime(fx.shimmer * 0.62, t, 0.08);   // доля хвоста, ушедшего на октаву вверх обратно в собор
    setIR();
    for (const a of angels) retune(a);
    ascOn(fx.ascensio > 0.01);
  }
  // Gloria — облако зёрен хора: короткие окна синуса на гармониках поющих ангелов, по стерео вразброс, в зал
  function grain(fBase) {
    if (!bus) return;
    const ctx = actx, t = ctx.currentTime + 0.01, dur = 0.06 + Math.random() * 0.14, o = ctx.createOscillator(), gg = ctx.createGain(), p = ctx.createStereoPanner();
    o.frequency.value = fBase * [1, 2, 3, 4][Math.floor(Math.random() * 4)] * (Math.random() < 0.3 ? 2 : 1);
    p.pan.value = Math.random() * 1.6 - 0.8;
    gg.gain.setValueAtTime(0, t); gg.gain.linearRampToValueAtTime(0.06, t + dur * 0.4); gg.gain.exponentialRampToValueAtTime(0.0005, t + dur); gg.gain.linearRampToValueAtTime(0, t + dur + 0.01);
    o.connect(gg).connect(p).connect(bus.inp); o.start(t); o.stop(t + dur + 0.02);
    o.onended = () => { o.disconnect(); gg.disconnect(); p.disconnect(); };
    glitter.push({ t: performance.now(), a: Math.random() * TAU, r: Math.random() });
    setLive(true); lastSound = performance.now();
  }
  function ascOn(on) {                                    // бесконечный подъём: семь синусов через октаву скользят вверх, громкость — колоколом
    if (!bus) return;
    if (on && !bus.asc) {
      bus.asc = Array.from({ length: 7 }, () => { const o = actx.createOscillator(), gg = actx.createGain(); gg.gain.value = 0; o.connect(gg); gg.connect(bus.inp); o.start(); return { o, gg }; });
      setLive(true);
    } else if (!on && bus.asc) {
      const s = bus.asc; bus.asc = null;
      for (const { o, gg } of s) { gg.gain.setTargetAtTime(0, actx.currentTime, 0.1); o.stop(actx.currentTime + 0.6); o.onended = () => { o.disconnect(); gg.disconnect(); }; }
    }
  }
  function tick(now, dt) {
    if (bus && bus.asc) {
      ascPh = (ascPh + dt * (0.03 + fx.ascensio * 0.2)) % 7;
      const t = actx.currentTime;
      bus.asc.forEach(({ o, gg }, i) => { const oc = (i + ascPh) % 7, a = Math.sin((Math.PI * oc) / 7) ** 2; o.frequency.setTargetAtTime(55 * 2 ** oc, t, 0.03); gg.gain.setTargetAtTime(a * fx.ascensio * 0.035, t, 0.05); });
    }
    const singing = angels.filter((a) => a.n);
    if (fx.gloria > 0.01 && singing.length) {
      grainAcc += dt * fx.gloria * 24;
      while (grainAcc >= 1) { grainAcc -= 1; grain(hzOf(singing[Math.floor(Math.random() * singing.length)])); }
    } else grainAcc = 0;
    for (const a of angels) a.lvl += ((a.n ? 1 : 0) - a.lvl) * (1 - Math.exp(-dt / 0.3));
    if (glitter.length) glitter = glitter.filter((q) => now - q.t < 900);
  }

  // ---------- касания ----------
  const touches = new Map();
  let lastTap = null;
  const pinned = () => angels.filter((a) => a.pinned);
  function angelNear(G, x, y) {
    let best = null, bd = 26;
    for (const a of angels) if (a.pinned) { const p = anglePos(G, a.k, a.v), d = Math.hypot(x - p.x, y - p.y); if (d < bd) { bd = d; best = a; } }
    return best;
  }
  function newAngel(k, v) { return { k, v, pinned: false, singers: 3, detune: 0.4, vib: 0.5, breath: 0.25, reg: 1, n: null, lvl: 0 }; }
  function down(f) {
    const G = geo(), now = performance.now();
    if (Math.hypot(f.x - G.cx, f.y - G.cy) < G.rose) {    // роза — россыпь зёрен
      const singing = angels.filter((a) => a.n), base = singing.length ? hzOf(singing[0]) : tonic() * 2;
      for (let i = 0; i < 12; i++) setTimeout(() => grain(base), i * 35);
      touches.set(f.id, { kind: 'none' }); return;
    }
    const near = angelNear(G, f.x, f.y);
    if (near) {
      if (lastTap && lastTap.a === near && now - lastTap.t < T.DTAP_MS) {   // двойной тап по закреплённому — отпустить
        lastTap = null; near.pinned = false; voiceOff(near, 0.6); angels.splice(angels.indexOf(near), 1);
        touches.set(f.id, { kind: 'none' }); return;
      }
      lastTap = { a: near, t: now, x: f.x, y: f.y };
      touches.set(f.id, { kind: 'angel', a: near, t0: now, x: f.x, y: f.y, x0: f.x, y0: f.y });
      return;
    }
    const k = sphereAt(G, f.x, f.y);
    if (k < 0) { touches.set(f.id, { kind: 'none' }); return; }
    const v = vOf(angleAt(G, k, f.x, f.y));
    if (lastTap && !lastTap.a && now - lastTap.t < T.DTAP_MS && Math.hypot(f.x - lastTap.x, f.y - lastTap.y) < 34 && pinned().length < PIN_MAX) {   // двойной тап — ангел остаётся
      lastTap = null;
      const a = newAngel(k, v); a.pinned = true; angels.push(a); voiceOn(a);
      touches.set(f.id, { kind: 'none' }); return;
    }
    lastTap = { a: null, t: now, x: f.x, y: f.y };
    const a = newAngel(k, v); angels.push(a); voiceOn(a);   // поёт, пока держишь
    touches.set(f.id, { kind: 'angel', a, temp: true, t0: now, x: f.x, y: f.y, x0: f.x, y0: f.y });
  }
  function move(f) {
    const t = touches.get(f.id);
    if (!t || t.kind !== 'angel' || t.sheet) return;
    t.x = f.x; t.y = f.y;
    if (Math.hypot(f.x - t.x0, f.y - t.y0) < 6 && !t.moved) return;
    t.moved = true;
    const G = geo(), k = sphereAt(G, f.x, f.y), a = t.a;
    if (k >= 0) a.k = k;                                  // поперёк — на ближайшую сферу (гармонику)
    a.v = vOf(angleAt(G, a.k, f.x, f.y));                 // вдоль — гласная
    retune(a);
  }
  function up(f) {
    const t = touches.get(f.id);
    touches.delete(f.id);
    if (!t || t.kind !== 'angel') return;
    if (t.temp && !t.a.pinned) { voiceOff(t.a, 0.5); const i = angels.indexOf(t.a); if (i >= 0) angels.splice(i, 1); }
  }
  // держишь закреплённого ангела, не двигая, — его плашка: хор, расстройка, вибрато, дыхание, регистр
  function angelSheet(a) {
    T.openSheet({
      title: `${NAMES[a.k]} · ${harm(a.k)}`, hint: 'angel — tap outside to close',
      rows: [{ key: 'singers', label: 'choir' }, { key: 'detune', label: 'detune' }, { key: 'vib', label: 'vibrato' }, { key: 'breath', label: 'breath' }, { key: 'reg', label: 'register' }],
      get: (k) => (k === 'singers' ? (a.singers - 0.5) / 5 : k === 'reg' ? (a.reg + 0.5) / 3 : a[k]),
      set: (k, v) => {
        if (k === 'singers') { const n = Math.min(5, Math.max(1, Math.ceil(v * 5))); if (n !== a.singers) { a.singers = n; if (a.n) { voiceOff(a, 0.15); voiceOn(a); } } return; }
        if (k === 'reg') a.reg = Math.min(2, Math.floor(v * 3)); else a[k] = v;
        retune(a);
      },
      text: (k) => (k === 'singers' ? `${a.singers} ${a.singers === 1 ? 'voice' : 'voices'}` : k === 'reg' ? ['octave down', 'natural', 'octave up'][a.reg] : `${Math.round(a[k] * 100)}%`),
    });
  }

  // ---------- рисование ----------
  let wallC = null, wallKey = '';
  function wall(G) {                                      // фон: слоновая кость, лучи от розы, сферы с точками-звёздами, божественный свет в углу
    const key = `${G.W}x${G.H}x${T.DPR}|${G.cy}`;
    if (wallC && key === wallKey) return wallC;
    wallKey = key;
    wallC = document.createElement('canvas');
    wallC.width = Math.round(G.W * T.DPR); wallC.height = Math.round(G.H * T.DPR);
    const x = wallC.getContext('2d');
    x.setTransform(T.DPR, 0, 0, T.DPR, 0, 0);
    x.fillStyle = BGC; x.fillRect(0, 0, G.W, G.H);
    const ink = (a) => `rgba(${INK},${a})`, L = G.light;
    x.strokeStyle = rgba(LIGHT, 0.14); x.lineWidth = 1; x.beginPath();
    for (let j = 0; j < 36; j++) { const a = (j / 36) * TAU; x.moveTo(G.cx + Math.cos(a) * 40, G.cy + Math.sin(a) * 64); x.lineTo(G.cx + Math.cos(a) * 430, G.cy + Math.sin(a) * 690); }
    x.stroke();
    G.sph.forEach((s, k) => {
      x.strokeStyle = ink(0.62 - 0.03 * k); x.beginPath(); x.ellipse(G.cx, G.cy, s.rx, s.ry, 0, 0, TAU); x.stroke();
      x.fillStyle = ink(0.35); const n = 10 + k * 2;
      for (let j = 0; j < n; j++) { const a = (j / n) * TAU + k * 0.3; x.beginPath(); x.arc(G.cx + Math.cos(a) * s.rx, G.cy + Math.sin(a) * s.ry, 0.9, 0, TAU); x.fill(); }
    });
    for (let t = 0; t < 4; t++) {                          // Небесная роза: ярусы лепестков
      const [r, n, op] = [[1, 16, 0.5], [0.76, 12, 0.65], [0.53, 9, 0.8], [0.3, 6, 0.9]][t], R = G.rose * r;
      x.strokeStyle = ink(op);
      for (let j = 0; j < n; j++) {
        const a = (j / n) * TAU + t * 0.2, ri = R * 0.62, a1 = a - (Math.PI / n) * 0.95, a2 = a + (Math.PI / n) * 0.95;
        x.beginPath(); x.moveTo(G.cx + Math.cos(a1) * ri, G.cy + Math.sin(a1) * ri * 1.12);
        x.quadraticCurveTo(G.cx + Math.cos(a) * (R + 3), G.cy + Math.sin(a) * (R + 3) * 1.12, G.cx + Math.cos(a2) * ri, G.cy + Math.sin(a2) * ri * 1.12); x.stroke();
      }
    }
    x.strokeStyle = rgba(GOLD, 1); x.beginPath(); x.arc(G.cx, G.cy, 4.5, 0, TAU); x.stroke();
    x.fillStyle = rgba(GOLD, 1); x.beginPath(); x.arc(G.cx, G.cy, 1.6, 0, TAU); x.fill();
    x.strokeStyle = rgba(GOLD, 0.7); x.beginPath();         // божественный свет — четверть сияния из угла
    for (let j = 0; j < 14; j++) { const a = Math.PI + ((j + 0.5) / 14) * (Math.PI / 2), l = j % 2 ? L.r * 1.5 : L.r * 1.12; x.moveTo(L.x + Math.cos(a) * 30, L.y + Math.sin(a) * 30); x.lineTo(L.x + Math.cos(a) * l, L.y + Math.sin(a) * l); }
    x.stroke();
    for (const [r, op] of [[30, 0.9], [38, 0.45], [58, 0.25], [84, 0.14]]) { x.strokeStyle = rgba(GOLD, op); x.beginPath(); x.arc(L.x, L.y, r, Math.PI, Math.PI * 1.5); x.stroke(); }
    return wallC;
  }
  function halo(c, x, y, v, double, a) {
    const { i, j, t } = vowelAt(v), A = HALO[VOW[i]], B = HALO[VOW[j]], rx = A[0] + (B[0] - A[0]) * t, ry = A[1] + (B[1] - A[1]) * t;
    c.strokeStyle = rgba(GOLD, a); c.lineWidth = 1.2; c.beginPath(); c.ellipse(x, y - 10, rx, ry, 0, 0, TAU); c.stroke();
    if (double) { c.strokeStyle = rgba(GOLD, a * 0.5); c.lineWidth = 1; c.beginPath(); c.ellipse(x, y - 10, rx + 2.6, ry + 2.6, 0, 0, TAU); c.stroke(); }
  }
  function angel(c, x, y, sing, held) {                   // ангел штрихом: крылья, тело, голова; поёт — темнее
    const al = 0.45 + 0.55 * sing;
    if (held) { c.strokeStyle = rgba(LIGHT, 0.28); c.lineWidth = 6; c.beginPath(); c.ellipse(x, y - 3, 15, 17, 0, 0, TAU); c.stroke(); }
    c.strokeStyle = T.ink(al); c.lineWidth = 1.1; c.beginPath();
    for (const s of [-1, 1]) {
      c.moveTo(x, y - 5); c.bezierCurveTo(x + s * 6, y - 14, x + s * 15, y - 10, x + s * 16, y - 3); c.bezierCurveTo(x + s * 11, y - 6, x + s * 6, y - 3, x, y - 1);
      c.moveTo(x + s * 12, y - 5); c.lineTo(x + s * 9, y - 3.5);
    }
    c.moveTo(x - 2.2, y - 1); c.lineTo(x, y + 7); c.lineTo(x + 2.2, y - 1); c.stroke();
    T.dot(x, y - 6.5, 2, al);
  }
  function draw(now) {
    const c = T.g, G = geo();
    c.drawImage(wall(G), 0, 0, T.W, T.H);
    if (fx.shimmer > 0.05) {                              // shimmer — лучи от розы ярче
      c.strokeStyle = rgba(LIGHT, fx.shimmer * 0.25 * (0.8 + 0.2 * Math.sin(now * 0.002))); c.lineWidth = 1; c.beginPath();
      for (let j = 0; j < 18; j++) { const a = (j / 18) * TAU + now * 0.00005; c.moveTo(G.cx + Math.cos(a) * 44, G.cy + Math.sin(a) * 70); c.lineTo(G.cx + Math.cos(a) * 300, G.cy + Math.sin(a) * 480); }
      c.stroke();
    }
    if (fx.ascensio > 0.01) {                             // ascensio — крылышки плывут вверх
      c.strokeStyle = T.ink(0.18 + 0.2 * fx.ascensio); c.lineWidth = 1; c.beginPath();
      const span = G.bot - G.top, sp = 0.015 + fx.ascensio * 0.06;
      for (let i = 0; i < 7; i++) {
        const x = G.W * (0.12 + ((i * 0.37) % 0.76)), y = G.bot - ((now * sp + i * (span / 7)) % span);
        c.moveTo(x - 6, y); c.quadraticCurveTo(x - 3, y - 5, x, y - 1); c.quadraticCurveTo(x + 3, y - 5, x + 6, y);
      }
      c.stroke();
    }
    for (const q of glitter) {                            // зёрна Gloria вспыхивают на розе
      const k = 1 - (now - q.t) / 900, r = G.rose * (0.3 + q.r * 0.9);
      c.fillStyle = rgba(GOLD, 0.9 * k); c.beginPath(); c.arc(G.cx + Math.cos(q.a) * r, G.cy + Math.sin(q.a) * r * 1.12, 1.2 + k, 0, TAU); c.fill();
    }
    const held = new Set([...touches.values()].filter((t) => t.kind === 'angel').map((t) => t.a));
    for (const a of angels) {
      const p = anglePos(G, a.k, a.v), h = held.has(a);
      c.save(); c.translate(p.x, p.y); c.scale(1.35, 1.35);   // ангел крупнее штриха сфер — под палец и на глаз
      angel(c, 0, 0, a.lvl, h);
      halo(c, 0, 0, a.v, a.pinned, 0.5 + 0.5 * a.lvl);
      c.restore();
    }
    for (const a of held) {                               // подписи — только пока трогаешь
      const p = anglePos(G, a.k, a.v), right = p.x < G.cx, ax = p.x + (right ? 30 : -30), al = right ? 'left' : 'right';
      T.mapText(`${NAMES[a.k]} · ${harm(a.k)}`, ax, p.y - 6, 15, 0.95, al);
      const f = hzOf(a), m = Math.round(12 * Math.log2(f / 55));
      T.mapText(`${vowelName(a.v)} · ${NOTES[((m % 12) + 12) % 12]} · ${Math.round(f)} Hz`, ax, p.y + 11, 12, 0.75, al);
    }
    for (const t of touches.values()) if (t.kind === 'angel' && !t.temp && !t.sheet && !t.moved && now - t.t0 > T.HOLD_MS) { t.sheet = true; angelSheet(t.a); }   // держишь закреплённого — плашка
  }

  // ---------- мир ----------
  const deg = (d) => (d * Math.PI) / 180;
  const fxw = {
    sectors: [
      { key: 'shimmer', label: 'shimmer', ang: deg(200) },
      { key: 'gloria', label: 'gloria', ang: deg(170) },
      { key: 'aether', label: 'aether', ang: deg(140) },
      { key: 'vibrato', label: 'vibrato', ang: deg(110) },
      { key: 'ascensio', label: 'ascensio', ang: deg(80) },
    ],
    get: (k) => fx[k], set: (k, v) => { fx[k] = v; applyFx(); }, text: (k) => `${Math.round(fx[k] * 100)}%`,
    arc: () => fx.aether, save: () => ({ ...fx }), load: (o) => { Object.assign(fx, o); applyFx(); },
  };
  function clearAll() { for (const a of angels.splice(0)) voiceOff(a, 0.4); }
  function dice() {                                       // три ангела на сферах аккорда 4 · 5 · 6 — мажорное трезвучие в чистом строе
    clearAll();
    const chords = [[4, 5, 6], [3, 4, 5], [4, 6, 8], [5, 6, 8], [2, 3, 5]], ch = chords[Math.floor(Math.random() * chords.length)];
    const v0 = Math.random() * 5;                       // гласные — вразброс по кругу, ангелы не толпятся
    ch.forEach((n, i) => { const a = newAngel(9 - n, (v0 + i * 1.7 + Math.random() * 0.4) % 5); a.pinned = true; angels.push(a); voiceOn(a); });
  }
  const paradisus = {
    n: 'VI', title: 'Paradisus', sub: 'sphaerae · chorus',
    theme: { ink: INK, bg: BGC, paper: PAPER },
    corner: { hit: (f) => { const L = geo().light; return Math.hypot(f.x - L.x, f.y - L.y) < L.r; }, draw: () => {} },   // божественный свет — карта
    fx: fxw,
    legend: [['tap', 'touch a sphere', 'an angel sings while held'], ['drag', 'drag along a sphere', 'the vowel: a, e, i, o, u'],
      ['drag', 'drag across', 'to another sphere — another harmonic'], ['double', 'double tap', 'the angel stays and sings · again — let go'],
      ['hold', 'hold a staying angel', 'its sheet: choir, detune, vibrato, breath, register'], ['tap', 'tap the rose', 'a shower of grains'],
      ['tap', 'tap the light', 'map of worlds']],
    build, tick, draw, down, move, up, dice,
    clear: clearAll,
    snapshot: () => JSON.stringify({ angels: angels.filter((a) => a.pinned).map((a) => ({ k: a.k, v: a.v, singers: a.singers, detune: a.detune, vib: a.vib, breath: a.breath, reg: a.reg })), fx }),
    restore(js) {
      const st = JSON.parse(js);
      clearAll();
      Object.assign(fx, st.fx);
      for (const s of st.angels) { const a = Object.assign(newAngel(s.k, s.v), s, { pinned: true }); angels.push(a); voiceOn(a); }
      applyFx();
    },
    sounding: () => angels.length > 0,
  };
  T.registerWorld(6, paradisus);
  window.t2d.par = {
    angels, fx, geo, setFx: (k, v) => fxw.set(k, v), get live() { return !!(bus && bus.live); },
    at: (k, v) => anglePos(geo(), k, v), hz: (a) => hzOf(a), dice: () => dice(), get glitter() { return glitter.length; },
  };
})();
