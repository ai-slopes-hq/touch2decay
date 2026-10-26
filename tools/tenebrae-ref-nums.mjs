// Числа-эталоны для core/tests/sdk_test.cpp (tenebraeTone, tenebraeWaves): печатает C++-инициализаторы из JS-кода
// мира I (worlds/tenebrae/tone.js, host/waves.js). Запуск: node tools/tenebrae-ref-nums.mjs
import { alignCoeffs, beatHz, cutoffOf, freqOf, shiftHz, waveCoeffs } from '../worlds/tenebrae/tone.js';
import { SCALES } from '../host/scale.js';
import { WAVES } from '../host/waves.js';

const f = (a) => a.map((v) => v.toPrecision(17)).join(', ');
const arr = (name, a) => console.log(`static const double ${name}[] = {${f(a)}};`);

const raw = WAVES.map((w) => waveCoeffs(w.fn));
const al = alignCoeffs(raw);
const H = [1, 2, 3, 7, 50, 218];
arr('REF_LEVEL', raw.map((w) => w.level));
for (const [name, set] of [['VOICE', al], ['LFO', raw]]) {
  arr(`REF_${name}_RE`, set.flatMap((w) => H.map((h) => w.re[h])));
  arr(`REF_${name}_IM`, set.flatMap((w) => H.map((h) => w.im[h])));
}
// лад: выключен и минор от A (idx 1, root 0, как в тестах Natura)
const off = { on: false, inScale: () => true };
const minor = { on: true, inScale: (n) => SCALES[1].steps.includes((((n - 0) % 12) + 12) % 12) };
const X = [0, 0.3, 0.5, 0.8, 1];
arr('REF_FREQ_OFF', X.map((x) => freqOf(x, off)));
arr('REF_FREQ_MINOR', X.map((x) => freqOf(x, minor)));
arr('REF_BEAT', [0, 0.05, 3.5, 24].map(beatHz));
const cuts = [], CUT = [0, 0.3, 0.68, 1], Y = [0, 0.5, 1], FM = [0, 0.5, 1];
for (const c of CUT) for (const y of Y) for (const fm of FM) cuts.push(cutoffOf(c, y, fm));
arr('REF_CUTOFF', cuts);                  // порядок: cut ∈ {0, .3, .68, 1} × y ∈ {0, .5, 1} × fmOpen ∈ {0, .5, 1}
arr('REF_SHIFT', Array.from({ length: 11 }, (_, i) => shiftHz(i / 10)));
