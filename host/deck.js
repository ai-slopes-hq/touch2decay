// раскладка карты: колоды, клетки миров, поле карт
import { H, safeBot, scopeY, W } from './draw.js';
import { nav, worlds } from './registry.js';
import { clamp } from './util.js';
// карта — поле карт 6 × 6, как расклад Таро: открытые миры — лицом вверх в середине (наверху ад и рай, под ними Cymatica и
// Tenebrae, под эклиптикой Laboratorium и Natura, под лабораторией — Monochordum), остальные — рубашкой вверх, пока не открыты.
// Между третьим и четвёртым рядом — эклиптика с солнцем (concordia). Клетка — [столбец, ряд] от левого верхнего угла
// колоды карт: main — Universum, dlc1 — DLC vol. I (Prisma, Harmonica vitrea). Переключить — 7 тапов по надписи UNIVERSUM на карте.
const DECKS = {
  main: { 6: [1, 0], 5: [2, 0], 2: [1, 1], 1: [2, 1], 3: [1, 2], 4: [2, 2], 7: [1, 3], 8: [3, 2], 9: [0, 2], 10: [3, 1], 11: [3, 0], 12: [0, 3], 13: [3, 3], 15: [2, 3] },   // поле 4 × 4: 14 миров (III — рубашка, выключен)
  dlc1: { 17: [1, 1], 18: [2, 1] },
};
export const DLC_ON = false;                                   // вход в DLC закрыт (22.10): 7 тапов ничего не делают, колода всегда main
export let deck = 'main';
try { const d = localStorage.getItem('t2d-deck'); if (DLC_ON && DECKS[d]) deck = d; } catch (_) { /* приватный режим */ }
let CELL = DECKS[deck];
export function setDeck(d) { if (!DECKS[d]) return; deck = d; CELL = DECKS[d]; nav.peek = null; nav.deckAt = performance.now(); try { localStorage.setItem('t2d-deck', d); } catch (_) { /* приватный режим */ } }
export const titleTaps = { n: 0, t: 0 };
export const GRID = 4, ECL = 40, HALF = GRID / 2;          // эклиптика — между верхней и нижней половиной
export function field() {
  const top = scopeY + 40, bot = H - safeBot - 10, gap = clamp(W * 0.014, 4, 9);
  let cw = (W - 12 - (GRID - 1) * gap) / GRID, ch = (bot - top - (GRID - 2) * gap - ECL) / GRID;
  ch = Math.min(ch, cw / 0.52); cw = Math.min(cw, ch * 0.72);   // карта не уже 0.52 и не шире 0.72 высоты
  const fw = GRID * cw + (GRID - 1) * gap, fh = GRID * ch + (GRID - 2) * gap + ECL, x0 = (W - fw) / 2, y0 = top + Math.max(0, (bot - top - fh) / 2);
  return { cw, ch, gap, x0, y0, fw, fh, sx: x0 + fw / 2, sy: y0 + HALF * ch + (HALF - 1) * gap + ECL / 2 };
}
export function cellRect(c, r, F = field()) { return [F.x0 + c * (F.cw + F.gap), F.y0 + r * (F.ch + F.gap) + (r >= HALF ? ECL - F.gap : 0), F.cw, F.ch]; }
export const panel = (w) => cellRect(CELL[w][0], CELL[w][1]);
export const mapSunY = () => field().sy;
export const mapWorlds = () => Object.keys(CELL).map(Number).filter((w) => worlds[w]);
export const cellWorld = (c, r) => mapWorlds().find((w) => CELL[w][0] === c && CELL[w][1] === r) || 0;
