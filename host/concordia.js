// общие настройки (тап по солнцу на карте): связать часы (темп и пуск/стоп) и/или лад всех миров
import { audioPref, ctx, restartAt, restartAudio } from './audio.js';
import { mapSunY } from './deck.js';
import { dot, g, H, hairBox, ink, mapText, paper, ring, safeBot, W } from './draw.js';
import { reading } from './fonts.js';
import { nav, worlds } from './registry.js';
import { clamp } from './util.js';
export const link = { clock: false, scale: true };
try { Object.assign(link, JSON.parse(localStorage.getItem('t2d-link') || '{}')); } catch (_) { /* приватный режим */ }
const saveLink = () => { try { localStorage.setItem('t2d-link', JSON.stringify(link)); } catch (_) { /* приватный режим */ } };
export const perScl = {};                                      // свой лад у каждого мира, когда лад не общий
export function tempoFrom(n, bpm) { if (link.clock) for (const [k, w] of Object.entries(worlds)) if (+k !== n && w.tempo) w.tempo.set(bpm); }
export function transportFrom() { /* общие часы — только темп: пуск и стоп у каждого мира свои (автор) */ }

function settingsBox() {
  const w = Math.min(260, W - 40), h = 252, x = W / 2 - w / 2, y = Math.min(H - safeBot - h - 10, mapSunY() + 30);
  return { x, y, w, h, rows: [{ key: 'clock', label: 'shared tempo', sub: 'one bpm in every sequencer', y: y + 46 }, { key: 'scale', label: 'shared scale', sub: 'one scale in every world', y: y + 90 },
    { key: 'stable', label: 'stable audio', sub: 'larger buffer — for USB interfaces', y: y + 134 }, { key: 'restart', label: 'restart audio', sub: 'after plugging an interface', y: y + 178 }, { key: 'mixer', label: 'mixer', sub: 'every world · low-pass, compressor, ceiling', y: y + 222 }] };
}
export const drawSettings = reading(drawSettings0);
function drawSettings0() {
  const S = settingsBox();
  g.fillStyle = paper(0.94); g.fillRect(S.x, S.y, S.w, S.h);
  hairBox(S.x, S.y, S.w, S.h, 0.6); hairBox(S.x + 3, S.y + 3, S.w - 6, S.h - 6, 0.25);
  mapText('concordia', S.x + S.w / 2, S.y + 18, 15, 0.85, 'center');
  for (const r of S.rows) {
    const bx = S.x + S.w - 28;
    if (r.key === 'mixer') {                            // страница микшера: три фейдера в рамке
      mapText(r.label, S.x + 16, r.y - 6, 15, 0.9, 'left'); mapText(r.sub, S.x + 16, r.y + 10, 11, 0.45, 'left');
      g.strokeStyle = ink(0.7); g.lineWidth = 1; g.beginPath();
      for (const [k, v] of [[-6, 0.3], [0, 0.7], [6, 0.5]]) { g.moveTo(bx + k, r.y - 8); g.lineTo(bx + k, r.y + 8); g.moveTo(bx + k - 2.5, r.y + 8 - 16 * v); g.lineTo(bx + k + 2.5, r.y + 8 - 16 * v); }
      g.stroke();
      continue;
    }
    if (r.key === 'restart') {                          // действие, не переключатель: круговая стрелка; только что перезапущено — ярко
      const k = clamp(1 - (performance.now() - restartAt) / 900);
      mapText(k > 0 ? 'audio restarted' : r.label, S.x + 16, r.y - 6, 15, 0.6 + 0.35 * k, 'left'); mapText(r.sub, S.x + 16, r.y + 10, 11, 0.45, 'left');
      g.strokeStyle = ink(0.5 + 0.5 * k); g.lineWidth = 1.1; g.beginPath(); g.arc(bx, r.y, 8, -0.3, Math.PI * 1.6); g.stroke();
      g.beginPath(); g.moveTo(bx + 8 * Math.cos(-0.3) - 4, r.y + 8 * Math.sin(-0.3) - 1); g.lineTo(bx + 8 * Math.cos(-0.3), r.y + 8 * Math.sin(-0.3)); g.lineTo(bx + 8 * Math.cos(-0.3) + 1, r.y + 8 * Math.sin(-0.3) - 4.5); g.stroke();
      continue;
    }
    const on = r.key === 'stable' ? audioPref.stable : link[r.key];
    mapText(r.label, S.x + 16, r.y - 6, 15, on ? 0.95 : 0.6, 'left');
    mapText(r.sub, S.x + 16, r.y + 10, 11, 0.45, 'left');
    ring(bx, r.y, 9, on ? 0.9 : 0.45, 1.1);
    if (on) dot(bx, r.y, 4.5, 0.9);
  }
}
// касание открытых настроек: строки — переключить, мимо — закрыть
export function settingsDown(f) {
  const S = settingsBox(), row = S.rows.findIndex((r) => f.x > S.x && f.x < S.x + S.w && Math.abs(f.y - r.y) < 20);
  if (row >= 0) {
    const k = S.rows[row].key;
    if (k === 'restart') { if (ctx) restartAudio(); return; }
    if (k === 'mixer') { nav.settings = 'mix'; return; }
    if (k === 'stable') { audioPref.stable = !audioPref.stable; try { localStorage.setItem('t2d-audio', JSON.stringify(audioPref)); } catch (_) { /* приватный режим */ } if (ctx) restartAudio(); return; }
    link[k] = !link[k]; saveLink(); return;
  }
  nav.settings = false;
}
