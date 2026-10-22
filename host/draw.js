// примитивы гравюры: холст, чернила и бумага (тема мира), кружки, рамки, подписи, свечение, солнца
import { clamp, $ } from './util.js';
import { face } from './fonts.js';
// чернила и бумага — у мира может быть своя тема (theme: { ink, bg, paper }): Regnum — чёрным по сепии
export const INK0 = '237,237,237', BG0 = '#000', PAPER0 = '0,0,0';
export let INK = INK0;                            // rgb без альфы
export const LINE = 'rgba(237,237,237,0.10)';
export let BG = BG0, PAPER = PAPER0;              // PAPER — rgb подложек под кнопками и панелями
export const paper = (a) => `rgba(${PAPER},${a})`;
export function setTheme(t) { INK = (t && t.ink) || INK0; BG = (t && t.bg) || BG0; PAPER = (t && t.paper) || PAPER0; }

// холст на весь экран; W, H — в CSS-пикселях, DPR — плотность (не больше 2×)
export const cv = $('field');
export const g = cv.getContext('2d');
export let W = 0, H = 0, DPR = 1;
export function fitCanvas() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);   // 3× на iPhone — в 2.25 раза больше пикселей, на глаз почти то же
  W = window.innerWidth; H = window.innerHeight;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
}

export const ink = (a) => `rgba(${INK},${a})`;
// мягкое круглое свечение — рисуется один раз, потом только штампуется (солнце, туманности)
const glowSprite = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'), gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, `rgba(${INK},1)`); gr.addColorStop(0.35, `rgba(${INK},0.45)`); gr.addColorStop(1, `rgba(${INK},0)`);
  x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
  return c;
})();
export function glowAt(x, y, r, a) {
  if (a <= 0.003) return;
  const ga = g.globalAlpha;
  g.globalAlpha = ga * Math.min(1, a); g.drawImage(glowSprite, x - r, y - r, 2 * r, 2 * r); g.globalAlpha = ga;
}
export function mapText(s, x, y, size, a, align = 'left', italic = true) {
  g.font = `${italic ? 'italic ' : ''}${size}px ${face}`; g.fillStyle = ink(a); g.textAlign = align; g.textBaseline = 'middle';
  g.fillText(s, x, y);
}
export function ring(x, y, r, a, w) {
  g.lineWidth = w; g.strokeStyle = ink(a);
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
}
export function dot(x, y, r, a) {
  g.fillStyle = ink(a);
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
}
export function diamond(x, y, s, a, filled) {
  g.save(); g.translate(x, y); g.rotate(Math.PI / 4);
  g.fillStyle = filled ? ink(a) : BG; g.fillRect(-s, -s, 2 * s, 2 * s);
  g.strokeStyle = ink(a); g.lineWidth = 1.3; g.strokeRect(-s, -s, 2 * s, 2 * s);
  g.restore();
}
export function hairBox(x, y, w, h, a) {           // тонкая рамка: панели из той же графики, что поле
  g.strokeStyle = ink(a); g.lineWidth = 1;
  g.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
}
// один шрифт на всё — IM Fell English: в интерфейсе прямой, на карте курсив (mapText).
// У него мельче очко, поэтому кегль чуть больше; жирного начертания нет — акцент яркостью
export function text(s, x, y, size, a, weight = 400, align = 'left') {
  g.font = `${size + 2}px ${face}`; g.fillStyle = ink(a); g.textAlign = align; g.textBaseline = 'middle';
  g.fillText(s, x, y);
}

// кривая по функции одного цикла: формы таблиц и LFO
export function drawCurve(fn, x, y, w, h, a, cycles = 2, lw = 1.6) {
  g.save();
  g.strokeStyle = ink(a); g.lineWidth = lw; g.lineJoin = 'round';
  g.beginPath();
  const N = 96;
  for (let i = 0; i <= N; i++) {
    const t = i / N, v = clamp(fn((t * cycles) % 1), -1.2, 1.2);
    const px = x - w / 2 + t * w, py = y - (v * h) / 2;
    if (i) g.lineTo(px, py); else g.moveTo(px, py);
  }
  g.stroke();
  g.restore();
}

// гравированное солнце для карты и миров: двойной диск, лучи прямые и волнистые через один (в секторе a0..a1).
// col — цвет линий (rgb), disc — заливка диска
export function sunGlyph(x, ox, oy, a0, a1, scale = 1, now = 0, col = INK, disc = BG) {
  const rot = now * 0.00004, N = 28;
  x.lineWidth = 0.9;
  for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI * 2 + rot;
    const aa = ((a - a0) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    if (aa > a1 - a0 + 0.05) continue;
    const c = Math.cos(a), s = Math.sin(a), px = -s, py = c;
    if (k % 2) {
      const l = 50 * scale, w = 2.6;
      x.strokeStyle = `rgba(${col},0.7)`;
      x.beginPath(); x.moveTo(ox + c * 17 + px * w, oy + s * 17 + py * w); x.lineTo(ox + c * l, oy + s * l);
      x.lineTo(ox + c * 17 - px * w, oy + s * 17 - py * w); x.stroke();
    } else {
      const l = 38 * scale;
      x.strokeStyle = `rgba(${col},0.5)`;
      x.beginPath();
      for (let i = 0; i <= 14; i++) {
        const t = i / 14, r = 17 + t * (l - 17), wv = Math.sin(t * Math.PI * 3) * 2.2 * (1 - t * 0.5);
        const X = ox + c * r + px * wv, Y = oy + s * r + py * wv;
        if (i) x.lineTo(X, Y); else x.moveTo(X, Y);
      }
      x.stroke();
    }
  }
  x.fillStyle = disc; x.beginPath(); x.arc(ox, oy, 14, 0, Math.PI * 2); x.fill();
  x.strokeStyle = `rgba(${col},0.85)`; x.lineWidth = 1; x.beginPath(); x.arc(ox, oy, 14, 0, Math.PI * 2); x.stroke();
  x.strokeStyle = `rgba(${col},0.45)`; x.lineWidth = 0.8; x.beginPath(); x.arc(ox, oy, 10.5, 0, Math.PI * 2); x.stroke();
}

// солнце Таро четвертью из верхнего угла (миры III и IV): выходит из-под верхней строки, лицо смотрит в картинку,
// лучи прямые и волнистые через один. side: 1 — угол слева (лучи вправо-вниз), −1 — справа. col — rgb линий, disc — заливка
// top — верх видимой части (по умолчанию oy — ровно четверть); выше — солнце садится, видна и верхняя половина диска с лучами
export function quarterSun(x, ox, oy, r, side, now, col = INK, disc = BG, top = oy) {
  const ink2 = (a) => `rgba(${col},${a})`, rot = now * 0.00003, N = 28, half = top < oy - 1;
  x.save(); x.beginPath(); x.rect(side > 0 ? ox : 0, top, side > 0 ? W : ox, H); x.clip();
  x.translate(ox, oy); x.scale(side, 1);
  for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI * 2 + rot, aa = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    if (aa > Math.PI / 2 + 0.1 && !(half && aa > Math.PI * 1.5 - 0.1)) continue;
    const cs = Math.cos(a), sn = Math.sin(a), px = -sn, py = cs;
    if (k % 2) {
      const l = r * 2.05, w = 5;
      x.strokeStyle = ink2(0.75); x.lineWidth = 1.1; x.fillStyle = disc;
      x.beginPath(); x.moveTo(cs * r + px * w, sn * r + py * w); x.lineTo(cs * l, sn * l); x.lineTo(cs * r - px * w, sn * r - py * w); x.fill(); x.stroke();
    } else {
      const l = r * 1.65;
      x.strokeStyle = ink2(0.55); x.lineWidth = 1;
      x.beginPath();
      for (let i = 0; i <= 18; i++) { const t = i / 18, rr = r + t * (l - r), wv = Math.sin(t * Math.PI * 3) * 3.5 * (1 - t * 0.5), X = cs * rr + px * wv, Y = sn * rr + py * wv; i ? x.lineTo(X, Y) : x.moveTo(X, Y); }
      x.stroke();
    }
  }
  x.fillStyle = disc; x.beginPath(); x.arc(0, 0, r, 0, Math.PI * 2); x.fill();
  x.strokeStyle = ink2(0.9); x.lineWidth = 1.6; x.beginPath(); x.arc(0, 0, r, 0, Math.PI * 2); x.stroke();
  x.strokeStyle = ink2(0.45); x.lineWidth = 0.9; x.beginPath(); x.arc(0, 0, r - 5, 0, Math.PI * 2); x.stroke();
  const f0 = r * 0.46, k = r / 46;                    // лицо — в видимой четверти
  x.lineWidth = 1.1; x.strokeStyle = ink2(0.85); x.beginPath();
  x.moveTo(f0 - 11 * k, f0 - 2 * k); x.quadraticCurveTo(f0 - 8 * k, f0 + 1 * k, f0 - 5 * k, f0 - 2 * k);
  x.moveTo(f0 + 5 * k, f0 - 2 * k); x.quadraticCurveTo(f0 + 8 * k, f0 + 1 * k, f0 + 11 * k, f0 - 2 * k);
  x.moveTo(f0 - 12 * k, f0 - 7 * k); x.quadraticCurveTo(f0 - 8 * k, f0 - 10 * k, f0 - 4 * k, f0 - 7 * k);
  x.moveTo(f0 + 4 * k, f0 - 7 * k); x.quadraticCurveTo(f0 + 8 * k, f0 - 10 * k, f0 + 12 * k, f0 - 7 * k);
  x.moveTo(f0, f0 - 4 * k); x.lineTo(f0 - 2 * k * side, f0 + 5 * k); x.lineTo(f0 + 1.5 * k * side, f0 + 5.5 * k);
  x.moveTo(f0 - 7 * k, f0 + 11 * k); x.quadraticCurveTo(f0, f0 + 15 * k, f0 + 7 * k, f0 + 11 * k);
  x.stroke();
  if (!half) { x.strokeStyle = ink2(0.8); x.lineWidth = 1.2; x.beginPath(); x.moveTo(0, 0.5); x.lineTo(r * 2.1, 0.5); x.stroke(); }   // кромка
  x.restore();
}
