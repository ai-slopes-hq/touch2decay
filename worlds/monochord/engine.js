// Monochordum — звук: Карплус — Стронг в monochord-worklet.js, шина: струны → (сухо + дека) → mix → (сухо + хор) → post → выход и зал.
// События модели → сообщения worklet; часы автострама — здесь (ctx.currentTime, запас 200 мс); энергия струн из worklet — в «услышано» (в модель её кладёт склейка).
// Обратно (listen) — что услышано: { hit: true } — удар автострама прозвучал (Земля вспыхивает); { energy: { e, h, n } } — энергия струн и флажолетов.
import { N } from './model.js';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

export function createEngine(T, model, ver) {
  const { str, fx, auto } = model.state;
  let actx = null, node = null, bus = null, ready = false, started = false, lastSound = 0;
  const clock = { next: 0, step: 0 };                    // автострам: когда следующий шаг (ctx.currentTime) и его номер
  const queue = [], listeners = [];
  const send = (m) => { if (node && ready) node.port.postMessage(m); else queue.push(m); };
  const heard = (e) => { for (const fn of listeners) fn(e); };

  function retune(i) { const s = str[i]; send({ t: 'tune', i, f: model.hzOf(i), bright: clamp(s.bright * 0.5 + fx.bright * 0.5), decay: clamp(s.decay * 0.5 + fx.decay * 0.5), level: s.level }); }
  function build(ctx, input) {
    actx = ctx;
    const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const pre = g(1), mix = g(1), out = g(2.2), body = g(0), hallSend = g(0), h = T.hall();   // струны → (сухо + дека) → mix → выход; mix → зал → выход
    pre.connect(mix);
    const bands = [[190, 3], [420, 4], [1100, 5]].map(([f, q]) => { const b = ctx.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f; b.Q.value = q; pre.connect(b).connect(body); return b; });
    const post = g(1);                                  // mix → (сухо + хор) → post → выход и зал
    body.connect(mix); mix.connect(post); post.connect(out); post.connect(hallSend); hallSend.connect(h.input); h.out.connect(g(0.9)).connect(out);
    bus = { pre, mix, post, out, body, hallSend, hall: h, input, live: false, bands, ch: null };
    ready = false; node = null; started = false;
    applyFx();
  }
  // модуль струн — только когда в Monochordum впервые зашли: тем, кто сюда не заглядывает, он ничего не стоит
  function start() {
    if (started || !actx) return;
    started = true;
    const ctx = actx;
    ctx.audioWorklet.addModule(`monochord-worklet.js?v=${ver}`).then(() => {
      node = new AudioWorkletNode(ctx, 'monochord', { numberOfInputs: 0, outputChannelCount: [2] });
      node.connect(bus.pre);
      node.port.onmessage = (e) => { const d = e.data; if (d.t === 'energy') heard({ energy: d }); };
      ready = true;
      for (let i = 0; i < N; i++) { retune(i); if (str[i].sus) send({ t: 'sus', i, on: true }); }
      send({ t: 'wind', amt: model.state.wind });
      while (queue.length) node.port.postMessage(queue.shift());
    }).catch(() => { started = false; });
  }
  function setLive(on) {
    if (!bus || bus.live === on) return;
    bus.live = on;
    if (on) bus.out.connect(bus.input); else bus.out.disconnect();
  }
  const wake = () => { start(); setLive(true); lastSound = performance.now(); };   // звук пошёл — модуль, выход
  setInterval(() => {
    if (!bus) return;
    if (model.sounding() || str.some((s) => s.en > 0.002)) lastSound = performance.now();
    else if (performance.now() - lastSound > 8000) setLive(false);
  }, 1000);
  function chorusNodes() {                               // хор — по требованию: две плавающие задержки 12–19 мс, разведены по стерео
    if (bus.ch) return bus.ch;
    const ctx = actx, g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; }, wet = g(0), lines = [];
    [[0.012, 0.31, -0.7], [0.019, 0.47, 0.7]].forEach(([d0, rate, pan]) => {
      const d = ctx.createDelay(0.05), o = ctx.createOscillator(), lg = g(0.002), p = ctx.createStereoPanner();
      d.delayTime.value = d0; o.frequency.value = rate; p.pan.value = pan;
      o.connect(lg).connect(d.delayTime); o.start();
      d.connect(p).connect(wet); lines.push({ d, lg });
    });
    wet.connect(bus.post);
    return (bus.ch = { wet, lines, on: false });
  }
  function applyFx() {
    if (!bus) return;
    const t = actx.currentTime;
    if (fx.chorus > 0.01 || bus.ch) {
      const C = chorusNodes(), on = fx.chorus > 0.01;
      if (on !== C.on) { C.on = on; for (const l of C.lines) { if (on) bus.mix.connect(l.d); else bus.mix.disconnect(l.d); } }
      C.wet.gain.setTargetAtTime(fx.chorus * 0.9, t, 0.05);
      for (const l of C.lines) l.lg.gain.setTargetAtTime(0.001 + 0.004 * fx.chorus, t, 0.05);
    }
    bus.body.gain.setTargetAtTime(fx.body * 2.5, t, 0.05);
    send({ t: 'couple', amt: 0.0015 * fx.sympathy });
    bus.hallSend.gain.setTargetAtTime(fx.hall * fx.hall * 1.4, t, 0.05);
    for (const l of bus.hall.lines) l.g.gain.setTargetAtTime(10 ** ((-3 * l.len) / (1.5 + fx.hall * 4)), t, 0.05);
    for (let i = 0; i < N; i++) retune(i);
  }

  // ---------- автострам: шаги по расписанию, щипки с at — worklet кладёт их в pend и играет в свой блок ----------
  function strumAt(t, hits) {
    for (const h of hits) send({ t: 'pluck', i: h.i, pos: h.pos, vel: h.vel, at: t + h.dt });
    setTimeout(() => heard({ hit: true }), Math.max(0, (t - actx.currentTime) * 1000));
  }
  function autoSchedule() {
    if (!auto.on || !actx || !ready) return;
    const now = actx.currentTime, ahead = now + 0.2;
    if (!clock.next) clock.next = now + 0.05;
    while (clock.next < ahead) {
      if (clock.next > now + 0.003) { const hits = model.autoStep(clock.step); if (hits) strumAt(clock.next, hits); }   // опоздавший шаг пропускаем; chance — в модели
      clock.next += model.stepDur(clock.step); clock.step++;
    }
  }
  setInterval(autoSchedule, 25);

  function on(e) {                                       // событие модели → worklet
    if (e.t === 'tune') retune(e.i);
    else if (e.t === 'pluck') { wake(); send({ t: 'pluck', i: e.i, pos: e.pos, vel: e.vel }); }
    else if (e.t === 'harm') { wake(); send({ t: 'harm', i: e.i, n: e.n, vel: e.vel }); }
    else if (e.t === 'bow') { send({ t: 'bow', i: e.i, amp: e.amp }); if (e.amp > 0) { setLive(true); lastSound = performance.now(); } }
    else if (e.t === 'sus') { send({ t: 'sus', i: e.i, on: e.on }); if (e.on) wake(); }
    else if (e.t === 'wind') { send({ t: 'wind', amt: e.amt }); if (e.amt > 0.01) wake(); }
    else if (e.t === 'auto') { clock.next = 0; clock.step = 0; if (e.on) wake(); }
    else if (e.t === 'fx') applyFx();
  }

  return {
    build, start, on,
    listen(fn) { listeners.push(fn); },
    get ready() { return ready; }, get live() { return !!(bus && bus.live); }, get chorus() { return !!(bus && bus.ch && bus.ch.on); },
  };
}
