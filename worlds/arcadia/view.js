// Arcadia — картинка и касания: гравированная карта холмистой страны в псевдоперспективе, как в Natura — горизонт сверху, ближе к нам крупнее.
// Касание → действие модели (звук не трогает); центры петель и уровни — метры engine (только чтение).
import { ASP, K, Q1, SEMIS, FIGS, PATHS, figPt, dist } from './model.js';
const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const INK = '40,46,32', PAPER = '224,221,198', BGC = `rgb(${PAPER})`, WATER = [46, 86, 104];   // гравюра на зеленоватой бумаге
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const NOTES = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];
const noteName = (f) => { const m = Math.round(12 * Math.log2(f / 55)); return `${NOTES[((m % 12) + 12) % 12]}${Math.floor((m + 9) / 12) + 1}`; };

// ---------- геометрия: u — поперёк (ширина не сходится), v — вглубь: v = −1 у нижней рамки, v = 1 на горизонте; K — сила перспективы ----------
export function geo(T) {
  const W = T.W, H = T.H, top = T.topY + 6, bot = H - T.safeBot - 8, Ws = Math.min(W, (H - T.safeBot) * 0.62), cx = W / 2;
  const fx0 = cx - Ws / 2 + 7, fx1 = cx + Ws / 2 - 7, Wh = (fx1 - fx0) / 2 - 10;
  const hor = top + Math.max(64, (bot - top) * 0.17), gb = bot - 40;
  return { W, H, top, bot, cx, Ws, fx0, fx1, Wh, hor, gb, EL: (gb - hor) * 0.14, sun: { x: W, y: T.topY + 2, r: Math.min(42, W * 0.11) } };
}
export function proj(G, u, v) { const t = (v + 1) / 2, q = 1 / (1 + K * t); return { x: G.cx + u * G.Wh, y: G.hor + ((G.gb - G.hor) * (q - Q1)) / (1 - Q1), s: q }; }
export function unproj(G, x, y) { const q = Q1 + clamp((y - G.hor) / (G.gb - G.hor)) * (1 - Q1); return { u: (x - G.cx) / G.Wh, v: 2 * ((1 / q - 1) / K) - 1 }; }
const lift = (G, zAt, u, v, s) => Math.max(0, zAt(u, v)) * G.EL * s;   // земля поднимается холмами
export function at(G, zAt, u, v) { const p = proj(G, u, v); p.y -= lift(G, zAt, u, v, p.s); return p; }
export function pick(G, zAt, x, y) {                     // что под пальцем: луч от нас вглубь до первой земли, что выше точки
  const u = clamp((x - G.cx) / G.Wh, -1, 1);
  for (let k = 0; k <= 300; k++) { const v = -1 + (2 * k) / 300; if (at(G, zAt, u, v).y <= y) return { u, v }; }
  return null;                                            // небо
}
export function loopPts(G, zAt, t, c, n = 72) {          // петля на земле: по кругу (восьмёркой, узлом), поднята холмами; c — центр из worklet
  const cc = c || [t.u, t.v, t.r], r = cc[2] || t.r, out = [];
  for (let k = 0; k <= n; k++) { const [du, dv] = figPt(t.fig, (k / n) * TAU), u = cc[0] + r * du, v = cc[1] + (r * dv) / ASP; out.push(at(G, zAt, u, v)); }
  return out;
}

export function createView(T, model, engine) {
  const { travellers, fx } = model.state;
  const zAt = model.zAt, lakeAt = model.lakeAt, hzOf = model.hzOf, root = model.root;
  const G0 = () => geo(T);
  const atG = (G, u, v) => at(G, zAt, u, v);
  const loopOf = (G, t, n) => loopPts(G, zAt, t, engine.centers[t.slot], n);

  // ---------- касания ----------
  const touches = new Map();
  const flagAt = (G, t) => atG(G, t.u, t.v);
  function homeAt(G, x, y) {                                // флажок странника: древко над точкой
    let best = null, bd = 24;
    for (const t of travellers) { const p = flagAt(G, t), d = Math.min(Math.hypot(x - p.x, y - p.y), Math.hypot(x - p.x - 4, y - p.y + 14)); if (d < bd) { bd = d; best = t; } }
    return best;
  }
  function rimAt(G, x, y) {                                 // край петли: тянешь — шире или уже
    for (const t of travellers) { if (t.r < 0.06) continue; for (const p of loopOf(G, t, 48)) if (Math.hypot(x - p.x, y - p.y) < 12) return t; }
    return null;
  }
  function down(f) {
    const G = G0(), now = performance.now(), h = homeAt(G, f.x, f.y), rim = rimAt(G, f.x, f.y);
    const hd = h ? Math.hypot(f.x - flagAt(G, h).x, f.y - flagAt(G, h).y) : 99;
    if (rim && hd > 12) { touches.set(f.id, { kind: 'rim', t: rim, x0: f.x, y0: f.y }); return; }   // край петли важнее, если не прямо во флажок
    if (h) { touches.set(f.id, { kind: 'home', t: h, x0: f.x, y0: f.y, t0: now, moved: false }); return; }
    const q = f.x > G.fx0 && f.x < G.fx1 && f.y < G.bot ? pick(G, zAt, f.x, f.y) : null;
    if (q) {
      const t = model.addT(q.u, clamp(q.v, -0.98, 0.98));
      touches.set(f.id, t ? { kind: 'home', t, x0: f.x, y0: f.y, t0: now, moved: false, fresh: true } : { kind: 'none' });
      return;
    }
    touches.set(f.id, { kind: 'none' });
  }
  function move(f) {
    const t = touches.get(f.id);
    if (!t || t.kind === 'none' || t.sheet) return;
    const G = G0();
    if (t.kind === 'rim') {
      const q = unproj(G, f.x, f.y), c = engine.centers[t.t.slot] || [t.t.u, t.t.v];
      model.setT(t.t, { r: clamp(dist(c[0], c[1], q.u, q.v), 0.03, 0.6) }); return;
    }
    if (Math.hypot(f.x - t.x0, f.y - t.y0) > 8) t.moved = true;
    if (!t.moved) return;
    const q = pick(G, zAt, clamp(f.x, G.fx0, G.fx1), Math.max(f.y, G.hor - 30)) || unproj(G, f.x, G.hor);
    model.moveT(t.t, clamp(q.u, -0.98, 0.98), clamp(q.v, -0.98, 0.98));
  }
  function up(f) {
    const t = touches.get(f.id);
    touches.delete(f.id);
    if (t && t.kind === 'home' && !t.moved && !t.fresh && !t.sheet && performance.now() - t.t0 < 300 && travellers.includes(t.t)) model.dropT(t.t);   // тап по страннику — уходит
  }
  const lfoId = (t) => `arc-t${t.slot}-${t.id}`;
  function tSheet(t) {
    T.openSheet({
      title: 'viator', hint: 'wanderer — tap outside to close',
      rows: [{ key: 'oct', label: 'octave' }, { key: 'r', label: 'orbit' }, { key: 'fig', label: 'figure' }, { key: 'mode', label: 'path' }, { key: 'sp', label: 'range' }, { key: 'lvl', label: 'level' }],
      lfo: { id: lfoId(t), keys: ['r', 'sp', 'lvl'], shapes: 'random' },   // «~» на orbit — петля дышит, тембр то проще, то богаче
      get: (k) => (k === 'oct' ? (t.oct + 1) / 2 : k === 'r' ? (t.r - 0.03) / 0.57 : k === 'fig' ? t.fig / 2 : k === 'mode' ? t.mode / 4 : k === 'sp' ? t.sp / 0.6 : t.lvl),
      set: (k, v) => model.setT(t, { [k]: k === 'oct' ? Math.round(v * 2) - 1 : k === 'r' ? 0.03 + v * 0.57 : k === 'fig' ? Math.round(v * 2) : k === 'mode' ? Math.round(v * 4) : k === 'sp' ? v * 0.6 : v }, k === 'mode'),
      text: (k) => (k === 'oct' ? ['octave −1', 'octave 0', 'octave +1'][t.oct + 1] : k === 'fig' ? FIGS[t.fig] : k === 'mode' ? PATHS[t.mode] : k === 'r' ? `${Math.round(t.r * 100)}%` : `${Math.round((k === 'sp' ? t.sp / 0.6 : t.lvl) * 100)}%`),
    });
  }
  function tick(now) {                                      // держишь странника — его плашка
    for (const t of touches.values()) if (t.kind === 'home' && !t.moved && !t.sheet && !t.fresh && now - t.t0 > T.HOLD_MS) { t.sheet = true; tSheet(t.t); }
  }

  // ---------- рисование: гравюра — горы и холмы рядами от горизонта к нам, леса, озёра штриховкой, реки ----------
  const ink = (a) => `rgba(${INK},${a})`;
  let wallC = null, wallKey = '';
  function mountain(x, X, Y, h, w, s, lean, snow) {          // гора: два склона к вершине, правый в тени — штрихи, на высоких — снег
    const px = X + lean * w * 0.15, py = Y - h;
    x.fillStyle = `rgb(${PAPER})`; x.strokeStyle = ink(0.85); x.lineWidth = 0.7 + 0.5 * s;
    x.beginPath(); x.moveTo(X - w / 2, Y); x.quadraticCurveTo(X - w * 0.2, Y - h * 0.45, px, py); x.quadraticCurveTo(X + w * 0.18, Y - h * 0.5, X + w / 2, Y); x.fill(); x.stroke();
    x.lineWidth = 0.5 + 0.3 * s; x.strokeStyle = ink(0.55); x.beginPath();
    const n = 2 + Math.round(5 * s);
    for (let k = 1; k <= n; k++) { const f = k / (n + 1), ex = px + (X + w / 2 - px) * f, ey = py + (Y - py) * f; x.moveTo(ex - 0.8, ey + 0.5); x.lineTo(ex - w * 0.12 * (1 - f * 0.4), Y - 0.5); }
    x.stroke();
    if (snow) { x.strokeStyle = ink(0.7); x.beginPath(); x.moveTo(px - h * 0.18, py + h * 0.24); x.lineTo(px - h * 0.07, py + h * 0.16); x.lineTo(px, py + h * 0.26); x.lineTo(px + h * 0.08, py + h * 0.17); x.lineTo(px + h * 0.17, py + h * 0.25); x.stroke(); }
  }
  function hill(x, X, Y, h, w, s) {                         // холм: горб, тень двумя дужками справа
    x.fillStyle = `rgb(${PAPER})`; x.strokeStyle = ink(0.72); x.lineWidth = 0.6 + 0.4 * s;
    x.beginPath(); x.moveTo(X - w / 2, Y); x.quadraticCurveTo(X - w * 0.05, Y - h * 2, X + w / 2, Y); x.fill(); x.stroke();
    x.strokeStyle = ink(0.4); x.lineWidth = 0.5; x.beginPath();
    for (const f of [0.55, 0.78]) { x.moveTo(X + w * (f - 0.5) * 0.9, Y - h * (1 - f) * 1.5); x.quadraticCurveTo(X + w * (f - 0.45), Y - h * (1 - f) * 0.6, X + w * (f - 0.42), Y - 0.3); }
    x.stroke();
  }
  function tree(x, X, Y, s, fir) {                          // дерево: ель — треугольник ярусами, лиственное — крона кругом со штрихом тени
    const h = 4 + 9 * s;
    x.strokeStyle = ink(0.75); x.lineWidth = 0.5 + 0.4 * s; x.fillStyle = `rgb(${PAPER})`;
    if (fir) {
      x.beginPath(); x.moveTo(X, Y - h); x.lineTo(X + h * 0.32, Y - h * 0.15); x.lineTo(X - h * 0.32, Y - h * 0.15); x.closePath(); x.fill(); x.stroke();
      x.beginPath(); x.moveTo(X, Y - h * 0.15); x.lineTo(X, Y); x.stroke();
      return;
    }
    x.beginPath(); x.moveTo(X, Y); x.lineTo(X, Y - h * 0.45); x.stroke();
    x.beginPath(); x.arc(X, Y - h * 0.62, h * 0.32, 0, TAU); x.fill(); x.stroke();
    x.strokeStyle = ink(0.4); x.beginPath(); x.arc(X, Y - h * 0.62, h * 0.2, -0.6, 0.9); x.stroke();
  }
  function tuft(x, X, Y, s) {
    x.strokeStyle = ink(0.32); x.lineWidth = 0.5; x.beginPath();
    for (const d of [-1, 0, 1]) { x.moveTo(X + d * 0.6, Y); x.quadraticCurveTo(X + d * 1.2 * s, Y - 3 * s, X + d * 2.6 * s, Y - (5 - Math.abs(d)) * s); }
    x.stroke();
  }
  const forest = (u, v, sd) => 0.6 * Math.sin(3.1 * u + sd) * Math.sin(2.7 * v * ASP + sd * 1.3) + 0.4 * Math.sin(7.3 * u - 1 + sd) * Math.sin(6.1 * v * ASP + 2);
  function wall(G) {
    const land = model.state.land, pcs = T.scalePCs, key = `${G.W}x${G.H}x${T.DPR}|${G.hor}|${G.gb}|${G.Wh}|${land.seed}|${pcs ? pcs.join(',') : '-'}|${root()}`;
    if (wallC && key === wallKey) return wallC;
    wallKey = key;
    wallC = document.createElement('canvas');
    wallC.width = Math.round(G.W * T.DPR); wallC.height = Math.round(G.H * T.DPR);
    const x = wallC.getContext('2d');
    x.setTransform(T.DPR, 0, 0, T.DPR, 0, 0);
    x.fillStyle = `rgb(${PAPER})`; x.fillRect(0, 0, G.W, G.H);
    let sd = (land.seed % 2147483646) + 1; const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
    x.fillStyle = ink(0.05); for (let i = 0; i < 260; i++) { x.beginPath(); x.arc(rnd() * G.W, rnd() * G.H, rnd() * 1.1, 0, TAU); x.fill(); }   // крап старой бумаги
    const { fx0, fx1, hor, gb } = G, b = G.bot;
    x.save(); x.beginPath(); x.rect(fx0 + 6, G.top - 4, fx1 - fx0 - 12, b - G.top - 2); x.clip();
    x.strokeStyle = ink(0.14); x.lineWidth = 0.7; x.beginPath();                                   // небо: несколько гравированных облаков
    for (const [cx0, cy0, w] of [[0.28, 0.42, 0.22], [0.66, 0.66, 0.3], [0.45, 0.85, 0.16]]) {
      const X = fx0 + (fx1 - fx0) * cx0, Y = G.top + (hor - G.top) * cy0, L = (fx1 - fx0) * w;
      for (let k = 0; k < 3; k++) { x.moveTo(X - L / 2 + k * 6, Y + k * 3.5); x.bezierCurveTo(X - L / 4, Y + k * 3.5 - 4, X + L / 4, Y + k * 3.5 + 3, X + L / 2 - k * 7, Y + k * 3.5); }
    }
    x.stroke();
    let rs = 5; const rr = () => ((rs = (rs * 16807) % 2147483647) / 2147483647);                // дальние горы за горизонтом — бледный хребет
    for (const [a, hk] of [[0.18, 0.75], [0.36, 1]]) {                                            // два ряда: дальний бледнее и выше
      x.fillStyle = `rgb(${PAPER})`; x.strokeStyle = ink(a); x.lineWidth = 0.8; x.beginPath(); x.moveTo(fx0, hor);
      let X = fx0 - rr() * 30;
      while (X < fx1) { const w = 22 + rr() * 46, h = (4 + rr() * 16) * hk * (a > 0.2 ? 1 : 1.4); x.quadraticCurveTo(X + w * 0.3, hor - h * 0.4, X + w * 0.5, hor - h); x.quadraticCurveTo(X + w * 0.75, hor - h * 0.35, X + w, hor - rr() * 3); X += w; }
      x.lineTo(fx1, hor); x.fill(); x.stroke();
    }
    x.strokeStyle = ink(0.07); x.beginPath();                                                     // земля: борозды, к нам реже
    for (let k = 0; k < 26; k++) { const y = proj(G, 0, 1 - (k / 26) * 2).y; x.moveTo(fx0, y); x.lineTo(fx1, y); }
    x.stroke();
    x.strokeStyle = rgba(WATER, 0.45); x.lineWidth = 0.7; x.beginPath();                         // озёра: вода — горизонтальная штриховка
    for (let y = hor + 1; y < gb; y += 2.2) {
      const v = unproj(G, 0, y).v; let inside = false, x0 = 0;
      for (let px = fx0; px <= fx1 + 1; px += 1) {
        const m = px <= fx1 && lakeAt((px - G.cx) / G.Wh, v) > 0.5;
        if (m && !inside) { inside = true; x0 = px; } else if (!m && inside) { inside = false; x.moveTo(x0 + 1, y); x.lineTo(px - 1, y); }
      }
    }
    x.stroke();
    const SC = 3, sw = Math.ceil((fx1 - fx0) / SC) + 1, sh = Math.ceil((gb - hor) / SC) + 1, LM = new Float32Array(sw * sh);   // берег — изолиния по экрану (мелкая сетка)
    for (let j = 0; j < sh; j++) { const v = unproj(G, 0, hor + j * SC).v; for (let i = 0; i < sw; i++) LM[j * sw + i] = lakeAt((fx0 + i * SC - G.cx) / G.Wh, v); }
    const shore = (lvl) => {
      for (let j = 0; j < sh - 1; j++) for (let i = 0; i < sw - 1; i++) {
        const q = j * sw + i, a = LM[q], b2 = LM[q + 1], c = LM[q + sw + 1], d = LM[q + sw], X0 = fx0 + i * SC, Y0 = hor + j * SC, pts = [];
        if ((a > lvl) === (b2 > lvl) && (b2 > lvl) === (c > lvl) && (c > lvl) === (d > lvl)) continue;
        if ((a > lvl) !== (b2 > lvl)) pts.push([X0 + SC * (lvl - a) / (b2 - a), Y0]);
        if ((b2 > lvl) !== (c > lvl)) pts.push([X0 + SC, Y0 + SC * (lvl - b2) / (c - b2)]);
        if ((c > lvl) !== (d > lvl)) pts.push([X0 + SC * (1 - (lvl - c) / (d - c)), Y0 + SC]);
        if ((d > lvl) !== (a > lvl)) pts.push([X0, Y0 + SC * (1 - (lvl - d) / (a - d))]);
        for (let k = 0; k + 1 < pts.length; k += 2) { x.moveTo(...pts[k]); x.lineTo(...pts[k + 1]); }
      }
    };
    x.lineWidth = 1.1; x.strokeStyle = rgba(WATER, 0.9); x.beginPath(); shore(0.5); x.stroke();   // берег и тень берега
    x.lineWidth = 0.7; x.strokeStyle = rgba(WATER, 0.3); x.beginPath(); shore(0.15); x.stroke();
    for (const rv of land.rivers) {                                                               // реки: тонко у истока, к устью шире; ближе — толще
      const n = rv.pts.length;
      x.strokeStyle = rgba(WATER, 0.9);
      for (let k = 1; k < n; k++) { const a = proj(G, ...rv.pts[k - 1]), c = proj(G, ...rv.pts[k]); x.lineWidth = (0.5 + 1.8 * (k / n)) * (0.3 + 0.7 * c.s); x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(c.x, c.y); x.stroke(); }
    }
    const fsd = (land.seed % 97) * 0.13;                                                           // рельеф: ряды значков от горизонта к нам
    let v = 1;
    while (v > -1.03) {
      const p = proj(G, 0, v), s = p.s, step = (4.5 + 9.5 * s) / G.Wh;
      for (let u = -1.04 + rnd() * step; u < 1.04; u += step * (0.8 + 0.4 * rnd())) {
        const uu = clamp(u, -1, 1), vv = clamp(v + (rnd() - 0.5) * 0.012, -1, 1), z = zAt(uu, vv), q = proj(G, uu, vv);
        if (lakeAt(uu, vv) > 0.25 || q.x < fx0 + 8 || q.x > fx1 - 8) continue;
        if (z > 0.48) { if (rnd() < 0.3) { const h = z * G.EL * s * 1.05 + 2, w = h * (1.6 + 0.6 * rnd()); mountain(x, q.x, q.y, h, w, s, rnd() - 0.5, z > 0.8); } }   // горы — редко и крупно: хребет из нескольких вершин
        else if (z > 0.2) { if (rnd() < 0.45) { const h = z * G.EL * s * 0.9 + 1, w = h * 1.9 + 4 * s; hill(x, q.x, q.y, h, w, s); } }
        else if (z > -0.2 && forest(uu, vv, fsd) > 0.38 && rnd() < 0.8) tree(x, q.x, q.y, s, z > 0.05 || rnd() < 0.3);
        else if (rnd() < 0.012 + 0.02 * s) tuft(x, q.x, q.y, 0.6 + 0.6 * s);
      }
      const p2 = proj(G, 0, v - 0.01), dydv = (p2.y - p.y) / 0.01;
      v -= (2.2 + 6 * s) / dydv;
    }
    x.font = `italic 10.5px ${T.MAP}`; x.textAlign = 'center'; x.textBaseline = 'middle';         // имена, как на старых картах
    const placed = [], free = (X, Y, w) => placed.every((r) => Math.abs(r[0] - X) > (r[2] + w) / 2 + 4 || Math.abs(r[1] - Y) > 13);   // имена не налезают друг на друга
    const label = (s2, X, Y, col) => { const w = x.measureText(s2).width; if (!free(X, Y, w)) return; placed.push([X, Y, w]); x.fillStyle = `rgba(${PAPER},0.85)`; x.fillRect(X - w / 2 - 2, Y - 6, w + 4, 12); x.fillStyle = col; x.fillText(s2, X, Y); };
    for (const p of land.peaks) if (p.name) { const q = proj(G, p.u, p.v); label(p.name, q.x, q.y + 8, ink(0.7)); }
    for (const l of land.lakes) if (l.name) { const q = proj(G, l.u, l.v); label(l.name, q.x, q.y, rgba(WATER, 0.95)); }
    for (const rv of land.rivers) {
      const k = Math.floor(rv.pts.length * 0.7), a = proj(G, ...rv.pts[k - 2]), c = proj(G, ...rv.pts[Math.min(rv.pts.length - 1, k + 2)]), q = proj(G, ...rv.pts[k]);
      let ang = Math.atan2(c.y - a.y, c.x - a.x); if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
      const w = x.measureText(rv.name).width; if (!free(q.x, q.y - 7, w)) continue; placed.push([q.x, q.y - 7, w]);
      x.save(); x.translate(q.x, q.y); x.rotate(ang); x.fillStyle = rgba(WATER, 0.85); x.fillText(rv.name, 0, -7); x.restore();
    }
    x.restore();
    x.strokeStyle = ink(0.9); x.lineWidth = 1.6; x.strokeRect(fx0, G.top - 4, fx1 - fx0, b - G.top + 2);   // рамка карты Таро, как у Natura
    x.strokeStyle = ink(0.55); x.lineWidth = 0.9; x.strokeRect(fx0 + 5.5, G.top + 1.5, fx1 - fx0 - 11, b - G.top - 9);
    x.strokeStyle = ink(0.6); x.lineWidth = 0.8; x.beginPath(); x.moveTo(fx0 + 6, hor + 0.5); x.lineTo(fx1 - 6, hor + 0.5); x.stroke();   // горизонт
    const ny = b - 22;                                                                            // подпись внизу
    x.fillStyle = `rgb(${PAPER})`; x.fillRect(fx0 + 6, ny - 9, fx1 - fx0 - 12, 18);
    x.strokeStyle = ink(0.8); x.lineWidth = 1; x.beginPath(); x.moveTo(fx0 + 6, ny - 9.5); x.lineTo(fx1 - 6, ny - 9.5); x.stroke();
    x.font = `15px ${T.MAP}`; x.fillStyle = ink(0.95); x.fillText('A R C A D I A', G.cx, ny + 1);
    for (let k = 0; k <= SEMIS; k++) {                                                            // полутоны по левой рамке — вглубь выше; ступени лада длиннее
      const pc = (k + root()) % 12, on = !pcs || pcs.includes(pc), y = gb - (k / SEMIS) * (gb - hor), l = on ? 6 : 3;
      x.strokeStyle = ink(on ? 0.6 : 0.25); x.lineWidth = 0.8; x.beginPath(); x.moveTo(fx0 + 5.5, y); x.lineTo(fx0 + 5.5 + l, y); x.stroke();
    }
    return wallC;
  }
  function drawT(c, G, t, now, held) {
    const home = flagAt(G, t), cc = engine.centers[t.slot] || [t.u, t.v, t.r], cen = atG(G, cc[0], cc[1]), g = clamp((engine.gains[t.slot] || 0) * 1.3);
    c.lineWidth = 0.9; c.setLineDash([1.5, 3.5]); c.strokeStyle = ink(0.4);                      // путь: куда бродит петля
    const path = (pts) => { c.beginPath(); pts.forEach(([u, v], k) => { const p = atG(G, u, v); k ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y); }); c.stroke(); };
    if (t.mode === 1) path(Array.from({ length: 49 }, (_, k) => [t.u + t.sp * Math.cos((k / 48) * TAU), t.v + (t.sp * Math.sin((k / 48) * TAU)) / ASP]));
    else if (t.mode >= 3 && t.route && t.route.length >= 4) { c.strokeStyle = t.mode === 3 ? rgba(WATER, 0.7) : ink(0.5); path(Array.from({ length: t.route.length / 2 }, (_, k) => [t.route[2 * k], t.route[2 * k + 1]])); }
    else if (t.mode === 2 && t.trail.length > 2) path(t.trail);
    c.setLineDash([2, 4]); c.strokeStyle = ink(0.3); c.beginPath(); c.moveTo(home.x, home.y); c.lineTo(cen.x, cen.y); c.stroke(); c.setLineDash([]);
    const pts = loopOf(G, t, 120);                                                                // петля, поднятая холмами: её горбы — то, что слышно
    c.strokeStyle = ink(0.5 + 0.45 * g); c.lineWidth = 1 + 0.6 * g; c.beginPath(); pts.forEach((p, k) => (k ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.stroke();
    c.strokeStyle = ink(0.16); c.lineWidth = 0.7; c.beginPath();                                    // тень петли на земле — ровная, без холмов
    for (let k = 0; k <= 60; k++) { const [du, dv] = figPt(t.fig, (k / 60) * TAU), p = proj(G, cc[0] + (cc[2] || t.r) * du, cc[1] + ((cc[2] || t.r) * dv) / ASP); k ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y); }
    c.stroke();
    const ph = (now * 0.00022 * Math.sqrt(hzOf(t) / 55)) % 1, sp = pts[Math.floor(ph * 120)];       // сканер бежит по петле
    c.fillStyle = ink(0.95); c.beginPath(); c.arc(sp.x, sp.y, 2.3, 0, TAU); c.fill();
    const s = home.s, ph2 = now * 0.004 + t.slot, fh = 15 + 8 * s;                                // флажок странника на древке
    c.strokeStyle = ink(0.95); c.lineWidth = 1; c.beginPath(); c.moveTo(home.x, home.y); c.lineTo(home.x, home.y - fh); c.stroke();
    c.fillStyle = `rgb(${PAPER})`; c.beginPath(); c.moveTo(home.x, home.y - fh); c.quadraticCurveTo(home.x + 6, home.y - fh + 1 + Math.sin(ph2) * 1.5, home.x + 11, home.y - fh + 3.5); c.lineTo(home.x, home.y - fh + 7); c.closePath(); c.fill(); c.stroke();
    c.fillStyle = ink(0.95); c.beginPath(); c.ellipse(home.x, home.y, 3, 1.4, 0, 0, TAU); c.fill();
    if (held) {
      const f = hzOf(t), y = proj(G, -1, t.v).y;
      T.mapText(`${noteName(f)} · ${Math.round(f)} Hz`, home.x, home.y - fh - 22, 14, 0.95, 'center');
      T.mapText(held === 'rim' ? `orbit ${Math.round(t.r * 100)}%` : `${PATHS[t.mode]} · ${FIGS[t.fig]}`, home.x, home.y - fh - 8, 11, 0.65, 'center');
      c.strokeStyle = ink(0.95); c.lineWidth = 1.6; c.beginPath(); c.moveTo(G.fx0 + 5.5, y); c.lineTo(G.fx0 + 18, y); c.stroke(); c.lineWidth = 1;   // своя нота на шкале слева
    }
  }
  let noSun = false;
  function draw(now) {
    const c = T.g, G = G0();
    c.drawImage(wall(G), 0, 0, T.W, T.H);
    const held = new Map([...touches.values()].filter((t) => t.kind === 'home' || t.kind === 'rim').map((t) => [t.t, t.kind]));
    const order = [...travellers].sort((a, b) => b.v - a.v);                                       // дальние — раньше
    for (const t of order) drawT(c, G, t, now, held.get(t) || false);
    if (!noSun) T.quarterSun(c, G.sun.x, G.sun.y, G.sun.r, -1, now, INK, `rgb(${PAPER})`);
  }

  // ---------- плашка FX, легенда, угол ----------
  const deg = (d) => (d * Math.PI) / 180;
  const fxw = {
    sectors: [{ key: 'relief', label: 'relief', ang: deg(190) }, { key: 'pace', label: 'pace', ang: deg(160) }, { key: 'wind', label: 'wind', ang: deg(140) }, { key: 'chorus', label: 'chorus', ang: deg(120) }, { key: 'phaser', label: 'phaser', ang: deg(100) }, { key: 'hall', label: 'hall', ang: deg(80) }],
    get: (k) => fx[k], set: (k, v) => model.setFx(k, v),
    text: (k) => (k === 'pace' ? `${(1 / (0.01 * 40 ** fx.pace)).toFixed(0)} s` : k === 'wind' && fx.wind < 0.01 ? 'calm' : (k === 'phaser' || k === 'chorus') && fx[k] < 0.01 ? 'off' : `${Math.round(fx[k] * 100)}%`),
    lfo: { keys: ['relief', 'pace', 'wind', 'chorus', 'phaser', 'hall'], shapes: 'random' },
    arc: () => fx.hall, save: () => ({ ...fx }), load: (o) => model.loadFx(o),
  };
  const legend = [['tap', 'tap the land', 'a wanderer · its orbit scans the hills — the sound'], ['up', 'drag a wanderer', 'north — higher, south — lower · the land under it — timbre'],
    ['drag', 'drag the rim of an orbit', 'wide — rich, small — almost a sine'], ['tap', 'tap a wanderer', 'it leaves'],
    ['hold', 'hold a wanderer', 'its sheet: octave, orbit, figure, path, range, level'], ['tap', 'the dice', 'a new land and new paths'], ['tap', 'tap the sun', 'map of worlds']];
  const corner = { hit: (f) => { const G = G0(); return f.y > G.sun.y && Math.hypot(f.x - G.sun.x, f.y - G.sun.y) < G.sun.r + 12; }, draw: () => {} };   // солнце — карта

  return {
    theme: { ink: INK, bg: BGC, paper: PAPER }, corner, fx: fxw, legend, lfoId,
    down, move, up, tick, draw, mapShot(on) { noSun = on; },
  };
}
