// Oceanus — звук: сканирующий синтез — ядро C++ (core/worlds/oceanus → ocean.wasm) в ocean-worklet.js, шина с залом. События модели → сообщения worklet;
// обратно из worklet ~30/с — метры: форма кольца (shape), место луны (moon, доля круга), уровни голосов (gains).
import { N, VMAX } from './model.js';

export function createEngine(T, model, ver) {
  const { voices, fx, luna } = model.state;
  let actx = null, node = null, bus = null, ready = false, started = false, lastSound = 0, core = null;
  let bytes = null;                                      // байты ocean.wasm — качаются один раз, на каждый новый контекст — копия
  let shape = new Float32Array(N), moon = 0, gains = new Array(VMAX).fill(0);
  const queue = [];
  const send = (m) => { if (node && ready) node.port.postMessage(m); else queue.push(m); };

  function build(ctx, input) {
    actx = ctx;
    const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const pre = g(1), out = g(1.6), hallSend = g(0);
    pre.connect(out); pre.connect(hallSend); hallSend.connect(g(1.6)).connect(T.send('hall'));   // ×1.6 — прежний out после возврата зала
    bus = { pre, out, hallSend, input, live: false };
    ready = false; node = null; started = false; core = null;
    applyFx();
  }
  function start() {                                     // модуль океана — только когда в мир впервые зашли
    if (started || !actx) return;
    started = true;
    if (!bytes) bytes = fetch(`ocean.wasm?v=${ver}`).then((r) => { if (!r.ok) throw new Error(`ocean.wasm ${r.status}`); return r.arrayBuffer(); });
    const c = actx;                                      // пока грузится, звук могли перезапустить (build на новом контексте) — тогда этот запуск лишний
    Promise.all([c.audioWorklet.addModule(`ocean-worklet.js?v=${ver}`), bytes]).then(([, buf]) => {
      if (c !== actx) return;
      node = new AudioWorkletNode(c, 'ocean', { numberOfInputs: 0, outputChannelCount: [2], processorOptions: { wasm: buf.slice(0), seed: (Math.random() * 4294967296) >>> 0 } });
      node.connect(bus.pre);
      node.port.onmessage = (e) => { const d = e.data; if (d.t === 'ready') { core = 'wasm'; return; } if (d.t === 'err') { console.error('ocean core:', d.msg); return; } if (d.t === 'shape') { shape = Float32Array.from(d.x); moon = d.moon; gains = d.g; } };
      ready = true;
      sendParams();
      for (const v of voices) sendVoice(v);
      while (queue.length) node.port.postMessage(queue.shift());
    }).catch((err) => { console.error('oceanus:', err); if (c === actx) { started = false; bytes = null; } });
  }
  function setLive(on) {
    if (!bus || bus.live === on) return;
    bus.live = on;
    if (on) bus.out.connect(bus.input); else bus.out.disconnect();
  }
  setInterval(() => {
    if (!bus) return;
    if (voices.length || gains.some((x) => x > 0.002)) lastSound = performance.now();
    else if (performance.now() - lastSound > 8000) setLive(false);
  }, 1000);
  function sendParams() {
    send({ t: 'params', kt: 0.004 * 60 ** fx.tension, damp: 0.00003 * 300 ** fx.damping, kc: 0.0015 + 0.004 * fx.tide, wind: fx.wind * fx.wind, tide: fx.tide * 0.9, moonRate: 0.005 * 40 ** luna.orbit, storm: luna.storm, sway: luna.sway, swayTo: luna.to });
  }
  function applyFx() {
    if (!bus) return;
    const t = actx.currentTime;
    bus.hallSend.gain.setTargetAtTime(fx.hall * fx.hall * 1.4, t, 0.05);
    sendParams();
  }
  function sendVoice(v, on = true) { send({ t: 'voice', i: v.slot, on, f: model.hz(v), lvl: v.lvl * 0.8, path: v.path || 0 }); if (on) { setLive(true); lastSound = performance.now(); } }
  function on(e) {                                       // событие модели → worklet
    if (e.t === 'voice') { if (e.added) start(); sendVoice(e.v, e.on); }
    else if (e.t === 'fx') applyFx();
    else if (e.t === 'push') send({ t: 'push', id: e.id, a: e.a, d: e.d, k: 0.06 });
    else if (e.t === 'release') send({ t: 'push', id: e.id, off: true });
    else if (e.t === 'splash') send({ t: 'splash', a: e.a, amt: e.amt });
  }

  return {
    build, start, on,
    get ready() { return ready; }, get core() { return core; }, get live() { return !!(bus && bus.live); },
    get shape() { return shape; }, get moon() { return moon; }, get gains() { return gains; },
  };
}
