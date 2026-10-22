// Inferno — картинка и касания: воронка Данте — девять эллипсов один под другим, на дне Коцит; в левом нижнем углу — вечная тьма (карта).
// Касание → действие модели (звук не трогает); что услышано (heard) — удар прозвучал: угольки с круга. Вращение и угольки — только картинка.
import { NAMES, COLORS } from './model.js';
const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const INK = '207,196,182', EMBER = [226, 99, 42], EMBER2 = [242, 160, 74], ICE = [185, 210, 223];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];
const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (semi) => { const m = Math.round(semi) + 33; return `${NOTES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`; };

// ---------- геометрия: воронка — девять эллипсов один под другим, сужаются вниз; на дне Коцит ----------
export function geo(T) {
  const W = T.W, H = T.H, top = T.topY + 6, bot = H - T.safeBot - 8, cx = W / 2, Ws = Math.min(W, (H - T.safeBot) * 0.62);   // воронка портретная: на широком экране — по центру
  const y0 = top + 96, yC = bot - 54, dy = (yC - y0) / 9.3;
  const rx0 = Ws * 0.46, rx8 = Ws * 0.13;
  const rings = NAMES.map((_, k) => { const rx = rx0 - ((rx0 - rx8) * k) / 8; return { cy: y0 + k * dy, rx, ry: rx * 0.13 + 3 }; });
  return { W, Ws, H, top, bot, cx, y0, yC, dy, rings, coc: { cy: yC, rx: Ws * 0.11, ry: 9 }, dark: { x: 0, y: H - T.safeBot, r: Math.min(110, Ws * 0.28) } };
}
export function circleAt(G, x, y, loose = false) {
  const k = Math.round((y - G.y0) / G.dy);
  if (k < 0 || k > 8) return -1;
  const r = G.rings[k];
  if (Math.abs(y - r.cy) > G.dy / 2) return -1;
  if (!loose && Math.abs(x - G.cx) > r.rx + 18) return -1;
  return k;
}
export const posAt = (G, k, x) => { const r = G.rings[k]; return clamp((x - (G.cx - r.rx)) / (2 * r.rx)); };

export function createView(T, model) {
  const { circ, fx } = model.state, st = model.state;
  const G0 = () => geo(T);
  const rot = new Array(9).fill(0), sparks = [];

  function spark(k, n) {                                // угольки с круга: летят вверх и гаснут
    const G = G0(), r = G.rings[k];
    for (let i = 0; i < n && sparks.length < 160; i++) {
      const a = Math.PI * (0.1 + 0.8 * Math.random());
      sparks.push({ x: G.cx - Math.cos(a) * r.rx, y: r.cy + Math.sin(a) * r.ry, vx: (Math.random() - 0.5) * 14, vy: -28 - Math.random() * 40, life: 1, k });
    }
  }
  function heard(e) { if (e.strike != null) spark(e.strike, 10); }   // удар прозвучал — десять угольков

  // ---------- касания ----------
  const touches = new Map();
  let lastTap = null;
  function down(f) {
    const G = G0(), k = circleAt(G, f.x, f.y);
    if (k < 0) { touches.set(f.id, { kind: 'none' }); return; }
    const now = performance.now(), c = circ[k];
    if (lastTap && lastTap.k === k && now - lastTap.t < T.DTAP_MS) {   // двойной тап — грешник: круг горит сам; ещё раз — отпустить
      lastTap = null;
      model.pin(k, posAt(G, k, f.x));
      touches.set(f.id, { kind: 'none' });
      return;
    }
    lastTap = { k, t: now };
    if (!c.sinner) model.setPos(k, posAt(G, k, f.x));
    model.strike(k);
    touches.set(f.id, { kind: 'circle', k, t0: now, x: f.x, y: f.y, x0: f.x, y0: f.y, smoulder: false });
  }
  function move(f) {
    const t = touches.get(f.id);
    if (!t || t.kind === 'none') return;
    t.x = f.x; t.y = f.y;
    if (t.sheet) return;
    const G = G0(), kk = circleAt(G, f.x, f.y, true);
    if (kk >= 0 && kk !== t.k) {                        // провёл сквозь круги — арфа: каждый пересечённый бьёт
      if (t.smoulder) { model.hold(t.k, -1); t.smoulder = false; }
      t.harp = true; t.k = kk;
      if (!circ[kk].sinner) model.setPos(kk, posAt(G, kk, f.x));
      model.strike(kk, 0.8);
      return;
    }
    if (t.harp) return;
    if (Math.abs(f.x - f.x0) > 6 || t.smoulder) {       // вдоль круга — высота внутри его зоны
      if (!t.smoulder) { t.smoulder = true; model.hold(t.k, 1); }
      model.setPos(t.k, posAt(G, t.k, f.x));
    }
  }
  function up(f) {
    const t = touches.get(f.id);
    touches.delete(f.id);
    if (!t || t.kind !== 'circle') return;
    if (t.smoulder) model.hold(t.k, -1);
  }
  function hold(now) {                                  // держишь — круг тлеет (до шага модели, как раньше)
    for (const t of touches.values()) {
      if (t.kind !== 'circle' || t.harp) continue;
      if (!t.smoulder && now - t.t0 > 160) { t.smoulder = true; model.hold(t.k, 1); }
    }
  }
  function tick(now, dt) {                              // после шага модели: вращение по уровню, угольки
    const s = dt;
    circ.forEach((c, k) => {
      rot[k] += s * (0.04 + 0.7 * c.lvl) * (k % 2 ? 1 : -1);   // круги вращаются: горящие — быстрее, соседние — навстречу
      if (c.lvl > 0.05 && Math.random() < s * 30 * c.lvl) spark(k, 1);
    });
    for (let i = sparks.length - 1; i >= 0; i--) {      // угольки летят вверх, их сносит, они гаснут
      const p = sparks[i];
      p.x += (p.vx + Math.sin(now * 0.003 + i) * 8) * s; p.y += p.vy * s; p.vy *= 1 - s * 0.6; p.life -= s * 0.7;
      if (p.life <= 0) sparks.splice(i, 1);
    }
  }
  // держишь круг с грешником, не двигая, — плашка круга: цвет шума, ширина полос, перегруз, уровень
  function circleSheet(k) {
    const c = circ[k];
    T.openSheet({
      title: `${ROMAN[k]} · ${NAMES[k]}`, hint: 'circle — tap outside to close',
      rows: [{ key: 'pos', label: 'pitch' }, { key: 'color', label: 'noise' }, { key: 'width', label: 'width' }, { key: 'drive', label: 'drive' }, { key: 'level', label: 'level' }],
      lfo: { id: `inf-c${k}`, keys: ['pos', 'width', 'drive', 'level'], shapes: 'classic' },   // «~» — LFO строки, как у планеты Tenebrae
      get: (key) => (key === 'color' ? (c.color + 0.5) / 5 : c[key]),
      set: (key, v) => model.setCirc(k, key, key === 'color' ? Math.min(4, Math.floor(v * 5)) : v),
      text: (key) => (key === 'color' ? COLORS[c.color] : key === 'pos' ? noteName(model.semiOf(k, c.pos)) : `${Math.round(c[key] * 100)}%`),
    });
  }

  // ---------- рисование ----------
  let wallC = null, wallKey = '';
  function wall(G) {                                    // фон: штриховка (в угол тьмы не заходит), стенки воронки со штрихами
    const key = `${G.W}x${G.H}x${T.DPR}|${G.y0}|${G.yC}`;
    if (wallC && key === wallKey) return wallC;
    wallKey = key;
    wallC = document.createElement('canvas');
    wallC.width = Math.round(G.W * T.DPR); wallC.height = Math.round(G.H * T.DPR);
    const x = wallC.getContext('2d');
    x.setTransform(T.DPR, 0, 0, T.DPR, 0, 0);
    x.fillStyle = T.BG; x.fillRect(0, 0, G.W, G.H);
    const ink = (a) => `rgba(${INK},${a})`, D = G.dark;
    x.save(); x.beginPath(); x.rect(0, 0, G.W, G.H); x.arc(D.x, D.y, D.r + 8, 0, TAU, true); x.clip('evenodd');
    x.strokeStyle = ink(0.045); x.lineWidth = 1; x.beginPath();
    for (let k = -G.H; k < G.W; k += 14) { x.moveTo(k, 0); x.lineTo(k + G.H, G.H); }
    x.stroke(); x.restore();
    x.strokeStyle = ink(0.35); x.beginPath(); x.arc(D.x, D.y, D.r, -Math.PI / 2, 0); x.stroke();
    x.strokeStyle = ink(0.12); x.beginPath(); x.arc(D.x, D.y, D.r + 6, -Math.PI / 2, 0); x.stroke();
    const R = G.rings, last = { cy: G.coc.cy, rx: G.coc.rx * 0.9 };
    x.strokeStyle = ink(0.45); x.beginPath();
    for (const s of [-1, 1]) { R.forEach((r, k) => (k ? x.lineTo(G.cx + s * r.rx, r.cy) : x.moveTo(G.cx + s * r.rx, r.cy))); x.lineTo(G.cx + s * last.rx, last.cy); }
    x.stroke();
    x.strokeStyle = ink(0.09); x.beginPath();             // внутренняя стенка — короткие штрихи между кругами
    for (let k = 0; k < 8; k++) {
      const a = R[k], b = R[k + 1];
      for (let j = -9; j <= 9; j++) {
        const q = ((j / 10) * Math.PI) / 2, xa = G.cx + Math.sin(q) * a.rx * 0.96, ya = a.cy - Math.cos(q) * a.ry * 0.96, xb = G.cx + Math.sin(q) * b.rx * 0.96, yb = b.cy - Math.cos(q) * b.ry * 0.96;
        x.moveTo(xa, ya + 3); x.lineTo(xa + (xb - xa) * 0.45, ya + (yb - ya) * 0.45);
      }
    }
    x.stroke();
    return wallC;
  }
  const lvlAll = () => Math.min(1, circ.reduce((s, c) => s + c.lvl, 0) / 2.5);
  function drawInscription(c, G, now) {                 // LASCIATE OGNE SPERANZA над входом — разгорается с общим уровнем
    const txt = 'LASCIATE OGNE SPERANZA', L = lvlAll(), R = G.Ws * 1.1, ox = G.cx, oy = G.top + 40 + R, span = (G.Ws * 0.62) / R;
    c.strokeStyle = T.ink(0.3); c.lineWidth = 1;
    c.beginPath(); c.arc(ox, oy, R - 14, -Math.PI / 2 - span * 0.6, -Math.PI / 2 + span * 0.6); c.stroke();
    c.strokeStyle = T.ink(0.12); c.beginPath(); c.arc(ox, oy, R - 20, -Math.PI / 2 - span * 0.62, -Math.PI / 2 + span * 0.62); c.stroke();
    c.font = `12.5px ${T.MAP}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = L > 0.05 ? rgba(EMBER2, 0.35 + 0.6 * L) : T.ink(0.4);
    [...txt].forEach((ch, i) => {
      const a = -Math.PI / 2 + ((i - (txt.length - 1) / 2) / (txt.length - 1)) * span;
      c.save(); c.translate(ox + Math.cos(a) * R, oy + Math.sin(a) * R); c.rotate(a + Math.PI / 2); c.fillText(ch, 0, 0); c.restore();
    });
  }
  function drawSmoke(c, G, now) {                       // дым над воронкой — тёмный зал
    const a = 0.06 + 0.3 * fx.smoke;
    c.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const y = G.y0 - 40 + i * 8, ph = now * 0.0004 * (i % 2 ? 1 : -1);
      c.strokeStyle = T.ink(a * (1 - i * 0.3)); c.beginPath();
      const xa = G.cx - G.Ws / 2 + 30, xb = G.cx + G.Ws / 2 - 30;
      for (let x = xa; x <= xb; x += 6) { const yy = y + Math.sin(x * 0.045 + ph * 6 + i) * 4; x === xa ? c.moveTo(x, yy) : c.lineTo(x, yy); }
      c.stroke();
    }
  }
  function flames(c, G, k, level, col, now) {
    const r = G.rings[k], n = Math.max(6, Math.round(r.rx / 7));
    c.strokeStyle = rgba(col, 0.9); c.lineWidth = 1; c.beginPath();
    for (let j = 0; j < n; j++) {
      const u = (j + 0.5) / n, a = Math.PI * (1 - u), x = G.cx - Math.cos(a) * r.rx, y = r.cy + Math.sin(a) * r.ry;
      const h = (4 + 12 * level) * (0.6 + 0.4 * Math.sin(now * 0.011 + j * 1.7 + k)), w = 2.4;
      c.moveTo(x - w, y); c.quadraticCurveTo(x - w * 0.4, y - h * 0.55, x + Math.sin(now * 0.007 + j) * 1.5, y - h); c.quadraticCurveTo(x + w * 0.5, y - h * 0.45, x + w, y);
    }
    c.stroke();
  }
  function sinner(c, x, y) {                            // крошечный грешник: голова, тело, руки; огненный нимб — закреплён
    c.strokeStyle = T.ink(0.9); c.lineWidth = 1;
    c.beginPath(); c.moveTo(x, y - 9); c.lineTo(x, y - 3); c.lineTo(x - 2.5, y + 1.5); c.moveTo(x, y - 3); c.lineTo(x + 2.5, y + 1.5); c.moveTo(x - 3, y - 7); c.lineTo(x + 3, y - 6); c.stroke();
    T.dot(x, y - 11, 2.1, 0.9);
    c.strokeStyle = rgba(EMBER2, 0.8); c.beginPath(); c.arc(x, y - 11, 4.6, 0, TAU); c.stroke();
  }
  function draw(now) {
    const c = T.g, G = G0(), iceE = st.iceE, stormSemi = st.stormSemi, stormPh = st.stormPh, burning = model.burning;
    c.drawImage(wall(G), 0, 0, T.W, T.H);
    drawInscription(c, G, now);
    drawSmoke(c, G, now);
    const held = new Map();
    for (const t of touches.values()) if (t.kind === 'circle') held.set(t.k, t);
    G.rings.forEach((r, k) => {
      const q = circ[k], hot = q.lvl > 0.04 || burning(k), h = held.has(k);
      if (h) { c.strokeStyle = rgba(EMBER, 0.18); c.lineWidth = 10; c.beginPath(); c.ellipse(G.cx, r.cy, r.rx, r.ry, 0, 0, TAU); c.stroke(); }
      c.strokeStyle = hot ? rgba(EMBER, 0.35 + 0.6 * Math.min(1, q.lvl + (burning(k) ? 0.4 : 0))) : T.ink(0.7 - 0.03 * k);
      c.lineWidth = hot ? 1.3 : 1;
      c.beginPath(); c.ellipse(G.cx, r.cy, r.rx, r.ry, 0, 0, TAU); c.stroke();
      c.strokeStyle = T.ink(0.12); c.lineWidth = 1; c.beginPath(); c.ellipse(G.cx, r.cy + 3, r.rx - 3, r.ry - 1.5, 0, 0, TAU); c.stroke();
      c.strokeStyle = hot ? rgba(EMBER, 0.35) : T.ink(0.22); c.lineWidth = 1; c.beginPath();   // засечки на круге — видно, как он вращается
      for (let j = 0; j < 16; j++) { const a = rot[k] + (j / 16) * TAU, sn = Math.sin(a); if (sn < 0.05) continue; const x = G.cx + Math.cos(a) * r.rx, y = r.cy + sn * r.ry; c.moveTo(x, y - 2); c.lineTo(x, y + 2.5); }
      c.stroke();
      if (k === 1 && Math.abs(stormSemi) > 0.05 && q.lvl > 0.04) {   // буря второго круга: порывы носятся по кругу
        c.strokeStyle = T.ink(0.15 + 0.4 * q.lvl); c.lineWidth = 1; c.beginPath();
        for (let j = 0; j < 5; j++) {
          const a0 = stormPh * TAU * 1.5 + (j / 5) * TAU, rr = 1 + 0.12 * Math.sin(j * 2.3 + stormPh * 9);
          for (let u = 0; u <= 10; u++) { const a = a0 + u * 0.09, x = G.cx + Math.cos(a) * r.rx * rr, y = r.cy + Math.sin(a) * r.ry * rr * 2.2 - 6 - u * 0.4; u ? c.lineTo(x, y) : c.moveTo(x, y); }
        }
        c.stroke();
      }
      if (q.lvl > 0.04) flames(c, G, k, q.lvl * (0.4 + 0.6 * q.level / 0.7), h ? EMBER2 : EMBER, now);
      if (iceE > 0.02 && k >= 9 - iceE * 9) {           // иней ползёт снизу вверх — растёт со временем
        c.strokeStyle = rgba(ICE, 0.45); c.lineWidth = 1; c.beginPath();
        for (let j = 0; j < 14; j++) { const a = Math.PI * (0.08 + (0.84 * j) / 13), x = G.cx - Math.cos(a) * r.rx, y = r.cy + Math.sin(a) * r.ry + 5; c.moveTo(x - 2, y); c.lineTo(x, y - 3); c.lineTo(x + 2, y); }
        c.stroke();
      }
      if (q.sinner) {                                   // грешник стоит там, где круг звучит, и чуть переминается
        const x = G.cx - r.rx + 2 * r.rx * q.pos + Math.sin(now * 0.0016 + k) * 2.5, u = clamp((x - G.cx) / r.rx, -1, 1);
        sinner(c, x, r.cy + Math.sqrt(1 - u * u) * r.ry);
      }
    });
    // Коцит — ледяное озеро на дне
    const K = G.coc;
    c.strokeStyle = rgba(ICE, 0.85); c.lineWidth = 1; c.beginPath(); c.ellipse(G.cx, K.cy, K.rx, K.ry, 0, 0, TAU); c.stroke();
    c.strokeStyle = rgba(ICE, 0.3); c.beginPath(); c.ellipse(G.cx, K.cy, K.rx - 6, K.ry - 3, 0, 0, TAU); c.stroke();
    c.strokeStyle = rgba(ICE, 0.35 + 0.4 * iceE); c.beginPath();
    for (let j = 0; j < 9; j++) { const x = G.cx - K.rx * 0.7 + (j / 8) * K.rx * 1.4, y = K.cy + Math.sin(j * 2.1) * 3; c.moveTo(x - 2.5, y); c.lineTo(x + 2.5, y); c.moveTo(x, y - 2); c.lineTo(x, y + 2); }
    c.stroke();
    if (iceE > 0.03) {                                  // лёд трескается и растёт: трещины от середины, длиннее с инеем
      c.strokeStyle = rgba(ICE, 0.25 + 0.5 * iceE); c.beginPath();
      for (let j = 0; j < 7; j++) { const a = (j / 7) * TAU + 0.4, L = (0.3 + 0.9 * iceE) * K.rx * (0.7 + 0.3 * Math.sin(j * 3.1)); c.moveTo(G.cx, K.cy); c.lineTo(G.cx + Math.cos(a) * L * 0.5, K.cy + Math.sin(a) * L * 0.12 + Math.sin(j) * 2); c.lineTo(G.cx + Math.cos(a) * L, K.cy + Math.sin(a) * L * 0.22); }
      c.stroke();
    }
    for (const p of sparks) { c.fillStyle = rgba(p.life > 0.5 ? EMBER2 : EMBER, Math.min(1, p.life * 1.2)); c.fillRect(p.x - 0.8, p.y - 0.8, 1.6 + p.life, 1.6 + p.life); }   // угольки
    for (const [k, t] of held) {                        // подписи — только пока трогаешь
      const r = G.rings[k], s = model.semiOf(k, circ[k].pos);
      T.mapText(`${ROMAN[k]} · ${NAMES[k]}`, G.cx + r.rx, r.cy - r.ry - 22, 15, 0.95, 'right');
      T.mapText(`${noteName(s)} · ${Math.round(55 * 2 ** (s / 12))} Hz`, G.cx + r.rx, r.cy - r.ry - 6, 12, 0.7, 'right');
    }
    for (const t of touches.values()) if (t.kind === 'circle' && circ[t.k].sinner && !t.sheet && !t.harp && now - t.t0 > T.HOLD_MS && Math.hypot(t.x - t.x0, t.y - t.y0) < 10) { t.sheet = true; circleSheet(t.k); }   // держишь круг с грешником — его плашка
  }

  // ---------- плашка FX, легенда, угол ----------
  const deg = (d) => (d * Math.PI) / 180;
  const fxw = {
    sectors: [
      { key: 'structure', label: 'structure', ang: deg(200) },
      { key: 'fire', label: 'fire', ang: deg(170) },
      { key: 'smoke', label: 'smoke', ang: deg(140) },
      { key: 'ice', label: 'ice', ang: deg(80) },
      { key: 'storm', label: 'storm', ang: deg(60) },
    ],
    get: (k) => fx[k], set: (k, v) => model.setFx(k, v),
    text: (k) => (k === 'structure' ? model.structName() : k === 'storm' && fx.storm <= 0.01 ? 'off' : `${Math.round(fx[k] * 100)}%`),
    lfo: { keys: ['structure', 'fire', 'smoke', 'ice', 'storm'], shapes: 'classic' },
    arc: () => fx.smoke, save: () => ({ ...fx }), load: (o) => model.loadFx(o),
  };
  const legend = [['tap', 'tap a circle', 'a strike rings in its resonator'], ['hold', 'hold a circle', 'it smoulders while held'],
    ['drag', 'drag along a circle', 'pitch within its zone'], ['double', 'double tap a circle', 'a sinner stays, the circle burns'],
    ['draw', 'swipe down through circles', 'a cascade into the pit'], ['hold', 'hold a burning circle', 'its sheet: pitch, noise, width, drive, level · ~ — LFO'], ['tap', 'tap the darkness', 'map of worlds']];
  const corner = { hit: (f) => { const D = G0().dark; return Math.hypot(f.x - D.x, f.y - D.y) < D.r; }, draw: () => {} };   // вечная тьма — карта

  return {
    theme: { ink: INK, bg: '#050403', paper: '5,4,3' }, corner, fx: fxw, legend,
    down, move, up, hold, tick, draw, heard,
    get sparks() { return sparks.length; },
  };
}
