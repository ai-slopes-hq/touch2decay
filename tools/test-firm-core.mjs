// Тесты эталона Firmamentum (tools/ref/pulsar-worklet.js): звучит, детерминирован, по звуку — как прежний worklet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SCENARIOS, SEED, SR, BLOCK, toScript, loadRef, loadOld, loadWasm, play, WASM, ACTS, refPath, corePath } from './firm-scenarios.mjs';

const rms = (a) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);
const run = (load, name, steps = SCENARIOS[name]) => { const { proc, posted } = load(); return play(proc, steps, posted); };
const cut = (steps, max) => { const o = []; let n = 0; for (const s of steps) { if (!s.run) { o.push(s); continue; } if (n >= max) break; const r = Math.min(s.run, max - n); o.push({ run: r }); n += r; } return o; };

test('reference sounds', () => {
  assert.ok(rms(run(() => loadRef(), 'tone').L) > 0.01);
});

test('reference is deterministic', () => {
  const steps = cut(SCENARIOS.all, 1000);
  const a = run(() => loadRef(SEED), 'all', steps), b = run(() => loadRef(SEED), 'all', steps), c = run(() => loadRef(SEED + 1), 'all', steps);
  assert.deepEqual(a.L, b.L); assert.deepEqual(a.R, b.R);
  assert.notDeepEqual(a.L, c.L);
});

// Треск и вспышки случайны (стайки): у одного прогона разброс ±50 %, поэтому с обеих сторон — среднее по N прогонам
// (эталон — с разными зёрнами, прежний — на xorshift32 от номера прогона, детерминированно); допуски из плана — на среднее.
test('reference sounds like the old worklet', () => {
  const RUNS = { all: 8, crepitus: 250 };               // треск дисперсный — ему нужно больше прогонов
  const mean = (load, name) => {
    const N = RUNS[name];
    let e = [0, 0], k = 0, f = 0;
    for (let i = 0; i < N; i++) {
      const r = run(() => load(i), name);
      e[0] += rms(r.L) ** 2; e[1] += rms(r.R) ** 2;
      for (const ev of r.events) { k += ev.k.length; f += ev.f.length; }
    }
    return { L: Math.sqrt(e[0] / N), R: Math.sqrt(e[1] / N), k: k / N, f: f / N };
  };
  const db = (x, y) => Math.abs(20 * Math.log10(x / y));
  for (const name of ['all', 'crepitus']) {
    const r = mean((i) => loadRef(SEED + i), name), o = mean((i) => loadOld(i), name);
    assert.ok(db(r.L, o.L) <= 0.5, `${name} L: ${r.L} vs ${o.L}`);
    assert.ok(db(r.R, o.R) <= 0.5, `${name} R: ${r.R} vs ${o.R}`);
    for (const key of ['k', 'f']) assert.ok(Math.abs(r[key] - o[key]) <= 0.25 * Math.max(r[key], o[key], 1), `${name} ${key}: ${r[key]} vs ${o[key]}`);
  }
});

// Ядро C++ (core/worlds/firmamentum) против эталона по сэмплам, допуск 1e-6: core/build.sh
const EPS = 1e-6;
const CLI = fileURLToPath(new URL('../core/build/render-cli', import.meta.url));
function same(a, b, what) {                             // каждый отсчёт — не дальше EPS; первое расхождение — в сообщении
  assert.equal(a.length, b.length, `${what}: length`);
  for (let k = 0; k < a.length; k++) if (!(Math.abs(a[k] - b[k]) <= EPS)) assert.fail(`${what}: sample ${k}: ${a[k]} vs ${b[k]}`);
}
function cli(steps) {                                   // render-cli: блоки по 128 — L, затем R
  const p = spawnSync(CLI, { input: toScript(steps), maxBuffer: 1 << 28 });
  assert.equal(p.status, 0, String(p.stderr));
  const f = new Float32Array(p.stdout.buffer.slice(p.stdout.byteOffset, p.stdout.byteOffset + p.stdout.byteLength));
  const n = f.length / (2 * BLOCK), L = new Float32Array(n * BLOCK), R = new Float32Array(n * BLOCK);
  for (let b = 0; b < n; b++) { L.set(f.subarray(2 * b * BLOCK, (2 * b + 1) * BLOCK), b * BLOCK); R.set(f.subarray((2 * b + 1) * BLOCK, (2 * b + 2) * BLOCK), b * BLOCK); }
  return { L, R };
}
for (const name of Object.keys(SCENARIOS)) {
  test(`render-cli matches the reference: ${name}`, (t) => {
    if (!existsSync(CLI)) return t.skip('core/build/render-cli is not built — core/build.sh');
    const r = run(() => loadRef(), name), c = cli(SCENARIOS[name]);
    same(c.L, r.L, `${name} L`); same(c.R, r.R, `${name} R`);
  });
}

// ---------- WASM: pulsar-worklet.js (обёртка) + pulsar.wasm ----------

const sameMeters = (a, b, what) => {
  assert.equal(a.length, b.length, `${what}: meter count`);
  a.forEach((m, k) => { same(m.c, b[k].c, `${what} c #${k}`); same(m.g, b[k].g, `${what} g #${k}`); });
};
const sameEvents = (a, b, what) => {
  assert.equal(a.length, b.length, `${what}: event count`);
  a.forEach((e, k) => {
    assert.equal(e.k.length, b[k].k.length, `${what} k count #${k}`);
    e.k.forEach((p, j) => same(p, b[k].k[j], `${what} k #${k}.${j}`));
    assert.deepEqual(e.f, b[k].f, `${what} f #${k}`);
  });
};
async function wasm(steps, sr = SR, seed = SEED, block = BLOCK) { const w = loadWasm(seed, sr); await w.ready; return play(w.proc, steps, w.posted, block); }

for (const name of Object.keys(SCENARIOS)) {
  test(`wasm matches the reference: ${name}`, async () => {
    const r = run(() => loadRef(), name), w = await wasm(SCENARIOS[name]);
    same(w.L, r.L, `${name} L`); same(w.R, r.R, `${name} R`); sameMeters(w.meters, r.meters, name); sameEvents(w.events, r.events, name);
  });
}

test('wasm has no imports', () => {
  assert.deepEqual(WebAssembly.Module.imports(new WebAssembly.Module(readFileSync(WASM))), []);
});

test('messages before ready keep their order', async () => {
  const steps = SCENARIOS.six, first = steps.findIndex((s) => s.run);
  const w = loadWasm();
  for (const s of steps.slice(0, first)) w.proc.port.onmessage({ data: s });   // ещё не готов — в очередь
  await w.ready;
  const got = play(w.proc, steps.slice(first), w.posted), r = run(() => loadRef(), 'six');
  same(got.L, r.L, 'six L'); same(got.R, r.R, 'six R');
});

test('a partial voice message keeps the other fields', async () => {
  const steps = [...SCENARIOS.tone, { t: 'voice', i: 0, ff: 2400 }, { run: 100 }];
  const r = run(() => loadRef(), 'tone', steps), w = await wasm(steps);
  same(w.L, r.L, 'partial L'); same(w.R, r.R, 'partial R');
});

// Порядок вызовов ГСЧ зависит от размера блока (голоса — снаружи, отсчёты — внутри; пыль — после голосов блока), поэтому сверка
// блоков 256 — на одном голосе без пыли: многоголосые сценарии при другой нарезке честно расходятся по случайным амплитудам.
test('blocks longer than 128 samples', async () => {
  const steps = SCENARIOS.tone.map((s) => (s.run ? { run: 150 } : s));
  const { proc, posted } = loadRef(), r = play(proc, steps, posted, 256), w = await wasm(steps, SR, SEED, 256);
  same(w.L, r.L, '256 L'); same(w.R, r.R, '256 R');
});

test('a voice index out of range is ignored', async () => {
  const bad = [{ t: 'voice', i: 6, on: true, fp: 90, ff: 900, cyc: 2, win: 0, mask: 0, lvl: 0.5, pan: 0 }, { t: 'voice', i: -1, on: true, fp: 90 }];
  const steps = SCENARIOS.tone, w = await wasm([...steps.slice(0, -1), ...bad, ...steps.slice(-1)]), r = run(() => loadRef(), 'tone');
  same(w.L, r.L, 'tone L'); same(w.R, r.R, 'tone R');
});

test('at 44.1 kHz', async () => {
  for (const name of ['fulgur', 'all']) {
    const steps = cut(SCENARIOS[name], 2000), { proc, posted } = loadRef(SEED, 44100), r = play(proc, steps, posted), w = await wasm(steps, 44100);
    same(w.L, r.L, `${name} L`); same(w.R, r.R, `${name} R`); sameMeters(w.meters, r.meters, name); sameEvents(w.events, r.events, name);
  }
});

test('speed: 60 s, six stars, crepitus and fulgur', async () => {
  const blocks = Math.round((60 * SR) / BLOCK);
  const steps = [...SCENARIOS.all.filter((s) => !s.run), { run: blocks }];
  const time = (proc) => { const t0 = performance.now(); play(proc, steps); return performance.now() - t0; };
  const js = time(loadRef().proc), w = loadWasm(); await w.ready;
  const ms = time(w.proc);
  console.log(`  speed, 60 s of sound: JS ${js.toFixed(0)} ms, WASM ${ms.toFixed(0)} ms (x${(js / ms).toFixed(2)})`);
});

// ---------- SDK: мир X в t2d.wasm (модель ядра + звук на блоках SDK) против эталона: JS-модель → engine.js → pulsar-worklet.js ----------
// Сухой L/R — 1e-6 на сэмпл; услышанное (pulsed, dust, bolts) — те же сообщения, в том же порядке, теми же значениями.
const ACT_SANITY = {                                   // сценарий что-то проверяет: звук, треск, вспышки, кометы
  fx: (r) => r.heard.some((h) => h.dust.length) && r.heard.some((h) => h.bolts.length),
  all: (r) => r.heard.some((h) => h.dust.length) && r.heard.some((h) => h.bolts.length) && r.comets >= 2,
  comet: (r) => r.comets >= 2,
};
for (const name of Object.keys(ACTS)) {
  test(`sdk: dry output matches the reference: ${name}`, () => {
    const r = refPath(ACTS[name]), c = corePath(ACTS[name]);
    assert.ok(rms(r.L) + rms(r.R) > 1e-3, `${name}: reference is silent`);
    if (ACT_SANITY[name]) assert.ok(ACT_SANITY[name](r), `${name}: scenario does not exercise what it should`);
    same(c.L, r.L, `${name} L`); same(c.R, r.R, `${name} R`);
    assert.equal(c.heard.length, r.heard.length, `${name}: heard count`);
    r.heard.forEach((h, k) => {
      const q = c.heard[k], at = `${name} heard #${k} (block ${h.at})`;
      assert.equal(q.at, h.at, `${at}: block`);
      assert.deepEqual(q.pulsed, h.pulsed, `${at}: pulsed`);
      assert.equal(q.dust.length, h.dust.length, `${at}: dust count`);
      h.dust.forEach((p, j) => same(q.dust[j], p, `${at}: dust ${j}`));
      assert.deepEqual(q.bolts, h.bolts, `${at}: bolts`);
    });
    assert.ok(r.heard.some((h) => h.pulsed.length), `${name}: no pulsed`);
    assert.equal(c.comets, r.comets, `${name}: comets`);
  });
}
