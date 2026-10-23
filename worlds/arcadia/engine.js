// Arcadia — звук: синтез по рельефу (terrain-worklet.js), шина: worklet → pre → [фейзер] → mix → сухо + [хорус] → out; зал — от mix.
// События модели → сообщения worklet; обратно из worklet — центры петель и уровни (метры) и что услышано (listen): { centers, gains }.
import { GX, GY, ASP, VMAX } from './model.js';

export function createEngine(T, model, ver) {
  const { travellers, fx } = model.state;
  let actx = null, node = null, bus = null, ready = false, started = false, lastSound = 0;
  let centers = Array.from({ length: VMAX }, () => [0, 0, 0.2]), gains = new Array(VMAX).fill(0);
  const queue = [], listeners = [];
  const send = (m) => { if (node && ready) node.port.postMessage(m); else queue.push(m); };

  function build(ctx, input) {
    actx = ctx;
    const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const pre = g(1), mix = g(1), out = g(1.5), hallSend = g(0);
    const lfo = (f, depth, ...params) => { const o = ctx.createOscillator(), gg = g(depth); o.frequency.value = f; o.connect(gg); for (const p of params) gg.connect(p); o.start(); return gg; };
    pre.connect(mix);                                                                           // фейзер: шесть всепропускающих фильтров плывут, сумма с сухим — бегущие провалы
    const aps = [0, 1, 2, 3, 4, 5].map((i) => { const b = ctx.createBiquadFilter(); b.type = 'allpass'; b.frequency.value = 320 * 1.7 ** i; b.Q.value = 0.6; return b; });
    for (let i = 0; i < 5; i++) aps[i].connect(aps[i + 1]);
    const phWet = g(0); aps[5].connect(phWet).connect(mix);
    const phLfo = lfo(0.11, 0, ...aps.map((b) => b.frequency));
    const chDry = g(1), chWet = g(0), d1 = ctx.createDelay(0.05), d2 = ctx.createDelay(0.05);   // хорус: две плавающие задержки, разведённые по сторонам
    d1.delayTime.value = 0.013; d2.delayTime.value = 0.019;
    lfo(0.27, 0.0035, d1.delayTime); lfo(0.19, 0.0045, d2.delayTime);
    const pL = ctx.createStereoPanner ? ctx.createStereoPanner() : g(1), pR = ctx.createStereoPanner ? ctx.createStereoPanner() : g(1);
    if (pL.pan) { pL.pan.value = -0.8; pR.pan.value = 0.8; }
    d1.connect(pL).connect(chWet); d2.connect(pR).connect(chWet); chWet.connect(out);
    mix.connect(chDry).connect(out); mix.connect(hallSend); hallSend.connect(g(1.5)).connect(T.send('hall'));   // ×1.5 — прежний out после возврата зала
    bus = { pre, mix, out, hallSend, input, live: false, aps, phWet, phLfo, chWet, chDry, d1, d2, phOn: false, chOn: false };
    ready = false; node = null; started = false;
    applyFx();
  }
  function start() {                                       // модуль рельефа — только когда в мир впервые зашли
    if (started || !actx) return;
    started = true;
    actx.audioWorklet.addModule(`terrain-worklet.js?v=${ver}`).then(() => {
      node = new AudioWorkletNode(actx, 'terrain', { numberOfInputs: 0, outputChannelCount: [2] });
      node.connect(bus.pre);
      node.port.onmessage = (e) => {
        const d = e.data;
        if (d.t !== 'p') return;
        centers = d.c; gains = d.g;
        const heard = { centers, gains };
        for (const fn of listeners) fn(heard);
      };
      ready = true;
      const land = model.state.land;
      node.port.postMessage({ t: 'terrain', z: land.z, lake: land.lake, gx: GX, gy: GY, asp: ASP, now: true });
      applyFx();
      for (const t of travellers) sendT(t);
      while (queue.length) node.port.postMessage(queue.shift());
    }).catch(() => { started = false; });
  }
  function setLive(on) {
    if (!bus || bus.live === on) return;
    bus.live = on;
    if (on) bus.out.connect(bus.input); else bus.out.disconnect();
  }
  setInterval(() => {
    if (!bus) return;
    if (travellers.length || gains.some((x) => x > 0.002)) lastSound = performance.now();
    else if (performance.now() - lastSound > 8000) setLive(false);
  }, 1000);
  function applyFx() {
    if (!bus) return;
    const t = actx.currentTime;
    bus.hallSend.gain.setTargetAtTime(fx.hall * fx.hall * 1.4, t, 0.05);
    send({ t: 'params', relief: fx.relief, speed: 0.01 * 40 ** fx.pace, wind: fx.wind, spread: fx.spread });
    const ph = fx.phaser > 0.01, ch = fx.chorus > 0.01;                                       // выключенные — отцеплены, не считаются
    if (ph !== bus.phOn) { bus.phOn = ph; if (ph) bus.pre.connect(bus.aps[0]); else bus.pre.disconnect(bus.aps[0]); }
    if (ch !== bus.chOn) { bus.chOn = ch; if (ch) { bus.mix.connect(bus.d1); bus.mix.connect(bus.d2); } else { bus.mix.disconnect(bus.d1); bus.mix.disconnect(bus.d2); } }
    bus.phWet.gain.setTargetAtTime(fx.phaser * 0.95, t, 0.05); bus.phLfo.gain.setTargetAtTime(150 + 650 * fx.phaser, t, 0.05);
    bus.chWet.gain.setTargetAtTime(fx.chorus * 0.75, t, 0.05); bus.chDry.gain.setTargetAtTime(1 - fx.chorus * 0.3, t, 0.05);
  }
  function sendT(t, on = true, withRoute = true) {       // путь (t.route) считает модель — здесь только отправить
    const m = { t: 'voice', i: t.slot, on, f: model.hzOf(t), hx: t.u, hy: t.v, r: t.r, fig: t.fig, lvl: t.lvl * 0.7, mode: t.mode, sp: t.sp, pan: t.u * 0.8 };
    if (withRoute) m.route = t.route;
    send(m);
    if (on) { setLive(true); lastSound = performance.now(); }
  }
  function on(e) {                                         // событие модели → worklet
    if (e.t === 'trav') { if (e.added) start(); sendT(e.tr, e.on, e.route); }
    else if (e.t === 'land') send({ t: 'terrain', z: e.land.z, lake: e.land.lake, gx: GX, gy: GY, asp: ASP });
    else if (e.t === 'fx') applyFx();
  }

  return {
    build, start, on,
    listen(fn) { listeners.push(fn); },
    get ready() { return ready; }, get centers() { return centers; }, get gains() { return gains; },
  };
}
