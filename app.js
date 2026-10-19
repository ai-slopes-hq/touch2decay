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
  const BEAT_MIN = 0.05, BEAT_MAX = 24;      // detune: от фазирования до треска
  const BEAT_DEF = 0.35;    // по умолчанию пара медленно «дышит»
  const FB_BASE = 0.3;      // гребёнка-резонатор: постоянная фоновая окраска
  const CUT_DEF = 0.5, RES_DEF = 0.21, RES_MAX = 24;   // res: Q фильтра в дБ
  const TAIL = 1.6;         // хвост после отпускания (τ, с)
  const UNPIN_TAIL = 0.8;   // хвост после снятия с закрепления
  const FM_MAX = 1.4;       // FM на полную: девиация в долях частоты
  const LINK_NEW = 0.5;     // глубина нового моста

  const tri = (t) => 1 - 4 * Math.abs((((t + 0.25) % 1) + 1) % 1 - 0.5);
  // волны — свои циклы, посчитанные как у аналоговых генераторов, а не встроенные идеальные формы
  const WAVES = [
    { label: 'triangle', fn: (t) => { const x = tri(t); return x + 0.1 * x * x; } },               // лёгкая асимметрия: чётные гармоники
    { label: 'sharp', fn: (t) => Math.tanh(2.6 * tri(t) + 0.35) },                                 // треугольник в насыщение, как у Лиры
    { label: 'saw', fn: (t) => { const k = 1.4; return (2 * (1 - Math.exp(-k * t))) / (1 - Math.exp(-k)) - 1; } },   // изгиб зарядки конденсатора
    { label: 'pulse', fn: (t) => Math.tanh(9 * (Math.sin(2 * Math.PI * t) - 0.35)) },              // узкий импульс со скруглёнными фронтами
    { label: 'fold', fn: (t) => Math.sin(2.8 * Math.sin(2 * Math.PI * t) + 0.4) },                 // волнофолдер
  ];
  const WAVE_DEF = 0.25;    // позиция морфинга: 0 — triangle … 1 — fold
  const NW = WAVES.length;

  // ---------- LFO: вторым пальцем на панели сверху, пока крутишь параметр ----------
  // форма LFO — те же таблицы с тем же морфингом
  const LFO_TARGET_LABEL = { pitch: 'pitch', wave: 'wave', cut: 'cutoff', res: 'res', beat: 'detune', fm: 'fm' };
  const LFO_RATE_MIN = 0.03, LFO_RATE_MAX = 20;

  // ---------- жесты ----------
  const VOICES = 8;         // сколько кружков может звучать одновременно
  const GRAB_R = 52;        // радиус, в котором палец «ловит» кружок, px
  const TAP_MS = 220, TAP_MOVE = 14;   // что считается тапом
  const DTAP_MS = 320;      // окно двойного тапа
  const HOLD_MS = 420, HOLD_MOVE = 10; // долгое нажатие на кружке — кольцо свойств
  const MENU_DEAD = 40, MENU_SPAN = 150;

  const deg = (d) => (d * Math.PI) / 180;
  const SECTORS = [                          // кольцо свойств кружка: пять лучей
    { key: 'wave', label: 'wave', ang: deg(-90) },
    { key: 'cut', label: 'cutoff', ang: deg(-18) },   // ±3 октавы поверх оси Y
    { key: 'res', label: 'res', ang: deg(54) },
    { key: 'beat', label: 'detune', ang: deg(126) },
    { key: 'fm', label: 'fm', ang: deg(198) },
  ];

  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerpLog = (lo, hi, t) => lo * (hi / lo) ** t;
  const invLog = (lo, hi, v) => Math.log(v / lo) / Math.log(hi / lo);
  const $ = (id) => document.getElementById(id);

  const cv = $('field');
  const g = cv.getContext('2d');
  const safeTop = $('safe-top');

  let W = 0, H = 0, DPR = 1, scopeY = 120, safeBot = 0, scan = null;

  // ---------- голоса (кружки) ----------
  const V = Array.from({ length: VOICES }, (_, i) => ({
    i, x: 0.35, dx: 0.35, wob: 0, wv: 0, y: 0.22, ox: 0, oy: 0,
    beat: BEAT_DEF, wave: WAVE_DEF, fm: 0, cut: CUT_DEF, res: RES_DEF,
    mods: [], lfo: {},
    fingers: [], pinned: false, active: false,
    env: 0, envT: 0, envTau: 0.05, emit: 0, t: 0,
    dirty: true, snap: true, nodes: null,
  }));
  let focus = V[0];
  let touchedOnce = false;
  let lastTap = null;       // { v, t } — для двойного тапа
  const F = new Map();      // pointerId -> палец
  const sel = new Set();    // кружки, обведённые лассо: двигаются вместе
  const rings = [];

  // ---------- лад: пока держишь кнопку, кружки встают на ноты ----------
  const SCALES = [                            // ступени от ля, в полутонах
    { label: 'major', steps: [0, 2, 4, 5, 7, 9, 11] },
    { label: 'minor', steps: [0, 2, 3, 5, 7, 8, 10] },
    { label: 'dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
    { label: 'phrygian', steps: [0, 1, 3, 5, 7, 8, 10] },
    { label: 'lydian', steps: [0, 2, 4, 6, 7, 9, 11] },
    { label: 'mixolydian', steps: [0, 2, 4, 5, 7, 9, 10] },
  ];
  const SEMIS = OCT * 12;
  const scl = { idx: 0, on: false, slideUntil: 0 };

  // ---------- общие эффекты (кнопка FX): посылы и характер; сухой звук не трогают ----------
  const fx = { rev: 0.3, decay: 3.5, dly: 0.3, rep: 0.46, dirt: 0.2 };
  const DECAY_MIN = 0.6, DECAY_MAX = 14, REP_MAX = 0.92;
  const FX_SECTORS = [                        // веер из правого нижнего угла: влево → вверх
    { key: 'rev', label: 'hall', ang: deg(180) },
    { key: 'decay', label: 'decay', ang: deg(202.5) },
    { key: 'dly', label: 'delay', ang: deg(225) },
    { key: 'rep', label: 'repeats', ang: deg(247.5) },
    { key: 'dirt', label: 'drive', ang: deg(270) },
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
  // низ поля — тёмный, верх — открытый; cutoff кружка сдвигает это на ±3 октавы
  const cutoff = (v) => Math.min(16000, 260 * 2 ** (v.y * 5) * 2 ** ((v.cut - 0.5) * 6));
  // dx — где кружок виден (с ладом он съезжает к ноте); wob — сдвиг от LFO на высоте
  const vx = (v) => (v.dx + v.wob) * W;
  const vy = (v) => (1 - v.y) * H;

  // значение свойства в долях 0..1 (для дуг на лучах)
  function norm(v, key) {
    if (key === 'wave') return v.wave;
    if (key === 'cut') return v.cut;
    if (key === 'res') return v.res;
    if (key === 'beat') return invLog(BEAT_MIN, BEAT_MAX, v.beat);
    return v.fm;
  }

  function setNorm(v, key, t) {
    if (key === 'wave') v.wave = t;
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
    v.ox = vx(v) - f.x;
    v.oy = vy(v) - f.y;
  }

  function follow(v) {
    if (v.fingers.length !== 1) return;
    const f = F.get(v.fingers[0]);
    if (!f || f.menu || f.bridge) return;
    v.x = clamp((f.x + v.ox) / W);
    v.y = clamp(1 - (f.y + v.oy) / H);
    v.dirty = true;
    focus = v;
    if (f.group) for (const m of f.group) {     // выделенные едут следом, сохраняя расстановку
      if (!m.u.active) continue;
      m.u.x = clamp(v.x + m.ox); m.u.y = clamp(v.y + m.oy);
      if (!scl.on) m.u.dx = m.u.x;
      m.u.dirty = true;
    }
  }

  function pointIn(poly, x, y) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }

  // петля без «подхода» от кнопки: с той точки, где обводка вернулась к себе, до конца
  function loopOf(path) {
    const n = path.length, e = path[n - 1];
    for (let i = 0; i < n - 8; i++) if (Math.hypot(path[i].x - e.x, path[i].y - e.y) < 40) return path.slice(i);
    return path;
  }

  function finishLasso(path) {
    sel.clear();
    const loop = loopOf(path);
    if (loop.length < 3) return;
    for (const v of V) if (v.active && pointIn(loop, vx(v), vy(v))) sel.add(v);
  }

  function spawn(f) {
    let v = V.find((u) => !u.active);
    if (!v) {                               // все заняты — забрать самый тихий из затухающих
      for (const u of V) if (!u.pinned && !u.fingers.length && (!v || u.env < v.env)) v = u;
    }
    if (!v) return null;
    unlinkAll(v);
    clearLfos(v);
    v.x = clamp(f.x / W); v.dx = v.x; v.y = clamp(1 - f.y / H); v.ox = 0; v.oy = 0;
    v.beat = BEAT_DEF; v.wave = WAVE_DEF; v.fm = 0; v.cut = CUT_DEF; v.res = RES_DEF;
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

  // ---------- LFO на параметрах кружка ----------
  function lfoTargets(n, key) {
    if (key === 'pitch') return [n.c1.detune, n.c2.detune, n.sub.detune];
    if (key === 'wave') return [n.morph.pos];
    if (key === 'cut') return [n.lp.detune];
    if (key === 'res') return [n.lp.Q];
    if (key === 'beat') return [n.c2.freq];
    return [n.sfm.gain];
  }

  function setLfo(v, key, spec) {
    if (!v.lfo[key]) spec.ph = 0;              // фаза для рисования: генератор тоже стартует с нуля
    v.lfo[key] = spec;
    const n = v.nodes;
    if (n && !n.lfo[key]) {
      const out = gainNode(0);
      for (const p of lfoTargets(n, key)) out.connect(p);
      const sum = gainNode(1);
      const mp = morphPos(spec.morph, false);
      const mo = morphOsc(mp.shapers, sum);
      sum.connect(out);
      n.lfo[key] = { out, mp, mo };
    }
    v.dirty = true;
  }

  function removeLfo(v, key) {
    delete v.lfo[key];
    const n = v.nodes, L = n && n.lfo[key];
    if (!L) return;
    L.out.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
    delete n.lfo[key];
    setTimeout(() => {
      for (const o of [...L.mo.oscs, L.mp.src]) { try { o.stop(); } catch (_) { /* ok */ } o.disconnect(); }
      L.out.disconnect();
    }, 400);
  }

  function clearLfos(v) { for (const key of Object.keys(v.lfo)) removeLfo(v, key); }

  // во что сейчас смотрит LFO-панель: параметр, который крутит палец (кроме волны)
  function modTarget(except) {
    for (const f of F.values()) {
      if (f !== except && f.ui === 'lfo' && f.tg) return f.tg;
    }
    for (const f of F.values()) {
      if (f === except || f.ui || !f.voice || f.bridge) continue;
      if (f.menu) return { v: f.voice, key: f.menu.sector ? f.menu.sector.key : 'pitch' };
      return { v: f.voice, key: 'pitch' };
    }
    return null;
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

    const ui = uiHit(f);
    if (ui) { f.ui = ui.k; uiDown(f); return; }

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
      if (sel.has(v)) f.group = [...sel].filter((u) => u !== v).map((u) => ({ u, ox: u.x - v.x, oy: u.y - v.y }));
    } else {
      v = spawn(f);                           // пустое место — новый кружок
      if (!v) return;
    }
    v.fingers.push(f.id);
    v.t = now;
    f.voice = v;
    rebase(v);
    follow(v);
  }

  function move(e) {
    const f = F.get(e.pointerId);
    if (!f) return;
    f.x = e.clientX; f.y = e.clientY;
    if (!f.moved && Math.hypot(f.x - f.x0, f.y - f.y0) > HOLD_MOVE) f.moved = true;
    if (f.ui) { if (f.menu) menuMove(f); else uiMove(f); return; }
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
    else if (!v.pinned) release(v, TAIL);
  }

  // ---------- кнопки: внизу FX и лад, вверху — убрать всё; сверху же — панель LFO ----------
  const BTN_R = 26, ITEM_H = 46, CLR_R = 17;
  const btnPos = (k) => {
    if (k === 'clr') return { x: W - 34, y: scopeY + 20 };
    return { x: k === 'rev' ? W - 48 : 48, y: H - safeBot - 48 };
  };
  // панель LFO: полоса морфинга под осциллографом
  const lfoPanel = () => ({ x: 16, y: scopeY + 54, w: W - 32, h: 58 });

  function uiHit(f) {
    for (const k of ['rev', 'scl', 'clr']) {
      const b = btnPos(k), r = k === 'clr' ? CLR_R + 14 : BTN_R + 16;
      if (Math.hypot(f.x - b.x, f.y - b.y) < r) return { k };
    }
    if (modTarget(f)) {
      const p = lfoPanel();
      if (f.y > p.y - 6 && f.y < p.y + p.h + 6 && f.x > p.x - 6 && f.x < p.x + p.w + 6) return { k: 'lfo' };
    }
    return null;
  }

  function allDirty() { for (const v of V) v.dirty = true; }

  // все кружки, включая закреплённые, гаснут за секунду; связи и LFO снимаются
  function clearAll() {
    for (const f of F.values()) { if (f.voice) { f.voice = null; f.menu = null; f.bridge = null; } }
    for (const v of V) {
      if (!v.active) continue;
      v.fingers = []; v.pinned = false;
      sel.delete(v);
      unlinkAll(v);
      release(v, 0.35);
      burst(v);
    }
    lastTap = null;
    sel.clear();
  }

  function uiDown(f) {
    if (f.ui === 'clr') { clearAll(); return; }
    if (f.ui === 'rev') { openFx(f); return; }
    if (f.ui === 'lfo') {
      const tg = modTarget(f);
      if (!tg) return;
      f.tg = tg;
      const p = lfoPanel(), cur = tg.v.lfo[tg.key];
      const morph = clamp((f.x - p.x) / p.w);       // куда лёг палец — та форма
      const spec = cur ? { ...cur, morph } : { morph, rate: 1.2, depth: 0.35 };
      f.rate0 = spec.rate; f.depth0 = spec.depth;
      setLfo(tg.v, tg.key, spec);
      return;
    }
    // лад: нажатие сразу включает последний лад; отпускание его оставляет
    f.wasOn = scl.on; f.picked = false;
    scl.on = true;
    scl.slideUntil = performance.now() + 500;
    allDirty();
  }

  function uiMove(f) {
    if (f.ui === 'lfo') {
      if (!f.tg) return;
      const spec = f.tg.v.lfo[f.tg.key];
      if (!spec) return;
      spec.rate = clamp(f.rate0 * 2 ** ((f.x - f.x0) / 70), LFO_RATE_MIN, LFO_RATE_MAX);   // вбок — скорость
      spec.depth = clamp(f.depth0 + (f.y - f.y0) / 220);                                 // вниз — глубина
      f.tg.v.dirty = true;
      return;
    }
    if (f.ui !== 'scl') return;
    const b = btnPos('scl');
    // повёл палец вправо вдоль низа — карандаш: обводишь кружки
    if (!f.lasso && !f.picked && f.x > b.x + 56 && f.y > b.y - 50) {
      f.lasso = [];
      if (scl.on !== f.wasOn) { scl.on = f.wasOn; scl.slideUntil = performance.now() + 500; allDirty(); }
    }
    if (f.lasso) {
      const lp = f.lasso[f.lasso.length - 1];
      if (!lp || Math.hypot(f.x - lp.x, f.y - lp.y) > 4) f.lasso.push({ x: f.x, y: f.y });
      return;
    }
    if (f.y > b.y - 40) return;
    // строки списка снизу вверх: off, затем лады
    const row = clamp(Math.floor((b.y - 40 - f.y) / ITEM_H), 0, SCALES.length);
    f.picked = true;
    const on = row > 0, idx = on ? row - 1 : scl.idx;
    if (on !== scl.on || idx !== scl.idx) {
      scl.on = on; scl.idx = idx;
      scl.slideUntil = performance.now() + 500;
      allDirty();
    }
  }

  function uiUp(f) {
    if (f.ui === 'lfo') {
      if (!f.tg) return;
      const spec = f.tg.v.lfo[f.tg.key];
      if (spec && spec.depth < 0.03) removeLfo(f.tg.v, f.tg.key);   // глубину увёл в ноль — LFO снят
      return;
    }
    if (f.ui !== 'scl') return;
    if (f.lasso) { finishLasso(f.lasso); return; }
    // короткий тап по уже включённому ладу — выключить; выбор из списка остаётся как есть
    if (!f.picked && f.wasOn && performance.now() - f.t0 < 300) {
      scl.on = false;
      scl.slideUntil = performance.now() + 500;
      allDirty();
    }
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
    if (key === 'decay') return fx.decay.toFixed(fx.decay < 10 ? 1 : 0) + ' s';
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

  // ---------- кольцо свойств кружка ----------
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

  // tanh-кривая: normed=true — выход до ±1 (мастер), false — наклон 1 в нуле (петля обратной связи)
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

  // вес таблицы i при позиции морфинга: треугольный, соседние таблицы перетекают линейно
  const weight = (i, p) => Math.max(0, 1 - Math.abs(clamp(p) * (NW - 1) - i));
  // кривая для WaveShaper: вход −1..1 — это позиция 0..1, выход — вес (с громкостью таблицы или без)
  function weightCurve(i, level, shape = 1) {
    const n = 1024, c = new Float32Array(n);
    for (let j = 0; j < n; j++) c[j] = weight(i, j / (n - 1)) ** shape * level;
    return c;
  }
  // форма в точке t при позиции p — для рисования
  const morphFn = (p) => (t) => {
    let y = 0;
    for (let i = 0; i < NW; i++) { const k = weight(i, p); if (k) y += k * WAVES[i].samp[Math.floor((((t % 1) + 1) % 1) * 1024) % 1024]; }
    return y;
  };
  function morphName(p) {
    const x = clamp(p) * (NW - 1), i = Math.min(NW - 2, Math.floor(x)), fr = x - i;
    if (fr < 0.08) return WAVES[i].label;
    if (fr > 0.92) return WAVES[i + 1].label;
    return `${WAVES[i].label} → ${WAVES[i + 1].label}`;
  }

  // цикл волны → гармоники → PeriodicWave; громкость выравнивается по RMS
  function makeWave(w) {
    const N = 1024, HARM = 220, smp = new Float64Array(N);
    let mean = 0;
    for (let i = 0; i < N; i++) { smp[i] = w.fn(i / N); mean += smp[i] / N; }
    let peak = 0;
    for (let i = 0; i < N; i++) { smp[i] -= mean; peak = Math.max(peak, Math.abs(smp[i])); }
    let rms = 0;
    for (let i = 0; i < N; i++) { smp[i] /= peak; rms += (smp[i] * smp[i]) / N; }
    const re = new Float32Array(HARM), im = new Float32Array(HARM);
    for (let h = 1; h < HARM; h++) {
      let a = 0, b = 0;
      for (let i = 0; i < N; i++) { const ph = (2 * Math.PI * h * i) / N; a += smp[i] * Math.cos(ph); b += smp[i] * Math.sin(ph); }
      re[h] = (2 * a) / N; im[h] = (2 * b) / N;
    }
    w.pw = ctx.createPeriodicWave(re, im);
    w.level = 0.24 / Math.sqrt(rms);
  }

  // нормированные циклы для рисования считаются сразу, без звука
  for (const w of WAVES) {
    const N = 1024, smp = new Float32Array(N);
    let mean = 0, peak = 0;
    for (let i = 0; i < N; i++) { smp[i] = w.fn(i / N); mean += smp[i] / N; }
    for (let i = 0; i < N; i++) { smp[i] -= mean; peak = Math.max(peak, Math.abs(smp[i])); }
    for (let i = 0; i < N; i++) smp[i] /= peak;
    w.samp = smp;
  }

  // генератор с морфингом: по осциллятору на таблицу, их веса — из позиции (позиция — звуковой сигнал,
  // поэтому её можно модулировать хоть на звуковой скорости). Частота и строй — общие на весь набор.
  function morphOsc(shapers, dest) {
    const fq = ctx.createConstantSource(); fq.offset.value = 0;
    const dt = ctx.createConstantSource(); dt.offset.value = 0;
    const oscs = [fq, dt];
    WAVES.forEach((w, i) => {
      const o = ctx.createOscillator(); o.setPeriodicWave(w.pw); o.frequency.value = 0;
      fq.connect(o.frequency); dt.connect(o.detune);
      const gn = gainNode(0);
      shapers[i].connect(gn.gain);
      o.connect(gn).connect(dest);
      oscs.push(o);
    });
    for (const o of oscs) o.start();
    return { freq: fq.offset, detune: dt.offset, oscs };
  }

  // позиция морфинга → веса таблиц
  function morphPos(p, withLevel) {
    const c = ctx.createConstantSource(); c.offset.value = 2 * p - 1; c.start();
    const shapers = WAVES.map((w, i) => {
      const sh = ctx.createWaveShaper(); sh.curve = withLevel ? weightCurve(i, w.level, 0.72) : weightCurve(i, 1);
      c.connect(sh);
      return sh;
    });
    return { pos: c.offset, src: c, shapers };
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
      const gn = gainNode(0.7);
      x.connect(i % 2 ? gainNode(-1) : gainNode(1)).connect(d);
      d.connect(damp).connect(gn);
      gn.connect(d);
      gn.connect(mix);
      mix.connect(d);
      d.connect(merge, 0, i % 2);
      lines.push({ g: gn, len });
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

  let noiseBuf = null;
  function build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC({ latencyHint: 'interactive' });
    for (const w of WAVES) makeWave(w);
    noiseBuf = noiseBuffer(4);
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf; noise.loop = true; noise.start();

    // шина голосов → drive (перегруз) → сухой звук; дилей и зал — посылы поверх него
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

    for (const v of V) {
      v.nodes = voiceNodes(v, noise, bus); v.snap = true; v.dirty = true;
      for (const [key, spec] of Object.entries(v.lfo)) setLfo(v, key, spec);
    }
  }

  function voiceNodes(v, noise, bus) {
    const k = 1 + v.i * 0.137;                  // у каждого кружка свои скорости дыхания
    const pan = (p) => { if (!ctx.createStereoPanner) return gainNode(1); const s = ctx.createStereoPanner(); s.pan.value = p; return s; };

    // пара осцилляторов, разведённая по стерео; второй сдвинут на detune
    // обе половины пары морфят по таблицам из одной позиции
    const tone = gainNode(1);
    const morph = morphPos(v.wave, true);
    const p1 = pan(-0.5), p2 = pan(0.5);
    p1.connect(tone); p2.connect(tone);
    const c1 = morphOsc(morph.shapers, p1), c2 = morphOsc(morph.shapers, p2);
    const sub = ctx.createOscillator(), m = ctx.createOscillator();
    sub.type = 'sine'; m.type = 'sine';
    sub.connect(gainNode(0.28)).connect(tone);
    for (const o of [sub, m]) o.start();

    // живость: медленный дрейф строя у каждого осциллятора по-своему…
    lfo(0.071 * k, 5, c1.detune); lfo(0.19 * k, 2.5, c1.detune);
    lfo(0.053 * k, 6, c2.detune); lfo(0.23 * k, 2, c2.detune);
    // …и быстрая аналоговая нестабильность: свой шум, отфильтрованный до десятков герц, ±3 цента
    const jit = ctx.createBufferSource();
    jit.buffer = noiseBuf; jit.loop = true; jit.start(0, Math.random() * 3.5);
    jit.connect(filter('lowpass', 23 * k, -3)).connect(gainNode(140)).connect(c1.detune);
    jit.connect(filter('lowpass', 31 * k, -3)).connect(gainNode(-140)).connect(c2.detune);

    // модулятор: собственная FM и выход для мостов. Сам он ничем не модулируется — петель нет
    const sfm = gainNode(0); m.connect(sfm);
    const fmTargets = [c1.freq, c2.freq];
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

    // гребёнка, настроенная на высоту: тихая постоянная окраска
    const sum = gainNode(1);
    env.connect(sum);
    const dl = ctx.createDelay(1);
    const loopLP = filter('lowpass', 3000, -3);
    const loopSat = ctx.createWaveShaper(); loopSat.curve = soft(1.6, false);
    const fb = gainNode(FB_BASE);
    env.connect(dl);
    dl.connect(loopLP).connect(loopSat).connect(fb).connect(dl);
    dl.connect(gainNode(0.45)).connect(sum);

    const lvl = gainNode(0.55);
    lfo(0.09 * k, 0.07, lvl.gain);               // громкость чуть дышит
    const out = pan(0);
    sum.connect(lvl).connect(out).connect(bus);

    return { c1, c2, sub, m, morph, sfm, mod, driveIn, lp, bp, nz, hiss, env, dl, out, fmTargets, lfo: {} };
  }

  function apply(v) {
    const n = v.nodes;
    if (!n) return;
    const t = ctx.currentTime, s = v.snap;
    v.snap = false;
    const T = (p, val, tau) => p.setTargetAtTime(val, t, s ? 0.004 : tau);
    const f = freq(v), y = v.y, G = 0.14;
    T(n.c1.freq, f, G);
    T(n.c2.freq, f + v.beat, G);
    T(n.sub.frequency, f / 2, G);
    T(n.m.frequency, f, G);
    T(n.morph.pos, 2 * v.wave - 1, 0.04);
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
    if (n.out.pan) T(n.out.pan, (v.x - 0.5) * 0.6, 0.2);
    T(n.sfm.gain, f * FM_MAX * v.fm, 0.08);
    for (const m of v.mods) if (m.g) T(m.g.gain, f * FM_MAX * m.depth, 0.08);
    // LFO: скорость и глубина в единицах своей цели
    for (const [key, spec] of Object.entries(v.lfo)) {
      const L = n.lfo[key];
      if (!L) continue;
      L.mo.freq.setTargetAtTime(spec.rate, t, 0.05);
      L.mp.pos.setTargetAtTime(2 * spec.morph - 1, t, 0.05);
      const d2 = spec.depth;
      const depth = key === 'pitch' ? d2 * 700 : key === 'wave' ? d2 * 2 : key === 'cut' ? d2 * 4800
        : key === 'res' ? d2 * 20 : key === 'beat' ? d2 * 16 : d2 * f * FM_MAX;
      L.out.gain.setTargetAtTime(depth, t, 0.05);
    }
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
    safeBot = $('safe-bot').offsetHeight;
    const c = document.createElement('canvas');
    c.width = cv.width; c.height = cv.height;
    const x = c.getContext('2d');
    x.fillStyle = `rgba(${INK},0.035)`;
    const step = Math.max(2, Math.round(4 * DPR)), hl = Math.max(1, Math.round(DPR * 0.75));
    for (let y = 0; y < c.height; y += step) x.fillRect(0, y, c.width, hl);
    scan = c;
  }

  const ink = (a) => `rgba(${INK},${a})`;
  const MONO = '"IBM Plex Mono", ui-monospace, Menlo, monospace';
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
  function rrect(x, y, w, h, r) {
    g.beginPath();
    if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h);
  }

  // кривая по функции одного цикла: волна кружка или форма LFO
  function drawCurve(fn, x, y, w, h, a, cycles = 2, lw = 1.6) {
    g.save();
    g.strokeStyle = ink(a); g.lineWidth = lw; g.lineJoin = 'round';
    g.beginPath();
    const N = 96;
    for (let i = 0; i <= N; i++) {
      const t = i / N, v = clamp(fn((t * cycles) % 1), -1.2, 1.2);
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
    if (held) glowRing(x, y, 36, a); else ring(x, y, 36, a, 2);
    if (sel.has(v)) {                           // выделен лассо — бегущий пунктир
      g.save(); g.setLineDash([4, 5]); g.lineDashOffset = -now * 0.03;
      ring(x, y, 44, Math.max(0.5, a), 1.2); g.restore();
    }
    if (v.pinned) { drawCurve(morphFn(clamp(v.wave + v.wv)), x, y, 22, 12, a, 1, 1.8); ring(x, y, 46, a * 0.45, 1); }
    else dot(x, y, 3.5, a);
    // у каждого LFO своя орбита: точка бежит со скоростью LFO
    Object.values(v.lfo).forEach((spec, i) => {
      const r = 52 + i * 7, ph = (spec.ph || 0) * Math.PI * 2;
      dot(x + Math.cos(ph) * r, y + Math.sin(ph) * r, 2.2, a * (0.4 + 0.6 * spec.depth));
    });
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
      glowRing(x, y, 36, 1);
      if (v.pinned) drawCurve(morphFn(clamp(v.wave + v.wv)), x, y, 22, 12, 1, 1, 1.8);
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

  function valueText(v, key) {
    if (key === 'wave') return morphName(v.wave);
    if (key === 'cut') { const c = cutoff(v); return c >= 1000 ? (c / 1000).toFixed(1) + ' kHz' : Math.round(c) + ' Hz'; }
    if (key === 'res') return Math.round(v.res * 100) + '%';
    if (key === 'beat') return v.beat.toFixed(v.beat < 10 ? 2 : 1) + ' Hz';
    return Math.round(v.fm * 100) + '%';
  }

  // кольцо свойств / веер FX: лучи с подписями; дуга на луче — текущее значение
  function drawMenu(f) {
    const m = f.menu, v = f.voice;
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
      if (sc.key === 'wave') {                  // у волны — метки таблиц на луче
        for (let i = 0; i < NW; i++) {
          const r = R1 + (i / (NW - 1)) * MENU_SPAN;
          g.beginPath(); g.arc(m.cx, m.cy, r, sc.ang - 0.06, sc.ang + 0.06); g.stroke();
        }
      }
      const rv = R1 + m.get(sc.key) * MENU_SPAN;
      g.strokeStyle = ink(a); g.lineWidth = on ? 3 : 2;
      g.beginPath(); g.arc(m.cx, m.cy, rv, sc.ang - 0.17, sc.ang + 0.17); g.stroke();
      const lx = clamp(m.cx + c * (R2 + 24), 30, W - 30), ly = clamp(m.cy + sn * (R2 + 24), 16, H - 16);
      if (!on) {                                // у выбранного луча подпись уходит в значение над пальцем
        g.fillStyle = ink(a);
        g.font = `400 13px ${MONO}`;
        g.fillText(sc.label + (v && v.lfo[sc.key] ? ' ~' : ''), lx, ly);
      }
    }
    if (m.sector) {
      g.strokeStyle = ink(0.5); g.lineWidth = 1;
      g.beginPath(); g.moveTo(m.cx, m.cy); g.lineTo(f.x, f.y); g.stroke();
      // у кружка значение над пальцем; у веера FX — над веером, где его ничто не перекрывает
      const tx = m.fx ? m.cx - R2 * 0.55 : clamp(f.x, 80, W - 80);
      const ty = m.fx ? m.cy - R2 - 70 : f.y - 70;
      if (m.sector.key === 'wave') drawCurve(morphFn(clamp(v.wave + v.wv)), tx, ty - 30, 60, 22, 1);
      g.fillStyle = ink(1);
      g.font = `500 15px ${MONO}`;
      g.fillText(`${m.sector.label} · ${m.text(m.sector.key)}`, tx, ty);
    }
    g.textAlign = 'start'; g.textBaseline = 'alphabetic';
    if (v) {
      glowRing(m.cx, m.cy, 36, 1);
      if (v.pinned) drawCurve(morphFn(clamp(v.wave + v.wv)), m.cx, m.cy, 22, 12, 1, 1, 1.8); else dot(m.cx, m.cy, 3.5, 1);
    }
  }

  // панель LFO: полоса морфинга из тех же таблиц; маркер — форма LFO; вниз — глубина, вбок — скорость
  function drawLfoPanel(tg) {
    const p = lfoPanel(), spec = tg.v.lfo[tg.key];
    let lf = null;
    for (const f of F.values()) if (f.ui === 'lfo') lf = f;
    g.fillStyle = 'rgba(0,0,0,0.85)';
    g.fillRect(0, p.y - 10, W, p.h + 44);
    rrect(p.x, p.y, p.w, p.h, 10);
    g.strokeStyle = ink(lf ? 0.8 : 0.4); g.lineWidth = 1; g.stroke();
    for (let i = 0; i < NW; i++) {             // таблицы на своих местах полосы
      const x = p.x + 18 + (i / (NW - 1)) * (p.w - 36);
      drawCurve(WAVES[i].fn, x, p.y + p.h / 2, 30, 18, 0.35, 1, 1.2);
    }
    if (spec) {
      const mx = p.x + 18 + spec.morph * (p.w - 36);
      g.fillStyle = ink(0.12); rrect(mx - 26, p.y + 4, 52, p.h - 8, 8); g.fill();
      drawCurve(morphFn(spec.morph), mx, p.y + p.h / 2, 40, 22, 1, 1.5, 1.6);
    }
    g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillStyle = ink(lf ? 1 : 0.6); g.font = `${lf ? 500 : 400} 12px ${MONO}`;
    const what = `LFO → ${LFO_TARGET_LABEL[tg.key]}`;
    const tail = spec
      ? `  ·  ${morphName(spec.morph)}  ·  ${spec.rate.toFixed(spec.rate < 10 ? 2 : 1)} Hz  ·  ${Math.round(spec.depth * 100)}%`
      : '  ·  2nd finger here';
    g.fillText(what + tail, 16, p.y + p.h + 18);
    g.textBaseline = 'alphabetic'; g.textAlign = 'start';
  }

  // сетка нот лада — пока кнопка лада зажата
  function drawScaleGrid(held) {
    const st = SCALES[scl.idx].steps, k = held ? 1 : 0.5;
    g.save();
    g.setLineDash([2, 6]);
    for (let n = 0; n <= SEMIS; n++) {
      if (!st.includes(n % 12)) continue;
      const x = Math.round((n / SEMIS) * W) + 0.5;
      g.strokeStyle = ink((n % 12 === 0 ? 0.3 : 0.12) * k); g.lineWidth = 1;
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
    if (sclF && sclF.lasso) {                   // обводка карандашом
      g.save(); g.setLineDash([3, 4]); g.strokeStyle = ink(0.85); g.lineWidth = 1.4;
      g.beginPath(); sclF.lasso.forEach((pt, i) => (i ? g.lineTo(pt.x, pt.y) : g.moveTo(pt.x, pt.y)));
      if (sclF.lasso.length > 2) g.closePath();
      g.stroke(); g.restore();
      const loop = loopOf(sclF.lasso);
      for (const v of V) if (v.active && loop.length > 2 && pointIn(loop, vx(v), vy(v))) ring(vx(v), vy(v), 44, 0.9, 1.5);
    } else if (sclF) {
      // справа от кнопки — карандаш: туда повести палец, чтобы обвести кружки
      const px = b.x + 74, py = b.y;
      g.save(); g.translate(px, py); g.rotate(-Math.PI / 4);
      g.strokeStyle = ink(0.8); g.lineWidth = 1.4;
      g.strokeRect(-12, -3.5, 20, 7);
      g.beginPath(); g.moveTo(8, -3.5); g.lineTo(14, 0); g.lineTo(8, 3.5); g.stroke();
      g.restore();
      g.strokeStyle = ink(0.4); g.lineWidth = 1;
      g.beginPath(); g.moveTo(b.x + BTN_R + 8, py); g.lineTo(px - 18, py); g.stroke();
    }
    if (sclF && !sclF.lasso) {
      const rows = ['off', ...SCALES.map((sc) => sc.label)];
      const n = rows.length, top = b.y - 40 - n * ITEM_H;
      g.fillStyle = 'rgba(0,0,0,0.88)';
      rrect(b.x - 30, top - 8, 190, n * ITEM_H + 16, 14); g.fill();
      g.textAlign = 'left';
      rows.forEach((label, i) => {
        const y = b.y - 40 - ITEM_H * (i + 0.5), on = i === 0 ? !scl.on : scl.on && i - 1 === scl.idx;
        g.fillStyle = ink(on ? 1 : 0.45);
        g.font = `${on ? 500 : 400} 15px ${MONO}`;
        g.fillText(label, b.x - 8, y);
        if (on) dot(b.x - 18, y, 3, 1);
      });
    } else if (scl.on && !sclF) {               // лад включён — его имя рядом с кнопкой
      g.textAlign = 'left'; g.fillStyle = ink(0.55); g.font = `400 12px ${MONO}`;
      g.fillText(SCALES[scl.idx].label, b.x + BTN_R + 12, b.y);
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
    const sx = 18, sw = W - sx - 70, sh = 40, mid = scopeY + sh / 2;
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

    // LFO видно: высота качает кружок по полю, волна — форму в метке
    for (const v of V) {
      v.wob = 0; v.wv = 0;
      for (const [key, spec] of Object.entries(v.lfo)) {
        spec.ph = ((spec.ph || 0) + dt * spec.rate) % 1;
        const val = morphFn(spec.morph)(spec.ph) * spec.depth;
        if (key === 'pitch') v.wob = (val * 700) / 100 / SEMIS;
        else if (key === 'wave') v.wv = val;
      }
    }

    let anyActive = false;
    for (const v of V) {
      if (v.dirty) { v.dirty = false; apply(v); }
      v.env += (v.envT - v.env) * (1 - Math.exp(-dt / v.envTau));
      if (v.active && !v.pinned && !v.fingers.length && v.envT === 0 && v.env < 0.004) {
        v.active = false;
        sel.delete(v);
        unlinkAll(v);
        clearLfos(v);
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

    // перекрестие текущего кружка
    const fx0 = Math.round(vx(focus)) + 0.5, fy0 = Math.round(vy(focus)) + 0.5;
    g.strokeStyle = LINE; g.lineWidth = 1; g.beginPath();
    g.moveTo(fx0, 0); g.lineTo(fx0, H); g.moveTo(0, fy0); g.lineTo(W, fy0); g.stroke();

    // волны от кружков
    for (const v of V) {
      if (!v.active || v.env < 0.02) continue;
      v.emit += dt;
      if (v.emit >= 1.1 - 0.6 * v.y) {
        v.emit = 0;
        if (rings.length < 220) rings.push({ x: vx(v), y: vy(v), r: 34, a: v.env, sp: 60 + freq(v) * 0.28 });
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
    if (scl.on) drawScaleGrid([...F.values()].some((f) => f.ui === 'scl'));
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
    const tg = modTarget(null);
    if (tg) drawLfoPanel(tg);
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

  window.t2d = { voices: V, fx, scl, sel, freq, applyFx, get ctx() { return ctx; } };   // для отладки из консоли

  resize();
  requestAnimationFrame(frame);
})();
