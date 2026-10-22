// LFO на строках плашек миров — модель (без DOM и холста): живут, пока не сняты (и при закрытой плашке); база — значение строки без LFO
import { nav } from './registry.js';
import { clamp } from './util.js';
import { morphFn } from './waves.js';
export const LFO_RATE_MIN = 0.03, LFO_RATE_MAX = 20;

export const SL = [];                                  // { id, key, w, base, spec {morph, rate, depth, ph}, u — фаза без обрезки, sd — зерно случайности, get, set, shapes }
export const slFind = (id, key) => SL.find((e) => e.id === id && e.key === key);
// West Coast: только рампы и случайность; случайное — от номера периода (u — фаза без обрезки), поэтому на паде видна настоящая история
const hash = (n) => { const x = Math.sin(n * 12.9898) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; };
const fr = (u) => u - Math.floor(u);
const RND_SHAPES = [
  { label: 'ramp up', fn: (u) => 2 * fr(u) - 1 }, { label: 'ramp down', fn: (u) => 1 - 2 * fr(u) },
  { label: 'steps', fn: (u, sd) => hash(sd + Math.floor(u)) },
  { label: 'smooth', fn: (u, sd) => { const a = hash(sd + Math.floor(u)), b = hash(sd + Math.floor(u) + 1); return a + (b - a) * (0.5 - 0.5 * Math.cos(Math.PI * fr(u))); } },
];
export const rndIdx = (m) => Math.min(3, Math.floor(m * 4));
export const slFn = (shapes, morph, sd = 3) => (shapes === 'random' ? (u) => RND_SHAPES[rndIdx(morph)].fn(u, sd) : morphFn(morph));
export function slAdd(S, key) {                        // LFO на строку: база — текущее значение
  let e = slFind(S.lfo.id, key);
  if (e) return e;
  e = { id: S.lfo.id, key, w: nav.world, base: S.get(key), spec: { morph: S.lfo.shapes === 'random' ? 0.6 : 0, rate: S.lfo.shapes === 'random' ? 0.4 : 0.8, depth: 0.3, ph: 0 }, u: 0, sd: Math.floor(Math.random() * 1000), get: S.get, set: S.set, shapes: S.lfo.shapes || 'classic' };
  SL.push(e);
  return e;
}
export function slRemove(e) { const i = SL.indexOf(e); if (i >= 0) SL.splice(i, 1); e.set(e.key, e.base); }
let slAcc = 0;
export function slTick(dt) {                           // фаза бежит каждый кадр, значение уходит в мир ~30 раз в секунду
  if (!SL.length) return;
  slAcc += dt;
  for (const e of SL) { e.u += dt * e.spec.rate; e.spec.ph = fr(e.u); }
  if (slAcc < 0.033) return;
  slAcc = 0;
  for (const e of SL) e.set(e.key, clamp(e.base + e.spec.depth * 0.5 * slFn(e.shapes, e.spec.morph, e.sd)(e.u)));
}
