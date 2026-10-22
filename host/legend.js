import { dot, g, H, hairBox, ink, mapText, paper, ring, safeBot, scopeY, W } from './draw.js';
import { face, reading } from './fonts.js';
import { cur, nav } from './registry.js';
import { clamp } from './util.js';
export let legenda = null;                             // { w } — открыта табличка жестов мира (тап по заголовку)
export function setLegenda(l) { legenda = l; }

// ---------- легенда: что делает рука в этом мире ----------
// [знак, жест, что делает]; знаки — tap, double, hold, drag, up, draw, throw, shake, two, pinch, twist
const LEGEND = {
  1: [['tap', 'touch the field', 'sounds while held · farther from the sun — higher'], ['drag', 'drag along the arc', 'clean low right · noise up left'],
    ['double', 'double tap a planet', 'pin · unpin'], ['hold', 'hold a planet', 'its sheet: wave, filter, beat, fm, LFO'],
    ['two', 'hold one, touch another', 'a thread: the second modulates the first'], ['pinch', 'pinch empty space', 'zoom through the octaves'],
    ['drag', 'into the sun · into the hole', 'lightning strikes · eaten by noise'], ['tap', 'tap the sun', 'map of worlds']],
  2: [['tap', 'tap the plate', 'a strike · each cell is a note'], ['pinch', 'pinch', 'plate size — pitch of everything'],
    ['tap', 'tap a ring slot', 'outer — hits · inner — places'], ['drag', 'drag a hit in · out', 'its chance'],
    ['drag', 'drag a bead out · in', 'its note up · down'], ['drag', "drag a ring's end", 'its length — polyrhythm'],
    ['twist', 'twist with two fingers', 'turn a ring · transpose the plate'], ['hold', 'hold the moon', 'plate drift: depth, rate, shape'],
    ['tap', 'tap the resonator', 'map of worlds']],
  3: [['tap', 'tap the lamp or the egg', 'fire on · off'], ['drag', 'drag a flask', 'sideways — pitch · up — level'],
    ['draw', 'from a neck to a flask', 'a tube: modulation · to itself — pelican'], ['tap', 'tap a tube', 'remove it'],
    ['hold', 'hold a flask', 'its sheet: pitch, level, pelican'], ['double', 'double tap a flask', 'crack it · mend it'],
    ['hold', 'hold a metal below', 'the still on its note · double tap — keep'], ['twist', 'run along solve · coagula', 'dirty delay: time · amount'],
    ['tap', 'tap the sun', 'map of worlds']],
  4: [['tap', 'tap water · tap a lily', 'plant a lily · remove it'], ['drag', 'drag a lily', 'across — note · along — step'],
    ['hold', 'hold a lily', 'its sheet: wave, filter, envelope, chance'], ['draw', 'draw through lilies', 'glide between their notes'],
    ['tap', 'the pier · drag sideways', 'play · stop · tempo'], ['drag', 'drag the weir', 'loop length'],
    ['up', 'cloud · mountains · ducks — up', 'cutoff · res · attack, release'], ['shake', 'shake the tree', 'high-pass, leaves rustle'],
    ['throw', 'throw the skiff at the ducks', 'they fly — envelope wide open'], ['tap', 'tap the birds · the sun', 'laser chirp · map of worlds']],
};
export function legGeo() {
  const rows = cur().legend || LEGEND[nav.world] || [], n = rows.length;
  const top = scopeY + 50, x = 14, w = W - 28, avail = H - safeBot - top - 12;
  const rh = clamp((avail - 112) / Math.max(1, n), 34, 50), h = 82 + n * rh + 30;
  return { rows, x, w, top, rh, h };
}
function legGlyph(kind, x, y) {
  const arrow = (x0, y0, x1, y1) => {
    const a = Math.atan2(y1 - y0, x1 - x0);
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1);
    g.moveTo(x1 - Math.cos(a - 0.5) * 5, y1 - Math.sin(a - 0.5) * 5); g.lineTo(x1, y1); g.lineTo(x1 - Math.cos(a + 0.5) * 5, y1 - Math.sin(a + 0.5) * 5); g.stroke();
  };
  const pen = () => { g.strokeStyle = ink(0.85); g.lineWidth = 1.2; };
  pen();
  if (kind === 'tap') { dot(x, y, 3.5, 0.9); ring(x, y, 9, 0.45, 1); }
  else if (kind === 'double') { dot(x, y, 3.5, 0.9); ring(x, y, 8, 0.7, 1); ring(x, y, 12, 0.4, 1); }
  else if (kind === 'hold') { dot(x, y, 3.5, 0.9); g.setLineDash([2.5, 2.5]); ring(x, y, 8, 0.75, 1); ring(x, y, 13, 0.4, 1); g.setLineDash([]); }
  else if (kind === 'drag') { dot(x - 9, y, 3.2, 0.9); pen(); arrow(x - 4, y, x + 12, y); }
  else if (kind === 'up') { dot(x, y + 10, 3.2, 0.9); pen(); arrow(x, y + 5, x, y - 12); }
  else if (kind === 'draw') {
    g.setLineDash([3, 2.5]); g.beginPath(); g.moveTo(x - 14, y + 7); g.quadraticCurveTo(x - 6, y - 12, x, y); g.quadraticCurveTo(x + 6, y + 10, x + 12, y - 6); g.stroke(); g.setLineDash([]);
    dot(x + 12, y - 6, 3, 0.9);
  } else if (kind === 'throw') {
    g.beginPath(); g.moveTo(x - 13, y + 10); g.quadraticCurveTo(x - 4, y - 16, x + 13, y - 3); g.stroke();
    arrow(x + 7, y - 7, x + 13, y - 3); dot(x - 13, y + 10, 3, 0.9);
  } else if (kind === 'shake') { arrow(x, y, x + 13, y); arrow(x, y, x - 13, y); dot(x, y, 3.2, 0.9); }
  else if (kind === 'two') { dot(x - 9, y + 4, 3.2, 0.9); dot(x + 9, y - 4, 3.2, 0.9); pen(); g.setLineDash([2, 3]); g.beginPath(); g.moveTo(x - 9, y + 4); g.lineTo(x + 9, y - 4); g.stroke(); g.setLineDash([]); }
  else if (kind === 'pinch') { dot(x - 4, y + 4, 3, 0.9); dot(x + 4, y - 4, 3, 0.9); pen(); arrow(x - 6, y + 6, x - 13, y + 13); arrow(x + 6, y - 6, x + 13, y - 13); }
  else if (kind === 'twist') {
    g.beginPath(); g.arc(x, y, 11, -2.6, -0.6); g.stroke(); g.beginPath(); g.arc(x, y, 11, 0.55, 2.55); g.stroke();
    arrow(x + Math.cos(-0.9) * 11, y + Math.sin(-0.9) * 11, x + Math.cos(-0.6) * 11, y + Math.sin(-0.6) * 11);
    arrow(x + Math.cos(2.25) * 11, y + Math.sin(2.25) * 11, x + Math.cos(2.55) * 11, y + Math.sin(2.55) * 11);
    dot(x + Math.cos(-2.6) * 11, y + Math.sin(-2.6) * 11, 2.8, 0.9); dot(x + Math.cos(0.55) * 11, y + Math.sin(0.55) * 11, 2.8, 0.9);
  }
}
function fitText(s, x, y, size, a, maxW) {      // курсив, который ужимается, чтобы влезть в строку
  let sz = size; g.font = `italic ${sz}px ${face}`;
  while (sz > 9 && g.measureText(s).width > maxW) { sz -= 0.5; g.font = `italic ${sz}px ${face}`; }
  mapText(s, x, y, sz, a, 'left');
}
export const drawLegenda = reading(drawLegenda0);
function drawLegenda0() {
  const L = legGeo(), { x, w, top, rh, h } = L;
  g.fillStyle = paper(0.97); g.fillRect(x, top, w, h);
  hairBox(x, top, w, h, 0.75); hairBox(x + 4, top + 4, w - 8, h - 8, 0.3);
  g.fillStyle = ink(0.7); for (const [qx, qy] of [[x, top], [x + w, top], [x, top + h], [x + w, top + h]]) { g.beginPath(); g.arc(qx, qy, 1.8, 0, Math.PI * 2); g.fill(); }
  mapText('L E G E N D A', x + w / 2, top + 30, 20, 0.95, 'center', false);
  mapText('what the hand does here', x + w / 2, top + 54, 13, 0.6, 'center');
  g.strokeStyle = ink(0.3); g.lineWidth = 1; g.beginPath(); g.moveTo(x + w / 2 - 50, top + 68.5); g.lineTo(x + w / 2 + 50, top + 68.5); g.stroke();
  L.rows.forEach(([kind, ges, does], i) => {
    const cy = top + 82 + rh * (i + 0.5), tx = x + 58;
    legGlyph(kind, x + 32, cy);
    fitText(ges, tx, cy - 8, 15, 0.95, x + w - 16 - tx);
    fitText(does, tx, cy + 10, 12.5, 0.62, x + w - 16 - tx);
  });
  mapText('tap anywhere — close', x + w / 2, top + h - 18, 12, 0.5, 'center');
}
