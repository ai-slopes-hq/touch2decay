// touch2decay — дрон / нойз на 1–2 пальца. Web Audio + canvas, без зависимостей.
(() => {
  'use strict';

  // ---------- палитра: пока ч/б, цвета добавлять здесь ----------
  const INK = '237,237,237';                 // rgb без альфы
  const LINE = 'rgba(237,237,237,0.10)';
  const BG = '#000';

  // ---------- звук ----------
  const F_LO = 55;          // нижняя нота поля (A1)
  const OCT = 4;            // ширина поля, октав (до A5 = 880 Гц)
  const BEAT_MIN = 0.05, BEAT_MAX = 24;      // детюн: от фазирования до треска
  const BEAT_DEF = 0.35;    // по умолчанию пара медленно «дышит»
  const FB_BASE = 0.3, FB_MAX = 0.93;        // резонанс гребёнки
  const WAVES = [                            // волна пары осцилляторов: четыре ступени
    { type: 'sine', label: 'синус', level: 0.5 },
    { type: 'triangle', label: 'треугольник', level: 0.42 },
    { type: 'sawtooth', label: 'пила', level: 0.24 },
    { type: 'square', label: 'меандр', level: 0.18 },
  ];
  const WAVE_DEF = 1;
  const CUT_DEF = 0.5, RES_DEF = 0.21, RES_MAX = 24;   // резо: Q фильтра в дБ
  const TAIL_DEF = 1.6;     // хвост после отпускания (τ, с)
  const TAIL_MIN = 0.25, TAIL_MAX = 8;
  const UNPIN_TAIL = 0.8;   // хвост после снятия с закрепления
  const FM_MAX = 1.4;       // FM на полную: девиация в долях частоты
  const LINK_NEW = 0.5;     // глубина нового моста
  const LFO_MIN = 0.06, LFO_OCT = 8;         // дрожь: от 0.06 до ~15 Гц
  const LFO_CENTS = 38, LFO_TREM = 0.22;     // глубина дрожи по высоте и громкости

  // ---------- жесты ----------
  const VOICES = 8;         // сколько кружков может звучать одновременно
  const GRAB_R = 52;        // радиус, в котором палец «ловит» кружок, px
  const POCKET = 40;        // ширина левого кармана «дрожь», px
  const TAP_MS = 220, TAP_MOVE = 14;   // что считается тапом
  const DTAP_MS = 320;      // окно двойного тапа
  const HOLD_MS = 420, HOLD_MOVE = 10; // долгое нажатие на кружке — кольцо свойств
  const MENU_DEAD = 40, MENU_SPAN = 150;

  const deg = (d) => (d * Math.PI) / 180;
  const SECTORS = [                          // кольцо свойств: пять лучей
    { key: 'wave', label: 'волна', ang: deg(-90) },
    { key: 'cut', label: 'срез', ang: deg(-18) },     // срез фильтра: ±3 октавы поверх оси Y
    { key: 'res', label: 'резо', ang: deg(54) },      // резонанс фильтра
    { key: 'beat', label: 'детюн', ang: deg(126) },
    { key: 'fm', label: 'фм', ang: deg(198) },        // собственная FM
  ];

  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerpLog = (lo, hi, t) => lo * (hi / lo) ** t;
  const invLog = (lo, hi, v) => Math.log(v / lo) / Math.log(hi / lo);
  const $ = (id) => document.getElementById(id);

  const cv = $('field');
  const g = cv.getContext('2d');
  const safeTop = $('safe-top');

  let W = 0, H = 0, DPR = 1, scopeY = 120, scan = null;

  // ---------- голоса (кружки) ----------
  const V = Array.from({ length: VOICES }, (_, i) => ({
    i, x: 0.35, dx: 0.35, y: 0.22, ox: 0, oy: 0, dock: null,
    beat: BEAT_DEF, fb: FB_BASE, wave: WAVE_DEF, tail: TAIL_DEF, fm: 0, cut: CUT_DEF, res: RES_DEF, mods: [],
    fingers: [], pinned: false, active: false,
    env: 0, envT: 0, envTau: 0.05, emit: 0, t: 0,
    dirty: true, snap: true, nodes: null,
  }));
  let focus = V[0];
  let touchedOnce = false;
  let lastTap = null;       // { v, t } — для двойного тапа
  const F = new Map();      // pointerId -> палец
  const rings = [];

  // ---------- лад: пока держишь кнопку, кружки встают на ноты ----------
  const SCALES = [                            // ступени от ля, в полутонах
    { label: 'мажор', steps: [0, 2, 4, 5, 7, 9, 11] },
    { label: 'минор', steps: [0, 2, 3, 5, 7, 8, 10] },
    { label: 'дорийский', steps: [0, 2, 3, 5, 7, 9, 10] },
    { label: 'фригийский', steps: [0, 1, 3, 5, 7, 8, 10] },
    { label: 'лидийский', steps: [0, 2, 4, 6, 7, 9, 11] },
    { label: 'миксолидийский', steps: [0, 2, 4, 5, 7, 9, 10] },
  ];
  const SEMIS = OCT * 12;
  const scl = { idx: 0, on: false, slideUntil: 0 };
  // общие эффекты (кнопка FX): посылы и характер; сухой звук не трогают
  const fx = { rev: 0.3, decay: 3.5, dly: 0.3, rep: 0.46, dirt: 0.2 };
  const DECAY_MIN = 0.6, DECAY_MAX = 14, REP_MAX = 0.92;
  const FX_SECTORS = [                        // веер из правого нижнего угла: влево → вверх
    { key: 'rev', label: 'зал', ang: deg(180) },
    { key: 'decay', label: 'хвост', ang: deg(202.5) },
    { key: 'dly', label: 'дилей', ang: deg(225) },
    { key: 'rep', label: 'повторы', ang: deg(247.5) },
    { key: 'dirt', label: 'грязь', ang: deg(270) },
  ];

  function quantX(x) {
    const st = SCALES[scl.idx].steps, s = x * SEMIS;
    let best = s, bd = 99;
    for (let n = Math.floor(s) - 7; n <= Math.ceil(s) + 7; n++) {
      if (n < 0 || n > SEMIS || !st.includes(((n % 12) + 12) % 12)) continue;
      const d = Math.abs(n - s);
      if (d < bd) { bd = d; best = n; }
    }
    return best / SEMIS;
  }
  const soundX = (v) => (scl.on ? quantX(v.x) : v.x);
  const freq = (v) => F_LO * 2 ** (soundX(v) * OCT);
  // низ поля — тёмный, верх — открытый; «срез» кружка сдвигает это на ±3 октавы
  const cutoff = (v) => Math.min(16000, 260 * 2 ** (v.y * 5) * 2 ** ((v.cut - 0.5) * 6));
  const lfoRate = (v) => LFO_MIN * 2 ** ((v.dock ? v.dock.pos : 0) * LFO_OCT);
  const fieldX = (px) => clamp((px - POCKET) / (W - POCKET));
  // где кружок нарисован: в кармане — на его полосе, иначе — по своей высоте и шуму
  const vx = (v) => (v.dock ? POCKET / 2 : POCKET + v.dx * (W - POCKET));   // dx — где кружок виден (с ладом он съезжает к ноте)
  const vy = (v) => (v.dock ? (1 - v.dock.pos) * H : (1 - v.y) * H);

  // значение свойства в долях 0..1 (для дуг и глифов)
  function norm(v, key) {
    if (key === 'wave') return (v.wave + 0.5) / WAVES.length;
    if (key === 'cut') return v.cut;
    if (key === 'res') return v.res;
    if (key === 'beat') return invLog(BEAT_MIN, BEAT_MAX, v.beat);
    return v.fm;
  }

  function setNorm(v, key, t) {
    if (key === 'wave') v.wave = Math.min(WAVES.length - 1, Math.floor(t * WAVES.length));
    else if (key === 'cut') v.cut = t;
    else if (key === 'res') v.res = t;
    else if (key === 'beat') v.beat = lerpLog(BEAT_MIN, BEAT_MAX, t);
    else v.fm = t;
    v.dirty = true;
  }

  function hit(x, y) {
    let v = null, best = GRAB_R;
    for (const u of V) {
      if (!u.active || u.fingers.length) continue;
      const d = Math.hypot(vx(u) - x, vy(u) - y);
      if (d < best) { best = d; v = u; }
    }
    return v;
  }

  // палец лёг на кружок не в центр — запомнить смещение, чтобы кружок не прыгал
  function rebase(v) {
    if (v.fingers.length !== 1) return;
    const f = F.get(v.fingers[0]);
    if (v.dock) { v.ox = 0; v.oy = 0; return; }
    v.ox = vx(v) - f.x;
    v.oy = vy(v) - f.y;
  }

  function follow(v) {
    if (v.fingers.length !== 1) return;
    const f = F.get(v.fingers[0]);
    if (!f || f.menu || f.bridge) return;
    if (f.x < POCKET) {                         // в кармане: звук остаётся, позиция = скорость дрожи
      if (!v.dock) {
        v.dock = { pos: 0 }; v.ox = 0; v.oy = 0;
        if (f.home) { v.x = f.home.x; v.y = f.home.y; }   // в карман уносится тот звук, с которым кружок взяли
      }
      v.dock.pos = clamp(1 - f.y / H);
    } else {
      if (v.dock) { v.dock = null; v.ox = 0; v.oy = 0; }
      v.x = fieldX(f.x + v.ox);
      v.y = clamp(1 - (f.y + v.oy) / H);
    }
    v.dirty = true;
    focus = v;
  }

  function spawn(f) {
    let v = V.find((u) => !u.active);
    if (!v) {                               // все заняты — забрать самый тихий из затухающих
      for (const u of V) if (!u.pinned && !u.fingers.length && (!v || u.env < v.env)) v = u;
    }
    if (!v) return null;
    unlinkAll(v);
    v.x = fieldX(f.x); v.dx = v.x; v.y = clamp(1 - f.y / H); v.ox = 0; v.oy = 0; v.dock = null;
    v.beat = BEAT_DEF; v.fb = FB_BASE; v.wave = WAVE_DEF; v.tail = TAIL_DEF; v.fm = 0; v.cut = CUT_DEF; v.res = RES_DEF;
    v.pinned = false; v.fingers = [];
    v.snap = v.env < 0.02; v.dirty = true; v.emit = 1e9;
    attack(v);
    return v;
  }

  function attack(v) {
    v.active = true; v.envT = 1; v.envTau = 0.12;
    if (v.nodes) {
      v.nodes.env.gain.setTargetAtTime(1, ctx.currentTime, 0.12);
      v.nodes.mod.gain.setTargetAtTime(1, ctx.currentTime, 0.12);
    }
    wake();
  }

  function release(v, tau) {
    v.envT = 0; v.envTau = tau;
    if (v.nodes) {
      v.nodes.env.gain.setTargetAtTime(0, ctx.currentTime, tau);
      v.nodes.mod.gain.setTargetAtTime(0, ctx.currentTime, tau);
    }
  }

  function burst(v) {
    rings.push({ x: vx(v), y: vy(v), r: 36, a: 1.6, sp: 420 });
  }

  // ---------- связи: другой кружок модулирует частоту этого ----------
  function addLink(dst, src, depth) {
    const m = { src, g: null, depth };
    if (ctx && dst.nodes && src.nodes) {
      m.g = ctx.createGain();
      m.g.gain.value = 0;
      src.nodes.mod.connect(m.g);
      for (const p of dst.nodes.fmTargets) m.g.connect(p);
    }
    dst.mods.push(m);
    dst.dirty = true;
    return m;
  }

  function removeLink(dst, src) {
    const i = dst.mods.findIndex((m) => m.src === src);
    if (i < 0) return;
    if (dst.mods[i].g) dst.mods[i].g.disconnect();
    dst.mods.splice(i, 1);
  }

  function unlinkAll(v) {
    for (const m of v.mods) if (m.g) m.g.disconnect();
    v.mods = [];
    for (const u of V) {
      const keep = [];
      for (const m of u.mods) { if (m.src === v) { if (m.g) m.g.disconnect(); } else keep.push(m); }
      u.mods = keep;
    }
  }

  // ---------- мост: палец на кружке A, второй палец на кружке B → B модулирует A ----------
  const fdist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

  function startBridge(fa, fb, B) {
    const A = fa.voice;
    if (!B.pinned) attack(B);
    B.fingers.push(fb.id);
    fb.voice = B;
    const m = A.mods.find((k) => k.src === B) || addLink(A, B, LINK_NEW);
    const br = { A, B, fa, fb, m, d0: Math.max(30, fdist(fa, fb)), depth0: m.depth };
    fa.bridge = br; fb.bridge = br;
    fa.wasBridge = true; fb.wasBridge = true;
    focus = A;
  }

  function bridgeMove(br) {
    br.m.depth = clamp(br.depth0 + (fdist(br.fa, br.fb) / br.d0 - 1));
    br.A.dirty = true;
  }

  function endBridge(br) {
    br.fa.bridge = null; br.fb.bridge = null;
    if (br.m.depth < 0.06) removeLink(br.A, br.B);
    for (const f of [br.fa, br.fb]) if (f.voice) { f.moved = true; rebase(f.voice); }
  }

  // ---------- касания ----------
  function down(e) {
    e.preventDefault();
    unlock();
    touchedOnce = true;
    try { cv.setPointerCapture(e.pointerId); } catch (_) { /* ok */ }
    const now = performance.now();
    const f = {
      id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: now,
      voice: null, caught: false, moved: false, menu: null, menuWas: false, bridge: null, wasBridge: false,
    };
    F.set(e.pointerId, f);

    const ui = uiHit(f.x, f.y);
    if (ui) { f.ui = ui; uiDown(f); return; }

    let v = hit(f.x, f.y);
    if (v) {
      // другой палец уже держит кружок — это мост
      for (const o of F.values()) {
        if (o !== f && o.voice && o.voice !== v && !o.menu && !o.bridge && o.voice.fingers.length === 1) {
          startBridge(o, f, v);
          return;
        }
      }
      f.caught = true;
      if (!v.pinned) attack(v);
    } else {
      v = spawn(f);                           // пустое место — новый кружок
      if (!v) return;
    }
    v.fingers.push(f.id);
    v.t = now;
    f.voice = v;
    f.home = { x: v.x, y: v.y };
    rebase(v);
    follow(v);
  }

  function move(e) {
    const f = F.get(e.pointerId);
    if (!f) return;
    f.x = e.clientX; f.y = e.clientY;
    if (f.ui) { if (f.menu) menuMove(f); else uiMove(f); return; }
    if (!f.moved && Math.hypot(f.x - f.x0, f.y - f.y0) > HOLD_MOVE) f.moved = true;
    if (f.bridge) bridgeMove(f.bridge);
    else if (f.menu) menuMove(f);
    else if (f.voice) follow(f.voice);
  }

  function up(e) {
    const f = F.get(e.pointerId);
    if (!f) return;
    if (f.bridge) endBridge(f.bridge);
    F.delete(e.pointerId);
    if (f.ui) { uiUp(f); return; }
    f.menu = null;
    const v = f.voice;
    if (!v) return;
    v.fingers = v.fingers.filter((id) => id !== f.id);

    const now = performance.now();
    const tap = !f.wasBridge && !f.menuWas && now - f.t0 < TAP_MS && Math.hypot(f.x - f.x0, f.y - f.y0) < TAP_MOVE;
    if (tap && !v.fingers.length) {
      if (lastTap && lastTap.v === v && now - lastTap.t < DTAP_MS) {
        lastTap = null;
        burst(v);
        if (v.pinned) { v.pinned = false; release(v, UNPIN_TAIL); }
        else v.pinned = true;
        return;
      }
      lastTap = { v, t: now };
    }
    if (v.fingers.length) rebase(v);
    else if (!v.pinned) release(v, v.tail);
  }

  // ---------- кнопки: внизу FX (держишь — веер эффектов) и лад (держишь — список ладов), вверху — убрать всё ----------
  const BTN_R = 26, ITEM_H = 46, CLR_R = 17;
  let safeBot = 0;
  const btnPos = (k) => {
    if (k === 'clr') return { x: W - 34, y: scopeY + 20 };
    return { x: k === 'rev' ? W - 48 : POCKET + 48, y: H - safeBot - 48 };
  };

  function uiHit(x, y) {
    for (const k of ['rev', 'scl', 'clr']) {
      const b = btnPos(k), r = k === 'clr' ? CLR_R + 14 : BTN_R + 16;
      if (Math.hypot(x - b.x, y - b.y) < r) return k;
    }
    return null;
  }

  function allDirty() { for (const v of V) v.dirty = true; }

  // все кружки, включая закреплённые, гаснут за секунду; связи рвутся
  function clearAll() {
    for (const f of F.values()) { if (f.voice) { f.voice = null; f.menu = null; f.bridge = null; } }
    for (const v of V) {
      if (!v.active) continue;
      v.fingers = []; v.pinned = false;
      unlinkAll(v);
      release(v, 0.35);
      burst(v);
    }
    lastTap = null;
  }

  function uiDown(f) {
    if (f.ui === 'clr') { clearAll(); return; }
    if (f.ui === 'rev') { openFx(f); return; }
    scl.on = true;
    scl.slideUntil = performance.now() + 500;
    allDirty();
  }

  function uiMove(f) {
    if (f.ui !== 'scl') return;
    const b = btnPos('scl');
    if (f.y > b.y - 40) return;
    const i = clamp(Math.floor((b.y - 40 - f.y) / ITEM_H), 0, SCALES.length - 1);
    if (i !== scl.idx) { scl.idx = i; scl.slideUntil = performance.now() + 500; allDirty(); }
  }

  function uiUp(f) {
    if (f.ui !== 'scl') return;
    scl.on = false;
    scl.slideUntil = performance.now() + 500;
    allDirty();
  }

  // ---------- эффекты: значения в долях 0..1 для веера ----------
  function fxGet(key) {
    if (key === 'decay') return invLog(DECAY_MIN, DECAY_MAX, fx.decay);
    if (key === 'rep') return fx.rep / REP_MAX;
    return fx[key];
  }
  function fxSet(key, t) {
    if (key === 'decay') fx.decay = lerpLog(DECAY_MIN, DECAY_MAX, t);
    else if (key === 'rep') fx.rep = t * REP_MAX;
    else fx[key] = t;
    applyFx();
  }
  function fxText(key) {
    if (key === 'decay') return fx.decay.toFixed(fx.decay < 10 ? 1 : 0) + ' с';
    return Math.round(fxGet(key) * 100) + '%';
  }

  function openFx(f) {
    const b = btnPos('rev'), orig = { ...fx };
    f.menuWas = true;
    f.menu = {
      cx: b.x, cy: b.y, sector: null, sectors: FX_SECTORS, fx: true,
      get: fxGet, set: fxSet, text: fxText,
      restore: () => { Object.assign(fx, orig); applyFx(); },
    };
  }

  // ---------- кольцо свойств ----------
  // ---------- кольцо свойств ----------
  function openMenu(f) {
    const v = f.voice;
    f.menuWas = true;
    const orig = { wave: v.wave, cut: v.cut, res: v.res, beat: v.beat, fm: v.fm };
    f.menu = {
      cx: vx(v), cy: vy(v), sector: null, sectors: SECTORS,
      get: (k) => norm(v, k), set: (k, t) => setNorm(v, k, t), text: (k) => valueText(v, k),
      restore: () => { Object.assign(v, orig); v.dirty = true; },
    };
    focus = v;
  }

  function menuMove(f) {
    const m = f.menu;
    const dx = f.x - m.cx, dy = f.y - m.cy, d = Math.hypot(dx, dy);
    if (d < MENU_DEAD) {                      // вернулся в центр — отмена
      if (m.sector) m.restore();
      m.sector = null;
      return;
    }
    if (!m.sector && d > MENU_DEAD + 16) {
      const a = Math.atan2(dy, dx);
      let bd = 9;
      for (const s of m.sectors) {
        const diff = Math.abs(Math.atan2(Math.sin(a - s.ang), Math.cos(a - s.ang)));
        if (diff < bd) { bd = diff; m.sector = s; }
      }
    }
    if (m.sector) m.set(m.sector.key, clamp((d - MENU_DEAD) / MENU_SPAN));
  }

  // ---------- аудио ----------
  let ctx = null, an = null, scopeBuf = null, bus = null, fxN = null;

  // tanh-кривая: norm=true — выход до ±1 (мастер), false — наклон 1 в нуле (петля обратной связи)
  function soft(k, normed) {
    const n = 4096, c = new Float32Array(n), d = normed ? Math.tanh(k) : k;
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / d; }
    return c;
  }

  function noiseBuffer(seconds) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  const gainNode = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
  function filter(type, f, q) {
    const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f;
    if (q != null) n.Q.value = q;
    return n;
  }
  function lfo(rate, depth, ...params) {
    const o = ctx.createOscillator(); o.frequency.value = rate; o.start();
    const a = gainNode(depth); o.connect(a);
    for (const p of params) a.connect(p);
    return { o, a };
  }

  // зал: четыре линии задержки с перекрёстной обратной связью (матрица Хаусхолдера).
  // На входе срез низа — иначе бас дрона превращает хвост в кашу — и фазовое размазывание.
  function hall() {
    const N = 4, SIZE = 2.4, base = [0.0297, 0.0371, 0.0411, 0.0437];
    const input = gainNode(1);
    let x = input.connect(filter('highpass', 280, -3)).connect(filter('lowpass', 7500, -3));
    for (const fr of [430, 1150, 2400, 4300]) { const ap = filter('allpass', fr, 0.7); x.connect(ap); x = ap; }
    const mix = gainNode(-2 / N);
    const merge = ctx.createChannelMerger(2);
    const lines = [];
    for (let i = 0; i < N; i++) {
      const len = base[i] * SIZE;
      const d = ctx.createDelay(1); d.delayTime.value = len;
      lfo(0.13 + i * 0.07, 0.0009, d.delayTime);          // лёгкое плавание — хвост не звенит металлом
      const damp = filter('lowpass', 6000 - i * 500, -3);
      const g = gainNode(0.7);
      x.connect(i % 2 ? gainNode(-1) : gainNode(1)).connect(d);
      d.connect(damp).connect(g);
      g.connect(d);
      g.connect(mix);
      mix.connect(d);
      d.connect(merge, 0, i % 2);
      lines.push({ g, len });
    }
    return { input, out: merge, lines };
  }

  function applyFx() {
    if (!fxN) return;
    const t = ctx.currentTime, T = (p, v) => p.setTargetAtTime(v, t, 0.05);
    T(fxN.revSend.gain, fx.rev * fx.rev * 1.4);
    for (const l of fxN.hall.lines) T(l.g.gain, 10 ** ((-3 * l.len) / fx.decay));
    T(fxN.dSend.gain, fx.dly * 0.7);
    T(fxN.fbL.gain, fx.rep); T(fxN.fbR.gain, fx.rep);
    T(fxN.pre.gain, 0.6 + fx.dirt * 3.2);
    T(fxN.post.gain, 1 / (1 + fx.dirt * 0.9));
  }

  function build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC({ latencyHint: 'interactive' });
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(4); noise.loop = true; noise.start();

    // шина голосов → грязь (перегруз) → сухой звук; дилей и зал — посылы поверх него
    bus = ctx.createGain();
    const pre = gainNode(0.8), post = gainNode(1);
    const drive = ctx.createWaveShaper(); drive.curve = soft(1.6, true); drive.oversample = '4x';
    bus.connect(pre).connect(drive).connect(post);
    const out = gainNode(1);
    post.connect(out);

    // стерео-дилей: две линии крест-накрест, время слегка плавает, как у ленты
    const dSend = gainNode(0);
    const dL = ctx.createDelay(2), dR = ctx.createDelay(2);
    dL.delayTime.value = 0.37; dR.delayTime.value = 0.53;
    const fbL = gainNode(0.46), fbR = gainNode(0.46);
    const lpL = filter('lowpass', 2600, -3), lpR = filter('lowpass', 2100, -3);
    post.connect(dSend);
    dSend.connect(dL);
    dL.connect(lpL).connect(fbL).connect(dR);
    dR.connect(lpR).connect(fbR).connect(dL);
    lfo(0.13, 0.004, dL.delayTime);
    lfo(0.087, 0.005, dR.delayTime);
    const dMerge = ctx.createChannelMerger(2);
    dL.connect(dMerge, 0, 0); dR.connect(dMerge, 0, 1);
    dMerge.connect(out);

    // зал слышит и сухой звук, и повторы дилея
    const h = hall();
    const revSend = gainNode(0);
    post.connect(revSend); dMerge.connect(revSend);
    revSend.connect(h.input);
    h.out.connect(gainNode(0.9)).connect(out);

    fxN = { pre, post, dSend, fbL, fbR, revSend, hall: h };
    applyFx();

    const hp = filter('highpass', 30);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 4;
    comp.attack.value = 0.01; comp.release.value = 0.4;
    const master = gainNode(0.8);
    // мягкий потолок на выходе: вдвое больше запаса по входу, чем по выходу
    const limitIn = gainNode(0.5);
    const limit = ctx.createWaveShaper(); limit.curve = soft(2.6, true); limit.oversample = '4x';
    an = ctx.createAnalyser(); an.fftSize = 2048; scopeBuf = new Float32Array(an.fftSize);
    out.connect(hp).connect(comp).connect(master).connect(limitIn).connect(limit);
    limit.connect(ctx.destination);
    limit.connect(an);

    for (const v of V) { v.nodes = voiceNodes(v, noise, bus); v.snap = true; v.dirty = true; }
  }

  function voiceNodes(v, noise, bus) {
    const k = 1 + v.i * 0.137;                  // у каждого кружка свои скорости дыхания
    const pan = (p) => { if (!ctx.createStereoPanner) return gainNode(1); const s = ctx.createStereoPanner(); s.pan.value = p; return s; };

    // пара осцилляторов, разведённая по стерео; второй сдвинут на детюн
    const c1 = ctx.createOscillator(), c2 = ctx.createOscillator();
    const sub = ctx.createOscillator(), m = ctx.createOscillator();
    c1.type = 'triangle'; c2.type = 'triangle'; sub.type = 'sine'; m.type = 'sine';
    const c1g = gainNode(0), c2g = gainNode(0), subg = gainNode(0.32);
    const tone = gainNode(1);
    c1.connect(c1g).connect(pan(-0.5)).connect(tone);
    c2.connect(c2g).connect(pan(0.5)).connect(tone);
    sub.connect(subg).connect(tone);
    for (const o of [c1, c2, sub, m]) o.start();

    // живость: каждый осциллятор плавает в строе по-своему
    lfo(0.071 * k, 5, c1.detune); lfo(0.19 * k, 2.5, c1.detune);
    lfo(0.053 * k, 6, c2.detune); lfo(0.23 * k, 2, c2.detune);

    // модулятор: собственная FM (фм) и выход для мостов. Сам он ничем не модулируется — петель нет
    const sfm = gainNode(0); m.connect(sfm);
    const fmTargets = [c1.frequency, c2.frequency];
    for (const p of fmTargets) sfm.connect(p);
    const mod = gainNode(0); m.connect(mod);

    // перегруз внутри голоса → фильтр, который сам медленно гуляет
    const driveIn = gainNode(0.5);
    const shaper = ctx.createWaveShaper(); shaper.curve = soft(3, true); shaper.oversample = '2x';
    const lp = filter('lowpass', 800, 5);
    tone.connect(driveIn).connect(shaper).connect(lp);
    lfo(0.043 * k, 280, lp.detune);

    // дыхание шумом: полоса на гармонике кружка, вверху поля — шипение
    const nz = gainNode(0);
    const bp = filter('bandpass', 400, 6);
    noise.connect(bp).connect(gainNode(2.4)).connect(nz);
    const hiss = gainNode(0);
    noise.connect(filter('highpass', 3000)).connect(hiss).connect(nz);

    const env = gainNode(0);
    lp.connect(env); nz.connect(env);

    // гребёнка, настроенная на высоту: «резон»
    const sum = gainNode(1);
    env.connect(sum);
    const dl = ctx.createDelay(1);
    const loopLP = filter('lowpass', 3000, -3);
    const loopSat = ctx.createWaveShaper(); loopSat.curve = soft(1.6, false);
    const fb = gainNode(FB_BASE);
    env.connect(dl);
    dl.connect(loopLP).connect(loopSat).connect(fb).connect(dl);
    const wet = gainNode(0.45);
    dl.connect(wet).connect(sum);

    const lvl = gainNode(0.55);
    lfo(0.09 * k, 0.07, lvl.gain);               // громкость чуть дышит
    const out = pan(0);
    sum.connect(lvl).connect(out).connect(bus);

    // дрожь (левый карман): LFO на строй и громкость
    const pl = ctx.createOscillator(); pl.frequency.value = LFO_MIN; pl.start();
    const vib = gainNode(0), trem = gainNode(0);
    pl.connect(vib); pl.connect(trem);
    for (const o of [c1, c2, sub]) vib.connect(o.detune);
    trem.connect(lvl.gain);

    return { c1, c2, sub, m, c1g, c2g, sfm, mod, driveIn, lp, bp, nz, hiss, env, dl, fb, lvl, out, pl, vib, trem, fmTargets };
  }

  function apply(v) {
    const n = v.nodes;
    if (!n) return;
    const t = ctx.currentTime, s = v.snap;
    v.snap = false;
    const T = (p, val, tau) => p.setTargetAtTime(val, t, s ? 0.004 : tau);
    const f = freq(v), y = v.y, G = 0.14;
    T(n.c1.frequency, f, G);
    T(n.c2.frequency, f + v.beat, G);
    T(n.sub.frequency, f / 2, G);
    T(n.m.frequency, f, G);
    const w = WAVES[v.wave];
    if (n.c1.type !== w.type) { n.c1.type = w.type; n.c2.type = w.type; }
    T(n.c1g.gain, w.level, 0.05); T(n.c2g.gain, w.level, 0.05);
    // вверх по полю: ярче, грязнее, больше шума
    T(n.driveIn.gain, 0.35 + 2.4 * y * y, 0.1);
    T(n.lp.frequency, cutoff(v), 0.1);
    T(n.lp.Q, v.res * RES_MAX, 0.1);
    T(n.nz.gain, 0.04 + 0.5 * y ** 2.2, 0.1);
    T(n.bp.frequency, Math.min(f * 3 * 2 ** (y * 2), 9000), 0.1);
    T(n.bp.Q, 9 - 6 * y, 0.1);
    T(n.hiss.gain, 0.12 * y ** 4, 0.1);
    let d = 1 / f;
    while (d < 0.006) d *= 2;
    T(n.dl.delayTime, d, G);
    T(n.fb.gain, v.fb, 0.12);
    if (n.out.pan) T(n.out.pan, (v.x - 0.5) * 0.6, 0.2);
    T(n.sfm.gain, f * FM_MAX * v.fm, 0.08);
    T(n.pl.frequency, lfoRate(v), 0.1);
    T(n.vib.gain, v.dock ? LFO_CENTS : 0, 0.15);
    T(n.trem.gain, v.dock ? LFO_TREM : 0, 0.15);
    for (const m of v.mods) if (m.g) T(m.g.gain, f * FM_MAX * m.depth, 0.08);
  }

  // iOS: звук только после касания; плюс обход переключателя «бесшумно»
  let primed = false, keep = null;
  function silence() {
    const sr = 8000, n = sr / 2, b = new ArrayBuffer(44 + n * 2), dv = new DataView(b);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true);
    dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, n * 2, true);
    return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
  }

  function unlock() {
    if (!primed) {
      primed = true;
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (_) { /* ok */ }
      try { keep = new Audio(silence()); keep.loop = true; keep.setAttribute('playsinline', ''); } catch (_) { keep = null; }
    }
    if (!ctx) build();
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    if (keep && keep.paused) keep.play().catch(() => {});
  }

  // экран не гаснет, пока что-то звучит
  let lock = null;
  async function wake() {
    if (lock || !('wakeLock' in navigator)) return;
    try {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => { lock = null; });
    } catch (_) { /* ok */ }
  }

  // ---------- рисование ----------
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 3);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    scopeY = safeTop.offsetHeight + 18;
    safeBot = document.getElementById('safe-bot').offsetHeight;
    const c = document.createElement('canvas');
    c.width = cv.width; c.height = cv.height;
    const x = c.getContext('2d');
    x.fillStyle = `rgba(${INK},0.035)`;
    const step = Math.max(2, Math.round(4 * DPR)), hl = Math.max(1, Math.round(DPR * 0.75));
    for (let y = 0; y < c.height; y += step) x.fillRect(0, y, c.width, hl);
    scan = c;
  }

  const ink = (a) => `rgba(${INK},${a})`;
  function ring(x, y, r, a, w) {
    g.lineWidth = w; g.strokeStyle = ink(a);
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
  }
  function dot(x, y, r, a) {
    g.fillStyle = ink(a);
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  function glowRing(x, y, r, a) {
    g.save(); g.shadowColor = ink(0.9); g.shadowBlur = 24; ring(x, y, r, a, 2); g.restore();
  }
  // метка закреплённого кружка — силуэт его волны
  function pinMark(x, y, s, wave, a) {
    g.fillStyle = ink(a);
    g.beginPath();
    const t = WAVES[wave].type;
    if (t === 'sine') g.arc(x, y, s, 0, Math.PI * 2);
    else if (t === 'triangle') { g.moveTo(x, y - s); g.lineTo(x + s, y + s * 0.8); g.lineTo(x - s, y + s * 0.8); g.closePath(); }
    else if (t === 'sawtooth') { g.moveTo(x - s, y + s * 0.8); g.lineTo(x + s, y - s); g.lineTo(x + s, y + s * 0.8); g.closePath(); }
    else g.rect(x - s * 0.85, y - s * 0.85, s * 1.7, s * 1.7);
    g.fill();
  }

  // одна-две волны выбранной формы — над пальцем, пока выбираешь
  function drawWave(type, x, y, w, h, a) {
    g.save();
    g.strokeStyle = ink(a); g.lineWidth = 1.6; g.lineJoin = 'round';
    g.beginPath();
    const N = 80;
    for (let i = 0; i <= N; i++) {
      const t = i / N, ph = (t * 2) % 1;
      let v;
      if (type === 'sine') v = Math.sin(ph * Math.PI * 2);
      else if (type === 'triangle') v = 1 - 4 * Math.abs(ph - 0.5);
      else if (type === 'sawtooth') v = 1 - 2 * ph;
      else v = ph < 0.5 ? 1 : -1;
      const px = x - w / 2 + t * w, py = y - (v * h) / 2;
      if (i) g.lineTo(px, py); else g.moveTo(px, py);
    }
    g.stroke();
    g.restore();
  }

  function drawVoice(v, now) {
    const x = vx(v), y = vy(v);
    const held = v.fingers.length > 0;
    const a = held ? 1 : Math.min(1, v.env * 1.2);
    let r = 36, mark = 9;
    if (v.dock) {                               // в кармане кружок маленький и пульсирует с дрожью
      r = 15 + 2.5 * Math.sin((now / 1000) * lfoRate(v) * Math.PI * 2);
      mark = 5;
    }
    if (held) glowRing(x, y, r, a); else ring(x, y, r, a, 2);
    if (v.pinned) { pinMark(x, y, mark, v.wave, a); ring(x, y, r + 10, a * 0.45, 1); }
    else dot(x, y, 3.5, a);
  }

  // мост: двойная спираль между пальцами; толщина = глубина связи, бег = частота источника
  function drawBridge(br, now) {
    const p = br.fa, q = br.fb;
    const dx = q.x - p.x, dy = q.y - p.y, L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L, ny = dx / L;
    const amp = 3 + br.m.depth * 16, waves = 1.5 + L / 70;
    const ph = (now / 1000) * (1.5 + freq(br.B) / 120) * Math.PI * 2;
    const N = 120, A = [], B = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, env = Math.sin(t * Math.PI);
      const o = amp * env * Math.sin(t * waves * Math.PI * 2 - ph);
      A.push([p.x + dx * t + nx * o, p.y + dy * t + ny * o]);
      B.push([p.x + dx * t - nx * o, p.y + dy * t - ny * o]);
    }
    g.lineWidth = 1;
    g.strokeStyle = ink(0.25);
    g.beginPath();
    for (let i = 4; i < N; i += 5) { g.moveTo(A[i][0], A[i][1]); g.lineTo(B[i][0], B[i][1]); }
    g.stroke();
    for (const S of [A, B]) {
      g.strokeStyle = ink(0.8); g.lineWidth = 1.2; g.beginPath();
      S.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
    }
    // сами кружки стоят на месте; если палец уехал — тонкая нить от кружка к пальцу
    for (const [v, f] of [[br.A, p], [br.B, q]]) {
      const x = vx(v), y = vy(v);
      glowRing(x, y, v.dock ? 15 : 36, 1);
      if (v.pinned) pinMark(x, y, v.dock ? 5 : 9, v.wave, 1);
      if (Math.hypot(f.x - x, f.y - y) > 24) {
        g.strokeStyle = ink(0.3); g.lineWidth = 1;
        g.beginPath(); g.moveTo(x, y); g.lineTo(f.x, f.y); g.stroke();
      }
      dot(f.x, f.y, 3, 1);
    }
  }

  // закреплённая связь: пунктир от источника к приёмнику, по нему бежит точка
  function drawLinks(now, skip) {
    g.save();
    g.lineWidth = 1;
    g.setLineDash([3, 6]);
    for (const v of V) {
      if (!v.active) continue;
      for (const m of v.mods) {
        const s = m.src;
        if (!s.active || m === skip) continue;
        const a = (0.15 + 0.55 * Math.min(1, s.env * 1.2)) * (0.4 + 0.6 * m.depth);
        const x1 = vx(s), y1 = vy(s), x2 = vx(v), y2 = vy(v);
        g.lineDashOffset = -now * 0.02;
        g.strokeStyle = ink(a);
        g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
        const t = ((now / 1000) * (0.3 + freq(s) / 1600)) % 1;
        dot(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, 2.5, a);
      }
    }
    g.restore();
  }

  // левый карман «дрожь»: полоса, риски октав скорости, глиф-синусоида вместо подписи
  function drawPocket(now) {
    const docked = V.some((v) => v.active && v.dock);
    g.fillStyle = ink(docked ? 0.05 : 0.03);
    g.fillRect(0, 0, POCKET, H);
    g.strokeStyle = ink(0.12); g.lineWidth = 1;
    g.beginPath(); g.moveTo(POCKET + 0.5, 0); g.lineTo(POCKET + 0.5, H); g.stroke();
    g.beginPath();
    for (let i = 1; i < LFO_OCT; i++) {
      const y = Math.round(H * (1 - i / LFO_OCT)) + 0.5;
      g.moveTo(POCKET - 7, y); g.lineTo(POCKET, y);
    }
    g.stroke();
    const top = scopeY + 64, len = 44, cx = POCKET / 2;
    g.strokeStyle = ink(0.5); g.lineWidth = 1.2; g.beginPath();
    for (let i = 0; i <= 40; i++) {
      const t = i / 40, y = top + t * len;
      const x = cx + 6 * Math.sin(t * Math.PI * 2 * (1 + 3 * t) - now / 400);
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.stroke();
  }

  const MONO = '"IBM Plex Mono", ui-monospace, Menlo, monospace';

  function valueText(v, key) {
    if (key === 'wave') return WAVES[v.wave].label;
    if (key === 'cut') { const c = cutoff(v); return c >= 1000 ? (c / 1000).toFixed(1) + ' кГц' : Math.round(c) + ' Гц'; }
    if (key === 'res') return Math.round(v.res * 100) + '%';
    if (key === 'beat') return v.beat.toFixed(v.beat < 10 ? 2 : 1) + ' Гц';
    return Math.round(v.fm * 100) + '%';
  }

  // кольцо свойств: пять лучей с подписями; дуга на луче — текущее значение
  function drawMenu(f) {
    const m = f.menu, v = f.voice;
    const val = (k) => m.get(k);
    const R1 = MENU_DEAD, R2 = MENU_DEAD + MENU_SPAN;
    g.fillStyle = 'rgba(0,0,0,0.66)';
    g.beginPath(); g.arc(m.cx, m.cy, R2 + 44, 0, Math.PI * 2); g.fill();
    g.save(); g.setLineDash([2, 5]); ring(m.cx, m.cy, R1, 0.5, 1); ring(m.cx, m.cy, R2, 0.16, 1); g.restore();
    g.textAlign = 'center'; g.textBaseline = 'middle';

    for (const sc of m.sectors) {
      const on = m.sector === sc, a = on ? 1 : m.sector ? 0.25 : 0.8;
      const c = Math.cos(sc.ang), sn = Math.sin(sc.ang);
      g.strokeStyle = ink(a * 0.25); g.lineWidth = 1;
      g.beginPath(); g.moveTo(m.cx + c * R1, m.cy + sn * R1); g.lineTo(m.cx + c * R2, m.cy + sn * R2); g.stroke();
      if (sc.key === 'wave') {                  // у волны — четыре ступени на луче
        for (let i = 1; i < WAVES.length; i++) {
          const r = R1 + (i / WAVES.length) * MENU_SPAN;
          g.beginPath(); g.arc(m.cx, m.cy, r, sc.ang - 0.06, sc.ang + 0.06); g.stroke();
        }
      }
      const rv = R1 + val(sc.key) * MENU_SPAN;
      g.strokeStyle = ink(a); g.lineWidth = on ? 3 : 2;
      g.beginPath(); g.arc(m.cx, m.cy, rv, sc.ang - 0.17, sc.ang + 0.17); g.stroke();
      const lx = clamp(m.cx + c * (R2 + 24), 30, W - 30), ly = clamp(m.cy + sn * (R2 + 24), 16, H - 16);
      if (!on) {                                // у выбранного луча подпись уходит в значение над пальцем
        g.fillStyle = ink(a);
        g.font = `400 13px ${MONO}`;
        g.fillText(sc.label, lx, ly);
      }
    }
    if (m.sector) {
      g.strokeStyle = ink(0.5); g.lineWidth = 1;
      g.beginPath(); g.moveTo(m.cx, m.cy); g.lineTo(f.x, f.y); g.stroke();
      // у кружка значение над пальцем; у веера FX — над веером, где его ничто не перекрывает
      const tx = m.fx ? m.cx - R2 * 0.55 : clamp(f.x, 80, W - 80);
      const ty = m.fx ? m.cy - R2 - 70 : f.y - 70;
      if (m.sector.key === 'wave') drawWave(WAVES[v.wave].type, tx, ty - 28, 56, 20, 1);
      g.fillStyle = ink(1);
      g.font = `500 15px ${MONO}`;
      g.fillText(`${m.sector.label} · ${m.text(m.sector.key)}`, tx, ty);
    }
    g.textAlign = 'start'; g.textBaseline = 'alphabetic';
    if (v) {
      glowRing(m.cx, m.cy, v.dock ? 15 : 36, 1);
      if (v.pinned) pinMark(m.cx, m.cy, v.dock ? 5 : 9, v.wave, 1); else dot(m.cx, m.cy, 3.5, 1);
    }
  }

  // сетка нот лада — пока кнопка лада зажата
  function drawScaleGrid() {
    const st = SCALES[scl.idx].steps;
    g.save();
    g.setLineDash([2, 6]);
    for (let n = 0; n <= SEMIS; n++) {
      if (!st.includes(n % 12)) continue;
      const x = Math.round(POCKET + (n / SEMIS) * (W - POCKET)) + 0.5;
      g.strokeStyle = ink(n % 12 === 0 ? 0.3 : 0.12); g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, scopeY + 50); g.lineTo(x, H - safeBot - 96); g.stroke();
    }
    g.restore();
  }

  function drawUI() {
    let revF = null, sclF = null;
    for (const f of F.values()) { if (f.ui === 'rev') revF = f; if (f.ui === 'scl') sclF = f; }
    g.textBaseline = 'middle';

    // FX: три кольца; дуга вокруг — сколько зала
    const r = btnPos('rev');
    ring(r.x, r.y, BTN_R, revF ? 1 : 0.45, 1.5);
    for (const [rr, a] of [[6, 0.9], [11, 0.55], [16, 0.3]]) ring(r.x, r.y, rr, a * (revF ? 1 : 0.8), 1);
    g.strokeStyle = ink(0.9); g.lineWidth = 2;
    g.beginPath(); g.arc(r.x, r.y, BTN_R + 5, -Math.PI / 2, -Math.PI / 2 + fx.rev * Math.PI * 2); g.stroke();

    // убрать всё: крестик вверху справа
    const c = btnPos('clr');
    const live = V.some((v) => v.active);
    ring(c.x, c.y, CLR_R, live ? 0.45 : 0.18, 1.2);
    g.strokeStyle = ink(live ? 0.75 : 0.25); g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(c.x - 6, c.y - 6); g.lineTo(c.x + 6, c.y + 6); g.moveTo(c.x + 6, c.y - 6); g.lineTo(c.x - 6, c.y + 6); g.stroke();

    // лад: лесенка; зажата — список ладов над кнопкой
    const b = btnPos('scl');
    if (sclF) {
      const n = SCALES.length, top = b.y - 40 - n * ITEM_H;
      g.fillStyle = 'rgba(0,0,0,0.88)';
      g.beginPath(); g.roundRect ? g.roundRect(b.x - 30, top - 8, 210, n * ITEM_H + 16, 14) : g.rect(b.x - 30, top - 8, 210, n * ITEM_H + 16); g.fill();
      g.textAlign = 'left';
      SCALES.forEach((sc, i) => {
        const y = b.y - 40 - ITEM_H * (i + 0.5), on = i === scl.idx;
        g.fillStyle = ink(on ? 1 : 0.45);
        g.font = `${on ? 500 : 400} 15px ${MONO}`;
        g.fillText(sc.label, b.x - 8, y);
        if (on) dot(b.x - 18, y, 3, 1);
      });
    }
    if (scl.on) { g.fillStyle = ink(0.9); g.beginPath(); g.arc(b.x, b.y, BTN_R, 0, Math.PI * 2); g.fill(); }
    else ring(b.x, b.y, BTN_R, 0.45, 1.5);
    g.strokeStyle = scl.on ? BG : ink(0.8); g.lineWidth = 1.6; g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(b.x - 11, b.y + 8);
    for (let i = 0; i < 4; i++) { const x = b.x - 11 + i * 6, y = b.y + 8 - i * 5; g.lineTo(x, y - 5); g.lineTo(x + 6, y - 5); }
    g.stroke();
    g.textBaseline = 'alphabetic'; g.textAlign = 'start';
  }

  function drawScope() {
    const sx = POCKET + 18, sw = W - sx - 70, sh = 40, mid = scopeY + sh / 2;
    g.strokeStyle = ink(0.7); g.lineWidth = 1; g.beginPath();
    if (an) {
      an.getFloatTimeDomainData(scopeBuf);
      let s0 = 0;
      for (let i = 1; i < 1024; i++) if (scopeBuf[i - 1] < 0 && scopeBuf[i] >= 0) { s0 = i; break; }
      const N = 900;
      for (let i = 0; i < N; i++) {
        const x = sx + (i / (N - 1)) * sw, y = mid - clamp(scopeBuf[s0 + i] * 1.4, -1, 1) * (sh / 2);
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      }
    } else { g.moveTo(sx, mid); g.lineTo(sx + sw, mid); }
    g.stroke();
  }

  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    // долгое нажатие на пойманном кружке открывает кольцо свойств
    for (const f of F.values()) {
      if (f.menu || f.menuWas || f.moved || f.bridge || !f.caught || !f.voice || f.voice.fingers.length !== 1) continue;
      if (now - f.t0 > HOLD_MS) openMenu(f);
    }

    // с ладом кружки плавно съезжают к нотам и обратно
    const sliding = now < scl.slideUntil;
    for (const v of V) {
      const tx = soundX(v);
      v.dx = sliding || scl.on ? v.dx + (tx - v.dx) * (1 - Math.exp(-dt / 0.07)) : v.x;
    }

    let anyActive = false;
    for (const v of V) {
      if (v.dirty) { v.dirty = false; apply(v); }
      v.env += (v.envT - v.env) * (1 - Math.exp(-dt / v.envTau));
      if (v.active && !v.pinned && !v.fingers.length && v.envT === 0 && v.env < 0.004) {
        v.active = false;
        v.dock = null;
        unlinkAll(v);
      }
      if (v.active) anyActive = true;
    }
    if (bus) {                                  // чем больше кружков, тем тише каждый
      const live = V.reduce((s, v) => s + (v.active ? v.env : 0), 0);
      bus.gain.setTargetAtTime(1 / Math.sqrt(Math.max(1, live)), ctx.currentTime, 0.3);
    }
    if (!anyActive && lock) { lock.release().catch(() => {}); lock = null; }

    g.fillStyle = BG; g.fillRect(0, 0, W, H);
    if (scan) g.drawImage(scan, 0, 0, W, H);
    drawPocket(now);

    // перекрестие текущего кружка
    if (!focus.dock) {
      const fx = Math.round(vx(focus)) + 0.5, fy = Math.round(vy(focus)) + 0.5;
      g.strokeStyle = LINE; g.lineWidth = 1; g.beginPath();
      g.moveTo(fx, 0); g.lineTo(fx, H); g.moveTo(POCKET, fy); g.lineTo(W, fy); g.stroke();
    }

    // волны от кружков: в кармане — в такт дрожи
    for (const v of V) {
      if (!v.active || v.env < 0.02) continue;
      const period = v.dock ? clamp(1 / lfoRate(v), 0.08, 3) : 1.1 - 0.6 * v.y;
      v.emit += dt;
      if (v.emit >= period) {
        v.emit = 0;
        if (rings.length < 220) rings.push({ x: vx(v), y: vy(v), r: v.dock ? 16 : 34, a: v.env, sp: 60 + freq(v) * 0.28 });
      }
    }
    const Rmax = Math.hypot(W, H) * (0.5 + 0.6 * fx.rev);    // больше зала — дольше гаснут волны
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.r += r.sp * dt;
      if (r.r > Rmax) { rings.splice(i, 1); continue; }
      ring(r.x, r.y, r.r, Math.min(1, r.a * 0.5 * (1 - r.r / Rmax) ** 1.6), 1);
    }

    if (!touchedOnce) {                         // до первого касания — призрак кружка
      const x = vx(V[0]), y = vy(V[0]);
      const breathe = 0.5 + 0.5 * Math.sin(now / 900);
      [62, 98, 146, 208].forEach((r, i) => ring(x, y, r + breathe * 6, [0.14, 0.09, 0.05, 0.025][i], 1));
      ring(x, y, 36, 0.25 + 0.2 * breathe, 1.5);
    }

    let menuF = null, bridge = null;
    for (const f of F.values()) { if (f.menu) menuF = f; if (f.bridge) bridge = f.bridge; }
    if (scl.on) drawScaleGrid();
    drawLinks(now, bridge && bridge.m);
    for (const v of V) {
      if (!v.active) continue;
      if (menuF && menuF.voice === v && !menuF.menu.fx) continue;
      if (bridge && (bridge.A === v || bridge.B === v)) continue;
      drawVoice(v, now);
    }
    for (const f of F.values()) if (!f.voice && !f.ui) dot(f.x, f.y, 3, 0.35);
    if (bridge) drawBridge(bridge, now);
    if (menuF) drawMenu(menuF);

    drawScope();
    drawUI();
  }

  // ---------- события ----------
  cv.addEventListener('pointerdown', down, { passive: false });
  cv.addEventListener('pointermove', move);
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);

  // в iOS звук разрешается на «полноценных» жестах — ловим все
  document.addEventListener('pointerdown', unlock, { capture: true });
  document.addEventListener('touchend', unlock, { passive: true });
  document.addEventListener('click', unlock);

  document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  ['gesturestart', 'gesturechange', 'dblclick', 'contextmenu'].forEach((t) =>
    document.addEventListener(t, (e) => e.preventDefault()));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && V.some((v) => v.active)) wake();
  });
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);

  window.t2d = { voices: V, fx, scl, freq, applyFx, get ctx() { return ctx; } };   // для отладки из консоли

  resize();
  requestAnimationFrame(frame);
})();
