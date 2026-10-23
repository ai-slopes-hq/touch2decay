// Firmamentum — звук: пульсарный синтез — ядро C++ (core/worlds/firmamentum → pulsar.wasm) в pulsar-worklet.js, шина с залом. События модели → сообщения worklet;
// обратно из worklet — счётчики пульсаретов и уровни (meter) и что услышано (listen): { pulsed: [slot], dust: [[pan, a]], bolts: [slot] }.
import { SMAX } from './model.js';

export function createEngine(T, model, ver) {
  const { stars, fx } = model.state;
  let actx = null, node = null, bus = null, ready = false, started = false, lastSound = 0, core = null;
  let bytes = null;                                      // байты pulsar.wasm — качаются один раз, на каждый новый контекст — копия
  let counts = new Array(SMAX).fill(0), gains = new Array(SMAX).fill(0);
  const queue = [], listeners = [];
  const send = (m) => { if (node && ready) node.port.postMessage(m); else queue.push(m); };

  function build(ctx, input) {
    actx = ctx;
    const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const pre = g(1), out = g(2.5), hallSend = g(0), h = T.hall();
    pre.connect(out); pre.connect(hallSend); hallSend.connect(h.input); h.out.connect(g(0.9)).connect(out);
    bus = { pre, out, hallSend, hall: h, input, live: false };
    ready = false; node = null; started = false; core = null;
    applyFx();
  }
  function start() {                                     // модуль пульсаров — только когда в мир впервые зашли
    if (started || !actx) return;
    started = true;
    if (!bytes) bytes = fetch(`pulsar.wasm?v=${ver}`).then((r) => { if (!r.ok) throw new Error(`pulsar.wasm ${r.status}`); return r.arrayBuffer(); });
    const c = actx;                                      // пока грузится, звук могли перезапустить (build на новом контексте) — тогда этот запуск лишний
    Promise.all([c.audioWorklet.addModule(`pulsar-worklet.js?v=${ver}`), bytes]).then(([, buf]) => {
      if (c !== actx) return;
      node = new AudioWorkletNode(c, 'pulsar', { numberOfInputs: 0, outputChannelCount: [2], processorOptions: { wasm: buf.slice(0), seed: (Math.random() * 4294967296) >>> 0 } });
      node.connect(bus.pre);
      node.port.onmessage = (e) => {
        const d = e.data;
        if (d.t === 'ready') { core = 'wasm'; return; }
        if (d.t === 'err') { console.error('pulsar core:', d.msg); return; }
        if (d.t !== 'p') return;
        const pulsed = stars.filter((s) => d.c[s.slot] !== counts[s.slot]).map((s) => s.slot);   // прозвучал пульсарет — звезда вспыхнет
        counts = d.c; gains = d.g;
        const heard = { pulsed, dust: d.k || [], bolts: d.f || [] };
        for (const fn of listeners) fn(heard);
      };
      ready = true;
      applyFx();
      for (const s of stars) sendStar(s);
      while (queue.length) node.port.postMessage(queue.shift());
    }).catch((err) => { console.error('firmamentum:', err); if (c === actx) { started = false; bytes = null; } });
  }
  function setLive(on) {
    if (!bus || bus.live === on) return;
    bus.live = on;
    if (on) bus.out.connect(bus.input); else bus.out.disconnect();
  }
  setInterval(() => {
    if (!bus) return;
    if (stars.length || gains.some((x) => x > 0.002)) lastSound = performance.now();
    else if (performance.now() - lastSound > 8000) setLive(false);
  }, 1000);
  function applyFx() {
    if (!bus) return;
    const t = actx.currentTime;
    bus.hallSend.gain.setTargetAtTime(fx.hall * fx.hall * 1.5, t, 0.05);
    for (const l of bus.hall.lines) l.g.gain.setTargetAtTime(10 ** ((-3 * l.len) / (1.5 + fx.hall * 5)), t, 0.05);
    send({ t: 'fx', jit: fx.scintilla, spread: fx.spread, crep: fx.crepitus, fulg: fx.fulgur });
  }
  function sendStar(s, on = true) {
    send({ t: 'voice', i: s.slot, on, fp: model.fp(s), ff: model.ff(s), cyc: s.cyc, win: s.win, mask: s.mask, lvl: s.lvl * 0.55, pan: s.u * 0.8 });
    if (on) { setLive(true); lastSound = performance.now(); }
  }
  function on(e) {                                       // событие модели → worklet
    if (e.t === 'star') { if (e.added) start(); sendStar(e.s, e.on); }
    else if (e.t === 'fp') send({ t: 'voice', i: e.s.slot, fp: model.fp(e.s) });
    else if (e.t === 'ff') send({ t: 'voice', i: e.s.slot, ff: model.ff(e.s) });
    else if (e.t === 'fx') applyFx();
  }

  return {
    build, start, on,
    listen(fn) { listeners.push(fn); },
    get ready() { return ready; }, get core() { return core; }, get counts() { return counts; }, get gains() { return gains; },
  };
}
