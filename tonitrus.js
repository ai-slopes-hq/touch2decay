// Tonitrus — мир XIV: степь перед грозой. Три слоя, у каждого — рукой или сам («~» рядом с предметом):
//   · молния — тап по небу или земле: удар туда (ниже на земле — ближе; выше в небе — ближе и выше молния); ведёшь пальцем по небу —
//     сам рисуешь канал. Гром считается из формы молнии: канал режется на куски, каждый даёт короткий N-импульс, а приходит
//     он по расстоянию до слушателя — извилистая молния гремит раскатисто, прямая — одним ударом; дальние — позже, ниже и глуше,
//     близкие — с сухим треском. «~» под грозовой тучей на горизонте — гроза ходит и бьёт сама: подходит, проходит, уходит.
//     На вспышку мигает экран (2–3 разряда, как у настоящей молнии; не чаще трёх раз в секунду; выключается в плашке).
//   · дождь — туча: тап — дождь вкл/выкл, вниз — сильнее, вбок — туча плывёт; «~» — дождь сам накатывает волнами.
//   · колокола — звонница в степи: тап — удар (проводишь пальцем — по нескольким); настроены на лад; «~» — гудят от грома
//     (гром — вход резонаторов колоколов) и изредка от ветра.
// Звук: гром — буфер на каждый удар (rumble), дождь, ветер и колокола — storm-worklet.js. Держишь предмет — плашка.
(() => {
  'use strict';
  const T = window.T2D;
  const TAU = Math.PI * 2;
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const INK = '205,210,214', BGC = '#0b0e12', PAPER = '11,14,18', LIGHT = [224, 228, 255];
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const ink = (a) => `rgba(${INK},${a})`;
  const NOTES = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];
  const BELL_IV = [0, 7, 12, 15, 19];                         // большой слева … малый справа
  const VER = (document.currentScript && new URL(document.currentScript.src, location.href).searchParams.get('v')) || '0';
  const DMIN = 0.08, DMAX = 6;                                // км: ближний удар … дальний
  const RM = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)');

  // ---------- состояние ----------
  const rain = { on: false, amt: 0.55, u: -0.15, size: 0.4, lvl: 0.7 };
  const auto = { rain: false, bolt: false, bells: false };
  const storm = { u: -0.5, D: 4, ph: 0, seed: Math.random() * 6 };
  const cfg = { rate: 0.45, lvl: 0.85, flash: 1, pitch: 0.5, decay: 0.6, symp: 0.6, blvl: 0.75 };
  const fx = { space: 0.45, wind: 0.2, dark: 0.15 };
  const bolts = [], flashes = [];
  let strikes = 0;

  // ---------- геометрия: небо над степью, горизонт ниже середины, звонница справа у нас ----------
  function geo() {
    const W = T.W, H = T.H, top = T.topY + 6, bot = H - T.safeBot - 8, Ws = Math.min(W, (H - T.safeBot) * 0.62), cx = W / 2;
    const fx0 = cx - Ws / 2, fx1 = cx + Ws / 2, hor = top + (bot - top) * 0.6;
    const cw = Ws * 0.56, ch = (hor - top) * 0.2, cy = top + (hor - top) * (0.16 + 0.3 * rain.amt), cxx = cx + rain.u * (Ws - cw) * 0.5;
    const beamR = fx1 - 14, beamL = beamR - Math.min(170, Ws * 0.44), beamY = bot - 128, foot = bot - 22;
    const bells = BELL_IV.map((_, i) => { const s = 30 - i * 4, x = beamL + 16 + ((beamR - beamL - 32) * i) / (BELL_IV.length - 1); return { x, y: beamY + 10, s }; });
    const sx = cx + storm.u * Ws * 0.4, near = clamp(1 - (storm.D - 0.3) / (DMAX - 0.3));
    return { W, H, top, bot, Ws, cx, fx0, fx1, hor, cloud: { x: cxx, y: cy, w: cw, h: ch }, beamL, beamR, beamY, foot, bells, storm: { x: sx, near, w: 80 + 130 * near, h: 40 + 80 * near },
      tree: { x: fx0 + Ws * 0.82, y: hor + (bot - hor) * 0.2 } };
  }
  const groundY = (G, D) => G.hor + (G.bot - G.hor) * (DMIN / D);                          // перспектива: ближе — ниже
  const dOfGround = (G, y) => clamp((DMIN * (G.bot - G.hor)) / Math.max(1, y - G.hor), DMIN, DMAX);
  const dOfSky = (G, y) => { const g = clamp((G.hor - y) / (G.hor - G.top)); return DMAX ** (1 - g) * 0.12 ** g; };
  const boltTop = (G, D) => G.hor - (G.hor - G.top - 10) * clamp(1.4 / D ** 0.55, 0.12, 1);
  const autoPos = (G) => ({ rain: { x: G.cloud.x + G.cloud.w * 0.5 + 10, y: G.cloud.y + G.cloud.h * 0.55 }, bolt: { x: G.storm.x - G.storm.w * 0.5 - 6, y: G.hor - 13 }, bells: { x: G.beamR - 4, y: G.beamY - 22 } });

  // ---------- гром: из формы молнии ----------
  const randn = () => { let s = 0; for (let i = 0; i < 4; i++) s += Math.random(); return (s - 2) * 1.73; };
  function jag(pts, rough, minL) {                         // середина отрезка уходит вбок — канал извилистый
    let out = pts;
    for (let pass = 0; pass < 7; pass++) {
      const nx = [out[0]]; let split = false;
      for (let i = 1; i < out.length; i++) {
        const a = out[i - 1], b = out[i], L = Math.hypot(b.x - a.x, b.y - a.y);
        if (L > minL) { const o = randn() * L * rough; nx.push({ x: (a.x + b.x) / 2 - ((b.y - a.y) / L) * o, y: (a.y + b.y) / 2 + ((b.x - a.x) / L) * o * 0.4 }); split = true; }
        nx.push(b);
      }
      out = nx; if (!split) break;
    }
    return out;
  }
  function makeBolt(G, gx, D, path) {
    const gy = groundY(G, D), ty = boltTop(G, D);
    let main;
    if (path && path.length > 1) {                          // нарисованный: сверху вниз, продолжен до земли
      const p = [...path].sort((a, b) => a.y - b.y), rs = [p[0]];
      for (const q of p) { const l = rs[rs.length - 1]; if (Math.hypot(q.x - l.x, q.y - l.y) > 14) rs.push(q); }
      if (rs[0].y > ty + 8) rs.unshift({ x: rs[0].x + randn() * 14, y: ty });
      const l = rs[rs.length - 1]; if (l.y < gy - 4) rs.push({ x: gx, y: gy });
      main = jag(rs, 0.12, 6);
    } else main = jag([{ x: gx + randn() * 26 * (G.bot - gy + 40) / 200, y: ty }, { x: gx, y: gy }], 0.2, 5);
    const branches = [], nb = 2 + Math.floor(Math.random() * 4);
    for (let k = 0; k < nb; k++) {
      const i = Math.floor(main.length * (0.08 + 0.6 * Math.random())), a = main[i], len = (gy - ty) * (0.15 + 0.3 * Math.random()), side = Math.random() < 0.5 ? -1 : 1;
      branches.push(jag([a, { x: a.x + side * len * (0.4 + 0.5 * Math.random()), y: a.y + len }], 0.22, 5));
    }
    const strokes = [0]; let t = 0;                          // повторные разряды по тому же каналу
    for (let k = 0, n = 1 + Math.floor(Math.random() * 2.4); k < n; k++) { t += 45 + Math.random() * 90; strokes.push(t); }
    return { main, branches, D, gx, gy, ty, strokes, t0: performance.now() };
  }
  const tOf = (r) => 1.7 * r ** 0.8;                         // секунды до прихода (быстрее звука: инструмент, не метеостанция)
  function rumble(b, sr, cx, halfW) {                      // буфер раската: моно, с ведущей тишиной обрезанной
    const hpx = Math.max(10, b.gy - b.ty), KM = 1.6 / hpx, Xg = ((b.gx - cx) / halfW) * b.D * 0.7;
    const segs = [];
    const add = (pts, w) => {
      let z = b.D;
      const P = pts.map((p) => { z += randn() * 0.012 * (1 + b.D * 0.3); return [Xg + (p.x - b.gx) * KM, Math.max(0, (b.gy - p.y) * KM), z]; });
      for (let i = 1; i < P.length; i++) {
        const a = P[i - 1], c = P[i], m = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2], r = Math.hypot(m[0], m[1], m[2]);
        const s = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], L = Math.hypot(s[0], s[1], s[2]) || 1e-6, u = [m[0] / r, m[1] / r, m[2] / r];
        const cr = Math.hypot(s[1] * u[2] - s[2] * u[1], s[2] * u[0] - s[0] * u[2], s[0] * u[1] - s[1] * u[0]) / L;   // сбоку — громче
        segs.push({ r, a: (w * L * (0.25 + cr) * Math.exp(randn() * 0.5)) / (0.2 + r) });
      }
    };
    add(b.main, 1); for (const br of b.branches) add(br, 0.35);
    let rmin = 1e9; for (const s of segs) rmin = Math.min(rmin, s.r);
    const t0 = tOf(rmin), sm = 1 + 0.35 * b.D;              // дальний раскат размазан (рассеяние)
    for (const s of segs) s.t = t0 + (tOf(s.r) - t0) * sm;
    let tmax = 0; for (const s of segs) tmax = Math.max(tmax, s.t);
    const lead = Math.max(0, t0 - 0.03), len = Math.min(Math.ceil((tmax - lead + 0.25 * b.strokes[b.strokes.length - 1] / 1000 + 2.2) * sr), sr * 14);
    const br = new Float32Array(len), dk = new Float32Array(len);
    const SA = [1, 0.55, 0.35, 0.25];
    for (let q = 0; q < b.strokes.length; q++) {
      const off = b.strokes[q] / 1000, ga = SA[q] || 0.2;
      for (const s of segs) {
        const st = Math.floor((s.t - lead + off) * sr), m = Math.max(4, Math.floor((0.0025 + 0.004 * Math.sqrt(s.r)) * sr)), wf = clamp(s.r / 3), a = s.a * ga;
        for (let j = 0; j < m && st + j < len; j++) { if (st + j < 0) continue; const v = a * (1 - (2 * j) / m); br[st + j] += v * (1 - wf); dk[st + j] += v * wf; }
      }
    }
    const lp = (x, fc) => { const k = 1 - Math.exp((-TAU * fc) / sr); let y = 0; for (let i = 0; i < x.length; i++) { y += k * (x[i] - y); x[i] = y; } };
    lp(dk, 380); lp(dk, 380); lp(br, clamp(2600 / (0.3 + b.D), 500, 9000));
    const out = new Float32Array(len);
    const ke = 1 - Math.exp(-1 / (0.06 * sr)), kn = 1 - Math.exp((-TAU * 220) / sr);
    let env = 0, bn = 0, nl = 0;
    for (let i = 0; i < len; i++) {
      const x = br[i] + dk[i] * 2.2; env += ke * (Math.abs(x) - env);
      bn = 0.995 * bn + 0.05 * (Math.random() * 2 - 1); nl += kn * (bn - nl);   // рокот: тёмный шум по огибающей импульсов
      out[i] = x + nl * env * 9;
    }
    if (b.D < 1.5) {                                         // треск близкого удара
      const near = 1 - b.D / 1.5, st0 = Math.floor((t0 - lead) * sr);
      for (let q = 0; q < b.strokes.length; q++) {
        const st = st0 + Math.floor((b.strokes[q] / 1000) * sr), n = Math.floor(0.16 * sr);
        let prev = 0, tear = 1;
        for (let j = 0; j < n && st + j < len; j++) {
          if (j % 64 === 0) tear = Math.random() < 0.3 ? 2.2 : 0.6;
          const w = Math.random() * 2 - 1, h = w - prev; prev = w;
          out[st + j] += h * Math.exp(-j / (0.03 * sr)) * tear * near * (SA[q] || 0.2) * 0.9;
        }
      }
    }
    let pk = 1e-6; for (let i = 0; i < len; i++) pk = Math.max(pk, Math.abs(out[i]));
    const g = 1 / pk, sat = Math.tanh(1.8), fade = Math.floor(0.004 * sr);
    for (let i = 0; i < len; i++) { let v = Math.tanh(1.8 * out[i] * g) / sat; if (i < fade) v *= i / fade; if (i > len - sr * 0.5) v *= (len - i) / (sr * 0.5); out[i] = v; }
    return { data: out, lead, len, peak: 1, loud: 0.35 + 0.65 / (1 + 0.6 * b.D) };
  }

  // ---------- звук ----------
  let actx = null, bus = null, node = null, ready = false, started = false, lastSound = 0;
  const queue = [], thunders = new Set();
  let lv = [0, 0, 0, 0, 0], rainLv = 0;
  const send = (m) => { if (ready && node) node.port.postMessage(m); else { queue.push(m); if (queue.length > 40) queue.shift(); } };
  function build(ctx, input) {
    actx = ctx;
    const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const out = g(1), dark = ctx.createBiquadFilter(), thG = g(1), hallSend = g(0), symp = g(1), wet = g(1);
    dark.type = 'lowpass'; dark.Q.value = 0.5;
    out.connect(dark);
    const h = T.hall(); hallSend.connect(h.input); h.out.connect(wet).connect(dark);
    thG.connect(out); thG.connect(hallSend);
    const post = g(1.4); dark.connect(post);
    bus = { out, dark, post, thG, hallSend, hall: h, symp, input, live: false };
    ready = false; node = null; started = false; thunders.clear();
    applyAll();
  }
  function start() {                                       // модуль дождя и колоколов — когда в мир впервые зашли
    if (started || !actx) return;
    started = true;
    actx.audioWorklet.addModule(`storm-worklet.js?v=${VER}`).then(() => {
      node = new AudioWorkletNode(actx, 'storm', { numberOfInputs: 1, outputChannelCount: [2] });
      bus.thG.connect(bus.symp).connect(node);
      node.connect(bus.out); node.connect(bus.hallSend);
      node.port.onmessage = (e) => { const d = e.data; if (d.t === 'lv') { lv = d.b; rainLv = d.rain; } };
      ready = true;
      sendBells(); applyAll();
      while (queue.length) node.port.postMessage(queue.shift());
    }).catch(() => { started = false; });
  }
  function setLive(on) {
    if (!bus || bus.live === on) return;
    bus.live = on;
    if (on) bus.post.connect(bus.input); else bus.post.disconnect();
  }
  const sounding = () => (rain.on && rain.amt > 0.02) || auto.bolt || thunders.size > 0 || lv.some((x) => x > 0.002) || (auto.bells && fx.wind > 0.02);
  setInterval(() => {
    if (!bus) return;
    if (sounding() || fx.wind > 0.02) lastSound = performance.now();
    else if (performance.now() - lastSound > 8000) setLive(false);
  }, 1000);
  let rainEff = 0;
  function applyAll() {
    if (!bus) return;
    const t = actx.currentTime;
    bus.hallSend.gain.setTargetAtTime(fx.space * fx.space * 1.3, t, 0.05);
    for (const l of bus.hall.lines) l.g.gain.setTargetAtTime(10 ** ((-3 * l.len) / (1.5 + fx.space * 6)), t, 0.05);
    bus.dark.frequency.setTargetAtTime(18000 * 2 ** (-5.5 * fx.dark), t, 0.05);
    bus.thG.gain.setTargetAtTime(cfg.lvl, t, 0.05);
    const on = (rain.on && rain.amt > 0.02) || fx.wind > 0.02 || auto.bolt;
    if (on) { setLive(true); start(); }
    send({ t: 'params', rainT: rain.on ? rainEff : 0, size: rain.size, rainLvl: rain.lvl, windT: fx.wind, symT: auto.bells ? cfg.symp : 0, bellLvl: cfg.blvl, decay: cfg.decay });
  }
  const root = () => (T.scaleOn ? T.scaleRoot : 0);
  function semiOf(i) { let a = BELL_IV[i] + root(); if (T.scaleOn) a = T.snapSemi(a + 24) - 24; return a + 12 * (Math.round(cfg.pitch * 2) - 1); }
  const hzOf = (i) => 220 * 2 ** (semiOf(i) / 12);
  const nameOf = (i) => { const m = semiOf(i); return NOTES[((m % 12) + 12) % 12]; };
  let bellKey = '';
  function sendBells() { bellKey = BELL_IV.map((_, i) => hzOf(i).toFixed(2)).join(','); send({ t: 'bells', f: BELL_IV.map((_, i) => hzOf(i)) }); }
  const bellHit = [0, 0, 0, 0, 0];
  function ring(i, vel = 0.8) {
    if (!bus) return;
    setLive(true); start(); bellHit[i] = performance.now();
    send({ t: 'strike', i, vel });
    lastSound = performance.now();
  }
  let lastFlash = -1e9;
  function strike(G, gx, D, path) {                         // удар: молния на экране, вспышка, раскат
    const b = makeBolt(G, gx, D, path);
    bolts.push(b); if (bolts.length > 5) bolts.shift();
    strikes++;
    const now = performance.now();
    if (cfg.flash > 0.5 && now - lastFlash > 340) {          // не чаще трёх вспышек в секунду
      lastFlash = now;
      const a = (0.16 + 0.3 * clamp(1 - D / 3)) * (RM && RM.matches ? 0.4 : 1);
      b.strokes.forEach((o, k) => flashes.push({ t: now + o, a: a * (k ? 0.65 : 1) }));
      while (flashes.length > 12) flashes.shift();
    }
    if (!bus) return b;
    setLive(true); start();
    const r = rumble(b, actx.sampleRate, G.cx, G.Ws / 2), buf = actx.createBuffer(1, r.len, actx.sampleRate);
    buf.getChannelData(0).set(r.data);
    const src = actx.createBufferSource(), pan = actx.createStereoPanner ? actx.createStereoPanner() : actx.createGain(), gg = actx.createGain();
    src.buffer = buf; gg.gain.value = r.loud * 0.9;
    if (pan.pan) pan.pan.value = clamp((gx - G.cx) / (G.Ws / 2), -1, 1) * 0.7;
    src.connect(gg).connect(pan).connect(bus.thG);
    const t = actx.currentTime + 0.02 + r.lead;
    src.start(t); thunders.add(src); b.at = now + r.lead * 1000;
    src.onended = () => { thunders.delete(src); src.disconnect(); gg.disconnect(); pan.disconnect(); };
    lastSound = now;
    return b;
  }

  // ---------- касания ----------
  const touches = new Map();
  function bellAt(G, x, y) { for (let i = 0; i < G.bells.length; i++) { const b = G.bells[i]; if (Math.abs(x - b.x) < b.s * 0.55 + 4 && y > b.y - 6 && y < b.y + b.s * 1.15 + 6) return i; } return -1; }
  const inCloud = (G, x, y) => Math.abs(x - G.cloud.x) < G.cloud.w * 0.5 && y > G.cloud.y - G.cloud.h * 1.3 && y < G.cloud.y + G.cloud.h * 0.6;
  function autoAt(G, x, y) { const A = autoPos(G); for (const k of ['rain', 'bolt', 'bells']) if (Math.hypot(x - A[k].x, y - A[k].y) < 16) return k; return null; }
  const onBelfry = (G, x, y) => x > G.beamL - 10 && x < G.beamR + 10 && y > G.beamY - 14 && y < G.foot + 6;
  function down(f) {
    const G = geo(), now = performance.now(), base = { x0: f.x, y0: f.y, t0: now, moved: false };
    const ak = autoAt(G, f.x, f.y);
    if (ak) { touches.set(f.id, { kind: 'auto', k: ak, ...base }); return; }
    const bi = bellAt(G, f.x, f.y);
    if (bi >= 0) { ring(bi, 0.85); touches.set(f.id, { kind: 'bell', last: bi, ...base }); return; }
    if (onBelfry(G, f.x, f.y)) { touches.set(f.id, { kind: 'bell', last: -1, ...base }); return; }
    if (inCloud(G, f.x, f.y)) { touches.set(f.id, { kind: 'cloud', a0: rain.amt, u0: rain.u, ...base }); return; }
    if (f.y > G.top && f.y < G.bot) { touches.set(f.id, { kind: f.y < G.hor ? 'sky' : 'land', path: [{ x: f.x, y: f.y }], ...base }); return; }
    touches.set(f.id, { kind: 'none' });
  }
  function move(f) {
    const t = touches.get(f.id);
    if (!t || t.kind === 'none' || t.sheet) return;
    if (Math.hypot(f.x - t.x0, f.y - t.y0) > 8) t.moved = true;
    if (!t.moved) return;
    const G = geo();
    if (t.kind === 'bell') { const bi = bellAt(G, f.x, f.y); if (bi >= 0 && bi !== t.last) { t.last = bi; ring(bi, 0.6); } return; }
    if (t.kind === 'cloud') { rain.amt = clamp(t.a0 + (f.y - t.y0) / ((G.hor - G.top) * 0.3), 0.05, 1); rain.u = clamp(t.u0 + (f.x - t.x0) / ((G.Ws - G.cloud.w) * 0.5), -1, 1); rain.on = true; applyRain(true); return; }
    if (t.kind === 'sky' || t.kind === 'land') { const l = t.path[t.path.length - 1]; if (Math.hypot(f.x - l.x, f.y - l.y) > 5) t.path.push({ x: f.x, y: clamp(f.y, G.top, G.bot) }); }
  }
  function up(f) {
    const t = touches.get(f.id);
    touches.delete(f.id);
    if (!t || t.sheet || t.kind === 'none') return;
    const quick = !t.moved && performance.now() - t.t0 < T.HOLD_MS, G = geo();
    if (t.kind === 'auto' && quick) { auto[t.k] = !auto[t.k]; if (t.k === 'rain' && auto.rain) rain.on = true; if (t.k === 'bolt' && auto.bolt) nextAuto = performance.now() + 900; applyRain(true); return; }
    if (t.kind === 'cloud' && quick) { rain.on = !rain.on; if (!rain.on) auto.rain = false; applyRain(true); return; }
    if ((t.kind === 'sky' || t.kind === 'land') && (quick || t.moved)) {
      const low = t.path.reduce((m, p) => (p.y > m.y ? p : m), t.path[0]);
      const D = low.y > G.hor + 2 ? dOfGround(G, low.y) : dOfSky(G, low.y);
      strike(G, low.x, D, t.moved && t.path.length > 2 ? t.path : null);
    }
  }
  // ---------- плашки ----------
  const tog = (v) => (v > 0.5 ? 1 : 0);
  function sheets(kind) {
    if (kind === 'cloud') T.openSheet({
      title: 'nubes', hint: 'the cloud is the rain — tap outside to close',
      rows: [{ key: 'amt', label: 'rain' }, { key: 'size', label: 'drops' }, { key: 'lvl', label: 'level' }, { key: 'auto', label: 'by itself' }],
      lfo: { id: 'tonitrus-rain', keys: ['amt', 'size', 'lvl'], shapes: 'random' },
      get: (k) => (k === 'auto' ? +auto.rain : rain[k]), set: (k, v) => { if (k === 'auto') { auto.rain = !!tog(v); if (auto.rain) rain.on = true; } else rain[k] = k === 'amt' ? clamp(v, 0.05, 1) : v; applyRain(true); },
      text: (k) => (k === 'auto' ? (auto.rain ? 'in waves' : 'by hand') : k === 'size' ? (rain.size < 0.33 ? 'drizzle' : rain.size < 0.66 ? 'drops' : 'heavy drops') : `${Math.round(rain[k] * 100)}%`),
    });
    else if (kind === 'sky') T.openSheet({
      title: 'fulmen', hint: 'lightning and thunder — tap outside to close',
      rows: [{ key: 'auto', label: 'storm by itself' }, { key: 'rate', label: 'how often' }, { key: 'lvl', label: 'thunder' }, { key: 'flash', label: 'flash' }],
      lfo: { id: 'tonitrus-bolt', keys: ['rate', 'lvl'], shapes: 'random' },
      get: (k) => (k === 'auto' ? +auto.bolt : cfg[k]), set: (k, v) => { if (k === 'auto') { auto.bolt = !!tog(v); nextAuto = performance.now() + 900; } else if (k === 'flash') cfg.flash = tog(v); else cfg[k] = v; applyAll(); },
      text: (k) => (k === 'auto' ? (auto.bolt ? 'on' : 'by hand') : k === 'flash' ? (cfg.flash ? 'on' : 'off') : k === 'rate' ? `~${Math.round(meanGap() / 1000)} s` : `${Math.round(cfg[k] * 100)}%`),
    });
    else if (kind === 'bell') T.openSheet({
      title: 'campanae', hint: 'the bells of the steppe — tap outside to close',
      rows: [{ key: 'pitch', label: 'pitch' }, { key: 'decay', label: 'decay' }, { key: 'symp', label: 'thunder rings them' }, { key: 'blvl', label: 'level' }, { key: 'auto', label: 'by themselves' }],
      lfo: { id: 'tonitrus-bells', keys: ['decay', 'symp', 'blvl'], shapes: 'random' },
      get: (k) => (k === 'auto' ? +auto.bells : cfg[k]), set: (k, v) => { if (k === 'auto') auto.bells = !!tog(v); else cfg[k] = k === 'pitch' ? Math.round(v * 2) / 2 : v; if (k === 'pitch') sendBells(); applyAll(); },
      text: (k) => (k === 'auto' ? (auto.bells ? 'thunder · wind' : 'by hand') : k === 'pitch' ? `${['low', 'middle', 'high'][Math.round(cfg.pitch * 2)]} · ${nameOf(0)}` : `${Math.round(cfg[k] * 100)}%`),
    });
  }
  // ---------- сама гроза ----------
  const meanGap = () => (16000 - 13500 * cfg.rate) * (0.6 + 0.08 * storm.D);
  let nextAuto = 0, nextWind = 0, prevT = 0, rainT0 = 0, sentRain = -1;
  function applyRain(force) {
    let a = rain.amt;
    if (auto.rain) { const s = performance.now() / 1000; a *= 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(s / 23 + 1) * Math.sin(s / 41)); if (auto.bolt) a *= 0.5 + 0.5 * clamp(1.4 / storm.D); }
    rainEff = a;
    if (force || Math.abs(a - sentRain) > 0.01) { sentRain = a; applyAll(); }
  }
  function tick(now) {
    for (const t of touches.values()) if (['cloud', 'sky', 'land', 'bell'].includes(t.kind) && !t.moved && !t.sheet && now - t.t0 > T.HOLD_MS) { t.sheet = true; sheets(t.kind === 'land' ? 'sky' : t.kind); }
    const dt = prevT ? Math.min(0.1, (now - prevT) / 1000) : 0; prevT = now;
    if (auto.bolt) {
      storm.ph += (dt * TAU) / 150;                                            // гроза подходит, проходит, уходит — за две с половиной минуты
      storm.D = 0.35 + (DMAX - 0.6) * (0.5 + 0.5 * Math.cos(storm.ph)) ** 1.4;
      storm.u = 0.75 * Math.sin(storm.ph * 0.5 + storm.seed);
      if (now > nextAuto) {
        const G = geo(), D = clamp(storm.D * (0.6 + 0.8 * Math.random()), DMIN * 2, DMAX), x = clamp(G.storm.x + randn() * G.Ws * 0.15, G.fx0 + 10, G.fx1 - 10);
        strike(G, x, D);
        nextAuto = now - Math.log(1 - Math.random() * 0.95) * meanGap();
      }
    }
    if (auto.bells && now > nextWind) {                                       // ветер иногда качает колокол
      if (nextWind && fx.wind > 0.05) ring(Math.floor(Math.random() * BELL_IV.length), 0.08 + 0.25 * fx.wind * Math.random());
      nextWind = now + 4000 + Math.random() * 9000;
    }
    if (now - rainT0 > 100) { rainT0 = now; applyRain(false); const k = BELL_IV.map((_, i) => hzOf(i).toFixed(2)).join(','); if (k !== bellKey) sendBells(); }
  }

  // ---------- рисование ----------
  let wallC = null, wallKey = '';
  function wall(G) {                                       // неподвижное: небо штрихами, дальние холмы, степь, дорога, дерево, звонница без колоколов
    const key = `${G.W}x${G.H}x${T.DPR}|${G.hor}|${G.Ws}|${G.bot}`;
    if (wallC && key === wallKey) return wallC;
    wallKey = key;
    wallC = document.createElement('canvas'); wallC.width = Math.round(G.W * T.DPR); wallC.height = Math.round(G.H * T.DPR);
    const x = wallC.getContext('2d');
    x.setTransform(T.DPR, 0, 0, T.DPR, 0, 0);
    x.fillStyle = BGC; x.fillRect(0, 0, G.W, G.H);
    let sd = 7; const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
    x.lineWidth = 0.7;                                                                         // небо: горизонтальные штрихи, вверху гуще и темнее — тяжёлое небо
    for (let y = G.top; y < G.hor - 2; y += 3) {
      const f = (y - G.top) / (G.hor - G.top); x.strokeStyle = ink(0.03 + 0.07 * (1 - f) ** 1.5); x.beginPath();
      for (let X = G.fx0; X < G.fx1;) { const L = 20 + rnd() * 90, gap = 4 + rnd() * 18 * f; x.moveTo(X, y + rnd() * 0.6); x.lineTo(Math.min(G.fx1, X + L), y); X += L + gap; }
      x.stroke();
    }
    x.fillStyle = BGC; x.strokeStyle = ink(0.45); x.lineWidth = 0.8; x.beginPath(); x.moveTo(G.fx0, G.hor);   // дальние увалы
    for (let X = G.fx0; X <= G.fx1; X += 4) x.lineTo(X, G.hor - 4 - 7 * Math.sin(X * 0.011 + 1) ** 2 - 3 * Math.sin(X * 0.037));
    x.lineTo(G.fx1, G.hor); x.closePath(); x.fill(); x.stroke();
    x.fillStyle = BGC; x.fillRect(G.fx0, G.hor, G.Ws, G.bot - G.hor + 10);
    x.strokeStyle = ink(0.8); x.lineWidth = 1; x.beginPath(); x.moveTo(G.fx0, G.hor + 0.5); x.lineTo(G.fx1, G.hor + 0.5); x.stroke();
    x.strokeStyle = ink(0.14); x.lineWidth = 0.6; x.beginPath();                               // степь: пучки травы, к нам крупнее, ветер клонит вправо
    for (let k = 0; k < 900; k++) {
      const f = rnd() ** 1.7, y = G.hor + 3 + (G.bot - G.hor) * f, s = 0.15 + f * 1.1, X = G.fx0 + rnd() * G.Ws;
      for (let j = 0; j < 3; j++) { const ox = (j - 1) * 1.6 * s, h = (3 + rnd() * 5) * s; x.moveTo(X + ox, y); x.quadraticCurveTo(X + ox + h * 0.15, y - h * 0.6, X + ox + h * 0.45, y - h); }
    }
    x.stroke();
    const road = (t, side) => { const y = G.hor + (G.bot - G.hor) * t ** 1.8, w = 2 + 46 * t ** 1.8, xc = G.cx - G.Ws * 0.05 + Math.sin(t * 4.2) * G.Ws * 0.12 * (1 - t * 0.4); return { x: xc + side * w, y }; };
    for (const side of [-1, 1]) { x.strokeStyle = ink(0.35); x.lineWidth = 0.8; x.beginPath(); for (let i = 0; i <= 60; i++) { const p = road(0.03 + (0.97 * i) / 60, side); i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y); } x.stroke(); }
    x.strokeStyle = ink(0.1); x.beginPath(); for (let i = 0; i < 40; i++) { const t = 0.2 + rnd() * 0.8, a = road(t, -0.6), b = road(t, 0.6); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); } x.stroke();   // колея
    const tr = G.tree, th = (G.bot - G.hor) * 0.38;                                            // одинокое дерево, согнутое ветром
    x.strokeStyle = ink(0.85); x.lineWidth = 2.2; x.beginPath(); x.moveTo(tr.x, tr.y); x.quadraticCurveTo(tr.x - 3, tr.y - th * 0.5, tr.x + 6, tr.y - th * 0.75); x.stroke();
    x.lineWidth = 1; x.beginPath();
    for (const [a, l] of [[-2.3, 0.35], [-1.9, 0.3], [-1.2, 0.32], [-0.7, 0.28], [-1.55, 0.4]]) { const bx = tr.x + 4, by = tr.y - th * 0.68; x.moveTo(bx, by); x.quadraticCurveTo(bx + Math.cos(a) * th * l * 0.4, by + Math.sin(a) * th * l * 0.6, bx + Math.cos(a) * th * l + th * 0.12, by + Math.sin(a) * th * l); }
    x.stroke();
    x.strokeStyle = ink(0.5); x.lineWidth = 0.7; x.beginPath();                                // крона: штриховые завитки, сдуты вправо
    for (let k = 0; k < 90; k++) { const a = rnd() * TAU, r = rnd() ** 0.6, px = tr.x + 10 + Math.cos(a) * th * 0.42 * r + th * 0.08, py = tr.y - th * 0.95 + Math.sin(a) * th * 0.22 * r; x.moveTo(px, py); x.quadraticCurveTo(px + 3, py - 2, px + 6, py); }
    x.stroke();
    x.strokeStyle = ink(0.2); x.beginPath(); x.ellipse(tr.x + 6, tr.y + 1, th * 0.25, 2.5, 0, 0, TAU); x.stroke();
    const { beamL, beamR, beamY, foot } = G;                                                   // звонница: два столба, перекладина, подкосы
    x.fillStyle = BGC; x.strokeStyle = ink(0.9); x.lineWidth = 1;
    for (const px of [beamL, beamR]) { x.beginPath(); x.rect(px - 3.5, beamY - 6, 7, foot - beamY + 6); x.fill(); x.stroke(); x.strokeStyle = ink(0.35); x.beginPath(); for (let y = beamY; y < foot; y += 7) { x.moveTo(px - 3.5, y); x.lineTo(px + 3.5, y + 3); } x.stroke(); x.strokeStyle = ink(0.9); }
    x.beginPath(); x.moveTo(beamL - 4, foot); x.lineTo(beamL + 18, foot - 26); x.moveTo(beamR + 4, foot); x.lineTo(beamR - 18, foot - 26); x.stroke();
    x.beginPath(); x.rect(beamL - 10, beamY - 9, beamR - beamL + 20, 7); x.fill(); x.stroke();
    x.beginPath(); x.moveTo(beamL - 14, beamY - 9); x.lineTo((beamL + beamR) / 2, beamY - 24); x.lineTo(beamR + 14, beamY - 9); x.closePath(); x.fill(); x.stroke();   // кровелька
    x.strokeStyle = ink(0.3); x.beginPath(); for (let k = 1; k < 12; k++) { const f = k / 12, a = beamL - 14 + (beamR - beamL + 28) * f; x.moveTo(a, beamY - 9); x.lineTo((beamL + beamR) / 2 + (a - (beamL + beamR) / 2) * 0.3, beamY - 20); } x.stroke();
    x.strokeStyle = ink(0.25); x.beginPath(); x.ellipse((beamL + beamR) / 2, foot + 1, (beamR - beamL) * 0.62, 3, 0, 0, TAU); x.stroke();
    return wallC;
  }
  function puffs(C, sd) {                                 // кучевая туча — горсть кругов: выше к середине, основание ровное
    let q = sd * 9301 + 49297; const r = () => ((q = (q * 16807) % 2147483647) / 2147483647);
    const out = [], n = 13;
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1), mid = 1 - Math.abs(f - 0.45) * 1.5, rr = C.h * (0.22 + 0.28 * mid + 0.12 * r());
      out.push({ x: C.x - C.w / 2 + rr * 0.8 + (C.w - rr * 1.6) * f, y: C.y + C.h * 0.45 - rr * (0.7 + 0.35 * r()), r: rr });
    }
    for (let i = 0; i < 9; i++) { const f = 0.15 + 0.7 * r(), mid = 1 - Math.abs(f - 0.45) * 1.8; out.push({ x: C.x - C.w / 2 + C.w * f, y: C.y - C.h * (0.05 + 0.6 * mid * r()), r: C.h * (0.22 + 0.25 * mid + 0.1 * r()) }); }
    return out;
  }
  function drawPuffs(c, C, P, fill, hatch, line, bottom) {  // объединение кругов: обводка снаружи, внутри — штриховка; низ срезан ровно
    c.save(); c.beginPath(); c.rect(C.x - C.w, C.y - C.h * 4, C.w * 2, C.h * 4 + C.h * 0.45 + bottom); c.clip();
    c.strokeStyle = line; c.lineWidth = 1.1; for (const p of P) { c.beginPath(); c.arc(p.x, p.y, p.r, 0, TAU); c.stroke(); }
    c.fillStyle = fill; c.beginPath(); for (const p of P) { c.moveTo(p.x + p.r - 0.6, p.y); c.arc(p.x, p.y, p.r - 0.6, 0, TAU); } c.fill();
    c.clip();
    c.strokeStyle = hatch; c.lineWidth = 0.7; c.beginPath();
    for (let y = C.y - C.h * 3; y < C.y + C.h; y += 2.8) { const k = clamp((y - (C.y - C.h * 1.2)) / (C.h * 1.8)); if (Math.random() < 2) { c.moveTo(C.x - C.w, y); c.lineTo(C.x + C.w, y + 0.5); } if (k > 0.5) { c.moveTo(C.x - C.w, y + 1.4); c.lineTo(C.x + C.w, y + 1.9); } }   // к основанию гуще — тень
    c.stroke();
    for (const p of P) { c.strokeStyle = line.replace(/[\d.]+\)$/, '0.25)'); c.beginPath(); c.arc(p.x, p.y, p.r * 0.92, -2.6, -1.2); c.stroke(); }   // светлые кромки сверху-слева
    c.restore();
    c.strokeStyle = line; c.lineWidth = 1; c.beginPath(); c.moveTo(C.x - C.w / 2 + 2, C.y + C.h * 0.45 + bottom); c.quadraticCurveTo(C.x, C.y + C.h * 0.55 + bottom, C.x + C.w / 2 - 2, C.y + C.h * 0.45 + bottom); c.stroke();
  }
  function drawStorm(c, G, now, fl) {                      // грозовая туча на горизонте: башня кучевых кругов и плоская наковальня, сдутая ветром; ближе — больше
    const S = G.storm, a = auto.bolt ? 0.7 : 0.3, y = G.hor - 3;
    const body = { x: S.x, y: y - S.h * 0.25, w: S.w * 0.55, h: S.h * 0.4 };
    let q = 77; const r = () => ((q = (q * 16807) % 2147483647) / 2147483647);
    const P = [];
    for (let k = 0; k < 7; k++) { const f = k / 6, rr = body.h * (0.75 - 0.25 * f + 0.15 * r()); P.push({ x: S.x + (r() - 0.5) * body.w * (0.8 - 0.4 * f), y: y - rr * 0.6 - f * S.h * 0.66, r: rr }); }
    const ay = y - S.h * 0.95, al = S.x - S.w * 0.45, ar = S.x + S.w * 0.65;   // наковальня
    c.fillStyle = `rgba(${PAPER},1)`; c.strokeStyle = ink(a); c.lineWidth = 0.9; c.beginPath();
    c.moveTo(al, ay); c.quadraticCurveTo(S.x, ay - S.h * 0.14, ar, ay - S.h * 0.02); c.quadraticCurveTo(S.x + S.w * 0.2, ay + S.h * 0.06, S.x + S.w * 0.08, ay + S.h * 0.14);
    c.lineTo(S.x - S.w * 0.08, ay + S.h * 0.14); c.quadraticCurveTo(S.x - S.w * 0.2, ay + S.h * 0.06, al, ay); c.closePath(); c.fill(); c.stroke();
    c.save(); c.clip(); c.strokeStyle = ink(a * 0.3 + fl * 0.5); c.lineWidth = 0.6; c.beginPath(); for (let yy = ay - S.h * 0.15; yy < ay + S.h * 0.2; yy += 2.5) { c.moveTo(al, yy); c.lineTo(ar, yy); } c.stroke(); c.restore();
    drawPuffs(c, { x: S.x, y: y - 2, w: S.w * 0.7, h: S.h }, P, `rgba(${PAPER},1)`, ink(a * 0.3 + fl * 0.5), ink(a), -S.h * 0.45);
    if (auto.bolt) { c.strokeStyle = ink(0.2); c.lineWidth = 0.7; c.beginPath(); for (let k = 0; k < 12; k++) { const xx = S.x - body.w * 0.4 + (body.w * 0.8 * k) / 11, sh = (now * 0.03 + k * 7) % 6; c.moveTo(xx + sh * 0.3, y - 6 + sh * 0.5); c.lineTo(xx - 2 + sh * 0.3, y - 1); } c.stroke(); }   // ливень под ней
  }
  function drawCloud(c, G, now, fl) {
    const C = G.cloud, on = rain.on, re = rain.on ? rainEff : 0;
    if (on && re > 0.01) {                                  // дождь: косые штрихи от основания тучи до земли, падают
      const n = Math.round(20 + 140 * re), y0 = C.y + C.h * 0.4, slant = 0.18 + fx.wind * 0.25;
      c.lineWidth = 0.7; c.strokeStyle = ink(0.12 + 0.2 * re + fl * 0.4); c.beginPath();
      for (let k = 0; k < n; k++) {
        const hs = (k * 0.618034) % 1, x0 = C.x - C.w * 0.48 + C.w * 0.96 * hs, yb = groundY(G, 0.3 + 3 * ((k * 0.414) % 1));
        const span = yb - y0, ph = ((now * (0.0012 + 0.0005 * ((k * 0.73) % 1)) + hs * 7) % 1), yy = y0 + span * ph, L = 8 + 10 * re;
        if (yy > yb - 2) continue;
        c.moveTo(x0 + (yy - y0) * slant, yy); c.lineTo(x0 + (yy - y0 + L) * slant, yy + L);
      }
      c.stroke();
    }
    drawPuffs(c, C, puffs(C, 3), fl > 0.02 ? `rgba(${LIGHT[0]},${LIGHT[1]},${LIGHT[2]},${0.1 + fl * 0.5})` : `rgba(${PAPER},1)`, ink(0.08 + 0.16 * rain.amt), ink(on ? 0.85 : 0.5), 0);
  }
  function drawBolt(c, b, now) {                           // молния: ядро и бледный широкий штрих вокруг (без shadowBlur); в такт разрядам — ярче
    const age = now - b.t0, last = b.strokes[b.strokes.length - 1];
    if (age > last + 700) return false;
    let k = 0; for (const o of b.strokes) if (age >= o) k = Math.max(k, Math.exp(-(age - o) / 90));
    const fade = age > last ? Math.max(0, 1 - (age - last) / 700) : 1, a = Math.max(k, 0.15) * fade;
    const line = (pts, w, al) => { c.strokeStyle = rgba(LIGHT, al); c.lineWidth = w; c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.stroke(); };
    c.lineJoin = 'round';
    line(b.main, 7, 0.08 * a); line(b.main, 1.8, 0.95 * a);
    for (const br of b.branches) { line(br, 3.5, 0.05 * a); line(br, 0.9, 0.6 * a); }
    if (k > 0.4) T.glowAt(b.gx, b.gy, 30, 0.35 * k);
    return true;
  }
  function drawBells(c, G, now) {
    G.bells.forEach((B, i) => {
      const e = clamp((lv[i] || 0) * 9), hit = clamp(1 - (now - bellHit[i]) / 500), sw = Math.sin(now * (0.004 + i * 0.0006) + i) * Math.min(0.32, e * 0.5 + hit * 0.12);
      c.strokeStyle = ink(0.7); c.lineWidth = 0.8; c.beginPath(); c.moveTo(B.x, G.beamY - 2); c.lineTo(B.x, B.y); c.stroke();
      if (e > 0.05) T.glowAt(B.x, B.y + B.s * 0.6, B.s * 1.3, 0.1 + 0.3 * e);
      c.save(); c.translate(B.x, B.y); c.rotate(sw);
      const s = B.s, w = s * 0.5;
      c.beginPath(); c.moveTo(-w * 0.32, 0); c.quadraticCurveTo(-w * 0.45, s * 0.05, -w * 0.48, s * 0.4); c.quadraticCurveTo(-w * 0.55, s * 0.8, -w, s); c.lineTo(w, s); c.quadraticCurveTo(w * 0.55, s * 0.8, w * 0.48, s * 0.4); c.quadraticCurveTo(w * 0.45, s * 0.05, w * 0.32, 0); c.closePath();
      c.fillStyle = BGC; c.fill(); c.strokeStyle = e > 0.05 ? rgba(LIGHT, 0.6 + 0.4 * e) : ink(0.9); c.lineWidth = 1; c.stroke();
      c.strokeStyle = ink(0.35); c.lineWidth = 0.7; c.beginPath(); for (let k = 1; k < 5; k++) { const f = k / 5; c.moveTo(w * 0.15 * f + w * 0.1, s * 0.1); c.quadraticCurveTo(w * 0.4 * f + w * 0.12, s * 0.6, w * 0.8 * f + w * 0.1, s * 0.95); } c.stroke();   // тень справа
      c.strokeStyle = ink(0.6); c.beginPath(); c.moveTo(-w * 0.9, s * 0.88); c.lineTo(w * 0.9, s * 0.88); c.stroke();
      c.fillStyle = ink(0.9); c.beginPath(); c.arc(Math.sin(now * 0.01 + i) * e * w * 0.3, s * 1.06, 1.8, 0, TAU); c.fill();   // язык
      c.restore();
    });
  }
  function drawAuto(c, G) {                                // «~» у трёх предметов: светится — живёт сам
    const A = autoPos(G);
    for (const k of ['rain', 'bolt', 'bells']) {
      const p = A[k], on = auto[k];
      if (on) T.glowAt(p.x, p.y, 16, 0.25);
      c.fillStyle = `rgba(${PAPER},0.9)`; c.strokeStyle = on ? rgba(LIGHT, 0.95) : ink(0.45); c.lineWidth = 0.9;
      c.beginPath(); c.arc(p.x, p.y, 9, 0, TAU); c.fill(); c.stroke();
      c.beginPath(); for (let i = 0; i <= 12; i++) { const u = i / 12, xx = p.x - 5 + 10 * u, yy = p.y - 2 * Math.sin(u * TAU); i ? c.lineTo(xx, yy) : c.moveTo(xx, yy); } c.stroke();
    }
  }
  const km = (D) => (D < 1 ? `${Math.round(D * 1000 / 10) * 10} m` : `${D.toFixed(1)} km`);
  function draw(now) {
    const c = T.g, G = geo();
    let fl = 0; for (const f of flashes) if (now >= f.t) fl += f.a * Math.exp(-(now - f.t) / 60);
    while (flashes.length && now - flashes[0].t > 600) flashes.shift();
    fl = Math.min(0.55, fl);
    c.drawImage(wall(G), 0, 0, G.W, G.H);
    drawStorm(c, G, now, fl);
    for (let i = bolts.length - 1; i >= 0; i--) if (!drawBolt(c, bolts[i], now)) bolts.splice(i, 1);
    drawCloud(c, G, now, fl);
    drawBells(c, G, now);
    drawAuto(c, G);
    if (fl > 0.005) { c.fillStyle = rgba(LIGHT, fl); c.fillRect(0, 0, G.W, G.H); }   // вспышка: весь экран
    for (const t of touches.values()) {                   // подписи — пока трогаешь
      if (t.kind === 'sky' || t.kind === 'land') {
        const low = t.path.reduce((m, p) => (p.y > m.y ? p : m), t.path[0]), D = low.y > G.hor + 2 ? dOfGround(G, low.y) : dOfSky(G, low.y);
        if (t.path.length > 1) { c.strokeStyle = rgba(LIGHT, 0.4); c.lineWidth = 1; c.setLineDash([2, 4]); c.beginPath(); t.path.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.stroke(); c.setLineDash([]); }
        T.mapText(km(D), low.x, Math.min(low.y, G.bot - 24) - 16, 13, 0.9, 'center');
      } else if (t.kind === 'cloud' && t.moved) T.mapText(`rain ${Math.round(rain.amt * 100)}%`, G.cloud.x, G.cloud.y - G.cloud.h * 1.4 - 6, 13, 0.9, 'center');
      else if (t.kind === 'bell' && t.last >= 0) { const B = G.bells[t.last]; T.mapText(`${nameOf(t.last)} · ${Math.round(hzOf(t.last))} Hz`, B.x, G.beamY - 30, 13, 0.9, 'center'); }
    }
  }

  // ---------- мир ----------
  const deg = (d) => (d * Math.PI) / 180;
  const fxw = {
    sectors: [{ key: 'space', label: 'space', ang: deg(180) }, { key: 'wind', label: 'wind', ang: deg(150) }, { key: 'dark', label: 'dark', ang: deg(120) }],
    get: (k) => fx[k], set: (k, v) => { fx[k] = v; applyAll(); }, text: (k) => (k === 'wind' && fx.wind < 0.02 ? 'calm' : `${Math.round(fx[k] * 100)}%`),
    lfo: { keys: ['space', 'wind', 'dark'], shapes: 'random' },
    arc: () => fx.space, save: () => ({ ...fx }), load: (o) => { Object.assign(fx, o); applyAll(); },
  };
  function dice() {                                       // новая гроза: где она, как часто бьёт, дождь, колокола
    const R = Math.random;
    storm.ph = R() * TAU; storm.seed = R() * 6; cfg.rate = 0.3 + R() * 0.5;
    rain.amt = 0.3 + R() * 0.6; rain.u = R() * 1.6 - 0.8; rain.size = R(); rain.on = true;
    auto.rain = true; auto.bolt = true; auto.bells = R() < 0.7;
    cfg.pitch = [0, 0.5, 0.5, 1][Math.floor(R() * 4)]; cfg.decay = 0.4 + R() * 0.5; fx.wind = 0.1 + R() * 0.4;
    sendBells(); applyRain(true);
    storm.D = 0.35 + (DMAX - 0.6) * (0.5 + 0.5 * Math.cos(storm.ph)) ** 1.4;
    nextAuto = performance.now() + 300;
  }
  function clear() {
    rain.on = false; auto.rain = auto.bolt = auto.bells = false; fx.wind = 0;
    for (const s of thunders) { try { s.stop(); } catch (_) { /* уже */ } }
    thunders.clear(); bolts.length = 0; flashes.length = 0;
    send({ t: 'damp' }); applyRain(true);
  }
  const tonitrus = {
    n: 'XIV', title: 'Tonitrus', sub: 'fulmen · imber · campanae', theme: { ink: INK, bg: BGC, paper: PAPER },
    corner: { hit: () => false, draw: () => {} },   // солнца в грозу нет — на карту стрелкой
    fx: fxw,
    legend: [['tap', 'tap the sky or the steppe', 'lightning there: lower on the land — nearer, higher in the sky — nearer and taller'], ['drag', 'draw across the sky', 'your own bolt — its bends are the rumble'],
      ['tap', 'tap the cloud', 'rain on · off · drag down — heavier, sideways — it drifts'], ['tap', 'tap a bell · run a finger along them', 'it rings · tuned to the scale'],
      ['tap', 'tap a ~', 'that one lives by itself: the storm walks and strikes, the rain comes in waves, thunder rings the bells'], ['hold', 'hold the cloud, the sky, the bells', 'its sheet · flash on · off']],
    build, tick, draw, down, move, up, dice, clear, enter: start,
    snapshot: () => JSON.stringify({ rain, auto, storm, cfg, fx }),
    restore(js) { const st = JSON.parse(js); Object.assign(rain, st.rain); Object.assign(auto, st.auto); Object.assign(storm, st.storm); Object.assign(cfg, st.cfg); Object.assign(fx, st.fx); sendBells(); applyRain(true); },
    sounding,
  };
  T.registerWorld(14, tonitrus);
  window.t2d.tonitrus = {
    rain, auto, storm, cfg, fx, bolts, geo, get strikes() { return strikes; }, get thunders() { return thunders.size; }, get lv() { return lv; }, get rainLv() { return rainLv; }, get flash() { return flashes.length; },
    hz: hzOf, name: nameOf, bellAt: (i) => { const B = geo().bells[i]; return { x: B.x, y: B.y + B.s * 0.6 }; }, cloudAt: () => { const C = geo().cloud; return { x: C.x, y: C.y }; }, autoAt: (k) => autoPos(geo())[k],
    landAt: (D, u = 0) => { const G = geo(); return { x: G.cx + u * G.Ws * 0.4, y: groundY(G, D) }; }, skyAt: (g, u = 0) => { const G = geo(); return { x: G.cx + u * G.Ws * 0.4, y: G.hor - g * (G.hor - G.top) }; },
    rumble: (D) => { const G = geo(), b = makeBolt(G, G.cx, D), t0 = performance.now(), r = rumble(b, 48000, G.cx, G.Ws / 2); return { lead: r.lead, sec: r.len / 48000, ms: performance.now() - t0 }; },
    strike: (x, D) => strike(geo(), x, D), apply: applyAll,
  };
})();
