// Portus — мир XIII: ночная бухта в псевдоперспективе, как в Natura. Звук — dub techno: аккорды-стабы сквозь фильтр, эхо и туман.
// Одна дорожка на 16 шагов, как река Natura: фарватер — путь от набережной в море, вдоль него 16 мест (вехи по левому краю);
// бумажный кораблик на месте — удар аккорда, поперёк фарватера — его тоника (слева ниже, справа выше, октава). Аккорд один на всю
// дорожку (квинта, sus, m7, m9, m11) и октава (−2…+2) — у маяка; у кораблика — только нота (и сдвиг октавы, громкость). Делей, ревер и фильтр — не веер FX, а сама сцена:
//   · луна — фильтр (и вместо солнца — тап по ней — карта): выше — открыт, садится к горизонту — закрыт, вбок — резонанс;
//   · колокол-буй — эхо: поперёк — время (1/8 … 1/2), дальше в море — дольше повторы (до бесконечных); круги на воде — повторы;
//     тап по небу — падает звезда и гасит накопившееся эхо;
//   · туман на горизонте — ревер: выше туман — больше зала, он прячет дальние кораблики и садящуюся луну.
// Маяк — пуск/стоп, вбок — темп. Держишь предмет — плашка. Веер FX: wow (лента), mare (шум моря), drive, spread.
const T = window.T2D;
const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const INK = '196,208,216', BGC = '#06090d', PAPER = '6,9,13', LIGHT = [238, 198, 126];
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const NOTES = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];
const CHORDS = [                                         // голоса — как у стабов Basic Channel
  { name: '5', iv: [0, 7, 12, 19] }, { name: 'sus', iv: [0, 5, 10, 14] }, { name: 'm7', iv: [0, 7, 10, 15] },
  { name: 'm9', iv: [0, 7, 10, 14, 15] }, { name: 'm11', iv: [0, 7, 10, 14, 15, 17] },
];
const DT = [2, 3, 4, 6, 8], DT_NAME = ['1/8', '3/16', '1/4', '3/8', '1/2'];   // время эха в шестнадцатых
const NSTEP = 16, PSPAN = 12;                           // 16 мест вдоль фарватера; поперёк — октава

// ---------- состояние ----------
const isles = [];                                       // кораблики {step (место 0…15), p (0…12 полутонов поперёк), oct (свой сдвиг октавы), lvl, sd, hit}
const luna = { cut: 0.42, res: 0.35, env: 0.45 };       // фильтр
const echo = { time: 1, tone: 0.45, mix: 0.6 };         // эхо: время (индекс DT), темнота, сколько посылать; повторы — по месту буя
const buoy = { u: 0.35, d: 0.45 };
const fog = { amt: 0.45, size: 0.7 };                   // ревер
const pharos = { chord: 2, oct: 0, len: 0.25, lvl: 0.8, swing: 0 };   // аккорд и октава всей дорожки
const fx = { wow: 0.25, mare: 0, drive: 0.25, spread: 0.6, chance: 1 };
const seq = { playing: false, bpm: 120, next: 0, step: 0 };
const stepSec = () => 60 / seq.bpm / 4;
const root = () => (T.scaleOn ? T.scaleRoot : 0);
const isleOn = (j) => isles.find((i) => i.step === j);
const typeOf = () => pharos.chord;                       // аккорд — один, у маяка; кораблик — только нота
function semiOf(is) {                                   // тоника от A2: поперёк фарватера — полутоны (с ладом — ступени), плюс октава маяка и кораблика
  let a = is.p + root();
  if (T.scaleOn) a = T.snapSemi(a + 24) - 24;
  return a + 12 * (pharos.oct + (is.oct || 0));
}
const hzOf = (is) => 110 * 2 ** (semiOf(is) / 12);
const nameOf = (is) => { const m = semiOf(is); return `${NOTES[((m % 12) + 12) % 12]}${CHORDS[typeOf(is)].name}`; };
const fcOf = () => 90 * 2 ** (7.2 * luna.cut);           // срез: 90 Гц … 13 кГц
const fbOf = () => clamp(0.15 + buoy.d * 0.84, 0, 0.985);   // дальше буй — дольше эхо

// ---------- геометрия: небо, горизонт, бухта между мысами, набережная внизу ----------
const K = 2.6, Q1 = 1 / (1 + K);
function geo() {
  const W = T.W, H = T.H, top = T.topY + 6, bot = H - T.safeBot - 8, Ws = Math.min(W, (H - T.safeBot) * 0.62), cx = W / 2;
  const fx0 = cx - Ws / 2, fx1 = cx + Ws / 2, hor = top + (bot - top) * 0.3, qy = bot - 66, Wh = Ws / 2 - 4;
  const mr = Math.min(46, W * 0.12), cb = T.lfoBase ? T.lfoBase('portus-luna', 'cut') : null, moon = { x: Math.max(0, fx0), y: hor - mr * 0.35 - (cb ?? luna.cut) * (hor - top - mr * 0.9), r: mr, lfo: cb != null ? clamp(0.5 + (cb - luna.cut) * 1.6) : -1 };   // с LFO на cutoff луна стоит на базе, а качание — цвет: ниже базы — кровавая   // луна вместо солнца: в левом углу, выше — фильтр открыт; к горизонту — садится
  const ph = { x: fx1 - 40, y: qy - 50 };                                                    // маяк на правом мысу, у нас под рукой
  return { W, H, top, bot, cx, Ws, fx0, fx1, hor, qy, Wh, moon, ph, fogTop: hor - 6 - fog.amt * (hor - top - 40) * 0.7 };
}
function P(G, u, d) { const q = 1 / (1 + K * d), k = (q - Q1) / (1 - Q1), wb = G.Wh * (0.8 + 0.2 * k); return { x: G.cx + u * wb, y: G.hor + (G.qy - G.hor) * k, s: q, wb }; }
function unP(G, x, y) { const k = clamp((y - G.hor) / (G.qy - G.hor)), q = Q1 + k * (1 - Q1), wb = G.Wh * (0.8 + 0.2 * k); return { u: (x - G.cx) / wb, d: (1 / q - 1) / K }; }
const kOf = (d) => (1 / (1 + K * d) - Q1) / (1 - Q1);   // 1 у набережной … 0 на горизонте
const dOfF = (f) => { const q = Q1 + (1 - f) * (1 - Q1); return (1 / q - 1) / K; };   // f — доля высоты экрана от набережной к горизонту
// фарватер — одна дорожка: 16 мест ровно по высоте экрана, путь изгибается, к горизонту уже (перспектива)
const fOf = (i) => 0.08 + (0.8 * i) / (NSTEP - 1);
const laneC = (f) => 0.08 + 0.24 * Math.sin(f * 3.2 - 0.5), laneHW = (f) => 0.36 - 0.1 * f;
function laneAt(G, f, a) { const d = dOfF(f); return P(G, laneC(f) + a * 2 * laneHW(f), d); }   // a: −0.5 … 0.5 поперёк
const slotPt = (G, i, p) => laneAt(G, fOf(i), p / PSPAN - 0.5);
function slotAt(G, x, y) {                               // место и нота под пальцем; мимо фарватера — null
  const f = (G.qy - y) / (G.qy - G.hor), i = Math.round(((f - 0.08) / 0.8) * (NSTEP - 1));
  if (i < 0 || i >= NSTEP) return null;
  const q = unP(G, x, y), a = (q.u - laneC(f)) / (2 * laneHW(f));
  if (Math.abs(a) > 0.66) return null;
  return { i, p: clamp(Math.round((a + 0.5) * PSPAN), 0, PSPAN) };
}
const markPt = (G, i) => laneAt(G, fOf(i), -0.62);      // веха у левого края фарватера: её фонарь — шаг
// берега бухты: мысы выступают в воду — слева большой у нас под рукой и дальний, справа — мыс с маяком и дальний
const gs = (d, c, w) => Math.exp(-(((d - c) / w) ** 2));
const edge = (G, side, d) => side * (1 - (side < 0 ? 0.62 * gs(d, 0.2, 0.13) + 0.3 * gs(d, 0.58, 0.08) + 0.12 * gs(d, 0.86, 0.05) : 0.42 * gs(d, 0.05, 0.12) + 0.32 * gs(d, 0.72, 0.07)) - 0.022 * Math.sin(d * 17 + side) * (0.3 + d) - 0.012 * Math.sin(d * 43 + 2 * side) * d);
const cliffH = (side, d) => 8 + 46 * (1 - Math.abs(edge(null, side, d))) + 6 * Math.sin(d * 29 + side * 3);   // где мыс дальше в воду — там выше скала

// ---------- звук ----------
let actx = null, bus = null, lastSound = 0, last = null, noiseBuf = null;
const lastSteps = [];
function build(ctx, input) {
  actx = ctx;
  const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
  const bq = (type, f, q = 0.7) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
  const stabs = g(1), drive = ctx.createWaveShaper(), post = g(1), out = g(1.6);
  stabs.connect(drive).connect(post); post.connect(g(0.85)).connect(out);
  const dSend = g(0), dL = ctx.createDelay(4), dR = ctx.createDelay(4), fbL = g(0), fbR = g(0);   // эхо: пинг-понг, в петле — срез низа, темнота, лента
  const hpL = bq('highpass', 240), lpL = bq('lowpass', 3000), hpR = bq('highpass', 240), lpR = bq('lowpass', 3000), sat = ctx.createWaveShaper();
  const sc = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; sc[i] = Math.tanh(1.4 * x) / Math.tanh(1.4); } sat.curve = sc;
  post.connect(dSend); dSend.connect(dL);
  dL.connect(hpL).connect(lpL).connect(sat).connect(fbL).connect(dR);
  dR.connect(hpR).connect(lpR).connect(fbR).connect(dL);
  const dOut = ctx.createChannelMerger(2), dWet = g(0.9);
  dL.connect(dOut, 0, 0); dR.connect(dOut, 0, 1); dOut.connect(dWet).connect(out);
  const wow = ctx.createOscillator(), wowG = g(0); wow.frequency.value = 0.55; wow.connect(wowG); wowG.connect(dL.delayTime); wowG.connect(dR.delayTime); wow.start();
  const h = T.hall(), rSend = g(0); post.connect(rSend); dWet.connect(rSend); rSend.connect(h.input); h.out.connect(g(1)).connect(out);   // туман слышит и аккорды, и эхо
  if (!noiseBuf) { noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const nz = ctx.createBufferSource(); nz.buffer = noiseBuf; nz.loop = true; nz.start();     // море: шум в полосе, накатывает волнами
  const mareBp = bq('bandpass', 380, 0.5), mareLp = bq('lowpass', 1600), mareAm = g(0.55), mareG = g(0), swell = ctx.createOscillator(), swellG = g(0.45);
  swell.frequency.value = 0.09; swell.connect(swellG).connect(mareAm.gain); swell.start();
  nz.connect(mareBp).connect(mareLp).connect(mareAm).connect(mareG);
  bus = { stabs, drive, post, out, dSend, dL, dR, fbL, fbR, lpL, lpR, wowG, dWet, rSend, hall: h, mareG, input, live: false, mareOn: false };
  applyAll();
}
function setLive(on) {
  if (!bus || bus.live === on) return;
  bus.live = on;
  if (on) bus.out.connect(bus.input); else bus.out.disconnect();
}
setInterval(() => {
  if (!bus) return;
  if (sounding() || fx.mare > 0.01) lastSound = performance.now();
  else if (performance.now() - lastSound > 9000) setLive(false);
}, 1000);
function applyAll() {
  if (!bus) return;
  const t = actx.currentTime, S = (p, v, k = 0.05) => p.setTargetAtTime(v, t, k);
  const k = 1 + 5 * fx.drive, n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
  bus.drive.curve = c;
  S(bus.post.gain, 1 / (1 + fx.drive * 0.8));
  const dt = DT[echo.time] * stepSec();
  S(bus.dL.delayTime, dt, 0.08); S(bus.dR.delayTime, dt, 0.08);              // время меняется скольжением — как лента
  S(bus.fbL.gain, fbOf()); S(bus.fbR.gain, fbOf());
  S(bus.lpL.frequency, 700 * 2 ** (3.2 * (1 - echo.tone))); S(bus.lpR.frequency, 600 * 2 ** (3.2 * (1 - echo.tone)));
  S(bus.dSend.gain, echo.mix * 0.75);
  S(bus.wowG.gain, 0.0035 * fx.wow * fx.wow + 0.0002);
  S(bus.rSend.gain, fog.amt * fog.amt * 1.6);
  for (const l of bus.hall.lines) S(l.g.gain, 10 ** ((-3 * l.len) / (1.2 + fog.size * 8)));
  S(bus.mareG.gain, fx.mare * fx.mare * 0.09);
  const mo = fx.mare > 0.01;
  if (mo !== bus.mareOn) { bus.mareOn = mo; if (mo) { bus.mareG.connect(bus.out); setLive(true); } else bus.mareG.disconnect(); }
}
// удар аккорда: пары пил на каждую ноту → фильтр (24 дБ, с огибающей) → громкость; до следующего удара — потом гаснет быстро
function stab(t, is, vel = 1, gap = 0.5) {
  if (!is || !bus) return;
  const ctx = actx, ch = CHORDS[typeOf(is)], f0 = hzOf(is), tau = 0.035 + pharos.len ** 2 * 1.8, A = 0.004;
  const fc = fcOf(), peak = Math.min(16000, fc * 2 ** (luna.env * 4.2 * vel)), Q = 0.7 + 13 * luna.res ** 2;
  const lp1 = ctx.createBiquadFilter(), lp2 = ctx.createBiquadFilter(), vca = ctx.createGain(), pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
  lp1.type = lp2.type = 'lowpass'; lp1.Q.value = Q; lp2.Q.value = 0.6;
  for (const f of [lp1.frequency, lp2.frequency]) { f.setValueAtTime(peak, t); f.setTargetAtTime(fc, t + A, 0.04 + tau * 0.3); }
  const amp = (0.16 * pharos.lvl * (is.lvl ?? 1) * (0.75 + 0.25 * vel)) / Math.sqrt(ch.iv.length);
  const end = t + A + Math.min(tau * 5, gap + 0.06);                                       // не дольше, чем до следующего удара: голоса не копятся
  vca.gain.setValueAtTime(0, t); vca.gain.linearRampToValueAtTime(amp, t + A); vca.gain.setTargetAtTime(0, t + A, tau);
  if (end < t + A + tau * 5) vca.gain.setTargetAtTime(0, end - 0.05, 0.012);
  if (pan.pan) pan.pan.value = (is.p / PSPAN - 0.5) * 0.5 * fx.spread;
  const osc = [];
  ch.iv.forEach((iv, k) => {
    for (const dc of [-1, 1]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f0 * 2 ** (iv / 12); o.detune.value = dc * (5 + 3 * (k % 2));
      o.connect(lp1); o.start(t); o.stop(end + 0.03); osc.push(o);
    }
  });
  lp1.connect(lp2).connect(vca).connect(pan).connect(bus.stabs);
  osc[0].onended = () => { for (const n of [...osc, lp1, lp2, vca, pan]) n.disconnect(); };
  const wait = Math.max(0, (t - ctx.currentTime) * 1000);
  setTimeout(() => { is.hit = performance.now(); lastHit = is; hits.push({ t: performance.now(), dt: DT[echo.time] * stepSec() * 1000, fb: fbOf() }); if (hits.length > 6) hits.shift(); }, wait);
  lastSound = performance.now(); setLive(true);
}
const hits = [];                                          // удары для кругов эха на воде
let lastHit = null;
function nextGap(step) { for (let k = 1; k <= NSTEP; k++) if (isleOn((step + k) % NSTEP)) return k * stepSec(); return NSTEP * stepSec(); }
let killAt = -1e9, killXY = null;
function killEcho(x, y) {                               // падающая звезда: эхо гаснет за долю секунды, потом снова слушает
  killAt = performance.now(); killXY = { x, y }; hits.length = 0;
  if (!bus) return;
  const t = actx.currentTime;
  for (const g of [bus.fbL.gain, bus.fbR.gain, bus.dWet.gain, bus.dSend.gain]) { g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.setTargetAtTime(0, t, 0.02); }
  setTimeout(() => { if (!bus) return; bus.dWet.gain.setTargetAtTime(0.9, actx.currentTime, 0.05); applyAll(); }, 350);
}
function schedule() {
  if (!seq.playing || !actx) return;
  const now = actx.currentTime, ahead = now + 0.2;
  if (!seq.next) seq.next = now + 0.05;
  while (seq.next < ahead) {
    const j = seq.step % NSTEP, sw = j % 2 ? pharos.swing * stepSec() * 0.5 : 0, is = isleOn(j);
    if (seq.next + sw > now + 0.003 && is && Math.random() < fx.chance) stab(seq.next + sw, is, j % 4 === 2 ? 1 : 0.85, nextGap(j));
    lastSteps.push([seq.next, seq.step]); if (lastSteps.length > 24) lastSteps.shift();
    seq.step++; seq.next += stepSec();
  }
}
setInterval(schedule, 25);
function play(on = !seq.playing) { seq.playing = on; seq.next = 0; if (on) { seq.step = 0; setLive(true); schedule(); } }
function curStep() {
  if (!actx || !lastSteps.length || !seq.playing) return -1;
  const t = actx.currentTime; let cur = -1;
  for (const [tt, s] of lastSteps) if (tt <= t) cur = s;
  return cur;
}
const sounding = () => seq.playing && isles.length > 0;
let audAt = 0;
function audition(is) {                                 // часы стоят — услышать аккорд, пока ставишь
  if (seq.playing || !actx || performance.now() - audAt < 140) return;
  audAt = performance.now(); stab(actx.currentTime + 0.02, is, 1, 0.6);
}

// ---------- касания ----------
const touches = new Map();
const isleXY = (G, is) => slotPt(G, is.step, is.p);
function isleAt(G, x, y) { let best = null, bd = 1e9; for (const is of isles) { const p = isleXY(G, is), r = 12 + 26 * p.s, d = Math.hypot(x - p.x, (y - p.y + 8 * p.s) * 1.4); if (d < r && d < bd) { bd = d; best = is; } } return best; }
function markAt(G, x, y) { for (let i = 0; i < NSTEP; i++) { const m = markPt(G, i), h = 10 + 14 * m.s; if (Math.abs(x - m.x) < 8 + 6 * m.s && y < m.y + 4 && y > m.y - h - 8) return i; } return -1; }
const inSea = (G, x, y) => { if (y < G.hor + 3 || y > G.qy - 6) return false; const q = unP(G, x, y); return q.u > edge(G, -1, q.d) && q.u < edge(G, 1, q.d); };
let lastP = 0;
function place(i, p) {                                  // остров на луч i, глубина p: на луче уже есть — переезжает
  let is = isleOn(i);
  if (is) { is.p = p; return is; }
  is = { step: i, p, oct: 0, lvl: 1, sd: Math.random() * 1000, hit: 0 };
  isles.push(is); return is;
}
function down(f) {
  const G = geo(), now = performance.now(), M = G.moon, B = P(G, buoy.u, buoy.d);
  const base = { x0: f.x, y0: f.y, t0: now, moved: false };
  if (Math.abs(f.x - G.ph.x) < 22 && f.y > G.ph.y - 100 && f.y < G.ph.y + 24) { touches.set(f.id, { kind: 'ph', bpm0: seq.bpm, ...base }); return; }
  if (f.x >= M.x - 4 && Math.hypot(f.x - M.x, f.y - M.y) < M.r + 14) { touches.set(f.id, { kind: 'moon', c0: luna.cut, r0: luna.res, ...base }); return; }   // луна: тап — карта, тянешь — фильтр, держишь — плашка
  const li = markAt(G, f.x, f.y);
  if (li >= 0) { const is = isleOn(li); if (is) isles.splice(isles.indexOf(is), 1); else audition(place(li, lastP)); touches.set(f.id, { kind: 'none' }); return; }
  if (Math.hypot(f.x - B.x, f.y - B.y + 8) < 22) { touches.set(f.id, { kind: 'buoy', ...base }); return; }
  const is = isleAt(G, f.x, f.y);
  if (is) { touches.set(f.id, { kind: 'isle', is, ...base }); return; }
  if (Math.abs(f.y - G.fogTop) < 16 && f.y < G.hor + 10) { touches.set(f.id, { kind: 'fog', a0: fog.amt, ...base }); return; }
  if (f.y < G.fogTop - 16 && f.y > G.top) { killEcho(f.x, f.y); touches.set(f.id, { kind: 'none' }); return; }   // небо: падает звезда — эхо гаснет
  const sl = inSea(G, f.x, f.y) ? slotAt(G, f.x, f.y) : null;
  if (sl) {
    const n = place(sl.i, sl.p); lastP = n.p; audition(n);
    touches.set(f.id, { kind: 'isle', is: n, fresh: true, ...base });
    return;
  }
  touches.set(f.id, { kind: 'none' });
}
function move(f) {
  const t = touches.get(f.id);
  if (!t || t.kind === 'none' || t.sheet) return;
  if (Math.hypot(f.x - t.x0, f.y - t.y0) > 8) t.moved = true;
  if (!t.moved) return;
  const G = geo();
  if (t.kind === 'ph') { const b = Math.round(clamp(t.bpm0 + (f.x - t.x0) / 2, 60, 180)); if (b !== seq.bpm) { seq.bpm = b; applyAll(); T.tempoFrom(13, b); } return; }
  if (t.kind === 'moon') { luna.cut = clamp(t.c0 + (t.y0 - f.y) / (G.hor - G.top - G.moon.r * 0.9)); luna.res = clamp(t.r0 + (f.x - t.x0) / (G.Ws * 0.5)); return; }
  if (t.kind === 'fog') { fog.amt = clamp(t.a0 + (t.y0 - f.y) / ((G.hor - G.top - 40) * 0.7)); applyAll(); return; }
  if (t.kind === 'buoy') {
    const q = unP(G, f.x, clamp(f.y, G.hor + 6, G.qy - 10)); buoy.d = clamp(q.d, 0.03, 0.95);
    const a = edge(G, -1, buoy.d), b = edge(G, 1, buoy.d); buoy.u = clamp(q.u, a + 0.03, b - 0.03); echo.time = clamp(Math.round(((buoy.u - a) / (b - a)) * 4), 0, 4); applyAll(); return;
  }
  if (t.kind === 'isle') {                               // тянешь кораблик: вдоль фарватера — другое место (если свободно), поперёк — нота
    const sl = slotAt(G, f.x, clamp(f.y, G.hor + 4, G.qy - 6)), is = t.is;
    if (!sl) return;
    if (sl.i !== is.step && !isleOn(sl.i)) is.step = sl.i;
    if (sl.p !== is.p) { is.p = sl.p; lastP = sl.p; audition(is); }
  }
}
function up(f) {
  const t = touches.get(f.id);
  touches.delete(f.id);
  if (!t || t.sheet) return;
  const quick = !t.moved && performance.now() - t.t0 < 300;
  if (t.kind === 'ph' && quick) { play(); T.tempoFrom(13, seq.bpm); }
  if (t.kind === 'moon' && quick) window.t2d.goMap();
  if (t.kind === 'isle' && quick && !t.fresh && isles.includes(t.is)) isles.splice(isles.indexOf(t.is), 1);   // тап по острову — уходит под воду
}
// ---------- плашки ----------
function sheets(kind, is) {
  if (kind === 'moon') T.openSheet({
    title: 'luna', hint: 'the moon is the filter — tap outside to close',
    rows: [{ key: 'cut', label: 'cutoff' }, { key: 'res', label: 'resonance' }, { key: 'env', label: 'envelope' }],
    lfo: { id: 'portus-luna', keys: ['cut', 'res', 'env'], shapes: 'classic' },          // «~» на cutoff — та самая медленная волна фильтра
    get: (k) => luna[k], set: (k, v) => { luna[k] = v; }, text: (k) => (k === 'cut' ? `${Math.round(fcOf())} Hz` : `${Math.round(luna[k] * 100)}%`),
  });
  else if (kind === 'buoy') T.openSheet({
    title: 'echo', hint: 'the bell buoy is the delay — tap outside to close',
    rows: [{ key: 'time', label: 'time' }, { key: 'fb', label: 'feedback' }, { key: 'tone', label: 'dark' }, { key: 'mix', label: 'send' }],
    lfo: { id: 'portus-echo', keys: ['fb', 'tone', 'mix'], shapes: 'random' },
    get: (k) => (k === 'time' ? echo.time / 4 : k === 'fb' ? (buoy.d - 0.03) / 0.92 : echo[k]),
    set: (k, v) => { const G = geo(); if (k === 'time') echo.time = Math.round(v * 4); else if (k === 'fb') buoy.d = 0.03 + v * 0.92; else echo[k] = v; const a = edge(G, -1, buoy.d), b = edge(G, 1, buoy.d); buoy.u = a + 0.03 + (echo.time / 4) * (b - a - 0.06); applyAll(); },
    text: (k) => (k === 'time' ? DT_NAME[echo.time] : k === 'fb' ? (fbOf() > 0.95 ? 'endless' : `${Math.round(fbOf() * 100)}%`) : `${Math.round(echo[k] * 100)}%`),
  });
  else if (kind === 'fog') T.openSheet({
    title: 'nebula', hint: 'the fog is the reverb — tap outside to close',
    rows: [{ key: 'amt', label: 'amount' }, { key: 'size', label: 'size' }],
    lfo: { id: 'portus-fog', keys: ['amt', 'size'], shapes: 'random' },
    get: (k) => fog[k], set: (k, v) => { fog[k] = v; applyAll(); }, text: (k) => (k === 'size' ? `${(1.2 + fog.size * 8).toFixed(1)} s` : `${Math.round(fog.amt * 100)}%`),
  });
  else if (kind === 'ph') T.openSheet({
    title: 'pharos', hint: 'the lighthouse — tap outside to close',
    rows: [{ key: 'chord', label: 'chord' }, { key: 'oct', label: 'octave' }, { key: 'len', label: 'length' }, { key: 'swing', label: 'swing' }, { key: 'lvl', label: 'level' }],
    get: (k) => (k === 'chord' ? pharos.chord / 4 : k === 'oct' ? (pharos.oct + 2) / 4 : pharos[k]),
    set: (k, v) => { if (k === 'chord') pharos.chord = Math.round(v * 4); else if (k === 'oct') pharos.oct = Math.round(v * 4) - 2; else pharos[k] = v; },
    text: (k) => (k === 'chord' ? CHORDS[pharos.chord].name : k === 'oct' ? `octave ${pharos.oct > 0 ? '+' : pharos.oct < 0 ? '−' : ''}${Math.abs(pharos.oct)}` : k === 'len' ? (pharos.len > 0.9 ? 'endless' : `${Math.round((0.035 + pharos.len ** 2 * 1.8) * 1000)} ms`) : `${Math.round(pharos[k] * 100)}%`),
  });
  else if (kind === 'isle') T.openSheet({
    title: 'navicula', hint: 'paper boat · its note — tap outside to close',
    rows: [{ key: 'oct', label: 'octave' }, { key: 'lvl', label: 'level' }],
    get: (k) => (k === 'oct' ? (is.oct + 2) / 4 : is.lvl),
    set: (k, v) => { if (!isles.includes(is)) return; if (k === 'oct') is.oct = Math.round(v * 4) - 2; else is.lvl = v; },
    text: (k) => (k === 'oct' ? (is.oct ? `${is.oct > 0 ? '+' : '−'}${Math.abs(is.oct)} · ${nameOf(is)}` : `as lighthouse · ${nameOf(is)}`) : `${Math.round(is.lvl * 100)}%`),
  });
}
let rnd0 = 0;
function tick(now) {
  for (const t of touches.values()) if (['moon', 'buoy', 'fog', 'ph', 'isle'].includes(t.kind) && !t.moved && !t.sheet && !t.fresh && now - t.t0 > T.HOLD_MS) { t.sheet = true; sheets(t.kind, t.is); }
  if (now - rnd0 > 120) { rnd0 = now; if (bus) applyEchoTime(); }
}
let lastDt = 0;
function applyEchoTime() { const dt = DT[echo.time] * stepSec(); if (Math.abs(dt - lastDt) > 1e-4) { lastDt = dt; applyAll(); } }

// ---------- рисование ----------
const ink = (a) => `rgba(${INK},${a})`;
let wallC = null, wallKey = '';
function wall(G) {                                      // неподвижное: звёзды, дальние мысы, вода волнами, скалы со штриховкой, набережная
  const pcs = T.scalePCs, key = `${G.W}x${G.H}x${T.DPR}|${G.hor}|${G.qy}|${G.Ws}|${pcs ? pcs.join(',') : '-'}|${root()}`;
  if (wallC && key === wallKey) return wallC;
  wallKey = key;
  wallC = document.createElement('canvas');
  wallC.width = Math.round(G.W * T.DPR); wallC.height = Math.round(G.H * T.DPR);
  const x = wallC.getContext('2d');
  x.setTransform(T.DPR, 0, 0, T.DPR, 0, 0);
  x.fillStyle = BGC; x.fillRect(0, 0, G.W, G.H);
  let sd = 13; const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 110; k++) { const sx = G.fx0 + rnd() * G.Ws, sy = G.top + rnd() ** 1.3 * (G.hor - G.top - 6); x.fillStyle = ink(0.15 + 0.5 * rnd() ** 2); x.fillRect(sx, sy, rnd() < 0.12 ? 1.6 : 1, rnd() < 0.12 ? 1.6 : 1); }   // звёзды
  const N = 120, shore = (side, d) => P(G, edge(G, side, d), d);
  const inWater = (u, d) => u > edge(G, -1, d) + 0.01 && u < edge(G, 1, d) - 0.01;
  x.strokeStyle = ink(0.14); x.lineWidth = 0.7; x.beginPath();                           // вода: короткие гравированные волны, к нам крупнее и реже
  for (let k = 0; k < 700; k++) {
    const d = 1 - rnd() ** 1.5, u = rnd() * 2 - 1;
    if (!inWater(u, d)) continue;
    const p = P(G, u, d), l = 2 + 10 * p.s;
    x.moveTo(p.x - l, p.y + 1); x.quadraticCurveTo(p.x, p.y - 1.4 * p.s, p.x + l, p.y + 1);
  }
  x.stroke();
  x.lineWidth = 0.8;                                                                       // фарватер: края пунктиром, квинта — бледнее
  for (const [a, al, dash] of [[-0.5, 0.3, [3, 4]], [0.5, 0.3, [3, 4]], [-0.5 + 7 / 12, 0.1, [1, 5]]]) {
    x.strokeStyle = ink(al); x.setLineDash(dash); x.beginPath();
    for (let k = 0; k <= 60; k++) { const f = 0.04 + (0.88 * k) / 60, pt = laneAt(G, f, a); k ? x.lineTo(pt.x, pt.y) : x.moveTo(pt.x, pt.y); }
    x.stroke();
  }
  x.setLineDash([]);
  for (let i = 0; i < NSTEP; i++) { const a = laneAt(G, fOf(i), -0.5), b = laneAt(G, fOf(i), 0.5); x.strokeStyle = ink(i % 4 ? 0.1 : 0.22); x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke(); }   // поперёк — места, такт ярче
  x.lineWidth = 0.8;
  for (let k = 0; k <= PSPAN; k++) {                                                       // полутоны — засечки у ближнего края, ступени лада длиннее
    const pc = (((root() + k) % 12) + 12) % 12, on = !pcs || pcs.includes(pc), pt = laneAt(G, 0.04, k / PSPAN - 0.5);
    x.strokeStyle = ink(on ? 0.5 : 0.2); x.beginPath(); x.moveTo(pt.x, pt.y); x.lineTo(pt.x, pt.y + (on ? 7 : 3)); x.stroke();
  }
  for (const side of [-1, 1]) {                                                           // мысы: скала над водой — штрихи, сверху трава и кипарисы
    const outer = side < 0 ? G.fx0 - 2 : G.fx1 + 2, top = (d) => { const p = shore(side, d); return { x: p.x, y: p.y - cliffH(side, d) * p.s, s: p.s, w: p.y }; };
    x.fillStyle = BGC; x.beginPath(); x.moveTo(outer, G.qy + 2);
    for (let i = 0; i <= N; i++) { const t = top(i / N); x.lineTo(t.x, t.y); }
    x.lineTo(outer, G.hor - 1); x.closePath(); x.fill();
    x.save(); x.clip();                                                                   // земля мыса: косая штриховка, к горизонту гуще
    x.strokeStyle = ink(0.07); x.lineWidth = 0.6; x.beginPath();
    for (let X = G.fx0 - G.H; X < G.fx1 + G.H; X += 5) { x.moveTo(X, G.hor); x.lineTo(X + side * (G.qy - G.hor) * 0.5, G.qy); }
    x.stroke(); x.restore();
    x.strokeStyle = ink(0.3); x.lineWidth = 0.6; x.beginPath();                           // скальная стена: вертикальные штрихи от кромки вверх
    for (let i = 0; i < 260; i++) { const d = rnd() ** 1.25, p = shore(side, d), t = top(d), dx = -side * rnd() * 2; if (t.w - t.y < 3) continue; x.moveTo(p.x + dx, t.y + 1.5); x.lineTo(p.x + dx + side * 0.6, p.y - 0.5 - rnd() * (t.w - t.y) * 0.3); }
    x.stroke();
    x.strokeStyle = ink(0.85); x.lineWidth = 1; x.beginPath(); for (let i = 0; i <= N; i++) { const t = top(i / N); i ? x.lineTo(t.x, t.y) : x.moveTo(t.x, t.y); } x.stroke();   // кромка скалы
    x.strokeStyle = ink(0.6); x.beginPath(); for (let i = 0; i <= N; i++) { const p = shore(side, i / N); i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y); } x.stroke();   // урез воды
    x.strokeStyle = ink(0.18); x.beginPath(); for (let i = 0; i < 70; i++) { const d = rnd(), p = shore(side, d), l = 3 + 6 * p.s; x.moveTo(p.x - side * (3 + rnd() * 8) * p.s, p.y + 2 + rnd() * 4 * p.s); x.lineTo(p.x - side * (3 + rnd() * 8) * p.s - side * l, p.y + 2 + rnd() * 4 * p.s); } x.stroke();   // прибой у скал
    for (let i = 0; i < 14; i++) {                                                       // кипарисы на мысах — тёмные свечи
      const d = 0.04 + rnd() * 0.9, t = top(d), xx = t.x + side * (6 + rnd() * 40) * t.s, h = (14 + rnd() * 16) * t.s, w = h * 0.2;
      if (side < 0 ? xx < G.fx0 + 6 : xx > G.fx1 - 6) continue;
      x.fillStyle = BGC; x.strokeStyle = ink(0.7); x.lineWidth = 0.8; x.beginPath(); x.moveTo(xx, t.y + 2 - h); x.quadraticCurveTo(xx + w, t.y + 2 - h * 0.5, xx + w * 0.5, t.y + 2); x.lineTo(xx - w * 0.5, t.y + 2); x.quadraticCurveTo(xx - w, t.y + 2 - h * 0.5, xx, t.y + 2 - h); x.fill(); x.stroke();
      x.strokeStyle = ink(0.35); x.beginPath(); x.moveTo(xx + w * 0.3, t.y - h * 0.7); x.lineTo(xx + w * 0.15, t.y); x.stroke();
    }
  }
  x.strokeStyle = ink(0.75); x.lineWidth = 1; x.beginPath(); { const a = shore(-1, 1), b = shore(1, 1); x.moveTo(a.x, G.hor + 0.5); x.lineTo(b.x, G.hor + 0.5); } x.stroke();   // горизонт в устье бухты
  const qy = G.qy;                                                                         // набережная: камень кладкой
  x.fillStyle = BGC; x.fillRect(G.fx0, qy, G.Ws, G.bot - qy + 8);
  x.strokeStyle = ink(0.8); x.lineWidth = 1.2; x.beginPath(); x.moveTo(G.fx0, qy + 0.5); x.lineTo(G.fx1, qy + 0.5); x.stroke();
  x.strokeStyle = ink(0.15); x.lineWidth = 0.7; x.beginPath();
  for (let r = 0; r < 4; r++) { const y = qy + 8 + r * 12; x.moveTo(G.fx0, y); x.lineTo(G.fx1, y); for (let X = G.fx0 + (r % 2) * 14; X < G.fx1; X += 28) { x.moveTo(X, y - 12 + (r ? 0 : 4)); x.lineTo(X, y); } }
  x.stroke();
  return wallC;
}
function drawMoon(c, G, now) {                           // луна в углу, как солнце Natura: выше — фильтр открыт, садится — закрыт; ореол — резонанс
  const M = G.moon, a = 0.25 + 0.75 * luna.cut, R = M.r;
  const w0 = 3 + 22 * luna.res, rows = 36, x0 = Math.max(M.x + R * 0.8, P(G, edge(G, -1, 1), 1).x + 12);   // лунная дорожка: от горизонта под луной к нам
  c.lineWidth = 1;
  for (let k = 0; k < rows; k++) {
    const d = 1 - (k / rows) ** 1.3, p = P(G, 0, d), f = 1 - d, xm = x0 + (G.cx - G.Wh * 0.15 - x0) * f ** 0.8;
    if (p.y > G.qy - 4) break;
    const wob = Math.sin(now * 0.002 + k * 1.7) * 3 * p.s, w = (w0 + 12 * f) * p.s * (0.45 + 0.55 * Math.sin(k * 2.3 + now * 0.0015) ** 2);
    c.strokeStyle = rgba(LIGHT, (0.06 + 0.42 * luna.cut) * (0.4 + 0.6 * f)); c.beginPath(); c.moveTo(xm - w + wob, p.y); c.lineTo(xm + w + wob, p.y); c.stroke();
  }
  if (noSun) return;                                                                        // на карте луна не двоит солнце
  c.save(); c.beginPath(); c.rect(M.x, G.top - 40, G.Ws, G.hor - G.top + 40); c.clip();
  T.glowAt(M.x, M.y, R * 2.6, 0.08 + 0.22 * luna.cut);
  if (luna.res > 0.04) for (let k = 1; k <= 3; k++) { c.setLineDash([1.5, 3.5]); c.strokeStyle = rgba(LIGHT, (0.15 + 0.45 * luna.res) / k); c.lineWidth = 1; c.beginPath(); c.arc(M.x, M.y, R + 5 + k * (3 + 7 * luna.res), 0, TAU); c.stroke(); } c.setLineDash([]);
  const bl = M.lfo < 0 ? 0 : M.lfo, mc = [LIGHT[0] - 70 * bl, LIGHT[1] - 165 * bl, LIGHT[2] - 105 * bl].map(Math.round);   // бледная … blood moon
  c.fillStyle = rgba(mc, 0.2 + 0.7 * (M.lfo < 0 ? a : 0.75)); c.beginPath(); c.arc(M.x, M.y, R, 0, TAU); c.fill();
  c.strokeStyle = rgba(LIGHT, 0.95); c.lineWidth = 1.4; c.stroke();
  c.strokeStyle = rgba(LIGHT, 0.5); c.lineWidth = 0.8; c.beginPath(); c.arc(M.x, M.y, R + 4, -Math.PI / 2, Math.PI / 2); c.stroke();
  c.strokeStyle = `rgba(${PAPER},0.45)`; c.lineWidth = 0.8;                                  // моря и кратеры
  for (const [dx, dy, rr] of [[0.25, -0.5, 0.16], [0.55, 0.42, 0.11], [0.18, 0.6, 0.08], [0.7, -0.15, 0.07]]) { c.beginPath(); c.arc(M.x + dx * R, M.y + dy * R, rr * R, 0, TAU); c.stroke(); }
  const fx = M.x + R * 0.5, fy = M.y, k = R / 46;                                          // спящее лицо в видимой половине
  c.strokeStyle = `rgba(${PAPER},0.85)`; c.lineWidth = 1.1; c.beginPath();
  c.moveTo(fx - 7 * k, fy - 6 * k); c.quadraticCurveTo(fx - 2 * k, fy - 2 * k, fx + 3 * k, fy - 6 * k);
  c.moveTo(fx - 2 * k, fy - 2 * k); c.lineTo(fx + 1 * k, fy + 6 * k); c.lineTo(fx - 3 * k, fy + 7 * k);
  c.moveTo(fx - 6 * k, fy + 13 * k); c.quadraticCurveTo(fx - 1 * k, fy + 15 * k, fx + 4 * k, fy + 12 * k);
  c.stroke();
  c.restore();
}
function drawIsle(c, G, is, now, cur) {                  // бумажный кораблик: корпус-трапеция, посередине парус-треугольник, сгибы; качается; звучащий — золотом
  const p = isleXY(G, is), s = p.s, w = 20 * s + 4, hit = clamp(1 - (now - (is.hit || 0)) / 500), lit = cur && seq.playing;
  const rock = Math.sin(now * 0.0017 + is.sd) * 0.07 + hit * 0.12 * Math.sin(now * 0.03), bob = Math.sin(now * 0.0021 + is.sd * 1.3) * 1.2 * s;
  if (lit) T.glowAt(p.x, p.y - w * 0.5, w * 1.6, 0.12 + 0.35 * hit);
  c.strokeStyle = lit ? rgba(LIGHT, 0.3 + 0.3 * hit) : ink(0.22); c.lineWidth = 0.7; c.beginPath();   // отражение: штрихи под корабликом
  for (let k = 0; k < 3; k++) { const yy = p.y + 3 + k * 2.6 * s, ww = w * (0.8 - k * 0.2), ox = Math.sin(now * 0.002 + k + is.sd) * 1.5 * s; c.moveTo(p.x - ww + ox, yy); c.lineTo(p.x + ww + ox, yy); }
  c.stroke();
  c.save(); c.translate(p.x, p.y - 1 + bob); c.rotate(rock); c.scale(w, w);
  const line = lit ? rgba(LIGHT, 0.7 + 0.3 * hit) : ink(0.9);
  c.fillStyle = lit ? `rgba(${LIGHT[0]},${LIGHT[1]},${LIGHT[2]},${0.18 + 0.2 * hit})` : `rgba(${INK},0.13)`;
  c.beginPath(); c.moveTo(-1, -0.32); c.lineTo(-0.48, -0.32); c.lineTo(0, -1.2); c.lineTo(0.48, -0.32); c.lineTo(1, -0.32); c.lineTo(0.72, 0.16); c.lineTo(-0.72, 0.16); c.closePath();
  c.fill(); c.strokeStyle = line; c.lineWidth = 1 / w; c.stroke();
  c.lineWidth = 0.7 / w; c.strokeStyle = lit ? rgba(LIGHT, 0.5) : ink(0.45); c.beginPath();   // сгибы бумаги
  c.moveTo(0, -1.2); c.lineTo(0, -0.32); c.moveTo(-0.48, -0.32); c.lineTo(-0.2, 0.16); c.moveTo(0.48, -0.32); c.lineTo(0.2, 0.16); c.moveTo(-1, -0.32); c.lineTo(1, -0.32);
  c.stroke();
  c.strokeStyle = lit ? rgba(LIGHT, 0.35) : ink(0.28); c.beginPath();                        // тень на правой половине паруса
  for (let k = 1; k <= 4; k++) { const f = k / 5; c.moveTo(0.05, -1.2 + 0.88 * f); c.lineTo(0.48 * f + 0.02, -0.34); }
  c.stroke();
  c.restore();
}
function drawBuoy(c, G, now) {                           // колокол-буй: качается; от него круги — повторы эха
  const B = P(G, buoy.u, buoy.d), s = 0.6 + 0.6 * B.s, rock = Math.sin(now * 0.0021) * (0.12 + 0.25 * fx.wow);
  c.lineWidth = 1;
  for (const h of hits) {                                // повторы: каждый — круг, слабее с каждым разом
    const age = now - h.t;
    for (let k = 1; k <= 14; k++) {
      const t0 = k * h.dt, a = h.fb ** k;
      if (a < 0.04 || age < t0) break;
      const e = (age - t0) / 1400;
      if (e > 1) continue;
      c.strokeStyle = ink(0.5 * a * (1 - e)); c.beginPath(); c.ellipse(B.x, B.y, (6 + 70 * e) * B.s * 1.4, (2 + 22 * e) * B.s * 1.4, 0, 0, TAU); c.stroke();
    }
  }
  c.save(); c.translate(B.x, B.y); c.rotate(rock); c.scale(s, s);
  c.fillStyle = BGC; c.strokeStyle = ink(0.9);
  c.beginPath(); c.moveTo(-9, 0); c.lineTo(9, 0); c.lineTo(6, -6); c.lineTo(-6, -6); c.closePath(); c.fill(); c.stroke();   // поплавок
  c.beginPath(); c.moveTo(-5, -6); c.lineTo(-3, -20); c.lineTo(3, -20); c.lineTo(5, -6); c.stroke();                       // клетка
  c.beginPath(); c.moveTo(-3, -20); c.lineTo(0, -24); c.lineTo(3, -20); c.stroke();
  c.beginPath(); c.moveTo(-3, -9); c.quadraticCurveTo(-3, -16, 0, -16); c.quadraticCurveTo(3, -16, 3, -9); c.closePath(); c.stroke();   // колокол
  c.restore();
}
function drawFog(c, G, now) {                            // туман: пелена над горизонтом из рваных горизонтальных штрихов; гуще — больше зала, прячет дальнее
  const top = G.fogTop, bot = G.hor + 18 + 40 * fog.amt, dr = now * 0.000012;
  for (let k = 0; k < 3; k++) {                                                            // пелена: три слоя, каждый чуть прячет то, что за ним
    const y0 = top + ((bot - top) * k) / 4;
    c.fillStyle = `rgba(${PAPER},${0.2 + 0.12 * fog.amt})`; c.beginPath(); c.moveTo(G.fx0, bot);
    for (let X = G.fx0; X <= G.fx1 + 10; X += 10) c.lineTo(X, y0 - 5 * Math.sin(X * 0.025 + k * 2.1 + dr * 60 * (k + 1)));
    c.lineTo(G.fx1, bot); c.closePath(); c.fill();
  }
  c.lineWidth = 0.8;
  const rows = Math.round(10 + 22 * fog.amt);
  for (let j = 0; j < rows; j++) {                                                        // штрихи тумана плывут вбок, к краям пелены бледнее
    const f = j / (rows - 1), y = top + 4 + (bot - top - 8) * f, a = (0.05 + 0.16 * Math.sin(Math.PI * f)) * (0.6 + 0.6 * fog.amt);
    c.strokeStyle = ink(a); c.beginPath();
    let sd = j * 97 + 5; const r = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
    const sh = ((now * 0.004 * (0.5 + r())) % G.Ws);
    for (let i = 0; i < 7; i++) { const L = 14 + r() * 50, X = G.fx0 + ((r() * G.Ws + sh * (j % 2 ? 1 : -1)) % G.Ws + G.Ws) % G.Ws; c.moveTo(X, y); c.lineTo(Math.min(G.fx1, X + L), y + (r() - 0.5)); }
    c.stroke();
  }
  c.strokeStyle = ink(0.16 + 0.12 * fog.amt); c.setLineDash([3, 5]); c.beginPath();       // верх тумана — за него тянут
  for (let X = G.fx0; X <= G.fx1; X += 6) { const y = top - 4 * Math.sin(X * 0.025 + dr * 60); X === G.fx0 ? c.moveTo(X, y) : c.lineTo(X, y); }
  c.stroke(); c.setLineDash([]);
}
function drawPharos(c, G, now, cs) {                     // маяк: башня со штриховкой, фонарь; в такт — вспышка, луч к нынешнему острову
  const { x, y } = G.ph, hgt = 74, cur = lastHit && now - lastHit.hit < 600 ? lastHit : null, hit = cur ? clamp(1 - (now - (cur.hit || 0)) / 260) : 0;
  if (seq.playing && cur && isles.includes(cur)) {
    const p = isleXY(G, cur);
    c.fillStyle = rgba(LIGHT, 0.05 + 0.12 * hit); c.beginPath(); c.moveTo(x, y - hgt - 6); c.lineTo(p.x - 26 * p.s, p.y - 8 * p.s); c.lineTo(p.x + 26 * p.s, p.y - 2); c.closePath(); c.fill();
  }
  c.fillStyle = BGC; c.strokeStyle = ink(0.9); c.lineWidth = 1;
  c.beginPath(); c.moveTo(x - 13, y); c.lineTo(x - 8, y - hgt); c.lineTo(x + 8, y - hgt); c.lineTo(x + 13, y); c.closePath(); c.fill(); c.stroke();
  c.strokeStyle = ink(0.4); c.beginPath(); for (let k = 1; k < 5; k++) { const yy = y - (hgt * k) / 5, ww = 13 - (5 * k) / 5; c.moveTo(x - ww, yy); c.lineTo(x + ww, yy); } for (let k = 0; k < 6; k++) { c.moveTo(x + 3 + k * 1.6, y - 2); c.lineTo(x + 3 + k * 1.1, y - hgt + 2); } c.stroke();
  c.strokeStyle = ink(0.9); c.beginPath(); c.moveTo(x - 11, y - hgt); c.lineTo(x + 11, y - hgt); c.stroke();
  if (seq.playing) T.glowAt(x, y - hgt - 9, 26 + 16 * hit, 0.25 + 0.5 * hit);
  c.fillStyle = seq.playing ? rgba(LIGHT, 0.5 + 0.5 * hit) : BGC; c.strokeStyle = ink(0.9);
  c.beginPath(); c.rect(x - 6, y - hgt - 15, 12, 13); c.fill(); c.stroke();
  c.beginPath(); c.moveTo(x - 8, y - hgt - 15); c.lineTo(x, y - hgt - 23); c.lineTo(x + 8, y - hgt - 15); c.closePath(); c.fillStyle = BGC; c.fill(); c.stroke();
  if (!seq.playing) { c.fillStyle = ink(0.85); c.beginPath(); c.moveTo(x - 3, y - 40); c.lineTo(x + 5, y - 35); c.lineTo(x - 3, y - 30); c.closePath(); c.fill(); }   // стоит — знак пуска
}
function drawQuay(c, G, now, cs) {                       // вехи фарватера: на каждом месте — шест с фонарём; горит — кораблик; бегущий огонёк — шаг
  if (cs >= 0 && seq.playing) {                                                            // свет шага поперёк фарватера
    const i = cs % NSTEP, a = laneAt(G, fOf(i), -0.5), b = laneAt(G, fOf(i), 0.5), m = laneAt(G, fOf(i), 0);
    c.strokeStyle = rgba(LIGHT, isleOn(i) ? 0.45 : 0.2); c.lineWidth = 1.2; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
    T.glowAt(m.x, m.y, 16 * (0.5 + m.s), 0.18);
  }
  for (let i = NSTEP - 1; i >= 0; i--) {
    const m = markPt(G, i), s = m.s, on = !!isleOn(i), here = cs >= 0 && cs % NSTEP === i, h = (10 + 14 * s) * (i % 4 === 0 ? 1.25 : 1), lw = 2 + 2.5 * s;
    c.strokeStyle = ink(0.7); c.lineWidth = 0.6 + 0.5 * s; c.beginPath(); c.moveTo(m.x, m.y); c.lineTo(m.x, m.y - h); c.stroke();
    if (on) T.glowAt(m.x, m.y - h - lw, here ? 18 * (0.5 + s) : 10 * (0.5 + s), here ? 0.6 : 0.22);
    c.fillStyle = on ? rgba(LIGHT, here ? 1 : 0.75) : BGC; c.strokeStyle = on ? rgba(LIGHT, 0.9) : ink(here ? 0.95 : 0.55); c.lineWidth = 0.8;
    c.beginPath(); c.moveTo(m.x - lw * 0.6, m.y - h); c.lineTo(m.x + lw * 0.6, m.y - h); c.lineTo(m.x + lw * 0.45, m.y - h - lw * 1.4); c.lineTo(m.x - lw * 0.45, m.y - h - lw * 1.4); c.closePath(); c.fill(); c.stroke();
    c.strokeStyle = ink(0.25); c.beginPath(); c.moveTo(m.x - 2 * s - 1, m.y + 1.5); c.lineTo(m.x + 2 * s + 1, m.y + 1.5); c.stroke();
  }
}
let noSun = false;
function draw(now) {
  const c = T.g, G = geo(), cs = curStep();
  c.drawImage(wall(G), 0, 0, T.W, T.H);
  drawMoon(c, G, now);
  const cur = cs >= 0 ? isleOn(cs % NSTEP) : null;
  if (now - killAt < 900 && killXY) {                                                      // падающая звезда
    const k = (now - killAt) / 900, x0 = killXY.x, y0 = killXY.y, x1 = x0 - 90 * k, y1 = y0 + 60 * k;
    c.strokeStyle = rgba(LIGHT, 0.8 * (1 - k)); c.lineWidth = 1.2; c.beginPath(); c.moveTo(x1 + 50 * (1 - k * 0.5), y1 - 33 * (1 - k * 0.5)); c.lineTo(x1, y1); c.stroke();
    T.glowAt(x1, y1, 10, 0.5 * (1 - k));
  }
  drawQuay(c, G, now, cs);
  for (const is of [...isles].sort((a, b) => b.step - a.step)) drawIsle(c, G, is, now, is === cur);
  drawBuoy(c, G, now);
  drawFog(c, G, now);
  drawPharos(c, G, now, cs);
  for (const t of touches.values()) {                   // подписи — пока трогаешь
    if (t.kind === 'isle' && isles.includes(t.is)) { const p = isleXY(G, t.is); T.mapText(`${nameOf(t.is)} · ${Math.round(hzOf(t.is))} Hz`, p.x, p.y - 30 - 22 * p.s, 14, 0.95, 'center'); T.mapText(`step ${t.is.step + 1}`, p.x, p.y - 16 - 22 * p.s, 11, 0.6, 'center'); }
    else if (t.kind === 'moon' && t.moved) T.mapText(`${Math.round(fcOf())} Hz · res ${Math.round(luna.res * 100)}%`, G.moon.x + G.moon.r + 14, G.moon.y + G.moon.r * 0.5 + 18, 13, 0.9, 'left');
    else if (t.kind === 'buoy') { const B = P(G, buoy.u, buoy.d); T.mapText(`echo ${DT_NAME[echo.time]} · ${fbOf() > 0.95 ? 'endless' : Math.round(fbOf() * 100) + '%'}`, B.x, B.y - 36, 13, 0.9, 'center'); }
    else if (t.kind === 'fog') T.mapText(`reverb ${Math.round(fog.amt * 100)}%`, G.cx, G.fogTop - 14, 13, 0.9, 'center');
    else if (t.kind === 'ph') T.mapText(`${seq.bpm} bpm`, G.ph.x - 34, G.ph.y - 112, 13, 0.9, 'center');
  }
}

// ---------- мир ----------
const deg = (d) => (d * Math.PI) / 180;
const fxw = {
  sectors: [{ key: 'wow', label: 'wow', ang: deg(180) }, { key: 'mare', label: 'mare', ang: deg(150) }, { key: 'drive', label: 'drive', ang: deg(130) }, { key: 'chance', label: 'chance', ang: deg(110) }, { key: 'spread', label: 'spread', ang: deg(90) }],
  get: (k) => fx[k], set: (k, v) => { fx[k] = v; applyAll(); }, text: (k) => (k === 'mare' && fx.mare < 0.01 ? 'calm' : `${Math.round(fx[k] * 100)}%`),
  lfo: { keys: ['wow', 'mare', 'drive', 'chance', 'spread'], shapes: 'random' },
  arc: () => fx.drive, save: () => ({ ...fx }), load: (o) => { Object.assign(fx, o); applyAll(); },
};
function dice() {                                       // дорожка: 3–7 ударов, больше на «и»; две-три тоники ступенями лада, сменяются по половинам такта; эхо, туман, луна
  const R = Math.random, pick = (a) => a[Math.floor(R() * a.length)];
  isles.length = 0;
  const roots = [0, pick([3, 5, 7, 10]), pick([0, 5, 7, 12])], chord = pick([2, 2, 3, 3, 1, 4]);
  const order = [2, 6, 10, 14, 3, 11, 7, 15, 0, 9, 13, 5].filter(() => R() < 0.62).slice(0, 7);
  if (order.length < 3) order.push(2, 10);
  for (const j of new Set(order)) isles.push({ step: j, p: roots[j < 8 ? 0 : R() < 0.7 ? 1 : 2], oct: 0, lvl: 1, sd: R() * 1000, hit: 0 });
  pharos.chord = chord;
  echo.time = Math.floor(R() * 5); buoy.d = 0.25 + R() * 0.55; { const G = geo(), a = edge(G, -1, buoy.d), b = edge(G, 1, buoy.d); buoy.u = a + 0.03 + (echo.time / 4) * (b - a - 0.06); }
  pharos.oct = R() < 0.6 ? -1 : 0;
  luna.cut = 0.25 + R() * 0.45; luna.res = R() * 0.6; fog.amt = 0.25 + R() * 0.55;
  applyAll();
  if (!seq.playing) play(true);
}
const portus = {
  n: 'XIII', title: 'Portus', sub: 'pharos · echo · nebula', theme: { ink: INK, bg: BGC, paper: PAPER },
  corner: { hit: () => false, draw: () => {} },   // ночью солнца нет: луна в углу — и карта (тап), и фильтр (тянешь)
  fx: fxw,
  legend: [['tap', 'tap the fairway', 'a paper boat: along — its sixteenth, across — the note'], ['drag', 'drag a boat', 'along — another step, across — another note · tap — it sinks'],
    ['tap', 'tap a marker lamp on the left', 'a boat on that step, or away'], ['tap', 'the lighthouse · drag sideways', 'play · stop · tempo · hold — chord, octave −2…+2'],
    ['drag', 'drag the moon', 'filter: up — open, down — it sets · sideways — resonance'], ['drag', 'drag the bell buoy', 'echo: across — time, out to sea — longer'],
    ['up', 'drag the fog up', 'more reverb'], ['tap', 'tap the night sky', 'a falling star — the echoes die'], ['hold', 'hold the moon, buoy, fog, lighthouse, a boat', 'its sheet'], ['tap', 'tap the moon', 'map of worlds']],
  build, tick, draw, down, move, up, dice,
  clear() { isles.length = 0; },
  snapshot: () => JSON.stringify({ isles: isles.map(({ step, p, oct, lvl, sd }) => ({ step, p, oct, lvl, sd })), luna, echo, buoy, fog, pharos, fx, bpm: seq.bpm }),
  restore(js) {
    const st = JSON.parse(js);
    isles.length = 0; for (const q of st.isles) if (q.step != null) isles.push({ ...q, hit: 0 });
    Object.assign(luna, st.luna); Object.assign(echo, st.echo); Object.assign(buoy, st.buoy); Object.assign(fog, st.fog); Object.assign(pharos, st.pharos); Object.assign(fx, st.fx); seq.bpm = st.bpm;
    applyAll();
  },
  sounding, tempo: { get: () => seq.bpm, set: (bpm) => { seq.bpm = bpm; applyAll(); }, play: (on) => play(on), playing: () => seq.playing, min: 60, max: 180 }, mapShot(on) { noSun = on; },
};
T.registerWorld(13, portus);
window.t2d.portus = {
  isles, get steps() { return isles.map((i) => i.step); }, luna, echo, buoy, fog, pharos, fx, seq, geo, play, setFx: (k, v) => fxw.set(k, v), get live() { return !!(bus && bus.live); }, hz: hzOf, name: nameOf, fc: fcOf, fb: fbOf,
  sea: (u, d) => P(geo(), u, d), col: (i, p) => slotPt(geo(), i, p), lantern: (i) => { const G = geo(), m = markPt(G, i); return { x: m.x, y: m.y - (10 + 14 * m.s) }; }, sky: () => { const G = geo(); return { x: G.cx + G.Ws * 0.2, y: (G.top + G.fogTop) / 2 }; }, kill: () => killEcho(0, 0), get killed() { return killAt; }, buoyAt: () => { const G = geo(), B = P(G, buoy.u, buoy.d); return { x: B.x, y: B.y - 8 }; },
  get stepNow() { return curStep(); }, apply: applyAll,
};
