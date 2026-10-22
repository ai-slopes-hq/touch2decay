// Paradisus — картинка и касания: девять небесных сфер (эллипсы) вокруг Небесной розы, светлая тема — слоновая кость и золото.
// Касание → действие модели (звук не трогает); что услышано (heard) — зёрна на розе (glitter) и вспышки над ангелами (flashes).
import { NAMES, VOW, harm, vowelAt, vowelName } from './model.js';

const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const INK = '94,69,32', BGC = '#f5efe1', PAPER = '245,239,225', GOLD = [176, 131, 44], LIGHT = [201, 154, 60];
const HALO = { a: [6.5, 2.2], e: [5, 2.6], i: [2.4, 4.2], o: [3.6, 3.6], u: [2.2, 2.2] };   // нимб — форма гласной
const NOTES = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];

// ---------- геометрия: девять эллипсов-сфер вокруг розы, выше по экрану — шире ----------
export function geo(T) {
  const W = T.W, H = T.H, top = T.topY + 6, bot = H - T.safeBot - 8, h = bot - top, cx = W / 2, cy = top + h * 0.48, Ws = Math.min(W, (H - T.safeBot) * 0.62);   // сферы — высокие: на широком экране сцена по центру
  const RX = Ws / 2 - 14, RY = Math.min(cy - top - 10, bot - cy - 10), rx0 = Ws * 0.13, ry0 = rx0 * 1.6;
  const sph = NAMES.map((_, k) => ({ rx: rx0 + ((RX - rx0) * k) / 8, ry: ry0 + ((RY - ry0) * k) / 8 }));
  return { W, H, top, bot, cx, cy, sph, rose: rx0 * 0.72, light: { x: W, y: H - T.safeBot, r: Math.min(100, Ws * 0.26) } };
}
export const angleAt = (G, k, x, y) => { const s = G.sph[k]; return (Math.atan2((x - G.cx) / s.rx, -(y - G.cy) / s.ry) + TAU) % TAU; };
export const vOf = (ang) => (ang / TAU) * 5;
export function sphereAt(G, x, y) {                     // ближайшая сфера (по расстоянию до эллипса вдоль луча из центра)
  const dx = x - G.cx, dy = y - G.cy, r = Math.hypot(dx, dy);
  let best = -1, bd = 1e9;
  G.sph.forEach((s, k) => { const rho = Math.hypot(dx / s.rx, dy / s.ry), d = Math.abs(r - r / Math.max(rho, 1e-6)); if (d < bd) { bd = d; best = k; } });
  return bd < 30 ? best : -1;
}
export function anglePos(G, k, v) { const s = G.sph[k], a = (v / 5) * TAU; return { x: G.cx + Math.sin(a) * s.rx, y: G.cy - Math.cos(a) * s.ry }; }

export function createView(T, model) {
  const { angels, fx } = model.state;
  const G0 = () => geo(T);
  let openness = 0, flashes = [], glitter = [];   // раскрытие розы; вспышки над ангелами { t, x, y }; зёрна на розе { t, a, r }

  function heard(e) {                                   // что услышано: зерно — искра на розе, планета над ангелом — вспышка
    if (e.t === 'grain') glitter.push({ t: performance.now(), a: Math.random() * TAU, r: Math.random() });
    else if (e.t === 'chime') { const p = anglePos(G0(), e.a.k, e.a.v); flashes.push({ t: performance.now(), x: p.x, y: p.y }); }
  }

  // ---------- касания ----------
  const touches = new Map();
  let lastTap = null;
  function angelNear(G, x, y) {
    let best = null, bd = 26;
    for (const a of angels) if (a.pinned) { const p = anglePos(G, a.k, a.v), d = Math.hypot(x - p.x, y - p.y); if (d < bd) { bd = d; best = a; } }
    return best;
  }
  function down(f) {
    const G = G0(), now = performance.now();
    if (Math.hypot(f.x - G.cx, f.y - G.cy) < G.rose) {  // роза — россыпь зёрен
      model.rose();
      touches.set(f.id, { kind: 'none' }); return;
    }
    const near = angelNear(G, f.x, f.y);
    if (near) {
      if (lastTap && lastTap.a === near && now - lastTap.t < T.DTAP_MS) {   // двойной тап по закреплённому — отпустить
        lastTap = null; model.release(near, 0.6);
        touches.set(f.id, { kind: 'none' }); return;
      }
      lastTap = { a: near, t: now, x: f.x, y: f.y };
      touches.set(f.id, { kind: 'angel', a: near, t0: now, x: f.x, y: f.y, x0: f.x, y0: f.y });
      return;
    }
    const k = sphereAt(G, f.x, f.y);
    if (k < 0) { touches.set(f.id, { kind: 'none' }); return; }
    const v = vOf(angleAt(G, k, f.x, f.y));
    if (lastTap && !lastTap.a && now - lastTap.t < T.DTAP_MS && Math.hypot(f.x - lastTap.x, f.y - lastTap.y) < 34 && model.addAngel(k, v, true)) {   // двойной тап — ангел остаётся (до PIN_MAX)
      lastTap = null;
      touches.set(f.id, { kind: 'none' }); return;
    }
    lastTap = { a: null, t: now, x: f.x, y: f.y };
    const a = model.addAngel(k, v);                     // поёт, пока держишь
    touches.set(f.id, { kind: 'angel', a, temp: true, t0: now, x: f.x, y: f.y, x0: f.x, y0: f.y });
  }
  function move(f) {
    const t = touches.get(f.id);
    if (!t || t.kind !== 'angel' || t.sheet) return;
    t.x = f.x; t.y = f.y;
    if (Math.hypot(f.x - t.x0, f.y - t.y0) < 6 && !t.moved) return;
    t.moved = true;
    const G = G0(), k = sphereAt(G, f.x, f.y), a = t.a, k1 = k >= 0 ? k : a.k;   // поперёк — на ближайшую сферу (гармонику)
    model.moveAngel(a, k1, vOf(angleAt(G, k1, f.x, f.y)));   // вдоль — гласная
  }
  function up(f) {
    const t = touches.get(f.id);
    touches.delete(f.id);
    if (!t || t.kind !== 'angel') return;
    if (t.temp && !t.a.pinned) model.release(t.a, 0.5);
  }
  // держишь закреплённого ангела, не двигая, — его плашка: хор, расстройка, вибрато, дыхание, регистр
  function angelSheet(a) {
    T.openSheet({
      title: `${NAMES[a.k]} · ${harm(a.k)}`, hint: 'angel — tap outside to close',
      rows: [{ key: 'singers', label: 'choir' }, { key: 'detune', label: 'detune' }, { key: 'vib', label: 'vibrato' }, { key: 'breath', label: 'breath' }, { key: 'reg', label: 'register' }],
      get: (k) => (k === 'singers' ? (a.singers - 0.5) / 5 : k === 'reg' ? (a.reg + 0.5) / 3 : a[k]),
      set: (k, v) => model.setAngel(a, k, v),
      text: (k) => (k === 'singers' ? `${a.singers} ${a.singers === 1 ? 'voice' : 'voices'}` : k === 'reg' ? ['octave down', 'natural', 'octave up'][a.reg] : `${Math.round(a[k] * 100)}%`),
    });
  }
  function tick(now, dt) {                              // зёрна и вспышки гаснут; роза раскрывается с хором (dt — шаг кадра хоста, с)
    if (glitter.length) glitter = glitter.filter((q) => now - q.t < 900);
    if (flashes.length) flashes = flashes.filter((q) => now - q.t < 1200);
    const lv = angels.reduce((x, a) => x + a.lvl, 0) / 3 + fx.gloria * 0.3;
    openness += (clamp(lv) - openness) * (1 - Math.exp(-dt / 1.2));
  }

  // ---------- рисование ----------
  let wallC = null, wallKey = '';
  function wall(G) {                                    // фон: слоновая кость, лучи от розы, сферы с точками-звёздами, божественный свет в углу
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
    x.strokeStyle = rgba(GOLD, 1); x.beginPath(); x.arc(G.cx, G.cy, 4.5, 0, TAU); x.stroke();
    x.fillStyle = rgba(GOLD, 1); x.beginPath(); x.arc(G.cx, G.cy, 1.6, 0, TAU); x.fill();
    x.strokeStyle = rgba(GOLD, 0.7); x.beginPath();       // божественный свет — четверть сияния из угла
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
  function angel(c, x, y, sing, held) {                 // ангел штрихом: крылья, тело, голова; поёт — темнее
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
    const c = T.g, G = G0();
    c.drawImage(wall(G), 0, 0, T.W, T.H);
    if (fx.shimmer > 0.05) {                            // shimmer — лучи от розы ярче
      c.strokeStyle = rgba(LIGHT, fx.shimmer * 0.25 * (0.8 + 0.2 * Math.sin(now * 0.002))); c.lineWidth = 1; c.beginPath();
      for (let j = 0; j < 18; j++) { const a = (j / 18) * TAU + now * 0.00005; c.moveTo(G.cx + Math.cos(a) * 44, G.cy + Math.sin(a) * 70); c.lineTo(G.cx + Math.cos(a) * 300, G.cy + Math.sin(a) * 480); }
      c.stroke();
    }
    for (let t = 0; t < 4; t++) {                        // Небесная роза: ярусы лепестков, раскрываются с хором
      const [r, n, op] = [[1, 16, 0.5], [0.76, 12, 0.65], [0.53, 9, 0.8], [0.3, 6, 0.9]][t], R = G.rose * r * (0.88 + 0.28 * openness), o = openness;
      c.strokeStyle = T.ink(op); c.lineWidth = 1;
      for (let j = 0; j < n; j++) {
        const a = (j / n) * TAU + t * 0.2 + o * 0.15 * (t % 2 ? 1 : -1), ri = R * (0.62 - 0.12 * o), sp = (Math.PI / n) * (0.8 + 0.3 * o), a1 = a - sp, a2 = a + sp;
        c.beginPath(); c.moveTo(G.cx + Math.cos(a1) * ri, G.cy + Math.sin(a1) * ri * 1.12);
        c.quadraticCurveTo(G.cx + Math.cos(a) * (R + 3), G.cy + Math.sin(a) * (R + 3) * 1.12, G.cx + Math.cos(a2) * ri, G.cy + Math.sin(a2) * ri * 1.12); c.stroke();
      }
    }
    if (fx.orbits > 0.01) G.sph.forEach((sp, k) => {    // планеты на сферах
      const u = model.planetAt(k) * TAU, x = G.cx + Math.sin(u) * sp.rx, y = G.cy - Math.cos(u) * sp.ry, al = 0.35 + 0.5 * Math.min(1, fx.orbits * 2);
      c.fillStyle = BGC; c.beginPath(); c.arc(x, y, 4, 0, TAU); c.fill();
      c.strokeStyle = rgba(GOLD, al); c.lineWidth = 1; c.beginPath(); c.arc(x, y, 4, 0, TAU); c.stroke();
      c.fillStyle = rgba(GOLD, al); c.beginPath(); c.arc(x, y, 1.6, 0, TAU); c.fill();
    });
    for (const q of flashes) { const k = 1 - (performance.now() - q.t) / 1200; c.strokeStyle = rgba(LIGHT, 0.6 * k); c.lineWidth = 1; c.beginPath(); for (let j = 0; j < 8; j++) { const a = (j / 8) * TAU, r0 = 14, r1 = 14 + 14 * (1 - k); c.moveTo(q.x + Math.cos(a) * r0, q.y - 8 + Math.sin(a) * r0); c.lineTo(q.x + Math.cos(a) * r1, q.y - 8 + Math.sin(a) * r1); } c.stroke(); }
    for (const q of glitter) {                          // зёрна Gloria вспыхивают на розе
      const k = 1 - (now - q.t) / 900, r = G.rose * (0.3 + q.r * 0.9);
      c.fillStyle = rgba(GOLD, 0.9 * k); c.beginPath(); c.arc(G.cx + Math.cos(q.a) * r, G.cy + Math.sin(q.a) * r * 1.12, 1.2 + k, 0, TAU); c.fill();
    }
    const held = new Set([...touches.values()].filter((t) => t.kind === 'angel').map((t) => t.a));
    for (const a of angels) {
      const p = anglePos(G, a.k, a.v), h = held.has(a);
      c.save(); c.translate(p.x, p.y); c.scale(1.35, 1.35);   // ангел крупнее штриха сфер — под палец и на глаз
      angel(c, 0, 0, a.lvl, h);
      halo(c, 0, 0, model.vEff(a), a.pinned, 0.5 + 0.5 * a.lvl);
      c.restore();
    }
    for (const a of held) {                             // подписи — только пока трогаешь
      const p = anglePos(G, a.k, a.v), right = p.x < G.cx, ax = p.x + (right ? 30 : -30), al = right ? 'left' : 'right';
      T.mapText(`${NAMES[a.k]} · ${harm(a.k)}`, ax, p.y - 6, 15, 0.95, al);
      const f = model.hzOf(a), m = Math.round(12 * Math.log2(f / 55));
      T.mapText(`${vowelName(a.v)} · ${NOTES[((m % 12) + 12) % 12]} · ${Math.round(f)} Hz`, ax, p.y + 11, 12, 0.75, al);
    }
    for (const t of touches.values()) if (t.kind === 'angel' && !t.temp && !t.sheet && !t.moved && now - t.t0 > T.HOLD_MS) { t.sheet = true; angelSheet(t.a); }   // держишь закреплённого — плашка
  }

  // ---------- плашка FX, легенда, угол ----------
  const deg = (d) => (d * Math.PI) / 180;
  const fxw = {
    sectors: [
      { key: 'shimmer', label: 'shimmer', ang: deg(200) },
      { key: 'gloria', label: 'gloria', ang: deg(170) },
      { key: 'aether', label: 'aether', ang: deg(140) },
      { key: 'vibrato', label: 'vibrato', ang: deg(110) },
      { key: 'orbits', label: 'orbits', ang: deg(80) },
    ],
    get: (k) => fx[k], set: (k, v) => model.setFx(k, v), text: (k) => (k === 'orbits' && fx.orbits <= 0.01 ? 'off' : `${Math.round(fx[k] * 100)}%`),
    lfo: { keys: ['shimmer', 'gloria', 'vibrato', 'orbits'], shapes: 'classic' },   // aether — без LFO: пересчёт отзвука собора тяжёлый
    arc: () => fx.aether, save: () => ({ ...fx }), load: (o) => model.loadFx(o),
  };
  const legend = [['tap', 'touch a sphere', 'an angel sings while held'], ['drag', 'drag along a sphere', 'the vowel: a, e, i, o, u'],
    ['drag', 'drag across', 'to another sphere — another harmonic'], ['double', 'double tap', 'the angel stays and sings · again — let go'],
    ['hold', 'hold a staying angel', 'its sheet: choir, detune, vibrato, breath, register'], ['tap', 'tap the rose', 'a shower of grains'],
    ['tap', 'tap the light', 'map of worlds']];
  const corner = { hit: (f) => { const L = G0().light; return Math.hypot(f.x - L.x, f.y - L.y) < L.r; }, draw: () => {} };   // божественный свет — карта

  return {
    theme: { ink: INK, bg: BGC, paper: PAPER }, corner, fx: fxw, legend,
    down, move, up, tick, draw, heard,
    get glitter() { return glitter.length; }, get flashes() { return flashes.length; }, get open() { return openness; },
  };
}
