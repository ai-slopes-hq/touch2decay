// старые гравюры миров II–IV (art/): на карте не используются, картинки грузятся при первом выходе на карту
import { DPR, H, INK, sunGlyph, W } from './draw.js';
import { MAP } from './fonts.js';
const arts = {};                                        // гравюры миров II–IV, рисуются один раз на размер экрана
// настоящие гравюры (art/, обработка — tools/ink.py, источники — art/CREDITS.md); грузятся при первом выходе на карту
const ART_SRC = { leo: 'leo-viridis.png', leoWash: 'leo-viridis-wash.png', fons: 'fons-mercurialis.png', terra: 'terra-octobre.jpg' };
const artImg = {};
let artReady = 0;
export function loadArt() {
  if (artImg.leo) return;
  for (const [k, f] of Object.entries(ART_SRC)) {
    const im = new Image();
    im.onload = () => { im.ok = true; artReady++; };
    im.src = `art/${f}`;
    artImg[k] = im;
  }
}
const img = (k) => (artImg[k] && artImg[k].ok ? artImg[k] : null);
let leoSun = null;                                      // в Rosarium солнце — солнце с гравюры льва
// угол, где в каждом мире стоит солнце (смежный с центром карты)
const sunCorner = (w) => [null, null, [W, H], [W, 0], [0, 0], [0, H], [W, H]][w];   // у мира I солнце в его поле, гравюры нет

// ---------- гравюры миров: у каждого своя палитра ----------
// Cabbala (II) — ночное небо: индиго, сусальное золото, сфиры в традиционных цветах.
// Rosarium (III) — раскрашенная алхимическая гравюра: пергамент, сепия, киноварь, охра, лазурь, ярь-медянка, золото.
// Regnum — средневековая живопись (часослов, Джотто, Дуччо): ультрамарин, сусальное золото, малахит, охра, киноварь, свинцовые белила
const PALS = {
  2: { ink: '214,180,96', paper: ['#1f2658', '#060918'], red: '170,40,40', gold: '222,186,96', white: '236,232,220', disc: '#e2b84a', disc2: '#10153a' },
  3: { ink: '62,42,26', paper: ['#efe3c6', '#cdb68a'], red: '178,52,38', gold: '190,140,44', green: '74,122,96', blue: '44,72,128', disc: '#e8c25a' },
  4: { ink: '28,20,14', paper: ['#2c4fa8', '#13245e'], red: '176,50,38', gold: '214,170,64', green: '70,128,78', blue: '44,86,170', ochre: '186,138,62', white: '246,240,224', disc: '#d6aa40' },
};
let PAL = null;
const P = (a) => `rgba(${PAL ? PAL.ink : INK},${a})`;
const C = (k, a) => `rgba(${PAL[k]},${a})`;

export function artFor(w) {
  const key = `${w}|${W}x${H}|${DPR}|${artReady}`;
  if (arts[w] && arts[w].key === key) return arts[w].c;
  const c = document.createElement('canvas');
  c.width = Math.round(W * DPR); c.height = Math.round(H * DPR);
  const x = c.getContext('2d');
  x.setTransform(DPR, 0, 0, DPR, 0, 0);
  PAL = PALS[w];
  // фон: бумага / ткань с затенёнными краями
  const bg = x.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.2, W / 2, H / 2, Math.hypot(W, H) * 0.6);
  bg.addColorStop(0, PAL.paper[0]); bg.addColorStop(1, PAL.paper[1]);
  x.fillStyle = bg; x.fillRect(0, 0, W, H);
  ({ 2: artCabbala, 3: artRosarium, 4: artRegnum })[w](x);
  // рамка: двойная линия; у Regnum — золотая кайма, как в рукописи
  if (w === 4) { x.strokeStyle = C('gold', 0.9); x.lineWidth = 3; x.strokeRect(6, 6, W - 12, H - 12); x.lineWidth = 1; x.strokeStyle = C('red', 0.7); x.strokeRect(11.5, 11.5, W - 23, H - 23); }
  else { x.strokeStyle = P(0.45); x.lineWidth = 1; x.strokeRect(4.5, 4.5, W - 9, H - 9); x.strokeStyle = P(0.2); x.strokeRect(9.5, 9.5, W - 19, H - 19); }
  const sc = sunCorner(w), q = { 2: [Math.PI, Math.PI * 1.5], 3: [Math.PI / 2, Math.PI], 4: [0, Math.PI / 2] }[w];
  if (!(w === 3 && leoSun)) sunGlyph(x, sc[0], sc[1], q[0], q[1], { 2: 1.3, 3: 1.5, 4: 1.9 }[w], 0, PAL.gold, PAL.disc);
  x.font = `italic 15px ${MAP}`; x.fillStyle = w === 4 || w === 2 ? C('white', 0.7) : P(0.65); x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('terra incognita · nondum', W / 2, H - 32);
  PAL = null;
  arts[w] = { key, c };
  return c;
}

function caps(x, s, X, Y, size, fill, spacing = 3) {   // разрядка заглавных, как на гравюре
  x.font = `${size}px ${MAP}`; x.fillStyle = fill; x.textBaseline = 'middle'; x.textAlign = 'left';
  const w = [...s].reduce((n, ch) => n + x.measureText(ch).width + spacing, -spacing);
  let px = X - w / 2;
  for (const ch of s) { x.fillText(ch, px, Y); px += x.measureText(ch).width + spacing; }
}
function hatch(x, ang, step, style, clipFn, lw = 0.7) {   // штриховка, как резцом
  x.save(); if (clipFn) { x.beginPath(); clipFn(); x.clip(); }
  x.strokeStyle = style; x.lineWidth = lw; x.beginPath();
  const L = Math.hypot(W, H), c = Math.cos(ang), s = Math.sin(ang);
  for (let d = -L; d < L; d += step) {
    const mx = W / 2 + -s * d, my = H / 2 + c * d;
    x.moveTo(mx - c * L, my - s * L); x.lineTo(mx + c * L, my + s * L);
  }
  x.stroke(); x.restore();
}
const itext = (x, s, X, Y, size, fill, align = 'center') => {
  x.font = `italic ${size}px ${MAP}`; x.fillStyle = fill; x.textAlign = align; x.textBaseline = 'middle'; x.fillText(s, X, Y);
};
// слой чернил (альфа = линия) → покрасить в цвет мира
function inked(im, col) {
  const c = document.createElement('canvas');
  c.width = im.naturalWidth; c.height = im.naturalHeight;
  const x = c.getContext('2d');
  x.drawImage(im, 0, 0);
  x.globalCompositeOperation = 'source-in'; x.fillStyle = `rgb(${col})`; x.fillRect(0, 0, c.width, c.height);
  return c;
}

// II — Cabbala: ночное небо и Древо сфирот Афанасия Кирхера (1652), гравюра сусальным золотом;
// десять сфирот подложены традиционными цветами. Солнце участвует: золотой луч из угла входит в Тиферет — сфиру Солнца
const KIRCHER = {                                       // центры колец на гравюре, в долях картинки; радиус — доля ширины
  r: 0.084,
  Kether: [0.505, 0.165, '250,248,240'], Chokmah: [0.745, 0.290, '150,150,160'], Binah: [0.263, 0.284, '24,24,30'],
  Chesed: [0.744, 0.476, '50,90,190'], Geburah: [0.257, 0.473, '190,40,40'], Tiphareth: [0.506, 0.606, '226,184,74'],
  Netzach: [0.744, 0.690, '40,160,90'], Hod: [0.256, 0.690, '226,128,40'], Yesod: [0.515, 0.779, '120,60,170'], Malkuth: [0.518, 0.923, null],
};
function artCabbala(x) {
  let seed = 5;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 160; i++) {                      // звёзды
    const X = rnd() * W, Y = rnd() * H, r = rnd() < 0.12 ? 1.6 : 0.8;
    x.fillStyle = C('gold', 0.25 + 0.55 * rnd()); x.beginPath(); x.arc(X, Y, r, 0, Math.PI * 2); x.fill();
  }
  caps(x, 'CABBALA', W / 2, H * 0.06 + 16, 18, C('gold', 1), 6);
  itext(x, 'arbor vitae · decem sephiroth', W / 2, H * 0.06 + 38, 13, C('white', 0.8));
  const tree = img('kircher');
  if (!tree) return;
  const top = H * 0.06 + 58, bot = H - 52;
  const tw = Math.min(W - 24, (bot - top) * tree.naturalWidth / tree.naturalHeight), th = tw * tree.naturalHeight / tree.naturalWidth;
  const tx = (W - tw) / 2, ty = top + (bot - top - th) * 0.35;
  const pt = (k) => [tx + KIRCHER[k][0] * tw, ty + KIRCHER[k][1] * th], R = KIRCHER.r * tw;
  // луч солнца из угла в Тиферет — под гравюрой
  const sc = sunCorner(2), tp = pt('Tiphareth');
  for (let k = -3; k <= 3; k++) {
    x.strokeStyle = C('gold', 0.22 - Math.abs(k) * 0.05); x.lineWidth = 1;
    x.beginPath(); x.moveTo(sc[0], sc[1]); x.lineTo(tp[0] + k * 6, tp[1] + k * 3); x.stroke();
  }
  // сфиры — пятна цвета под кольцами
  for (const k of Object.keys(KIRCHER)) {
    if (k === 'r') continue;
    const [X, Y] = pt(k), col = KIRCHER[k][2];
    if (col) { x.fillStyle = `rgba(${col},0.6)`; x.beginPath(); x.arc(X, Y, R, 0, Math.PI * 2); x.fill(); }
    else {                                              // Малкут — четыре цвета стихий
      ['200,180,60', '110,120,50', '140,60,40', '20,20,20'].forEach((c, i) => {
        x.fillStyle = `rgba(${c},0.6)`; x.beginPath(); x.moveTo(X, Y); x.arc(X, Y, R, -Math.PI / 4 + (i * Math.PI) / 2, Math.PI / 4 + (i * Math.PI) / 2); x.closePath(); x.fill();
      });
    }
  }
  x.drawImage(inked(tree, PAL.gold), tx, ty, tw, th);
}

// III — Rosarium: «Розарий философов» (Франкфурт, 1550). Вверху справа зелёный лев пожирает солнце
// (ксилография, раскраска отмывкой: зелёный лев, золотое солнце, кровь) — солнце гравюры и есть солнце мира;
// ниже — ртутный фонтан, первая гравюра «Розария»; внизу розовый сад
const LEO_SUN = [0.716, 0.21];                          // солнце на гравюре льва, в долях (как SUN в tools/ink.py)
function artRosarium(x) {
  hatch(x, Math.PI / 4, 9, P(0.035));
  leoSun = null;
  const leo = img('leo'), wash = img('leoWash'), fons = img('fons');
  let y = 12;
  if (leo) {
    const lw = Math.min(W * 0.86, H * 0.42), lh = lw * leo.naturalHeight / leo.naturalWidth, lx = W - lw + 6;
    if (wash) { x.imageSmoothingQuality = 'high'; x.drawImage(wash, lx, y, lw, lh); }
    x.drawImage(inked(leo, PAL.ink), lx, y, lw, lh);
    leoSun = [lx + LEO_SUN[0] * lw, y + LEO_SUN[1] * lh];
    y += lh;
    itext(x, 'leo viridis solem devorat', W - 22, y + 2, 12, P(0.75), 'right');
    y += 14;
  }
  if (fons) {
    const fw = Math.min(W * 0.8, (H * 0.84 - y) * fons.naturalWidth / fons.naturalHeight), fh = fw * fons.naturalHeight / fons.naturalWidth;
    x.drawImage(inked(fons, PAL.ink), (W - fw) / 2, y, fw, fh);
    itext(x, 'fons mercurialis', W / 2, y + fh + 12, 12, P(0.7));
  }
  // розовый сад внизу: живая изгородь и розы
  const gy = H * 0.9;
  x.strokeStyle = C('green', 0.85); x.lineWidth = 1;
  for (let gx = 20; gx < W - 20; gx += 22) { x.beginPath(); x.arc(gx + 11, gy, 11, Math.PI, 0); x.stroke(); }
  for (let gx = 30; gx < W - 20; gx += 44) {
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; x.fillStyle = C('red', 0.75); x.beginPath(); x.arc(gx + Math.cos(a) * 3.2, gy - 10 + Math.sin(a) * 3.2, 3.2, 0, Math.PI * 2); x.fill(); }
    x.fillStyle = C('gold', 0.9); x.beginPath(); x.arc(gx, gy - 10, 1.6, 0, Math.PI * 2); x.fill();
  }
  // лента с названием и четыре стихии — четыре оператора
  const by = H * 0.06 + 14, bx0 = 16, bx1 = W * 0.46, bm = (bx0 + bx1) / 2;
  x.strokeStyle = P(0.8); x.lineWidth = 1; x.fillStyle = '#f6edd6';
  x.beginPath();
  x.moveTo(bx0, by - 14); x.quadraticCurveTo(bm, by - 24, bx1, by - 14);
  x.lineTo(bx1, by + 14); x.quadraticCurveTo(bm, by + 4, bx0, by + 14); x.closePath(); x.fill(); x.stroke();
  caps(x, 'ROSARIUM', bm, by - 5, 15, C('red', 0.95), 4);
  caps(x, 'PHILOSOPHORUM', bm, by + 9, 10, P(0.85), 2.5);
  const el = [['up', false, 'red'], ['up', true, 'gold'], ['down', false, 'blue'], ['down', true, 'green']];
  el.forEach(([dir, bar, col], i) => {
    const X = bx0 + 20 + i * 26, Y = by + 40, s = 8, u2 = dir === 'up' ? -1 : 1;
    x.beginPath(); x.moveTo(X, Y + u2 * s); x.lineTo(X - s * 0.9, Y - u2 * s * 0.6); x.lineTo(X + s * 0.9, Y - u2 * s * 0.6); x.closePath();
    x.fillStyle = C(col, 0.75); x.fill(); x.strokeStyle = P(0.9); x.lineWidth = 1; x.stroke();
    if (bar) { x.beginPath(); x.moveTo(X - s * 0.7, Y); x.lineTo(X + s * 0.7, Y); x.stroke(); }
  });
  itext(x, 'operatores quattuor', bx0 + 8, by + 60, 12, P(0.7), 'left');
}

// IV — Regnum: «Октябрь» из «Великолепного часослова герцога Беррийского» (братья Лимбург, ок. 1415):
// ультрамарин, сусальное золото, Лувр над Сеной, пахарь и сеятель. Солнце в углу светит на всё небо
function artRegnum(x) {
  const pic = img('terra');
  if (pic) {                                            // во весь экран, по высоте (обрезаются края)
    const k = Math.max(W / pic.naturalWidth, H / pic.naturalHeight), pw = pic.naturalWidth * k, ph = pic.naturalHeight * k;
    x.imageSmoothingQuality = 'high';
    x.drawImage(pic, (W - pw) / 2, (H - ph) / 2, pw, ph);
  }
  // название — на тёмной полосе внизу, чтобы не спорить с миниатюрой
  const fade = x.createLinearGradient(0, H * 0.8, 0, H);
  fade.addColorStop(0, 'rgba(10,14,34,0)'); fade.addColorStop(0.45, 'rgba(10,14,34,0.75)'); fade.addColorStop(1, 'rgba(10,14,34,0.9)');
  x.fillStyle = fade; x.fillRect(0, H * 0.8, W, H * 0.2);
  caps(x, 'REGNUM', W / 2, H - 92, 20, C('gold', 1), 6);
  itext(x, 'tres undae · echo et reverberatio', W / 2, H - 66, 13, C('white', 0.85));
}
