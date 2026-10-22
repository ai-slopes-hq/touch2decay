// Natura — звук на обычных узлах (без worklet): нота — синус / меандр / треугольник / пила / sharp → фильтр с огибающей → срез дерева (hp) →
// хор (птицы) → задержка (облака) и зал (туман). Часы секвенсера — здесь: по ctx.currentTime, таймер 25 мс, запас 200 мс; что играет шаг — модель (stepNote).
// События модели → узлы; метры — phase (бегунок), has, skiff, live; что услышано (listen): { note: pd, at } — нота прозвучит в at (мс performance.now:
// утки), { played: i, at } — кувшинка i шага (лягушка, стрекозы).
const TAU = Math.PI * 2;
const LVL = [0.32, 0.13, 0.3, 0.15, 0.2];               // громкость волны (WAVES в model.js)

export function createEngine(T, model) {
  const S = model.state, { fx, seq } = S;
  let actx = null, bus = null, lastSound = 0, rustle = null, skiffV = null;
  const clock = { next: 0, step: 0 };                    // часы: когда следующий шаг (ctx.currentTime) и его номер
  const listeners = [];
  const heard = (e) => { for (const fn of listeners) fn(e); };

  function build(ctx, input) {
    actx = ctx;
    const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const vin = g(1), pre = g(1), out = g(1.2), chOut = g(0), hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 20; hp.Q.value = 0.9;   // тормошат дерево — срез вверх
    vin.connect(hp).connect(pre);
    const ch = [0, 1].map((k) => {                   // хор: две плавающие задержки
      const d = ctx.createDelay(0.05), l = ctx.createOscillator(), lg = g(0);
      d.delayTime.value = 0.012 + k * 0.007; l.frequency.value = 0.31 + k * 0.17;
      l.connect(lg).connect(d.delayTime); l.start(); hp.connect(d); d.connect(chOut);
      return { lg };
    });
    chOut.connect(pre); pre.connect(out);
    const dSend = g(0), dl = ctx.createDelay(4), dfb = g(0), dlp = ctx.createBiquadFilter();   // задержка — лента: время плывёт
    dlp.type = 'lowpass'; dlp.frequency.value = 2800;
    pre.connect(dSend).connect(dl); dl.connect(dlp).connect(dfb).connect(dl); dlp.connect(out);
    const rSend = g(0), h = T.hall();                 // зал — туман
    pre.connect(rSend).connect(h.input); h.out.connect(g(0.9)).connect(out);
    dlp.connect(rSend);
    bus = { vin, hp, chOut, ch, dSend, dl, dfb, rSend, hall: h, out, input, live: false, pre };
    setLive(true);
    applyFx();
  }
  // молчит дольше хвоста — мир отцеплен от выхода: его хор, задержка и зал не считаются (меньше нагрузки, нет треска)
  function setLive(on) {
    if (!bus || bus.live === on) return;
    bus.live = on;
    if (on) bus.out.connect(bus.input); else bus.out.disconnect();
  }
  setInterval(() => { if (bus && !seq.playing && performance.now() - lastSound > 9000) setLive(false); }, 1000);
  function applyFx() {
    if (!bus) return;
    const t = actx.currentTime, S = (p, v, tau = 0.05) => p.setTargetAtTime(v, t, tau);
    S(bus.chOut.gain, fx.chorus * 0.8);
    for (const c of bus.ch) S(c.lg.gain, 0.0015 + 0.0045 * fx.chorus);
    S(bus.dSend.gain, fx.delay * 0.7); S(bus.dfb.gain, 0.2 + 0.55 * fx.delay); S(bus.dl.delayTime, model.delaySec(), 0.15);
    S(bus.rSend.gain, fx.reverb * fx.reverb * 1.3);
    const tail = 1.5 + fx.reverb * 6;
    for (const l of bus.hall.lines) S(l.g.gain, 10 ** ((-3 * l.len) / tail));
  }
  let sharpPW = null;
  function setWave(o, w) {
    if (w === 4) {
      if (!sharpPW) {                                 // ряд Фурье для tanh(2.6·tri + 0.35), один раз
        const N = 2048, H = 48, re = new Float32Array(H), im = new Float32Array(H);
        const tri = (u) => 1 - 4 * Math.abs(((u + 0.25) % 1) - 0.5);
        for (let i = 0; i < N; i++) {
          const u = i / N, v = Math.tanh(2.6 * tri(u) + 0.35);
          for (let h = 1; h < H; h++) { re[h] += (v * Math.cos(TAU * h * u) * 2) / N; im[h] += (v * Math.sin(TAU * h * u) * 2) / N; }
        }
        sharpPW = actx.createPeriodicWave(re, im);
      }
      o.setPeriodicWave(sharpPW);
    } else o.type = ['sine', 'square', 'triangle', 'sawtooth'][w];
  }
  function playNote(v, t) {                          // v — нота от модели (voice / stepNote)
    const ctx = actx, o = ctx.createOscillator(), lp = ctx.createBiquadFilter(), a = ctx.createGain();
    setWave(o, v.wave);
    const hz = v.hz;
    if (v.from) { o.frequency.setValueAtTime(v.from, t); o.frequency.exponentialRampToValueAtTime(hz, t + v.glide); }   // глайд из прошлой ноты
    else o.frequency.setValueAtTime(hz, t);
    heard({ note: v.pd, at: performance.now() + (t - actx.currentTime) * 1000 });   // для уток: когда нота ударит
    const base = 180 * 2 ** (v.cutoff * 6.6), peak = Math.min(16000, base * 6), A = v.att, dec = v.rel / 2.5;
    lp.type = 'lowpass'; lp.Q.value = 0.7 + v.res * 16;   // резонанс — луч res (и горы)
    lp.frequency.setValueAtTime(base, t); lp.frequency.linearRampToValueAtTime(peak, t + A); lp.frequency.setTargetAtTime(base, t + A, 0.03 + dec * 0.6);
    const lvl = LVL[v.wave], end = t + A + dec * 5;
    // attack — подъём, release — спад до настоящей тишины раньше, чем генератор остановится, — без щелчка в конце
    a.gain.setValueAtTime(0, t); a.gain.linearRampToValueAtTime(lvl, t + A); a.gain.exponentialRampToValueAtTime(0.0001, end);
    a.gain.linearRampToValueAtTime(0, end + 0.01);
    o.connect(lp).connect(a).connect(bus.vin);
    o.start(t); o.stop(end + 0.03);
    lastSound = performance.now(); setLive(true);
    o.onended = () => { o.disconnect(); lp.disconnect(); a.disconnect(); };
  }
  // спугнули птиц — лазерный всплеск: меандр с падающим тоном сквозь резонансный фильтр, который тоже падает
  function laser() {
    if (!bus) return;
    const ctx = actx, t = ctx.currentTime, o = ctx.createOscillator(), lp = ctx.createBiquadFilter(), a = ctx.createGain();
    o.type = 'square'; o.frequency.setValueAtTime(2400, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.38);
    lp.type = 'lowpass'; lp.Q.value = 22; lp.frequency.setValueAtTime(9000, t); lp.frequency.exponentialRampToValueAtTime(260, t + 0.42);
    a.gain.setValueAtTime(0, t); a.gain.linearRampToValueAtTime(0.16, t + 0.004); a.gain.exponentialRampToValueAtTime(0.0001, t + 0.48); a.gain.linearRampToValueAtTime(0, t + 0.5);
    o.connect(lp).connect(a).connect(bus.pre);         // мимо среза дерева, но в хор, задержку и зал
    o.start(t); o.stop(t + 0.52);
    o.onended = () => { o.disconnect(); lp.disconnect(); a.disconnect(); };
    lastSound = performance.now(); setLive(true);
  }
  // шелест листвы, пока тормошат дерево; высокий срез — по тому, как сильно (shake затухает в модели)
  function shakeTick(shake) {
    if (!bus) return;
    const t = actx.currentTime;
    bus.hp.frequency.setTargetAtTime(20 * 2 ** (shake * 9), t, 0.05);
    if (shake > 0.03 && !rustle) {
      const n = actx.sampleRate, buf = actx.createBuffer(1, n, n), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      const src = actx.createBufferSource(), bp = actx.createBiquadFilter(), g = actx.createGain();
      src.buffer = buf; src.loop = true; bp.type = 'bandpass'; bp.frequency.value = 3500; bp.Q.value = 0.6; g.gain.value = 0;
      src.connect(bp).connect(g).connect(bus.pre); src.start();
      rustle = { src, g };
      setLive(true);
    }
    if (rustle) {
      rustle.g.gain.setTargetAtTime(Math.min(0.06, shake * 0.06), t, 0.05);
      if (shake < 0.01) { rustle.src.stop(); rustle.src.disconnect(); rustle = null; }
      else lastSound = performance.now();
    }
  }
  // голос кораблика: волна — последний выбранный цветок; поперёк реки — высота (с ладом по ступеням), вниз по течению — ярче
  function skiffSound(o) {                            // o = { t, q } или null — с воды
    if (!bus) return;
    const t = actx.currentTime;
    if (!o) {
      if (skiffV) { const v = skiffV; skiffV = null; v.a.gain.setTargetAtTime(0, t, 0.25); setTimeout(() => { v.o.stop(); v.o.disconnect(); v.lp.disconnect(); v.a.disconnect(); }, 2000); }
      return;
    }
    if (!skiffV) {
      const ctx = actx, osc = ctx.createOscillator(), lp = ctx.createBiquadFilter(), a = ctx.createGain();
      setWave(osc, S.lastWave); lp.type = 'lowpass'; a.gain.value = 0;
      osc.frequency.value = model.skiffHz(o.q); osc.connect(lp).connect(a).connect(bus.vin); osc.start();
      skiffV = { o: osc, lp, a };
      a.gain.setTargetAtTime(LVL[S.lastWave] * 0.82, t, 0.04);
    }
    const hz = model.skiffHz(o.q), v = skiffV;
    v.o.frequency.setTargetAtTime(hz, t, T.scaleOn ? 0.015 : 0.03);
    v.lp.Q.value = 0.7 + fx.res * 10;
    v.lp.frequency.setTargetAtTime(180 * 2 ** (fx.cutoff * 6.6) * (0.5 + 1.8 * o.t), t, 0.05);
    lastSound = performance.now(); setLive(true);
  }
  // лягушка квакает нотой своей кувшинки
  function croak(pd) {
    if (!bus || !pd) return;
    const ctx = actx, t = ctx.currentTime, hz = model.noteHz(pd.note), o = ctx.createOscillator(), bp = ctx.createBiquadFilter(), a = ctx.createGain(), am = ctx.createOscillator(), amg = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(hz, t); o.frequency.linearRampToValueAtTime(hz * 0.92, t + 0.3);
    bp.type = 'bandpass'; bp.frequency.value = hz * 3; bp.Q.value = 4;
    am.frequency.value = 28; am.connect(amg.gain); amg.gain.value = 0;   // кваканье — дрожь громкости ~28 Гц
    a.gain.setValueAtTime(0, t); a.gain.linearRampToValueAtTime(0.22, t + 0.02); a.gain.exponentialRampToValueAtTime(0.0001, t + 0.32); a.gain.linearRampToValueAtTime(0, t + 0.33);
    const trem = ctx.createGain(); trem.gain.value = 0.5; am.connect(trem.gain);
    o.connect(bp).connect(a).connect(trem).connect(bus.vin);
    o.start(t); am.start(t); o.stop(t + 0.35); am.stop(t + 0.35);
    o.onended = () => { for (const n of [o, bp, a, am, amg, trem]) n.disconnect(); };
    lastSound = performance.now(); setLive(true);
  }

  // часы — по звуковому времени с запасом вперёд (таймер 25 мс, окно 200 мс)
  function schedule() {
    if (!seq.playing || !actx) return;
    const now = actx.currentTime, ahead = now + 0.2;     // запас 200 мс: телефон занят картинкой — ноты всё равно вовремя
    if (!clock.next) clock.next = now + 0.05;
    while (clock.next < ahead) {
      if (clock.next > now + 0.003) {                    // опоздавшую ноту пропускаем — задним числом она щёлкает; пауза и chance — в модели
        const v = model.stepNote(clock.step);
        if (v) { playNote(v, clock.next); heard({ played: v.i, at: performance.now() + (clock.next - now) * 1000 }); }
      }
      clock.step++; clock.next += model.stepSec();
    }
  }
  setInterval(schedule, 25);
  const phase = () => (seq.playing && actx && clock.next ? Math.max(0, clock.step - (clock.next - actx.currentTime) / model.stepSec()) : null);

  function on(e) {                                       // событие модели → узлы
    if (e.t === 'play') { clock.step = 0; clock.next = 0; if (e.on) schedule(); }
    else if (e.t === 'fx') applyFx();
    else if (e.t === 'hear') { if (bus) playNote(model.voice(e.pd), actx.currentTime); }
    else if (e.t === 'shake') shakeTick(e.v);
    else if (e.t === 'skiff') skiffSound(e.o);
    else if (e.t === 'wave') { if (skiffV) setWave(skiffV.o, e.w); }
    else if (e.t === 'laser') laser();
    else if (e.t === 'croak') croak(e.pd);
  }

  return {
    build, on, phase, clock,
    listen(fn) { listeners.push(fn); },
    get has() { return !!actx; }, get skiff() { return !!skiffV; }, get live() { return !!(bus && bus.live); }, get bus() { return bus; },
  };
}
