// плашка со строками (FX мира или своя у мира) и панель LFO строки: геометрия, касания, рисование
import { dot, drawCurve, g, H, hairBox, ink, mapText, paper, ring, safeBot, text, W } from './draw.js';
import { reading } from './fonts.js';
import { cur, nav } from './registry.js';
import { LFO_RATE_MAX, LFO_RATE_MIN, rndIdx, slAdd, slFind, slFn, slRemove } from './sl.js';
import { DTAP_MS, F } from './touch.js';
import { BTN_R, btnPos } from './ui-top.js';
import { clamp, inBox, invLog, lerpLog } from './util.js';
import { morphFn, NW, WAVES } from './waves.js';
export const PAD_IN = 12;          // поле внутри пада, где точка ещё внутри шкалы
export const shapeT = (p, px) => clamp((px - p.x - 22) / (p.w - 44));
export const padRate = (p, px) => lerpLog(LFO_RATE_MIN, LFO_RATE_MAX, clamp((px - p.x - PAD_IN) / (p.w - 2 * PAD_IN)));
export const padDepth = (p, py) => clamp(1 - (py - p.pad.y - PAD_IN) / (p.pad.h - 2 * PAD_IN));
export const rateX = (p, hz) => p.x + PAD_IN + invLog(LFO_RATE_MIN, LFO_RATE_MAX, hz) * (p.w - 2 * PAD_IN);
export const depthY = (p, d) => p.pad.y + PAD_IN + (1 - d) * (p.pad.h - 2 * PAD_IN);
// плашка со строками — FX мира или своя у мира (T2D.openSheet: луна Cymatica …): spec { title, hint, rows: [{ key, label }], get, set, text,
// lfo?: { id, keys, shapes: 'classic' | 'random' } } — у строк из keys справа «~»: LFO на строку, как у планеты Tenebrae
const fxSpec = () => { const X = cur().fx; return X && { title: 'aether', hint: 'FX — tap outside to close', rows: X.sectors, get: X.get, set: X.set, text: X.text, lfo: X.lfo && { id: `fx${nav.world}`, ...X.lfo } }; };
const sheetSpec = () => (fxSheet ? fxSheet.spec || fxSpec() : null);
export function fxGeo() {
  const S = sheetSpec(), n = S ? S.rows.length : 0, bottom = H - safeBot - 8, x = 16, w = W - 32, lfoH = S && S.lfo && fxSheet.lfoKey ? 196 : 0, top = bottom - lfoH - 52 - n * 46;
  return { x, w, top, bottom, lfoTop: bottom - lfoH, rows: S ? S.rows.map((sc, i) => ({ k: sc.key, label: sc.label, y: top + 48 + i * 46, h: 46 })) : [], tx0: x + 82, tx1: x + w - (S && S.lfo ? 124 : 84), lfoX: x + w - 18 };
}
const slPanel = () => { const s = fxGeo(); return { x: s.x, w: s.w, top: s.lfoTop + 8, bottom: s.bottom, shape: { y: s.lfoTop + 30, h: 40 }, pad: { y: s.lfoTop + 78, h: s.bottom - s.lfoTop - 78 } }; };
const slOff = () => { const p = slPanel(); return { x: p.x + p.w - 46, y: p.top - 6, w: 46, h: 24 }; };
export let fxSheet = null;                             // { w, spec? } — открыта плашка (FX или своя у мира)
export function setFxSheet(s) { fxSheet = s; }
let lastFxTap = null;

// касания открытой плашки: строки — тянуть, «~» — LFO строки и его панель, кнопка FX или мимо — закрыть
export function sheetHit(f) {
  const b = btnPos('rev'), s = fxGeo();
  if (Math.hypot(f.x - b.x, f.y - b.y) < BTN_R + 6) return { k: 'fxclose' };
  const S = sheetSpec();
  if (S && S.lfo && fxSheet.lfoKey && f.y >= s.lfoTop) {   // панель LFO строки: off, полоса форм, пад
    const p = slPanel();
    if (inBox(f, slOff())) return { k: 'sloff' };
    if (f.y > p.shape.y - 6 && f.y < p.shape.y + p.shape.h + 4) return { k: 'slstrip', strip: 'shape' };
    if (f.y > p.pad.y - 4) return { k: 'slstrip', strip: 'pad' };
    return { k: 'none' };
  }
  if (f.y >= s.top) {
    const r = s.rows.find((q) => f.y >= q.y - 4 && f.y < q.y + q.h);
    if (r && S && S.lfo && S.lfo.keys.includes(r.k) && f.x > s.tx1 + 4 + 50) return { k: 'sllfo', key: r.k };   // «~» справа — LFO строки
    return r ? { k: 'fxrow', key: r.k } : { k: 'none' };
  }
  return { k: 'fxclose' };
}
// sheetDown / sheetMove / sheetUp — касание взяла плашка (true) или нет
export function sheetDown(f) {
  if (f.ui === 'sllfo') {                   // «~» строки плашки мира: LFO и его панель; ещё раз — свернуть
    const S = sheetSpec(), k = f.hit.key;
    if (fxSheet.lfoKey === k) { fxSheet.lfoKey = null; return true; }
    fxSheet.lfoKey = k; slAdd(S, k);
    return true;
  }
  if (f.ui === 'sloff') { const S = sheetSpec(), e = S && S.lfo && slFind(S.lfo.id, fxSheet.lfoKey); if (e) slRemove(e); return true; }
  if (f.ui === 'slstrip') { f.strip = f.hit.strip; slStrip(f); return true; }
  if (f.ui === 'fxrow') {                  // строка плашки; двойной тап — reset, если мир его дал (например, кувшинка: снова общее)
    const X = sheetSpec(), now = performance.now(); f.key = f.hit.key; f.v0 = X.get(f.key);
    if (X.reset && lastFxTap && lastFxTap.k === f.key && now - lastFxTap.t < DTAP_MS) { X.reset(f.key); lastFxTap = null; f.done = true; return true; }
    lastFxTap = { k: f.key, t: now };
    return true;
  }
  return false;
}
export function sheetMove(f) {
  if (f.ui === 'fxrow' && !f.done) {
    const X = sheetSpec(), s = fxGeo();
    if (X) {
      const e = X.lfo && slFind(X.lfo.id, f.key);
      if (e) { if (f.b0 == null) f.b0 = e.base; e.base = clamp(f.b0 + (f.x - f.x0) / (s.tx1 - s.tx0)); }   // с LFO тянешь его базу
      else X.set(f.key, clamp(f.v0 + (f.x - f.x0) / (s.tx1 - s.tx0)));
    }
    if (f.moved) lastFxTap = null; return true;
  }
  if (f.ui === 'slstrip') { slStrip(f); return true; }
  return false;
}
export function sheetUp(f) {
  if (f.ui === 'slstrip') { const S = sheetSpec(), e = S && S.lfo && fxSheet.lfoKey && slFind(S.lfo.id, fxSheet.lfoKey); if (e && e.spec.depth < 0.03) slRemove(e); return true; }   // глубину увёл в ноль — LFO снят
  return false;
}

function slStrip(f) {                          // панель LFO строки: полоса — форма, пад — вправо скорость, вверх глубина
  const S = sheetSpec(), k = fxSheet && fxSheet.lfoKey;
  if (!S || !S.lfo || !k) return;
  const e = slAdd(S, k), p = slPanel();
  if (f.strip === 'shape') e.spec.morph = shapeT(p, f.x); else { e.spec.rate = padRate(p, f.x); e.spec.depth = padDepth(p, f.y); }
}

// плашка FX мира: строка на каждый эффект, тянешь вбок; значение — как у мира в подписи
export const drawFxSheet = reading(drawFxSheet0);
function drawFxSheet0() {
  const X = sheetSpec(), s = fxGeo();
  if (!X) { fxSheet = null; return; }
  g.fillStyle = paper(0.97); g.fillRect(0, s.top, W, H - s.top);
  g.strokeStyle = ink(0.35); g.lineWidth = 1; g.beginPath(); g.moveTo(0, s.top + 0.5); g.lineTo(W, s.top + 0.5); g.stroke();
  g.fillStyle = ink(0.3); g.fillRect(W / 2 - 18, s.top + 5, 36, 2);
  mapText(X.title, s.x, s.top + 26, 17, 0.95);
  mapText(X.hint || 'tap outside to close', s.x + s.w, s.top + 26, 12, 0.5, 'right');
  for (const r of s.rows) {
    const cy = r.y + r.h / 2, on = [...F.values()].some((f) => f.ui === 'fxrow' && f.key === r.k), T = (t) => s.tx0 + clamp(t) * (s.tx1 - s.tx0);
    const e = X.lfo && slFind(X.lfo.id, r.k), sel = X.lfo && fxSheet.lfoKey === r.k;
    text(r.label, s.x, cy, 14, on || sel ? 1 : 0.75);
    g.strokeStyle = ink(0.45); g.lineWidth = 1; g.beginPath(); g.moveTo(s.tx0, cy + 0.5); g.lineTo(s.tx1, cy + 0.5); g.stroke();
    const t = X.get(r.k), b = e ? e.base : t;
    if (e) { const lo = clamp(e.base - e.spec.depth * 0.5), hi = clamp(e.base + e.spec.depth * 0.5); g.fillStyle = ink(0.16); g.fillRect(T(lo), cy - 3, T(hi) - T(lo), 6); }   // размах LFO
    else { g.fillStyle = ink(0.2); g.fillRect(s.tx0, cy - 2, T(t) - s.tx0, 4); }
    g.fillStyle = ink(1); g.beginPath(); g.arc(T(b), cy, on ? 8 : 6.5, 0, Math.PI * 2); g.fill();
    if (e) dot(T(t), cy, 2.2, 0.7);
    text(X.text(r.k), s.tx1 + 12, cy, 13, 0.9);
    if (X.lfo && X.lfo.keys.includes(r.k)) {     // «~» — как у планеты: есть LFO — залито, открыта панель — двойная рамка
      const lx = s.lfoX;
      if (e) { g.fillStyle = ink(0.14); g.fillRect(lx - 15, cy - 12, 30, 24); }
      hairBox(lx - 15, cy - 12, 30, 24, sel ? 0.95 : e ? 0.7 : 0.45);
      if (sel) hairBox(lx - 18, cy - 15, 36, 30, 0.4);
      g.strokeStyle = ink(e ? 1 : 0.7); g.lineWidth = e ? 1.4 : 1.1; g.beginPath();
      for (let i = 0; i <= 12; i++) { const xx = lx - 9 + (i / 12) * 18, yy = cy + Math.sin((i / 12) * Math.PI * 2) * 4; i ? g.lineTo(xx, yy) : g.moveTo(xx, yy); }
      g.stroke();
    }
  }
  if (X.lfo && fxSheet.lfoKey) drawSlPanel(X, X.rows.find((q) => q.key === fxSheet.lfoKey));
}
// панель LFO строки — как у планеты: полоса форм (в мирах West Coast — рампы и случайность) и пад с бегущей волной
const drawSlPanel = reading(drawSlPanel0);
function drawSlPanel0(X, row) {
  const p = slPanel(), e = slFind(X.lfo.id, fxSheet.lfoKey), pd = p.pad, shapes = X.lfo.shapes || 'classic';
  let lf = null;
  for (const f of F.values()) if (f.ui === 'slstrip') lf = f;
  g.fillStyle = paper(0.97); g.fillRect(0, p.top - 10, W, p.bottom - p.top + 18);
  g.strokeStyle = ink(0.2); g.lineWidth = 1; g.beginPath(); g.moveTo(0, p.top - 9.5); g.lineTo(W, p.top - 9.5); g.stroke();
  text(`LFO → ${row ? row.label : ''}`, p.x, p.top + 6, 13, 1, 500);
  if (e) {
    const r = e.spec.rate, hz = r < 1 ? r.toFixed(2) : r.toFixed(r < 10 ? 2 : 1);
    text(`${hz} Hz · ${Math.round(e.spec.depth * 100)}%`, p.x + p.w - 58, p.top + 6, 15, 1, 500, 'right');
    const o = slOff(), on = [...F.values()].some((f) => f.ui === 'sloff');
    hairBox(o.x, o.y, o.w, o.h, on ? 0.9 : 0.45);
    text('off', o.x + o.w / 2, o.y + o.h / 2, 12, on ? 1 : 0.75, 400, 'center');
  } else text('drag the pad', p.x + p.w, p.top + 6, 12, 0.5, 400, 'right');
  const sh = p.shape;
  hairBox(p.x, sh.y, p.w, sh.h, lf && lf.strip === 'shape' ? 0.8 : 0.3);
  if (shapes === 'random') {
    const icon = (m, cx, w, h, a, lw) => { g.strokeStyle = ink(a); g.lineWidth = lw; g.lineJoin = 'round'; g.beginPath(); for (let i = 0; i <= 96; i++) { const t = i / 96, y = sh.y + sh.h / 2 - slFn('random', m, 5)(t * 2.5) * h / 2, x = cx - w / 2 + t * w; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); };
    for (let i = 0; i < 4; i++) icon((i + 0.5) / 4, p.x + 22 + ((i + 0.5) / 4) * (p.w - 44), 34, 16, 0.3, 1.1);
    if (e) { const i = rndIdx(e.spec.morph), cx = p.x + 22 + ((i + 0.5) / 4) * (p.w - 44); hairBox(cx - 26, sh.y + 4, 52, sh.h - 8, 0.9); icon(e.spec.morph, cx, 40, 22, 1, 1.6); }
  } else {
    for (let i = 0; i < NW; i++) drawCurve(WAVES[i].fn, p.x + 22 + (i / (NW - 1)) * (p.w - 44), sh.y + sh.h / 2, 24, 16, 0.3, 1, 1.1);
    if (e) { const mx = p.x + 22 + e.spec.morph * (p.w - 44); hairBox(mx - 24, sh.y + 4, 48, sh.h - 8, 0.9); drawCurve(morphFn(e.spec.morph), mx, sh.y + sh.h / 2, 38, 22, 1, 1.5, 1.6); }
  }
  const on = lf && lf.strip === 'pad', by = pd.y + pd.h - 0.5;
  hairBox(p.x, pd.y, p.w, pd.h, on ? 0.8 : 0.3);
  g.strokeStyle = ink(0.1); g.lineWidth = 1; g.beginPath();
  for (const hz of [0.1, 1, 10]) { const x = Math.round(rateX(p, hz)) + 0.5; g.moveTo(x, pd.y + 1); g.lineTo(x, by); }
  g.stroke();
  for (const [hz, s] of [[0.1, '0.1'], [1, '1'], [10, '10 Hz']]) text(s, rateX(p, hz) + 4, by - 12, 10, 0.45);
  text('depth', p.x + 10, pd.y + 12, 10, 0.45);
  if (!e) return;
  const cx = rateX(p, e.spec.rate), cy = depthY(p, e.spec.depth), mid = pd.y + pd.h / 2, amp = e.spec.depth * (pd.h / 2 - PAD_IN), fn = slFn(shapes, e.spec.morph, e.sd), span = 2 * e.spec.rate;
  g.save(); g.beginPath(); g.rect(p.x + 1, pd.y + 1, p.w - 2, pd.h - 2); g.clip();
  g.strokeStyle = ink(on ? 0.5 : 0.32); g.lineWidth = 1.2; g.lineJoin = 'round'; g.beginPath();
  const N = Math.min(600, Math.max(120, Math.round(span * 24)));
  for (let i = 0; i <= N; i++) { const t = i / N, u = e.u - (1 - t) * span, x = p.x + PAD_IN + t * (p.w - 2 * PAD_IN), y = mid - fn(u) * amp; i ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.stroke();
  g.setLineDash([2, 4]); g.strokeStyle = ink(0.35); g.lineWidth = 1; g.beginPath();
  g.moveTo(Math.round(cx) + 0.5, pd.y + 1); g.lineTo(Math.round(cx) + 0.5, by); g.moveTo(p.x + 1, Math.round(cy) + 0.5); g.lineTo(p.x + p.w - 1, Math.round(cy) + 0.5); g.stroke();
  g.restore();
  dot(p.x + p.w - PAD_IN, mid - fn(e.u) * amp, 2.5, 0.9);
  ring(cx, cy, on ? 11 : 8, 1, on ? 2 : 1.4); dot(cx, cy, 2.5, 1);
}
