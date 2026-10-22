// Paradisus — звук на обычных узлах (без worklet): хор гласных (пилы → четыре форманты → громкость), собор (свёртка со своим отзвуком),
// шиммер (хвост собора на октаву вверх — снова в собор), зёрна Gloria. События модели → узлы; голоса — здесь (ангел → узлы, Map),
// модель их не видит. Наружу — live и что услышано (listen): { t: 'voice', a, on } — голос собран / снят, { t: 'grain' } — зерно сыграно,
// { t: 'chime', a } — планета над ангелом.
import { formants } from './model.js';

const TAU = Math.PI * 2;
// голос: форманты шире, чем у сухой таблицы (иначе хор свистит отдельными синусами), под ними — тело (сам источник сквозь мягкий срез),
// уровни — с запасом до потолка мастера
const BWK = 2.2, FGK = 1.4, BODYK = 0.3, VCAK = 0.32, OUTK = 1.1, DBK = 0.55;   // DBK — верхние форманты не так глубоко: больше присутствия и воздуха

// собор: свёртка с длинным отзвуком, который считается здесь же (шум со спадом, чем дальше — тем темнее; каналы — разный шум).
// Свёртку браузер считает сам, быстро; отзвук пересчитывается только при смене aether
function cathedralIR(ctx, t60) {
  const sr = ctx.sampleRate, len = Math.round(sr * (t60 + 0.3)), buf = ctx.createBuffer(2, len, sr), pre = Math.round(sr * 0.022), fade = sr * 0.03;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let y = 0, e = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr, fc = 9000 * Math.pow(1200 / 9000, Math.min(1, t / t60)), a = Math.exp((-2 * Math.PI * fc) / sr);
      y = (1 - a) * (Math.random() * 2 - 1) + a * y;
      const v = y * Math.exp((-6.9 * t) / t60) * Math.min(1, (i - pre) / fade);
      d[i] = v; e += v * v;
    }
    const k = Math.sqrt(2500 / (sr / 2)) / Math.sqrt(e || 1);   // энергия отзвука сидит ниже ~2.5 кГц: нормируем по полосе, иначе собор на +9 дБ громче сухого и перегружает
    for (let i = 0; i < len; i++) d[i] *= k;
  }
  return buf;
}
// сдвиг на октаву вверх: две линии задержки, время бежит вниз пилой (окно 60 мс), окна вполнакладку — косинус², сумма — единица
function octaver(ctx, inp, out) {
  const w = 0.06, t0 = ctx.currentTime + 0.05, win = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const x = (i / 255) * 2 - 1; win[i] = Math.cos((Math.PI * x) / 2) ** 2; }
  const n = Math.round(w * ctx.sampleRate), ramp = ctx.createBuffer(1, n, ctx.sampleRate), rd = ramp.getChannelData(0);
  for (let i = 0; i < n; i++) rd[i] = (i / n) * 2 - 1;   // точная пила из буфера: у осциллятора-пилы склон не ровный (Гиббс) — октава уезжала на 1.84
  return [0, w / 2].map((off) => {
    const saw = ctx.createBufferSource(), dt = ctx.createGain(), dl = ctx.createDelay(0.2), sh = ctx.createWaveShaper(), tg = ctx.createGain();
    saw.buffer = ramp; saw.loop = true;
    dl.delayTime.value = w / 2; dt.gain.value = -w / 2; tg.gain.value = 0; sh.curve = win;
    saw.connect(dt).connect(dl.delayTime); saw.connect(sh).connect(tg.gain);
    inp.connect(dl).connect(tg).connect(out);
    saw.start(t0, off);
    return { saw, dl, tg };
  });
}

export function createEngine(T, model) {
  const { angels, fx } = model.state;
  const voices = new Map();                             // ангел → узлы его голоса
  const listeners = [];
  const heard = (e) => { for (const fn of listeners) fn(e); };
  let actx = null, bus = null, lastSound = 0, noiseBuf = null;

  let irAt = 0, irT60 = 0, irTimer = 0;
  function setIR(now = false) {                         // aether — длина отзвука; пересчёт не чаще раза в 250 мс
    if (!bus) return;
    const t60 = 2.5 + fx.aether * 7;
    if (Math.abs(t60 - irT60) < 0.3 && bus.conv.buffer) return;
    clearTimeout(irTimer);
    const go = () => { irT60 = t60; irAt = performance.now(); bus.conv.buffer = cathedralIR(actx, t60); };
    if (now || performance.now() - irAt > 250) go(); else irTimer = setTimeout(go, 250);
  }
  function build(ctx, input) {
    actx = ctx;
    const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const inp = g(1), out = g(OUTK), send = g(0), revIn = g(1), conv = ctx.createConvolver(), wet = g(1), fb = g(0), hp = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter(), oct = g(1);
    conv.normalize = false; hp.type = 'highpass'; hp.frequency.value = 160; lp.type = 'lowpass'; lp.frequency.value = 7000;
    inp.connect(g(0.6)).connect(out);                   // сухого меньше — хор звучит из собора
    inp.connect(send).connect(hp).connect(revIn).connect(conv).connect(wet).connect(out);
    conv.connect(lp); octaver(ctx, lp, oct); oct.connect(fb).connect(revIn);   // шиммер: хвост собора на октаву вверх — снова в собор
    const n = ctx.sampleRate * 2; noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    bus = { inp, out, send, conv, wet, fb, input, live: false };
    irT60 = 0; setIR(true);
    for (const a of voices.keys()) heard({ t: 'voice', a, on: false });   // новый контекст — старые голоса остались в старом
    voices.clear();
    for (const a of angels) if (a.pinned) voiceOn(a);
    applyFx();
  }
  function setLive(on) {
    if (!bus || bus.live === on) return;
    bus.live = on;
    if (on) bus.out.connect(bus.input); else bus.out.disconnect();
  }
  setInterval(() => {
    if (!bus) return;
    if (angels.length) lastSound = performance.now();
    else if (performance.now() - lastSound > 9000) setLive(false);
  }, 1000);
  const vibCents = (a) => 30 * fx.vibrato * (0.3 + a.vib * 1.4);
  const spread = (a, i, N) => (N > 1 ? (i / (N - 1) - 0.5) * 2 * (4 + a.detune * 22) : 0);
  function voiceOn(a) {                                 // ангел: певчие — пилы с расстройкой и вибрато → четыре форманты гласной → громкость
    if (!bus || voices.has(a)) return;
    setLive(true); lastSound = performance.now();
    const ctx = actx, t = ctx.currentTime, g = (v) => { const x = ctx.createGain(); x.gain.value = v; return x; };
    const f = model.hzOf(a), N = a.singers, src = g(1 / Math.sqrt(N)), vca = g(0), vib = ctx.createOscillator(), vg = g(vibCents(a));
    vib.frequency.value = 5 + Math.random() * 1.2; vib.connect(vg);
    const oscs = Array.from({ length: N }, (_, i) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      o.detune.value = spread(a, i, N);
      vg.connect(o.detune); o.connect(src); o.start(t); return o;
    });
    const ns = ctx.createBufferSource(), ng = g(a.breath * 0.25); ns.buffer = noiseBuf; ns.loop = true; ns.connect(ng); ns.start(t, Math.random() * 1.5);
    const fs = formants(model.vEff(a)).map(([fr, db, bw]) => {
      const bp = ctx.createBiquadFilter(), fg = g(10 ** ((db * DBK) / 20) * FGK); bp.type = 'bandpass'; bp.frequency.value = fr; bp.Q.value = fr / (bw * BWK);
      src.connect(bp); ng.connect(bp); bp.connect(fg).connect(vca); return { bp, fg };
    });
    const body = ctx.createBiquadFilter(), bodyG = g(BODYK); body.type = 'lowpass'; body.frequency.value = Math.min(2400, f * 5); body.Q.value = 0.5;
    src.connect(body).connect(bodyG).connect(vca);      // тело голоса: сам источник сквозь мягкий срез — хор, а не свист
    const air = ctx.createBiquadFilter(), airG = g(0.5); air.type = 'highpass'; air.frequency.value = 3500; ng.connect(air).connect(airG).connect(vca);   // воздух — дыхание сверху
    const sw = ctx.createOscillator(), swg = g(0.12); sw.frequency.value = 0.07 + Math.random() * 0.08; sw.connect(swg).connect(vca.gain); sw.start(t);   // дыхание хора: громкость медленно плывёт
    vib.start(t);
    vca.connect(bus.inp);
    vca.gain.setTargetAtTime(VCAK, t, 0.35);           // хор вступает мягко
    voices.set(a, { oscs, src, vca, vib, vg, ns, ng, fs, body, bodyG, sw, swg, air, airG });
    heard({ t: 'voice', a, on: true });
  }
  function voiceOff(a, tau = 0.5) {
    const n = voices.get(a);
    if (!n) return;
    voices.delete(a);
    heard({ t: 'voice', a, on: false });
    const t = actx.currentTime, end = t + tau * 6;
    n.vca.gain.setTargetAtTime(0, t, tau);
    for (const o of [...n.oscs, n.vib, n.ns, n.sw]) o.stop(end);
    n.vib.onended = () => { for (const x of [...n.oscs, n.src, n.vca, n.vib, n.vg, n.ns, n.ng, ...n.fs.map((q) => q.bp), ...n.fs.map((q) => q.fg), n.body, n.bodyG, n.sw, n.swg, n.air, n.airG]) x.disconnect(); };
  }
  function retune(a) {                                  // высота (сфера, регистр) и гласная — плавно
    const n = voices.get(a);
    if (!n) return;
    const t = actx.currentTime, f = model.hzOf(a);
    for (const o of n.oscs) o.frequency.setTargetAtTime(f, t, 0.04);
    n.body.frequency.setTargetAtTime(Math.min(2400, f * 5), t, 0.05);
    formants(model.vEff(a)).forEach(([fr, db, bw], q) => {
      n.fs[q].bp.frequency.setTargetAtTime(fr, t, 0.05); n.fs[q].bp.Q.setTargetAtTime(fr / (bw * BWK), t, 0.05); n.fs[q].fg.gain.setTargetAtTime(10 ** ((db * DBK) / 20) * FGK, t, 0.05);
    });
    n.vg.gain.setTargetAtTime(vibCents(a), t, 0.1);
    n.ng.gain.setTargetAtTime(a.breath * 0.25, t, 0.1);
    const N = n.oscs.length; n.oscs.forEach((o, i) => { o.detune.value = spread(a, i, N); });
  }
  function applyFx() {
    if (!bus) return;
    const t = actx.currentTime;
    bus.send.gain.setTargetAtTime(0.35 + fx.aether * 0.5, t, 0.05);
    bus.wet.gain.setTargetAtTime(0.9 + fx.aether * 0.5, t, 0.05);
    bus.fb.gain.setTargetAtTime(fx.shimmer * 0.62, t, 0.08);   // доля хвоста, ушедшего на октаву вверх обратно в собор
    setIR();
    for (const a of angels) retune(a);
  }
  // Gloria — облако зёрен хора: короткие окна синуса на гармониках поющих ангелов, по стерео вразброс, в зал
  function grain(fBase) {
    if (!bus) return;
    const ctx = actx, t = ctx.currentTime + 0.01, dur = 0.06 + Math.random() * 0.14, o = ctx.createOscillator(), gg = ctx.createGain(), p = ctx.createStereoPanner();
    o.frequency.value = fBase * [1, 2, 3, 4][Math.floor(Math.random() * 4)] * (Math.random() < 0.3 ? 2 : 1);
    p.pan.value = Math.random() * 1.6 - 0.8;
    gg.gain.setValueAtTime(0, t); gg.gain.linearRampToValueAtTime(0.06, t + dur * 0.4); gg.gain.exponentialRampToValueAtTime(0.0005, t + dur); gg.gain.linearRampToValueAtTime(0, t + dur + 0.01);
    o.connect(gg).connect(p).connect(bus.inp); o.start(t); o.stop(t + dur + 0.02);
    o.onended = () => { o.disconnect(); gg.disconnect(); p.disconnect(); };
    heard({ t: 'grain' });
    setLive(true); lastSound = performance.now();
  }
  const grains = (hz, n, gap) => { for (let i = 0; i < n; i++) setTimeout(() => grain(hz), i * gap * 1000); };

  function on(e) {                                      // событие модели → узлы
    if (e.t === 'voice') { if (e.on) voiceOn(e.a); else voiceOff(e.a, e.tau); }
    else if (e.t === 'angel') { if (e.rebuild && voices.has(e.a)) { voiceOff(e.a, 0.15); voiceOn(e.a); } else retune(e.a); }
    else if (e.t === 'fx') applyFx();
    else if (e.t === 'grain') grain(e.hz);
    else if (e.t === 'grains') grains(e.hz, e.n, e.gap);
    else if (e.t === 'chime') { grains(e.hz, 6, 0.045); heard({ t: 'chime', a: e.a }); }   // планета над поющим ангелом: 6 зёрен и вспышка
  }

  return {
    build, on,
    listen(fn) { listeners.push(fn); },
    get live() { return !!(bus && bus.live); },
  };
}
