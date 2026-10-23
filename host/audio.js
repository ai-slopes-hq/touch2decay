// звук хоста: контекст, мастер (срез, компрессор, потолок), микшер-каналы миров, общий зал, громкость,
// ядро SDK (t2d.wasm: миры SDK и четыре общих ревербера, посылы миров T.send), перезапуск при смене выхода, разблокировка звука в iOS.
// Голоса Tenebrae — в app.js (solBuild)
import { startClock } from './clock.js';
import { clamp } from './util.js';
import { worlds, nav } from './registry.js';
import { scl } from './scale.js';

export let ctx = null, an = null, scopeBuf = null;
// асимметричный перегруз: смещённый tanh даёт чётные гармоники — ламповая/фузовая грязь, а не просто громче
export function asym(k, bias) {
  const n = 4096, c = new Float32Array(n), o = Math.tanh(bias);
  let peak = 0;
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x + bias) - o; peak = Math.max(peak, Math.abs(c[i])); }
  for (let i = 0; i < n; i++) c[i] /= peak;
  return c;
}

// tanh-кривая: normed=true — выход до ±1 (мастер), false — наклон 1 в нуле (петля обратной связи)
// потолок мастера: до колена (knee) — прямая с усилением k, выше — мягко к потолку top. Тихое и среднее — чисто,
// без гармоник; раньше тут был сплошной tanh, и удары пластины хрипели — каждый пик шёл в перегруз
export function knee(k, kn, top) {
  const n = 4096, c = new Float32Array(n), room = top - kn;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1, y = Math.abs(k * x);
    c[i] = Math.sign(x) * (y < kn ? y : kn + room * Math.tanh((y - kn) / room));
  }
  return c;
}
export function soft(k, normed) {
  const n = 4096, c = new Float32Array(n), d = normed ? Math.tanh(k) : k;
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / d; }
  return c;
}

export function noiseBuffer(seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

export const gainNode = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
export function filter(type, f, q) {
  const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f;
  if (q != null) n.Q.value = q;
  return n;
}
export function lfo(rate, depth, ...params) {
  const o = ctx.createOscillator(); o.frequency.value = rate; o.start();
  const a = gainNode(depth); o.connect(a);
  for (const p of params) a.connect(p);
  return { o, a };
}

// зал: четыре линии задержки с перекрёстной обратной связью (матрица Хаусхолдера).
// На входе срез низа — иначе бас дрона превращает хвост в кашу — и фазовое размазывание.
export function hall() {
  const N = 4, SIZE = 2.4, base = [0.0297, 0.0371, 0.0411, 0.0437];
  const input = gainNode(1);
  let x = input.connect(filter('highpass', 280, -3)).connect(filter('lowpass', 7500, -3));
  for (const fr of [430, 1150, 2400, 4300]) { const ap = filter('allpass', fr, 0.7); x.connect(ap); x = ap; }
  const mix = gainNode(-2 / N);
  const merge = ctx.createChannelMerger(2);
  const lines = [];
  for (let i = 0; i < N; i++) {
    const len = base[i] * SIZE;
    const d = ctx.createDelay(1); d.delayTime.value = len;
    lfo(0.13 + i * 0.07, 0.0009, d.delayTime);          // лёгкое плавание — хвост не звенит металлом
    const damp = filter('lowpass', 6000 - i * 500, -3);
    const gn = gainNode(0.7);
    x.connect(i % 2 ? gainNode(-1) : gainNode(1)).connect(d);
    d.connect(damp).connect(gn);
    gn.connect(d);
    gn.connect(mix);
    mix.connect(d);
    d.connect(merge, 0, i % 2);
    lines.push({ g: gn, len });
  }
  return { input, out: merge, lines };
}

// ---------- ядро SDK: t2d.wasm в t2d-worklet.js — один узел на контекст (build), на хост и все миры SDK ----------
// Входы узла — посылы миров на Web Audio в ревербы ядра (по стереовходу на тип: room 0, plate 1, hall 2, cathedral 3), выходы —
// возврат ревербов (→ общий вход мастера, до компрессора) и сухой звук каждого мира SDK (→ его канал микшера, через engine мира).
// Порт: send(m) → номер сообщения (фасад модели мира сверяет по нему зеркало: t2d-worklet.js шлёт, сколько сообщений применено);
// пока узла нет (качается wasm, грузится модуль) — очередь. Не загрузилось — console.error, миры на Web Audio звучат без реверба.
export const REVS = ['room', 'plate', 'hall', 'cathedral'];
export const SDK_WORLDS = [10];                          // слоты миров SDK в ядре (номер мира): Firmamentum
let coreVer = '0', coreBytes = null;                     // байты t2d.wasm — качаются один раз, на каждый новый контекст — копия
export function setCoreVer(v) { coreVer = v; }
export let core = null;
let building = null;                                     // мир, чей build идёт сейчас: его посылы — после его фейдера
function buildCore(c, masterIn) {
  const k = { ctx: c, node: null, ready: false, sent: 0, queue: [], subs: [], scale: '' };
  k.ins = REVS.map(() => gainNode(1));                   // сумма посылов по типу → вход узла
  k.ret = gainNode(1); k.ret.connect(masterIn);
  k.dry = Object.fromEntries(SDK_WORLDS.map((s) => [s, gainNode(1)]));
  k.send = (m) => { k.sent++; if (k.node) k.node.port.postMessage(m); else k.queue.push(m); return k.sent; };
  k.listen = (fn) => { k.subs.push(fn); };
  if (!coreBytes) coreBytes = fetch(`t2d.wasm?v=${coreVer}`).then((r) => { if (!r.ok) throw new Error(`t2d.wasm ${r.status}`); return r.arrayBuffer(); });
  Promise.all([c.audioWorklet.addModule(`t2d-worklet.js?v=${coreVer}`), coreBytes]).then(([, buf]) => {
    if (core !== k) return;                              // пока грузилось, звук перезапустили — этот узел уже не нужен
    const node = new AudioWorkletNode(c, 't2d', {
      numberOfInputs: REVS.length, numberOfOutputs: 1 + SDK_WORLDS.length, outputChannelCount: [2, ...SDK_WORLDS.map(() => 2)],
      processorOptions: { wasm: buf.slice(0), seed: (Math.random() * 4294967296) >>> 0, worlds: SDK_WORLDS },
    });
    k.ins.forEach((g, r) => g.connect(node, 0, r));
    node.connect(k.ret, 0);
    SDK_WORLDS.forEach((s, j) => node.connect(k.dry[s], 1 + j));
    node.onprocessorerror = () => console.error('t2d core: the worklet failed');
    node.port.onmessage = (e) => {
      const d = e.data;
      if (d.t === 'm') { for (const fn of k.subs) fn(d); } else if (d.t === 'ready') k.ready = true;
      else if (d.t === 'err') console.error('t2d core:', d.msg);
    };
    k.node = node;
    while (k.queue.length) node.port.postMessage(k.queue.shift());
  }).catch((err) => { console.error('t2d core:', err); if (core === k) coreBytes = null; });
  return k;
}
// посыл мира в ревербер ядра: GainNode (усиление — фейдер мира, посыл после фейдера: заглушил мир — хвост дозвучит) → вход ядра типа rev.
// Зовётся из build мира (мир — тот, чей build идёт) или с номером мира n
export function send(rev, n = building) {
  const i = REVS.indexOf(rev), r = i < 0 ? REVS.indexOf('hall') : i;   // неизвестный тип — hall
  const g = gainNode(n == null ? 1 : chanGain(n));
  g.connect(core.ins[r]);
  if (n != null && chans[n]) chans[n].sends.push(g);
  return g;
}
// лад — в ядро, когда сменился (зовёт кадр app.js: лад меняют многие места — сравнить дешевле, чем помнить их все)
export function syncScale() {
  if (!core) return;
  const key = `${scl.on}|${scl.idx}|${scl.root}`;
  if (key === core.scale) return;
  core.scale = key;
  core.send({ t: 'scale', on: scl.on, idx: scl.idx, root: scl.root });
}

// громкость — общая на всё приложение, кружок с фейдером перед ладом; зажал — вниз выдвигается длинная шкала,
// палец ведёт её без скачка. Снизу off, выше нуля — до +6 дБ (сильнее в мягкий лимитер). Запоминается на устройстве
export const VOL_TRAVEL = 220, VOL_LO = -48, VOL_HI = 6, VOL_DEF = -VOL_LO / (VOL_HI - VOL_LO);
export let vol = VOL_DEF, masterG = null;
try { const sv = parseFloat(localStorage.getItem('t2d-vol')); if (sv >= 0 && sv <= 1) vol = sv; } catch (_) { /* приватный режим */ }
export const volDb = (t) => VOL_LO + (VOL_HI - VOL_LO) * t;
export const volGain = (t) => (t < 0.005 ? 0 : 10 ** (volDb(t) / 20));
export const volText = (t) => (t < 0.005 ? 'off' : `${volDb(t) > 0.5 ? '+' : ''}${Math.round(volDb(t))} dB`);
export function setVol(t) {
  vol = clamp(t);
  if (masterG) masterG.gain.setTargetAtTime(0.8 * volGain(vol), ctx.currentTime, 0.03);
}

// микшер (concordia → mixer): громкость и mute каждого мира, мастер — срез, компрессор, потолок; запоминается
export let chans = {}, mixN = null;
export const MIX_DEF = { lpf: 1, thr: 0.75, ratio: 0.136, ceil: 1 };
export const mix = { g: {}, mute: {}, ...MIX_DEF };
try { Object.assign(mix, JSON.parse(localStorage.getItem('t2d-mix') || '{}')); } catch (_) { /* приватный режим */ }
export const saveMix = () => { try { localStorage.setItem('t2d-mix', JSON.stringify(mix)); } catch (_) { /* приватный режим */ } };
export const FADER_DEF = 36 / 42;                                // 0 дБ; шкала −36…+6, в нуле — выкл
export const faderDb = (t) => -36 + 42 * t, faderOf = (n) => (mix.g[n] == null ? FADER_DEF : mix.g[n]);
export const chanGain = (n) => (mix.mute[n] || faderOf(n) < 0.01 ? 0 : 10 ** (faderDb(faderOf(n)) / 20));
export const MIXM = {                                            // мастер: значение 0…1 → величина и подпись
  lpf: { label: 'low-pass', hz: (t) => 200 * 100 ** t, text: (t) => (t > 0.99 ? 'open' : `${Math.round(200 * 100 ** t)} Hz`) },
  thr: { label: 'compressor', db: (t) => -40 + 40 * t, text: (t) => `${Math.round(-40 + 40 * t)} dB` },
  ratio: { label: 'ratio', r: (t) => 1 + 11 * t, text: (t) => `${(1 + 11 * t).toFixed(1)} : 1` },
  ceil: { label: 'ceiling', db: (t) => -12 + 12 * t, text: (t) => `${(-12 + 12 * t).toFixed(1)} dB` },
};
export function applyMix() {
  if (!ctx || !mixN) return;
  const t = ctx.currentTime;
  for (const [n, c] of Object.entries(chans)) {
    c.g.gain.setTargetAtTime(chanGain(n), t, 0.03);
    for (const s of c.sends) s.gain.setTargetAtTime(chanGain(n), t, 0.03);   // посылы миров на Web Audio — после фейдера
  }
  if (core) for (const s of SDK_WORLDS) if (chans[s]) core.send({ t: 'fader', slot: s, g: chanGain(s) });   // миры SDK: посыл × фейдер — в ядре
  mixN.lpf.frequency.setTargetAtTime(MIXM.lpf.hz(mix.lpf) > 19000 ? 22000 : MIXM.lpf.hz(mix.lpf), t, 0.03);
  mixN.comp.threshold.setTargetAtTime(MIXM.thr.db(mix.thr), t, 0.03); mixN.comp.ratio.setTargetAtTime(MIXM.ratio.r(mix.ratio), t, 0.03);
  mixN.ceil.gain.setTargetAtTime(10 ** (MIXM.ceil.db(mix.ceil) / 20), t, 0.03);
}
export const chanLvl = {};                                       // уровень каждого мира (для карты и микшера), опрос только пока они на экране
let lvlBuf = null, lvlAt = 0;
export function pollLevels(now) {
  if (!ctx || now - lvlAt < 60) return;
  lvlAt = now; if (!lvlBuf) lvlBuf = new Float32Array(256);
  for (const [n, c] of Object.entries(chans)) { c.an.getFloatTimeDomainData(lvlBuf); let e = 0; for (let i = 0; i < 256; i++) e += lvlBuf[i] * lvlBuf[i]; const r = Math.sqrt(e / 256); chanLvl[n] = Math.max(r, (chanLvl[n] || 0) * 0.82); }
}
export const audioPref = { stable: false, midi: false };   // midi — часы по Web MIDI (host/webmidi.js)
try { Object.assign(audioPref, JSON.parse(localStorage.getItem('t2d-audio') || '{}')); } catch (_) { /* приватный режим */ }
export function saveAudioPref() { try { localStorage.setItem('t2d-audio', JSON.stringify(audioPref)); } catch (_) { /* приватный режим */ } }
export let restartAt = 0;
// перезапуск звука без потери патчей: Safari после смены выхода (USB-интерфейс, другая частота) хрипит, пока контекст не пересоздан.
// Снимки миров → новый контекст (build пересобирает и голоса Tenebrae) → миры восстанавливаются из снимков
export function restartAudio() {
  if (!ctx) return;
  const keep = {};
  for (const [n, w] of Object.entries(worlds)) if (+n !== 1 && w.snapshot) { try { keep[n] = w.snapshot(); } catch (_) { /* мир без снимка */ } }
  const old = ctx;
  build();
  try { old.close(); } catch (_) { /* уже закрыт */ }
  for (const [n, js] of Object.entries(keep)) { try { worlds[n].restore(js); } catch (_) { /* ok */ } }
  for (const [n, w] of Object.entries(worlds)) if (w.enter && (+n === nav.world || w.sounding())) { try { w.enter(); } catch (_) { /* ok */ } }
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  restartAt = performance.now();
}
let devT = 0;
if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {   // подключили наушники или интерфейс — пересобрать звук
  navigator.mediaDevices.addEventListener('devicechange', () => { clearTimeout(devT); devT = setTimeout(() => { if (ctx) restartAudio(); }, 800); });
}
// контекст, мастер и каналы миров; дальше каждый мир строит свой звук в свой канал (Tenebrae — первым, он мир I)
export function build() {
  const AC = window.AudioContext || window.webkitAudioContext;
  ctx = new AC({ latencyHint: audioPref.stable ? 'playback' : 'interactive' });   // stable — буфер больше: для USB-интерфейсов, где мелкий буфер хрипит
  startClock(ctx);                                       // метроном секвенсоров — от звукового потока (host/clock.js)
  const hp = filter('highpass', 30), mLpf = filter('lowpass', 20000, 0.5);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -10; comp.knee.value = 10; comp.ratio.value = 2.5;
  comp.attack.value = 0.01; comp.release.value = 0.4;
  const mCeil = gainNode(1);
  const master = gainNode(0.8 * volGain(vol));
  masterG = master;
  // мягкий потолок на выходе: вдвое больше запаса по входу, чем по выходу
  const limitIn = gainNode(0.5);
  const limit = ctx.createWaveShaper(); limit.curve = knee(2.6 / Math.tanh(2.6), 0.6, 0.98); limit.oversample = '4x';
  an = ctx.createAnalyser(); an.fftSize = 2048; scopeBuf = new Float32Array(an.fftSize);
  const masterIn = gainNode(1);               // общий вход мастера: сюда — выходы всех миров
  masterIn.connect(hp).connect(mLpf).connect(comp).connect(master).connect(limitIn).connect(limit).connect(mCeil);
  mCeil.connect(ctx.destination);
  mCeil.connect(an);
  // микшер: у каждого мира свой канал (громкость, mute, уровень для карты) → общий вход мастера
  chans = {};
  for (const n of Object.keys(worlds)) { const i0 = gainNode(1), g0 = gainNode(1), a0 = ctx.createAnalyser(); a0.fftSize = 256; i0.connect(a0); i0.connect(g0).connect(masterIn); chans[n] = { in: i0, g: g0, an: a0, sends: [] }; }   // уровень — до фейдера: на карте видно и приглушённый мир
  mixN = { lpf: mLpf, comp, ceil: mCeil };
  core = buildCore(ctx, masterIn);                       // ядро SDK — до миров: их build берут посылы (send) и сухие выходы миров SDK
  syncScale();
  applyMix();
  for (const [n, w] of Object.entries(worlds)) if (w.build) { building = n; try { w.build(ctx, chans[n].in); } finally { building = null; } }
}

// iOS: звук только после касания; плюс обход переключателя «бесшумно»
let primed = false, keep = null;
function silence() {
  const sr = 8000, n = sr / 2, b = new ArrayBuffer(44 + n * 2), dv = new DataView(b);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
}

export function unlock() {
  if (!primed) {
    primed = true;
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (_) { /* ok */ }
    try { keep = new Audio(silence()); keep.loop = true; keep.setAttribute('playsinline', ''); } catch (_) { keep = null; }
  }
  if (!ctx) build();
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  if (keep && keep.paused) keep.play().catch(() => {});
}
