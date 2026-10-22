// Firmamentum — картинка и касания: твердь Фламмариона. Над плоской землёй — купол неба, за ним — свет Эмпирея и колёса небесной механики.
// Касание → действие модели (звук не трогает); уровни звёзд — из engine (только чтение); что услышано (heard) — вспышки, пылинки, лучи.
const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const INK = '232,224,200', BGC = '#0a0914', PAPER = '10,9,20', GOLD = [236, 204, 130];
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const NOTES = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];
const noteName = (f) => { const m = Math.round(12 * Math.log2(f / 55)); return `${NOTES[((m % 12) + 12) % 12]}${Math.floor((m + 9) / 12) + 1}`; };

// ---------- геометрия: земля внизу, купол над ней; за куполом — Эмпирей ----------
export function geo(T) {
  const W = T.W, H = T.H, top = T.topY + 6, bot = H - T.safeBot - 8, Ws = Math.min(W, (H - T.safeBot) * 0.62), cx = W / 2;
  const hy = bot - Math.min(90, (bot - top) * 0.13), RX = Ws / 2 - 8, RY = Math.min(hy - top - 150, RX * 1.75);   // свод — высокий купол; над ним — Эмпирей
  return { W, H, top, bot, cx, Ws, hy, RX, RY, sun: { x: 0, y: bot + 8, r: 58 } };   // солнце — под землёй в левом нижнем углу (к центру карты): ночью оно ходит под землёй
}
function toSky(G, x, y) {                               // точка → (h, u): высота над горизонтом и место по своду
  const dy = G.hy - y, h = dy / G.RY, e = Math.hypot((x - G.cx) / G.RX, h);
  if (dy < 4 || e > 0.97) return null;
  const half = G.RX * Math.sqrt(Math.max(0.001, 1 - h * h));
  return { h: clamp(h, 0.02, 0.97), u: clamp((x - G.cx) / (half * 0.94), -1, 1) };
}
export function fromSky(G, s) { const half = G.RX * Math.sqrt(Math.max(0.001, 1 - s.h * s.h)); return { x: G.cx + s.u * half * 0.94, y: G.hy - s.h * G.RY }; }

export function createView(T, model, engine) {
  const { stars, fx } = model.state, LIMEN = model.LIMEN;
  const G0 = () => geo(T);
  const flash = new WeakMap();                          // звезда → когда прозвучал её последний пульсарет
  const specks = [], bolts = []; let specksN = 0, boltsN = 0;   // пылинки треска {x, y, a, t}, лучи вспышек {slot, t}

  function heard({ pulsed, dust, bolts: fl }) {         // что услышано в worklet — вспышки звёзд, пылинки на своде, лучи
    const now = performance.now(), G = G0();
    for (const s of stars) if (pulsed.includes(s.slot)) flash.set(s, now);
    for (const [pan, a] of dust) {                      // треск — пылинка на своде: вбок — по стерео, высота — любая
      const h = 0.05 + Math.random() * 0.85; specksN++; specks.push({ ...fromSky(G, { h, u: clamp(pan * 0.9 + (Math.random() - 0.5) * 0.2, -1, 1) }), a: Math.min(1, 0.25 + a * 3), t: now + Math.random() * 30 });
    }
    if (specks.length > 60) specks.splice(0, specks.length - 60);
    for (const i of fl) { boltsN++; bolts.push({ slot: i, t: now }); }   // вспышка — прямой луч от звезды
    if (bolts.length > 12) bolts.splice(0, bolts.length - 12);
  }

  // ---------- касания ----------
  const touches = new Map();
  function starAt(G, x, y) { let best = null, bd = 24; for (const s of stars) { const p = fromSky(G, s), d = Math.hypot(x - p.x, y - p.y); if (d < bd) { bd = d; best = s; } } return best; }
  function down(f) {
    const G = G0(), now = performance.now(), hit = starAt(G, f.x, f.y);
    if (hit) { touches.set(f.id, { kind: 'star', s: hit, x0: f.x, y0: f.y, t0: now, moved: false }); return; }
    const q = toSky(G, f.x, f.y);
    if (q) { const s = model.addStar(q.h, q.u); touches.set(f.id, s ? { kind: 'star', s, x0: f.x, y0: f.y, t0: now, moved: false, fresh: true } : { kind: 'none' }); return; }   // прокол тверди
    touches.set(f.id, { kind: 'none' });
  }
  function move(f) {
    const t = touches.get(f.id);
    if (!t || t.kind !== 'star' || t.sheet) return;
    if (Math.hypot(f.x - t.x0, f.y - t.y0) > 8) t.moved = true;
    if (!t.moved) return;
    const G = G0(), dy = Math.max(6, G.hy - f.y), e = Math.hypot((f.x - G.cx) / G.RX, dy / G.RY), k = e > 0.95 ? 0.95 / e : 1;   // за свод не уйти
    const q = toSky(G, G.cx + (f.x - G.cx) * k, G.hy - dy * k);
    if (q) model.moveStar(t.s, q.h, q.u);
  }
  function up(f) {
    const t = touches.get(f.id);
    touches.delete(f.id);
    if (t && t.kind === 'star' && !t.moved && !t.fresh && !t.sheet && performance.now() - t.t0 < 300 && stars.includes(t.s)) model.closeStar(t.s);   // тап по звезде — закрыть дыру
  }
  function tick(now) {                                  // держишь звезду — её плашка
    for (const t of touches.values()) if (t.kind === 'star' && !t.moved && !t.sheet && !t.fresh && now - t.t0 > T.HOLD_MS) { t.sheet = true; starSheet(t.s); }
  }
  const lfoId = (s) => `firm-s${s.slot}-${s.id}`;
  function starSheet(s) {
    T.openSheet({
      title: 'stella', hint: 'star — tap outside to close',
      rows: [{ key: 'h', label: 'pulse' }, { key: 'u', label: 'formant' }, { key: 'cyc', label: 'cycles' }, { key: 'win', label: 'window' }, { key: 'mask', label: 'mask' }, { key: 'lvl', label: 'level' }],
      lfo: { id: lfoId(s), keys: ['h', 'u', 'win', 'mask', 'lvl'], shapes: 'random' },   // «~» на formant — звезда мерцает
      get: (k) => (k === 'cyc' ? (s.cyc - 1) / 7 : k === 'u' ? (s.u + 1) / 2 : s[k]),
      set: (k, v) => model.setStar(s, { [k]: k === 'cyc' ? 1 + Math.round(v * 7) : k === 'u' ? v * 2 - 1 : k === 'h' ? clamp(v, 0.02, 0.97) : v }),
      text: (k) => { if (k === 'h') { const f = model.fp(s); return f >= 20 ? `${Math.round(f)} Hz` : `${f.toFixed(1)} / s`; } if (k === 'u') return `${Math.round(model.ff(s))} Hz`; return k === 'cyc' ? `${s.cyc}` : k === 'win' ? (s.win < 0.33 ? 'bell' : s.win < 0.66 ? 'strike' : 'square') : `${Math.round(s[k] * 100)}%`; },
    });
  }

  // ---------- рисование ----------
  const ink = (a) => `rgba(${INK},${a})`;
  let wallC = null, wallKey = '';
  function wall(G) {                                    // Эмпирей за куполом, колёса механики, свод с делениями, неподвижные звёзды, земля
    const key = `${G.W}x${G.H}x${T.DPR}|${G.hy}|${G.RY}`;
    if (wallC && key === wallKey) return wallC;
    wallKey = key;
    wallC = document.createElement('canvas');
    wallC.width = Math.round(G.W * T.DPR); wallC.height = Math.round(G.H * T.DPR);
    const x = wallC.getContext('2d');
    x.setTransform(T.DPR, 0, 0, T.DPR, 0, 0);
    x.fillStyle = BGC; x.fillRect(0, 0, G.W, G.H);
    const { cx, hy, RX, RY } = G, E = (a, k = 0) => [cx + Math.cos(a) * (RX + k), hy + Math.sin(a) * (RY + k)];
    x.lineWidth = 1;
    x.save(); x.beginPath(); x.rect(0, 0, G.W, hy); x.ellipse(cx, hy, RX + 4, RY + 4, 0, Math.PI, 0); x.clip('evenodd');   // за сводом: лучи Эмпирея и колёса
    x.strokeStyle = rgba(GOLD, 0.12); x.beginPath();
    for (let j = 0; j < 60; j++) { const a = Math.PI + (j / 59) * Math.PI, p = E(a, 10); x.moveTo(p[0], p[1]); x.lineTo(p[0] + Math.cos(a) * 600, p[1] + Math.sin(a) * 600); }
    x.stroke();
    const by = (G.top + 20 + hy - RY) / 2, bh = hy - RY - G.top - 20;                   // Эмпирей над сводом: колёса в колёсах
    for (const [wx, wy, wr] of [[cx + RX * 0.55, by, Math.min(bh * 0.42, RX * 0.3)], [cx + RX * 0.05, by + bh * 0.15, Math.min(bh * 0.28, RX * 0.2)]]) {   // колёса в колёсах — механика небес
      x.strokeStyle = rgba(GOLD, 0.35); x.beginPath(); x.arc(wx, wy, wr, 0, TAU); x.stroke();
      x.beginPath(); x.ellipse(wx, wy, wr, wr * 0.35, 0.6, 0, TAU); x.stroke(); x.beginPath(); x.ellipse(wx, wy, wr * 0.35, wr, 0.6, 0, TAU); x.stroke();
      x.fillStyle = rgba(GOLD, 0.35); for (let k = 0; k < 10; k++) { const a = (k / 10) * TAU; x.beginPath(); x.arc(wx + Math.cos(a) * wr, wy + Math.sin(a) * wr, 1.3, 0, TAU); x.fill(); }   // глаза на ободе
    }
    x.restore();
    x.strokeStyle = ink(0.8); x.beginPath(); x.ellipse(cx, hy, RX, RY, 0, Math.PI, 0); x.stroke();          // свод
    x.strokeStyle = ink(0.3); x.beginPath(); x.ellipse(cx, hy, RX - 5, RY - 5, 0, Math.PI, 0); x.stroke();
    x.strokeStyle = ink(0.45); x.beginPath();
    for (let k = 0; k <= 48; k++) { const a = Math.PI + (k / 48) * Math.PI, l = k % 4 ? 3 : 6, p = E(a), q = E(a, l); x.moveTo(p[0], p[1]); x.lineTo(q[0], q[1]); }
    x.stroke();
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);   // неподвижные звёзды — всегда те же
    x.fillStyle = ink(0.4);
    for (let k = 0; k < 180; k++) { const a = Math.PI + rnd() * Math.PI, r = Math.sqrt(rnd()) * 0.95; const px = cx + Math.cos(a) * r * RX, py = hy + Math.sin(a) * r * RY; if (py < hy - 4) { x.globalAlpha = 0.25 + 0.6 * rnd(); x.fillRect(px, py, 1, 1); } }
    x.globalAlpha = 1;
    const ly = hy - LIMEN * RY, lh = RX * Math.sqrt(1 - LIMEN * LIMEN);                                     // limen: ниже — ритм, выше — тон
    x.strokeStyle = ink(0.18); x.setLineDash([2, 5]); x.beginPath(); x.moveTo(cx - lh + 8, ly); x.lineTo(cx + lh - 8, ly); x.stroke(); x.setLineDash([]);
    x.font = `italic 10.5px ${T.MAP}`; x.textBaseline = 'middle'; x.fillStyle = ink(0.32);
    x.textAlign = 'left'; x.fillText('limen', cx - lh + 12, ly - 8);
    x.textAlign = 'center'; x.fillText('rhythmus', cx, hy - LIMEN * RY * 0.45); x.fillText('tonus', cx, hy - RY * 0.62);
    x.strokeStyle = ink(0.75); x.beginPath(); x.moveTo(0, hy + 0.5); x.lineTo(G.W, hy + 0.5); x.stroke();   // земля: горизонт, холмы, штриховка
    x.strokeStyle = ink(0.35); x.beginPath();
    for (let px = 0; px <= G.W; px += 4) { const y = hy + 10 + Math.sin(px * 0.031) * 4 + Math.sin(px * 0.011 + 1) * 6; px ? x.lineTo(px, y) : x.moveTo(px, y); }
    x.stroke();
    x.strokeStyle = ink(0.08); x.beginPath(); for (let y = hy + 18; y < G.H; y += 5) { x.moveTo(0, y); x.lineTo(G.W, y); } x.stroke();
    return wallC;
  }
  function drawComet(c) {                               // голова и хвост — бледное золото; хвост — назад по пути
    const at = model.cometAt();
    if (!at) return;
    const { k, x, y, A, B } = at;
    const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L, fade = Math.min(1, k * 6, (1 - k) * 6);
    for (let j = 0; j < 4; j++) { c.strokeStyle = rgba(GOLD, (0.5 - j * 0.11) * fade); c.lineWidth = 1; c.beginPath(); c.moveTo(x - uy * (j - 1.5) * 1.6, y + ux * (j - 1.5) * 1.6); c.lineTo(x - ux * (70 + j * 18) - uy * (j - 1.5) * 4, y - uy * (70 + j * 18) + ux * (j - 1.5) * 4); c.stroke(); }
    T.glowAt(x, y, 16, 0.35 * fade);
    c.fillStyle = rgba(GOLD, 0.95 * fade); c.beginPath(); c.arc(x, y, 2.6, 0, TAU); c.fill();
  }
  function drawDust(c, G, now) {                        // пылинки треска гаснут за ~¼ с; лучи вспышек — тонкая прямая до свода, ~0.1 с
    for (let j = specks.length - 1; j >= 0; j--) {
      const p = specks[j], k = (now - p.t) / 260;
      if (k > 1) { specks.splice(j, 1); continue; }
      if (k < 0) continue;
      const a = p.a * (1 - k) ** 2; c.fillStyle = ink(0.9 * a); c.fillRect(p.x - 0.5, p.y - 0.5, 1.3, 1.3);
      if (p.a > 0.6) { c.strokeStyle = ink(0.5 * a); c.lineWidth = 1; c.beginPath(); c.moveTo(p.x - 3, p.y); c.lineTo(p.x + 3, p.y); c.moveTo(p.x, p.y - 3); c.lineTo(p.x, p.y + 3); c.stroke(); }
    }
    for (let j = bolts.length - 1; j >= 0; j--) {
      const b = bolts[j], k = (now - b.t) / 110, s = stars.find((q) => q.slot === b.slot);
      if (k > 1 || !s) { bolts.splice(j, 1); continue; }
      const p = fromSky(G, s), top = G.hy - G.RY * Math.sqrt(Math.max(0, 1 - ((p.x - G.cx) / G.RX) ** 2)) + 6;
      c.strokeStyle = `rgba(255,255,255,${0.75 * (1 - k)})`; c.lineWidth = 1; c.beginPath(); c.moveTo(p.x + 0.5, p.y - 9); c.lineTo(p.x + 0.5, top); c.stroke();
      c.strokeStyle = ink(0.4 * (1 - k)); c.beginPath(); c.moveTo(p.x - 5, top + 3); c.lineTo(p.x + 6, top + 3); c.stroke();
    }
  }
  function drawStar(c, G, s, now, held) {
    const p = fromSky(G, s), fp = model.fp(s), g = engine.gains[s.slot] || 0;
    const blink = fp < 18 ? Math.exp(-(now - (flash.get(s) || 0)) / (80 + 300 / Math.max(1, fp))) : 1;   // ритм — вспышка на каждом пульсарете; тон — ровный свет
    const e = clamp(g * 1.4) * (0.35 + 0.65 * blink);
    if (e > 0.05) T.glowAt(p.x, p.y, 22 + 10 * blink, 0.25 * e);
    const len = 30 + 26 * e, w = 6, cyc = s.cyc;                                            // луч вниз — форма пульсарета
    c.strokeStyle = rgba(GOLD, 0.15 + 0.5 * e); c.lineWidth = 1; c.beginPath();
    for (let k = 0; k <= 40; k++) {
      const x = k / 40, w0 = Math.sin(Math.PI * x) ** 2, w1 = Math.min(1, x * 40) * Math.exp(-x * 5), wv = s.win < 0.5 ? w0 + (w1 - w0) * s.win * 2 : w1 + (1 - w1) * (s.win - 0.5) * 2;
      const px = p.x + Math.sin(TAU * cyc * x) * wv * w, py = p.y + 7 + x * len; k ? c.lineTo(px, py) : c.moveTo(px, py);
    }
    c.stroke();
    c.strokeStyle = rgba(GOLD, 0.5 + 0.5 * e); c.beginPath();                                // звезда: прокол с лучами
    for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU, l = (k % 2 ? 4 : 8) * (0.7 + 0.5 * e); c.moveTo(p.x + Math.cos(a) * 2, p.y + Math.sin(a) * 2); c.lineTo(p.x + Math.cos(a) * l, p.y + Math.sin(a) * l); }
    c.stroke();
    c.fillStyle = rgba(GOLD, 0.6 + 0.4 * e); c.beginPath(); c.arc(p.x, p.y, 2.2, 0, TAU); c.fill();
    if (s.mask > 0.05) { c.strokeStyle = ink(0.35); c.setLineDash([1.5, 3]); c.beginPath(); c.arc(p.x, p.y, 11, 0, TAU); c.stroke(); c.setLineDash([]); }   // пропускает — пунктирный ободок
    if (held) {
      c.strokeStyle = ink(0.6); c.beginPath(); c.arc(p.x, p.y, 14, 0, TAU); c.stroke();
      const ff = model.ff(s), top = fp >= 20 ? `${noteName(fp)} · ${Math.round(fp)} Hz` : `${fp.toFixed(fp < 4 ? 1 : 0)} / s`;
      T.mapText(top, p.x, p.y - 30, 14, 0.95, 'center');
      T.mapText(`formant ${Math.round(ff)} Hz`, p.x, p.y - 15, 11, 0.6, 'center');
    }
  }
  let noSun = false;
  function draw(now) {
    const c = T.g, G = G0();
    c.drawImage(wall(G), 0, 0, T.W, T.H);
    const held = new Set([...touches.values()].filter((t) => t.kind === 'star').map((t) => t.s));
    drawComet(c);
    drawDust(c, G, now);
    for (const s of stars) drawStar(c, G, s, now, held.has(s));
    if (!noSun) { c.save(); c.beginPath(); c.rect(0, 0, G.W, G.sun.y); c.clip(); T.sunGlyph(c, G.sun.x, G.sun.y, -Math.PI / 2, 0, 1.2, now, INK, BGC); c.restore(); }
  }

  // ---------- плашка FX, легенда, угол ----------
  const deg = (d) => (d * Math.PI) / 180;
  const fxw = {
    sectors: [{ key: 'scintilla', label: 'scintilla', ang: deg(200) }, { key: 'drift', label: 'drift', ang: deg(180) }, { key: 'cometa', label: 'cometa', ang: deg(160) }, { key: 'crepitus', label: 'crepitus', ang: deg(140) }, { key: 'fulgur', label: 'fulgur', ang: deg(120) }, { key: 'spread', label: 'spread', ang: deg(100) }, { key: 'hall', label: 'hall', ang: deg(80) }],
    get: (k) => fx[k], set: (k, v) => model.setFx(k, v), text: (k) => (['cometa', 'crepitus', 'fulgur'].includes(k) && fx[k] <= 0.01 ? 'off' : `${Math.round(fx[k] * 100)}%`),
    lfo: { keys: ['scintilla', 'drift', 'cometa', 'crepitus', 'fulgur', 'spread', 'hall'], shapes: 'random' },
    arc: () => fx.hall, save: () => ({ ...fx }), load: (o) => model.loadFx(o),
  };
  const legend = [['tap', 'tap the sky', 'pierce the firmament — a star pulses'], ['up', 'drag a star up', 'faster: low — rhythm, high — a tone'],
    ['drag', 'drag a star sideways', 'formant · colour'], ['tap', 'tap a star', 'close the hole'],
    ['hold', 'hold a star', 'its sheet: cycles, window, mask, level'], ['tap', 'tap the sun', 'map of worlds']];
  const corner = { hit: (f) => { const G = G0(); return f.y > G.hy + 6 && Math.hypot(f.x - G.sun.x, f.y - G.sun.y) < G.sun.r + 6; }, draw: () => {} };   // солнце под землёй — карта

  return {
    theme: { ink: INK, bg: BGC, paper: PAPER }, corner, fx: fxw, legend, lfoId,
    down, move, up, tick, draw, heard, mapShot(on) { noSun = on; },
    get specks() { return specksN; }, get bolts() { return boltsN; },
  };
}
