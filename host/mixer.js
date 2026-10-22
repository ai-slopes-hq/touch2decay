// ---------- микшер: строка на каждый мир (номер и имя, фейдер с уровнем, mute), ниже — мастер ----------
import { applyMix, chanLvl, FADER_DEF, faderDb, faderOf, mix, MIX_DEF, MIXM, pollLevels, saveMix } from './audio.js';
import { deck, mapWorlds } from './deck.js';
import { dot, g, H, hairBox, ink, mapText, paper, ring, safeBot, scopeY, W } from './draw.js';
import { reading } from './fonts.js';
import { nav, worlds } from './registry.js';
import { DTAP_MS } from './touch.js';
import { clamp } from './util.js';
export function mixGeo() {
  const ws = mapWorlds().sort((a, b) => a - b), w = Math.min(420, W - 20), x = W / 2 - w / 2, top = scopeY + 40, bot = H - safeBot - 10;
  const mrows = Object.keys(MIXM), avail = bot - top - 44 - 30 - 8, rh = clamp(avail / (ws.length + mrows.length), 24, 36);
  const rows = ws.map((n, i) => ({ n, y: top + 44 + i * rh + rh / 2 }));
  const my = top + 44 + ws.length * rh + 22, mr = mrows.map((k, i) => ({ k, y: my + 8 + i * rh + rh / 2 }));
  const h = my + 8 + mrows.length * rh + 10 - top;
  return { x, w, top, h, rh, rows, my, mr, tx0: x + 136, tx1: x + w - 58, mx: x + w - 26 };
}
export const drawMixer = reading(drawMixer0);
function drawMixer0(now) {
  pollLevels(now);
  const M = mixGeo(), { x, w, top, h, tx0, tx1 } = M, L = tx1 - tx0;
  g.fillStyle = paper(0.96); g.fillRect(x, top, w, h);
  hairBox(x, top, w, h, 0.6); hairBox(x + 3, top + 3, w - 6, h - 6, 0.25);
  mapText(deck === 'main' ? 'mixer' : 'mixer · vol. I', x + w / 2, top + 20, 16, 0.9, 'center'); mapText('‹ concordia', x + 14, top + 20, 11, 0.5, 'left');
  const fader = (y, t, lvl, on) => {                    // дорожка: двойная линия, засечка нуля, уровень — светлая полоса, ручка — черта
    g.strokeStyle = ink(0.3); g.lineWidth = 1; g.beginPath(); g.moveTo(tx0, y - 1.5); g.lineTo(tx1, y - 1.5); g.moveTo(tx0, y + 1.5); g.lineTo(tx1, y + 1.5); g.stroke();
    if (lvl > 0.001) { const k = clamp((20 * Math.log10(lvl) + 48) / 54); g.fillStyle = ink(0.28 + 0.4 * k); g.fillRect(tx0, y - 1, L * k, 2); }
    const z = tx0 + L * FADER_DEF; g.strokeStyle = ink(0.35); g.beginPath(); g.moveTo(z, y - 6); g.lineTo(z, y - 3); g.moveTo(z, y + 3); g.lineTo(z, y + 6); g.stroke();
    g.strokeStyle = ink(on ? 0.95 : 0.35); g.lineWidth = 2; g.beginPath(); g.moveTo(tx0 + L * t, y - 8); g.lineTo(tx0 + L * t, y + 8); g.stroke(); g.lineWidth = 1;
  };
  for (const r of M.rows) {
    const wd = worlds[r.n], m = !!mix.mute[r.n], t = faderOf(r.n), lv = chanLvl[r.n] || 0, sz = M.rh > 30 ? 13 : 12;
    mapText(`${wd.n || ''}`, x + 14, r.y, sz - 1, 0.5, 'left'); mapText(wd.title, x + 42, r.y, sz, m ? 0.35 : 0.85, 'left');
    fader(r.y, t, m ? 0 : lv, !m);
    mapText(t < 0.01 ? 'off' : `${faderDb(t) > 0 ? '+' : ''}${faderDb(t).toFixed(0)}`, tx1 + 6, r.y, 10, 0.5, 'left');
    ring(M.mx, r.y, 8, m ? 0.9 : 0.4, 1);                // mute: зачёркнутый кружок
    if (m) { g.strokeStyle = ink(0.9); g.beginPath(); g.moveTo(M.mx - 5.5, r.y + 5.5); g.lineTo(M.mx + 5.5, r.y - 5.5); g.stroke(); }
    else if (lv > 0.003) dot(M.mx, r.y, 2 + 2.5 * clamp(lv * 6), 0.7);
  }
  g.strokeStyle = ink(0.3); g.beginPath(); g.moveTo(x + 14, M.my - 4); g.lineTo(x + w - 14, M.my - 4); g.stroke();
  mapText('master', x + w / 2, M.my + 6, 12, 0.6, 'center');
  for (const r of M.mr) { const q = MIXM[r.k]; mapText(q.label, x + 14, r.y, 12, 0.85, 'left'); fader(r.y, mix[r.k], 0, true); mapText(q.text(mix[r.k]), tx1 + 6, r.y, 10, 0.55, 'left'); }
}
let mixTap = null;
export function mixDown(f) {
  const M = mixGeo();
  if (f.x < M.x || f.x > M.x + M.w || f.y < M.top || f.y > M.top + M.h || (f.y < M.top + 34 && f.x < M.x + 110)) { nav.settings = true; return; }   // мимо или «‹ concordia» — назад
  const hit = (rows, key) => rows.find((r) => Math.abs(f.y - r.y) < M.rh / 2);
  const r = hit(M.rows) || hit(M.mr);
  if (!r) return;
  const key = r.n != null ? r.n : r.k, now = performance.now();
  if (r.n != null && f.x > M.tx1 + 28) { mix.mute[r.n] = !mix.mute[r.n]; applyMix(); saveMix(); return; }
  if (f.x < M.tx0 - 70) return;
  if (mixTap && mixTap.key === key && now - mixTap.t < DTAP_MS) {   // двойной тап — по умолчанию
    if (r.n != null) delete mix.g[r.n]; else mix[r.k] = MIX_DEF[r.k];
    applyMix(); saveMix(); mixTap = null; return;
  }
  mixTap = { key, t: now };
  f.ui = 'mixf'; f.mkey = key; f.mmaster = r.n == null; f.v0 = r.n != null ? faderOf(r.n) : mix[r.k];
}
export function mixMove(f) {
  const M = mixGeo(), v = clamp(f.v0 + (f.x - f.x0) / (M.tx1 - M.tx0));
  if (f.mmaster) mix[f.mkey] = v; else mix.g[f.mkey] = v;
  applyMix();
}
