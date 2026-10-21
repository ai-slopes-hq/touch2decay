// Monochordum — мир VII, монохорд мира Роберта Фладда (1617): струны натянуты от Земли (внизу) к руке Бога в облаке (вверху).
// Звук — физическое моделирование струны (Карплус — Стронг в monochord-worklet.js). Четыре струны; на каждой — подставка:
// звучит часть от подставки вверх, к колкам. Подставка внизу — вся струна, основной тон; выше — короче и выше, до двух октав,
// как у Фладда: нижняя октава — стихии и планеты до Солнца (diapason materialis), верхняя — до Эмпирея (diapason formalis).
// Подставка прилипает к пифагоровым ладам (с ладом — к ступеням лада). Тап по звучащей части — щипок (у края — ярко, в середине —
// мягко); провёл поперёк струны — смычок (сила — скорость пальца); двойной тап — струна поёт сама, как Эолова арфа; держишь
// струну — плашка: яркость, затухание, громкость. FX: wind (ветер из облака — все струны поют), decay, brightness, body (дека), hall.
// Рука Бога в облаке — в правом верхнем углу (к центру карты): тап — карта.
(() => {
  'use strict';
  const T = window.T2D;
  const TAU = Math.PI * 2;
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const N = 4, F_OPEN = [55, 82.5, 110, 165];             // открытые струны: A1, E2, A2, E3 — квинты и октавы
  const NOTES = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];
  // пифагоровы лады (доля звучащей длины) и сферы Фладда: нижняя октава — Terra…Sol, верхняя — до Эмпирея
  const MARKS = [
    [1, 'Terra'], [8 / 9, 'Aqua'], [64 / 81, 'Aer'], [3 / 4, 'Ignis'], [2 / 3, 'Luna'], [16 / 27, 'Mercurius'], [128 / 243, 'Venus'], [1 / 2, 'Sol'],
    [4 / 9, 'Mars'], [32 / 81, 'Iuppiter'], [3 / 8, 'Saturnus'], [1 / 3, 'Stellae'], [8 / 27, 'Crystallinum'], [1 / 4, 'Empyreum'],
  ];
  const INTERVALS = [[1, 1 / 2, 'diapason'], [1, 2 / 3, 'diapente'], [2 / 3, 1 / 2, 'diatessaron'], [1 / 2, 1 / 4, 'diapason'], [1 / 2, 1 / 3, 'diapente']];
  const RATIO_NAMES = new Map([[1, '1 : 1'], [8 / 9, '9 : 8 · tonus'], [3 / 4, '4 : 3 · diatessaron'], [2 / 3, '3 : 2 · diapente'], [1 / 2, '2 : 1 · diapason'], [1 / 3, '3 : 1'], [1 / 4, '4 : 1 · disdiapason']]);

  // ---------- состояние ----------
  const str = F_OPEN.map((f, i) => ({ r: [1, 2 / 3, 1 / 2, 1 / 3][i], sus: false, bright: 0.55, decay: 0.55, level: 0.8, en: 0, bow: 0, eh: 0, hn: 2 }));
  const NODES = [[1 / 2, 2], [1 / 3, 3], [2 / 3, 3], [1 / 4, 4], [3 / 4, 4]];   // узлы флажолетов на звучащей части
  const fx = { decay: 0.55, bright: 0.55, body: 0.4, sympathy: 0.4, chorus: 0, chance: 1, hall: 0.35 };
  let wind = 0, lastWind = 0.5;                            // ветер — часть патча (корзина глушит), не FX: голова ветра слева
  const tonic = () => (T.scaleOn ? 2 ** (T.scaleRoot / 12) : 1);
  const hzOf = (i) => (F_OPEN[i] * tonic()) / str[i].r;
  const noteOf = (f) => { const m = Math.round(12 * Math.log2(f / 55)); return `${NOTES[((m % 12) + 12) % 12]}${Math.floor((m + 9) / 12) + 1}`; };

  // ---------- геометрия: длинный ящик монохорда по центру, струны сверху вниз; слева — сферы, справа — дуги интервалов ----------
  function geo() {
    const W = T.W, H = T.H, top = T.topY + 6, bot = H - T.safeBot - 8, Ws = Math.min(W, (H - T.safeBot) * 0.62), cx = W / 2;
    const y0 = top + 40, y1 = bot - 64, sp = Math.min(44, Ws * 0.11);   // y0 — колки (рука Бога), y1 — нижний порожек (Земля)
    const xs = Array.from({ length: N }, (_, i) => cx + (i - (N - 1) / 2) * sp);
    const box = { x0: xs[0] - sp * 0.7, x1: xs[N - 1] + sp * 0.7 }, ye = y0 + 0.25 * (y1 - y0);   // ye — Эмпирей, верхний лад
    const r = Math.max(28, Math.min(60, (W - box.x1) * 0.36)), hx = Math.min(box.x1 + (W - box.x1) / 2, box.x1 + r * 1.7);
    const ar = Math.max(16, Math.min(28, box.x0 * 0.3)), aeolus = { x: Math.max(ar * 1.3, box.x0 - ar * 2.4), y: y0 + (ye - y0) * 0.55, r: ar };   // роза ветров — слева над Эмпиреем
    return { W, H, Ws, top, bot, cx, y0, y1, xs, sp, box, hand: { x: hx, y: y0 + (ye - y0) * 0.45, r }, aeolus };   // облако — справа над дугами интервалов
  }
  const yOfR = (G, r) => G.y0 + r * (G.y1 - G.y0);       // подставка: звучит от колков (y0) до неё
  const rOfY = (G, y) => clamp((y - G.y0) / (G.y1 - G.y0), 0.25, 1);
  function snapR(r) {                                     // с ладом — к ступеням лада; без — прилипает к пифагоровым ладам
    if (T.scaleOn) { const s0 = -12 * Math.log2(r), s = T.snapSemi(Math.round(s0)); return clamp(2 ** (-s / 12), 0.25, 1); }
    for (const [m] of MARKS) if (Math.abs(Math.log2(r / m)) < 0.025) return m;
    return r;
  }
  function stringAt(G, x, y) {
    if (y < G.y0 - 10 || y > G.y1 + 14) return -1;
    let best = -1, bd = G.sp / 2 + 4;
    G.xs.forEach((sx, i) => { const d = Math.abs(x - sx); if (d < bd) { bd = d; best = i; } });
    return best;
  }

  // ---------- звук ----------
  let actx = null, node = null, bus = null, ready = false, lastSound = 0;
  const queue = [];
  const send = (m) => { if (node && ready) node.port.postMessage(m); else queue.push(m); };
  const VER = (document.currentScript && new URL(document.currentScript.src, location.href).searchParams.get('v')) || '0';
  function retune(i) { const s = str[i]; send({ t: 'tune', i, f: hzOf(i), bright: clamp(s.bright * 0.5 + fx.bright * 0.5), decay: clamp(s.decay * 0.5 + fx.decay * 0.5), level: s.level }); }
  function build(ctx, input) {
    actx = ctx;
    const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const pre = g(1), mix = g(1), out = g(2.2), body = g(0), hallSend = g(0), h = T.hall();   // струны → (сухо + дека) → mix → выход; mix → зал → выход
    pre.connect(mix);
    const bands = [[190, 3], [420, 4], [1100, 5]].map(([f, q]) => { const b = ctx.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f; b.Q.value = q; pre.connect(b).connect(body); return b; });
    const post = g(1);                                    // mix → (сухо + хор) → post → выход и зал
    body.connect(mix); mix.connect(post); post.connect(out); post.connect(hallSend); hallSend.connect(h.input); h.out.connect(g(0.9)).connect(out);
    bus = { pre, mix, post, out, body, hallSend, hall: h, input, live: false, bands, ch: null };
    ready = false; node = null; started = false;
    applyFx();
  }
  // модуль струн — только когда в Monochordum впервые зашли: тем, кто сюда не заглядывает, он ничего не стоит
  let started = false;
  function start() {
    if (started || !actx) return;
    started = true;
    const ctx = actx;
    ctx.audioWorklet.addModule(`monochord-worklet.js?v=${VER}`).then(() => {
      node = new AudioWorkletNode(ctx, 'monochord', { numberOfInputs: 0, outputChannelCount: [2] });
      node.connect(bus.pre);
      node.port.onmessage = (e) => { const d = e.data; if (d.t === 'energy') d.e.forEach((v, i) => { str[i].en = v; str[i].eh = d.h[i]; if (d.n) str[i].hn = d.n[i]; }); };
      ready = true;
      for (let i = 0; i < N; i++) { retune(i); if (str[i].sus) send({ t: 'sus', i, on: true }); }
      send({ t: 'wind', amt: wind });
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
    if (sounding() || str.some((s) => s.en > 0.002)) lastSound = performance.now();
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
  function setWind(v) {
    wind = clamp(v); if (wind > 0.01) lastWind = wind;
    send({ t: 'wind', amt: wind });
    if (wind > 0.01) { start(); setLive(true); lastSound = performance.now(); }
  }
  const sounding = () => wind > 0.01 || auto.on || str.some((s) => s.sus || s.bow > 0);
  // ---------- автострам: Земля вращается в темпе, её горы задевают струны ----------
  const DIVS = [[1, '1/4'], [2, '1/8'], [3, '1/8T'], [4, '1/16']], PATTERNS = ['down', 'down-up', 'arpeggio', 'random'];
  const auto = { on: false, bpm: 90, div: 1, pattern: 1, strength: 0.6, swing: 0, next: 0, step: 0, rot: 0, hitAt: 0 };
  const stepSec = () => 60 / auto.bpm / DIVS[auto.div][0];
  function strumAt(t, step) {                             // одно касание Земли: струны по очереди, с промежутком
    const p = auto.pattern, up = p === 1 && step % 2 === 1, acc = step % (DIVS[auto.div][0] * 4) === 0 ? 1.15 : 1, vel = clamp(auto.strength * acc, 0.15, 1);
    let order = up ? [3, 2, 1, 0] : [0, 1, 2, 3];
    if (p === 2) order = [step % 4];
    if (p === 3) order = [0, 1, 2, 3].filter(() => Math.random() < 0.55);
    const gap = 0.006 + 0.018 * (1 - auto.strength);
    order.forEach((i, k) => send({ t: 'pluck', i, pos: 0.12 + 0.1 * Math.random(), vel: vel * (0.85 + 0.15 * Math.random()), at: t + k * gap }));
    setTimeout(() => { auto.hitAt = performance.now(); }, Math.max(0, (t - actx.currentTime) * 1000));
  }
  function autoSchedule() {
    if (!auto.on || !actx || !ready) return;
    const now = actx.currentTime, ahead = now + 0.2;
    if (!auto.next) auto.next = now + 0.05;
    while (auto.next < ahead) {
      if (auto.next > now + 0.003 && Math.random() < fx.chance) strumAt(auto.next, auto.step);   // chance — у автострама
      const sw = auto.step % 2 === 0 ? 1 + auto.swing * 0.5 : 1 - auto.swing * 0.5;   // swing: чётные длиннее
      auto.step++; auto.next += stepSec() * sw;
    }
  }
  setInterval(autoSchedule, 25);
  function setAuto(on) { auto.on = on; auto.next = 0; auto.step = 0; if (on) { start(); setLive(true); lastSound = performance.now(); } }
  function earthSheet() {
    T.openSheet({
      title: 'terra', hint: 'the earth strums — tap outside to close',
      rows: [{ key: 'bpm', label: 'tempo' }, { key: 'div', label: 'rate' }, { key: 'pattern', label: 'pattern' }, { key: 'strength', label: 'strength' }, { key: 'swing', label: 'swing' }],
      lfo: { id: 'mono-earth', keys: ['strength', 'swing'], shapes: 'classic' },
      get: (k) => (k === 'bpm' ? (auto.bpm - 40) / 160 : k === 'div' ? (auto.div + 0.5) / 4 : k === 'pattern' ? (auto.pattern + 0.5) / 4 : auto[k]),
      set: (k, v) => {
        if (k === 'bpm') { auto.bpm = Math.round(40 + v * 160); T.tempoFrom(7, auto.bpm); } else if (k === 'div') auto.div = Math.min(3, Math.floor(v * 4)); else if (k === 'pattern') auto.pattern = Math.min(3, Math.floor(v * 4)); else auto[k] = v;
      },
      text: (k) => (k === 'bpm' ? `${auto.bpm} bpm` : k === 'div' ? DIVS[auto.div][1] : k === 'pattern' ? PATTERNS[auto.pattern] : `${Math.round(auto[k] * 100)}%`),
    });
  }
  function pluck(i, pos, vel = 0.9) { start(); setLive(true); lastSound = performance.now(); send({ t: 'pluck', i, pos, vel }); }

  // ---------- касания ----------
  const touches = new Map();
  let lastTap = null;
  function down(f) {
    start();
    const A = geo().aeolus;
    if (Math.hypot(f.x - A.x, f.y - A.y) < A.r * 1.5) { touches.set(f.id, { kind: 'wind', y0: f.y, w0: wind, moved: false, t0: performance.now() }); return; }   // голова ветра: вверх — сильнее, тап — вкл/выкл
    const G = geo(), i = stringAt(G, f.x, f.y), now = performance.now(), E = earthG(G);
    if (f.y > G.y1 + 16 && Math.abs(f.x - E.x) < E.r + 10 && f.y > E.y - E.r - 16) { touches.set(f.id, { kind: 'earth', t0: now, moved: false }); return; }   // Земля: тап — автострам, держишь — плашка
    const free = () => touches.set(f.id, f.y > G.y0 - 10 && f.y < G.y1 + 14 ? { kind: 'strum', px: f.x, lt: now } : { kind: 'none' });   // мимо струн — можно начать страм
    if (i < 0) { free(); return; }
    const yb = yOfR(G, str[i].r);
    if (Math.abs(f.y - yb) < 20) { touches.set(f.id, { kind: 'bridge', i, x0: f.x, y0: f.y }); return; }   // подставка — высота
    if (f.y > yb) { free(); return; }                     // ниже подставки струна заглушена
    if (lastTap && lastTap.i === i && now - lastTap.t < T.DTAP_MS) {   // двойной тап — струна поёт сама (Эолова)
      lastTap = null; str[i].sus = !str[i].sus; send({ t: 'sus', i, on: str[i].sus }); if (str[i].sus) { setLive(true); lastSound = now; }
      touches.set(f.id, { kind: 'none' }); return;
    }
    lastTap = { i, t: now };
    const nd = NODES.find(([u]) => Math.abs(f.y - (G.y0 + u * (yb - G.y0))) < 7);
    if (nd) { start(); setLive(true); lastSound = now; send({ t: 'harm', i, n: nd[1], vel: 0.9 }); }   // тап на узле — флажолет
    else pluck(i, (f.y - G.y0) / Math.max(10, yb - G.y0));
    touches.set(f.id, { kind: 'string', i, x0: f.x, y0: f.y, x: f.x, y: f.y, t0: now, lx: f.x, lt: now, moved: false, px: f.x });
  }
  const BOW_WAIT = 150;                                   // мс: столько палец решает — смычок или страм
  function strum(t, f, G) {                               // страм: каждая струна, которую палец пересёк выше её подставки, — щипок; сила — скорость
    const now = performance.now(), a = Math.min(t.px, f.x), b = Math.max(t.px, f.x), v = (b - a) / Math.max(8, now - (t.st || t.lt));
    let hit = false;
    G.xs.forEach((sx, i) => {
      if (sx <= a || sx > b || (t.kind === 'string' && i === t.i && !t.strum)) return;
      const yb = yOfR(G, str[i].r);
      if (f.y > yb - 4 || f.y < G.y0 - 10) return;
      pluck(i, (f.y - G.y0) / Math.max(10, yb - G.y0), clamp(0.35 + v * 0.6, 0.3, 1)); hit = true;
    });
    t.px = f.x; t.st = now;
    return hit;
  }
  function move(f) {
    const t = touches.get(f.id);
    if (!t || t.kind === 'none' || t.sheet) return;
    if (t.kind === 'wind') { if (t.sheet) return; if (Math.abs(f.y - t.y0) > 6) t.moved = true; if (t.moved) setWind(t.w0 + (t.y0 - f.y) / 140); return; }
    const G = geo();
    if (t.kind === 'bridge') { const s = str[t.i]; s.r = snapR(rOfY(G, f.y)); retune(t.i); t.y = f.y; return; }
    if (t.kind === 'strum') { strum(t, f, G); return; }
    if (strum(t, f, G) || t.strum) {                      // ушёл на соседнюю струну — это уже страм, смычок снят
      if (!t.strum) { t.strum = true; const s = str[t.i]; if (s.bow > 0) { s.bow = 0; send({ t: 'bow', i: t.i, amp: 0 }); } }
      t.moved = true; t.x = f.x; t.y = f.y; return;
    }
    t.x = f.x; t.y = f.y;
    if (!t.moved && Math.hypot(f.x - t.x0, f.y - t.y0) > 8) t.moved = true;
    if (t.moved) {                                        // поперёк струны — смычок: сила — скорость пальца
      const now = performance.now(), dx = f.x - t.lx, v = Math.abs(dx) / Math.max(8, now - t.lt);
      t.lx = f.x; t.lt = now;
      if (!t.bowing) {                                    // смычок — только если задержался у струны или повёл назад; быстро ушёл к соседней — это страм
        const turn = t.dir && dx && Math.sign(dx) !== t.dir;
        if (!t.dir && Math.abs(dx) > 1) t.dir = Math.sign(dx);
        if (!turn && now - t.t0 < BOW_WAIT) return;
        t.bowing = true;
      }
      const s = str[t.i]; s.bow = clamp(v * 1.4); send({ t: 'bow', i: t.i, amp: s.bow }); setLive(true); lastSound = now;
    }
  }
  function up(f) {
    const t = touches.get(f.id);
    touches.delete(f.id);
    if (t && t.kind === 'wind' && !t.moved && !t.sheet) setWind(wind > 0.01 ? 0 : lastWind);
    if (t && t.kind === 'earth' && !t.sheet) setAuto(!auto.on);
    if (t && t.kind === 'string' && str[t.i].bow > 0) { str[t.i].bow = 0; send({ t: 'bow', i: t.i, amp: 0 }); }
  }
  function windSheet() {                                  // держишь розу ветров — плашка ветра; «~» со случайной формой — порывы
    T.openSheet({
      title: 'ventus', hint: 'wind — tap outside to close', rows: [{ key: 'wind', label: 'wind' }],
      lfo: { id: 'mono-wind', keys: ['wind'], shapes: 'random' },
      get: () => wind, set: (k, v) => setWind(v), text: () => (wind > 0.01 ? `${Math.round(wind * 100)}%` : 'calm'),
    });
  }
  function tick(now) {
    for (const t of touches.values()) if (t.kind === 'earth' && !t.sheet && now - t.t0 > T.HOLD_MS) { t.sheet = true; earthSheet(); }
    for (const t of touches.values()) if (t.kind === 'wind' && !t.moved && !t.sheet && now - t.t0 > T.HOLD_MS) { t.sheet = true; windSheet(); }
    for (const t of touches.values()) {
      if (t.kind !== 'string' || t.moved) continue;
      const s = str[t.i];
      if (s.bow > 0 && now - t.lt > 120) { s.bow *= 0.8; send({ t: 'bow', i: t.i, amp: s.bow }); }
    }
  }
  function stringSheet(i) {
    const s = str[i];
    T.openSheet({
      title: `chorda ${['I', 'II', 'III', 'IV'][i]}`, hint: 'string — tap outside to close',
      rows: [{ key: 'pitch', label: 'pitch' }, { key: 'bright', label: 'brightness' }, { key: 'decay', label: 'decay' }, { key: 'level', label: 'level' }],
      lfo: { id: `mono-s${i}`, keys: ['pitch', 'bright', 'decay', 'level'], shapes: 'classic' },   // «~» на pitch — вибрато подставки
      get: (k) => (k === 'pitch' ? Math.log2(1 / s.r) / 2 : s[k]),
      set: (k, v) => { if (k === 'pitch') s.r = clamp(2 ** (-2 * v), 0.25, 1); else s[k] = v; retune(i); },
      text: (k) => (k === 'pitch' ? noteOf(hzOf(i)) : `${Math.round(s[k] * 100)}%`),
    });
  }

  // ---------- рисование ----------
  let wallC = null, wallKey = '';
  function wall(G) {                                      // ящик монохорда, лады, сферы слева, дуги интервалов справа, Земля внизу
    const key = `${G.W}x${G.H}x${T.DPR}|${G.y0}|${G.y1}`;
    if (wallC && key === wallKey) return wallC;
    wallKey = key;
    wallC = document.createElement('canvas');
    wallC.width = Math.round(G.W * T.DPR); wallC.height = Math.round(G.H * T.DPR);
    const x = wallC.getContext('2d');
    x.setTransform(T.DPR, 0, 0, T.DPR, 0, 0);
    x.fillStyle = T.BG; x.fillRect(0, 0, G.W, G.H);
    const ink = (a) => `rgba(237,237,237,${a})`, B = G.box;
    x.strokeStyle = ink(0.6); x.lineWidth = 1; x.strokeRect(B.x0 + 0.5, G.y0 - 18.5, B.x1 - B.x0, G.y1 - G.y0 + 40);
    x.strokeStyle = ink(0.2); x.strokeRect(B.x0 + 4.5, G.y0 - 14.5, B.x1 - B.x0 - 8, G.y1 - G.y0 + 32);
    const ry = G.y1 - (G.y1 - G.y0) * 0.12, rr = (B.x1 - B.x0) * 0.22;   // розетка — голосник деки
    x.strokeStyle = ink(0.35); x.beginPath(); x.arc(G.cx, ry, rr, 0, TAU); x.stroke(); x.beginPath(); x.arc(G.cx, ry, rr * 0.7, 0, TAU); x.stroke();
    for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; x.beginPath(); x.arc(G.cx + Math.cos(a) * rr * 0.45, ry + Math.sin(a) * rr * 0.45, rr * 0.25, 0, TAU); x.stroke(); }
    x.font = `italic 11px ${T.MAP}`; x.textBaseline = 'middle';
    MARKS.forEach(([r, name], j) => {                   // лады: засечки поперёк ящика, слева — сферы
      const y = yOfR(G, r), major = [1, 3 / 4, 2 / 3, 1 / 2, 1 / 3, 1 / 4].includes(r);
      x.strokeStyle = ink(major ? 0.45 : 0.2); x.beginPath(); x.moveTo(B.x0, y + 0.5); x.lineTo(B.x0 - (major ? 10 : 5), y + 0.5); x.moveTo(B.x1, y + 0.5); x.lineTo(B.x1 + (major ? 10 : 5), y + 0.5); x.stroke();
      x.fillStyle = ink(r === 1 / 2 || r === 1 || r === 1 / 4 ? 0.7 : 0.42); x.textAlign = 'right'; x.fillText(name, B.x0 - 14, y);
      if (j === 7) { x.strokeStyle = ink(0.3); x.setLineDash([2, 4]); x.beginPath(); x.moveTo(B.x0, y + 0.5); x.lineTo(B.x1, y + 0.5); x.stroke(); x.setLineDash([]); }   // Солнце — середина: граница двух октав
    });
    INTERVALS.forEach(([a, b, name], k) => {             // дуги интервалов справа, как у Фладда
      const ya = yOfR(G, a), yb = yOfR(G, b), off = 16 + (k % 3) * 14, xr = B.x1 + off;
      x.strokeStyle = ink(0.35); x.beginPath(); x.moveTo(B.x1 + 4, ya); x.quadraticCurveTo(xr + 18, (ya + yb) / 2, B.x1 + 4, yb); x.stroke();
      x.save(); x.translate(xr + 8, (ya + yb) / 2); x.rotate(-Math.PI / 2); x.textAlign = 'center'; x.fillStyle = ink(0.45); x.font = `italic 10px ${T.MAP}`; x.fillText(name, 0, 0); x.restore();
    });
    return wallC;
  }
  function drawHand(c, G, now) {                          // облако справа от колков, из него — рука Бога, держит колок крайней струны
    const { x: hx, y: hy, r } = G.hand, K = 11, pts = [];
    for (let k = 0; k < K; k++) { const a = (k / K) * TAU, q = 1 + 0.12 * Math.sin(k * 2.7); pts.push([hx + Math.cos(a) * r * q, hy + Math.sin(a) * r * 0.62 * q]); }
    const scallop = (P, push) => { c.beginPath(); c.moveTo(P[0][0], P[0][1]); for (let k = 0; k < P.length; k++) { const p0 = P[k], p1 = P[(k + 1) % P.length], mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2; c.quadraticCurveTo(hx + (mx - hx) * push, hy + (my - hy) * push, p1[0], p1[1]); } c.closePath(); };
    const px = G.xs[N - 1], py = G.y0 - 8, sx = hx - r * 0.75, sy = hy - r * 0.05;   // рука: рукав из облака к колку, манжета, кисть обхватывает колок
    const ax = px + 22, ay = py + 2, nx = -(ay - sy), ny = ax - sx, nl = Math.hypot(nx, ny), ux = nx / nl, uy = ny / nl, wv = 6;
    const mx = (sx + ax) / 2 + 10, my = (sy + ay) / 2 + 4;
    c.lineWidth = 1; c.strokeStyle = T.ink(0.8); c.fillStyle = T.BG;
    c.beginPath(); c.moveTo(sx + ux * wv, sy + uy * wv); c.quadraticCurveTo(mx + ux * wv, my + uy * wv, ax + ux * wv * 0.7, ay + uy * wv * 0.7);
    c.lineTo(ax - ux * wv * 0.7, ay - uy * wv * 0.7); c.quadraticCurveTo(mx - ux * wv, my - uy * wv, sx - ux * wv, sy - uy * wv); c.closePath(); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(ax + ux * wv * 0.9, ay + uy * wv * 0.9); c.lineTo(ax - ux * wv * 0.9, ay - uy * wv * 0.9); c.stroke();   // манжета
    c.beginPath(); c.ellipse(px + 13, py + 2, 8, 6, 0.3, 0, TAU); c.fill(); c.stroke();                        // кисть
    c.strokeStyle = T.ink(0.85); c.beginPath();                                                                 // пальцы на колке
    for (let k = 0; k < 3; k++) { const y = py - 2 + k * 3; c.moveTo(px + 8, y); c.quadraticCurveTo(px + 1, y - 2.5, px - 3, y + 1); }
    c.stroke();
    c.strokeStyle = T.ink(0.8); c.fillStyle = T.BG; scallop(pts, 1.55); c.fill(); c.stroke();
    c.strokeStyle = T.ink(0.18); scallop(pts.map(([x, y]) => [hx + (x - hx) * 0.6, hy + (y - hy) * 0.6 + r * 0.1]), 1.4); c.stroke();
  }
  let roseA = 0, roseT = 0;
  function drawAeolus(c, G, now, held) {                  // роза ветров, как на старых картах: с ветром крутится и дует струями на струны
    const { x, y, r } = G.aeolus, w = wind, dt = roseT ? Math.min(0.1, (now - roseT) / 1000) : 0;
    roseT = now; roseA += dt * w * 1.6;
    c.lineWidth = 1; c.fillStyle = T.BG;
    c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
    c.strokeStyle = T.ink(held ? 0.95 : 0.7); c.beginPath(); c.arc(x, y, r, 0, TAU); c.stroke();
    c.strokeStyle = T.ink(0.3); c.beginPath(); c.arc(x, y, r - 3, 0, TAU); c.stroke();
    c.strokeStyle = T.ink(0.45); c.beginPath();                                           // деления по кругу — 32 румба
    for (let k = 0; k < 32; k++) { const a = (k / 32) * TAU + roseA, l = k % 4 ? 2 : 4; c.moveTo(x + Math.cos(a) * (r - 3), y + Math.sin(a) * (r - 3)); c.lineTo(x + Math.cos(a) * (r - 3 - l), y + Math.sin(a) * (r - 3 - l)); }
    c.stroke();
    const ray = (a, len, wd, al) => {                    // луч розы: ромб, одна половина залита, другая — контур
      const tx = x + Math.cos(a) * len, ty = y + Math.sin(a) * len, l1 = a - Math.PI / 2, l2 = a + Math.PI / 2;
      const ax = x + Math.cos(l1) * wd, ay = y + Math.sin(l1) * wd, bx = x + Math.cos(l2) * wd, by = y + Math.sin(l2) * wd;
      c.fillStyle = T.ink(al); c.beginPath(); c.moveTo(x, y); c.lineTo(ax, ay); c.lineTo(tx, ty); c.closePath(); c.fill();
      c.fillStyle = T.BG; c.beginPath(); c.moveTo(x, y); c.lineTo(bx, by); c.lineTo(tx, ty); c.closePath(); c.fill();
      c.strokeStyle = T.ink(al); c.beginPath(); c.moveTo(ax, ay); c.lineTo(tx, ty); c.lineTo(bx, by); c.stroke();
    };
    for (let k = 0; k < 4; k++) ray(roseA + Math.PI / 4 + (k * Math.PI) / 2, r * 0.55, r * 0.13, 0.55);   // короткие — между сторонами света
    for (let k = 0; k < 4; k++) ray(roseA + (k * Math.PI) / 2, r * 0.86, r * 0.17, 0.85);                  // длинные — стороны света
    c.fillStyle = T.BG; c.beginPath(); c.arc(x, y, r * 0.09, 0, TAU); c.fill(); c.strokeStyle = T.ink(0.85); c.stroke();
    if (w > 0.01) {                                       // струи ветра от розы к струнам: длиннее, ярче и быстрее с силой
      const mx = x + r + 4, len = (G.box.x1 - mx) * (0.35 + 0.65 * w);
      c.strokeStyle = T.ink(0.12 + 0.45 * w); c.lineWidth = 1; c.beginPath();
      for (let k = -2; k <= 2; k++) {
        const ph = (now * 0.0004 * (1 + w * 3) + (k + 2) * 0.23) % 1, sl = k * 0.09, x0 = mx + ph * len * 0.6, y0 = y + k * 6 + Math.tan(sl) * (x0 - mx);
        c.moveTo(x0, y0); c.bezierCurveTo(x0 + 14, y0 - 4, x0 + 22, y0 + 4, x0 + 30 + 20 * w, y0 + Math.tan(sl) * 30);
      }
      c.stroke();
    }
    if (held) T.mapText(`ventus · ${Math.round(w * 100)}%`, x, y + r + 14, 12, 0.8, 'center');
  }
  const earthG = (G) => ({ x: G.cx, y: G.y1 + 96, r: Math.min(70, G.Ws * 0.2) });   // Земля внизу: верх шара с горами
  let earthT = 0;
  function drawEarth(c, G, now) {                         // автострам вкл — Земля вращается, горы бегут; удар — вспыхивает горизонт
    const E = earthG(G), dt = earthT ? Math.min(0.1, (now - earthT) / 1000) : 0;
    earthT = now;
    if (auto.on) auto.rot += dt * (auto.bpm / 60) * 0.6;
    const hit = clamp(1 - (now - auto.hitAt) / 220);
    c.lineWidth = 1; c.strokeStyle = T.ink(auto.on ? 0.75 + 0.25 * hit : 0.5); c.beginPath(); c.arc(E.x, E.y, E.r, Math.PI * 1.08, Math.PI * 1.92); c.stroke();
    if (auto.on) { c.strokeStyle = T.ink(0.25); c.beginPath(); c.arc(E.x, E.y, E.r + 4, Math.PI * 1.08, Math.PI * 1.92); c.stroke(); }
    c.strokeStyle = T.ink(auto.on ? 0.6 : 0.3); c.beginPath();
    for (let k = 0; k < 14; k++) {                         // горы на шаре: при вращении ползут слева направо
      const a = Math.PI * 1.1 + ((((k / 14 + auto.rot * 0.15) % 1) + 1) % 1) * Math.PI * 0.8, px = E.x + Math.cos(a) * E.r, py = E.y + Math.sin(a) * E.r, h = 5 + (k % 3) * 2;
      const nx = Math.cos(a), ny = Math.sin(a), tx = -ny, ty = nx;
      c.moveTo(px - tx * 5, py - ty * 5); c.lineTo(px + nx * h, py + ny * h); c.lineTo(px + tx * 5, py + ty * 5);
    }
    c.stroke();
    if (hit > 0) T.glowAt(E.x, E.y - E.r, 30, hit * 0.25);
  }
  function draw(now) {
    const c = T.g, G = geo();
    c.drawImage(wall(G), 0, 0, T.W, T.H);
    if (fx.body > 0.05) T.glowAt(G.cx, G.y1 - (G.y1 - G.y0) * 0.12, 40, fx.body * 0.12);   // дека отзывается — розетка светится
    const held = new Map();
    for (const t of touches.values()) if (t.kind === 'bridge' || t.kind === 'string') held.set(t.i, t);
    str.forEach((s, i) => {
      const x = G.xs[i], yb = yOfR(G, s.r), amp = Math.min(9, s.en * 60), h = held.has(i);
      c.fillStyle = T.ink(0.85); c.beginPath(); c.arc(x, G.y0 - 8, 3, 0, TAU); c.fill();   // колок
      c.strokeStyle = T.ink(0.3); c.lineWidth = 1; c.beginPath(); c.moveTo(x, yb); c.lineTo(x, G.y1 + 6); c.stroke();   // заглушенная часть — ниже подставки
      c.strokeStyle = T.ink(s.sus ? 1 : 0.85); c.lineWidth = s.sus ? 1.6 : 1.2; c.beginPath();   // звучащая часть: стоячая волна — размах по энергии
      const n = 40, ph = now * 0.09 + i;
      const ah = Math.min(7, s.eh * 60);                  // флажолет: стоячая волна с узлами
      for (let k = 0; k <= n; k++) { const u = k / n, y = G.y0 + u * (yb - G.y0), dx = amp * (Math.sin(Math.PI * u) * Math.sin(ph) * 0.7 + Math.sin(TAU * u) * Math.sin(ph * 1.7 + i) * 0.3) + ah * Math.sin(s.hn * Math.PI * u) * Math.sin(ph * s.hn * 0.7); k ? c.lineTo(x + dx, y) : c.moveTo(x + dx, y); }
      c.stroke();
      c.fillStyle = T.ink(h || ah > 0.5 ? 0.6 : 0.22);    // узлы флажолетов — точки на звучащей части
      for (const [u, m] of NODES) { const y = G.y0 + u * (yb - G.y0), on = ah > 0.5 && Math.abs(u * s.hn - Math.round(u * s.hn)) < 1e-6; c.beginPath(); c.arc(x, y, on ? 2.6 : 1.6, 0, TAU); c.fill(); }
      if (s.sus) { c.strokeStyle = T.ink(0.25); c.lineWidth = 6; c.beginPath(); c.moveTo(x, G.y0); c.lineTo(x, yb); c.stroke(); }
      c.fillStyle = T.BG; c.strokeStyle = T.ink(h ? 1 : 0.85); c.lineWidth = 1.2;   // подставка — треугольник
      c.beginPath(); c.moveTo(x - 9, yb + 7); c.lineTo(x, yb - 4); c.lineTo(x + 9, yb + 7); c.closePath(); c.fill(); c.stroke();
      c.fillStyle = T.ink(0.85); c.beginPath(); c.arc(x, G.y1 + 6, 2.2, 0, TAU); c.fill();   // нижний порожек
    });
    str.forEach((s, i) => {                               // сфера Фладда под подставкой загорается, пока струна звучит
      const e = Math.min(1, (s.en + s.eh) * 25);
      if (e < 0.05) return;
      let best = null, bd = 0.02;
      for (const m of MARKS) { const d = Math.abs(Math.log2(m[0] / s.r)); if (d < bd) { bd = d; best = m; } }
      if (!best) return;
      const y = yOfR(G, best[0]), x = G.box.x0 - 14;
      const sx = x + 8, cc = T.g;                                     // звёздочка между подписью и ящиком — лучи по силе звука
      cc.strokeStyle = T.ink(0.3 + 0.6 * e); cc.lineWidth = 1; cc.beginPath();
      for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU, l = k % 2 ? 2.5 : 4 + 2 * e; cc.moveTo(sx + Math.cos(a) * 1.5, y + Math.sin(a) * 1.5); cc.lineTo(sx + Math.cos(a) * l, y + Math.sin(a) * l); }
      cc.stroke();
      T.mapText(best[1], x, y, 11, 0.45 + 0.55 * e, 'right');
    });
    for (const [i, t] of held) {                          // подписи — только пока трогаешь
      if (t.kind !== 'bridge') continue;
      const s = str[i], yb = yOfR(G, s.r), f = hzOf(i), nm = RATIO_NAMES.get(s.r) || (MARKS.find((m) => m[0] === s.r) || [])[1] || '';
      const rx = G.box.x0 - 14, ry = G.y0 + 30;           // пустое место над Эмпиреем, слева: палец закрывает подставку
      T.mapText(`${noteOf(f)} · ${Math.round(f)} Hz`, rx, ry, 15, 0.95, 'right');
      if (nm) T.mapText(nm, rx, ry + 18, 11, 0.6, 'right');
    }
    drawEarth(c, G, now);
    drawHand(c, G, now);
    drawAeolus(c, G, now, [...touches.values()].some((t) => t.kind === 'wind'));
    for (const t of touches.values()) if (t.kind === 'string' && !t.moved && !t.sheet && now - t.t0 > T.HOLD_MS) { t.sheet = true; stringSheet(t.i); }   // держишь струну — плашка
  }

  // ---------- мир ----------
  const deg = (d) => (d * Math.PI) / 180;
  const fxw = {
    sectors: [
      { key: 'decay', label: 'decay', ang: deg(200) }, { key: 'bright', label: 'brightness', ang: deg(170) }, { key: 'body', label: 'body', ang: deg(140) },
      { key: 'sympathy', label: 'sympathy', ang: deg(125) }, { key: 'chorus', label: 'chorus', ang: deg(110) }, { key: 'chance', label: 'chance', ang: deg(95) }, { key: 'hall', label: 'hall', ang: deg(80) },
    ],
    get: (k) => fx[k], set: (k, v) => { fx[k] = v; applyFx(); }, text: (k) => `${Math.round(fx[k] * 100)}%`,
    lfo: { keys: ['decay', 'bright', 'body', 'sympathy', 'chorus', 'chance', 'hall'], shapes: 'classic' },
    arc: () => fx.hall, save: () => ({ ...fx }), load: (o) => { Object.assign(fx, o); applyFx(); },
  };
  function dice() {                                       // подставки — на пифагоровы лады, одна-две струны поют сами
    const R = Math.random, pick = [1, 3 / 4, 2 / 3, 1 / 2, 4 / 9, 3 / 8, 1 / 3, 8 / 9];
    str.forEach((s, i) => { s.r = T.scaleOn ? snapR(pick[Math.floor(R() * pick.length)]) : pick[Math.floor(R() * pick.length)]; s.sus = R() < 0.4; retune(i); send({ t: 'sus', i, on: s.sus }); });
    setWind(R() < 0.3 ? 0.15 + 0.35 * R() : 0);
    if (str.some((s) => s.sus)) setLive(true);
  }
  const mono = {
    n: 'VII', title: 'Monochordum', sub: 'chorda mundi',
    corner: { hit: (f) => { const h = geo().hand; return Math.hypot(f.x - h.x, f.y - h.y) < h.r * 1.1; }, draw: () => {} },   // рука Бога в облаке — карта
    fx: fxw,
    legend: [['tap', 'tap a string above its bridge', 'pluck · near the end — bright'], ['drag', 'stroke back and forth on a string', 'bow it · speed — pressure'], ['draw', 'sweep across the strings', 'strum · speed — strength'],
      ['up', 'drag a bridge', 'pitch · sticks to Pythagorean frets'], ['tap', 'tap a dot on a string', 'harmonic (flageolet) · 1/2, 1/3, 1/4'], ['double', 'double tap a string', 'it sings by itself, like an Aeolian harp'],
      ['hold', 'hold a string', 'its sheet: pitch, brightness, decay, level · ~ — LFO, vibrato'], ['up', 'drag the wind rose up', 'wind · every string sings · tap — on / off · hold — gusts'], ['tap', 'tap the earth', 'it strums by itself in tempo · hold — rate, pattern'], ['tap', 'tap the cloud', 'map of worlds']],
    build, tick, draw, down, move, up, dice, enter: start,
    clear() { str.forEach((s, i) => { s.sus = false; s.bow = 0; send({ t: 'sus', i, on: false }); send({ t: 'bow', i, amp: 0 }); }); T.lfoClear('mono-wind'); setWind(0); setAuto(false); },   // корзина: и порывы ветра снимаются
    snapshot: () => JSON.stringify({ str: str.map((s) => ({ r: s.r, sus: s.sus, bright: s.bright, decay: s.decay, level: s.level })), fx, wind, auto: { on: auto.on, bpm: auto.bpm, div: auto.div, pattern: auto.pattern, strength: auto.strength, swing: auto.swing } }),
    restore(js) {
      const st = JSON.parse(js);
      st.str.forEach((q, i) => { Object.assign(str[i], q); send({ t: 'sus', i, on: q.sus }); });
      Object.assign(fx, st.fx); applyFx(); setWind(st.wind || 0);
      if (st.auto) { const on = st.auto.on; Object.assign(auto, st.auto); setAuto(on); }
      if (str.some((s) => s.sus)) { start(); setLive(true); }
    },
    sounding, tempo: { set: (bpm) => { auto.bpm = bpm; } },
  };
  T.registerWorld(7, mono);
  window.t2d.mono = {
    str, fx, geo, setFx: (k, v) => fxw.set(k, v), setWind, auto, earth: () => earthG(geo()), get wind() { return wind; }, get chorus() { return !!(bus && bus.ch && bus.ch.on); }, get ready() { return ready; }, get live() { return !!(bus && bus.live); },
    at: (i, r) => { const G = geo(); return { x: G.xs[i], y: yOfR(G, r) }; }, hz: (i) => hzOf(i),
  };
})();
