// Inferno — звук на обычных узлах (без worklet): шум сквозь банк резонаторов (как Rings, накормленный шумом).
// Круг — резонатор из трёх полос → перегруз → срез верха → уровень; шина: fire (tanh), smoke (тёмный зал T.hall()).
// События модели → узлы; метры — strikes, live; что услышано (listen): { strike: k } — удар прозвучал (угольки во view).
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

export function createEngine(T, model) {
  const { circ, fx } = model.state;
  const N = new Array(9).fill(null);                    // узлы резонатора круга — по требованию (circleNodes)
  let actx = null, bus = null, lastSound = 0, strikes = 0;
  const bufs = {}, listeners = [];

  function noiseBufs(ctx) {                            // шумы считаются один раз: белый, розовый, коричневый, треск, гранулы
    const n = ctx.sampleRate * 2, mk = () => ctx.createBuffer(1, n, ctx.sampleRate);
    const w = mk(), p = mk(), b = mk(), c = mk(), gr = mk(), burst = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.03), ctx.sampleRate);
    const W = w.getChannelData(0), P = p.getChannelData(0), B = b.getChannelData(0), C = c.getChannelData(0), G = gr.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, br = 0, cr = 0, env = 0, on = 0;
    for (let i = 0; i < n; i++) {
      const x = Math.random() * 2 - 1;
      W[i] = x * 0.5;
      b0 = 0.99765 * b0 + x * 0.099046; b1 = 0.963 * b1 + x * 0.2965164; b2 = 0.57 * b2 + x * 1.0526913;
      P[i] = (b0 + b1 + b2 + x * 0.1848) * 0.11;
      br = clamp(br + x * 0.02, -1, 1) * 0.998; B[i] = br * 1.6;
      if (Math.random() < 0.0015) cr = (Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random() * 0.6);
      cr *= 0.9; C[i] = cr;
      if (on <= 0 && Math.random() < 0.0004) on = Math.round(ctx.sampleRate * (0.01 + Math.random() * 0.03));
      env += ((on > 0 ? 1 : 0) - env) * 0.01; if (on > 0) on--;
      G[i] = x * env * 0.8;
    }
    const U = burst.getChannelData(0);
    for (let i = 0; i < U.length; i++) U[i] = (Math.random() * 2 - 1) * Math.exp(-i / (U.length * 0.25));
    Object.assign(bufs, { noise: [w, p, b, c, gr], burst });
  }
  const shapes = new Map();
  function curve(d) {                                   // tanh-перегруз, кеш по силе
    const key = Math.round(d * 10) / 10;
    if (shapes.has(key)) return shapes.get(key);
    const c = new Float32Array(1024), k = Math.tanh(key);
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; c[i] = Math.tanh(key * x) / k; }
    shapes.set(key, c);
    return c;
  }
  function build(ctx, input) {
    actx = ctx;
    noiseBufs(ctx);
    const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const inp = g(1), pre = g(0.6), fire = ctx.createWaveShaper(), out = g(1), smoke = g(0), smLP = ctx.createBiquadFilter(), h = T.hall();
    fire.oversample = '2x'; smLP.type = 'lowpass'; smLP.frequency.value = 1400;
    inp.connect(pre).connect(fire).connect(out);
    fire.connect(smoke).connect(smLP).connect(h.input); h.out.connect(g(0.9)).connect(out);
    bus = { inp, pre, fire, out, smoke, hall: h, input, live: false };
    N.fill(null);
    applyFx();
    for (let k = 0; k < 9; k++) if (circ[k].sinner) smoulder(k, true);
  }
  function setLive(on) {
    if (!bus || bus.live === on) return;
    bus.live = on;
    if (on) bus.out.connect(bus.input); else bus.out.disconnect();
  }
  setInterval(() => {                                   // 8 с тишины — шина отцеплена от выхода
    if (!bus) return;
    if (model.sounding()) lastSound = performance.now();
    else if (performance.now() - lastSound > 8000) setLive(false);
  }, 1000);
  function circleNodes(k) {                             // резонатор круга — по требованию: три полосы → перегруз → срез верха → уровень
    if (N[k]) return N[k];
    const c = circ[k], ctx = actx, g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const exc = g(1), sum = g(1), sh = ctx.createWaveShaper(), lp = ctx.createBiquadFilter(), vca = g(c.level);
    lp.type = 'lowpass'; lp.frequency.value = 9000 / (1 + k * 0.6);
    sh.curve = curve(1 + c.drive * 6);
    const bands = [0, 1, 2].map((j) => {
      const f = ctx.createBiquadFilter(), bg = g(0); f.type = 'bandpass';
      exc.connect(f).connect(bg).connect(sum);
      return { f, bg, w: [1, 0.6, 0.4][j] };
    });
    sum.connect(sh).connect(lp).connect(vca).connect(bus.inp);
    N[k] = { exc, bands, sh, lp, vca, src: null, sg: null };
    retune(k, true);
    return N[k];
  }
  function retune(k, now = false) {
    const c = circ[k], n = N[k];
    if (!n) return;
    const t = actx.currentTime, f0 = model.hzOf(k), q = model.Qof(c), rs = model.ratios(k);
    n.bands.forEach((b, j) => {
      const f = Math.min(18000, f0 * rs[j]), mk = Math.sqrt(q) * 0.5 * b.w;
      if (now) { b.f.frequency.value = f; b.f.Q.value = q; b.bg.gain.value = mk; } else {
        b.f.frequency.setTargetAtTime(f, t, 0.03); b.f.Q.setTargetAtTime(q, t, 0.05); b.bg.gain.setTargetAtTime(mk, t, 0.05);
      }
    });
    n.vca.gain.setTargetAtTime(c.level, t, 0.05);
    n.sh.curve = curve(1 + c.drive * 6);
  }
  function strike(k, vel = 1) {                         // удар: всплеск шума звенит в резонаторе круга
    if (!bus) return;
    setLive(true); lastSound = performance.now();
    const n = circleNodes(k), s = actx.createBufferSource(), gg = actx.createGain();
    s.buffer = bufs.burst; gg.gain.value = vel * 1.4;
    s.connect(gg).connect(n.exc); s.start();
    s.onended = () => { s.disconnect(); gg.disconnect(); };
    strikes++;
    for (const fn of listeners) fn({ strike: k });
  }
  function smoulder(k, on) {                            // тлеет: шум своего цвета идёт в резонатор, пока держишь (или горит грешник)
    if (!bus) return;
    const n = circleNodes(k), t = actx.currentTime;
    if (on) {
      setLive(true); lastSound = performance.now();
      if (n.src) return;
      const s = actx.createBufferSource(), sg = actx.createGain();
      s.buffer = bufs.noise[circ[k].color]; s.loop = true; s.loopStart = Math.random();
      sg.gain.value = 0; sg.gain.setTargetAtTime(0.5, t, 0.12);
      s.connect(sg).connect(n.exc); s.start(t, Math.random() * 1.5);
      n.src = s; n.sg = sg;
    } else if (n.src) {
      const s = n.src, sg = n.sg;
      sg.gain.setTargetAtTime(0, t, 0.15);
      s.stop(t + 1); s.onended = () => { s.disconnect(); sg.disconnect(); };
      n.src = null; n.sg = null;
    }
  }
  function recolor(k) { const n = N[k]; if (n && n.src) { smoulder(k, false); smoulder(k, true); } }
  function applyFx() {
    if (!bus) return;
    const t = actx.currentTime, k = 1 + fx.fire * 8;
    bus.fire.curve = curve(k);
    bus.pre.gain.setTargetAtTime(0.6, t, 0.05);
    bus.out.gain.setTargetAtTime(3 / (1 + fx.fire * 1.5), t, 0.05);   // ×3: вровень с планетами Tenebrae
    bus.smoke.gain.setTargetAtTime(fx.smoke * fx.smoke * 1.4, t, 0.05);
    for (const l of bus.hall.lines) l.g.gain.setTargetAtTime(10 ** ((-3 * l.len) / (1.5 + fx.smoke * 5)), t, 0.05);
    for (let i = 0; i < 9; i++) retune(i);
  }
  function on(e) {                                      // событие модели → узлы
    if (e.t === 'strike') strike(e.k, e.vel);
    else if (e.t === 'burn') smoulder(e.k, model.burning(e.k));
    else if (e.t === 'tune') retune(e.k);
    else if (e.t === 'color') recolor(e.k);
    else if (e.t === 'ice') { for (let k = 0; k < 9; k++) retune(k); }
    else if (e.t === 'fx') applyFx();
  }

  return {
    build, on,
    listen(fn) { listeners.push(fn); },
    get strikes() { return strikes; }, get live() { return !!(bus && bus.live); }, get bus() { return bus; },
  };
}
