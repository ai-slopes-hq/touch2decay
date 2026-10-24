// Сверка эха и гула Cymatica в ядре с прежней цепочкой Web Audio (engine.js до этапа 3) в Chromium: OfflineAudioContext.
// Вход эха и вся пластина берутся из ядра (эхо выключено), поэтому разница ядра «с эхом» и «без» — ровно возврат эха; то же с гулом.
// Мерило — как у шин других миров: RMS ± 1 дБ (Web Audio сглаживает ручки и считает фильтры во float — по сэмплам не сойдётся) и форма:
// корреляция возврата ядра и Web Audio не ниже 0.999. Запуск: node tools/cym-echo-check.mjs (сервер не нужен, нужен Chromium Playwright).
import { createRequire } from 'node:module';
import { loadT2d } from './t2d-core.mjs';
import { ACT } from '../worlds/cymatica/bridge.js';
import { cellCenter } from '../worlds/cymatica/core.js';

const { chromium } = createRequire(import.meta.url)('playwright');
const SR = 48000, SLOT = 2, B = 128;

function render({ echo, hum, blocks, strikeAt, changeAt }) {
  const c = loadT2d(); c.init(SR, 77);
  c.action(SLOT, ACT.SET_FX, 4, [echo]); c.action(SLOT, ACT.SET_FX, 5, [0.5]); c.action(SLOT, ACT.BPM, 0, [120]);   // 1/8 при 120 — 0.25 с
  c.action(SLOT, ACT.HUM, 0, [hum ? 1 : 0]);
  const L = [], R = [];
  for (let b = 0; b < blocks; b++) {
    if (b === strikeAt) c.action(SLOT, ACT.STRIKE_AT, 0, [cellCenter(0, 0, 5).x, cellCenter(0, 0, 5).y]);   // нота основного тона — отзыв и гул
    if (b === changeAt) c.action(SLOT, ACT.SET_FX, 5, [1]);                                                   // доля 1/4d — новая пара
    c.process(B);
    L.push(...c.dry(SLOT, 0)); R.push(...c.dry(SLOT, 1));
  }
  return { L, R };
}
const diff = (a, b) => ({ L: a.L.map((x, k) => x - b.L[k]), R: a.R.map((x, k) => x - b.R[k]) });
const rms = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
const db = (x) => 20 * Math.log10(x);
const corr = (a, b) => { let ab = 0, aa = 0, bb = 0; for (let k = 0; k < a.length; k++) { ab += a[k] * b[k]; aa += a[k] * a[k]; bb += b[k] * b[k]; } return ab / Math.sqrt(aa * bb); };

const blocks = 600, changeAt = 375;                    // 1.6 с; смена доли на 1.0 с (номер блока кратен 128 сэмплам — как suspend)
const dry = render({ echo: 0, hum: false, blocks, strikeAt: 0, changeAt });
const withEcho = render({ echo: 0.6, hum: false, blocks, strikeAt: 0, changeAt });
const withHum = render({ echo: 0, hum: true, blocks, strikeAt: 0, changeAt });
const echoCore = diff(withEcho, dry), humCore = diff(withHum, dry);

const browser = await chromium.launch();
const page = await browser.newPage();
const web = await page.evaluate(async ({ dryL, dryR, n, changeAt, echo }) => {
  const SR = 48000, run = async (build) => {
    const ctx = new OfflineAudioContext(2, n, SR);
    build(ctx);
    return ctx.startRendering();
  };
  // эхо: engine.js до этапа 3 — echoSend (setTargetAtTime echo·0.8, tau 0.05), пара линий на долю, при смене доли — новая пара
  const echoBuf = await run((ctx) => {
    const g = (v) => { const x = ctx.createGain(); x.gain.value = v; return x; };
    const src = ctx.createBufferSource(), buf = ctx.createBuffer(2, n, SR);
    buf.copyToChannel(Float32Array.from(dryL), 0); buf.copyToChannel(Float32Array.from(dryR), 1);
    src.buffer = buf;
    const out = g(1), send = g(0);
    src.connect(send); send.gain.setTargetAtTime(echo * 0.8, 0, 0.05);
    const fbv = 0.35 + 0.45 * echo;
    const pair = (sec, at) => {
      const inp = g(0), dL = ctx.createDelay(3), dR = ctx.createDelay(3), merge = ctx.createChannelMerger(2), outG = g(1);
      dL.delayTime.value = dR.delayTime.value = sec;
      const lp = (x) => { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 3000; x.connect(f); return f; };
      const fb = [g(fbv), g(fbv)], fL = lp(dL), fR = lp(dR);
      inp.connect(dL); fL.connect(fb[0]).connect(dR); fR.connect(fb[1]).connect(dL);
      dL.connect(merge, 0, 0); dR.connect(merge, 0, 1); merge.connect(outG).connect(out);
      send.connect(inp);
      inp.gain.setTargetAtTime(1, at, 0.01);
      return { inp };
    };
    const p1 = pair(0.25, 0);
    ctx.suspend(changeAt * 128 / SR).then(() => { p1.inp.gain.setTargetAtTime(0, ctx.currentTime, 0.01); pair(0.75, ctx.currentTime); ctx.resume(); });
    out.connect(ctx.destination); src.start();
  });
  // гул: два генератора под огибающей, как answer() в engine.js
  const humBuf = await run((ctx) => {
    const t = 0, hz = 110, o = ctx.createOscillator(), o2 = ctx.createOscillator(), gn = ctx.createGain();
    o.frequency.value = hz / 2; o2.frequency.value = hz; o2.detune.value = 4;
    gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(0.05, t + 0.15); gn.gain.exponentialRampToValueAtTime(0.0001, t + 1.6); gn.gain.linearRampToValueAtTime(0, t + 1.62);
    o.connect(gn); o2.connect(gn); gn.connect(ctx.destination);
    o.start(t); o2.start(t); o.stop(t + 1.65); o2.stop(t + 1.65);
  });
  return { eL: Array.from(echoBuf.getChannelData(0)), eR: Array.from(echoBuf.getChannelData(1)), h: Array.from(humBuf.getChannelData(0)) };
}, { dryL: dry.L, dryR: dry.R, n: blocks * B, changeAt, echo: 0.6 });
await browser.close();

let bad = 0;
const check = (name, ok, msg) => { bad += !ok; console.log(`${name.padEnd(14)} ${msg} ${ok ? 'ok' : 'FAIL'}`); };
const dbs = (c, w) => db(rms(c) / rms(w));
// RMS целиком — ± 1 дБ
for (const [nm, c, w] of [['echo L', echoCore.L, web.eL], ['echo R', echoCore.R, web.eR], ['hum', humCore.L, web.h]]) {
  const d = dbs(c, w); check(`${nm} RMS`, Math.abs(d) <= 1, `core ${db(rms(c)).toFixed(2)} dB, web ${db(rms(w)).toFixed(2)} dB, ${d >= 0 ? '+' : ''}${d.toFixed(3)} dB`);
}
// форма: первый возврат (L, до петли) — совпадает по сэмплам; второй (R, прошёл петлю) — Chromium добавляет в петлю один квант (128), место разрыва
// петли случайное на контекст (см. CLAUDE.md, Tria) — берём лучший сдвиг из {0, 128}; гул — по сэмплам
const seg = (x, a, b) => x.slice(Math.round(a * SR), Math.round(b * SR));
const at = (c, w, a, b, lag) => corr(seg(c, a, b), w.slice(Math.round(a * SR) + lag, Math.round(b * SR) + lag));
check('echo L hop 1', corr(seg(echoCore.L, 0.26, 0.5), seg(web.eL, 0.26, 0.5)) >= 0.999, `corr ${corr(seg(echoCore.L, 0.26, 0.5), seg(web.eL, 0.26, 0.5)).toFixed(5)}`);
const r0 = at(echoCore.R, web.eR, 0.5, 0.75, 0), r128 = at(echoCore.R, web.eR, 0.5, 0.75, 128);
check('echo R hop 2', Math.max(r0, r128) >= 0.999, `corr lag0 ${r0.toFixed(5)}, lag128 ${r128.toFixed(5)}`);
check('hum shape', corr(humCore.L, web.h) >= 0.9999, `corr ${corr(humCore.L, web.h).toFixed(6)}`);
process.exit(bad ? 1 : 0);
