// Monochordum — картинка и касания: монохорд мира Роберта Фладда (1617), струны от Земли (внизу) к руке Бога в облаке (вверху).
// Касание → действие модели (звук не трогает); энергия струн — из model.state (её пишет engine); что услышано (heard) — удар автострама.
import { N, MARKS, NODES, DIVS, PATTERNS } from './model.js';

const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const NOTES = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];
const INTERVALS = [[1, 1 / 2, 'diapason'], [1, 2 / 3, 'diapente'], [2 / 3, 1 / 2, 'diatessaron'], [1 / 2, 1 / 4, 'diapason'], [1 / 2, 1 / 3, 'diapente']];
const RATIO_NAMES = new Map([[1, '1 : 1'], [8 / 9, '9 : 8 · tonus'], [3 / 4, '4 : 3 · diatessaron'], [2 / 3, '3 : 2 · diapente'], [1 / 2, '2 : 1 · diapason'], [1 / 3, '3 : 1'], [1 / 4, '4 : 1 · disdiapason']]);
const noteOf = (f) => { const m = Math.round(12 * Math.log2(f / 55)); return `${NOTES[((m % 12) + 12) % 12]}${Math.floor((m + 9) / 12) + 1}`; };

// ---------- геометрия: длинный ящик монохорда по центру, струны сверху вниз; слева — сферы, справа — дуги интервалов ----------
export function geo(T) {
  const W = T.W, H = T.H, top = T.topY + 6, bot = H - T.safeBot - 8, Ws = Math.min(W, (H - T.safeBot) * 0.62), cx = W / 2;
  const y0 = top + 40, y1 = bot - 64, sp = Math.min(44, Ws * 0.11);   // y0 — колки (рука Бога), y1 — нижний порожек (Земля)
  const xs = Array.from({ length: N }, (_, i) => cx + (i - (N - 1) / 2) * sp);
  const box = { x0: xs[0] - sp * 0.7, x1: xs[N - 1] + sp * 0.7 }, ye = y0 + 0.25 * (y1 - y0);   // ye — Эмпирей, верхний лад
  const r = Math.max(28, Math.min(60, (W - box.x1) * 0.36)), hx = Math.min(box.x1 + (W - box.x1) / 2, box.x1 + r * 1.7);
  const ar = Math.max(16, Math.min(28, box.x0 * 0.3)), aeolus = { x: Math.max(ar * 1.3, box.x0 - ar * 2.4), y: y0 + (ye - y0) * 0.55, r: ar };   // роза ветров — слева над Эмпиреем
  return { W, H, Ws, top, bot, cx, y0, y1, xs, sp, box, hand: { x: hx, y: y0 + (ye - y0) * 0.45, r }, aeolus };   // облако — справа над дугами интервалов
}
export const yOfR = (G, r) => G.y0 + r * (G.y1 - G.y0);   // подставка: звучит от колков (y0) до неё
export const rOfY = (G, y) => clamp((y - G.y0) / (G.y1 - G.y0), 0.25, 1);
export function stringAt(G, x, y) {
  if (y < G.y0 - 10 || y > G.y1 + 14) return -1;
  let best = -1, bd = G.sp / 2 + 4;
  G.xs.forEach((sx, i) => { const d = Math.abs(x - sx); if (d < bd) { bd = d; best = i; } });
  return best;
}
export const earthG = (G) => ({ x: G.cx, y: G.y1 + 96, r: Math.min(70, G.Ws * 0.2) });   // Земля внизу: верх шара с горами

export function createView(T, model) {
  const { str, fx, auto } = model.state, S = model.state;
  const G0 = () => geo(T);
  let hitAt = 0, rot = 0;                               // удар автострама (performance.now) и поворот Земли — только для картинки
  function heard(e) { if (e.hit) hitAt = performance.now(); }

  function earthSheet() {
    T.openSheet({
      title: 'terra', hint: 'the earth strums — tap outside to close',
      rows: [{ key: 'bpm', label: 'tempo' }, { key: 'div', label: 'rate' }, { key: 'pattern', label: 'pattern' }, { key: 'strength', label: 'strength' }, { key: 'swing', label: 'swing' }],
      lfo: { id: 'mono-earth', keys: ['strength', 'swing'], shapes: 'classic' },
      get: (k) => (k === 'bpm' ? (auto.bpm - 40) / 160 : k === 'div' ? (auto.div + 0.5) / 4 : k === 'pattern' ? (auto.pattern + 0.5) / 4 : auto[k]),
      set: (k, v) => {
        if (k === 'bpm') { model.setBpm(Math.round(40 + v * 160)); T.tempoFrom(7, auto.bpm); } else if (k === 'div') model.setAutoPar('div', Math.min(3, Math.floor(v * 4))); else if (k === 'pattern') model.setAutoPar('pattern', Math.min(3, Math.floor(v * 4))); else model.setAutoPar(k, v);
      },
      text: (k) => (k === 'bpm' ? `${auto.bpm} bpm` : k === 'div' ? DIVS[auto.div][1] : k === 'pattern' ? PATTERNS[auto.pattern] : `${Math.round(auto[k] * 100)}%`),
    });
  }

  // ---------- касания ----------
  const touches = new Map();
  let lastTap = null;
  function down(f) {
    const A = G0().aeolus;
    if (Math.hypot(f.x - A.x, f.y - A.y) < A.r * 1.5) { touches.set(f.id, { kind: 'wind', y0: f.y, w0: S.wind, moved: false, t0: performance.now() }); return; }   // голова ветра: вверх — сильнее, тап — вкл/выкл
    const G = G0(), i = stringAt(G, f.x, f.y), now = performance.now(), E = earthG(G);
    if (f.y > G.y1 + 16 && Math.abs(f.x - E.x) < E.r + 10 && f.y > E.y - E.r - 16) { touches.set(f.id, { kind: 'earth', t0: now, moved: false }); return; }   // Земля: тап — автострам, держишь — плашка
    const free = () => touches.set(f.id, f.y > G.y0 - 10 && f.y < G.y1 + 14 ? { kind: 'strum', px: f.x, lt: now } : { kind: 'none' });   // мимо струн — можно начать страм
    if (i < 0) { free(); return; }
    const yb = yOfR(G, str[i].r);
    if (Math.abs(f.y - yb) < 20) { touches.set(f.id, { kind: 'bridge', i, x0: f.x, y0: f.y }); return; }   // подставка — высота
    if (f.y > yb) { free(); return; }                     // ниже подставки струна заглушена
    if (lastTap && lastTap.i === i && now - lastTap.t < T.DTAP_MS) {   // двойной тап — струна поёт сама (Эолова)
      lastTap = null; model.toggleSus(i);
      touches.set(f.id, { kind: 'none' }); return;
    }
    lastTap = { i, t: now };
    const nd = NODES.find(([u]) => Math.abs(f.y - (G.y0 + u * (yb - G.y0))) < 7);
    if (nd) model.harm(i, nd[1], 0.9);                    // тап на узле — флажолет
    else model.pluck(i, (f.y - G.y0) / Math.max(10, yb - G.y0));
    touches.set(f.id, { kind: 'string', i, x0: f.x, y0: f.y, x: f.x, y: f.y, t0: now, lx: f.x, lt: now, moved: false, px: f.x });
  }
  const BOW_WAIT = 150;                                   // мс: столько палец решает — смычок или страм
  function strum(t, f, G) {                               // страм: каждая струна, которую палец пересёк выше её подставки, — щипок; сила — скорость
    const now = performance.now(), a = Math.min(t.px, f.x), b = Math.max(t.px, f.x), v = (b - a) / Math.max(8, now - (t.st || t.lt));
    let hit = false;
    G.xs.forEach((sx, i) => {
      if (sx <= a || sx > b || (t.kind === 'string' && i === t.i && !t.strum)) return;
      const yb = yOfR(G, str[i].r);
      if (f.y > yb - 4 || f.y < G.y0 - 10) return;
      model.pluck(i, (f.y - G.y0) / Math.max(10, yb - G.y0), clamp(0.35 + v * 0.6, 0.3, 1)); hit = true;
    });
    t.px = f.x; t.st = now;
    return hit;
  }
  function move(f) {
    const t = touches.get(f.id);
    if (!t || t.kind === 'none' || t.sheet) return;
    if (t.kind === 'wind') { if (t.sheet) return; if (Math.abs(f.y - t.y0) > 6) t.moved = true; if (t.moved) model.setWind(t.w0 + (t.y0 - f.y) / 140); return; }
    const G = G0();
    if (t.kind === 'bridge') { model.setBridge(t.i, rOfY(G, f.y)); t.y = f.y; return; }
    if (t.kind === 'strum') { strum(t, f, G); return; }
    if (strum(t, f, G) || t.strum) {                      // ушёл на соседнюю струну — это уже страм, смычок снят
      if (!t.strum) { t.strum = true; if (str[t.i].bow > 0) model.bow(t.i, 0); }
      t.moved = true; t.x = f.x; t.y = f.y; return;
    }
    t.x = f.x; t.y = f.y;
    if (!t.moved && Math.hypot(f.x - t.x0, f.y - t.y0) > 8) t.moved = true;
    if (t.moved) {                                        // поперёк струны — смычок: сила — скорость пальца
      const now = performance.now(), dx = f.x - t.lx, v = Math.abs(dx) / Math.max(8, now - t.lt);
      t.lx = f.x; t.lt = now;
      if (!t.bowing) {                                    // смычок — только если задержался у струны или повёл назад; быстро ушёл к соседней — это страм
        const turn = t.dir && dx && Math.sign(dx) !== t.dir;
        if (!t.dir && Math.abs(dx) > 1) t.dir = Math.sign(dx);
        if (!turn && now - t.t0 < BOW_WAIT) return;
        t.bowing = true;
      }
      model.bow(t.i, clamp(v * 1.4));
    }
  }
  function up(f) {
    const t = touches.get(f.id);
    touches.delete(f.id);
    if (t && t.kind === 'wind' && !t.moved && !t.sheet) model.toggleWind();
    if (t && t.kind === 'earth' && !t.sheet) model.setAuto(!auto.on);
    if (t && t.kind === 'string' && str[t.i].bow > 0) model.bow(t.i, 0);
  }
  function windSheet() {                                  // держишь розу ветров — плашка ветра; «~» со случайной формой — порывы
    T.openSheet({
      title: 'ventus', hint: 'wind — tap outside to close', rows: [{ key: 'wind', label: 'wind' }],
      lfo: { id: 'mono-wind', keys: ['wind'], shapes: 'random' },
      get: () => S.wind, set: (k, v) => model.setWind(v), text: () => (S.wind > 0.01 ? `${Math.round(S.wind * 100)}%` : 'calm'),
    });
  }
  function tick(now) {
    for (const t of touches.values()) if (t.kind === 'earth' && !t.sheet && now - t.t0 > T.HOLD_MS) { t.sheet = true; earthSheet(); }
    for (const t of touches.values()) if (t.kind === 'wind' && !t.moved && !t.sheet && now - t.t0 > T.HOLD_MS) { t.sheet = true; windSheet(); }
    for (const t of touches.values()) {
      if (t.kind !== 'string' || t.moved) continue;
      const s = str[t.i];
      if (s.bow > 0 && now - t.lt > 120) model.bow(t.i, s.bow * 0.8);
    }
  }
  function stringSheet(i) {
    const s = str[i];
    T.openSheet({
      title: `chorda ${['I', 'II', 'III', 'IV'][i]}`, hint: 'string — tap outside to close',
      rows: [{ key: 'pitch', label: 'pitch' }, { key: 'bright', label: 'brightness' }, { key: 'decay', label: 'decay' }, { key: 'level', label: 'level' }],
      lfo: { id: `mono-s${i}`, keys: ['pitch', 'bright', 'decay', 'level'], shapes: 'classic' },   // «~» на pitch — вибрато подставки
      get: (k) => (k === 'pitch' ? Math.log2(1 / s.r) / 2 : s[k]),
      set: (k, v) => model.setString(i, k, v),
      text: (k) => (k === 'pitch' ? noteOf(model.hzOf(i)) : `${Math.round(s[k] * 100)}%`),
    });
  }

  // ---------- рисование ----------
  let wallC = null, wallKey = '';
  function wall(G) {                                      // ящик монохорда, лады, сферы слева, дуги интервалов справа, Земля внизу
    const key = `${G.W}x${G.H}x${T.DPR}|${G.y0}|${G.y1}`;
    if (wallC && key === wallKey) return wallC;
    wallKey = key;
    wallC = document.createElement('canvas');
    wallC.width = Math.round(G.W * T.DPR); wallC.height = Math.round(G.H * T.DPR);
    const x = wallC.getContext('2d');
    x.setTransform(T.DPR, 0, 0, T.DPR, 0, 0);
    x.fillStyle = T.BG; x.fillRect(0, 0, G.W, G.H);
    const ink = (a) => `rgba(237,237,237,${a})`, B = G.box;
    x.strokeStyle = ink(0.6); x.lineWidth = 1; x.strokeRect(B.x0 + 0.5, G.y0 - 18.5, B.x1 - B.x0, G.y1 - G.y0 + 40);
    x.strokeStyle = ink(0.2); x.strokeRect(B.x0 + 4.5, G.y0 - 14.5, B.x1 - B.x0 - 8, G.y1 - G.y0 + 32);
    const ry = G.y1 - (G.y1 - G.y0) * 0.12, rr = (B.x1 - B.x0) * 0.22;   // розетка — голосник деки
    x.strokeStyle = ink(0.35); x.beginPath(); x.arc(G.cx, ry, rr, 0, TAU); x.stroke(); x.beginPath(); x.arc(G.cx, ry, rr * 0.7, 0, TAU); x.stroke();
    for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; x.beginPath(); x.arc(G.cx + Math.cos(a) * rr * 0.45, ry + Math.sin(a) * rr * 0.45, rr * 0.25, 0, TAU); x.stroke(); }
    x.font = `italic 11px ${T.MAP}`; x.textBaseline = 'middle';
    MARKS.forEach(([r, name], j) => {                   // лады: засечки поперёк ящика, слева — сферы
      const y = yOfR(G, r), major = [1, 3 / 4, 2 / 3, 1 / 2, 1 / 3, 1 / 4].includes(r);
      x.strokeStyle = ink(major ? 0.45 : 0.2); x.beginPath(); x.moveTo(B.x0, y + 0.5); x.lineTo(B.x0 - (major ? 10 : 5), y + 0.5); x.moveTo(B.x1, y + 0.5); x.lineTo(B.x1 + (major ? 10 : 5), y + 0.5); x.stroke();
      x.fillStyle = ink(r === 1 / 2 || r === 1 || r === 1 / 4 ? 0.7 : 0.42); x.textAlign = 'right'; x.fillText(name, B.x0 - 14, y);
      if (j === 7) { x.strokeStyle = ink(0.3); x.setLineDash([2, 4]); x.beginPath(); x.moveTo(B.x0, y + 0.5); x.lineTo(B.x1, y + 0.5); x.stroke(); x.setLineDash([]); }   // Солнце — середина: граница двух октав
    });
    INTERVALS.forEach(([a, b, name], k) => {             // дуги интервалов справа, как у Фладда
      const ya = yOfR(G, a), yb = yOfR(G, b), off = 16 + (k % 3) * 14, xr = B.x1 + off;
      x.strokeStyle = ink(0.35); x.beginPath(); x.moveTo(B.x1 + 4, ya); x.quadraticCurveTo(xr + 18, (ya + yb) / 2, B.x1 + 4, yb); x.stroke();
      x.save(); x.translate(xr + 8, (ya + yb) / 2); x.rotate(-Math.PI / 2); x.textAlign = 'center'; x.fillStyle = ink(0.45); x.font = `italic 10px ${T.MAP}`; x.fillText(name, 0, 0); x.restore();
    });
    return wallC;
  }
  function drawHand(c, G, now) {                          // облако справа от колков, из него — рука Бога, держит колок крайней струны
    const { x: hx, y: hy, r } = G.hand, K = 11, pts = [];
    for (let k = 0; k < K; k++) { const a = (k / K) * TAU, q = 1 + 0.12 * Math.sin(k * 2.7); pts.push([hx + Math.cos(a) * r * q, hy + Math.sin(a) * r * 0.62 * q]); }
    const scallop = (P, push) => { c.beginPath(); c.moveTo(P[0][0], P[0][1]); for (let k = 0; k < P.length; k++) { const p0 = P[k], p1 = P[(k + 1) % P.length], mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2; c.quadraticCurveTo(hx + (mx - hx) * push, hy + (my - hy) * push, p1[0], p1[1]); } c.closePath(); };
    const px = G.xs[N - 1], py = G.y0 - 8, sx = hx - r * 0.75, sy = hy - r * 0.05;   // рука: рукав из облака к колку, манжета, кисть обхватывает колок
    const ax = px + 22, ay = py + 2, nx = -(ay - sy), ny = ax - sx, nl = Math.hypot(nx, ny), ux = nx / nl, uy = ny / nl, wv = 6;
    const mx = (sx + ax) / 2 + 10, my = (sy + ay) / 2 + 4;
    c.lineWidth = 1; c.strokeStyle = T.ink(0.8); c.fillStyle = T.BG;
    c.beginPath(); c.moveTo(sx + ux * wv, sy + uy * wv); c.quadraticCurveTo(mx + ux * wv, my + uy * wv, ax + ux * wv * 0.7, ay + uy * wv * 0.7);
    c.lineTo(ax - ux * wv * 0.7, ay - uy * wv * 0.7); c.quadraticCurveTo(mx - ux * wv, my - uy * wv, sx - ux * wv, sy - uy * wv); c.closePath(); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(ax + ux * wv * 0.9, ay + uy * wv * 0.9); c.lineTo(ax - ux * wv * 0.9, ay - uy * wv * 0.9); c.stroke();   // манжета
    c.beginPath(); c.ellipse(px + 13, py + 2, 8, 6, 0.3, 0, TAU); c.fill(); c.stroke();                        // кисть
    c.strokeStyle = T.ink(0.85); c.beginPath();                                                                 // пальцы на колке
    for (let k = 0; k < 3; k++) { const y = py - 2 + k * 3; c.moveTo(px + 8, y); c.quadraticCurveTo(px + 1, y - 2.5, px - 3, y + 1); }
    c.stroke();
    c.strokeStyle = T.ink(0.8); c.fillStyle = T.BG; scallop(pts, 1.55); c.fill(); c.stroke();
    c.strokeStyle = T.ink(0.18); scallop(pts.map(([x, y]) => [hx + (x - hx) * 0.6, hy + (y - hy) * 0.6 + r * 0.1]), 1.4); c.stroke();
  }
  let roseA = 0, roseT = 0;
  function drawAeolus(c, G, now, held) {                  // роза ветров, как на старых картах: с ветром крутится и дует струями на струны
    const { x, y, r } = G.aeolus, w = S.wind, dt = roseT ? Math.min(0.1, (now - roseT) / 1000) : 0;
    roseT = now; roseA += dt * w * 1.6;
    c.lineWidth = 1; c.fillStyle = T.BG;
    c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
    c.strokeStyle = T.ink(held ? 0.95 : 0.7); c.beginPath(); c.arc(x, y, r, 0, TAU); c.stroke();
    c.strokeStyle = T.ink(0.3); c.beginPath(); c.arc(x, y, r - 3, 0, TAU); c.stroke();
    c.strokeStyle = T.ink(0.45); c.beginPath();                                           // деления по кругу — 32 румба
    for (let k = 0; k < 32; k++) { const a = (k / 32) * TAU + roseA, l = k % 4 ? 2 : 4; c.moveTo(x + Math.cos(a) * (r - 3), y + Math.sin(a) * (r - 3)); c.lineTo(x + Math.cos(a) * (r - 3 - l), y + Math.sin(a) * (r - 3 - l)); }
    c.stroke();
    const ray = (a, len, wd, al) => {                    // луч розы: ромб, одна половина залита, другая — контур
      const tx = x + Math.cos(a) * len, ty = y + Math.sin(a) * len, l1 = a - Math.PI / 2, l2 = a + Math.PI / 2;
      const ax = x + Math.cos(l1) * wd, ay = y + Math.sin(l1) * wd, bx = x + Math.cos(l2) * wd, by = y + Math.sin(l2) * wd;
      c.fillStyle = T.ink(al); c.beginPath(); c.moveTo(x, y); c.lineTo(ax, ay); c.lineTo(tx, ty); c.closePath(); c.fill();
      c.fillStyle = T.BG; c.beginPath(); c.moveTo(x, y); c.lineTo(bx, by); c.lineTo(tx, ty); c.closePath(); c.fill();
      c.strokeStyle = T.ink(al); c.beginPath(); c.moveTo(ax, ay); c.lineTo(tx, ty); c.lineTo(bx, by); c.stroke();
    };
    for (let k = 0; k < 4; k++) ray(roseA + Math.PI / 4 + (k * Math.PI) / 2, r * 0.55, r * 0.13, 0.55);   // короткие — между сторонами света
    for (let k = 0; k < 4; k++) ray(roseA + (k * Math.PI) / 2, r * 0.86, r * 0.17, 0.85);                  // длинные — стороны света
    c.fillStyle = T.BG; c.beginPath(); c.arc(x, y, r * 0.09, 0, TAU); c.fill(); c.strokeStyle = T.ink(0.85); c.stroke();
    if (w > 0.01) {                                       // струи ветра от розы к струнам: длиннее, ярче и быстрее с силой
      const mx = x + r + 4, len = (G.box.x1 - mx) * (0.35 + 0.65 * w);
      c.strokeStyle = T.ink(0.12 + 0.45 * w); c.lineWidth = 1; c.beginPath();
      for (let k = -2; k <= 2; k++) {
        const ph = (now * 0.0004 * (1 + w * 3) + (k + 2) * 0.23) % 1, sl = k * 0.09, x0 = mx + ph * len * 0.6, y0 = y + k * 6 + Math.tan(sl) * (x0 - mx);
        c.moveTo(x0, y0); c.bezierCurveTo(x0 + 14, y0 - 4, x0 + 22, y0 + 4, x0 + 30 + 20 * w, y0 + Math.tan(sl) * 30);
      }
      c.stroke();
    }
    if (held) T.mapText(`ventus · ${Math.round(w * 100)}%`, x, y + r + 14, 12, 0.8, 'center');
  }
  let earthT = 0;
  function drawEarth(c, G, now) {                         // автострам вкл — Земля вращается, горы бегут; удар — вспыхивает горизонт
    const E = earthG(G), dt = earthT ? Math.min(0.1, (now - earthT) / 1000) : 0;
    earthT = now;
    if (auto.on) rot += dt * (auto.bpm / 60) * 0.6;
    const hit = clamp(1 - (now - hitAt) / 220);
    c.lineWidth = 1; c.strokeStyle = T.ink(auto.on ? 0.75 + 0.25 * hit : 0.5); c.beginPath(); c.arc(E.x, E.y, E.r, Math.PI * 1.08, Math.PI * 1.92); c.stroke();
    if (auto.on) { c.strokeStyle = T.ink(0.25); c.beginPath(); c.arc(E.x, E.y, E.r + 4, Math.PI * 1.08, Math.PI * 1.92); c.stroke(); }
    c.strokeStyle = T.ink(auto.on ? 0.6 : 0.3); c.beginPath();
    for (let k = 0; k < 14; k++) {                         // горы на шаре: при вращении ползут слева направо
      const a = Math.PI * 1.1 + ((((k / 14 + rot * 0.15) % 1) + 1) % 1) * Math.PI * 0.8, px = E.x + Math.cos(a) * E.r, py = E.y + Math.sin(a) * E.r, h = 5 + (k % 3) * 2;
      const nx = Math.cos(a), ny = Math.sin(a), tx = -ny, ty = nx;
      c.moveTo(px - tx * 5, py - ty * 5); c.lineTo(px + nx * h, py + ny * h); c.lineTo(px + tx * 5, py + ty * 5);
    }
    c.stroke();
    if (hit > 0) T.glowAt(E.x, E.y - E.r, 30, hit * 0.25);
  }
  function draw(now) {
    const c = T.g, G = G0();
    c.drawImage(wall(G), 0, 0, T.W, T.H);
    if (fx.body > 0.05) T.glowAt(G.cx, G.y1 - (G.y1 - G.y0) * 0.12, 40, fx.body * 0.12);   // дека отзывается — розетка светится
    const held = new Map();
    for (const t of touches.values()) if (t.kind === 'bridge' || t.kind === 'string') held.set(t.i, t);
    str.forEach((s, i) => {
      const x = G.xs[i], yb = yOfR(G, s.r), amp = Math.min(9, s.en * 60), h = held.has(i);
      c.fillStyle = T.ink(0.85); c.beginPath(); c.arc(x, G.y0 - 8, 3, 0, TAU); c.fill();   // колок
      c.strokeStyle = T.ink(0.3); c.lineWidth = 1; c.beginPath(); c.moveTo(x, yb); c.lineTo(x, G.y1 + 6); c.stroke();   // заглушенная часть — ниже подставки
      c.strokeStyle = T.ink(s.sus ? 1 : 0.85); c.lineWidth = s.sus ? 1.6 : 1.2; c.beginPath();   // звучащая часть: стоячая волна — размах по энергии
      const n = 40, ph = now * 0.09 + i;
      const ah = Math.min(7, s.eh * 60);                  // флажолет: стоячая волна с узлами
      for (let k = 0; k <= n; k++) { const u = k / n, y = G.y0 + u * (yb - G.y0), dx = amp * (Math.sin(Math.PI * u) * Math.sin(ph) * 0.7 + Math.sin(TAU * u) * Math.sin(ph * 1.7 + i) * 0.3) + ah * Math.sin(s.hn * Math.PI * u) * Math.sin(ph * s.hn * 0.7); k ? c.lineTo(x + dx, y) : c.moveTo(x + dx, y); }
      c.stroke();
      c.fillStyle = T.ink(h || ah > 0.5 ? 0.6 : 0.22);    // узлы флажолетов — точки на звучащей части
      for (const [u, m] of NODES) { const y = G.y0 + u * (yb - G.y0), on = ah > 0.5 && Math.abs(u * s.hn - Math.round(u * s.hn)) < 1e-6; c.beginPath(); c.arc(x, y, on ? 2.6 : 1.6, 0, TAU); c.fill(); }
      if (s.sus) { c.strokeStyle = T.ink(0.25); c.lineWidth = 6; c.beginPath(); c.moveTo(x, G.y0); c.lineTo(x, yb); c.stroke(); }
      c.fillStyle = T.BG; c.strokeStyle = T.ink(h ? 1 : 0.85); c.lineWidth = 1.2;   // подставка — треугольник
      c.beginPath(); c.moveTo(x - 9, yb + 7); c.lineTo(x, yb - 4); c.lineTo(x + 9, yb + 7); c.closePath(); c.fill(); c.stroke();
      c.fillStyle = T.ink(0.85); c.beginPath(); c.arc(x, G.y1 + 6, 2.2, 0, TAU); c.fill();   // нижний порожек
    });
    str.forEach((s, i) => {                               // сфера Фладда под подставкой загорается, пока струна звучит
      const e = Math.min(1, (s.en + s.eh) * 25);
      if (e < 0.05) return;
      let best = null, bd = 0.02;
      for (const m of MARKS) { const d = Math.abs(Math.log2(m[0] / s.r)); if (d < bd) { bd = d; best = m; } }
      if (!best) return;
      const y = yOfR(G, best[0]), x = G.box.x0 - 14;
      const sx = x + 8, cc = T.g;                                     // звёздочка между подписью и ящиком — лучи по силе звука
      cc.strokeStyle = T.ink(0.3 + 0.6 * e); cc.lineWidth = 1; cc.beginPath();
      for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU, l = k % 2 ? 2.5 : 4 + 2 * e; cc.moveTo(sx + Math.cos(a) * 1.5, y + Math.sin(a) * 1.5); cc.lineTo(sx + Math.cos(a) * l, y + Math.sin(a) * l); }
      cc.stroke();
      T.mapText(best[1], x, y, 11, 0.45 + 0.55 * e, 'right');
    });
    for (const [i, t] of held) {                          // подписи — только пока трогаешь
      if (t.kind !== 'bridge') continue;
      const s = str[i], f = model.hzOf(i), nm = RATIO_NAMES.get(s.r) || (MARKS.find((m) => m[0] === s.r) || [])[1] || '';
      const rx = G.box.x0 - 14, ry = G.y0 + 30;           // пустое место над Эмпиреем, слева: палец закрывает подставку
      T.mapText(`${noteOf(f)} · ${Math.round(f)} Hz`, rx, ry, 15, 0.95, 'right');
      if (nm) T.mapText(nm, rx, ry + 18, 11, 0.6, 'right');
    }
    drawEarth(c, G, now);
    drawHand(c, G, now);
    drawAeolus(c, G, now, [...touches.values()].some((t) => t.kind === 'wind'));
    for (const t of touches.values()) if (t.kind === 'string' && !t.moved && !t.sheet && now - t.t0 > T.HOLD_MS) { t.sheet = true; stringSheet(t.i); }   // держишь струну — плашка
  }

  // ---------- FX, легенда, угол ----------
  const deg = (d) => (d * Math.PI) / 180;
  const fxw = {
    sectors: [
      { key: 'decay', label: 'decay', ang: deg(200) }, { key: 'bright', label: 'brightness', ang: deg(170) }, { key: 'body', label: 'body', ang: deg(140) },
      { key: 'sympathy', label: 'sympathy', ang: deg(125) }, { key: 'chorus', label: 'chorus', ang: deg(110) }, { key: 'chance', label: 'chance', ang: deg(95) }, { key: 'hall', label: 'hall', ang: deg(80) },
    ],
    get: (k) => fx[k], set: (k, v) => model.setFx(k, v), text: (k) => `${Math.round(fx[k] * 100)}%`,
    lfo: { keys: ['decay', 'bright', 'body', 'sympathy', 'chorus', 'chance', 'hall'], shapes: 'classic' },
    arc: () => fx.hall, save: () => ({ ...fx }), load: (o) => model.loadFx(o),
  };
  const legend = [['tap', 'tap a string above its bridge', 'pluck · near the end — bright'], ['drag', 'stroke back and forth on a string', 'bow it · speed — pressure'], ['draw', 'sweep across the strings', 'strum · speed — strength'],
    ['up', 'drag a bridge', 'pitch · sticks to Pythagorean frets'], ['tap', 'tap a dot on a string', 'harmonic (flageolet) · 1/2, 1/3, 1/4'], ['double', 'double tap a string', 'it sings by itself, like an Aeolian harp'],
    ['hold', 'hold a string', 'its sheet: pitch, brightness, decay, level · ~ — LFO, vibrato'], ['up', 'drag the wind rose up', 'wind · every string sings · tap — on / off · hold — gusts'], ['tap', 'tap the earth', 'it strums by itself in tempo · hold — rate, pattern'], ['tap', 'tap the cloud', 'map of worlds']];
  const corner = { hit: (f) => { const h = G0().hand; return Math.hypot(f.x - h.x, f.y - h.y) < h.r * 1.1; }, draw: () => {} };   // рука Бога в облаке — карта

  return { corner, fx: fxw, legend, down, move, up, tick, draw, heard };
}
