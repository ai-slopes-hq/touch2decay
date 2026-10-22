// ---------- смежные миры: солнце — начало координат, вокруг него четыре четверти ----------
import { artFor, loadArt } from './art.js';
import { chanLvl, pollLevels } from './audio.js';
import { drawSettings, link, perScl, settingsDown } from './concordia.js';
import { cellRect, cellWorld, deck, DLC_ON, ECL, field, GRID, mapWorlds, panel, setDeck, titleTaps } from './deck.js';
import { BG, BG0, cv, DPR, g, H, hairBox, ink, INK0, mapText, paper, PAPER0, scopeY, setTheme, sunGlyph, W } from './draw.js';
import { MAP } from './fonts.js';
import { drawMixer, mixDown } from './mixer.js';
import { ENTER, nav, worlds } from './registry.js';
import { retune, scl } from './scale.js';
import { setFxSheet } from './sheet.js';
import { drawUI } from './ui-top.js';
import { clamp } from './util.js';
// Universum: I (x>0, y>0) — Tenebrae, чёрный космос с планетами, играет. II, III, IV — пока только гравюры (идеи — в ROADMAP.md).
// Тап по солнцу — карта миров; тап по четверти — влететь в мир; в мире тап по солнцу — снова карта
const WORLDS = [
  null,
  { n: 'I', title: 'Tenebrae', sub: 'orbes · strepitus' },
  null,                                                   // II — подпись из мира cymatica.js; Cabbala снята с карты
  { n: 'III', title: 'Rosarium', sub: 'operatores quattuor' },
  { n: 'IV', title: 'Regnum', sub: 'echo et reverberatio' },
  null,                                                   // V — Inferno, подпись из inferno.js
  { n: 'VI', title: 'Paradisus', sub: 'sphaerae · chorus' },
];
export const WORLDS_ON = true;
const NAV_MS = 520;
const snaps = {};                                       // мир → его снимок для карты (при уходе на карту)

export function goMap() {
  loadArt(); setFxSheet(null);
  const n = nav.world;
  if (nav.view === 'play') {
    if (worlds[n].mapShot) {                      // у миров III и IV солнце в своём углу двоило бы центральное — снимок без него
      worlds[n].mapShot(true); setTheme(worlds[n].theme); worlds[n].draw(performance.now(), 0); drawUI(); worlds[n].mapShot(false);
    }
    const c = snaps[n] || (snaps[n] = document.createElement('canvas'));
    c.width = cv.width; c.height = cv.height;
    c.getContext('2d').drawImage(cv, 0, 0);
    if (worlds[n].leave) worlds[n].leave();
  }
  nav.anim = { t0: performance.now(), dir: 'out', w: nav.world };
  nav.view = 'map';
}
function goWorld(w) {
  if (!link.scale && w !== nav.world) {                 // лад не общий: у каждого мира свой
    perScl[nav.world] = { on: scl.on, idx: scl.idx, root: scl.root };
    if (perScl[w]) { Object.assign(scl, perScl[w]); retune(); }
  }
  nav.anim = { t0: performance.now(), dir: 'in', w };
  nav.world = w; nav.settings = false;
}

// касание, пока на экране карта или другой мир
export function navDown(f) {
  if (nav.anim) return;
  if (nav.view === 'map') {
    const F = field(), dx = f.x - F.sx, dy = f.y - F.sy;
    if (nav.settings === 'mix') { mixDown(f); return; }   // микшер: фейдеры, mute; мимо — назад в concordia
    if (nav.settings) { settingsDown(f); return; }   // открыты общие настройки — concordia.js
    if (DLC_ON && Math.abs(f.x - W / 2) < 115 && f.y > scopeY - 14 && f.y < scopeY + 34) {   // надпись UNIVERSUM: 7 тапов подряд — другая колода (main ↔ DLC vol. I)
      const now = performance.now();
      titleTaps.n = now - titleTaps.t < 700 ? titleTaps.n + 1 : 1; titleTaps.t = now;
      if (titleTaps.n >= 7) { titleTaps.n = 0; setDeck(deck === 'main' ? 'dlc1' : 'main'); }
      return;
    }
    if (Math.hypot(dx, dy) < 34 || (dx > 26 && dx < 120 && Math.abs(dy) < ECL / 2)) { nav.settings = true; return; }   // солнце или подпись concordia — общие настройки
    for (let c = 0; c < GRID; c++) for (let r = 0; r < GRID; r++) {
      const p = cellRect(c, r, F);
      if (f.x < p[0] || f.x >= p[0] + p[2] + F.gap || f.y < p[1] || f.y >= p[1] + p[3] + F.gap) continue;
      const w = cellWorld(c, r);
      if (w && ENTER.has(w)) goWorld(w);
      else if (!w) nav.peek = { c, r, t0: performance.now() };   // рубашка: карта вздрагивает — nondum
      return;
    }
  }
}

const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
function worldImage(w) { return ENTER.has(w) ? snaps[w] : artFor(w); }
// эмблемы звука на карте: гравюрный знак генератора каждого мира и латинская строка; рисуются один раз на размер экрана
const emblems = {};
const EMB_LINE = [null, 'tabulae · morphosis', 'modi · lamina', 'FM · IV operatores', 'VA · flumen', 'strepitus · IX resonatores', 'chorus · vocales', 'chorda · physica', 'scansio · oceanus', 'numeri · horae', 'pulsar · stellae', 'chaos · tria corpora', 'terrain · montes', 'concentus · echo', null, 'formula · sigilla', null, 'additio · lux', 'frictio · vitrum'];
const fontKey = () => (document.fonts ? document.fonts.status : '');
function emblemFor(w) {                                 // лицо карты мира: подложка мира, двойная рамка, номер сверху, медальон со знаком звука, имя снизу
  const F = field(), pw = F.cw, ph = F.ch, key = `${pw}x${ph}|${DPR}|${fontKey()}`;
  if (emblems[w] && emblems[w].key === key) return emblems[w].c;
  const c = document.createElement('canvas'); c.width = Math.round(pw * DPR); c.height = Math.round(ph * DPR);
  const x = c.getContext('2d'); x.setTransform(DPR, 0, 0, DPR, 0, 0);
  const th = worlds[w] && worlds[w].theme, ink2 = (a) => `rgba(${(th && th.ink) || INK0},${a})`;
  x.fillStyle = (th && th.bg) || BG0; x.fillRect(0, 0, pw, ph);
  x.lineWidth = 1; x.strokeStyle = ink2(0.7); x.strokeRect(1.5, 1.5, pw - 3, ph - 3);
  x.strokeStyle = ink2(0.25); x.strokeRect(4.5, 4.5, pw - 9, ph - 9);
  const big = pw > 100, mc = ph * (big ? 0.46 : 0.5), M0 = Math.min(pw * 0.4, ph * 0.26), R = M0 / 1.78, cx = pw / 2, T2 = Math.PI * 2;
  const cy = w === 3 ? mc + R * 0.12 : w === 4 ? mc - R * 0.12 : mc;
  x.lineWidth = 1; x.strokeStyle = ink2(0.85);
  if (w === 1) {                                          // планета: контур — осциллограмма по кругу, внутри двойная звезда, спутник
    x.beginPath();
    for (let i = 0; i <= 240; i++) { const a = (i / 240) * T2, wv = ((a * 5 / T2) % 1) * 2 - 1, r = R + R * 0.1 * wv; i ? x.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r) : x.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
    x.stroke();
    x.strokeStyle = ink2(0.4); x.beginPath(); x.arc(cx, cy, R * 0.72, 0, T2); x.stroke();
    for (const d of [-1, 1]) { x.fillStyle = ink2(0.9); x.beginPath(); x.arc(cx + d * R * 0.16, cy, 2.2, 0, T2); x.fill(); }
    x.setLineDash([2, 4]); x.strokeStyle = ink2(0.45); x.beginPath(); x.ellipse(cx, cy, R * 1.55, R * 0.5, -0.35, 0, T2); x.stroke(); x.setLineDash([]);
    x.fillStyle = ink2(0.9); x.beginPath(); x.arc(cx + Math.cos(0.6) * R * 1.55 * Math.cos(-0.35) - Math.sin(0.6) * R * 0.5 * Math.sin(-0.35), cy + Math.cos(0.6) * R * 1.55 * Math.sin(-0.35) + Math.sin(0.6) * R * 0.5 * Math.cos(-0.35), 3, 0, T2); x.fill();
  } else if (w === 2) {                                   // пластина Хладни: клетки ханга бледно, узловые линии ярко
    x.strokeStyle = ink2(0.3);
    for (const k of [1, Math.sqrt(2 / 3), Math.sqrt(1 / 3)]) { x.beginPath(); x.arc(cx, cy, R * 1.2 * k, 0, T2); x.stroke(); }
    x.beginPath(); for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + (i / 5) * T2; x.moveTo(cx, cy); x.lineTo(cx + Math.cos(a) * R * 1.2, cy + Math.sin(a) * R * 1.2); } x.stroke();
    x.strokeStyle = ink2(0.9); x.lineWidth = 1.4; x.beginPath();
    for (let i = 0; i <= 200; i++) { const a = (i / 200) * T2, r = R * 1.2 * (0.62 + 0.25 * Math.cos(3 * a)); i ? x.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r) : x.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
    x.stroke(); x.lineWidth = 1;
    x.strokeStyle = ink2(0.9); x.beginPath(); x.arc(cx, cy, R * 1.2, 0, T2); x.stroke(); x.beginPath(); x.arc(cx, cy, R * 1.2 + 3, 0, T2); x.strokeStyle = ink2(0.35); x.stroke();
  } else if (w === 3) {                                   // колба: поверхность жидкости — FM-волна
    const r = R * 0.95, by = cy + R * 0.3;
    x.save(); x.beginPath(); x.arc(cx, by, r, 0, T2); x.clip();
    x.fillStyle = 'rgba(206,62,42,0.8)'; x.beginPath(); x.moveTo(cx - r, by + r);
    for (let i = 0; i <= 80; i++) { const u = i / 80, ph = u * T2 * 2; x.lineTo(cx - r + u * 2 * r, by - r * 0.05 - Math.sin(ph + 2.2 * Math.sin(3 * ph)) * r * 0.12); }
    x.lineTo(cx + r, by + r); x.closePath(); x.fill(); x.restore();
    x.strokeStyle = ink2(0.9); x.lineWidth = 1.2; x.beginPath(); x.arc(cx, by, r, -Math.PI / 2 + 0.28, -Math.PI / 2 - 0.28 + T2); x.stroke();
    x.beginPath(); x.moveTo(cx - r * 0.27, by - r * 0.96); x.lineTo(cx - r * 0.27, by - r * 1.8); x.moveTo(cx + r * 0.27, by - r * 0.96); x.lineTo(cx + r * 0.27, by - r * 1.8); x.stroke();
    x.beginPath(); x.ellipse(cx, by - r * 1.8, r * 0.36, 2.5, 0, 0, T2); x.stroke();
    x.strokeStyle = ink2(0.35); x.beginPath(); x.arc(cx - r * 0.2, by, r * 0.62, Math.PI * 1.08, Math.PI * 1.4); x.stroke();
  } else if (w === 4) {                                   // кувшинка с цветком; под ней три волны: sine, square, triangle
    const rx = R * 1.1, ry = rx * 0.45, ly = cy - R * 0.1;
    x.fillStyle = `rgba(${(th && th.paper) || PAPER0},1)`; x.lineWidth = 1.2;
    x.beginPath(); x.ellipse(cx, ly, rx, ry, 0, 0.35, T2 - 0.05); x.lineTo(cx, ly); x.closePath(); x.fill(); x.stroke();
    x.lineWidth = 0.7; x.strokeStyle = ink2(0.45); x.beginPath();
    for (const q of [1.2, 2.1, 3.0, 3.9, 4.8]) { x.moveTo(cx, ly); x.lineTo(cx + Math.cos(q) * rx * 0.8, ly + Math.sin(q) * ry * 0.8); } x.stroke();
    x.strokeStyle = ink2(0.9); x.lineWidth = 1.1; x.fillStyle = `rgba(${(th && th.paper) || PAPER0},1)`;
    const fx0 = cx - rx * 0.15, fy0 = ly - ry * 0.45, s = R * 0.36;
    for (let k = 0; k < 8; k++) { x.save(); x.translate(fx0, fy0); x.rotate((k / 8) * T2); x.beginPath(); x.ellipse(0, -s * 0.62, s * 0.24, s * 0.5, 0, 0, T2); x.fill(); x.stroke(); x.restore(); }
    x.fillStyle = ink2(0.85); x.beginPath(); x.arc(fx0, fy0, s * 0.26, 0, T2); x.fill();
    const wy = cy + R * 0.95, ww = R * 0.55;
    x.strokeStyle = ink2(0.8); x.lineWidth = 1.1;
    [[-1, (u) => Math.sin(u * T2)], [0, (u) => (u < 0.5 ? 1 : -1)], [1, (u) => 1 - 4 * Math.abs(u - 0.5)]].forEach(([k, fn]) => {
      const ox = cx + k * ww * 1.35 - ww / 2; x.beginPath();
      for (let i = 0; i <= 30; i++) { const u = i / 30, y = wy - fn(u) * ww * 0.3; i ? x.lineTo(ox + u * ww, y) : x.moveTo(ox + u * ww, y); }
      x.stroke();
    });
  }
  if (w === 5) {                                          // воронка ада: круги сужаются вниз, на двух — пламя
    for (let k = 0; k < 6; k++) {
      const rx = R * (1.25 - k * 0.17), ry = rx * 0.16 + 1.5, y = cy - R * 0.75 + k * R * 0.3;
      x.strokeStyle = k === 2 || k === 4 ? 'rgba(226,99,42,0.9)' : ink2(0.85 - k * 0.08); x.beginPath(); x.ellipse(cx, y, rx, ry, 0, 0, T2); x.stroke();
      if (k === 2 || k === 4) { x.strokeStyle = 'rgba(226,99,42,0.8)'; x.beginPath(); for (let j = 0; j < 7; j++) { const a = Math.PI * (1 - (j + 0.5) / 7), px = cx - Math.cos(a) * rx, py = y + Math.sin(a) * ry; x.moveTo(px - 1.6, py); x.quadraticCurveTo(px, py - 7, px + 1.6, py); } x.stroke(); }
    }
    x.strokeStyle = 'rgba(185,210,223,0.8)'; x.beginPath(); x.ellipse(cx, cy + R * 1.05, R * 0.25, 3.5, 0, 0, T2); x.stroke();
  } else if (w === 6) {                                   // сферы рая вокруг розы
    for (let k = 0; k < 5; k++) { x.strokeStyle = ink2(0.75 - k * 0.1); x.beginPath(); x.ellipse(cx, cy, R * (0.45 + k * 0.2), R * (0.62 + k * 0.27), 0, 0, T2); x.stroke(); }
    x.strokeStyle = ink2(0.85); for (let j = 0; j < 8; j++) { const a = (j / 8) * T2; x.beginPath(); x.arc(cx + Math.cos(a) * R * 0.2, cy + Math.sin(a) * R * 0.22, R * 0.12, 0, T2); x.stroke(); }
  }
  if (w === 7) {                                          // монохорд: ящик, три струны, подставка, дуги интервалов справа
    const bw = R * 0.62, bh = R * 2.3, y0 = cy - bh / 2;
    x.strokeStyle = ink2(0.8); x.strokeRect(cx - bw / 2, y0, bw, bh);
    x.strokeStyle = ink2(0.9); x.beginPath(); for (let k = -1; k <= 1; k++) { x.moveTo(cx + k * bw * 0.28, y0 + 3); x.lineTo(cx + k * bw * 0.28, y0 + bh - 3); } x.stroke();
    const yb = y0 + bh * 0.62; x.fillStyle = ink2(0.9); x.beginPath(); x.moveTo(cx - bw * 0.42, yb + 3); x.lineTo(cx, yb - 3); x.lineTo(cx + bw * 0.42, yb + 3); x.closePath(); x.fill();
    x.strokeStyle = ink2(0.5); x.beginPath(); x.moveTo(cx + bw / 2 + 2, y0 + 3); x.quadraticCurveTo(cx + bw / 2 + R * 0.6, y0 + bh * 0.3, cx + bw / 2 + 2, y0 + bh / 2); x.quadraticCurveTo(cx + bw / 2 + R * 0.6, y0 + bh * 0.75, cx + bw / 2 + 2, y0 + bh - 3); x.stroke();
  }
  if (w === 8) {                                          // карта T-O: земля с буквой T, вокруг океан — волнистое кольцо
    const rd = R * 0.62;
    x.strokeStyle = ink2(0.85); x.beginPath(); x.arc(cx, cy, rd, 0, T2); x.stroke();
    x.strokeStyle = ink2(0.6); x.beginPath(); x.moveTo(cx - rd, cy); x.lineTo(cx + rd, cy); x.moveTo(cx, cy); x.lineTo(cx, cy + rd); x.stroke();
    x.strokeStyle = ink2(0.9); x.beginPath();
    for (let i = 0; i <= 120; i++) { const a = (i / 120) * T2, r = R * (1.02 + 0.1 * Math.sin(3 * a) + 0.05 * Math.sin(7 * a + 1)); i ? x.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r) : x.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
    x.stroke();
    x.fillStyle = ink2(0.85); x.beginPath(); x.arc(cx + R * 1.3, cy - R * 0.55, R * 0.16, 0, T2); x.fill();
    x.fillStyle = (th && th.bg) || BG0; x.beginPath(); x.arc(cx + R * 1.36, cy - R * 0.58, R * 0.14, 0, T2); x.fill();
  }
  if (w === 9) {                                          // волшебные числа: кольца IV, V, VI с метками, стрелка-солнце
    for (const [n, k] of [[4, 0.42], [5, 0.66], [6, 0.9]]) {
      const rr = R * k; x.strokeStyle = ink2(0.75); x.beginPath(); x.arc(cx, cy, rr, 0, T2); x.stroke();
      x.fillStyle = ink2(0.9); for (let j = 0; j < n; j++) { const a = (j / n) * T2; x.beginPath(); x.arc(cx + Math.sin(a) * rr, cy - Math.cos(a) * rr, R * 0.06, 0, T2); x.fill(); }
    }
    x.strokeStyle = ink2(0.9); x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.sin(2.4) * R * 1.02, cy - Math.cos(2.4) * R * 1.02); x.stroke();
    x.beginPath(); x.arc(cx + Math.sin(2.4) * R * 1.1, cy - Math.cos(2.4) * R * 1.1, R * 0.1, 0, T2); x.stroke();
    x.fillStyle = ink2(0.9); x.beginPath(); x.arc(cx, cy, R * 0.07, 0, T2); x.fill();
  }
  if (w === 10) {                                         // твердь: купол над землёй, звёзды-проколы, под ними — пульсареты
    const by = cy + R * 0.55, rr = R * 1.05;
    x.strokeStyle = ink2(0.85); x.beginPath(); x.arc(cx, by, rr, Math.PI, 0); x.stroke(); x.beginPath(); x.moveTo(cx - rr * 1.15, by); x.lineTo(cx + rr * 1.15, by); x.stroke();
    x.strokeStyle = ink2(0.9);
    for (const [sx, sy] of [[-0.45, -0.55], [0.3, -0.75], [0.55, -0.3], [-0.1, -0.25]]) { const px = cx + sx * rr, py = by + sy * rr; x.beginPath(); for (let k = 0; k < 8; k++) { const a = (k / 8) * T2, l = k % 2 ? 2 : 4; x.moveTo(px, py); x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); } x.stroke(); }
    x.strokeStyle = ink2(0.7); x.beginPath(); const py = by + R * 0.42;
    for (let i = 0; i <= 80; i++) { const u = i / 80, k = (u * 4) % 1, env = k < 0.35 ? Math.sin((Math.PI * k) / 0.35) ** 2 : 0, px = cx - R * 0.9 + u * R * 1.8, yy = py - Math.sin(k * 40) * env * R * 0.18; i ? x.lineTo(px, yy) : x.moveTo(px, yy); }
    x.stroke();
  }
  if (w === 11) {                                         // три тела на восьмёрке
    x.strokeStyle = ink2(0.6); x.beginPath();
    for (let i = 0; i <= 120; i++) { const t = (i / 120) * T2, px = cx + Math.sin(t) * R * 1.05, py = cy + Math.sin(2 * t) * R * 0.42; i ? x.lineTo(px, py) : x.moveTo(px, py); }
    x.stroke();
    x.strokeStyle = ink2(0.9); x.fillStyle = (th && th.bg) || BG0;
    for (const t of [0.4, 0.4 + T2 / 3, 0.4 + (2 * T2) / 3]) { const px = cx + Math.sin(t) * R * 1.05, py = cy + Math.sin(2 * t) * R * 0.42; x.beginPath(); x.arc(px, py, R * 0.16, 0, T2); x.fill(); x.stroke(); }
  }
  if (w === 12) {                                         // пейзаж в перспективе: горизонт, горы со штриховкой, холм, деревце, петля сканера с флажком
    const hy = cy - R * 0.35;
    x.strokeStyle = ink2(0.6); x.beginPath(); x.moveTo(cx - R * 1.15, hy); x.lineTo(cx + R * 1.15, hy); x.stroke();
    const mt = (mx, my, h, wd) => { x.fillStyle = (th && th.bg) || BG0; x.strokeStyle = ink2(0.9); x.beginPath(); x.moveTo(mx - wd / 2, my); x.quadraticCurveTo(mx - wd * 0.2, my - h * 0.45, mx, my - h); x.quadraticCurveTo(mx + wd * 0.18, my - h * 0.5, mx + wd / 2, my); x.fill(); x.stroke(); x.strokeStyle = ink2(0.5); x.beginPath(); for (let k = 1; k <= 3; k++) { const f = k / 4; x.moveTo(mx + wd * 0.5 * f, my - h * (1 - f)); x.lineTo(mx + wd * 0.5 * f - wd * 0.1, my); } x.stroke(); };
    mt(cx - R * 0.35, hy + R * 0.1, R * 0.75, R * 0.9); mt(cx + R * 0.25, hy + R * 0.15, R * 0.55, R * 0.8);
    x.strokeStyle = ink2(0.85); x.beginPath(); x.ellipse(cx + R * 0.1, cy + R * 0.55, R * 0.62, R * 0.2, 0, 0, T2); x.stroke();
    x.fillStyle = ink2(0.95); x.beginPath(); x.arc(cx + R * 0.72, cy + R * 0.55, 2, 0, T2); x.fill();
    x.strokeStyle = ink2(0.95); x.beginPath(); x.moveTo(cx + R * 0.1, cy + R * 0.55); x.lineTo(cx + R * 0.1, cy + R * 0.12); x.lineTo(cx + R * 0.36, cy + R * 0.2); x.lineTo(cx + R * 0.1, cy + R * 0.28); x.stroke();
    x.strokeStyle = 'rgba(46,86,104,0.85)'; x.beginPath(); x.moveTo(cx - R * 0.9, cy + R * 0.2); x.quadraticCurveTo(cx - R * 0.5, cy + R * 0.35, cx - R * 0.7, cy + R * 0.8); x.stroke();
  }
  if (w === 13) {                                         // бухта: маяк на мысу, луна, круги эха на воде
    const hy = cy + R * 0.05;
    x.strokeStyle = ink2(0.6); x.beginPath(); x.moveTo(cx - R * 1.15, hy); x.lineTo(cx + R * 1.15, hy); x.stroke();
    x.fillStyle = 'rgba(238,198,126,0.85)'; x.beginPath(); x.arc(cx - R * 0.45, cy - R * 0.45, R * 0.22, 0, T2); x.fill();
    x.fillStyle = (th && th.bg) || BG0; x.beginPath(); x.arc(cx - R * 0.36, cy - R * 0.5, R * 0.2, 0, T2); x.fill();
    const tx = cx + R * 0.55, ty = cy + R * 0.75;
    x.fillStyle = (th && th.bg) || BG0; x.strokeStyle = ink2(0.9); x.beginPath(); x.moveTo(tx - R * 0.16, ty); x.lineTo(tx - R * 0.1, ty - R * 0.9); x.lineTo(tx + R * 0.1, ty - R * 0.9); x.lineTo(tx + R * 0.16, ty); x.closePath(); x.fill(); x.stroke();
    x.fillStyle = 'rgba(238,198,126,0.9)'; x.fillRect(tx - R * 0.07, ty - R * 1.08, R * 0.14, R * 0.16);
    x.fillStyle = 'rgba(238,198,126,0.12)'; x.beginPath(); x.moveTo(tx, ty - R); x.lineTo(cx - R * 1.1, hy - R * 0.1); x.lineTo(cx - R * 1.1, hy + R * 0.25); x.closePath(); x.fill();
    x.strokeStyle = ink2(0.75); for (let k = 1; k <= 3; k++) { x.globalAlpha = 1 - k * 0.25; x.beginPath(); x.ellipse(cx - R * 0.25, cy + R * 0.55, R * 0.22 * k, R * 0.07 * k, 0, 0, T2); x.stroke(); } x.globalAlpha = 1;
  }
  if (w === 15) {                                         // круг заклинателя: двойное кольцо, восемь знаков, красная печать с кружком и чертой
    x.strokeStyle = ink2(0.85); x.beginPath(); x.arc(cx, cy, R * 1.05, 0, T2); x.stroke();
    x.strokeStyle = ink2(0.35); x.beginPath(); x.arc(cx, cy, R * 0.9, 0, T2); x.stroke();
    const P = (k) => [cx + Math.sin((k / 8) * T2) * R * 0.66, cy - Math.cos((k / 8) * T2) * R * 0.66];
    x.fillStyle = ink2(0.8); for (let k = 0; k < 8; k++) { const [px, py] = P(k); x.beginPath(); x.arc(px, py, R * 0.06, 0, T2); x.fill(); }
    const seal = [7, 3, 0, 5, 2].map(P);
    x.strokeStyle = 'rgba(206,66,48,0.95)'; x.lineWidth = 1.2; x.beginPath(); seal.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py))); x.stroke();
    x.beginPath(); x.arc(seal[0][0], seal[0][1], R * 0.11, 0, T2); x.stroke();
    const [ax, ay] = seal[3], [bx, by] = seal[4], d = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / d, uy = (by - ay) / d;
    x.beginPath(); x.moveTo(bx - uy * R * 0.16, by + ux * R * 0.16); x.lineTo(bx + uy * R * 0.16, by - ux * R * 0.16); x.stroke(); x.lineWidth = 1;
  }
  if (w === 17) {                                         // призма: белый луч слева, веер цветных лучей справа
    const px = cx - R * 0.15, py = cy, ps = R * 0.42;
    x.strokeStyle = 'rgba(255,255,255,0.9)'; x.lineWidth = 1.4; x.beginPath(); x.moveTo(cx - R * 1.1, cy - R * 0.25); x.lineTo(px - ps * 0.3, py); x.stroke(); x.lineWidth = 1;
    for (let k = 0; k < 7; k++) { x.strokeStyle = `hsla(${Math.round((k / 6) * 275)},85%,62%,0.9)`; x.beginPath(); x.moveTo(px + ps * 0.3, py); x.lineTo(cx + R * 1.1, cy - R * 0.45 + k * R * 0.15); x.stroke(); }
    x.fillStyle = (th && th.bg) || BG0; x.strokeStyle = ink2(0.95); x.beginPath();
    for (let k = 0; k < 3; k++) { const a = -Math.PI / 2 + (k / 3) * T2; k ? x.lineTo(px + Math.cos(a) * ps, py + Math.sin(a) * ps) : x.moveTo(px + Math.cos(a) * ps, py + Math.sin(a) * ps); }
    x.closePath(); x.fill(); x.stroke();
  }
  if (w === 18) {                                         // бокал с водой, рябь, серп луны
    const rx = R * 0.5, ry = R * 0.6, rim = cy - R * 0.45, wy = rim + ry * 0.45;
    x.fillStyle = 'rgba(120,164,210,0.25)'; x.save(); x.beginPath(); x.ellipse(cx, rim, rx, ry, 0, 0, Math.PI); x.clip(); x.fillRect(cx - rx, wy, rx * 2, ry); x.restore();
    x.strokeStyle = 'rgba(120,164,210,0.9)'; x.beginPath(); for (let i = 0; i <= 20; i++) { const u = i / 20, hw = rx * Math.sqrt(1 - 0.45 * 0.45), px = cx - hw + u * 2 * hw, yy = wy + Math.sin(u * Math.PI * 4) * 1.6; i ? x.lineTo(px, yy) : x.moveTo(px, yy); } x.stroke();
    x.strokeStyle = ink2(0.9); x.beginPath(); x.ellipse(cx, rim, rx, ry, 0, 0, Math.PI); x.stroke(); x.beginPath(); x.ellipse(cx, rim, rx, 2.5, 0, 0, T2); x.stroke();
    x.beginPath(); x.moveTo(cx, rim + ry); x.lineTo(cx, cy + R * 0.85); x.stroke(); x.beginPath(); x.ellipse(cx, cy + R * 0.85, rx * 0.55, 2, 0, 0, T2); x.stroke();
    x.fillStyle = 'rgba(238,226,186,0.9)'; x.beginPath(); x.arc(cx + R * 0.75, cy - R * 0.75, R * 0.16, 0, T2); x.fill();
    x.fillStyle = (th && th.bg) || BG0; x.beginPath(); x.arc(cx + R * 0.82, cy - R * 0.8, R * 0.14, 0, T2); x.fill();
  }
  // гравированный медальон: двойной круг, засечки по сторонам света, ромбики на диагоналях
  const M = M0, my = mc;
  x.lineWidth = 1; x.strokeStyle = ink2(0.8); x.beginPath(); x.arc(cx, my, M, 0, T2); x.stroke();
  x.strokeStyle = ink2(0.3); x.beginPath(); x.arc(cx, my, M - 5, 0, T2); x.stroke();
  x.strokeStyle = ink2(0.55); x.beginPath();
  for (let k = 0; k < 4; k++) { const a = (k / 4) * T2; x.moveTo(cx + Math.cos(a) * (M + 2), my + Math.sin(a) * (M + 2)); x.lineTo(cx + Math.cos(a) * (M + 8), my + Math.sin(a) * (M + 8)); }
  x.stroke();
  x.fillStyle = ink2(0.5);
  for (let k = 0; k < 4; k++) { const a = Math.PI / 4 + (k / 4) * T2, px = cx + Math.cos(a) * (M - 2.5), py = my + Math.sin(a) * (M - 2.5); x.beginPath(); x.moveTo(px, py - 2.4); x.lineTo(px + 1.6, py); x.lineTo(px, py + 2.4); x.lineTo(px - 1.6, py); x.closePath(); x.fill(); }
  x.textAlign = 'center'; x.textBaseline = 'middle';
  const fit = (str, sz, maxW) => { x.font = `italic ${sz}px ${MAP}`; while (sz > 7 && x.measureText(str).width > maxW) { sz -= 0.5; x.font = `italic ${sz}px ${MAP}`; } };
  const info = worlds[w] || WORLDS[w] || { n: '', title: '' };
  fit(info.n, big ? 15 : 12, pw - 12); x.fillStyle = ink2(0.75); x.fillText(info.n, cx, 15);
  fit(info.title, big ? 16 : 12, pw - 10); x.fillStyle = ink2(0.95); x.fillText(info.title, cx, ph - (big ? 34 : 14));
  if (big) { fit(EMB_LINE[w] || '', 12, pw - 14); x.fillStyle = ink2(0.55); x.fillText(EMB_LINE[w] || '', cx, ph - 16); }
  emblems[w] = { key, c };
  return c;
}
let backC = null, backKey = '';
function cardBack(F) {                                  // рубашка: двойная рамка, ромбическая сетка гравюры, восьмиконечная звезда в круге
  const pw = F.cw, ph = F.ch, key = `${pw}x${ph}|${DPR}`;
  if (backC && backKey === key) return backC;
  backKey = key; backC = document.createElement('canvas'); backC.width = Math.round(pw * DPR); backC.height = Math.round(ph * DPR);
  const x = backC.getContext('2d'), T2 = Math.PI * 2, ik = (a) => `rgba(${INK0},${a})`;
  x.setTransform(DPR, 0, 0, DPR, 0, 0);
  x.fillStyle = BG0; x.fillRect(0, 0, pw, ph);
  x.lineWidth = 1; x.strokeStyle = ik(0.5); x.strokeRect(1.5, 1.5, pw - 3, ph - 3);
  x.strokeStyle = ik(0.22); x.strokeRect(4.5, 4.5, pw - 9, ph - 9);
  x.save(); x.beginPath(); x.rect(7, 7, pw - 14, ph - 14); x.clip();
  x.strokeStyle = ik(0.09); x.lineWidth = 0.8; x.beginPath();
  for (let d = -ph; d < pw + ph; d += 8) { x.moveTo(d, 0); x.lineTo(d + ph * 0.6, ph); x.moveTo(d, ph); x.lineTo(d + ph * 0.6, 0); }
  x.stroke(); x.restore();
  const cx = pw / 2, cy = ph / 2, r = Math.min(pw * 0.3, ph * 0.2);
  x.fillStyle = BG0; x.beginPath(); x.arc(cx, cy, r + 3, 0, T2); x.fill();
  x.lineWidth = 1; x.strokeStyle = ik(0.45); x.beginPath(); x.arc(cx, cy, r, 0, T2); x.stroke();
  x.strokeStyle = ik(0.2); x.beginPath(); x.arc(cx, cy, r - 3, 0, T2); x.stroke();
  x.strokeStyle = ik(0.5); x.beginPath();
  for (let k = 0; k < 8; k++) { const a = (k / 8) * T2 - Math.PI / 2, b = a + T2 / 16; x[k ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r * 0.78, cy + Math.sin(a) * r * 0.78); x.lineTo(cx + Math.cos(b) * r * 0.3, cy + Math.sin(b) * r * 0.3); }
  x.closePath(); x.stroke();
  x.fillStyle = ik(0.5); x.beginPath(); x.arc(cx, cy, 1.6, 0, T2); x.fill();
  for (const y of [12, ph - 12]) { x.beginPath(); x.moveTo(cx, y - 3.5); x.lineTo(cx + 1.4, y); x.lineTo(cx, y + 3.5); x.lineTo(cx - 1.4, y); x.closePath(); x.fill(); }
  return backC;
}

export function drawNav(now) {
  setTheme(null);                             // карта — чёрная, как Tenebrae
  let k = 1, a = nav.anim;
  if (a) {
    k = clamp((now - a.t0) / NAV_MS);
    if (k >= 1) {
      nav.anim = null;
      if (a.dir === 'in') { nav.view = 'play'; if (worlds[a.w].enter) worlds[a.w].enter(); }
      if (nav.view === 'play') return false;          // дальше рисует обычный кадр
      a = null; k = 1;
    }
  }
  g.fillStyle = BG; g.fillRect(0, 0, W, H);
  // карта: доля «отъезда» камеры — 0 во весь экран мира, 1 — карта
  const out = a ? (a.dir === 'out' ? easeIO(k) : 1 - easeIO(k)) : 1;
  const focus = a ? a.w : 0;
  const F = field(), back = cardBack(F), pk = nav.peek && now - nav.peek.t0 < 420 ? nav.peek : null;
  for (let c = 0; c < GRID; c++) for (let r = 0; r < GRID; r++) {   // рубашки — неоткрытые миры; тронутая вздрагивает
    if (cellWorld(c, r)) continue;
    const p = cellRect(c, r, F), on = pk && pk.c === c && pk.r === r, q = on ? Math.sin((Math.PI * (now - pk.t0)) / 420) : 0;
    g.globalAlpha = out;
    if (on) { g.save(); g.translate(p[0] + p[2] / 2, 0); g.scale(1 - 0.3 * q, 1); g.drawImage(back, -p[2] / 2, p[1], p[2], p[3]); g.restore(); mapText('nondum', p[0] + p[2] / 2, p[1] + p[3] / 2, 11, 0.8 * q, 'center'); }
    else g.drawImage(back, p[0], p[1], p[2], p[3]);
    g.globalAlpha = 1;
  }
  pollLevels(now);
  for (const w of mapWorlds()) {                       // лицом вверх — открытые миры; мир, в который летим / из которого вышли, — его снимок, тает
    const p = panel(w), em = emblemFor(w);
    if (em) { g.globalAlpha = out; g.drawImage(em, p[0], p[1], p[2], p[3]); g.globalAlpha = 1; }
    const lv = chanLvl[w] || 0;
    if (lv > 0.0025 && out > 0.5) {                    // звучит: вокруг карты лучи, как у солнца, — дышат уровнем этого мира
      const k = clamp(Math.sqrt(lv) * 2.2), cxp = p[0] + p[2] / 2, cyp = p[1] + p[3] / 2, n = 28;
      g.globalAlpha = out; g.strokeStyle = ink(0.25 + 0.6 * k); g.lineWidth = 1; g.beginPath();
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + now * 0.0002, c = Math.cos(a), sn = Math.sin(a), tt = Math.min(Math.abs((p[2] / 2) / (c || 1e-6)), Math.abs((p[3] / 2) / (sn || 1e-6)));
        const l = (i % 2 ? 2 : 4) + 7 * k * (0.6 + 0.4 * Math.sin(now * 0.006 + i));
        g.moveTo(cxp + c * (tt + 2), cyp + sn * (tt + 2)); g.lineTo(cxp + c * (tt + 2 + l), cyp + sn * (tt + 2 + l));
      }
      g.stroke(); hairBox(p[0] - 2, p[1] - 2, p[2] + 4, p[3] + 4, 0.3 + 0.5 * k); g.globalAlpha = 1;
    }
    const shot = snaps[w];
    if (w === focus && shot && out < 1) {
      const r = [p[0] * out, p[1] * out, W + (p[2] - W) * out, H + (p[3] - H) * out];
      g.globalAlpha = 1 - out; g.drawImage(shot, r[0], r[1], r[2], r[3]); g.globalAlpha = 1;
    }
  }
  if (out > 0.02) drawMapChrome(out, now);
  if (nav.settings === 'mix' && !a) drawMixer(now); else if (nav.settings && !a) drawSettings();
  return true;
}

// карта: декартовы оси с делениями, солнце в центре, номера и имена миров
function drawMapChrome(al, now) {
  const F = field(), cx = F.sx, cy = F.sy;
  g.globalAlpha = al;
  g.strokeStyle = ink(0.45); g.lineWidth = 1;             // эклиптика поперёк расклада с делениями
  g.beginPath(); g.moveTo(F.x0, cy + 0.5); g.lineTo(F.x0 + F.fw, cy + 0.5); g.stroke();
  g.strokeStyle = ink(0.28); g.beginPath();
  for (let d = 12; d < F.fw / 2; d += 12) { const l = (d / 12) % 5 ? 2.5 : 5; g.moveTo(cx + d, cy - l); g.lineTo(cx + d, cy + l); g.moveTo(cx - d, cy - l); g.lineTo(cx - d, cy + l); }
  g.stroke();
  g.fillStyle = BG; g.beginPath(); g.arc(cx, cy, 20, 0, Math.PI * 2); g.fill();   // солнце в середине расклада
  sunGlyph(g, cx, cy, 0, Math.PI * 2, 0.6, now);
  if (!nav.settings) {                                  // подпись солнца — что за ним: общие настройки
    g.font = `italic 12px ${MAP}`; const lw = g.measureText('concordia').width + 14;
    g.fillStyle = BG; g.fillRect(cx + 34, cy - 9, lw, 18);
    mapText('concordia', cx + 41, cy, 12, 0.65, 'left');
  }
  const dlc = deck !== 'main', tw = dlc ? 250 : 184;
  g.fillStyle = paper(0.7); g.fillRect(W / 2 - tw / 2, scopeY - 6, tw, 34);   // имя всей карты; у DLC — ещё «vol. I»
  g.font = `20px ${MAP}`; g.fillStyle = ink(0.95); g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('U N I V E R S U M', W / 2 - (dlc ? 30 : 0), scopeY + 11);
  if (dlc) mapText('vol. I', W / 2 + 70, scopeY + 12, 15, 0.8, 'left');
  const fl = nav.deckAt ? 1 - (now - nav.deckAt) / 700 : 0;   // колода сменилась — надпись вспыхивает
  if (fl > 0) hairBox(W / 2 - tw / 2 - 3, scopeY - 9, tw + 6, 40, 0.9 * fl);
  g.globalAlpha = 1;
}
