// Horologium — картинка и касания: астрономические часы — колесо-«единица» со стрелкой-солнцем, кольца II…IX.
// Касание → действие модели (звук не трогает); положение и скорость колеса — метры engine (из ядра); что услышано (heard) — удары колец.
import { ROMAN, NR, euclid, rotOf, slotOf } from './model.js';

const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const INK = '214,180,110', BGC = '#0c0a07', PAPER = '12,10,7';

// ---------- геометрия: циферблат сверху, под ним отношение ----------
export function geo(T) {
  const W = T.W, H = T.H, top = T.topY + 6, bot = H - T.safeBot - 8, Ws = Math.min(W, (H - T.safeBot) * 0.62), cx = W / 2;
  const R = Math.min(Ws * 0.44, (bot - top) * 0.23), cy = top + 26 + R;
  const r0 = R * 0.17, dr = (R - 22 - r0) / (NR - 1);
  const ty = cy + R + 46;
  return { W, H, top, bot, cx, cy, R, r0, dr, Ws, ty, sun: { x: W, y: T.topY + 2, r: Math.min(42, W * 0.11) } };
}
export const ringR = (G, i) => G.r0 + i * G.dr;
function ringAt(G, x, y) { const d = Math.hypot(x - G.cx, y - G.cy), i = Math.round((d - G.r0) / G.dr); return i >= 0 && i < NR && Math.abs(d - ringR(G, i)) < G.dr * 0.62 ? i : -1; }

export function createView(T, model, engine) {
  const { rings, fx, clock } = model.state;
  const G0 = () => geo(T);
  const ringHit = new Array(NR).fill(0);                 // когда ударило кольцо (performance.now) — вспышка метки
  let conc = { t: 0, a: 0 };                              // concursus: когда кольца совпали и где — луч
  function heard(e) {
    if (!e.hits) return;
    const now = performance.now();
    for (const i of e.hits) ringHit[i] = now;
    if (new Set(e.hits).size > 1 && fx.concursus > 0.05) conc = { t: now, a: (e.P % 1) * TAU };
  }
  const Pvis = () => engine.P + engine.F * Math.min(0.1, (performance.now() - engine.tP) / 1000);

  // ---------- касания ----------
  const touches = new Map();
  let lastRingTap = null;
  function down(f) {
    const G = G0(), now = performance.now();
    const dh = Math.hypot(f.x - G.cx, f.y - G.cy);
    if (dh < G.r0 - 6) { touches.set(f.id, { kind: 'hub', t0: now, x0: f.x, y0: f.y, moved: false }); return; }
    const i = ringAt(G, f.x, f.y);
    if (i >= 0) {
      const r = rings[i];
      if (lastRingTap && lastRingTap.i === i && now - lastRingTap.t < T.DTAP_MS) { lastRingTap = null; model.toggleUnder(i); touches.set(f.id, { kind: 'none' }); return; }   // двойной тап — унтертон
      touches.set(f.id, { kind: 'ring', i, t0: now, x0: f.x, y0: f.y, a0: Math.atan2(f.x - G.cx, -(f.y - G.cy)), phi0: r.phi, moved: false, was: r.on });
      return;
    }
    touches.set(f.id, { kind: 'none' });
  }
  function move(f) {
    const t = touches.get(f.id);
    if (!t || t.kind === 'none' || t.sheet) return;
    const G = G0(), now = performance.now();
    if (Math.hypot(f.x - t.x0, f.y - t.y0) > 8) t.moved = true;
    if (t.kind === 'ring' && t.moved) {                   // вдоль кольца — фаза
      const a = Math.atan2(f.x - G.cx, -(f.y - G.cy)); let d = a - t.a0; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU;
      model.setPhase(t.i, ((t.phi0 - d / TAU) % 1 + 1) % 1); t.a0 = a; t.phi0 = rings[t.i].phi; t.ph = true;
    }
  }
  function up(f) {
    const t = touches.get(f.id);
    touches.delete(f.id);
    if (!t) return;
    const now = performance.now();
    if (t.kind === 'hub' && !t.moved && !t.sheet) { if (clock.run) model.stop(); else model.setRun(true); return; }
    if (t.kind === 'ring' && !t.moved && !t.sheet) { lastRingTap = { i: t.i, t: now }; model.toggleRing(t.i); }
  }
  function ringSheet(i) {
    const r = rings[i];
    T.openSheet({
      title: `circulus ${ROMAN[r.n]}`, hint: 'ring — tap outside to close',
      rows: [{ key: 'on', label: 'sounds' }, { key: 'under', label: 'ratio' }, { key: 'phi', label: 'phase' }, { key: 'lvl', label: 'level' }],
      lfo: { id: `horo-r${i}`, keys: ['phi', 'lvl'], shapes: 'classic' },
      get: (k) => (k === 'on' ? (r.on ? 1 : 0) : k === 'under' ? r.under / 2 : r[k]),
      set: (k, v) => model.setRing(i, k, k === 'under' ? Math.round(v * 2) : v),
      text: (k) => (k === 'on' ? (r.on ? 'yes' : 'no') : k === 'under' ? (r.under === 1 ? `1/${r.n} · ${+(12 / r.n).toFixed(2)} a turn` : r.under === 2 ? `×2 · ${r.n} a turn, twice as fast` : `${r.n} a turn`) : k === 'phi' ? `${rotOf(r.phi, r.len)} / ${r.len}` : `${Math.round(r.lvl * 100)}%`),
    });
  }
  function hubSheet() {
    T.openSheet({
      title: 'tempus', hint: 'one turn of the wheel = one bar — tap outside to close',
      rows: [{ key: 'bpm', label: 'tempo' }],
      get: () => (clock.bpm - 40) / 160, set: (k, v) => { model.setBpm(Math.round(40 + v * 160)); T.tempoFrom(9, clock.bpm); }, text: () => `${clock.bpm} bpm`,
    });
  }
  function tick(now) {
    for (const t of touches.values()) {
      if (t.sheet || t.moved || now - t.t0 <= T.HOLD_MS) continue;
      if (t.kind === 'ring') { t.sheet = true; ringSheet(t.i); }
      else if (t.kind === 'hub') { t.sheet = true; hubSheet(); }
    }
  }

  // ---------- рисование ----------
  const ink = (a) => `rgba(${INK},${a})`;
  let wallC = null, wallKey = '';
  function wall(G) {                                      // неподвижное: обод, деления, цифры
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
    x.strokeStyle = ink(0.85); x.beginPath(); x.arc(cx, cy, R, 0, TAU); x.stroke();
    x.strokeStyle = ink(0.3); x.beginPath(); x.arc(cx, cy, R - 4, 0, TAU); x.stroke();
    x.strokeStyle = ink(0.45); x.beginPath();
    for (let k = 0; k < 96; k++) { const a = (k / 96) * TAU, l = k % 4 ? 3 : 7; x.moveTo(cx + Math.sin(a) * (R - 4), cy - Math.cos(a) * (R - 4)); x.lineTo(cx + Math.sin(a) * (R - 4 - l), cy - Math.cos(a) * (R - 4 - l)); }
    x.stroke();
    x.font = `${Math.max(9, Math.min(12, R * 0.07))}px ${T.MAP}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = ink(0.75);   // цифры, как на часах: XII наверху
    for (let k = 1; k <= 12; k++) { const a = (k / 12) * TAU, rr = R + 11; x.save(); x.translate(cx + Math.sin(a) * rr, cy - Math.cos(a) * rr); x.rotate(a); x.fillText(ROMAN[k], 0, 0); x.restore(); }
    x.strokeStyle = ink(0.12); x.setLineDash([1, 3]); x.beginPath(); x.moveTo(cx, cy - G.r0 + 4); x.lineTo(cx, cy - R + 10); x.stroke(); x.setLineDash([]);   // «раз»: здесь все кольца сходятся
    return wallC;
  }
  function drawRings(c, G, now, P) {
    const Fm = engine.F, fast = Fm > 4;
    rings.forEach((r, i) => {
      const rr = ringR(G, i), on = r.on, L = r.len, k = Math.min(r.n, L), hit = clamp(1 - (now - ringHit[i]) / 260), cur = slotOf(r, P);
      c.lineWidth = 1; c.strokeStyle = ink(on ? 0.5 + 0.2 * r.lvl : 0.13); c.setLineDash(on ? [] : [2, 4]); c.beginPath(); c.arc(G.cx, G.cy, rr, 0, TAU); c.stroke(); c.setLineDash([]);
      if (on && r.under) { c.strokeStyle = ink(0.3); c.beginPath(); c.arc(G.cx, G.cy, rr + (r.under === 2 ? 3 : -3), 0, TAU); c.stroke(); }   // унтертон — двойной обвод внутри, ×2 — снаружи
      const hits = [];                                    // углы гнёзд с ударом — для места под число
      for (let j = 0; j < L; j++) {
        const a = (j / L) * TAU, sn = Math.sin(a), cs = Math.cos(a), x = G.cx + sn * rr, y = G.cy - cs * rr;
        if (!euclid(j, k, L)) {      // пустое гнездо — короткая засечка; бегунок на нём ярче
          c.strokeStyle = ink(j === cur ? 0.45 : on ? 0.12 : 0.06); c.beginPath(); c.moveTo(x - sn * 1.5, y + cs * 1.5); c.lineTo(x + sn * 1.5, y - cs * 1.5); c.stroke(); continue;
        }
        hits.push(a);
        if (!on) { c.strokeStyle = ink(0.22); c.beginPath(); c.arc(x, y, 1.8, 0, TAU); c.stroke(); continue; }
        const g = fast ? 0.35 + 0.4 * r.lvl : j === cur ? hit : 0;
        if (g > 0.05) T.glowAt(x, y, 10 + 8 * g, 0.35 * g);
        c.fillStyle = ink(Math.min(1, 0.55 + 0.45 * g));
        if (r.under) { c.beginPath(); c.moveTo(x, y - 3.6); c.lineTo(x + 3, y); c.lineTo(x, y + 3.6); c.lineTo(x - 3, y); c.closePath(); c.fill(); }
        else { c.beginPath(); c.arc(x, y, 3.1, 0, TAU); c.fill(); }
      }
      let la = Math.PI + 0.35;                            // число кольца — внизу слева, в просвете между гнёздами с ударом
      const ms = hits.sort((p, q) => p - q);
      if (ms.length) { let best = la, bd = 9; for (let j = 0; j < ms.length; j++) { const a0 = ms[j], a1 = j + 1 < ms.length ? ms[j + 1] : ms[0] + TAU, mid = (a0 + a1) / 2, d = Math.abs(((mid - la + Math.PI) % TAU + TAU) % TAU - Math.PI); if (d < bd) { bd = d; best = mid; } } la = best; }
      const lx = G.cx + Math.sin(la) * rr, ly = G.cy - Math.cos(la) * rr;
      c.font = `italic ${on ? 11 : 9.5}px ${T.MAP}`; c.textAlign = 'center'; c.textBaseline = 'middle';
      const lab = r.under === 1 ? `1/${ROMAN[r.n]}` : r.under === 2 ? `${ROMAN[r.n]}×2` : ROMAN[r.n], w = c.measureText(lab).width;
      c.fillStyle = BGC; c.fillRect(lx - w / 2 - 2, ly - 6, w + 4, 12);
      c.fillStyle = ink(on ? 0.9 : 0.32); c.fillText(lab, lx, ly);
    });
  }
  function drawHour(c, G, P) {                            // часовая стрелка — считает такты: деление за такт, круг — 12 тактов
    const Fh = engine.F / 12, R = G.R * 0.58;
    const bar = ((Math.floor(P) % 12) + 12) % 12, na = ((bar + 1) / 12) * TAU, rr = G.R + 11;   // цифра такта, к которому идёт стрелка, — ярче
    T.glowAt(G.cx + Math.sin(na) * rr, G.cy - Math.cos(na) * rr, 16, 0.25);
    c.save(); c.translate(G.cx + Math.sin(na) * rr, G.cy - Math.cos(na) * rr); c.rotate(na);
    c.font = `${Math.max(9, Math.min(12, G.R * 0.07))}px ${T.MAP}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = ink(1); c.fillText(ROMAN[bar + 1], 0, 0); c.restore();
    if (Fh > 4) { c.strokeStyle = ink(0.05); c.beginPath(); for (let j = 0; j < 60; j++) { const a = (j / 60) * TAU; c.moveTo(G.cx, G.cy); c.lineTo(G.cx + Math.sin(a) * R, G.cy - Math.cos(a) * R); } c.stroke(); return; }
    const a = (((P / 12) % 1 + 1) % 1) * TAU, sx = Math.sin(a), cy = -Math.cos(a), px = cy, py = -sx;   // ромб-наконечник, широкая игла
    const tip = [G.cx + sx * R, G.cy + cy * R], mid = [G.cx + sx * R * 0.78, G.cy + cy * R * 0.78], w = 5;
    c.fillStyle = BGC; c.strokeStyle = ink(0.8); c.lineWidth = 1;
    c.beginPath(); c.moveTo(G.cx + px * 2.5, G.cy + py * 2.5); c.lineTo(mid[0] + px * 1.2, mid[1] + py * 1.2); c.lineTo(mid[0] + sx * 4 + px * w, mid[1] + cy * 4 + py * w); c.lineTo(tip[0], tip[1]); c.lineTo(mid[0] + sx * 4 - px * w, mid[1] + cy * 4 - py * w); c.lineTo(mid[0] - px * 1.2, mid[1] - py * 1.2); c.lineTo(G.cx - px * 2.5, G.cy - py * 2.5); c.closePath(); c.fill(); c.stroke();
  }
  function drawHand(c, G, now, P) {
    drawHour(c, G, P);
    const R = G.R - 14, Fm = engine.F;
    if (Fm > 4) {                                         // быстро — стрелка слилась в диск
      const k = clamp((Fm - 4) / 12);
      c.strokeStyle = ink(0.05 * k + 0.02); c.beginPath(); for (let j = 0; j < 120; j++) { const a = (j / 120) * TAU; c.moveTo(G.cx, G.cy); c.lineTo(G.cx + Math.sin(a) * R, G.cy - Math.cos(a) * R); } c.stroke();
      c.strokeStyle = ink(0.5); c.beginPath(); c.arc(G.cx, G.cy, R, 0, TAU); c.stroke();
    } else {
      const a = (((P % 1) + 1) % 1) * TAU, hx = G.cx + Math.sin(a) * R, hy = G.cy - Math.cos(a) * R;
      for (let j = 1; j < 10; j++) { const b = a - j * 0.04 * clamp(Fm); c.strokeStyle = ink(0.05 * (1 - j / 10)); c.beginPath(); c.moveTo(G.cx, G.cy); c.lineTo(G.cx + Math.sin(b) * R, G.cy - Math.cos(b) * R); c.stroke(); }
      c.strokeStyle = ink(0.85); c.lineWidth = 1.2; c.beginPath(); c.moveTo(G.cx, G.cy); c.lineTo(hx, hy); c.stroke(); c.lineWidth = 1;
      c.fillStyle = BGC; c.beginPath(); c.arc(hx, hy, 7, 0, TAU); c.fill(); c.strokeStyle = ink(0.95); c.stroke();
      c.beginPath(); for (let k = 0; k < 12; k++) { const b = (k / 12) * TAU + now * 0.0004; c.moveTo(hx + Math.cos(b) * 9, hy + Math.sin(b) * 9); c.lineTo(hx + Math.cos(b) * 13, hy + Math.sin(b) * 13); } c.stroke();
    }
    const ck = clamp(1 - (now - conc.t) / 350);           // concursus: кольца совпали — луч
    if (ck > 0 && Fm <= 4) { c.strokeStyle = ink(0.5 * ck); c.beginPath(); c.moveTo(G.cx, G.cy); c.lineTo(G.cx + Math.sin(conc.a) * (G.R - 4), G.cy - Math.cos(conc.a) * (G.R - 4)); c.stroke(); }
    c.fillStyle = BGC; c.beginPath(); c.arc(G.cx, G.cy, G.r0 - 8, 0, TAU); c.fill();   // ступица: тап — пуск / стоп, держишь — темп
    c.strokeStyle = ink(clock.run ? 0.8 : 0.5); c.beginPath(); c.arc(G.cx, G.cy, G.r0 - 8, 0, TAU); c.stroke();
    if (!clock.run) { c.fillStyle = ink(0.8); const s = 5; c.beginPath(); c.moveTo(G.cx - s * 0.6, G.cy - s); c.lineTo(G.cx + s, G.cy); c.lineTo(G.cx - s * 0.6, G.cy + s); c.closePath(); c.fill(); }
    else { c.fillStyle = ink(0.9); c.beginPath(); c.arc(G.cx, G.cy, 3.2, 0, TAU); c.fill(); }
  }
  let noSun = false;
  function draw(now) {
    const c = T.g, G = G0(), P = Pvis(), Fm = engine.F;
    c.drawImage(wall(G), 0, 0, T.W, T.H);
    drawRings(c, G, now, P);
    drawHand(c, G, now, P);
    const rt = model.ratio(Fm);
    T.mapText(rt.a, G.cx, G.ty, 19, 0.95, 'center');
    T.mapText(rt.b, G.cx, G.ty + 21, 12, 0.6, 'center');
    for (const t of touches.values()) if (t.kind === 'ring' && t.ph) { const r = rings[t.i]; T.mapText(`${ROMAN[r.n]} · ${rotOf(r.phi, r.len)} / ${r.len}`, G.cx, G.cy + G.R + 14, 12, 0.85, 'center'); }
    if (!noSun) T.quarterSun(c, G.sun.x, G.sun.y, G.sun.r, -1, now, INK, BGC);
  }

  // ---------- FX, легенда, угол ----------
  const deg = (d) => (d * Math.PI) / 180;
  const fxw = {
    sectors: [{ key: 'aequalis', label: 'aequalis', ang: deg(190) }, { key: 'materia', label: 'materia', ang: deg(160) }, { key: 'concursus', label: 'concursus', ang: deg(130) }, { key: 'chance', label: 'chance', ang: deg(105) }, { key: 'hall', label: 'hall', ang: deg(80) }],
    get: (k) => fx[k], set: (k, v) => model.setFx(k, v),
    text: (k) => (k === 'aequalis' ? (fx.aequalis < 0.01 ? 'pure' : fx.aequalis > 0.99 ? 'equal' : `${Math.round(fx.aequalis * 100)}% equal`) : k === 'materia' ? `${fx.materia < 0.5 ? 'lignum' : 'metallum'} ${Math.round(fx.materia * 100)}%` : `${Math.round(fx[k] * 100)}%`),
    lfo: { keys: ['aequalis', 'materia', 'concursus', 'chance', 'hall'], shapes: 'random' },
    arc: () => fx.hall, save: () => ({ ...fx }), load: (o) => model.loadFx(o),
  };
  const legend = [['tap', 'tap a ring', 'it sounds: n of its steps, the n-th harmonic'], ['double', 'double tap a ring', 'ratio: 1/n · ×2 · normal'], ['drag', 'drag along a ring', 'its phase'],
    ['hold', 'hold a ring', 'its sheet'], ['tap', 'tap the hub', 'run / stop · hold — tempo'], ['tap', 'tap the sun', 'map of worlds']];
  const corner = { hit: (f) => { const G = G0(); return f.y > G.sun.y && Math.hypot(f.x - G.sun.x, f.y - G.sun.y) < G.sun.r + 6; }, draw: () => {} };   // солнце — карта

  return {
    theme: { ink: INK, bg: BGC, paper: PAPER }, corner, fx: fxw, legend,
    down, move, up, tick, draw, heard, mapShot(on) { noSun = on; },
  };
}
