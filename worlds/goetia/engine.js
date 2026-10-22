// Goetia — звук: bytebeat — ядро C++ (core/worlds/goetia → goetia.wasm) в goetia-worklet.js, шина с эхом и залом. События модели → сообщения worklet;
// обратно из worklet ~30/с — уровни голосов (gains) и счётчик t каждого духа (tt и когда пришёл — at, мс): по ним view мигает узлами и ведёт огонёк.
import { SMAX, progOf, trigOf, fcOf } from './model.js';

const TAU = Math.PI * 2;
export function createEngine(T, model, ver) {
  const { spirits, fx } = model.state;
  let actx = null, node = null, bus = null, ready = false, started = false, lastSound = 0, core = null;
  let bytes = null;                                      // байты goetia.wasm — качаются один раз, на каждый новый контекст — копия
  let gains = new Array(SMAX).fill(0);
  const tt = new Array(SMAX).fill(0), at = new Array(SMAX).fill(0);   // t духа по последнему сообщению и его время (performance.now)
  const queue = [];
  const send = (m) => { if (node && ready) node.port.postMessage(m); else queue.push(m); };

  function build(ctx, input) {
    actx = ctx;
    const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const pre = g(1), out = g(1.6), hallSend = g(0), h = T.hall(), echoSend = g(0), dl = ctx.createDelay(1.5), fb = g(0), damp = ctx.createBiquadFilter();
    dl.delayTime.value = 0.375; damp.type = 'lowpass'; damp.frequency.value = 2600;
    pre.connect(out); pre.connect(hallSend); hallSend.connect(h.input); h.out.connect(g(0.9)).connect(out);
    pre.connect(echoSend); echoSend.connect(dl); dl.connect(damp); damp.connect(fb); fb.connect(dl); damp.connect(out);
    bus = { pre, out, hallSend, hall: h, echoSend, fb, input, live: false };
    ready = false; node = null; started = false; core = null;
    applyFx();
  }
  function start() {                                     // модуль — только когда в мир впервые зашли
    if (started || !actx) return;
    started = true;
    if (!bytes) bytes = fetch(`goetia.wasm?v=${ver}`).then((r) => { if (!r.ok) throw new Error(`goetia.wasm ${r.status}`); return r.arrayBuffer(); });
    const c = actx;                                      // пока грузится, звук могли перезапустить (build на новом контексте) — тогда этот запуск лишний
    Promise.all([c.audioWorklet.addModule(`goetia-worklet.js?v=${ver}`), bytes]).then(([, buf]) => {
      if (c !== actx) return;
      node = new AudioWorkletNode(c, 'goetia', { numberOfInputs: 0, outputChannelCount: [2], processorOptions: { wasm: buf.slice(0) } });
      node.connect(bus.pre);
      node.port.onmessage = (e) => {
        const d = e.data;
        if (d.t === 'ready') { core = 'wasm'; return; }
        if (d.t === 'err') { console.error('goetia core:', d.msg); return; }
        if (d.t !== 'p') return;
        const now = performance.now();
        for (const s of spirits) { tt[s.slot] = d.tt[s.slot]; at[s.slot] = now; }
        gains = d.g;
      };
      ready = true;
      applyFx();
      for (const s of spirits) sendSpirit(s);
      while (queue.length) node.port.postMessage(queue.shift());
    }).catch((err) => { console.error('goetia:', err); if (c === actx) { started = false; bytes = null; } });
  }
  function setLive(on) {
    if (!bus || bus.live === on) return;
    bus.live = on;
    if (on) bus.out.connect(bus.input); else bus.out.disconnect();
  }
  setInterval(() => {
    if (!bus) return;
    if (spirits.length || gains.some((x) => x > 0.002)) lastSound = performance.now();
    else if (performance.now() - lastSound > 9000) setLive(false);
  }, 1000);
  function applyFx() {
    if (!bus) return;
    const t = actx.currentTime;
    bus.hallSend.gain.setTargetAtTime(fx.hall * fx.hall * 1.5, t, 0.05);
    for (const l of bus.hall.lines) l.g.gain.setTargetAtTime(10 ** ((-3 * l.len) / (1.5 + fx.hall * 5)), t, 0.05);
    bus.echoSend.gain.setTargetAtTime(fx.echo * 0.8, t, 0.05); bus.fb.gain.setTargetAtTime(fx.echo * 0.55, t, 0.05);
    send({ t: 'fx', spread: fx.spread, wide: fx.legio });
  }
  function sendSpirit(s, on = true) {
    const sr = actx ? actx.sampleRate : 48000;
    send({ t: 'voice', i: s.slot, on, prog: progOf(s.path), rate: model.rate(s), lp: 1 - Math.exp((-TAU * fcOf(s)) / sr), lvl: s.lvl * 0.3, legio: s.legio, rel: s.rel, trig: trigOf(s), pan: [-0.6, 0, 0.6][s.slot] });
    if (on) { setLive(true); lastSound = performance.now(); }
  }
  function on(e) {                                       // событие модели → worklet
    if (e.t === 'spirit') { if (e.added) { start(); tt[e.s.slot] = 0; at[e.s.slot] = performance.now(); } sendSpirit(e.s, e.on); }   // новый дух — t с нуля
    else if (e.t === 'fx') applyFx();
  }

  return {
    build, start, on,
    get ready() { return ready; }, get core() { return core; }, get gains() { return gains; }, tt, at,
  };
}
