// Эталон страны Arcadia для сверки ядра (core/tests/sdk_test.cpp, arcPicFixture): genLand и routeOf из JS-модели → core/tests/data/arcadia-pic.json.
// z / lake — хеш FNV-1a 32 по байтам float32 (little-endian): биты рельефа уже держит test-arcadia-core.mjs, все числа в файле не нужны.
//   node tools/arcadia-pic-ref.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { genLand, createModel, SEED0 } from '../worlds/arcadia/model.js';

export const SEEDS = [SEED0, 1, 4242, 777, 2147483000, 31337, 82, 98];   // 82 и 98 — имя реки идёт от номера цикла k
const US = [-0.8, -0.4, 0, 0.4, 0.8], VS = [-0.8, -0.3, 0.2, 0.7], MODES = [3, 4];

export function fnv(f32) {
  const b = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);   // платформа little-endian (Node на x64 / arm64)
  let h = 0x811c9dc5;
  for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i], 16777619) >>> 0;
  return h;
}

export function build() {
  const seeds = SEEDS.map((seed) => {
    const L = genLand(seed), m = createModel();
    m.newLand(seed);
    const routes = [];
    for (const u of US) for (const v of VS) for (const mode of MODES) routes.push({ u, v, mode, pts: m.routeOf({ u, v, mode }) });
    return {
      seed, zHash: fnv(L.z), lakeHash: fnv(L.lake),
      peaks: L.peaks.map((p) => ({ u: p.u, v: p.v, h: p.h, name: p.name })),
      lakes: L.lakes.map((l) => ({ u: l.u, v: l.v, w: l.w, level: l.level, pond: !!l.pond, name: l.name })),
      rivers: L.rivers.map((r) => ({ name: r.name, pts: r.pts })),
      routes,
    };
  });
  return { seeds };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = fileURLToPath(new URL('../core/tests/data/arcadia-pic.json', import.meta.url));
  writeFileSync(out, JSON.stringify(build()) + '\n');
  console.log(out);
}
