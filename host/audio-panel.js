// панель «audio» — тап по кнопке громкости (тянуть — по-прежнему громкость): tempo мира, stop, restart audio, stable audio
import { audioPref, ctx, restartAt, restartAudio } from './audio.js';
import { link, tempoFrom, toggleStable } from './concordia.js';
import { dot, g, hairBox, ink, mapText, paper, ring, text, W } from './draw.js';
import { reading } from './fonts.js';
import { cur, nav } from './registry.js';
import { F, TAP_MOVE, TAP_MS } from './touch.js';
import { btnPos, CLR_R } from './ui-top.js';
import { clamp } from './util.js';

export let audioPanel = null;                   // { w } — открыта у мира w
export function setAudioPanel(p) { audioPanel = p; }
const ROWS = [['tempo', 'tempo'], ['stop', 'stop'], ['restart', 'restart audio'], ['stable', 'stable audio']];
const ROW_H = 44;
export function panelGeo() {
  const b = btnPos('vol'), w = 230, x = clamp(b.x - 34, 12, W - w - 12), top = b.y + CLR_R + 12;
  const rows = ROWS.map(([k, label], i) => ({ k, label, y: top + 34 + i * ROW_H + ROW_H / 2 }));
  return { x, w, top, h: 34 + ROWS.length * ROW_H + 8, rows, tx0: x + 88, tx1: x + w - 82 };
}
// часы мира: tempo {get, set, play?, playing?, min?, max?}; у мира без часов — null
const clockOf = (w) => (w.tempo && w.tempo.get ? w.tempo : null);
const bpmRange = (t) => [t.min || 40, t.max || 200];

// тап по кнопке громкости — открыть или закрыть; повёл — это была громкость
export function volTap(f) {
  if (performance.now() - f.t0 >= TAP_MS || Math.hypot(f.x - f.x0, f.y - f.y0) >= TAP_MOVE) return;
  audioPanel = audioPanel ? null : { w: nav.world };
}
// касание при открытой панели: строка — её; кнопка громкости — как всегда (null); мимо — закрыть
export function panelHit(f) {
  const P = panelGeo(), b = btnPos('vol');
  if (Math.hypot(f.x - b.x, f.y - b.y) < CLR_R + 4) return null;
  if (f.x < P.x || f.x > P.x + P.w || f.y < P.top || f.y > P.top + P.h) return { k: 'apclose' };
  const r = P.rows.find((q) => Math.abs(f.y - q.y) < ROW_H / 2);
  return r ? { k: 'ap', key: r.k } : { k: 'none' };
}
export function panelDown(f) {
  if (f.ui === 'apclose') { audioPanel = null; return true; }
  if (f.ui !== 'ap') return false;
  const w = cur(), t = clockOf(w), k = f.hit.key;
  if (k === 'tempo') { if (t) f.bpm0 = t.get(); }
  else if (k === 'stop') { if (t && t.play) t.play(!t.playing()); else w.clear(); }   // часы — стоп / пуск; нет часов — заглушить (отмена вернёт)
  else if (k === 'restart') { if (ctx) restartAudio(); }
  else if (k === 'stable') toggleStable();
  return true;
}
export function panelMove(f) {                  // tempo: тянешь вбок; общий темп — у всех миров
  if (f.ui !== 'ap') return false;
  const t = clockOf(cur());
  if (f.hit.key !== 'tempo' || !t || f.bpm0 == null) return true;
  const [lo, hi] = bpmRange(t), bpm = Math.round(clamp(f.bpm0 + (f.x - f.x0) / 2, lo, hi));
  if (bpm !== t.get()) { t.set(bpm); tempoFrom(nav.world, bpm); }
  return true;
}

export const drawAudioPanel = reading(drawAudioPanel0);
function drawAudioPanel0() {
  const P = panelGeo(), w = cur(), t = clockOf(w), held = [...F.values()].find((f) => f.ui === 'ap');
  g.fillStyle = paper(0.95); g.fillRect(P.x, P.top, P.w, P.h);
  hairBox(P.x, P.top, P.w, P.h, 0.6); hairBox(P.x + 3, P.top + 3, P.w - 6, P.h - 6, 0.25);
  mapText('audio', P.x + P.w / 2, P.top + 18, 14, 0.8, 'center');
  const bx = P.x + P.w - 26;
  for (const r of P.rows) {
    const on = held && held.hit.key === r.k;
    if (r.k === 'tempo') {                      // дорожка: засечка — где темп; правее — bpm (общий — «all»)
      text(r.label, P.x + 16, r.y, 14, t ? (on ? 1 : 0.8) : 0.3);
      g.strokeStyle = ink(t ? 0.3 : 0.12); g.lineWidth = 1; g.beginPath(); g.moveTo(P.tx0, r.y - 1.5); g.lineTo(P.tx1, r.y - 1.5); g.moveTo(P.tx0, r.y + 1.5); g.lineTo(P.tx1, r.y + 1.5); g.stroke();
      if (!t) { text('—', P.x + P.w - 16, r.y, 13, 0.3, 400, 'right'); continue; }
      const [lo, hi] = bpmRange(t), bpm = t.get(), px = P.tx0 + ((bpm - lo) / (hi - lo)) * (P.tx1 - P.tx0);
      g.strokeStyle = ink(on ? 1 : 0.85); g.lineWidth = 2; g.beginPath(); g.moveTo(px, r.y - 7); g.lineTo(px, r.y + 7); g.stroke(); g.lineWidth = 1;
      text(`${bpm} bpm`, P.x + P.w - 16, r.y - (link.clock ? 6 : 0), 13, 0.75, 400, 'right');
      if (link.clock) mapText('all worlds', P.x + P.w - 16, r.y + 9, 10, 0.45, 'right');
      continue;
    }
    if (r.k === 'stop') {                       // часы идут — квадрат «стоп», стоят — треугольник «пуск»; без часов — заглушить мир
      const clock = t && t.play, playing = clock && t.playing(), live = clock ? true : w.sounding();
      text(clock && !playing ? 'play' : 'stop', P.x + 16, r.y, 14, live ? (on ? 1 : 0.8) : 0.3);
      mapText(clock ? (playing ? 'the clock runs' : 'the clock stands') : 'silence this world', P.tx0, r.y, 11, 0.45, 'left');
      g.strokeStyle = ink(live ? 0.85 : 0.3); g.lineWidth = 1.2; g.beginPath();
      if (clock && !playing) { g.moveTo(bx - 4, r.y - 6); g.lineTo(bx + 6, r.y); g.lineTo(bx - 4, r.y + 6); g.closePath(); } else g.rect(bx - 5, r.y - 5, 10, 10);
      g.stroke();
      continue;
    }
    if (r.k === 'restart') {                    // действие: круговая стрелка; только что перезапущено — ярко
      const k = clamp(1 - (performance.now() - restartAt) / 900);
      text(k > 0 ? 'audio restarted' : r.label, P.x + 16, r.y, 14, 0.75 + 0.25 * k);
      g.strokeStyle = ink(0.5 + 0.5 * k); g.lineWidth = 1.1; g.beginPath(); g.arc(bx, r.y, 8, -0.3, Math.PI * 1.6); g.stroke();
      const ax = bx + 8 * Math.cos(-0.3), ay = r.y + 8 * Math.sin(-0.3);
      g.beginPath(); g.moveTo(ax - 4, ay - 1); g.lineTo(ax, ay); g.lineTo(ax + 1, ay - 4.5); g.stroke();
      continue;
    }
    const st = audioPref.stable;                // stable audio: переключатель
    text(r.label, P.x + 16, r.y, 14, st ? 0.95 : 0.75);
    ring(bx, r.y, 9, st ? 0.9 : 0.45, 1.1);
    if (st) dot(bx, r.y, 4.5, 0.9);
  }
}
