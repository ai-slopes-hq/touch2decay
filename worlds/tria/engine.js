// Tria corpora — звук на обычных узлах (без worklet): три генератора дрона пары по кругу модулируют друг друга (FM 0→1→2→0),
// колокола тел (FM-пары), тимпан края, шорох соединения; шина с tanh и залом. События модели → узлы; метры — strikes, encounters.
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
// колокол тела: FM-пара с огибающей; у каждого начала свой металл: соль — дерево, сера — колокол, ртуть — стекло
const BELL = [{ ratio: 1, idx: 1.2, dec: 0.45, amp: 0.5 }, { ratio: 3.5, idx: 2.2, dec: 1.4, amp: 0.32 }, { ratio: 2.01, idx: 1.6, dec: 2.2, amp: 0.26 }];

export function createEngine(T, model) {
  const { bodies, fx, pairK, trem } = model.state;
  let actx = null, bus = null, vo = null, lastSound = 0, noiseBuf = null, liveNotes = 0, strikes = 0, encounters = 0;

  function build(ctx, input) {
    actx = ctx;
    const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const pre = g(1), sh = ctx.createWaveShaper(), out = g(1.6), hallSend = g(0);
    const c = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; c[i] = Math.tanh(1.4 * x) / Math.tanh(1.4); } sh.curve = c;
    pre.connect(sh).connect(out); sh.connect(hallSend); const wet = g(1.6); wet.connect(T.send('hall'));   // ×1.6 — прежний out после возврата зала
    bus = { feed: [[hallSend, wet]], pre, out, hallSend, input, live: false };
    const n = ctx.sampleRate; noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    vo = null;
    applyFx();
  }
  function start() {                                    // три генератора, по кругу модулируют друг друга (в петле — задержка 2 мс, без неё круг запрещён)
    if (!bus) return;
    setLive(true); lastSound = performance.now();
    if (vo) return;
    const ctx = actx, t = ctx.currentTime, g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    vo = bodies.map((b) => { const o = ctx.createOscillator(), vca = g(0), pan = ctx.createStereoPanner(), mg = g(0); o.frequency.value = model.hzOf(b); o.connect(vca).connect(pan).connect(bus.pre); o.start(t); return { o, vca, pan, mg }; });
    const dl = ctx.createDelay(0.01); dl.delayTime.value = 0.002;
    vo[0].o.connect(vo[0].mg).connect(vo[1].o.frequency); vo[1].o.connect(vo[1].mg).connect(vo[2].o.frequency); vo[2].o.connect(dl).connect(vo[2].mg).connect(vo[0].o.frequency);
    vo.dl = dl;
  }
  function stopVoices() {
    if (!vo) return;
    const t = actx.currentTime;
    for (const v of vo) { v.o.stop(t + 0.05); v.o.onended = () => { v.o.disconnect(); v.vca.disconnect(); v.pan.disconnect(); v.mg.disconnect(); }; }
    vo.dl.disconnect(); vo = null;
  }
  function setLive(on) {
    if (!bus || bus.live === on) return;
    bus.live = on;
    if (on) bus.out.connect(bus.input); else bus.out.disconnect();
    for (const [a, b] of bus.feed) { if (on) a.connect(b); else a.disconnect(b); }   // посыл в зал ядра — вместе с выходом: молчащий мир не считается (посыл стоит до out)
  }
  setInterval(() => {
    if (!bus) return;
    if (!model.state.still || bodies.some((b) => b.amp > 0.01)) lastSound = performance.now();
    else if (performance.now() - lastSound > 6000) { stopVoices(); setLive(false); }
  }, 1000);
  function applyFx() {
    if (!bus) return;
    const t = actx.currentTime;
    bus.hallSend.gain.setTargetAtTime(fx.hall * fx.hall * 1.4, t, 0.05);
  }
  function burst(f, pan, k = 1) {                       // близкий пролёт — шорох: шум сквозь узкую полосу
    if (!bus) return;
    const ctx = actx, t = ctx.currentTime, s = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), gg = ctx.createGain(), p = ctx.createStereoPanner();
    s.buffer = noiseBuf; bp.type = 'bandpass'; bp.frequency.value = Math.min(9000, f); bp.Q.value = 14; p.pan.value = pan;
    gg.gain.setValueAtTime(0, t); gg.gain.linearRampToValueAtTime(0.45 * k, t + 0.004); gg.gain.exponentialRampToValueAtTime(0.0005, t + 0.3); gg.gain.linearRampToValueAtTime(0, t + 0.31);
    s.connect(bp).connect(gg).connect(p).connect(bus.pre); s.start(t, Math.random() * 0.5); s.stop(t + 0.33);
    s.onended = () => { s.disconnect(); bp.disconnect(); gg.disconnect(); p.disconnect(); };
    encounters++;
  }
  function bell(i, f, vel, pan) {
    if (!bus || liveNotes > 18) return;
    const ctx = actx, t = ctx.currentTime + 0.005, B = BELL[i], b = bodies[i];
    const car = ctx.createOscillator(), mod = ctx.createOscillator(), mg = ctx.createGain(), vca = ctx.createGain(), p = ctx.createStereoPanner();
    const dec = B.dec * (0.7 + 0.6 * vel), ix = f * B.ratio * B.idx * (0.3 + 1.4 * fx.nexus) * vel, pk = B.amp * b.level * (0.35 + 0.65 * vel);
    car.frequency.value = f; mod.frequency.value = f * B.ratio; p.pan.value = pan;
    mg.gain.setValueAtTime(ix, t); mg.gain.exponentialRampToValueAtTime(Math.max(1, ix * 0.04), t + dec * 0.6);
    vca.gain.setValueAtTime(0, t); vca.gain.linearRampToValueAtTime(pk, t + 0.003); vca.gain.exponentialRampToValueAtTime(0.0004, t + dec); vca.gain.linearRampToValueAtTime(0, t + dec + 0.01);
    mod.connect(mg).connect(car.frequency); car.connect(vca).connect(p).connect(bus.pre);
    car.start(t); mod.start(t); car.stop(t + dec + 0.03); mod.stop(t + dec + 0.03);
    liveNotes++; strikes++;
    car.onended = () => { liveNotes--; for (const n of [car, mod, mg, vca, p]) n.disconnect(); };
    setLive(true); lastSound = performance.now();
  }
  function thud(i, vn) {                                // удар о край блюда — низкий тимпан: основной тон тела октавой ниже, высота падает
    if (!bus || liveNotes > 18) return;
    const ctx = actx, t = ctx.currentTime + 0.005, f = model.baseHz(bodies[i]), o = ctx.createOscillator(), vca = ctx.createGain(), p = ctx.createStereoPanner(), k = clamp(vn / 2.5);
    o.type = 'triangle'; o.frequency.setValueAtTime(f * 2, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.06); p.pan.value = clamp(bodies[i].x, -1, 1) * 0.7;
    vca.gain.setValueAtTime(0, t); vca.gain.linearRampToValueAtTime(0.5 * k * bodies[i].level, t + 0.002); vca.gain.exponentialRampToValueAtTime(0.0004, t + 0.35); vca.gain.linearRampToValueAtTime(0, t + 0.36);
    o.connect(vca).connect(p).connect(bus.pre); o.start(t); o.stop(t + 0.38);
    liveNotes++; o.onended = () => { liveNotes--; o.disconnect(); vca.disconnect(); p.disconnect(); };
  }
  function drone() {                                    // дрон пары: громкость и пульс — из модели, FM по кругу — ближе источник, глубже
    if (!vo) return;
    const t = actx.currentTime;
    bodies.forEach((b, i) => {
      const n = vo[i], src = bodies[(i + 2) % 3], d = Math.hypot(b.x - src.x, b.y - src.y), f = model.baseHz(b), idx = fx.nexus * f * 2 * clamp(0.12 / Math.max(0.03, d), 0, 3);
      n.o.frequency.setTargetAtTime(f, t, 0.05);
      const tr = 1 - 0.7 * pairK[i] * (0.5 + 0.5 * Math.sin(trem[i]));   // пульс — оборот пары
      n.vca.gain.setTargetAtTime(b.amp * 0.2 * tr, t, 0.012);
      n.pan.pan.setTargetAtTime(clamp(b.x, -1, 1) * 0.8, t, 0.05);
      vo[(i + 2) % 3].mg.gain.setTargetAtTime(idx, t, 0.04);
    });
  }
  function on(e) {                                      // событие модели → узлы
    if (e.t === 'drone') drone();
    else if (e.t === 'bell') bell(e.i, e.f, e.vel, e.pan);
    else if (e.t === 'thud') thud(e.i, e.vn);
    else if (e.t === 'burst') burst(e.f, e.pan, e.k);
    else if (e.t === 'start') start();
    else if (e.t === 'fx') applyFx();
  }

  return {
    build, start, on,                                   // услышанного для картинки нет: вспышки — события модели (state.flashes)
    get strikes() { return strikes; }, get encounters() { return encounters; },
  };
}
