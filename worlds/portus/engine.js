// Portus — звук на обычных узлах (без worklet): dub techno — аккорды-стабы сквозь фильтр, эхо и туман.
// Шина: стабы → drive → сухо; эхо пинг-понг (петля: highpass, lowpass dark, tanh, wow на delayTime); ревер T.hall(); море — шум в полосе.
// Часы — здесь (schedule на ctx.currentTime: 25 мс, запас 200 мс, шестнадцатые; что играет шаг — модель). События модели → узлы;
// метры — step (нынешний шаг), live; что услышано (listen): { hit: is, dt, fb } — удар прозвучал (кораблик, маяк, круги эха во view).
import { CHORDS, DT, NSTEP, PSPAN } from './model.js';

export function createEngine(T, model) {
  const { luna, echo, fog, pharos, fx, seq } = model.state;
  let actx = null, bus = null, lastSound = 0, noiseBuf = null;
  const clock = { next: 0, step: 0 };                    // когда следующий шаг (ctx.currentTime) и его номер
  const lastSteps = [], listeners = [];
  const heard = (e) => { for (const fn of listeners) fn(e); };
  const stepSec = model.stepSec, fbOf = model.fbOf;

  function build(ctx, input) {
    actx = ctx; lastAt = -1; clock.next = 0;                // новый контекст (restartAudio): время старого не годится — часы встают заново
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
    if (model.sounding() || fx.mare > 0.01) lastSound = performance.now();
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
    const ctx = actx, ch = CHORDS[model.typeOf(is)], f0 = model.hzOf(is), tau = 0.035 + pharos.len ** 2 * 1.8, A = 0.004;
    const fc = model.fcOf(), peak = Math.min(16000, fc * 2 ** (luna.env * 4.2 * vel)), Q = 0.7 + 13 * luna.res ** 2;
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
    voices++; osc[0].onended = () => { voices--; for (const n of [...osc, lp1, lp2, vca, pan]) n.disconnect(); };
    const wait = Math.max(0, (t - ctx.currentTime) * 1000);
    setTimeout(() => heard({ hit: is, dt: DT[echo.time] * stepSec() * 1000, fb: fbOf() }), wait);   // для картинки: кораблик вспыхивает, маяк светит, круги эха
    lastSound = performance.now(); setLive(true);
  }
  function killEcho() {                                   // эхо гаснет за ~20 мс, через 350 мс — снова слушает
    if (!bus) return;
    const t = actx.currentTime;
    for (const g of [bus.fbL.gain, bus.fbR.gain, bus.dWet.gain, bus.dSend.gain]) { g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.setTargetAtTime(0, t, 0.02); }
    setTimeout(() => { if (!bus) return; bus.dWet.gain.setTargetAtTime(0.9, actx.currentTime, 0.05); applyAll(); }, 350);
  }
  // ПРОБА 0б: часы наружу (оболочка ios/shell — ведущий MIDI): пуск, первый шаг такта, смена темпа, стоп — какой шаг, темп и когда его услышат (epoch, мс)
  const pulses = []; let pulsed = null, voices = 0;   // pulsed — темп последнего сообщения (null — пуска не было), voices — живых ударов (лог пробы)
  function heardAt(t) {                                  // время ctx → когда прозвучит из динамика, мс epoch (у оболочки — те же часы)
    const o = actx.getOutputTimestamp && actx.getOutputTimestamp();
    const p = o && o.performanceTime > 0 ? o.performanceTime + (t - o.contextTime) * 1000 : performance.now() + (t - actx.currentTime + (actx.outputLatency || actx.baseLatency || 0)) * 1000;
    return performance.timeOrigin + p;
  }
  const pulse = (t, at) => { const m = { t, step: clock.step, bpm: seq.bpm, at: heardAt(at) }; for (const fn of pulses) fn(m); };
  const grid = () => { const g = T.midiGrid(); return g && g.p > 0 ? g : null; };   // сетка с нулевым или отрицательным периодом — не сетка (ни прыжков, ни зависания)
  let lastAt = -1;                                       // время последнего поставленного удара: назад сетка прыгнула — шаг, что не позже его, пропускаем
  function schedule() {
    if (!seq.playing || !actx) return;
    const now = actx.currentTime, ahead = now + 0.2;
    if (!clock.next) clock.next = now + 0.05;
    const align = () => { const g = grid(); if (g) { clock.step = Math.max(clock.step, Math.floor(((now - g.t0) / g.p) * 4) - 1); clock.next = T.stepTime(g, clock.step, 4); } };   // сетка MIDI-часов ведёт шаги (мир запущен поздно — сразу к нынешнему шагу, не по одному); пропала — идём дальше своим темпом
    align();
    while (clock.next < ahead) {
      if (pulsed === null) pulse('start', clock.next);
      else if (clock.step % NSTEP === 0 || pulsed !== seq.bpm) pulse('at', clock.next);
      pulsed = seq.bpm;
      const j = clock.step % NSTEP, t = T.due(clock.next + model.swing(j), now, clock.step === 0);   // опоздавший шаг пропускаем (первый после пуска — сразу)
      if (t !== null && t > lastAt) { lastAt = t; const h = model.step(j); if (h) stab(t, h.is, h.vel, h.gap); }   // chance — в модели
      lastSteps.push([clock.next, clock.step]); if (lastSteps.length > 24) lastSteps.shift();
      clock.step++; clock.next += stepSec();
      align();
    }
  }
  T.onTick(schedule);                                  // таймер 25 мс + метроном из звукового потока — в фоне шаги не пропадают
  function play(on) {
    if (!on && pulsed !== null && actx) pulse('stop', actx.currentTime);
    clock.next = 0; pulsed = null; lastAt = -1;
    if (on) { clock.step = 0; setLive(true); schedule(); }
  }
  function curStep() {
    if (!actx || !lastSteps.length || !seq.playing) return -1;
    const t = actx.currentTime; let cur = -1;
    for (const [tt, s] of lastSteps) if (tt <= t) cur = s;
    return cur;
  }
  let audAt = 0;
  function audition(is) {                                 // часы стоят — услышать аккорд, пока ставишь (не чаще 140 мс)
    if (seq.playing || !actx || performance.now() - audAt < 140) return;
    audAt = performance.now(); stab(actx.currentTime + 0.02, is, 1, 0.6);
  }
  let rnd0 = 0, lastDt = 0;
  function poll(now) {                                    // раз в 120 мс: время эха поменялось мимо событий (темп) — шину заново
    if (now - rnd0 > 120) { rnd0 = now; if (bus) { const dt = DT[echo.time] * stepSec(); if (Math.abs(dt - lastDt) > 1e-4) { lastDt = dt; applyAll(); } } }
  }

  function on(e) {                                        // событие модели → узлы
    if (e.t === 'fx') applyAll();
    else if (e.t === 'play') play(e.on);
    else if (e.t === 'kill') killEcho();
    else if (e.t === 'audition') audition(e.is);
  }

  return {
    build, on, poll, apply: applyAll,
    listen(fn) { listeners.push(fn); }, pulse(fn) { pulses.push(fn); }, get voices() { return voices; },
    get step() { return curStep(); }, get live() { return !!(bus && bus.live); },
  };
}
