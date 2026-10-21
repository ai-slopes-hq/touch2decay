// Horologium — мир IX: астрономические часы, как пражский орлой. Звук — West Coast (Buchla): сложный генератор (FM на
// отношении зубцов), складывание волны (wavefolder) и low pass gate — деревянный, бонговый удар, который сам гаснет.
// Сверху — циферблат: 24 часа, горизонт, стрелка-солнце обходит его, и его высота над горизонтом складывает волну сильнее
// (sol); луна прыгает случайно — fortuna, источник случайности (Source of Uncertainty). Под циферблатом — четыре шестерни:
// каждая — дорожка секвенсера, зубцов — шагов; маятник качается, и за каждый его такт все шестерни поворачиваются на зубец.
// Шестерни разного размера — полиритм. Тап по зубцу — штифт; штифт пришёл наверх — молоточек бьёт. Тянешь шестерню вверх-вниз —
// нота, держишь — плашка (зубцы, складки, отношение, индекс, затухание, громкость). Маятник: тап — пуск/стоп, вбок — темп.
// Солнце — четвертью в правом верхнем углу (к центру карты): тап — карта.
(() => {
  'use strict';
  const T = window.T2D;
  const TAU = Math.PI * 2;
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const INK = '214,180,110', BGC = '#0c0a07', PAPER = '12,10,7';
  const NOTES = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
  const RATIOS = [0.5, 1, 1.5, 2, 2.76, 3.5, 4, 5.4];
  const TEETH = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
  const SUN_STEPS = 64;                                   // солнце обходит циферблат за 64 такта маятника

  // ---------- состояние ----------
  const gear = (teeth, pins, semi, o = {}) => ({ teeth, pins: new Set(pins), semi, fold: 0.35, ratio: 1.5, index: 0.4, decay: 0.4, level: 0.8, ramp: 0, rampTo: 0, hit: 0, ...o });
  const gears = [gear(4, [0, 2], 0), gear(6, [0, 3, 4], 7, { ratio: 2, fold: 0.5 }), gear(5, [1], 12, { ratio: 2.76, decay: 0.25 }), gear(7, [0, 5], -5, { ratio: 1, fold: 0.2, decay: 0.6 })];
  const fx = { sol: 0.4, fortuna: 0.15, fmode: 0, fto: 0, decay: 0.5, hall: 0.35 };
  const TARGETS = ['fold', 'index', 'decay', 'pitch'];    // куда идут рампа шестерни и fortuna
  let chance = 0, smoothV = 0, smoothT = 0;               // fortuna — источник случайности: ступень на каждый удар или плавное блуждание
  const seq = { playing: false, bpm: 100, next: 0, step: 0 };
  const stepSec = () => 60 / seq.bpm / 2;                 // такт маятника — восьмая
  let moonA = 0.3, moonHit = 0;
  const hzSemi = (s) => 110 * 2 ** ((T.scaleOn ? T.snapSemi(Math.round(s) + 24) - 24 : s) / 12);   // от A2; с ладом — ближайшая ступень
  const hzOf = (g) => hzSemi(g.semi);
  const noteName = (f) => { const m = Math.round(12 * Math.log2(f / 55)); return `${NOTES[((m % 12) + 12) % 12]}${Math.floor((m + 9) / 12) + 1}`; };

  // ---------- геометрия: циферблат сверху, шестерни 2 × 2 под ним, маятник между ними ----------
  function geo() {
    const W = T.W, H = T.H, top = T.topY + 6, bot = H - T.safeBot - 8, h = bot - top, Ws = Math.min(W, (H - T.safeBot) * 0.62), cx = W / 2;
    const Rd = Math.min(Ws * 0.29, h * 0.17), dcy = top + 18 + Rd;
    const free = bot - (dcy + Rd), Rg = Math.min(84, (Ws - 56) / 4, (free - 130) / 4.3), gx = Rg + 22;   // шестерни и маятник — по центру свободного места
    const blk = 4 * Rg + 2 * 30 + 40, y0 = dcy + Rd + Math.max(0, (free - blk) / 2), gy1 = y0 + 30 + Rg, gy2 = gy1 + 2 * Rg + 30;
    const pos = [[cx - gx, gy1], [cx + gx, gy1], [cx - gx, gy2], [cx + gx, gy2]];
    const pivot = { x: cx, y: dcy + Rd + 4 }, bobY = Math.min(bot - 16, gy2 + Rg + 30);
    return { W, H, top, bot, cx, Ws, dial: { x: cx, y: dcy, r: Rd }, Rg, pos, pivot, bob: { y: bobY, r: 13 }, sun: { x: W, y: T.topY + 2, r: Math.min(42, W * 0.11) } };
  }

  // ---------- звук ----------
  let actx = null, bus = null, foldCurve = null, lastSound = 0;
  const lastSteps = [];                                   // [время, шаг] — что сейчас под молоточками
  function build(ctx, input) {
    actx = ctx;
    const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const pre = g(1), out = g(1.8), hallSend = g(0), h = T.hall();
    pre.connect(out); pre.connect(hallSend); hallSend.connect(h.input); h.out.connect(g(0.9)).connect(out);
    bus = { pre, out, hallSend, hall: h, input, live: false };
    const K = 6, n = 2048, c = new Float32Array(n);      // складки: синус от входа × K — чем громче вход, тем больше перегибов
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.sin((Math.PI / 2) * K * x); }
    foldCurve = c;
    applyFx();
  }
  function setLive(on) {
    if (!bus || bus.live === on) return;
    bus.live = on;
    if (on) bus.out.connect(bus.input); else bus.out.disconnect();
  }
  setInterval(() => {
    if (!bus) return;
    if (sounding()) lastSound = performance.now();
    else if (performance.now() - lastSound > 8000) setLive(false);
  }, 1000);
  function applyFx() {
    if (!bus) return;
    const t = actx.currentTime;
    bus.hallSend.gain.setTargetAtTime(fx.hall * fx.hall * 1.4, t, 0.05);
    for (const l of bus.hall.lines) l.g.gain.setTargetAtTime(10 ** ((-3 * l.len) / (1.5 + fx.hall * 4)), t, 0.05);
  }
  const sunHeight = (step) => Math.sin((step / SUN_STEPS) * TAU);   // −1 — полночь, +1 — полдень
  // удар: FM-пара → складки → low pass gate (срез и громкость по одной огибающей, как вактрол)
  // вактрол: быстрый спад и долгий тёмный хвост; срез гаснет медленнее громкости — «бонг», а не просто тише
  function vactrol(tau, M = 160) {
    const D = Math.min(6, tau * 14), e = new Float32Array(M);
    for (let k = 0; k < M; k++) { const t = (k / (M - 1)) * D, w = k > M * 0.85 ? (M - 1 - k) / (M * 0.15) : 1; e[k] = (0.72 * Math.exp(-t / tau) + 0.28 * Math.exp(-t / (tau * 4))) * w; }
    return { e, D };
  }
  const PAN = [-0.45, 0.45, -0.25, 0.25];
  // удар: FM-пара → складки → low pass gate (срез, громкость и индекс FM — по одной нелинейной огибающей вактрола)
  function strike(gi, t, step, vel = 0.85) {
    const g = gears[gi], ctx = actx;
    const mods = [0, 0, 0, 0];                             // fold, index, decay, pitch
    if (g.ramp > 0) mods[g.rampTo] += g.ramp * ((step % g.teeth) / Math.max(1, g.teeth - 1));   // рампа за оборот шестерни: от нуля к вершине, на новом обороте — сброс
    if (fx.fortuna > 0) {                                  // fortuna: изредка пропуск, разная сила и случайное напряжение в цель
      if (Math.random() < fx.fortuna * 0.15) return;
      vel = clamp(vel * (1 - fx.fortuna * 0.3 * Math.random()), 0.2, 1);
      mods[fx.fto] += fx.fortuna * (fx.fmode ? smoothV : chance);
    }
    const fold = clamp(g.fold + fx.sol * 0.6 * sunHeight(step) + mods[0]), f = hzSemi(g.semi + Math.round(mods[3] * 12)), idxK = Math.max(0, 1 + 2 * mods[1]), decK = Math.max(0.2, 1 + 2 * mods[2]);
    const car = ctx.createOscillator(), mod = ctx.createOscillator(), mg = ctx.createGain(), drive = ctx.createGain(), sh = ctx.createWaveShaper(), lp = ctx.createBiquadFilter(), vca = ctx.createGain(), pan = ctx.createStereoPanner();
    car.frequency.value = f; mod.frequency.value = f * g.ratio; mod.type = 'triangle';
    mod.connect(mg).connect(car.frequency);
    drive.gain.value = (1 + fold * 5) / 6; sh.curve = foldCurve; sh.oversample = '2x';
    lp.type = 'lowpass'; lp.Q.value = 1.6; pan.pan.value = PAN[gi];
    const dec = (0.04 + (g.decay * 0.7 + fx.decay * 0.3) ** 1.7 * 1.3) * decK, tau = dec / 3, { e, D } = vactrol(tau), A = 0.0025, peak = 0.34 * g.level * (0.55 + 0.45 * vel);
    const fmax = 1800 + 12000 * vel ** 1.5, fmin = 70, M = e.length, cut = new Float32Array(M), amp = new Float32Array(M), idx = new Float32Array(M), ix = g.index * f * 3 * idxK;
    for (let k = 0; k < M; k++) { const x = e[k]; cut[k] = fmin * (fmax / fmin) ** (x ** 0.7); amp[k] = peak * x ** 1.5; idx[k] = ix * (0.25 + 0.75 * x); }
    amp[M - 1] = 0;
    lp.frequency.setValueAtTime(fmax, t); lp.frequency.setValueCurveAtTime(cut, t + A, D);
    vca.gain.setValueAtTime(0, t); vca.gain.linearRampToValueAtTime(peak, t + A); vca.gain.setValueCurveAtTime(amp, t + A, D);
    mg.gain.setValueAtTime(ix, t); mg.gain.setValueCurveAtTime(idx, t + A, D);
    const end = t + A + D;
    car.connect(drive).connect(sh).connect(lp).connect(vca).connect(pan).connect(bus.pre);
    car.start(t); mod.start(t); car.stop(end + 0.02); mod.stop(end + 0.02);
    car.onended = () => { for (const n of [car, mod, mg, drive, sh, lp, vca, pan]) n.disconnect(); };
    setTimeout(() => { g.hit = performance.now(); }, Math.max(0, (t - ctx.currentTime) * 1000));
    lastSound = performance.now(); setLive(true);
  }
  function schedule() {
    if (!seq.playing || !actx) return;
    const now = actx.currentTime, ahead = now + 0.2;
    if (!seq.next) seq.next = now + 0.05;
    while (seq.next < ahead) {
      if (seq.next > now + 0.003) {                       // опоздавший удар пропускаем — задним числом щёлкает
        chance = Math.random() * 2 - 1;                    // ступень: новое случайное на каждый такт
        if (seq.step % 6 === 0) smoothT = Math.random() * 2 - 1;   // плавное: новая цель раз в шесть тактов, к ней — скольжением
        smoothV += (smoothT - smoothV) * 0.18;
        gears.forEach((g, i) => { const j = seq.step % g.teeth; if (g.pins.has(j)) strike(i, seq.next, seq.step, j === Math.min(...g.pins) ? 1 : 0.78); });   // первый штифт оборота — акцент
        if (fx.fortuna > 0) { const v = fx.fmode ? smoothV : chance; setTimeout(() => { moonA = 0.5 + 0.42 * v; if (!fx.fmode) moonHit = performance.now(); }, Math.max(0, (seq.next - now) * 1000)); }   // луна показывает случайное напряжение
      }
      lastSteps.push([seq.next, seq.step]); if (lastSteps.length > 16) lastSteps.shift();
      seq.step++; seq.next += stepSec();
    }
  }
  setInterval(schedule, 25);
  function play(on = !seq.playing) { seq.playing = on; seq.next = 0; if (on) { setLive(true); schedule(); } }
  function curStep() {                                     // какой шаг сейчас слышен (и сколько от него прошло, 0…1)
    if (!actx || !lastSteps.length) return { s: seq.step, k: 1 };
    const t = actx.currentTime;
    let cur = null;
    for (const [tt, s] of lastSteps) if (tt <= t) cur = [tt, s];
    if (!cur) return { s: lastSteps[0][1] - 1, k: 1 };
    return { s: cur[1], k: clamp((t - cur[0]) / Math.min(0.09, stepSec())) };
  }
  const sounding = () => seq.playing && gears.some((g) => g.pins.size);

  // ---------- касания ----------
  const touches = new Map();
  function gearAt(G, x, y) { for (let i = 0; i < 4; i++) { const [gx, gy] = G.pos[i]; const d = Math.hypot(x - gx, y - gy); if (d < G.Rg + 12) return { i, d }; } return null; }
  function toothAt(G, i, x, y) {
    const g = gears[i], [gx, gy] = G.pos[i], a = (Math.atan2(x - gx, -(y - gy)) + TAU) % TAU, c = curStep();
    return (((Math.round((a / TAU) * g.teeth) + c.s) % g.teeth) + g.teeth) % g.teeth;
  }
  function down(f) {
    const G = geo(), now = performance.now();
    const sw = Math.sin(swingA(now)), bx = G.pivot.x + sw * (G.bob.y - G.pivot.y);
    if (Math.hypot(f.x - bx, f.y - G.bob.y) < G.bob.r + 22 || (Math.abs(f.y - G.dial.y) < G.dial.r * 0.3 && Math.abs(f.x - G.dial.x) < G.dial.r * 0.3)) {   // маятник или середина циферблата — пуск, вбок — темп
      touches.set(f.id, { kind: 'pend', x0: f.x, bpm0: seq.bpm, moved: false }); return;
    }
    const h = gearAt(G, f.x, f.y);
    if (h) {
      if (h.d > G.Rg - 30) { const j = toothAt(G, h.i, f.x, f.y), g = gears[h.i]; if (g.pins.has(j)) g.pins.delete(j); else g.pins.add(j); touches.set(f.id, { kind: 'none' }); return; }   // зубец — штифт
      touches.set(f.id, { kind: 'gear', i: h.i, y0: f.y, x0: f.x, s0: gears[h.i].semi, t0: now, moved: false }); return;
    }
    touches.set(f.id, { kind: 'none' });
  }
  function move(f) {
    const t = touches.get(f.id);
    if (!t || t.kind === 'none' || t.sheet) return;
    if (t.kind === 'pend') {
      if (Math.abs(f.x - t.x0) > 8) t.moved = true;
      if (t.moved) { const b = Math.round(clamp(t.bpm0 + (f.x - t.x0) / 2, 40, 200)); if (b !== seq.bpm) { seq.bpm = b; T.tempoFrom(9, b); } }
      return;
    }
    if (t.kind === 'gear') {                              // вверх-вниз — нота: 9 px на полутон (с ладом — по ступеням)
      if (Math.abs(f.y - t.y0) > 8) t.moved = true;
      if (t.moved) gears[t.i].semi = clamp(Math.round(t.s0 + (t.y0 - f.y) / 9), -24, 24);
    }
  }
  function up(f) {
    const t = touches.get(f.id);
    touches.delete(f.id);
    if (t && t.kind === 'pend' && !t.moved) { play(); T.tempoFrom(9, seq.bpm); }
    if (t && t.kind === 'gear' && t.moved && !seq.playing) strike(t.i, actx ? actx.currentTime + 0.01 : 0, seq.step);   // часы стоят — услышать новую ноту
  }
  function gearSheet(i) {
    const g = gears[i], ti = () => TEETH.indexOf(g.teeth), ri = () => RATIOS.indexOf(g.ratio);
    T.openSheet({
      title: `rota ${ROMAN[i]}`, hint: 'wheel — tap outside to close',
      rows: [{ key: 'teeth', label: 'teeth' }, { key: 'fold', label: 'fold' }, { key: 'ratio', label: 'ratio' }, { key: 'index', label: 'index' }, { key: 'decay', label: 'decay' }, { key: 'level', label: 'level' }, { key: 'ramp', label: 'ramp' }, { key: 'rampTo', label: 'ramp to' }],
      get: (k) => (k === 'teeth' ? ti() / (TEETH.length - 1) : k === 'ratio' ? ri() / (RATIOS.length - 1) : k === 'rampTo' ? g.rampTo / 3 : g[k]),
      set: (k, v) => {
        if (k === 'teeth') { g.teeth = TEETH[Math.round(v * (TEETH.length - 1))]; g.pins = new Set([...g.pins].filter((p) => p < g.teeth)); }
        else if (k === 'ratio') g.ratio = RATIOS[Math.round(v * (RATIOS.length - 1))];
        else if (k === 'rampTo') g.rampTo = Math.round(v * 3);
        else g[k] = v;
      },
      text: (k) => (k === 'teeth' ? `${g.teeth}` : k === 'ratio' ? `${g.ratio} : 1` : k === 'rampTo' ? TARGETS[g.rampTo] : k === 'ramp' && g.ramp < 0.01 ? 'off' : `${Math.round(g[k] * 100)}%`),
    });
  }
  function tick(now) {
    for (const t of touches.values()) if (t.kind === 'gear' && !t.moved && !t.sheet && now - t.t0 > T.HOLD_MS) { t.sheet = true; gearSheet(t.i); }
  }

  // ---------- рисование ----------
  const ink = (a) => `rgba(${INK},${a})`;
  let wallC = null, wallKey = '';
  function wall(G) {                                      // неподвижное: рамка циферблата, 24 часа, деления, горизонт, ось маятника
    const key = `${G.W}x${G.H}x${T.DPR}|${G.dial.y}|${G.Rg}`;
    if (wallC && key === wallKey) return wallC;
    wallKey = key;
    wallC = document.createElement('canvas');
    wallC.width = Math.round(G.W * T.DPR); wallC.height = Math.round(G.H * T.DPR);
    const x = wallC.getContext('2d');
    x.setTransform(T.DPR, 0, 0, T.DPR, 0, 0);
    x.fillStyle = BGC; x.fillRect(0, 0, G.W, G.H);
    const { x: cx, y: cy, r: R } = G.dial;
    x.lineWidth = 1;
    x.strokeStyle = ink(0.8); x.beginPath(); x.arc(cx, cy, R, 0, TAU); x.stroke();
    x.strokeStyle = ink(0.3); x.beginPath(); x.arc(cx, cy, R - 4, 0, TAU); x.stroke();
    x.strokeStyle = ink(0.55); x.beginPath(); x.arc(cx, cy, R - 22, 0, TAU); x.stroke();
    x.font = `${Math.max(8, Math.min(11, R * 0.085))}px ${T.MAP}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = ink(0.75);
    for (let k = 0; k < 24; k++) {                        // 24 часа: римские дважды по кругу
      const a = (k / 24) * TAU, r = R - 13;
      x.save(); x.translate(cx + Math.sin(a) * r, cy - Math.cos(a) * r); x.rotate(a); x.fillText(ROMAN[k % 12], 0, 0); x.restore();
    }
    x.strokeStyle = ink(0.4); x.beginPath();
    for (let k = 0; k < 96; k++) { const a = (k / 96) * TAU, l = k % 4 ? 2 : 4; x.moveTo(cx + Math.sin(a) * (R - 22), cy - Math.cos(a) * (R - 22)); x.lineTo(cx + Math.sin(a) * (R - 22 - l), cy - Math.cos(a) * (R - 22 - l)); }
    x.stroke();
    const ri = R - 26;                                    // горизонт: дуга, ниже — ночь (штриховка), выше — день
    x.save(); x.beginPath(); x.arc(cx, cy, ri, 0, TAU); x.clip();
    x.strokeStyle = ink(0.09); x.beginPath(); for (let y = cy + ri * 0.15; y < cy + ri; y += 4) { x.moveTo(cx - ri, y); x.lineTo(cx + ri, y); } x.stroke();
    x.restore();
    x.strokeStyle = ink(0.5); x.beginPath(); x.moveTo(cx - ri, cy + ri * 0.15); x.quadraticCurveTo(cx, cy - ri * 0.05, cx + ri, cy + ri * 0.15); x.stroke();
    x.font = `italic 10px ${T.MAP}`; x.fillStyle = ink(0.35); x.fillText('ORTUS', cx - ri * 0.62, cy + ri * 0.3); x.fillText('OCCASUS', cx + ri * 0.62, cy + ri * 0.3);
    x.strokeStyle = ink(0.35); x.setLineDash([2, 4]); x.beginPath(); x.arc(cx, cy - ri * 0.22, ri * 0.62, 0, TAU); x.stroke(); x.setLineDash([]);   // эклиптика — смещённый круг
    x.fillStyle = ink(0.7); x.beginPath(); x.arc(G.pivot.x, G.pivot.y, 3, 0, TAU); x.fill();
    return wallC;
  }
  const swingA = (now) => { if (!seq.playing || !actx) return 0; const c = curStep(), ph = c.s + c.k; return 0.04 * Math.cos(Math.PI * ph); };
  function drawGear(c, G, i, now) {                       // шестерня: мелкие зубцы обода, гнёзда шагов по кругу (штифт — залито), колокольчик сверху
    const g = gears[i], [gx, gy] = G.pos[i], R = G.Rg, n = g.teeth, cs = curStep();
    const ease = seq.playing ? 1 - (1 - cs.k) ** 3 : 1, rot = -((cs.s - 1 + ease) / n) * TAU;   // за такт — на шаг, рывком, как спуск часов
    const m = n * Math.max(2, Math.round(30 / n)), tw = (TAU / m) * 0.25, hit = clamp(1 - (now - g.hit) / 300);
    c.lineWidth = 1; c.strokeStyle = ink(0.8); c.fillStyle = BGC;
    c.beginPath();
    for (let j = 0; j < m; j++) {
      const a = rot + (j / m) * TAU;
      for (const [aa, rr] of [[a - tw * 1.3, R - 5], [a - tw * 0.7, R], [a + tw * 0.7, R], [a + tw * 1.3, R - 5]]) { const px = gx + Math.sin(aa) * rr, py = gy - Math.cos(aa) * rr; j || aa !== a - tw * 1.3 ? c.lineTo(px, py) : c.moveTo(px, py); }
    }
    c.closePath(); c.fill(); c.stroke();
    c.strokeStyle = ink(0.3); c.beginPath(); c.arc(gx, gy, R - 8, 0, TAU); c.stroke();
    c.beginPath(); c.arc(gx, gy, R - 22, 0, TAU); c.stroke();
    const sp = Math.max(3, Math.min(8, Math.round(g.ratio * 2)));   // спицы — отношение FM
    const rv = g.ramp > 0 ? g.ramp * (((cs.s % n) + n) % n) / Math.max(1, n - 1) : 0;   // рампа: спицы светлеют за оборот
    c.strokeStyle = ink(0.45 + 0.5 * rv); c.lineWidth = 1 + rv; c.beginPath();
    for (let k = 0; k < sp; k++) { const a = rot + (k / sp) * TAU + 0.2; c.moveTo(gx + Math.sin(a) * R * 0.17, gy - Math.cos(a) * R * 0.17); c.lineTo(gx + Math.sin(a) * (R - 22), gy - Math.cos(a) * (R - 22)); }
    c.stroke();
    c.lineWidth = 1; c.strokeStyle = ink(0.7); c.beginPath(); c.arc(gx, gy, R * 0.17, 0, TAU); c.stroke();
    c.beginPath(); c.arc(gx, gy, 2.5, 0, TAU); c.stroke();
    for (let j = 0; j < n; j++) {                         // гнёзда шагов; штифт — залитое
      const a = rot + (j / n) * TAU, px = gx + Math.sin(a) * (R - 15), py = gy - Math.cos(a) * (R - 15), aa = ((a % TAU) + TAU) % TAU, top = aa < 0.15 || aa > TAU - 0.15;
      if (g.pins.has(j)) { c.fillStyle = ink(top && hit > 0 ? 1 : 0.85); c.beginPath(); c.arc(px, py, 4.2, 0, TAU); c.fill(); }
      else { c.strokeStyle = ink(0.35); c.beginPath(); c.arc(px, py, 3, 0, TAU); c.stroke(); }
    }
    const bx = gx, by = gy - R - 13, sw = hit * 0.35;      // колокольчик над шестернёй: качнулся и светится, когда бьёт
    c.save(); c.translate(bx, by - 6); c.rotate(Math.sin(now * 0.03) * sw);
    c.fillStyle = BGC; c.strokeStyle = ink(0.6 + 0.4 * hit); c.beginPath();
    c.moveTo(-8, 10); c.quadraticCurveTo(-7, 2, -5, -1); c.quadraticCurveTo(0, -8, 5, -1); c.quadraticCurveTo(7, 2, 8, 10); c.closePath(); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(-9, 10.5); c.lineTo(9, 10.5); c.stroke();
    c.fillStyle = ink(0.8); c.beginPath(); c.arc(0, 12.5, 1.8, 0, TAU); c.fill();
    c.restore();
    c.fillStyle = ink(0.6); c.beginPath(); c.moveTo(gx - 3, gy - R - 1); c.lineTo(gx + 3, gy - R - 1); c.lineTo(gx, gy - R + 4); c.closePath(); c.fill();   // собачка: место удара
    if (hit > 0) T.glowAt(bx, by, 18, hit * 0.45);
  }
  function drawDial(c, G, now) {
    const { x: cx, y: cy, r: R } = G.dial, cs = curStep(), step = cs.s + (seq.playing ? cs.k : 0), ri = R - 26;
    const sa = (step / SUN_STEPS) * TAU + Math.PI, sx = cx + Math.sin(sa) * ri * 0.78, sy = cy - Math.cos(sa) * ri * 0.78;   // солнце: полдень наверху
    c.strokeStyle = ink(0.75); c.lineWidth = 1.2; c.beginPath(); c.moveTo(cx, cy); c.lineTo(sx, sy); c.stroke();
    const sr = 6 + 3 * fx.sol;
    c.fillStyle = BGC; c.beginPath(); c.arc(sx, sy, sr, 0, TAU); c.fill(); c.strokeStyle = ink(0.9); c.lineWidth = 1; c.stroke();
    c.beginPath(); for (let k = 0; k < 12; k++) { const a = (k / 12) * TAU; c.moveTo(sx + Math.cos(a) * (sr + 2), sy + Math.sin(a) * (sr + 2)); c.lineTo(sx + Math.cos(a) * (sr + 5 + 3 * fx.sol), sy + Math.sin(a) * (sr + 5 + 3 * fx.sol)); } c.stroke();
    const ma = moonA * TAU, mx = cx + Math.sin(ma) * ri * 0.52, my = cy - Math.cos(ma) * ri * 0.52, jump = clamp(1 - (now - moonHit) / 400);   // луна — fortuna: прыгает
    c.strokeStyle = ink(0.45 + 0.4 * fx.fortuna); c.beginPath(); c.moveTo(cx, cy); c.lineTo(mx, my); c.stroke();
    c.fillStyle = ink(0.85); c.beginPath(); c.arc(mx, my, 5, 0, TAU); c.fill(); c.fillStyle = BGC; c.beginPath(); c.arc(mx + 2.3, my - 1, 4.4, 0, TAU); c.fill();
    if (jump > 0) T.glowAt(mx, my, 14, jump * 0.3);
    c.fillStyle = ink(0.9); c.beginPath(); c.arc(cx, cy, 3.5, 0, TAU); c.fill();
  }
  function drawPendulum(c, G, now) {
    const a = swingA(now), L = G.bob.y - G.pivot.y, bx = G.pivot.x + Math.sin(a) * L, by = G.pivot.y + Math.cos(a) * L;
    c.strokeStyle = ink(0.6); c.lineWidth = 1; c.beginPath(); c.moveTo(G.pivot.x, G.pivot.y); c.lineTo(bx, by); c.stroke();
    c.fillStyle = BGC; c.strokeStyle = ink(0.9); c.beginPath(); c.arc(bx, by, G.bob.r, 0, TAU); c.fill(); c.stroke();
    c.strokeStyle = ink(0.35); c.beginPath(); c.arc(bx, by, G.bob.r - 4, 0, TAU); c.stroke();
    if (!seq.playing) { c.fillStyle = ink(0.8); c.beginPath(); c.moveTo(bx - 3, by - 5); c.lineTo(bx + 5, by); c.lineTo(bx - 3, by + 5); c.closePath(); c.fill(); }   // стоит — знак пуска
    for (const t of touches.values()) if (t.kind === 'pend') T.mapText(`${seq.bpm} bpm`, bx, by + G.bob.r + 14, 13, 0.85, 'center');
  }
  let noSun = false;
  function draw(now) {
    const c = T.g, G = geo();
    c.drawImage(wall(G), 0, 0, T.W, T.H);
    drawDial(c, G, now);
    drawPendulum(c, G, now);
    for (let i = 0; i < 4; i++) drawGear(c, G, i, now);
    for (const t of touches.values()) {                   // подписи — пока трогаешь шестерню
      if (t.kind !== 'gear') continue;
      const g = gears[t.i], [gx, gy] = G.pos[t.i], f = hzOf(g);
      T.mapText(`${noteName(f)} · ${Math.round(f)} Hz`, gx, gy + G.Rg + 16, 13, 0.9, 'center');
    }
    if (!noSun) T.quarterSun(c, G.sun.x, G.sun.y, G.sun.r, -1, now, INK, BGC);
  }

  // ---------- мир ----------
  const deg = (d) => (d * Math.PI) / 180;
  const fxw = {
    sectors: [{ key: 'sol', label: 'sol', ang: deg(190) }, { key: 'fortuna', label: 'fortuna', ang: deg(160) }, { key: 'fmode', label: 'fortuna mode', ang: deg(140) }, { key: 'fto', label: 'fortuna to', ang: deg(120) }, { key: 'decay', label: 'decay', ang: deg(100) }, { key: 'hall', label: 'hall', ang: deg(80) }],
    get: (k) => (k === 'fto' ? fx.fto / 3 : fx[k]), set: (k, v) => { if (k === 'fmode') fx.fmode = v >= 0.5 ? 1 : 0; else if (k === 'fto') fx.fto = Math.round(v * 3); else fx[k] = v; applyFx(); },
    text: (k) => (k === 'fmode' ? (fx.fmode ? 'smooth' : 'stepped') : k === 'fto' ? TARGETS[fx.fto] : `${Math.round(fx[k] * 100)}%`),
    arc: () => fx.hall, save: () => ({ ...fx }), load: (o) => { Object.assign(fx, o); applyFx(); },
  };
  function dice() {                                       // зубцы — вразброс (полиритм), штифты по Евклиду, ноты — ступени, тембры — случайно; часы идут
    const R = Math.random, euclid = (k, n) => { const s = []; for (let i = 0; i < n; i++) if (Math.floor((i * k) / n) !== Math.floor(((i - 1) * k) / n)) s.push(i); return s; };
    gears.forEach((g) => {
      g.teeth = TEETH[Math.floor(R() * 10)]; const k = 1 + Math.floor(R() * Math.max(1, g.teeth / 2)), rot = Math.floor(R() * g.teeth);
      g.pins = new Set(euclid(k, g.teeth).map((p) => (p + rot) % g.teeth));
      g.semi = [-12, -5, 0, 3, 7, 10, 12, 15][Math.floor(R() * 8)]; g.fold = R() * 0.8; g.ratio = RATIOS[Math.floor(R() * RATIOS.length)]; g.index = R() * 0.8; g.decay = 0.1 + R() * 0.7; g.ramp = R() < 0.4 ? 0.3 + R() * 0.5 : 0; g.rampTo = Math.floor(R() * 4);
    });
    if (!seq.playing) play(true);
  }
  const horo = {
    n: 'IX', title: 'Horologium', sub: 'rotae · horae', theme: { ink: INK, bg: BGC, paper: PAPER },
    corner: { hit: (f) => { const G = geo(); return f.y > G.sun.y && Math.hypot(f.x - G.sun.x, f.y - G.sun.y) < G.sun.r + 6; }, draw: () => {} },   // солнце — карта
    fx: fxw,
    legend: [['tap', 'tap the pendulum', 'clock runs / stops'], ['drag', 'drag the pendulum sideways', 'tempo'],
      ['tap', 'tap a tooth', 'a pin · at the top the hammer strikes'], ['up', 'drag a wheel up or down', 'its note'],
      ['hold', 'hold a wheel', 'its sheet: teeth, fold, ratio, index, decay, level, ramp'], ['tap', 'tap the sun', 'map of worlds']],
    build, tick, draw, down, move, up, dice,
    clear() { for (const g of gears) g.pins.clear(); },
    snapshot: () => JSON.stringify({ g: gears.map((g) => ({ ...g, pins: [...g.pins], hit: 0 })), fx, bpm: seq.bpm }),
    restore(js) {
      const st = JSON.parse(js);
      st.g.forEach((q, i) => Object.assign(gears[i], q, { pins: new Set(q.pins) }));
      Object.assign(fx, st.fx); seq.bpm = st.bpm; applyFx();
    },
    sounding, tempo: { set: (bpm) => { seq.bpm = bpm; } }, mapShot(on) { noSun = on; },
  };
  T.registerWorld(9, horo);
  window.t2d.horo = {
    gears, fx, seq, geo, setFx: (k, v) => fxw.set(k, v), play, get live() { return !!(bus && bus.live); }, hz: hzOf,
    tooth: (i, j) => { const G = geo(), c = curStep(), g = gears[i], a = ((j - c.s) / g.teeth) * TAU, [gx, gy] = G.pos[i], r = G.Rg - 15; return { x: gx + Math.sin(a) * r, y: gy - Math.cos(a) * r }; },
    bob: () => { const G = geo(), a = swingA(performance.now()), L = G.bob.y - G.pivot.y; return { x: G.pivot.x + Math.sin(a) * L, y: G.pivot.y + Math.cos(a) * L }; },
  };
})();
