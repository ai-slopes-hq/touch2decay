// Tria corpora — картинка и касания: алхимическое блюдо из камня, три начала Парацельса, следы-аттракторы, внизу аватары и отвес.
// Касание → действие модели (звук не трогает); вспышки аспектов, громкость и пульс тел — из model.state.
const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const INK = '222,198,152', BGC = '#130f0a', PAPER = '19,15,10';
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const TINT = [[240, 234, 222], [236, 192, 84], [196, 210, 224]];   // соль — белая, сера — жёлтая, ртуть — серебро
export const NAMES = ['Sal', 'Sulphur', 'Mercurius'];
const NOTES = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];
const noteName = (f) => { const m = Math.round(12 * Math.log2(f / 55)); return `${NOTES[((m % 12) + 12) % 12]}${Math.floor((m + 9) / 12) + 1}`; };

// ---------- геометрия ----------
export function geo(T) {
  const W = T.W, H = T.H, top = T.topY + 6, bot = H - T.safeBot - 8, Ws = Math.min(W, (H - T.safeBot) * 0.62), cx = W / 2;
  const ay = bot - 30, cy2 = (top + ay - 40) / 2 + 8, R = Math.min(Ws / 2 - 16, (ay - 40 - top) / 2 - 18);   // внизу — аватары трёх тел и отвес
  const step = Math.min(70, Ws / 4.6), av = [-1.5, -0.5, 0.5].map((k) => ({ x: cx + k * step, y: ay, r: 19 }));
  return { W, H, top, bot, cx, cy: cy2, R, Ws, av, plumb: { x: cx + 1.5 * step, y: ay, r: 19 }, sun: { x: 0, y: T.topY + 2, r: Math.min(56, Ws * 0.15) } };
}
export const px = (G, b) => ({ x: G.cx + b.x * G.R, y: G.cy + b.y * G.R });

export function createView(T, model) {
  const S = model.state, { bodies, fx, pairK, trem, flashes } = S;
  const G0 = () => geo(T);

  // ---------- касания ----------
  const touches = new Map();
  let lastTap = null;
  function bodyAt(G, x, y) { let best = -1, bd = 30; bodies.forEach((b, i) => { const p = px(G, b), d = Math.hypot(x - p.x, y - p.y); if (d < bd) { bd = d; best = i; } }); return best; }
  function down(f) {
    const G = G0(), now = performance.now();
    const ai = G.av.findIndex((a) => Math.hypot(f.x - a.x, f.y - a.y) < a.r + 10);
    if (ai >= 0) { bodySheet(ai); touches.set(f.id, { kind: 'none' }); return; }   // аватар — плашка тела
    if (Math.hypot(f.x - G.plumb.x, f.y - G.plumb.y) < G.plumb.r + 10) { model.plumb(); touches.set(f.id, { kind: 'none' }); return; }   // отвес: тяга выкл — всё падает на дно; ещё раз — тяга снова
    const i = bodyAt(G, f.x, f.y);
    if (i >= 0) {
      if (lastTap && lastTap.i === i && now - lastTap.t < T.DTAP_MS) { lastTap = null; model.anchor(i); touches.set(f.id, { kind: 'none' }); return; }   // двойной тап — якорь
      lastTap = { i, t: now };
      model.grab(i);
      touches.set(f.id, { kind: 'body', i, x0: f.x, y0: f.y, t0: now, moved: false, hist: [[now, f.x, f.y]] });
      return;
    }
    if (Math.hypot(f.x - G.cx, f.y - G.cy) < 26) { model.fiatLux(); touches.set(f.id, { kind: 'none' }); return; }   // знак земли — Fiat lux
    touches.set(f.id, { kind: 'none' });
  }
  function move(f) {
    const t = touches.get(f.id);
    if (!t || t.kind !== 'body' || t.sheet) return;
    if (Math.hypot(f.x - t.x0, f.y - t.y0) > 8) t.moved = true;
    if (!t.moved) return;
    const G = G0(), x = (f.x - G.cx) / G.R, y = (f.y - G.cy) / G.R, r = Math.hypot(x, y), k = r > 0.95 ? 0.95 / r : 1;
    t.hist.push([performance.now(), f.x, f.y]); if (t.hist.length > 6) t.hist.shift();
    model.drag(t.i, x * k, y * k);
  }
  function up(f) {
    const t = touches.get(f.id);
    touches.delete(f.id);
    if (!t || t.kind !== 'body') return;
    let v = null;
    if (t.moved) {                                      // бросок: скорость пальца за последние кадры
      const G = G0(), h = t.hist, a = h[0], z = h[h.length - 1], dtm = Math.max(16, z[0] - a[0]);
      v = { vx: clamp(((z[1] - a[1]) / G.R / dtm) * 1000 * 0.5, -3, 3), vy: clamp(((z[2] - a[2]) / G.R / dtm) * 1000 * 0.5, -3, 3) };
    }
    model.release(t.i, v);
  }
  function tick(now) {                                  // держишь тело — его плашка
    for (const t of touches.values()) if (t.kind === 'body' && !t.moved && !t.sheet && now - t.t0 > T.HOLD_MS) { t.sheet = true; model.drop(t.i); bodySheet(t.i); }
  }
  function bodySheet(i) {
    const b = bodies[i];
    T.openSheet({
      title: NAMES[i], hint: 'body — tap outside to close',
      rows: [{ key: 'm', label: 'mass' }, { key: 'semi', label: 'note' }, { key: 'level', label: 'level' }, { key: 'fixed', label: 'anchor' }],
      get: (k) => (k === 'm' ? (b.m - 0.3) / 2.7 : k === 'semi' ? (b.semi + 12) / 36 : k === 'fixed' ? (b.fixed ? 1 : 0) : b.level),
      set: (k, v) => model.setBody(i, k, v),
      text: (k) => (k === 'm' ? b.m.toFixed(1) : k === 'semi' ? noteName(110 * 2 ** ((b.semi + model.tonic()) / 12)) : k === 'fixed' ? (b.fixed ? 'anchored' : 'free') : `${Math.round(b.level * 100)}%`),
    });
  }

  // ---------- рисование ----------
  const ink = (a) => `rgba(${INK},${a})`;
  let wallC = null, wallKey = '';
  function elem(x, cx, cy, s, up, bar) { x.beginPath(); x.moveTo(cx, cy + (up ? -s : s)); x.lineTo(cx + s * 0.9, cy + (up ? s * 0.6 : -s * 0.6)); x.lineTo(cx - s * 0.9, cy + (up ? s * 0.6 : -s * 0.6)); x.closePath(); if (bar) { x.moveTo(cx - s * 0.7, cy); x.lineTo(cx + s * 0.7, cy); } x.stroke(); }
  function wall(G) {                                    // блюдо: двойной обод с делениями, круги, четыре стихии по сторонам света
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
    x.strokeStyle = ink(0.5);                                                                               // стихии: огонь сверху, воздух справа, вода снизу, земля слева
    const S = 7, o = (R + 26) * Math.SQRT1_2;             // стихии по диагоналям: огонь и воздух — над блюдом (лёгкие), вода и земля — под ним
    elem(x, cx - o, cy - o, S, true, false); elem(x, cx + o, cy - o, S, true, true); elem(x, cx - o, cy + o, S, false, false); elem(x, cx + o, cy + o, S, false, true);
    x.font = `italic 10px ${T.MAP}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = ink(0.35);
    x.fillText('ignis', cx - o, cy - o - 16); x.fillText('aer', cx + o, cy - o - 16); x.fillText('aqua', cx - o, cy + o + 16); x.fillText('terra', cx + o, cy + o + 16);
    return wallC;
  }
  function glyph(c, i, x, y, r) {                        // знаки трёх начал: соль ⊖, сера — треугольник над крестом, ртуть — круг с рогами и крестом
    c.beginPath();
    if (i === 0) { c.arc(x, y, r, 0, TAU); c.moveTo(x - r, y); c.lineTo(x + r, y); }
    else if (i === 1) { c.moveTo(x, y - r); c.lineTo(x + r * 0.8, y + r * 0.2); c.lineTo(x - r * 0.8, y + r * 0.2); c.closePath(); c.moveTo(x, y + r * 0.2); c.lineTo(x, y + r * 1.2); c.moveTo(x - r * 0.45, y + r * 0.7); c.lineTo(x + r * 0.45, y + r * 0.7); }
    else { c.moveTo(x + r * 0.55, y); c.arc(x, y, r * 0.55, 0, TAU); c.moveTo(x - r * 0.55, y - r * 1.05); c.arc(x, y - r * 1.05, r * 0.55, Math.PI, 0, true); c.moveTo(x, y + r * 0.55); c.lineTo(x, y + r * 1.3); c.moveTo(x - r * 0.4, y + r * 0.95); c.lineTo(x + r * 0.4, y + r * 0.95); }
    c.stroke();
  }
  let noSun = false;
  function draw(now) {
    const c = T.g, G = G0(), lux = S.lux, time = S.time;   // вспышки и Fiat lux — по часам модели (секунды)
    c.drawImage(wall(G), 0, 0, T.W, T.H);
    const L = lux ? clamp((time - S.luxAt) / 0.6) : 0;     // знак земли в середине — Fiat lux; на восьмёрке — золото
    c.strokeStyle = lux ? rgba([236, 204, 120], 0.6 + 0.4 * L) : ink(0.6); c.lineWidth = 1.1;
    elem(c, G.cx, G.cy, 9, false, true);
    if (lux) { c.strokeStyle = rgba([236, 204, 120], 0.25 * L); c.beginPath(); for (let k = 0; k < 12; k++) { const a = (k / 12) * TAU; c.moveTo(G.cx + Math.cos(a) * 14, G.cy + Math.sin(a) * 14); c.lineTo(G.cx + Math.cos(a) * 24, G.cy + Math.sin(a) * 24); } c.stroke(); }
    const nr = model.rays();                              // лучи аспектов — бледно, вспыхивают, когда тело их пересекает
    if (nr) { c.strokeStyle = ink(0.07); c.setLineDash([1, 6]); c.beginPath(); for (let k = 0; k < nr; k++) { const a = (k * TAU) / nr - Math.PI / 4; c.moveTo(G.cx + Math.cos(a) * G.R * 0.12, G.cy + Math.sin(a) * G.R * 0.12); c.lineTo(G.cx + Math.cos(a) * G.R, G.cy + Math.sin(a) * G.R); } c.stroke(); c.setLineDash([]); }
    for (const f of flashes) {
      const k = (time - f.t) / (f.kind === 'conj' ? 0.7 : 0.45); if (k > 1 || k < 0) continue;
      const al = (1 - k) ** 2, col = TINT[f.i], X = G.cx + f.x * G.R, Y = G.cy + f.y * G.R;
      c.strokeStyle = rgba(col, 0.55 * al); c.lineWidth = 1; c.beginPath();
      if (f.kind === 'ring') { const a = Math.atan2(f.y, f.x); c.arc(G.cx, G.cy, f.q * G.R, a - 0.35, a + 0.35); }
      else if (f.kind === 'ray') { c.moveTo(G.cx + Math.cos(f.q) * G.R * 0.12, G.cy + Math.sin(f.q) * G.R * 0.12); c.lineTo(G.cx + Math.cos(f.q) * G.R, G.cy + Math.sin(f.q) * G.R); }
      else if (f.kind === 'rim') { const a = Math.atan2(f.y, f.x); c.arc(G.cx, G.cy, G.R + 3, a - 0.25, a + 0.25); }
      else { c.arc(X, Y, 8 + 30 * k, 0, TAU); }
      c.stroke();
      if (f.kind !== 'conj') { c.beginPath(); c.arc(X, Y, 3 + 14 * k, 0, TAU); c.stroke(); }
    }
    bodies.forEach((b, i) => {                            // следы — аттрактор, который они рисуют
      const tr = b.trail, n = tr.length / 2;
      if (n < 2) return;
      for (let seg = 0; seg < 4; seg++) {
        const a0 = Math.floor((n * seg) / 4), a1 = Math.floor((n * (seg + 1)) / 4);
        c.strokeStyle = rgba(TINT[i], 0.08 + 0.14 * seg); c.lineWidth = 1; c.beginPath();
        for (let k = a0; k <= Math.min(n - 1, a1); k++) { const X = G.cx + tr[2 * k] * G.R, Y = G.cy + tr[2 * k + 1] * G.R; k === a0 ? c.moveTo(X, Y) : c.lineTo(X, Y); }
        c.stroke();
      }
    });
    for (let i = 0; i < 3; i++) {                         // нити тяги — ярче, когда тела близко (сильнее модулируют)
      const a = px(G, bodies[i]), b = px(G, bodies[(i + 1) % 3]), d = Math.hypot(bodies[i].x - bodies[(i + 1) % 3].x, bodies[i].y - bodies[(i + 1) % 3].y), al = clamp(0.04 + (0.08 / Math.max(0.05, d)) * fx.nexus * 0.6, 0, 0.6);
      c.strokeStyle = ink(al); c.setLineDash([2, 4]); c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); c.setLineDash([]);
    }
    const held = new Set([...touches.values()].filter((t) => t.kind === 'body').map((t) => t.i));
    bodies.forEach((b, i) => {
      const p = px(G, b), r = 8 + 4 * Math.sqrt(b.m);
      if (b.amp > 0.05) T.glowAt(p.x, p.y, r * 2.4, b.amp * 0.35 * (1 - 0.6 * pairK[i] * (0.5 + 0.5 * Math.sin(trem[i]))));   // в паре — пульсирует с её оборотом
      c.fillStyle = BGC; c.beginPath(); c.arc(p.x, p.y, r + 4, 0, TAU); c.fill();
      c.strokeStyle = rgba(TINT[i], 0.5 + 0.5 * clamp(b.amp * 1.5)); c.lineWidth = 1; c.beginPath(); c.arc(p.x, p.y, r + 4, 0, TAU); c.stroke();
      if (b.fixed) { c.beginPath(); c.arc(p.x, p.y, r + 7.5, 0, TAU); c.stroke(); }   // на якоре — двойной обвод
      c.lineWidth = 1.2; glyph(c, i, p.x, p.y - (i === 2 ? 2 : 0), r * 0.55);
      if (held.has(i)) { T.mapText(NAMES[i], p.x, p.y - r - 26, 14, 0.95, 'center'); T.mapText(`${noteName(b.hz)} · ${Math.round(b.hz)} Hz`, p.x, p.y - r - 11, 11, 0.65, 'center'); }
    });
    G.av.forEach((a, i) => {                              // аватары внизу: знак тела, яркость — громкость, двойной обвод — на якоре
      const b = bodies[i];
      if (b.amp > 0.05) T.glowAt(a.x, a.y, 30, b.amp * 0.3);
      c.fillStyle = BGC; c.beginPath(); c.arc(a.x, a.y, a.r, 0, TAU); c.fill();
      c.strokeStyle = rgba(TINT[i], 0.45 + 0.55 * clamp(b.amp * 1.5)); c.lineWidth = 1; c.beginPath(); c.arc(a.x, a.y, a.r, 0, TAU); c.stroke();
      if (b.fixed) { c.beginPath(); c.arc(a.x, a.y, a.r + 3.5, 0, TAU); c.stroke(); }
      c.lineWidth = 1.2; glyph(c, i, a.x, a.y - (i === 2 ? 2 : 0), 7);
    });
    const P = G.plumb, cadit = S.cadit;                   // отвес: тяга выключена — грузик внизу, светится
    c.lineWidth = 1; c.fillStyle = BGC; c.strokeStyle = ink(cadit ? 0.95 : 0.55); c.beginPath(); c.arc(P.x, P.y, P.r, 0, TAU); c.fill(); c.stroke();
    if (cadit) { c.beginPath(); c.arc(P.x, P.y, P.r + 3.5, 0, TAU); c.stroke(); }
    c.beginPath(); c.moveTo(P.x, P.y - 12); c.lineTo(P.x, P.y + 1); c.stroke();
    c.fillStyle = ink(cadit ? 0.95 : 0.6); c.beginPath(); c.moveTo(P.x - 5, P.y + 1); c.lineTo(P.x + 5, P.y + 1); c.lineTo(P.x, P.y + 11); c.closePath(); c.fill();
    if (!noSun) T.quarterSun(c, G.sun.x, G.sun.y, G.sun.r, 1, now, INK, BGC);
  }

  // ---------- плашка FX, легенда, угол ----------
  const deg = (d) => (d * Math.PI) / 180;
  const fxw = {
    sectors: [{ key: 'gravitas', label: 'gravitas', ang: deg(190) }, { key: 'flux', label: 'flux', ang: deg(150) }, { key: 'nexus', label: 'nexus', ang: deg(135) }, { key: 'aspectus', label: 'aspectus', ang: deg(115) }, { key: 'decay', label: 'decay', ang: deg(100) }, { key: 'hall', label: 'hall', ang: deg(80) }],
    get: (k) => fx[k], set: (k, v) => model.setFx(k, v), text: (k) => (k === 'decay' && fx.decay <= 0.005 ? 'off' : k === 'aspectus' ? (fx.aspectus < 0.01 ? 'rim only' : fx.aspectus < 0.34 ? 'one circle' : fx.aspectus < 0.67 ? 'circles · 4 rays' : 'circles · 8 rays') : `${Math.round(fx[k] * 100)}%`),
    lfo: { keys: ['gravitas', 'flux', 'nexus', 'aspectus', 'decay', 'hall'], shapes: 'random' },   // gravitas с рампой — земля дышит
    arc: () => fx.hall, save: () => ({ ...fx }), load: (o) => model.loadFx(o),
  };
  const legend = [['throw', 'grab a body and throw it', 'the three pull each other — chaos'], ['double', 'double tap a body', 'anchor it · again — let go'],
    ['hold', 'hold a body or tap its medallion below', 'its sheet: mass, note, level, anchor'], ['tap', 'tap the sign of earth', 'Fiat lux: the figure eight'],
    ['tap', 'tap the plumb line', 'gravity off — all falls to the bottom · again — on'],
    ['tap', 'tap the sun', 'map of worlds']];
  const corner = { hit: (f) => { const G = G0(); return f.y > G.sun.y && Math.hypot(f.x - G.sun.x, f.y - G.sun.y) < G.sun.r + 6; }, draw: () => {} };   // солнце — карта

  return {
    theme: { ink: INK, bg: BGC, paper: PAPER }, corner, fx: fxw, legend,
    down, move, up, tick, draw, mapShot(on) { noSun = on; },
  };
}
