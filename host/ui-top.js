// ---------- кнопки — в верхней строке: слева заголовок, справа громкость, лад, FX, кубик, отмена, убрать всё ----------
import { vol, VOL_DEF, VOL_HI, VOL_LO, VOL_TRAVEL, volText } from './audio.js';
import { BG, dot, g, hairBox, ink, mapText, paper, ring, scopeY, text, W } from './draw.js';
import { BUILD } from './build.js';
import { MAP } from './fonts.js';
import { cur, nav } from './registry.js';
import { NOTES, SCALES, scl } from './scale.js';
import { F } from './touch.js';
import { hists, undoAt } from './undo.js';
import { clamp } from './util.js';
export const BTN_R = 20, ITEM_H = 46, CLR_R = 17;
export const TITLE_X = 46, EDGE_W = 14;                // заголовок — правее стрелки назад; у левого края — полоса свайпа на карту
export const backPos = () => ({ x: 26, y: scopeY + 20, r: 13 });
const SMALL = new Set(['clr', 'undo', 'dice']);
export const btnPos = (k) => {
  const y = scopeY + 20;
  if (k === 'clr') return { x: W - 27, y };
  if (k === 'undo') return { x: W - 66, y };
  if (k === 'dice') return { x: W - 105, y };
  if (k === 'rev') return { x: W - 150, y };
  if (k === 'vol') return { x: W - 238, y };
  return { x: W - 196, y };
};
// список ладов — под кнопкой, строки сверху вниз: off, лады; справа от списка — тоники в две колонки
const LIST_W = 150, TON_W = 40;
export const sclList = () => {
  const b = btnPos('scl'), rows = SCALES.length + 1, top = b.y + 40;
  const cw = TON_W, bx = W - 12 - (2 * cw + 8) - LIST_W, rx = bx + LIST_W + 8, ch = (rows * ITEM_H) / 6;
  return { b, rows, top, bx, rx, cw, ch };
};
let diceAt = -1e9;                              // бросок кубика — кость крутится
export const markDice = () => { diceAt = performance.now(); };
export let titleW = 120;

export const rootAt = (L, x, y) => {
  if (x < L.rx || x > L.rx + 2 * L.cw || y < L.top || y > L.top + L.rows * ITEM_H) return -1;
  return clamp(Math.floor((x - L.rx) / L.cw), 0, 1) * 6 + clamp(Math.floor((y - L.top) / L.ch), 0, 5);
};

// стрелка у названия — карта; заголовок — легенда; солнце / предмет в углу — карта; у левого края — свайп на карту
export function headHit(f) {
  { const B = backPos(); if (Math.hypot(f.x - B.x, f.y - B.y) < B.r + 10) return { k: 'back' }; }   // стрелка у названия — карта
  if (f.y < scopeY + 38 && f.x > TITLE_X - 4 && f.x < TITLE_X + titleW + 10) return { k: 'legenda' };   // заголовок мира — легенда жестов
  if (cur().corner.hit(f)) return { k: 'corner' };   // солнце / предмет в углу — карта миров
  if (f.x < EDGE_W && f.y > scopeY + 44) return { k: 'edge' };   // у левого края — свайп вправо уводит на карту
  return null;
}
// кнопки справа: громкость, FX, лад, корзина, отмена, кубик
export function btnHit(f) {
  const vb = btnPos('vol');
  if (Math.hypot(f.x - vb.x, f.y - vb.y) < CLR_R + 4) return { k: 'vol' };
  for (const k of ['rev', 'scl', 'clr', 'undo', 'dice']) {
    const b = btnPos(k), r = SMALL.has(k) ? CLR_R + 4 : BTN_R + 6;
    if (Math.hypot(f.x - b.x, f.y - b.y) < r && (k !== 'rev' || cur().fx) && (k !== 'dice' || cur().dice)) return { k };
  }
  return null;
}

// громкость: кружок, в нём фейдер-гравюра — двойная линия, засечка нуля, риска уровня; зажат — длинная шкала вниз с подписью
function drawVol(held, dim) {
  const b = btnPos('vol'), h = 18, y0 = b.y - h / 2, ly = (t) => y0 + (1 - t) * h, z = ly(VOL_DEF);
  g.fillStyle = paper(0.88); g.beginPath(); g.arc(b.x, b.y, CLR_R + 1, 0, Math.PI * 2); g.fill();
  const a = dim ? 0.15 : 1;
  ring(b.x, b.y, CLR_R, (held ? 1 : 0.45) * a, 1.2);
  g.strokeStyle = ink(0.35 * a); g.lineWidth = 1;
  g.beginPath(); g.moveTo(b.x - 1.5, y0); g.lineTo(b.x - 1.5, y0 + h); g.moveTo(b.x + 1.5, y0); g.lineTo(b.x + 1.5, y0 + h); g.stroke();
  g.beginPath(); g.moveTo(b.x - 5, z); g.lineTo(b.x - 2.5, z); g.moveTo(b.x + 2.5, z); g.lineTo(b.x + 5, z); g.stroke();
  g.strokeStyle = ink((held ? 1 : 0.8) * a); g.lineWidth = 1.6;
  g.beginPath(); g.moveTo(b.x - 5.5, ly(vol)); g.lineTo(b.x + 5.5, ly(vol)); g.stroke();
  if (!held) return;
  const top = b.y + 34, L = VOL_TRAVEL, sy = (t) => top + (1 - t) * L;
  g.fillStyle = paper(0.9); g.fillRect(b.x - 22, top - 14, 92, L + 28);
  hairBox(b.x - 22, top - 14, 92, L + 28, 0.3);
  g.strokeStyle = ink(0.4); g.lineWidth = 1;
  g.beginPath(); g.moveTo(b.x - 1.5, top); g.lineTo(b.x - 1.5, top + L); g.moveTo(b.x + 1.5, top); g.lineTo(b.x + 1.5, top + L); g.stroke();
  g.beginPath();
  for (let db = VOL_LO; db <= VOL_HI; db += 6) {   // засечки через 6 дБ, у нуля длиннее
    const y = sy((db - VOL_LO) / (VOL_HI - VOL_LO)), l = db === 0 ? 9 : 5;
    g.moveTo(b.x - 2.5 - l, y); g.lineTo(b.x - 2.5, y);
  }
  g.stroke();
  g.strokeStyle = ink(1); g.lineWidth = 2;
  g.beginPath(); g.moveTo(b.x - 9, sy(vol)); g.lineTo(b.x + 9, sy(vol)); g.stroke();
  text(volText(vol), b.x + 14, sy(vol), 14, 0.95);
}

// ветка и коммит деплоя — мелко в левом верхнем углу, над стрелкой; на main и локально нет
export function drawBuild() {
  if (BUILD.ref && BUILD.ref !== 'main') text(`${BUILD.ref} · ${BUILD.sha}`, 12, scopeY - 8, 10, 0.45);
}

export function drawUI() {
  let revF = null, sclF = null, volF = null;
  for (const f of F.values()) { if (f.ui === 'rev') revF = f; if (f.ui === 'scl') sclF = f; if (f.ui === 'vol') volF = f; }

  // FX: три кольца; дуга вокруг — сколько зала
  // верхняя строка: тёмная подложка-градиент, слева заголовок
  const tb = g.createLinearGradient(0, 0, 0, scopeY + 64);
  tb.addColorStop(0, paper(0.85)); tb.addColorStop(0.6, paper(0.55)); tb.addColorStop(1, paper(0));
  g.fillStyle = tb; g.fillRect(0, 0, W, scopeY + 64);
  const title = cur().title, dimT = sclF || revF;   // заголовок — имя мира; не влез — мельче
  let tsz = 21; const tmax = btnPos('vol').x - CLR_R - 30 - TITLE_X;
  g.font = `italic ${tsz}px ${MAP}`; while (tsz > 14 && g.measureText(title).width > tmax) { tsz -= 0.5; g.font = `italic ${tsz}px ${MAP}`; }
  titleW = g.measureText(title).width;
  mapText(title, TITLE_X, scopeY + 20, tsz, dimT ? 0.12 : 0.85);   // при открытом тулбоксе или веере FX заголовок уходит в тень
  if (!dimT) { g.strokeStyle = ink(0.18); g.lineWidth = 1; g.beginPath(); g.moveTo(TITLE_X, scopeY + 33.5); g.lineTo(TITLE_X + titleW, scopeY + 33.5); g.stroke(); }   // тонкая черта: заголовок — легенда
  { const B = backPos(), backF = [...F.values()].some((f) => f.ui === 'back');   // стрелка назад — на карту
    g.fillStyle = paper(0.88); g.beginPath(); g.arc(B.x, B.y, B.r + 1, 0, Math.PI * 2); g.fill();
    ring(B.x, B.y, B.r, (backF ? 1 : 0.45) * (dimT ? 0.3 : 1), 1.1);
    g.strokeStyle = ink((backF ? 1 : 0.8) * (dimT ? 0.3 : 1)); g.lineWidth = 1.4; g.lineCap = 'round';
    g.beginPath(); g.moveTo(B.x + 2.5, B.y - 5.5); g.lineTo(B.x - 3, B.y); g.lineTo(B.x + 2.5, B.y + 5.5); g.stroke(); g.lineCap = 'butt'; }
  drawVol(!!volF, !!(sclF || revF));
  // кнопки лежат поверх карты — у каждой тёмная подложка
  const pad = (p, rr) => { g.fillStyle = paper(0.88); g.beginPath(); g.arc(p.x, p.y, rr, 0, Math.PI * 2); g.fill(); };
  pad(btnPos('rev'), BTN_R + 1); pad(btnPos('scl'), BTN_R + 1); pad(btnPos('undo'), CLR_R + 1); pad(btnPos('clr'), CLR_R + 1); pad(btnPos('dice'), CLR_R + 1);
  const r = btnPos('rev');
  const X = cur().fx, dimFx = X ? 1 : 0.35;   // у мира нет веера FX — кнопка тусклая
  ring(r.x, r.y, BTN_R, (revF ? 1 : 0.45) * dimFx, 1.2);
  for (const [rr, a] of [[6, 0.9], [11, 0.55], [16, 0.3]]) ring(r.x, r.y, rr, a * (revF ? 1 : 0.8) * dimFx, 1);
  if (X) {
    g.strokeStyle = ink(0.9); g.lineWidth = 2;
    g.beginPath(); g.arc(r.x, r.y, BTN_R + 5, -Math.PI / 2, -Math.PI / 2 + X.arc() * Math.PI * 2); g.stroke();
  }

  // кубик: кружок с костью; после броска кость крутится
  const dq = btnPos('dice'), diceF = [...F.values()].some((f) => f.ui === 'dice');
  if (!cur().dice) g.globalAlpha = 0.35;     // у мира нет кубика — тусклый
  ring(dq.x, dq.y, CLR_R, diceF ? 1 : 0.45, 1.2);
  g.save(); g.translate(dq.x, dq.y); g.rotate(0.18 + (performance.now() - diceAt < 400 ? (performance.now() - diceAt) / 60 : 0));
  g.strokeStyle = ink(0.8); g.lineWidth = 1.2;
  g.beginPath(); g.roundRect ? g.roundRect(-7, -7, 14, 14, 2.5) : g.rect(-7, -7, 14, 14); g.stroke();
  g.fillStyle = ink(0.85);
  for (const [px, py] of [[-3.2, -3.2], [3.2, -3.2], [0, 0], [-3.2, 3.2], [3.2, 3.2]]) { g.beginPath(); g.arc(px, py, 1.1, 0, Math.PI * 2); g.fill(); }
  g.restore(); g.globalAlpha = 1;

  // отмена: стрелка по дуге; под ней — точки по числу шагов в запасе
  const hist = hists[nav.world], u = btnPos('undo'), can = hist.length > 0, flash = performance.now() - undoAt < 250;
  ring(u.x, u.y, CLR_R, flash ? 1 : can ? 0.45 : 0.18, flash ? 2 : 1.2);
  g.strokeStyle = ink(can ? 0.8 : 0.25); g.lineWidth = 1.4; g.lineCap = 'round';
  g.beginPath(); g.arc(u.x + 1, u.y + 1, 6, Math.PI * 1.05, Math.PI * 2.35); g.stroke();
  g.beginPath(); g.moveTo(u.x - 8.5, u.y - 3.5); g.lineTo(u.x - 5, u.y + 1.5); g.lineTo(u.x - 1, u.y - 2); g.stroke();
  g.lineCap = 'butt';
  for (let i = 0; i < hist.length; i++) dot(u.x - ((hist.length - 1) * 4) / 2 + i * 4, u.y + CLR_R + 7, 1.1, 0.5);

  // убрать всё: корзина (не крестик — его легко принять за «закрыть»)
  const c = btnPos('clr');
  const live = cur().sounding();
  ring(c.x, c.y, CLR_R, live ? 0.45 : 0.18, 1.2);
  g.strokeStyle = ink(live ? 0.75 : 0.25); g.lineWidth = 1.2;
  g.beginPath();
  g.moveTo(c.x - 7, c.y - 4.5); g.lineTo(c.x + 7, c.y - 4.5);                 // крышка
  g.moveTo(c.x - 2.5, c.y - 7); g.lineTo(c.x + 2.5, c.y - 7);                 // ручка
  g.moveTo(c.x - 5.5, c.y - 4.5); g.lineTo(c.x - 4.3, c.y + 7); g.lineTo(c.x + 4.3, c.y + 7); g.lineTo(c.x + 5.5, c.y - 4.5);
  g.moveTo(c.x - 1.6, c.y - 1.5); g.lineTo(c.x - 1.4, c.y + 4.5); g.moveTo(c.x + 1.6, c.y - 1.5); g.lineTo(c.x + 1.4, c.y + 4.5);
  g.stroke();

  // лад: лесенка; зажата — список ладов и тоники
  const L = sclList(), b = L.b;
  if (sclF) {
    // список: off и лады — строки с тонкими разделителями
    const rows = ['off', ...SCALES.map((sc) => sc.label)];
    g.fillStyle = paper(0.9);
    g.fillRect(L.bx, L.top - 8, LIST_W, L.rows * ITEM_H + 16);
    hairBox(L.bx, L.top - 8, LIST_W, L.rows * ITEM_H + 16, 0.3);
    rows.forEach((label, i) => {
      const y = L.top + ITEM_H * (i + 0.5), on = i === 0 ? !scl.on : scl.on && i - 1 === scl.idx;
      text(label, L.bx + 22, y, 15, on ? 1 : 0.45, on ? 500 : 400);
      if (on) dot(L.bx + 12, y, 3, 1);
      if (i) { g.strokeStyle = ink(0.1); g.beginPath(); g.moveTo(L.bx + 8, Math.round(y + ITEM_H / 2) + 0.5); g.lineTo(L.bx + LIST_W - 8, Math.round(y + ITEM_H / 2) + 0.5); g.stroke(); }
    });
    // тоники: две колонки по шесть справа от списка
    g.fillStyle = paper(0.9);
    g.fillRect(L.rx - 4, L.top - 8, 2 * L.cw + 8, L.rows * ITEM_H + 16);
    hairBox(L.rx - 4, L.top - 8, 2 * L.cw + 8, L.rows * ITEM_H + 16, 0.3);
    NOTES.forEach((nm, i) => {
      const col = Math.floor(i / 6), row = i % 6, on = i === scl.root;
      const x = L.rx + L.cw * (col + 0.5), y = L.top + L.ch * (row + 0.5);
      if (on) hairBox(L.rx + L.cw * col + 4, L.top + L.ch * row + 4, L.cw - 8, L.ch - 8, 0.9);
      text(nm, x, y, 13, on ? 1 : 0.5, on ? 500 : 400, 'center');
    });
  } else if (scl.on && !sclF) {               // лад включён — его имя рядом с кнопкой
    text(`${NOTES[scl.root]} ${SCALES[scl.idx].label}`, 18, scopeY + 46, 11, 0.5);   // под заголовком
  }
  if (scl.on) { g.fillStyle = ink(0.9); g.beginPath(); g.arc(b.x, b.y, BTN_R, 0, Math.PI * 2); g.fill(); }
  else ring(b.x, b.y, BTN_R, 0.45, 1.2);
  g.strokeStyle = scl.on ? BG : ink(0.8); g.lineWidth = 1.6; g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(b.x - 11, b.y + 8);
  for (let i = 0; i < 4; i++) { const x = b.x - 11 + i * 6, y = b.y + 8 - i * 5; g.lineTo(x, y - 5); g.lineTo(x + 6, y - 5); }
  g.stroke();
}
