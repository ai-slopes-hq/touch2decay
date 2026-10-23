// Horologium — звук: колесо и кольца в horo-worklet.js (щелчок в резонатор), шина: worklet → pre → (сухо + зал) → out → выход.
// События модели → сообщения worklet. Колесо крутится в worklet; обратно ~30/с — его положение P, скорость F и удары колец.
// Метры: P, F, tP (когда пришло, performance.now), strikes. Что услышано (listen): { ready } — worklet завёлся (склейка досылает модель),
// { hits, P } — какие кольца ударили (вспышки, луч concursus — во view).
export function createEngine(T, model, ver) {
  const { rings, fx, clock, pend } = model.state;
  let actx = null, node = null, bus = null, ready = false, started = false, lastSound = 0;
  let Pm = 0, Fm = 0, tP = 0, strikes = 0;               // зеркало колеса из worklet: положение, скорость, когда пришло
  const queue = [], listeners = [];
  const send = (m) => { if (node && ready) node.port.postMessage(m); else if (m.t !== 'step') queue.push(m); };
  const heard = (e) => { for (const fn of listeners) fn(e); };
  const ringsMsg = () => rings.map(({ on, under, phi, lvl }) => ({ on, under, phi, lvl }));

  // замок к такту MIDI: колесо идёт от часов Horologium, пока tempus = 0 и маятник не в руке; шлём при смене сетки, не каждые 25 мс
  let lockSent = null;
  function syncLock() {
    if (!ready) return;                                    // узла ещё нет — после запуска досылаем (см. start)
    const g = clock.run && clock.u === 0 && !pend.held ? T.midiGrid() : null, a = lockSent;
    if (g ? a && a.t0 === g.t0 && a.p === g.p : !a) return;
    lockSent = g ? { t0: g.t0, p: g.p } : null;
    send(g ? { t: 'lock', t0: g.t0, bar: 4 * g.p } : { t: 'lock', off: true });
  }
  T.onTick(syncLock);                                      // таймер 25 мс + метроном из звукового потока

  function build(ctx, input) {
    actx = ctx;
    const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const pre = g(1), out = g(2.4), hallSend = g(0), h = T.hall();
    pre.connect(out); pre.connect(hallSend); hallSend.connect(h.input); h.out.connect(g(0.9)).connect(out);
    bus = { pre, out, hallSend, hall: h, input, live: false };
    ready = false; node = null; started = false; queue.length = 0; lockSent = null;   // новый узел — сетка заново
    applyFx();
  }
  function start() {                                       // колесо и кольца (horo-worklet.js) — когда в мир впервые зашли
    if (started || !actx) return;
    started = true;
    actx.audioWorklet.addModule(`horo-worklet.js?v=${ver}`).then(() => {
      node = new AudioWorkletNode(actx, 'horo', { numberOfInputs: 0, outputChannelCount: [2] });
      node.connect(bus.pre); ready = true;
      node.port.onmessage = (e) => {
        const d = e.data; if (d.t !== 'p') return;
        const now = performance.now();
        Pm = d.P; Fm = d.F; tP = now;
        if (d.hits.length) { strikes += d.hits.length; lastSound = now; heard({ hits: d.hits, P: d.P }); }
      };
      heard({ ready: true });                              // склейка: model.sendAll() — кольца, тоника, скорость
      applyFx();
      while (queue.length) node.port.postMessage(queue.shift());
      syncLock();
    }).catch(() => { started = false; });
  }
  function setLive(on) {
    if (!bus || bus.live === on) return;
    bus.live = on;
    if (on) bus.out.connect(bus.input); else bus.out.disconnect();
  }
  setInterval(() => {
    if (!bus) return;
    if (model.sounding()) lastSound = performance.now();
    else if (performance.now() - lastSound > 8000) setLive(false);
  }, 1000);
  function applyFx() {
    if (!bus) return;
    const t = actx.currentTime;
    bus.hallSend.gain.setTargetAtTime(fx.hall * fx.hall * 1.4, t, 0.05);
    for (const l of bus.hall.lines) l.g.gain.setTargetAtTime(10 ** ((-3 * l.len) / (1.5 + fx.hall * 4)), t, 0.05);
    send({ t: 'set', mat: fx.materia, conc: fx.concursus, chance: fx.chance, aeq: fx.aequalis });
  }
  function live() { start(); setLive(true); lastSound = performance.now(); }

  function on(e) {                                       // событие модели → worklet
    if (e.t === 'all') send({ t: 'set', rings: ringsMsg(), B: model.baseB(), F: model.Fnow() });
    else if (e.t === 'rings') send({ t: 'set', rings: ringsMsg() });
    else if (e.t === 'speed') send(e.B === undefined ? { t: 'set', F: e.F } : { t: 'set', F: e.F, B: e.B });
    else if (e.t === 'step') send({ t: 'step', d: e.d });
    else if (e.t === 'fx') applyFx();
    else if (e.t === 'wake') live();
  }

  return {
    build, start, on,
    listen(fn) { listeners.push(fn); },
    get ready() { return ready; }, get live() { return !!(bus && bus.live); },
    get P() { return Pm; }, get F() { return Fm; }, get tP() { return tP; }, get strikes() { return strikes; },
  };
}
