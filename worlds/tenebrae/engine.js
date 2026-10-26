// Звук Tenebrae (мир I) на узлах Web Audio — перенесён из app.js как есть, за API «действий».
// Модель (app.js) шлёт поля голоса, связи, LFO и FX; формулы тона (частота, cutoff, сдвиг) — здесь, из tone.js.
// Этот файл — эталон для ядра C++ (core/worlds/tenebrae/); потом его место займёт тонкий клей к ядру с тем же API.
// Узлы создаются на переданном ctx; из host/audio.js — только чистые кривые перегруза soft / asym.
import { asym, soft } from '../../host/audio.js';
import { clamp } from '../../host/util.js';
import { NW, WAVES, weight } from '../../host/waves.js';
import { alignCoeffs, beatHz, cutoffOf, freqOf, shiftHz, waveCoeffs } from './tone.js';

// коды действий — те же числа, что enum Act в core/worlds/tenebrae/world.hpp
export const ACT = { VOICE: 0, ON: 1, OFF: 2, LIVE: 3, LINKS: 4, LFO: 5, FX: 6, STRIKE: 7, CLEAR: 8 };
export const LINK_TYPES = ['fm', 'tzfm', 'am', 'rm'];
export const LFO_KEYS = ['pitch', 'wave', 'cut', 'res', 'beat', 'shift', 'amp', 'fm'];

export const FB_BASE = 0.3;      // гребёнка-резонатор: постоянная фоновая окраска
export const RES_MAX = 24;       // res: Q фильтра в дБ
export const FM_MAX = 1.4;       // собственная fm на полную: девиация в долях частоты
export const DLY_REPEATS = 0.46; // обратная связь дилея
const VOICES = 6, SCOPE_N = 128;

// сдвиг частоты: две цепочки фазовращателей дают сигнал и его копию со сдвигом фазы на 90°
// (преобразование Гильберта, коэффициенты О. Ниемиталы), дальше I·cos + Q·sin: все частоты едут
// на одни и те же герцы, гармоники перестают быть кратными — металл, колокол, «неправильный» звук
const HILB = [[0.6923878, 0.9360654322959, 0.988229522686, 0.9987488452737],
  [0.4021921162426, 0.856171088242, 0.9722909545651, 0.9952884791278]];

// кривая для WaveShaper: вход −1..1 — это позиция 0..1, выход — вес (с громкостью таблицы или без)
function weightCurve(i, level, shape = 1) {
  const n = 1024, c = new Float32Array(n);
  for (let j = 0; j < n; j++) c[j] = weight(i, j / (n - 1)) ** shape * level;
  return c;
}
// слышны только соседние таблицы вокруг позиции морфа (и размах LFO на волне) — остальные генераторы
// отцеплены от графа и не считаются; отцепляются с задержкой, пока позиция доезжает
const tableSpan = (p, d) => [Math.max(0, Math.floor(clamp(p - d) * (NW - 1) + 1e-6)), Math.min(NW - 1, Math.ceil(clamp(p + d) * (NW - 1) - 1e-6))];
function useTables(mo, lo, hi) {
  mo.tabs.forEach((t, i) => {
    if (i >= lo && i <= hi) { t.want = true; if (!t.on) { t.o.connect(t.gn); t.on = true; } }
    else if (t.on && t.want) {
      t.want = false;
      setTimeout(() => { if (!t.want && t.on) { t.o.disconnect(t.gn); t.on = false; } }, 160);
    }
  });
}
function shifterOn(sh, on) {
  if (on === sh.on) return;
  sh.on = on;
  if (on) {
    if (!sh.linked) { for (const h of sh.heads) sh.input.connect(h); sh.wet.connect(sh.output); sh.linked = true; }
  } else setTimeout(() => {                      // после перехода сухой/мокрый — отцепить
    if (!sh.on && sh.linked) { for (const h of sh.heads) sh.input.disconnect(h); sh.wet.disconnect(sh.output); sh.linked = false; }
  }, 150);
}

// ctx — аудиоконтекст; out — вход канала мира I; send — посыл в общий зал ядра; scale — лад { on, inScale(n) }
export function createEngine({ ctx, out: chanIn, send, scale }) {
  const gainNode = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
  const filter = (type, f, q) => { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; if (q != null) n.Q.value = q; return n; };
  const lfo = (rate, depth, ...params) => {
    const o = ctx.createOscillator(); o.frequency.value = rate; o.start();
    const a = gainNode(depth); o.connect(a);
    for (const p of params) a.connect(p);
  };

  // таблицы: цикл волны → гармоники → PeriodicWave; громкость выравнивается по RMS.
  // LFO — исходная форма (её видно и слышно как форму); у голосов фазы гармоник у всех таблиц одни (как у saw):
  // морф между соседями — чистая интерполяция амплитуд, без провалов громкости и взаимного гашения посередине
  const coeffs = WAVES.map((w) => waveCoeffs(w.fn));
  const al = alignCoeffs(coeffs, WAVES.findIndex((w) => w.label === 'saw'));
  const TAB = coeffs.map((c, i) => ({
    level: c.level,
    pwLfo: ctx.createPeriodicWave(Float32Array.from(c.re), Float32Array.from(c.im)),
    pw: ctx.createPeriodicWave(Float32Array.from(al[i].re), Float32Array.from(al[i].im)),
  }));
  const noiseBuf = (() => {
    const len = Math.floor(ctx.sampleRate * 4), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  })();

  // генератор с морфингом: по осциллятору на таблицу, их веса — из позиции (позиция — звуковой сигнал,
  // поэтому её можно модулировать хоть на звуковой скорости). Частота и строй — общие на весь набор.
  function morphOsc(shapers, dest, lfoShapes = false) {
    const fq = ctx.createConstantSource(); fq.offset.value = 0;
    const dt = ctx.createConstantSource(); dt.offset.value = 0;
    const oscs = [fq, dt], tabs = [];
    TAB.forEach((w, i) => {
      const o = ctx.createOscillator(); o.setPeriodicWave(lfoShapes ? w.pwLfo : w.pw); o.frequency.value = 0;
      fq.connect(o.frequency); dt.connect(o.detune);
      const gn = gainNode(0);
      shapers[i].connect(gn.gain);
      o.connect(gn).connect(dest);
      oscs.push(o);
      tabs.push({ o, gn, on: true, want: true });
    });
    for (const o of oscs) o.start();
    return { freq: fq.offset, detune: dt.offset, oscs, tabs };
  }
  // позиция морфинга → веса таблиц
  function morphPos(p, withLevel) {
    const c = ctx.createConstantSource(); c.offset.value = 2 * p - 1; c.start();
    const shapers = TAB.map((w, i) => {
      const sh = ctx.createWaveShaper(); sh.curve = withLevel ? weightCurve(i, w.level, 0.85) : weightCurve(i, 1);   // 0.85 — ровная громкость по ходу морфа
      c.connect(sh);
      return sh;
    });
    return { pos: c.offset, src: c, shapers };
  }
  function shifter(input, output) {
    const heads = [];
    const chain = (as) => {
      let x = null;
      for (const a of as) { const f = ctx.createIIRFilter([a * a, 0, -1], [1, 0, -a * a]); if (x) x.connect(f); else heads.push(f); x = f; }
      return x;
    };
    const I = ctx.createIIRFilter([0, 1], [1]);   // одна ветка на отсчёт позже — так фазы расходятся ровно на 90°
    chain(HILB[0]).connect(I);
    const Q = chain(HILB[1]);
    const cos = ctx.createOscillator(), sin = ctx.createOscillator();
    cos.setPeriodicWave(ctx.createPeriodicWave(new Float32Array([0, 1]), new Float32Array([0, 0]), { disableNormalization: true }));
    cos.frequency.value = 0; sin.frequency.value = 0;
    const mi = gainNode(0), mq = gainNode(0), wet = gainNode(0), dry = gainNode(1);
    cos.connect(mi.gain); sin.connect(mq.gain);
    I.connect(mi).connect(wet);
    Q.connect(mq).connect(wet);                    // I·cos + Q·sin: с этим знаком плюс — вверх
    input.connect(dry).connect(output);
    cos.start(); sin.start();
    // пока сдвиг выключен, ветки отключены от графа и не считаются (см. shifterOn)
    return { cos, sin, wet, dry, heads, input, output, on: false, linked: false };
  }

  // ---------- шина голосов → drive (перегруз) → сухой звук; дилей и зал — посылы поверх него ----------
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuf; noise.loop = true; noise.start();
  const bus = ctx.createGain();
  const pre = gainNode(0.8), post = gainNode(1);
  const drive = ctx.createWaveShaper(); drive.curve = asym(2.4, 0.35); drive.oversample = '4x';
  bus.connect(pre).connect(drive).connect(post);
  const out = gainNode(1);
  post.connect(out);

  // стерео-дилей: две линии крест-накрест, время слегка плавает, как у ленты
  const dSend = gainNode(0);
  const dL = ctx.createDelay(2), dR = ctx.createDelay(2);
  dL.delayTime.value = 0.37; dR.delayTime.value = 0.53;
  const fbL = gainNode(DLY_REPEATS), fbR = gainNode(DLY_REPEATS);
  const lpL = filter('lowpass', 2600, -3), lpR = filter('lowpass', 2100, -3);
  post.connect(dSend);
  dSend.connect(dL);
  dL.connect(lpL).connect(fbL).connect(dR);
  dR.connect(lpR).connect(fbR).connect(dL);
  lfo(0.13, 0.004, dL.delayTime);
  lfo(0.087, 0.005, dR.delayTime);
  const dMerge = ctx.createChannelMerger(2);
  dL.connect(dMerge, 0, 0); dR.connect(dMerge, 0, 1);
  dMerge.connect(out);

  // зал слышит и сухой звук, и повторы дилея
  // посыл — в общий зал ядра (T.send); после возврата зала в цепи ничего нет (out → канал), коэффициент прежний: rev²·1.4
  const revSend = gainNode(0);
  post.connect(revSend); dMerge.connect(revSend);
  revSend.connect(send);
  out.connect(chanIn);

  // ---------- голос ----------
  function voiceNodes(i) {
    const k = 1 + i * 0.137;                  // у каждого кружка свои скорости дыхания
    const pan = (p) => { if (!ctx.createStereoPanner) return gainNode(1); const s = ctx.createStereoPanner(); s.pan.value = p; return s; };

    // пара генераторов, разведённая по стерео; второй сдвинут на detune; обе половины морфят из одной позиции
    const tone = gainNode(1);
    const morph = morphPos(0.125, true);     // позиция по умолчанию (WAVE_DEF); настоящую ставит первый voice()
    const p1 = pan(-0.5), p2 = pan(0.5);
    p1.connect(tone); p2.connect(tone);
    const c1 = morphOsc(morph.shapers, p1), c2 = morphOsc(morph.shapers, p2);
    const sub = ctx.createOscillator(), m = ctx.createOscillator();
    sub.type = 'sine'; m.type = 'sine';
    sub.connect(gainNode(0.28)).connect(tone);
    for (const o of [sub, m]) o.start();

    // живость: медленный дрейф строя у каждого генератора по-своему…
    lfo(0.071 * k, 5, c1.detune); lfo(0.19 * k, 2.5, c1.detune);
    lfo(0.053 * k, 6, c2.detune); lfo(0.23 * k, 2, c2.detune);
    // …и быстрая аналоговая нестабильность: свой шум, отфильтрованный до десятков герц, ±3 цента
    const jit = ctx.createBufferSource();
    jit.buffer = noiseBuf; jit.loop = true; jit.start(0, Math.random() * 3.5);
    jit.connect(filter('lowpass', 23 * k, -3)).connect(gainNode(140)).connect(c1.detune);
    jit.connect(filter('lowpass', 31 * k, -3)).connect(gainNode(-140)).connect(c2.detune);

    // модулятор: собственная fm и выход для связей. Сам он ничем не модулируется — петель нет
    const sfm = gainNode(0); m.connect(sfm);
    const fmTargets = [c1.freq, c2.freq];
    for (const p of fmTargets) sfm.connect(p);
    const mod = gainNode(0); m.connect(mod);

    // перегруз внутри голоса → фильтр, который сам медленно гуляет
    const driveIn = gainNode(0.5);
    const shaper = ctx.createWaveShaper(); shaper.curve = soft(3, true); shaper.oversample = '2x';
    const lp = filter('lowpass', 800, 5);
    const shf = shifter(tone, driveIn);           // сдвиг частоты — до перегруза и фильтра
    driveIn.connect(shaper).connect(lp);
    lfo(0.043 * k, 280, lp.detune);

    // дыхание шумом: полоса на гармонике кружка, вверху поля — шипение
    const nz = gainNode(0);
    const bp = filter('bandpass', 400, 6);
    noise.connect(bp).connect(gainNode(2.4)).connect(nz);
    const hiss = gainNode(0);
    noise.connect(filter('highpass', 3000)).connect(hiss).connect(nz);

    const env = gainNode(0);
    lp.connect(env); nz.connect(env);

    // гребёнка, настроенная на высоту: тихая постоянная окраска
    const sum = gainNode(1);
    env.connect(sum);
    const dl = ctx.createDelay(1), comb = gainNode(0.45);
    const loopLP = filter('lowpass', 3000, -3);
    const loopSat = ctx.createWaveShaper(); loopSat.curve = soft(1.6, false);
    const fb = gainNode(FB_BASE);
    env.connect(dl);
    dl.connect(loopLP).connect(loopSat).connect(fb).connect(dl);
    dl.connect(comb).connect(sum);

    // усилитель для am / rm от связей
    const vca = gainNode(1);
    const vscope = ctx.createAnalyser(); vscope.fftSize = 1024; vscope.smoothingTimeConstant = 0;   // для контура кружка
    const lvl = gainNode(0.55);
    const breath = gainNode(1);                  // громкость чуть дышит — в долях от громкости, тихую планету дыхание не пробивает
    lfo(0.09 * k, 0.13, breath.gain);
    const vout = pan(0);
    sum.connect(vca).connect(breath).connect(lvl).connect(vout);  // к шине подключается, только пока кружок звучит

    return { c1, c2, sub, m, morph, tone, shf, sfm, mod, driveIn, lp, bp, nz, hiss, env, dl, comb, vca, lvl, vscope, out: vout, fmTargets, lfo: {}, live: false,
      buf: new Float32Array(1024), pts: new Float32Array(SCOPE_N) };
  }
  const N = Array.from({ length: VOICES }, (_, i) => voiceNodes(i));
  const F = new Array(VOICES).fill(null);         // последние поля голоса от модели (null — ещё не присылали)
  const M = Array.from({ length: VOICES }, () => []);   // связи приёмника: { src, type, depth, g }
  const L = Array.from({ length: VOICES }, () => ({}));  // LFO голоса: key → { morph, rate, depth }
  const freqOf_ = (i) => freqOf(F[i].x, scale);
  // сколько FM на кружке: пока она есть, фильтр приоткрывается — иначе он съедает боковые полосы
  const fmOpen = (i) => Math.min(1, F[i].fm + M[i].reduce((s, m) => s + (m.type === 'fm' || m.type === 'tzfm' ? m.depth : 0), 0));

  // связи: глубина в единицах своей цели — fm до ±2 октав; tzfm — индекс до 5 от частоты источника (как в настоящей FM); am — полная; rm — громкий
  const linkDepth = (m) => (m.type === 'fm' ? m.depth * 2400 : m.type === 'tzfm' ? m.depth * 5 * (F[m.src] ? freqOf_(m.src) : 0)
    : m.type === 'am' ? m.depth : m.depth * 1.6);

  function apply(i, s) {
    const n = N[i], v = F[i];
    if (!v) return;
    const t = ctx.currentTime, lf = L[i];
    const T = (p, val, tau) => p.setTargetAtTime(val, t, s ? 0.004 : tau);
    const f = freqOf_(i), y = v.y, G = 0.14;
    T(n.c1.freq, f, G);
    T(n.c2.freq, f + beatHz(v.beat), G);
    T(n.sub.frequency, f / 2, G);
    T(n.m.frequency, f, G);
    T(n.morph.pos, 2 * v.wave - 1, 0.04);
    const wl = lf.wave ? lf.wave.depth : 0, [tlo, thi] = tableSpan(v.wave, wl);
    useTables(n.c1, tlo, thi); useTables(n.c2, tlo, thi);
    const sh = shiftHz(v.shift), shOn = sh !== 0 || !!lf.shift;
    shifterOn(n.shf, shOn);
    T(n.shf.cos.frequency, sh, 0.06); T(n.shf.sin.frequency, sh, 0.06);   // одинаково — иначе пара разойдётся по фазе
    T(n.shf.wet.gain, shOn ? 1 : 0, 0.02); T(n.shf.dry.gain, shOn ? 0 : 1, 0.02);
    // ось Y: внизу чистые колебания, вверху перегруз и шум, вытесняющий тон.
    // В чёрной дыре (h) тон и настроенная гребёнка съедены, остаётся широкий шум — глубже, темнее
    const h = v.holeT;
    T(n.driveIn.gain, 0.22 + 3.6 * y * y, 0.1);
    T(n.tone.gain, (1 - 0.65 * y ** 1.5) * (1 - h), 0.15);
    T(n.lp.frequency, cutoffOf(v.cut, y, fmOpen(i)), 0.1);
    T(n.lp.Q, v.res * RES_MAX, 0.1);
    T(n.nz.gain, 0.95 * y ** 1.8 * (1 - h) + 0.9 * h, 0.15);
    T(n.bp.frequency, Math.min(f * 3 * 2 ** (y * 2), 9000) ** (1 - h) * 600 ** h, 0.15);
    T(n.bp.Q, (9 - 6 * y) * (1 - h) + 0.5 * h, 0.15);
    T(n.hiss.gain, 0.25 * y ** 3 * (1 - h), 0.15);
    T(n.comb.gain, 0.45 * (1 - h), 0.15);
    let d = 1 / f;
    while (d < 0.006) d *= 2;
    T(n.dl.delayTime, d, G);
    if (n.out.pan) T(n.out.pan, (v.x - 0.5) * 0.6, 0.2);
    T(n.sfm.gain, f * FM_MAX * v.fm, 0.08);
    // связи; rm забирает долю прямого сигнала
    let rm = 0;
    for (const m of M[i]) {
      if (m.type === 'rm') rm += m.depth;
      T(m.g.gain, linkDepth(m), 0.08);
    }
    T(n.vca.gain, Math.max(0, 1 - rm), 0.08);
    const alive = 1 - clamp((h - 0.5) / 0.45);  // в глубине дыры звук умирает
    T(n.lvl.gain, 0.55 * v.amp * alive, 0.15);   // громкость генератора — щипок по планете
    // LFO: скорость и глубина в единицах своей цели
    for (const [key, spec] of Object.entries(lf)) {
      const LN = n.lfo[key];
      if (!LN) continue;
      LN.mo.freq.setTargetAtTime(spec.rate, t, 0.05);
      LN.mp.pos.setTargetAtTime(2 * spec.morph - 1, t, 0.05);
      const [la, lb] = tableSpan(spec.morph, 0);
      useTables(LN.mo, la, lb);
      const d2 = spec.depth;
      const depth = key === 'pitch' ? d2 * 700 : key === 'wave' ? d2 * 2 : key === 'cut' ? d2 * 4800
        : key === 'res' ? d2 * 20 : key === 'beat' ? d2 * 16 : key === 'shift' ? d2 * 300 : key === 'amp' ? d2 * 0.55 * v.amp * alive : d2 * f * FM_MAX;
      LN.out.gain.setTargetAtTime(depth, t, 0.05);
    }
  }

  // связи и LFO без следом идущего voice() применяются в конце текущей задачи — один раз;
  // voice() того же голоса в той же задаче снимает отложенное (иначе второй проход перебил бы snap)
  const pend = new Set();
  let flushQ = false;
  function later(i) {
    pend.add(i);
    if (flushQ) return;
    flushQ = true;
    queueMicrotask(() => { flushQ = false; for (const j of pend) apply(j, false); pend.clear(); });
  }

  function lfoTargets(n, key) {
    if (key === 'pitch') return [n.c1.detune, n.c2.detune, n.sub.detune];
    if (key === 'wave') return [n.morph.pos];
    if (key === 'cut') return [n.lp.detune];
    if (key === 'res') return [n.lp.Q];
    if (key === 'beat') return [n.c2.freq];
    if (key === 'shift') return [n.shf.cos.frequency, n.shf.sin.frequency];
    if (key === 'amp') return [n.lvl.gain];
    return [n.sfm.gain];
  }
  function linkTargets(n, type) {
    if (type === 'fm') return [n.c1.detune, n.c2.detune];   // экспоненциальная, по строю
    if (type === 'tzfm') return n.fmTargets;                 // линейная, сквозь ноль, в герцах
    return [n.vca.gain];                                     // am и rm — через усилитель кружка
  }

  const E = {
    // v — поля голоса модели: x, y, cut, res, wave, beat (Гц), fm, shift, amp, holeT, snap
    voice(i, v) {
      F[i] = { x: v.x, y: v.y, cut: v.cut, res: v.res, wave: v.wave, beat: v.beat, fm: v.fm, shift: v.shift, amp: v.amp, holeT: v.holeT };
      pend.delete(i);
      apply(i, !!v.snap);
      // tzfm от этого голоса: глубина в Гц идёт за его частотой — у приёмников пересчитать только её
      for (let u = 0; u < VOICES; u++) {
        if (u === i || !F[u]) continue;
        for (const m of M[u]) if (m.src === i && m.type === 'tzfm') m.g.gain.setTargetAtTime(linkDepth(m), ctx.currentTime, 0.08);
      }
    },
    on(i) {
      const n = N[i];
      n.env.gain.setTargetAtTime(1, ctx.currentTime, 0.12);
      n.mod.gain.setTargetAtTime(1, ctx.currentTime, 0.12);
    },
    off(i, tau) {
      const n = N[i];
      n.env.gain.setTargetAtTime(0, ctx.currentTime, tau);
      n.mod.gain.setTargetAtTime(0, ctx.currentTime, tau);
    },
    // молчащий кружок отключён от графа и не тратит процессор
    live(i, on) {
      const n = N[i];
      if (!!on === n.live) return;
      if (on) { n.out.connect(bus); n.vca.connect(n.vscope); } else { n.out.disconnect(); n.vca.disconnect(n.vscope); }
      n.live = !!on;
    },
    // mods — все связи приёмника i: [{ src (номер голоса), type ('fm' | 'tzfm' | 'am' | 'rm' или его номер), depth }].
    // Та же пара источник+тип сохраняет свой узел; новая — новый узел с нуля, пропавшая — отцеплена
    links(i, mods) {
      const old = M[i], next = [];
      let changed = old.length !== mods.length;
      for (const q of mods) {
        const type = typeof q.type === 'number' ? LINK_TYPES[q.type] : q.type;
        const j = old.findIndex((m) => m && m.src === q.src && m.type === type);
        let g;
        if (j >= 0) { g = old[j].g; if (old[j].depth !== q.depth) changed = true; old[j] = null; }
        else {
          changed = true;
          g = gainNode(0);
          N[q.src].mod.connect(g);
          for (const p of linkTargets(N[i], type)) g.connect(p);
        }
        next.push({ src: q.src, type, depth: q.depth, g });
      }
      for (const m of old) if (m) { m.g.disconnect(); changed = true; }
      M[i] = next;
      if (changed) later(i);
    },
    // spec — { morph, rate, depth } или null (снять)
    lfo(i, key, spec) {
      const n = N[i], lf = L[i];
      if (!spec) {
        if (!lf[key]) return;
        delete lf[key];
        const LN = n.lfo[key];
        if (LN) {
          LN.out.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
          delete n.lfo[key];
          setTimeout(() => {
            for (const o of [...LN.mo.oscs, LN.mp.src]) { try { o.stop(); } catch (_) { /* ok */ } o.disconnect(); }
            LN.out.disconnect();
          }, 400);
        }
        later(i);
        return;
      }
      const was = lf[key];
      if (was && was.morph === spec.morph && was.rate === spec.rate && was.depth === spec.depth) return;
      lf[key] = { morph: spec.morph, rate: spec.rate, depth: spec.depth };
      if (!n.lfo[key]) {
        const o = gainNode(0);
        for (const p of lfoTargets(n, key)) o.connect(p);
        const sum = gainNode(1);
        const mp = morphPos(spec.morph, false);
        const mo = morphOsc(mp.shapers, sum, true);
        sum.connect(o);
        n.lfo[key] = { out: o, mp, mo };
      }
      later(i);
    },
    fx({ rev, dly, dirt }) {
      const t = ctx.currentTime, T = (p, v) => p.setTargetAtTime(v, t, 0.05);
      T(revSend.gain, rev * rev * 1.4);
      T(dSend.gain, dly * 0.7);
      T(pre.gain, 0.45 + dirt ** 1.4 * 14);   // до ~15× в перегруз
      T(post.gain, 2.2 / (1 + 4 * dirt ** 0.8));   // громкость примерно ровная по всему ходу drive
    },
    // удар солнца: треск (шум в полосе, двумя щелчками) и глухой толчок; через шину голосов — с залом и перегрузом
    strike(p) {
      const t = ctx.currentTime, lvl = 0.05 + 0.1 * p;
      const n = ctx.createBufferSource(), bp = filter('bandpass', 1800 + 2600 * Math.random(), 1.2), ng = gainNode(0);
      n.buffer = noiseBuf;
      const t2 = t + 0.012 + 0.02 * Math.random();
      ng.gain.setValueAtTime(lvl, t); ng.gain.exponentialRampToValueAtTime(lvl * 0.08, t2);
      ng.gain.setValueAtTime(lvl * 0.7, t2); ng.gain.exponentialRampToValueAtTime(0.0005, t2 + 0.04 + 0.06 * p);
      n.connect(bp).connect(ng).connect(bus);
      n.start(t, Math.random() * 3); n.stop(t2 + 0.12);
      const o = ctx.createOscillator(), og = gainNode(0);
      o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.08);
      og.gain.setValueAtTime(lvl * 1.4, t); og.gain.exponentialRampToValueAtTime(0.0005, t + 0.12);
      o.connect(og).connect(bus); o.start(t); o.stop(t + 0.14);
    },
    // корзина: все звучащие гаснут за четверть секунды, связи сняты (LFO снимает модель, когда голос умолкнет)
    clear() {
      for (let i = 0; i < VOICES; i++) {
        E.links(i, []);
        if (N[i].live) E.off(i, 0.25);
      }
    },
    // чем больше кружков, тем тише каждый: sum — Σ огибающих звучащих
    busEnv(sum) { bus.gain.setTargetAtTime(1 / Math.sqrt(Math.max(1, sum)), ctx.currentTime, 0.3); },
    // контур кружка: 128 точек — два периода сигнала после vca от первого перехода через ноль снизу вверх
    scope(i) {
      const n = N[i];
      if (!n.live || !F[i]) return null;
      const b = n.buf;
      n.vscope.getFloatTimeDomainData(b);
      let s0 = 0;
      for (let j = 1; j < 480; j++) if (b[j - 1] < 0 && b[j] >= 0) { s0 = j; break; }
      const span = Math.round(clamp((ctx.sampleRate / freqOf_(i)) * 2, 64, 520));
      for (let j = 0; j < SCOPE_N; j++) n.pts[j] = b[s0 + Math.floor((j / SCOPE_N) * span)];
      return n.pts;
    },
    dispose() { out.disconnect(); },
  };
  return E;
}
