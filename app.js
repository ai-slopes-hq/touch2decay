// touch2decay — дрон / нойз на 1–2 пальца. Web Audio + canvas, без зависимостей.
(() => {
  'use strict';

  // ---------- палитра: пока ч/б, цвета добавлять здесь ----------
  const INK = '237,237,237';                 // rgb без альфы
  const LINE = 'rgba(237,237,237,0.10)';
  const BG = '#000';

  // ---------- звук ----------
  const F_LO = 55;          // нижняя нота поля (A1)
  const OCT = 5;            // весь диапазон: A1–A6, 55–1760 Гц; на экране — сколько позволяет зум
  const SEMIS = OCT * 12;
  const WARP = 1.45;        // как у эквалайзеров: нижним октавам больше места, верхним меньше
  const BEAT_MIN = 0.05, BEAT_MAX = 24;      // detune: от фазирования до треска
  const BEAT_DEF = 0.35;    // по умолчанию пара медленно «дышит»
  const FB_BASE = 0.3;      // гребёнка-резонатор: постоянная фоновая окраска
  const CUT_LO = 40, CUT_HI = 18000, CUT_DEF = 0.68;   // cutoff — на весь слышимый диапазон
  const RES_DEF = 0.21, RES_MAX = 24;        // res: Q фильтра в дБ
  const TAIL = 1.6;         // хвост после отпускания (τ, с)
  const UNPIN_TAIL = 0.8;   // хвост после снятия с закрепления
  const FM_MAX = 1.4;       // собственная fm на полную: девиация в долях частоты
  const LINK_NEW = 0.5;     // глубина нового моста
  const LINK_TYPES = ['fm', 'tzfm', 'am', 'rm'];

  const tri = (t) => 1 - 4 * Math.abs((((t + 0.25) % 1) + 1) % 1 - 0.5);
  const GRAIN = (() => { let s = 11; return Array.from({ length: 40 }, () => { s = (s * 16807) % 2147483647; return Math.tanh(3 * ((s / 2147483647) * 2 - 1)); }); })();
  // волны — свои циклы, посчитанные как у аналоговых генераторов, а не встроенные идеальные формы
  const WAVES = [
    { label: 'triangle', fn: (t) => { const x = tri(t); return x + 0.1 * x * x; } },               // лёгкая асимметрия: чётные гармоники
    { label: 'sharp', fn: (t) => Math.tanh(2.6 * tri(t) + 0.35) },                                 // треугольник в насыщение, как у Лиры
    { label: 'saw', fn: (t) => { const k = 1.4; return (2 * (1 - Math.exp(-k * t))) / (1 - Math.exp(-k)) - 1; } },   // изгиб зарядки конденсатора
    { label: 'pulse', fn: (t) => Math.tanh(9 * (Math.sin(2 * Math.PI * t) - 0.35)) },              // узкий импульс со скруглёнными фронтами
    { label: 'fold', fn: (t) => Math.sin(2.8 * Math.sin(2 * Math.PI * t) + 0.4) },                 // волнофолдер
    // злые: дальше по той же линии морфинга
    { label: 'sync', fn: (t) => (2 * ((t * 2.63) % 1) - 1) * (1 - 0.35 * t) },                     // жёсткая синхронизация: пила рвётся на краю цикла
    { label: 'crush', fn: (t) => Math.round(Math.sin(2 * Math.PI * (Math.floor(t * 8) + 0.5) / 8) * 2.5) / 2.5 },   // 8 отсчётов, 5 уровней — цифровой хруст
    { label: 'metal', fn: (t) => Math.sin(2 * Math.PI * t + 2.2 * Math.sin(2 * Math.PI * 7 * t)) }, // фазовая модуляция на 7-й гармонике: гнусаво, металлически
    { label: 'grain', fn: (t) => { const x = t * GRAIN.length, i = Math.floor(x) % GRAIN.length, fr = x - Math.floor(x); return GRAIN[i] + (GRAIN[(i + 1) % GRAIN.length] - GRAIN[i]) * fr; } },   // застывший кусок шума: хрип сломанного радио
  ];
  const WAVE_DEF = 0.125;   // позиция морфинга: 0 — triangle … 1 — grain; 0.125 — sharp
  const NW = WAVES.length;

  // ---------- LFO: панель внизу, пока открыто кольцо; пад — скорость и глубина одним жестом ----------
  const LFO_TARGET_LABEL = { pitch: 'pitch', wave: 'wave', cut: 'cutoff', res: 'res', beat: 'detune', fm: 'fm', shift: 'shift', amp: 'amp' };
  const LFO_RATE_MIN = 0.03, LFO_RATE_MAX = 20;

  // ---------- жесты ----------
  const VOICES = 6;         // сколько кружков может звучать одновременно: 3 закреплённых + 3 временных
  const PIN_MAX = 3, TEMP_MAX = 3;
  const GRAB_R = 52;        // радиус, в котором палец «ловит» кружок, px
  const TAP_MS = 220, TAP_MOVE = 14;   // что считается тапом
  const DTAP_MS = 320;      // окно двойного тапа: закрепить / открепить кружок
  const HOLD_MS = 420, HOLD_MOVE = 10; // долгое касание кружка — кольцо свойств на весу
  const MENU_DEAD = 40;
  let MENU_SPAN = 150;       // на узком экране кольцо меньше, чтобы лучи с подписями помещались
  const HANDLE_R = 24;      // ручка на середине связи

  const deg = (d) => (d * Math.PI) / 180;
  const SECTORS = [                          // кольцо свойств кружка: шесть лучей
    { key: 'wave', label: 'wave', ang: deg(-90) },
    { key: 'cut', label: 'cutoff', ang: deg(-30) },
    { key: 'res', label: 'res', ang: deg(30) },
    { key: 'beat', label: 'detune', ang: deg(90) },
    { key: 'fm', label: 'fm', ang: deg(150) },
    { key: 'shift', label: 'shift', ang: deg(210) },
  ];
  // сдвиг частоты: середина луча — ноль, дальше вверх, ближе к центру — вниз; до ±1.5 кГц, у нуля — медленно
  const SHIFT_DEF = 0.5, SHIFT_MAX = 1500;
  const shiftHz = (t) => {
    const u = 2 * t - 1, a = Math.abs(u);
    return a < 0.04 ? 0 : Math.sign(u) * (2 ** (((a - 0.04) / 0.96) * 11) - 1) * (SHIFT_MAX / 2047);
  };
  const LINK_SECTORS = [                     // кольцо связи: характер и глубина; cut — удалить
    { key: 'fm', label: 'fm', ang: deg(-90) },
    { key: 'tzfm', label: 'tzfm', ang: deg(-18) },
    { key: 'am', label: 'am', ang: deg(54) },
    { key: 'rm', label: 'rm', ang: deg(126) },
    { key: 'cut', label: 'cut', ang: deg(198) },
  ];
  const NOTES = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];

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
    beat: BEAT_DEF, wave: WAVE_DEF, fm: 0, cut: CUT_DEF, res: RES_DEF, shift: SHIFT_DEF, amp: 1, hole: 0, holeT: 0,
    mods: [], lfo: {},
    fingers: [], pinned: false, active: false,
    env: 0, envT: 0, envTau: 0.05, emit: 0, t: 0,
    dirty: true, snap: true, nodes: null,
  }));
  let focus = V[0];
  let touchedOnce = false;
  let lastTap = null;       // { v, t } — для двойного тапа
  const full = [];          // касания, которым не хватило голоса — для рисования отказа
  const F = new Map();      // pointerId -> палец
  const sel = new Set();    // кружки, обведённые лассо: двигаются и правятся вместе
  const rings = [];

  // ---------- лад ----------
  const SCALES = [                            // ступени от тоники, в полутонах
    { label: 'major', steps: [0, 2, 4, 5, 7, 9, 11] },
    { label: 'minor', steps: [0, 2, 3, 5, 7, 8, 10] },
    { label: 'dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
    { label: 'phrygian', steps: [0, 1, 3, 5, 7, 8, 10] },
    { label: 'lydian', steps: [0, 2, 4, 6, 7, 9, 11] },
    { label: 'mixolydian', steps: [0, 2, 4, 5, 7, 9, 10] },
  ];
  const scl = { idx: 0, root: 0, on: false, slideUntil: 0 };

  // ---------- общие эффекты (кнопка FX): посылы и характер; сухой звук не трогают ----------
  const fx = { rev: 0.3, decay: 3.5, dly: 0.3, chaos: 0, dirt: 0.2 };
  const DECAY_MIN = 0.6, DECAY_MAX = 14, DLY_REPEATS = 0.46;
  const FX_SECTORS = [                        // веер от кнопки вверху: влево → вниз
    { key: 'rev', label: 'hall', ang: deg(180) },
    { key: 'decay', label: 'decay', ang: deg(157.5) },
    { key: 'dly', label: 'delay', ang: deg(135) },
    { key: 'chaos', label: 'chaos', ang: deg(112.5) },
    { key: 'dirt', label: 'drive', ang: deg(90) },
  ];

  // поле по горизонтали: x 0..1 → полутоны от A1, с растяжкой низа
  const semi = (x) => SEMIS * clamp(x) ** WARP;
  const xOf = (s) => (clamp(s, 0, SEMIS) / SEMIS) ** (1 / WARP);
  const inScale = (n) => SCALES[scl.idx].steps.includes((((n - scl.root) % 12) + 12) % 12);

  function quantX(x) {
    const s = semi(x);
    let best = s, bd = 99;
    for (let n = Math.floor(s) - 7; n <= Math.ceil(s) + 7; n++) {
      if (n < 0 || n > SEMIS || !inScale(n)) continue;
      const d = Math.abs(n - s);
      if (d < bd) { bd = d; best = n; }
    }
    return xOf(best);
  }
  const soundX = (v) => (scl.on ? quantX(v.x) : v.x);
  const freq = (v) => F_LO * 2 ** (semi(soundX(v)) / 12);
  // сколько FM на кружке: пока она есть, фильтр приоткрывается — иначе он съедает боковые полосы
  const fmOpen = (v) => Math.min(1, v.fm + v.mods.reduce((s, m) => s + (m.type === 'fm' || m.type === 'tzfm' ? m.depth : 0), 0));
  // cutoff кружка — на весь диапазон; ось Y ведёт его ещё на ±2.25 октавы: внизу тёмно, вверху открыто
  const cutoff = (v) => clamp(lerpLog(CUT_LO, CUT_HI, v.cut) * 2 ** ((v.y - 0.5) * 4.5) * 2 ** (1.5 * fmOpen(v)), 20, 20000);
  // dx — где кружок виден (с ладом он съезжает к ноте); wob — сдвиг от LFO на высоте
  const vx = (v) => place(v.dx + v.wob, v.y).x;
  const vy = (v) => place(v.dx + v.wob, v.y).y;

  // ---------- поле: полярные координаты от нижнего левого угла ----------
  // высота — расстояние от угла, характер — место на дуге: у нижнего/правого края чисто, у левого/верхнего шум.
  // Координата высоты (0..1) — доля площади поля ближе к углу, поэтому полутоны делят площадь так же,
  // как прежде делили ширину: нижним октавам — больше всего места (sub и bass — около двух третей)
  const EDGE = 26;            // отступ кружков от краёв поля
  const EDGE_B = EDGE;        // снизу кнопок нет
  const SUN_R = 100;          // зона солнца: лучи (до ~70) + планета (до 34) — планеты на солнце не наезжают; 55 Гц — на её краю
  const EDGE_T = 64;          // сверху — ниже строки с заголовком и кнопками
  // чёрная дыра — в дальнем шумном углу (вверху слева), выступает на четверть, как солнце: за горизонтом событий тон
  // съеден и уходит в шум, глубже шум глохнет — звук умирает; отпущенная там планета гаснет насовсем.
  // Касанием туда не попасть (планета встаёт снаружи) — только затащить. Глубина запоминается, пока тащишь: звук от зума не меняется
  const HOLE_R = 84;
  const holeAt = () => ({ x: 0, y: geo.top + EDGE_T });   // угол поля под строкой кнопок
  // краешек дыры — вдоль всего шумного края поля (там кончаются все орбиты), по касательной к ней: слабо съедает тон на любой высоте
  const RIM_H = 0.35, RIM_W = 16;
  function holeDepth(x, y) {
    const c = holeAt(), core = clamp((HOLE_R - Math.hypot(x - c.x, y - c.y)) / (HOLE_R * 0.6));
    const edge = Math.min(x - EDGE, y - (geo.top + EDGE_T));   // до шумного края; за ним — меньше нуля
    return Math.max(core, RIM_H * clamp((RIM_W - edge) / (2 * RIM_W)));
  }
  function outOfHole(x, y) {                  // точку внутри горизонта — наружу, в сторону поля
    const c = holeAt(), dx = Math.max(0, x - c.x), dy = Math.max(0, y - c.y), d = Math.hypot(dx, dy);
    if (Math.hypot(x - c.x, y - c.y) > HOLE_R + 2) return { x, y };
    const k = (HOLE_R + 2) / (d || 1), ux = d ? dx : Math.SQRT1_2, uy = d ? dy : Math.SQRT1_2;
    return { x: c.x + ux * k, y: c.y + uy * k };
  }
  const geo = { ox: 0, oy: 0, top: 0, bot: 0, step: 2, r: [0], a: [0] };
  function arcSpan(r) {
    const w = W - EDGE, h = geo.oy - geo.top - EDGE_T;
    if (r <= SUN_R) return null;             // у самого солнца планет нет
    const lo = Math.max(Math.asin(Math.min(1, EDGE_B / r)), Math.acos(Math.min(1, w / r)));
    const hi = Math.min(Math.acos(Math.min(1, EDGE / r)), Math.asin(Math.min(1, h / r)));
    return hi > lo ? [lo, hi] : null;
  }
  function buildGeo() {
    geo.top = scopeY - 12; geo.bot = H - safeBot - 4; geo.ox = 0; geo.oy = geo.bot;   // карта — на весь экран, кнопки поверх
    geo.r = []; geo.a = [];
    let acc = 0;
    for (let r = EDGE; r < Math.hypot(W, geo.bot - geo.top) + 4; r += geo.step) {
      const sp = arcSpan(r);
      if (sp) acc += (sp[1] - sp[0]) * r * geo.step;
      geo.r.push(r); geo.a.push(acc);
    }
    for (let i = 0; i < geo.a.length; i++) geo.a[i] /= acc || 1;
  }
  function rOfP(p) {                          // доля площади → радиус
    const a = geo.a, t = Math.min(1, Math.max(1e-4, p));
    let lo = 0, hi = a.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < t) lo = m + 1; else hi = m; }
    if (!lo) return geo.r[0];
    const k = (t - a[lo - 1]) / Math.max(1e-9, a[lo] - a[lo - 1]);
    return geo.r[lo - 1] + k * geo.step;
  }
  function pOfR(r) {                          // радиус → доля площади
    const x = (r - geo.r[0]) / geo.step, i = Math.floor(x);
    if (i < 0) return 0;
    if (i >= geo.a.length - 1) return 1;
    return geo.a[i] + (geo.a[i + 1] - geo.a[i]) * (x - i);
  }
  // зум: на экране видна доля zoom координаты высоты, от солнца наружу. По умолчанию — до 880 Гц;
  // щипок по пустому месту — от «только sub и bass» до всех пяти октав. Звук от зума не меняется
  // на экране больше телефона по умолчанию видно больше: на ту же площадь — та же доля высоты (iPad, компьютер — все пять октав)
  const ZOOM_DEF = (48 / 60) ** (1 / 1.45), ZOOM_MIN = 0.35, PHONE_FIELD = 430 * 860;   // поле самого большого iPhone
  let zoom = ZOOM_DEF, zoomT = ZOOM_DEF, zoomShow = 0, zoomed = false;   // zoomed — масштаб уже менял сам, по размеру не трогаем
  const zoomDef = () => clamp(ZOOM_DEF * (W * (geo.bot - geo.top)) / PHONE_FIELD, ZOOM_DEF, 1);
  const rAt = (p) => (p / zoom > 1.0001 ? Infinity : rOfP(p / zoom));   // радиус орбиты высоты p (за горизонтом — ∞)
  function place(p, c) {
    const r = rOfP(Math.min(1, p / zoom)), sp = arcSpan(r) || [Math.PI / 4, Math.PI / 4];
    const th = sp[0] + clamp(c) * (sp[1] - sp[0]);
    return { x: geo.ox + r * Math.cos(th), y: geo.oy - r * Math.sin(th) };
  }
  function unplace(x, y) {
    const dx = x - geo.ox, dy = geo.oy - y;
    const q = pOfR(Math.hypot(dx, dy)), sp = arcSpan(rOfP(q));
    const th = Math.atan2(dy, dx);
    return { p: q * zoom, c: sp ? clamp((th - sp[0]) / (sp[1] - sp[0])) : 0.5 };
  }

  // значение свойства в долях 0..1 (для дуг на лучах)
  function norm(v, key) {
    if (key === 'wave') return v.wave;
    if (key === 'cut') return v.cut;
    if (key === 'res') return v.res;
    if (key === 'beat') return invLog(BEAT_MIN, BEAT_MAX, v.beat);
    if (key === 'shift') return v.shift;
    return v.fm;
  }

  function setNorm(v, key, t) {
    if (key === 'wave') v.wave = t;
    else if (key === 'cut') v.cut = t;
    else if (key === 'res') v.res = t;
    else if (key === 'beat') v.beat = lerpLog(BEAT_MIN, BEAT_MAX, t);
    else if (key === 'shift') v.shift = Math.abs(t - 0.5) < 0.02 ? 0.5 : t;   // у середины — защёлка на ноль
    else v.fm = t;
    v.dirty = true;
  }

  // где параметр с учётом LFO, в долях луча: lfo — текущий выход LFO (−depth…+depth);
  // единицы те же, что у LFO в звуке (см. apply)
  const shiftT = (hz) => {
    const a = Math.abs(hz);
    if (a < 1e-3) return 0.5;
    return clamp(0.5 + Math.sign(hz) * (0.04 + (0.96 * Math.log2((a * 2047) / SHIFT_MAX + 1)) / 11) / 2);
  };
  function normAt(v, key, lfo) {
    if (key === 'wave') return clamp(v.wave + lfo);
    if (key === 'cut') return clamp(v.cut + (lfo * 4) / Math.log2(CUT_HI / CUT_LO));
    if (key === 'res') return clamp(v.res + (lfo * 20) / RES_MAX);
    if (key === 'beat') return invLog(BEAT_MIN, BEAT_MAX, clamp(v.beat + lfo * 16, BEAT_MIN, BEAT_MAX));
    if (key === 'shift') return shiftT(shiftHz(v.shift) + lfo * 300);
    return clamp(v.fm + lfo);
  }
  // для луча с LFO: где значение сейчас и в каких пределах гуляет
  function liveRange(v, key) {
    const spec = v.lfo[key];
    if (!spec) return null;
    const now = morphFn(spec.morph)(spec.ph || 0) * spec.depth;
    const a = normAt(v, key, -spec.depth), b = normAt(v, key, spec.depth);
    return { now: normAt(v, key, now), lo: Math.min(a, b), hi: Math.max(a, b) };
  }

  // с кем правится кружок: если он выделен — вся выделенная группа
  const groupOf = (v) => (sel.has(v) ? [...sel].filter((u) => u.active) : [v]);

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
    if (!f || f.menu || f.parked || f.bridge) return;
    const q = unplace(f.x + v.ox, f.y + v.oy);
    v.x = q.p; v.y = q.c; v.holeT = holeDepth(f.x + v.ox, f.y + v.oy);
    v.dirty = true;
    focus = v;
    if (f.group) for (const m of f.group) {     // выделенные едут следом, сохраняя расстановку
      if (!m.u.active) continue;
      m.u.x = clamp(v.x + m.ox); m.u.y = clamp(v.y + m.oy);
      if (!scl.on) m.u.dx = m.u.x;
      m.u.holeT = holeDepth(vx(m.u), vy(m.u));
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

  // временных — не больше трёх. Мест нет — уступает только затухающий временный (самый тихий).
  // Закреплённые, удерживаемые и открытые в кольце не трогаются никогда; если заняты все — касание
  // не звучит, видно отказ
  function spawn(f) {
    const temps = V.filter((u) => u.active && !u.pinned).length;
    let v = temps < TEMP_MAX ? V.find((u) => !u.active) : null;
    if (!v) {
      for (const u of V) {
        if (!u.active || u.pinned || u.fingers.length || kept(u) || u.envT !== 0) continue;
        if (!v || u.env < v.env) v = u;
      }
      if (v && lastTap && lastTap.v === v) lastTap = null;
    }
    if (!v) { full.push({ x: f.x, y: f.y, t: performance.now() }); return null; }
    unlinkAll(v);
    clearLfos(v);
    sel.delete(v);
    const sp = outOfHole(f.x, f.y), q = unplace(sp.x, sp.y);
    v.x = q.p; v.dx = v.x; v.y = q.c; v.hole = v.holeT = holeDepth(sp.x, sp.y);
    v.ox = sp.x - f.x; v.oy = sp.y - f.y;     // вытолкнули из дыры — палец ведёт планету с этим сдвигом
    v.beat = BEAT_DEF; v.wave = WAVE_DEF; v.fm = 0; v.cut = CUT_DEF; v.res = RES_DEF; v.shift = SHIFT_DEF; v.amp = 1;
    v.pinned = false; v.fingers = [];
    v.snap = v.env < 0.02; v.dirty = true; v.emit = 1e9;
    attack(v);
    return v;
  }

  function attack(v) {
    v.active = true; v.envT = 1; v.envTau = 0.12;
    const n = v.nodes;
    if (n) {
      if (!n.live) { n.out.connect(bus); n.vca.connect(n.vscope); n.live = true; }   // молчащий кружок отключён от графа и не тратит процессор
      n.env.gain.setTargetAtTime(1, ctx.currentTime, 0.12);
      n.mod.gain.setTargetAtTime(1, ctx.currentTime, 0.12);
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

  // ---------- связи: другой кружок модулирует этот; характер — fm, tzfm, am или rm ----------
  function linkTargets(n, type) {
    if (type === 'fm') return [n.c1.detune, n.c2.detune];   // экспоненциальная, по строю
    if (type === 'tzfm') return n.fmTargets;                 // линейная, сквозь ноль, в герцах
    return [n.vca.gain];                                     // am и rm — через усилитель кружка
  }

  function wire(dst, m) {
    if (m.g) m.g.disconnect();
    m.g = null;
    if (!ctx || !dst.nodes || !m.src.nodes) return;
    m.g = gainNode(0);
    m.src.nodes.mod.connect(m.g);
    for (const p of linkTargets(dst.nodes, m.type)) m.g.connect(p);
  }

  function addLink(dst, src, depth, type = 'tzfm') {
    const m = { src, type, depth, g: null };
    wire(dst, m);
    dst.mods.push(m);
    dst.dirty = true;
    return m;
  }

  function dropLink(dst, m) {
    const i = dst.mods.indexOf(m);
    if (i < 0) return;
    if (m.g) m.g.disconnect();
    dst.mods.splice(i, 1);
    dst.dirty = true;
  }

  function unlinkAll(v) {
    for (const m of v.mods) if (m.g) m.g.disconnect();
    v.mods = [];
    v.dirty = true;
    for (const u of V) {
      const keep = [];
      for (const m of u.mods) { if (m.src === v) { if (m.g) m.g.disconnect(); u.dirty = true; } else keep.push(m); }
      u.mods = keep;
    }
  }

  // хаос: слабые случайные связи между звучащими кружками, которые сами меняются
  function chaosTick(now) {
    const act = V.filter((v) => v.active);
    for (const v of V) {
      const auto = v.mods.find((m) => m.auto);
      if (!v.active || fx.chaos < 0.02 || act.length < 2) { if (auto) dropLink(v, auto); continue; }
      if (auto && now < auto.until && auto.src.active) { auto.depth = fx.chaos * auto.k; v.dirty = true; continue; }
      if (auto) dropLink(v, auto);
      if (Math.random() > 0.35) continue;      // не все сразу
      const cands = act.filter((u) => u !== v && !v.mods.some((m) => m.src === u));
      if (!cands.length) continue;
      const m = addLink(v, cands[Math.floor(Math.random() * cands.length)], 0, LINK_TYPES[Math.floor(Math.random() * 4)]);
      m.auto = true;
      m.k = 0.15 + Math.random() * 0.4;
      m.depth = fx.chaos * m.k;
      m.until = now + 3000 + Math.random() * 7000;
    }
  }

  // ---------- LFO на параметрах кружка ----------
  function lfoTargets(n, key) {
    if (key === 'pitch') return [n.c1.detune, n.c2.detune, n.sub.detune];
    if (key === 'wave') return [n.morph.pos];
    if (key === 'cut') return [n.lp.detune];
    if (key === 'res') return [n.lp.Q];
    if (key === 'beat') return [n.c2.freq];
    if (key === 'shift') return [n.shf.cos.frequency, n.shf.sin.frequency];
    if (key === 'amp') return [n.lvl.gain];
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
      const mo = morphOsc(mp.shapers, sum, true);
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

  // во что смотрит панель LFO: луч кольца (на весу или закреплённого); центр кольца — высота
  function modTarget(except) {
    for (const f of F.values()) if (f !== except && f.ui === 'lfo' && f.tg) return f.tg;
    for (const f of F.values()) {
      if (f === except || !f.menu || !f.menu.voice) continue;
      return { v: f.menu.voice, key: f.menu.sector ? f.menu.sector.key : 'pitch', group: f.menu.group };
    }
    if (editor && editor.kind === 'voice') return { v: editor.v, key: editor.key || 'pitch', group: editor.group };
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
    m.auto = false;
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
    if (br.m.depth < 0.06) dropLink(br.A, br.m);
    for (const f of [br.fa, br.fb]) if (f.voice) { f.moved = true; rebase(f.voice); }
  }

  // ---------- касания ----------
  // касание — звук, пока держишь; двойной тап — закрепить / открепить; долгое касание кружка —
  // кольцо на весу. Булавка на кольце (вторым пальцем) оставляет его открытым: крути что хочешь,
  // тап мимо — закрыть
  let editor = null;          // закреплённое кольцо кружка или связи
  const PIN_R = 17;
  const pinPos = (cx, cy) => ({ x: cx, y: cy });   // булавка — в центре кольца, под пальцем
  const kept = (v) => !!editor && editor.kind === 'voice' && editor.group.includes(v);
  // отпустил палец — кольцо ещё гаснет полторы секунды, и булавку можно тапнуть
  const GHOST_MS = 1600;
  let ghost = null;           // { menu, until }

  function deleteVoice(v) {
    if (editor && (editor.v === v || editor.dst === v || (editor.m && editor.m.src === v))) editor = null;
    for (const f of F.values()) if (f.voice === v) { f.voice = null; f.menu = null; }
    v.pinned = false; v.fingers = [];
    sel.delete(v);
    unlinkAll(v);
    release(v, 0.25);
    burst(v);
    if (lastTap && lastTap.v === v) lastTap = null;
    ghost = null;
  }

  // закрыть закреплённое кольцо; кружки, которые держало только оно, гаснут
  function closeEditor() {
    const e = editor;
    editor = null;
    if (e && e.kind === 'voice') for (const u of e.group) if (u.active && !u.pinned && !u.fingers.length) release(u, TAIL);
  }

  function down(e) {
    e.preventDefault();
    unlock();
    touchedOnce = true;
    try { cv.setPointerCapture(e.pointerId); } catch (_) { /* ok */ }
    const now = performance.now();
    const f = {
      id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: now,
      voice: null, caught: false, moved: false, menu: null, menuWas: false, parked: false, bridge: null, wasBridge: false,
    };
    F.set(e.pointerId, f);

    if (nav.view !== 'play' || nav.anim) { navDown(f); return; }

    const ui = uiHit(f);
    if (ui) { f.ui = ui.k; f.hit = ui; uiDown(f); return; }

    let v = hit(f.x, f.y);
    if (v) {
      // другой палец уже держит кружок — это мост
      for (const o of F.values()) {
        if (o !== f && o.voice && o.voice !== v && !o.menu && !o.parked && !o.bridge && o.voice.fingers.length === 1) {
          startBridge(o, f, v);
          return;
        }
      }
      f.caught = true;
      if (!v.pinned) attack(v);
      if (sel.has(v)) f.group = [...sel].filter((u) => u !== v).map((u) => ({ u, ox: u.x - v.x, oy: u.y - v.y }));
    } else {
      v = spawn(f);                           // пустое место — новый кружок
      f.spawned = true;
      for (const o of F.values()) {           // два пальца почти разом по пустому — возможно, щипок зума
        if (o !== f && o.spawned && !o.zc && !o.moved && now - o.t0 < 250) {
          const zc = { a: o, b: f, d0: fdist(o, f), t0: now };
          o.zc = zc; f.zc = zc;
          break;
        }
      }
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
    if (f.zc && !f.zoom && performance.now() - f.zc.t0 < 700 && Math.abs(fdist(f.zc.a, f.zc.b) - f.zc.d0) > 26) startZoom(f.zc);
    if (f.zoom) {
      const z = f.zoom;
      setZoom((z.z1 * z.d1) / Math.max(20, fdist(z.a, z.b)));   // развёл — ближе к солнцу
      return;
    }
    if (f.bridge) bridgeMove(f.bridge);
    else if (f.menu) menuMove(f);
    else if (f.voice && !f.parked) follow(f.voice);
  }

  function setZoom(z) {
    zoomT = clamp(z, ZOOM_MIN, 1); zoomed = true;
    zoomShow = performance.now() + 1200;        // подписи диапазонов видны во время зума и ещё секунду после
  }
  // на компьютере щипка по экрану нет: колесо, прокрутка и щипок тачпада (браузер шлёт его колесом с ctrl)
  function wheelZoom(e) {
    e.preventDefault();
    if (nav.view !== 'play') return;
    const k = e.ctrlKey ? 0.01 : 0.0025, d = e.deltaMode ? e.deltaY * 16 : e.deltaY;
    setZoom(zoomT * Math.exp(clamp(d * k, -0.5, 0.5)));
  }

  // щипок зума начался: оба кружка, которые успели зазвучать, гасим почти сразу
  function startZoom(z) {
    for (const q of [z.a, z.b]) {
      const v = q.voice;
      if (v) {
        v.fingers = v.fingers.filter((id) => id !== q.id);
        if (!v.pinned && !v.fingers.length && !kept(v)) release(v, 0.03);
      }
      q.voice = null; q.zoom = z;
    }
    z.d1 = Math.max(20, fdist(z.a, z.b)); z.z1 = zoomT;
  }

  function up(e) {
    const f = F.get(e.pointerId);
    if (!f) return;
    if (f.bridge) endBridge(f.bridge);
    F.delete(e.pointerId);
    if (f.zoom) { const z = f.zoom; z.a.zoom = null; z.b.zoom = null; return; }
    if (f.ui) { uiUp(f); return; }
    if (f.menu) leaveMenu(f.menu);
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
        if (v.pinned) { v.pinned = false; if (!kept(v)) release(v, UNPIN_TAIL); }
        else if (V.filter((u) => u.active && u.pinned).length >= PIN_MAX) {   // закреплённых уже три — отказ
          full.push({ x: vx(v), y: vy(v), t: now });
          if (!v.fingers.length && !kept(v)) release(v, TAIL);
        } else v.pinned = true;
        return;
      }
      lastTap = { v, t: now };
    }
    if (v.fingers.length) rebase(v);
    else if (!v.pinned && !kept(v)) release(v, TAIL);
  }

  // ---------- кнопки — в верхней строке: слева заголовок, справа громкость, лад, FX, кубик, отмена, убрать всё ----------
  const BTN_R = 20, ITEM_H = 46, CLR_R = 17;
  const SMALL = new Set(['clr', 'undo', 'dice']);
  const btnPos = (k) => {
    const y = scopeY + 20;
    if (k === 'clr') return { x: W - 27, y };
    if (k === 'undo') return { x: W - 66, y };
    if (k === 'dice') return { x: W - 105, y };
    if (k === 'rev') return { x: W - 150, y };
    if (k === 'vol') return { x: W - 230, y };
    return { x: W - 196, y };
  };
  // громкость — общая на всё приложение, узкий фейдер перед ладом; зажал — вниз выдвигается длинная шкала,
  // палец ведёт её без скачка. Снизу off, выше нуля — до +6 дБ (сильнее в мягкий лимитер). Запоминается на устройстве
  const VOL_TRAVEL = 220, VOL_LO = -48, VOL_HI = 6, VOL_DEF = -VOL_LO / (VOL_HI - VOL_LO);
  let vol = VOL_DEF, masterG = null;
  try { const sv = parseFloat(localStorage.getItem('t2d-vol')); if (sv >= 0 && sv <= 1) vol = sv; } catch (_) { /* приватный режим */ }
  const volDb = (t) => VOL_LO + (VOL_HI - VOL_LO) * t;
  const volGain = (t) => (t < 0.005 ? 0 : 10 ** (volDb(t) / 20));
  const volText = (t) => (t < 0.005 ? 'off' : `${volDb(t) > 0.5 ? '+' : ''}${Math.round(volDb(t))} dB`);
  function setVol(t) {
    vol = clamp(t);
    if (masterG) masterG.gain.setTargetAtTime(0.8 * volGain(vol), ctx.currentTime, 0.03);
  }
  // панель LFO внизу, под большой палец: полоса формы и пад — вправо скорость, вверх глубина
  const lfoPanel = () => {
    const x = 16, w = W - 32, bottom = H - safeBot - 16, top = bottom - 214;
    return { x, w, top, bottom, shape: { y: top + 22, h: 44 }, pad: { y: top + 74, h: bottom - top - 74 } };
  };
  const PAD_IN = 12;          // поле внутри пада, где точка ещё внутри шкалы
  const shapeT = (p, px) => clamp((px - p.x - 22) / (p.w - 44));
  const padRate = (p, px) => lerpLog(LFO_RATE_MIN, LFO_RATE_MAX, clamp((px - p.x - PAD_IN) / (p.w - 2 * PAD_IN)));
  const padDepth = (p, py) => clamp(1 - (py - p.pad.y - PAD_IN) / (p.pad.h - 2 * PAD_IN));
  const rateX = (p, hz) => p.x + PAD_IN + invLog(LFO_RATE_MIN, LFO_RATE_MAX, hz) * (p.w - 2 * PAD_IN);
  const depthY = (p, d) => p.pad.y + PAD_IN + (1 - d) * (p.pad.h - 2 * PAD_IN);
  // список ладов — под кнопкой, строки сверху вниз: off, лады; справа от списка — тоники в две колонки
  const LIST_W = 150, TON_W = 40;
  const sclList = () => {
    const b = btnPos('scl'), rows = SCALES.length + 1, top = b.y + 40;
    const cw = TON_W, bx = W - 12 - (2 * cw + 8) - LIST_W, rx = bx + LIST_W + 8, ch = (rows * ITEM_H) / 6;
    return { b, rows, top, bx, rx, cw, ch };
  };
  // кубик (кнопка вверху): случайный тембр выделенным планетам (или всем) — волна, фильтр, detune, fm, сдвиг;
  // заодно связи и LFO; высота и место не трогаются. Планет нет — кубик сам ставит закреплённый тон
  // в случайном месте видимой части карты, с ладом — сразу на ноту лада
  function rollDice() {
    const R = Math.random;
    const live = (v) => v.active && v.envT > 0;   // гаснущие не в счёт
    let vs = [...sel].filter(live);
    if (!vs.length) vs = V.filter(live);
    if (!vs.length) {
      const pt = place(zoom * (0.08 + 0.75 * R()), 0.1 + 0.6 * R());
      const v = spawn({ x: pt.x, y: pt.y });
      if (!v) return;
      v.pinned = true; v.t = performance.now();
      vs = [v];
    }
    for (const v of vs) {
      v.wave = R();
      v.cut = 0.3 + 0.62 * R();
      v.res = 0.75 * R() ** 1.5;
      v.beat = lerpLog(BEAT_MIN, BEAT_MAX, 0.85 * R());
      v.fm = R() < 0.45 ? 0 : 0.7 * R();
      v.shift = R() < 0.5 ? SHIFT_DEF : R();
      for (const m of v.mods) {
        if (m.auto) continue;
        const t = LINK_TYPES[Math.floor(R() * 4)];
        if (t !== m.type) { m.type = t; wire(v, m); }
        m.depth = 0.15 + 0.75 * R();
      }
      for (const spec of Object.values(v.lfo)) { spec.morph = R(); spec.rate = lerpLog(LFO_RATE_MIN, LFO_RATE_MAX, 0.15 + 0.7 * R()); }
      v.dirty = true;
      burst(v);
    }
    diceAt = performance.now();
  }
  let diceAt = -1e9;

  const rootAt = (L, x, y) => {
    if (x < L.rx || x > L.rx + 2 * L.cw || y < L.top || y > L.top + L.rows * ITEM_H) return -1;
    return clamp(Math.floor((x - L.rx) / L.cw), 0, 1) * 6 + clamp(Math.floor((y - L.top) / L.ch), 0, 5);
  };

  // связь — гравитационная нить: квадратичная кривая от источника к приёмнику, прогнутая к солнцу;
  // чем глубже связь, тем сильнее прогиб
  function linkCurve(dst, m) {
    const x1 = vx(m.src), y1 = vy(m.src), x2 = vx(dst), y2 = vy(dst);
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, L = Math.hypot(x2 - x1, y2 - y1) || 1;
    let nx = -(y2 - y1) / L, ny = (x2 - x1) / L;            // поперёк нити — в сторону солнца
    if (nx * (geo.ox - mx) + ny * (geo.oy - my) < 0) { nx = -nx; ny = -ny; }
    const bend = Math.min(0.3 * L, 64) * (0.5 + 0.5 * m.depth);
    return { x1, y1, cx: mx + nx * bend, cy: my + ny * bend, x2, y2 };
  }
  const bez = (c, t) => {
    const u = 1 - t;
    return { x: u * u * c.x1 + 2 * u * t * c.cx + t * t * c.x2, y: u * u * c.y1 + 2 * u * t * c.cy + t * t * c.y2 };
  };
  function linkMid(dst, m) { return bez(linkCurve(dst, m), 0.5); }
  const ringR = () => MENU_DEAD + MENU_SPAN + 34;

  // полоса громкости над панелью LFO — в опциях планеты, без лишнего луча
  const ampStrip = () => { const p = lfoPanel(); return { x: p.x, w: p.w, y: p.top - 52, h: 34 }; };
  const ampT = (amp) => invLog(AMP_MIN, AMP_MAX, amp);          // шкала в децибелах
  // «off» в заголовке панели LFO — снять LFO; «close» над полосой amp — закрыть закреплённое кольцо
  const offChip = () => { const p = lfoPanel(); return { x: p.x + p.w - 46, y: p.top - 6, w: 46, h: 24 }; };
  const closeChip = () => { const a = ampStrip(); return { x: a.x + a.w - 64, y: a.y - 38, w: 64, h: 26 }; };
  const inBox = (f, b, pad = 6) => f.x > b.x - pad && f.x < b.x + b.w + pad && f.y > b.y - pad && f.y < b.y + b.h + pad;
  function ampHit(f) {
    const a = ampStrip();
    return f.x > a.x - 8 && f.x < a.x + a.w + 8 && f.y > a.y - 6 && f.y < a.y + a.h + 4 ? { k: 'amp' } : null;
  }

  function lfoHit(f) {
    const p = lfoPanel();
    if (f.x < p.x - 8 || f.x > p.x + p.w + 8) return null;
    if (f.y > p.shape.y - 6 && f.y < p.shape.y + p.shape.h + 4) return { k: 'lfo', strip: 'shape' };
    if (f.y > p.pad.y - 4 && f.y < p.pad.y + p.pad.h + 8) return { k: 'lfo', strip: 'pad' };
    return null;
  }

  function uiHit(f) {
    if (WORLDS_ON && !editor && Math.hypot(f.x - geo.ox, f.y - geo.oy) < 46) return { k: 'sun' };   // солнце — карта миров
    if (ghost) {                              // любое касание гасит призрак; по булавке — закрепляет
      const gh = ghost, p = pinPos(gh.menu.cx, gh.menu.cy);
      ghost = null;
      if (performance.now() < gh.until && Math.hypot(f.x - p.x, f.y - p.y) < PIN_R + 14) return { k: 'pin', ghost: gh.menu };
    }
    const vb = btnPos('vol');
    if (Math.abs(f.x - vb.x) < 15 && Math.abs(f.y - vb.y) < 26) return { k: 'vol' };
    for (const k of ['rev', 'scl', 'clr', 'undo', 'dice']) {
      const b = btnPos(k), r = SMALL.has(k) ? CLR_R + 4 : BTN_R + 6;
      if (Math.hypot(f.x - b.x, f.y - b.y) < r) return { k };
    }
    for (const o of F.values()) {             // булавка на кольце, открытом на весу
      if (o === f || !o.menu || o.menu.fx) continue;
      const p = pinPos(o.menu.cx, o.menu.cy);
      if (Math.hypot(f.x - p.x, f.y - p.y) < PIN_R + 12) return { k: 'pin', holder: o };
    }
    if (editor) {
      if (editor.kind === 'voice') {
        if (inBox(f, closeChip())) return { k: 'void' };
        const tg = modTarget(f);
        if (tg && tg.v.lfo[tg.key] && inBox(f, offChip())) return { k: 'lfooff' };
        const l = ampHit(f) || lfoHit(f); if (l) return l;
      }
      if (editor.kind === 'link' && inBox(f, closeChip())) return { k: 'void' };
      if (Math.hypot(f.x - editor.cx, f.y - editor.cy) < ringR()) return { k: 'ring' };
      return { k: 'void' };                   // тап мимо — закрыть
    }
    const mt = modTarget(f);
    if (mt) {
      if (mt.v.lfo[mt.key] && inBox(f, offChip())) return { k: 'lfooff' };
      const l = ampHit(f) || lfoHit(f); if (l) return l;
    }
    for (const v of V) {                      // ручка на середине связи
      if (!v.active) continue;
      for (const m of v.mods) {
        if (!m.src.active || m.auto) continue;
        const c = linkMid(v, m);
        if (Math.hypot(f.x - c.x, f.y - c.y) < HANDLE_R) return { k: 'link', dst: v, m };
      }
    }
    return null;
  }

  function allDirty() { for (const v of V) v.dirty = true; }

  // ---------- отмена: 10 шагов. Шаг — законченный жест, после которого изменилось сохраняемое:
  // закреплённые кружки (место, тембр, LFO, связи между ними), FX и лад. Временные кружки не в счёт ----------
  const UNDO_MAX = 10;
  const hist = [];
  let lastState = null;
  const r4 = (x) => Math.round(x * 1e4) / 1e4;
  function snapshot() {
    const pins = V.filter((v) => v.active && v.pinned);
    const ids = new Set(pins.map((v) => v.i));
    return JSON.stringify({
      v: pins.map((v) => ({
        i: v.i, x: r4(v.x), y: r4(v.y), amp: r4(v.amp), wave: r4(v.wave), cut: r4(v.cut), res: r4(v.res), beat: r4(v.beat), fm: r4(v.fm), shift: r4(v.shift), hole: r4(v.holeT),
        lfo: Object.fromEntries(Object.entries(v.lfo).map(([k, sp]) => [k, { morph: r4(sp.morph), rate: r4(sp.rate), depth: r4(sp.depth) }])),
        mods: v.mods.filter((m) => !m.auto && ids.has(m.src.i)).map((m) => ({ src: m.src.i, type: m.type, depth: r4(m.depth) })),
      })),
      fx: Object.fromEntries(Object.entries(fx).map(([k, x]) => [k, r4(x)])),
      scl: { on: scl.on, idx: scl.idx, root: scl.root },
    });
  }
  // после каждого жеста: если сохраняемое изменилось — прежнее состояние в историю
  function commit() {
    if (F.size) return;                         // ждём, пока отпущены все пальцы — один жест, один шаг
    const now = snapshot();
    if (lastState !== null && now !== lastState) {
      hist.push(lastState);
      if (hist.length > UNDO_MAX) hist.shift();
    }
    lastState = now;
  }
  function restore(js) {
    const st = JSON.parse(js);
    editor = null; ghost = null;
    sel.clear();
    const keep = new Set(st.v.map((d) => d.i));
    for (const v of V) if (v.active && v.pinned && !keep.has(v.i)) deleteVoice(v);
    for (const d of st.v) {
      const v = V[d.i];
      for (const f of F.values()) if (f.voice === v) { f.voice = null; f.menu = null; }
      v.fingers = [];
      unlinkAll(v);
      clearLfos(v);
      v.snap = !v.active || v.env < 0.02;
      Object.assign(v, { x: d.x, dx: d.x, y: d.y, amp: d.amp == null ? 1 : d.amp, wave: d.wave, cut: d.cut, res: d.res, beat: d.beat, fm: d.fm, shift: d.shift, hole: d.hole || 0, holeT: d.hole || 0 });
      v.pinned = true; v.dirty = true;
      if (!v.active || v.envT === 0) attack(v);
      burst(v);
    }
    for (const d of st.v) {
      const v = V[d.i];
      for (const m of d.mods) addLink(v, V[m.src], m.depth, m.type);
      for (const [k, sp] of Object.entries(d.lfo)) setLfo(v, k, { ...sp });
    }
    Object.assign(fx, st.fx); applyFx();
    if (scl.on !== st.scl.on || scl.idx !== st.scl.idx || scl.root !== st.scl.root) {
      Object.assign(scl, st.scl); scl.slideUntil = performance.now() + 500; allDirty();
    }
  }
  function undo() {
    if (!hist.length) return;
    restore(hist.pop());
    lastState = snapshot();
    undoAt = performance.now();
  }
  let undoAt = -1e9;

  // все кружки, включая закреплённые, гаснут за полсекунды; связи, LFO и выделение снимаются
  function clearAll() {
    editor = null;
    for (const v of V) if (v.active) deleteVoice(v);
    lastTap = null;
    sel.clear();
  }

  function uiDown(f) {
    if (f.ui === 'clr') { clearAll(); return; }
    if (f.ui === 'sun') { goMap(); return; }
    if (f.ui === 'undo') { undo(); return; }
    if (f.ui === 'dice') { rollDice(); return; }
    if (f.ui === 'rev') { openFx(f); return; }
    if (f.ui === 'vol') { f.vol0 = vol; return; }
    if (f.ui === 'pin') {
      if (f.hit.ghost) {                      // кольцо уже гасло — кружки снова звучат
        pinFrom(f.hit.ghost);
        if (f.hit.ghost.voice) for (const u of f.hit.ghost.group) if (u.active && !u.pinned && !u.fingers.length) attack(u);
      } else if (f.hit.holder) pinMenu(f.hit.holder);
      else closeEditor();
      return;
    }
    if (f.ui === 'void') { closeEditor(); return; }
    if (f.ui === 'link') { openLink(f, f.hit.dst, f.hit.m); return; }
    if (f.ui === 'ring') { ringTouch(f, true); return; }
    if (f.ui === 'lfooff') {                  // снять LFO с выбранного параметра
      const tg = modTarget(f);
      if (tg) for (const u of tg.group) { removeLfo(u, tg.key); u.dirty = true; }
      return;
    }
    if (f.ui === 'amp') {
      const tg = modTarget(f);
      if (!tg) return;
      f.tg = tg;
      if (editor && editor.kind === 'voice') editor.key = 'amp';   // в закреплённом кольце LFO переключается на громкость
      ampSet(f);
      return;
    }
    if (f.ui === 'lfo') {
      const tg = modTarget(f);
      if (!tg) return;
      f.tg = tg; f.strip = f.hit.strip;
      for (const u of tg.group) {
        const cur = u.lfo[tg.key];
        setLfo(u, tg.key, cur ? { ...cur } : { morph: 0, rate: 1.2, depth: 0.35 });
      }
      lfoStrip(f);
      return;
    }
    // лад: нажатие сразу включает последний лад; отпускание его оставляет
    f.wasOn = scl.on; f.picked = false;
    scl.on = true;
    scl.slideUntil = performance.now() + 500;
    allDirty();
  }

  function ampSet(f) {
    if (!f.tg) return;
    const a = ampStrip(), amp = lerpLog(AMP_MIN, AMP_MAX, clamp((f.x - a.x - PAD_IN) / (a.w - 2 * PAD_IN)));
    for (const u of f.tg.group) { u.amp = Math.abs(20 * Math.log10(amp)) < 0.6 ? 1 : amp; u.dirty = true; }   // у 0 дБ — защёлка
  }

  // панель LFO: форма — где палец на полосе; на паде одним жестом скорость (вправо) и глубина (вверх)
  function lfoStrip(f) {
    if (!f.tg) return;
    const p = lfoPanel();
    for (const u of f.tg.group) {
      const spec = u.lfo[f.tg.key];
      if (!spec) continue;
      if (f.strip === 'shape') spec.morph = shapeT(p, f.x);
      else { spec.rate = padRate(p, f.x); spec.depth = padDepth(p, f.y); }
      u.dirty = true;
    }
  }

  function uiMove(f) {
    if (f.ui === 'vol') { setVol(f.vol0 - (f.y - f.y0) / VOL_TRAVEL); return; }
    if (f.ui === 'lfo') { lfoStrip(f); return; }
    if (f.ui === 'amp') { ampSet(f); return; }
    if (f.ui === 'ring') { ringTouch(f, false); return; }
    if (f.ui !== 'scl') return;
    const L = sclList(), b = L.b;
    // повёл палец влево вдоль верха — карандаш: обводишь кружки
    if (!f.lasso && !f.picked && f.x < b.x - 50 && f.y < b.y + 36) {
      f.lasso = [];
      if (scl.on !== f.wasOn) { scl.on = f.wasOn; scl.slideUntil = performance.now() + 500; allDirty(); }
    }
    if (f.lasso) {
      const lp = f.lasso[f.lasso.length - 1];
      if (!lp || Math.hypot(f.x - lp.x, f.y - lp.y) > 4) f.lasso.push({ x: f.x, y: f.y });
      return;
    }
    if (f.y < b.y + 40) return;
    f.picked = true;
    let on = scl.on, idx = scl.idx, root = scl.root;
    const r = rootAt(L, f.x, f.y);
    if (r >= 0) {                               // колонка тоник справа
      root = r; on = true;
    } else if (f.x > L.bx - 12 && f.x < L.rx - 2) {   // строки сверху вниз: off, затем лады — с задержкой,
      const row = clamp(Math.floor((f.y - L.top) / ITEM_H), 0, SCALES.length);   // чтобы пролёт пальцем ничего не менял
      const now = performance.now();
      if (row !== f.row) { f.row = row; f.rowAt = now; return; }
      if (now - f.rowAt < 120) { setTimeout(() => { if (F.has(f.id) && f.row === row) uiMove(f); }, 130); return; }
      on = row > 0; if (on) idx = row - 1;
    } else return;
    if (on !== scl.on || idx !== scl.idx || root !== scl.root) {
      scl.on = on; scl.idx = idx; scl.root = root;
      scl.slideUntil = performance.now() + 500;
      allDirty();
    }
  }

  function uiUp(f) {
    if (f.ui === 'vol') { try { localStorage.setItem('t2d-vol', vol.toFixed(3)); } catch (_) { /* приватный режим */ } return; }
    if (f.menu && !f.menu.fx) leaveMenu(f.menu);
    if (f.ui === 'lfo') {
      if (!f.tg) return;
      for (const u of f.tg.group) {
        const spec = u.lfo[f.tg.key];
        if (spec && spec.depth < 0.03) removeLfo(u, f.tg.key);   // глубину увёл в ноль — LFO снят
      }
      return;
    }
    if (f.ui === 'ring') {
      if (editor && editor.kind === 'link' && editor.cutting) { dropLink(editor.dst, editor.m); editor = null; }
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
    return fx[key];
  }
  function fxSet(key, t) {
    if (key === 'decay') fx.decay = lerpLog(DECAY_MIN, DECAY_MAX, t);
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
      cx: b.x, cy: b.y, gx: b.x, gy: b.y, sector: null, sectors: FX_SECTORS, span: MENU_SPAN, fx: true,
      get: fxGet, set: fxSet, text: fxText,
      restore: () => { Object.assign(fx, orig); applyFx(); },
    };
  }

  // кольцо целиком на экране: если кружок у края, кольцо открывается ближе к середине,
  // лучи всегда смотрят в одни и те же стороны; сам кружок остаётся на месте
  function ringCenter(x, y, bot = H - safeBot - 24) {
    const R = MENU_DEAD + MENU_SPAN + 26;
    const x0 = R, x1 = W - R, y0 = scopeY + 56 + R, y1 = bot - R;
    return { cx: x0 < x1 ? clamp(x, x0, x1) : W / 2, cy: y0 < y1 ? clamp(y, y0, y1) : (y0 + y1) / 2 };
  }

  // ---------- кольцо на весу: тот же палец ведёт по лучу; расстояние от точки касания — значение ----------
  function openMenu(f) {
    const v = f.voice, group = groupOf(v);
    f.menuWas = true;
    const origs = group.map((u) => ({ u, o: { wave: u.wave, cut: u.cut, res: u.res, beat: u.beat, fm: u.fm, shift: u.shift } }));
    const rc = ringCenter(vx(v), vy(v), closeChip().y - 6);   // низ занят панелью LFO, полосой amp и кнопкой close
    f.menu = {
      cx: rc.cx, cy: rc.cy, gx: f.x, gy: f.y, sector: null, sectors: SECTORS, span: MENU_SPAN, voice: v, group, overPin: true,
      get: (k) => norm(v, k),
      set: (k, t) => { for (const u of group) setNorm(u, k, t); },
      text: (k) => valueText(v, k) + (group.length > 1 ? `  ×${group.length}` : ''),
      restore: () => { for (const { u, o } of origs) { Object.assign(u, o); u.dirty = true; } },
    };
    focus = v;
  }

  // кольцо связи на весу: луч типа — характер, расстояние — глубина; луч cut — удалить
  function openLink(f, dst, m) {
    const c = linkMid(dst, m), orig = { type: m.type, depth: m.depth };
    f.menuWas = true;
    m.auto = false;                           // тронутую хаос-связь пользователь забирает себе
    const setType = (t) => { if (m.type !== t) { m.type = t; wire(dst, m); } };
    const rc = ringCenter(c.x, c.y);
    f.menu = {
      cx: rc.cx, cy: rc.cy, gx: f.x, gy: f.y, sector: null, sectors: LINK_SECTORS, span: MENU_SPAN, link: m, dst, overPin: true,
      get: (k) => (k === 'cut' ? (m.cutting ? 1 : 0) : m.type === k ? m.depth : 0),
      set: (k, t) => {
        m.cutting = k === 'cut' && t > 0.35;
        if (k !== 'cut') { setType(k); m.depth = t; }
        dst.dirty = true;
      },
      text: (k) => (k === 'cut' ? (m.cutting ? 'release to cut' : 'pull further') : `${Math.round(m.depth * 100)}%`),
      restore: () => { m.cutting = false; setType(orig.type); m.depth = orig.depth; dst.dirty = true; },
      commit: () => { if (m.cutting) dropLink(dst, m); },
    };
  }

  function menuMove(f) {
    const m = f.menu;
    const dx = f.x - m.gx, dy = f.y - m.gy, d = Math.hypot(dx, dy);   // от точки, где лежал палец
    m.overPin = false;
    if (d < MENU_DEAD) {
      // в центре кольца — булавка: отпустишь палец здесь — кольцо закрепится; выбранный луч освобождается,
      // заданное значение остаётся. У веера FX центр — отмена
      if (m.fx) { if (m.sector) m.restore(); } else m.overPin = true;
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
    if (m.sector) m.set(m.sector.key, clamp((d - MENU_DEAD) / m.span));
  }

  // булавка: кольцо на весу становится закреплённым — дальше касания любым пальцем, тап мимо закрывает
  function pinFrom(m) {
    ghost = null;
    if (m.voice) {
      editor = { kind: 'voice', v: m.voice, group: m.group, key: m.sector ? m.sector.key : null, cx: m.cx, cy: m.cy, sectors: SECTORS };
    } else {
      m.link.cutting = false;
      editor = { kind: 'link', dst: m.dst, m: m.link, key: m.link.type, cx: m.cx, cy: m.cy, sectors: LINK_SECTORS, cutting: false };
    }
  }

  function pinMenu(f) {
    if (!f.menu) return;
    pinFrom(f.menu);
    f.menu = null;
    f.parked = true;                          // этот палец больше ничего не двигает
  }

  // палец с кольца на весу отпущен: отпустил на булавке — закрепить; иначе кольцо гаснет призраком
  function leaveMenu(m) {
    if (m.overPin) { pinFrom(m); return; }
    if (m.commit) m.commit();
    if (m.link && !m.dst.mods.includes(m.link)) return;   // связь только что удалена
    ghost = { menu: m, until: performance.now() + GHOST_MS };
  }

  // касание закреплённого кольца: луч — по направлению от центра, значение — расстояние от центра;
  // центр кольца — LFO на высоту
  function ringTouch(f, first) {
    const e = editor;
    if (!e) return;
    const dx = f.x - e.cx, dy = f.y - e.cy, d = Math.hypot(dx, dy);
    if (first) {
      f.sector = null;
      if (d < MENU_DEAD) { if (e.kind === 'voice') e.key = null; return; }
      const a = Math.atan2(dy, dx);
      let bd = 9;
      for (const s of e.sectors) {
        const diff = Math.abs(Math.atan2(Math.sin(a - s.ang), Math.cos(a - s.ang)));
        if (diff < bd) { bd = diff; f.sector = s; }
      }
      e.key = f.sector.key;
    }
    if (!f.sector) return;
    const t = clamp((d - MENU_DEAD) / MENU_SPAN);
    if (e.kind === 'voice') {
      for (const u of e.group) if (u.active) setNorm(u, f.sector.key, t);
      return;
    }
    if (f.sector.key === 'cut') { e.cutting = t > 0.35; return; }
    e.cutting = false;
    if (e.m.type !== f.sector.key) { e.m.type = f.sector.key; wire(e.dst, e.m); }
    e.m.depth = t; e.key = e.m.type;
    e.dst.dirty = true;
  }

  // ---------- аудио ----------
  let ctx = null, an = null, scopeBuf = null, bus = null, fxN = null;

  // асимметричный перегруз: смещённый tanh даёт чётные гармоники — ламповая/фузовая грязь, а не просто громче
  function asym(k, bias) {
    const n = 4096, c = new Float32Array(n), o = Math.tanh(bias);
    let peak = 0;
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x + bias) - o; peak = Math.max(peak, Math.abs(c[i])); }
    for (let i = 0; i < n; i++) c[i] /= peak;
    return c;
  }

  // tanh-кривая: normed=true — выход до ±1 (мастер), false — наклон 1 в нуле (петля обратной связи)
  function soft(k, normed) {
    const n = 4096, c = new Float32Array(n), d = normed ? Math.tanh(k) : k;
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / d; }
    return c;
  }

  // звук удара солнца: треск (шум в полосе, двумя щелчками) и глухой толчок; через шину голосов — с залом и перегрузом
  function strikeSound(p) {
    if (!ctx || !bus) return;
    const t = ctx.currentTime, lvl = 0.05 + 0.1 * p;
    const n = ctx.createBufferSource(), bp = filter('bandpass', 1800 + 2600 * Math.random(), 1.2), ng = gainNode(0);
    n.buffer = noiseBuf;
    const t2 = t + 0.012 + 0.02 * Math.random();
    ng.gain.setValueAtTime(lvl, t); ng.gain.exponentialRampToValueAtTime(lvl * 0.08, t2);
    ng.gain.setValueAtTime(lvl * 0.7, t2); ng.gain.exponentialRampToValueAtTime(0.0005, t2 + 0.04 + 0.06 * p);
    n.connect(bp).connect(ng).connect(bus);
    n.start(t, Math.random() * 3); n.stop(t2 + 0.12);
    const o = ctx.createOscillator(), og = gainNode(0);
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.08);
    og.gain.setValueAtTime(lvl * 1.4, t); og.gain.exponentialRampToValueAtTime(0.0005, t + 0.12);
    o.connect(og).connect(bus); o.start(t); o.stop(t + 0.14);
  }

  function noiseBuffer(seconds) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // вес таблицы i при позиции морфинга: треугольный, соседние таблицы перетекают
  const weight = (i, p) => Math.max(0, 1 - Math.abs(clamp(p) * (NW - 1) - i));
  // кривая для WaveShaper: вход −1..1 — это позиция 0..1, выход — вес (с громкостью таблицы или без)
  function weightCurve(i, level, shape = 1) {
    const n = 1024, c = new Float32Array(n);
    for (let j = 0; j < n; j++) c[j] = weight(i, j / (n - 1)) ** shape * level;
    return c;
  }
  // форма в точке t при позиции p — для рисования и для фазы LFO
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
    w.re = re; w.im = im;
    w.pwLfo = ctx.createPeriodicWave(re, im);   // LFO — исходная форма: её видно и слышно как форму
    w.level = 0.24 / Math.sqrt(rms);
  }
  // для голосов фазы гармоник у всех таблиц одни (как у saw): морф между соседями — чистая
  // интерполяция амплитуд гармоник, без провалов громкости и взаимного гашения посередине
  function alignWaves() {
    const ref = WAVES.find((w) => w.label === 'saw');
    for (const w of WAVES) {
      const re = new Float32Array(w.re.length), im = new Float32Array(w.im.length);
      for (let h = 1; h < re.length; h++) {
        const m = Math.hypot(w.re[h], w.im[h]), th = Math.atan2(ref.im[h], ref.re[h]);
        re[h] = m * Math.cos(th); im[h] = m * Math.sin(th);
      }
      w.pw = ctx.createPeriodicWave(re, im);
    }
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

  // генератор с морфингом: по осциллятору на таблицу, их веса — из позиции (позиция — звуковой сигнал,
  // поэтому её можно модулировать хоть на звуковой скорости). Частота и строй — общие на весь набор.
  function morphOsc(shapers, dest, lfoShapes = false) {
    const fq = ctx.createConstantSource(); fq.offset.value = 0;
    const dt = ctx.createConstantSource(); dt.offset.value = 0;
    const oscs = [fq, dt], tabs = [];
    WAVES.forEach((w, i) => {
      const o = ctx.createOscillator(); o.setPeriodicWave(lfoShapes ? w.pwLfo : w.pw); o.frequency.value = 0;
      fq.connect(o.frequency); dt.connect(o.detune);
      const gn = gainNode(0);
      shapers[i].connect(gn.gain);
      o.connect(gn).connect(dest);
      oscs.push(o);
      tabs.push({ o, gn, on: true, want: true });
    });
    for (const o of oscs) o.start();
    return { freq: fq.offset, detune: dt.offset, oscs, tabs };
  }
  // слышны только соседние таблицы вокруг позиции морфа (и размах LFO на волне) — остальные генераторы
  // отцеплены от графа и не считаются; отцепляются с задержкой, пока позиция доезжает
  const tableSpan = (p, d) => [Math.max(0, Math.floor(clamp(p - d) * (NW - 1) + 1e-6)), Math.min(NW - 1, Math.ceil(clamp(p + d) * (NW - 1) - 1e-6))];
  function useTables(mo, lo, hi) {
    mo.tabs.forEach((t, i) => {
      if (i >= lo && i <= hi) { t.want = true; if (!t.on) { t.o.connect(t.gn); t.on = true; } }
      else if (t.on && t.want) {
        t.want = false;
        setTimeout(() => { if (!t.want && t.on) { t.o.disconnect(t.gn); t.on = false; } }, 160);
      }
    });
  }

  // позиция морфинга → веса таблиц
  function morphPos(p, withLevel) {
    const c = ctx.createConstantSource(); c.offset.value = 2 * p - 1; c.start();
    const shapers = WAVES.map((w, i) => {
      const sh = ctx.createWaveShaper(); sh.curve = withLevel ? weightCurve(i, w.level, 0.85) : weightCurve(i, 1);   // 0.85 — ровная громкость по ходу морфа
      c.connect(sh);
      return sh;
    });
    return { pos: c.offset, src: c, shapers };
  }

  // сдвиг частоты: две цепочки фазовращателей дают сигнал и его копию со сдвигом фазы на 90°
  // (преобразование Гильберта, коэффициенты О. Ниемиталы), дальше I·cos + Q·sin: все частоты едут
  // на одни и те же герцы, гармоники перестают быть кратными — металл, колокол, «неправильный» звук
  const HILB = [[0.6923878, 0.9360654322959, 0.988229522686, 0.9987488452737],
    [0.4021921162426, 0.856171088242, 0.9722909545651, 0.9952884791278]];
  function shifter(input, output) {
    const heads = [];
    const chain = (as) => {
      let x = null;
      for (const a of as) { const f = ctx.createIIRFilter([a * a, 0, -1], [1, 0, -a * a]); if (x) x.connect(f); else heads.push(f); x = f; }
      return x;
    };
    const I = ctx.createIIRFilter([0, 1], [1]);   // одна ветка на отсчёт позже — так фазы расходятся ровно на 90°
    chain(HILB[0]).connect(I);
    const Q = chain(HILB[1]);
    const cos = ctx.createOscillator(), sin = ctx.createOscillator();
    cos.setPeriodicWave(ctx.createPeriodicWave(new Float32Array([0, 1]), new Float32Array([0, 0]), { disableNormalization: true }));
    cos.frequency.value = 0; sin.frequency.value = 0;
    const mi = gainNode(0), mq = gainNode(0), wet = gainNode(0), dry = gainNode(1);
    cos.connect(mi.gain); sin.connect(mq.gain);
    I.connect(mi).connect(wet);
    Q.connect(mq).connect(wet);                    // I·cos + Q·sin: с этим знаком плюс — вверх
    input.connect(dry).connect(output);
    cos.start(); sin.start();
    // пока сдвиг выключен, ветки отключены от графа и не считаются (см. shifterOn)
    return { cos, sin, wet, dry, heads, input, output, on: false, linked: false };
  }
  function shifterOn(sh, on) {
    if (on === sh.on) return;
    sh.on = on;
    if (on) {
      if (!sh.linked) { for (const h of sh.heads) sh.input.connect(h); sh.wet.connect(sh.output); sh.linked = true; }
    } else setTimeout(() => {                      // после перехода сухой/мокрый — отцепить
      if (!sh.on && sh.linked) { for (const h of sh.heads) sh.input.disconnect(h); sh.wet.disconnect(sh.output); sh.linked = false; }
    }, 150);
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
    T(fxN.pre.gain, 0.45 + fx.dirt ** 1.4 * 14);   // до ~15× в перегруз
    T(fxN.post.gain, 2.2 / (1 + 4 * fx.dirt ** 0.8));   // громкость примерно ровная по всему ходу drive
  }

  let noiseBuf = null;
  function build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC({ latencyHint: 'interactive' });
    for (const w of WAVES) makeWave(w);
    alignWaves();
    noiseBuf = noiseBuffer(4);
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf; noise.loop = true; noise.start();

    // шина голосов → drive (перегруз) → сухой звук; дилей и зал — посылы поверх него
    bus = ctx.createGain();
    const pre = gainNode(0.8), post = gainNode(1);
    const drive = ctx.createWaveShaper(); drive.curve = asym(2.4, 0.35); drive.oversample = '4x';
    bus.connect(pre).connect(drive).connect(post);
    const out = gainNode(1);
    post.connect(out);

    // стерео-дилей: две линии крест-накрест, время слегка плавает, как у ленты
    const dSend = gainNode(0);
    const dL = ctx.createDelay(2), dR = ctx.createDelay(2);
    dL.delayTime.value = 0.37; dR.delayTime.value = 0.53;
    const fbL = gainNode(DLY_REPEATS), fbR = gainNode(DLY_REPEATS);
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

    fxN = { pre, post, dSend, revSend, hall: h };
    applyFx();

    const hp = filter('highpass', 30);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10; comp.knee.value = 10; comp.ratio.value = 2.5;
    comp.attack.value = 0.01; comp.release.value = 0.4;
    const master = gainNode(0.8 * volGain(vol));
    masterG = master;
    // мягкий потолок на выходе: вдвое больше запаса по входу, чем по выходу
    const limitIn = gainNode(0.5);
    const limit = ctx.createWaveShaper(); limit.curve = soft(2.6, true); limit.oversample = '4x';
    an = ctx.createAnalyser(); an.fftSize = 2048; scopeBuf = new Float32Array(an.fftSize);
    out.connect(hp).connect(comp).connect(master).connect(limitIn).connect(limit);
    limit.connect(ctx.destination);
    limit.connect(an);

    for (const v of V) {
      v.nodes = voiceNodes(v, noise);
      v.snap = true; v.dirty = true;
      if (v.active) { v.nodes.out.connect(bus); v.nodes.vca.connect(v.nodes.vscope); v.nodes.live = true; }
      for (const [key, spec] of Object.entries(v.lfo)) setLfo(v, key, spec);
    }
    for (const v of V) for (const m of v.mods) wire(v, m);
  }

  function voiceNodes(v, noise) {
    const k = 1 + v.i * 0.137;                  // у каждого кружка свои скорости дыхания
    const pan = (p) => { if (!ctx.createStereoPanner) return gainNode(1); const s = ctx.createStereoPanner(); s.pan.value = p; return s; };

    // пара генераторов, разведённая по стерео; второй сдвинут на detune; обе половины морфят из одной позиции
    const tone = gainNode(1);
    const morph = morphPos(v.wave, true);
    const p1 = pan(-0.5), p2 = pan(0.5);
    p1.connect(tone); p2.connect(tone);
    const c1 = morphOsc(morph.shapers, p1), c2 = morphOsc(morph.shapers, p2);
    const sub = ctx.createOscillator(), m = ctx.createOscillator();
    sub.type = 'sine'; m.type = 'sine';
    sub.connect(gainNode(0.28)).connect(tone);
    for (const o of [sub, m]) o.start();

    // живость: медленный дрейф строя у каждого генератора по-своему…
    lfo(0.071 * k, 5, c1.detune); lfo(0.19 * k, 2.5, c1.detune);
    lfo(0.053 * k, 6, c2.detune); lfo(0.23 * k, 2, c2.detune);
    // …и быстрая аналоговая нестабильность: свой шум, отфильтрованный до десятков герц, ±3 цента
    const jit = ctx.createBufferSource();
    jit.buffer = noiseBuf; jit.loop = true; jit.start(0, Math.random() * 3.5);
    jit.connect(filter('lowpass', 23 * k, -3)).connect(gainNode(140)).connect(c1.detune);
    jit.connect(filter('lowpass', 31 * k, -3)).connect(gainNode(-140)).connect(c2.detune);

    // модулятор: собственная fm и выход для связей. Сам он ничем не модулируется — петель нет
    const sfm = gainNode(0); m.connect(sfm);
    const fmTargets = [c1.freq, c2.freq];
    for (const p of fmTargets) sfm.connect(p);
    const mod = gainNode(0); m.connect(mod);

    // перегруз внутри голоса → фильтр, который сам медленно гуляет
    const driveIn = gainNode(0.5);
    const shaper = ctx.createWaveShaper(); shaper.curve = soft(3, true); shaper.oversample = '2x';
    const lp = filter('lowpass', 800, 5);
    const shf = shifter(tone, driveIn);           // сдвиг частоты — до перегруза и фильтра
    driveIn.connect(shaper).connect(lp);
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
    const dl = ctx.createDelay(1), comb = gainNode(0.45);
    const loopLP = filter('lowpass', 3000, -3);
    const loopSat = ctx.createWaveShaper(); loopSat.curve = soft(1.6, false);
    const fb = gainNode(FB_BASE);
    env.connect(dl);
    dl.connect(loopLP).connect(loopSat).connect(fb).connect(dl);
    dl.connect(comb).connect(sum);

    // усилитель для am / rm от связей
    const vca = gainNode(1);
    const vscope = ctx.createAnalyser(); vscope.fftSize = 1024; vscope.smoothingTimeConstant = 0;   // для контура кружка
    const lvl = gainNode(0.55);
    lfo(0.09 * k, 0.07, lvl.gain);               // громкость чуть дышит
    const out = pan(0);
    sum.connect(vca).connect(lvl).connect(out);  // к шине подключается, только пока кружок звучит

    return { c1, c2, sub, m, morph, tone, shf, sfm, mod, driveIn, lp, bp, nz, hiss, env, dl, comb, vca, lvl, vscope, out, fmTargets, lfo: {}, live: false };
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
    const wl = v.lfo.wave ? v.lfo.wave.depth : 0, [tlo, thi] = tableSpan(v.wave, wl);
    useTables(n.c1, tlo, thi); useTables(n.c2, tlo, thi);
    const sh = shiftHz(v.shift), shOn = sh !== 0 || !!v.lfo.shift;
    shifterOn(n.shf, shOn);
    T(n.shf.cos.frequency, sh, 0.06); T(n.shf.sin.frequency, sh, 0.06);   // одинаково — иначе пара разойдётся по фазе
    T(n.shf.wet.gain, shOn ? 1 : 0, 0.02); T(n.shf.dry.gain, shOn ? 0 : 1, 0.02);
    // ось Y: внизу чистые колебания, вверху перегруз и шум, вытесняющий тон.
    // В чёрной дыре (h) тон и настроенная гребёнка съедены, остаётся широкий шум — глубже, темнее
    const h = v.holeT;
    T(n.driveIn.gain, 0.22 + 3.6 * y * y, 0.1);
    T(n.tone.gain, (1 - 0.65 * y ** 1.5) * (1 - h), 0.15);
    T(n.lp.frequency, cutoff(v), 0.1);
    T(n.lp.Q, v.res * RES_MAX, 0.1);
    T(n.nz.gain, 0.95 * y ** 1.8 * (1 - h) + 0.9 * h, 0.15);
    T(n.bp.frequency, Math.min(f * 3 * 2 ** (y * 2), 9000) ** (1 - h) * 600 ** h, 0.15);
    T(n.bp.Q, (9 - 6 * y) * (1 - h) + 0.5 * h, 0.15);
    T(n.hiss.gain, 0.25 * y ** 3 * (1 - h), 0.15);
    T(n.comb.gain, 0.45 * (1 - h), 0.15);
    let d = 1 / f;
    while (d < 0.006) d *= 2;
    T(n.dl.delayTime, d, G);
    if (n.out.pan) T(n.out.pan, (v.x - 0.5) * 0.6, 0.2);
    T(n.sfm.gain, f * FM_MAX * v.fm, 0.08);
    // связи: глубина в единицах своей цели; rm забирает долю прямого сигнала
    let rm = 0;
    for (const m of v.mods) {
      if (!m.g) continue;
      // fm — до ±2 октав; tzfm — индекс до 5 от частоты источника (как в настоящей FM); am — полная; rm — громкий
      const dd = m.type === 'fm' ? m.depth * 2400 : m.type === 'tzfm' ? m.depth * 5 * freq(m.src)
        : m.type === 'am' ? m.depth : m.depth * 1.6;
      if (m.type === 'rm') rm += m.depth;
      T(m.g.gain, dd, 0.08);
    }
    T(n.vca.gain, Math.max(0, 1 - rm), 0.08);
    const alive = 1 - clamp((h - 0.5) / 0.45);  // в глубине дыры звук умирает
    T(n.lvl.gain, 0.55 * v.amp * alive, 0.15);   // громкость генератора — щипок по планете
    // LFO: скорость и глубина в единицах своей цели
    for (const [key, spec] of Object.entries(v.lfo)) {
      const L = n.lfo[key];
      if (!L) continue;
      L.mo.freq.setTargetAtTime(spec.rate, t, 0.05);
      L.mp.pos.setTargetAtTime(2 * spec.morph - 1, t, 0.05);
      const [la, lb] = tableSpan(spec.morph, 0);
      useTables(L.mo, la, lb);
      const d2 = spec.depth;
      const depth = key === 'pitch' ? d2 * 700 : key === 'wave' ? d2 * 2 : key === 'cut' ? d2 * 4800
        : key === 'res' ? d2 * 20 : key === 'beat' ? d2 * 16 : key === 'shift' ? d2 * 300 : key === 'amp' ? d2 * 0.55 * v.amp * alive : d2 * f * FM_MAX;
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

  // нагрузка: если кадры стабильно тормозят — меньше кружков; когда отпустит — постепенно обратно
  // ---------- рисование ----------
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);   // 3× на iPhone — в 2.25 раза больше пикселей, на глаз почти то же
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    scopeY = safeTop.offsetHeight + 18;
    safeBot = $('safe-bot').offsetHeight;
    MENU_SPAN = Math.max(90, Math.min(150, Math.min(W, H) / 2 - MENU_DEAD - 34));
    const c = document.createElement('canvas');
    c.width = cv.width; c.height = cv.height;
    const x = c.getContext('2d');
    // характер без слов: звёзды густеют к шумной стороне орбит (влево-вверх) — туманность; у чистой почти пусто.
    // Поверх — как на старых звёздных картах: меридианы от солнца, рамка со шкалой, созвездия
    x.setTransform(DPR, 0, 0, DPR, 0, 0);
    buildGeo();
    if (!zoomed) zoom = zoomT = zoomDef();
    const { ox, oy, top: ft, bot: fb } = geo;
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const bright = [];
    for (let k = 0, n = Math.round((W * (fb - ft)) / 140); k < n; k++) {
      const px = rnd() * W, py = ft + rnd() * (fb - ft), up = unplace(px, py).c;
      if (rnd() > up * up * 0.9 + 0.04) continue;
      if (rnd() < 0.035) { bright.push({ x: px, y: py }); continue; }
      x.fillStyle = `rgba(${INK},${0.05 + 0.1 * rnd() * up})`;
      x.fillRect(px, py, 1.1, 1.1);
    }
    // созвездия: яркая звезда — к ближайшей соседке, если та недалеко
    x.strokeStyle = `rgba(${INK},0.07)`; x.lineWidth = 0.8;
    x.beginPath();
    for (const a of bright) {
      let best = null, bd = 78;
      for (const b of bright) { const d = Math.hypot(a.x - b.x, a.y - b.y); if (b !== a && d < bd && d > 14) { bd = d; best = b; } }
      if (best) { x.moveTo(a.x, a.y); x.lineTo(best.x, best.y); }
    }
    x.stroke();
    geo.stars = bright;
    for (const st of bright) {                  // звёздочка-гравюра: четыре луча и точка
      const l = 2 + rnd() * 2.2, al = 0.25 + 0.3 * rnd();
      x.strokeStyle = `rgba(${INK},${al})`; x.lineWidth = 0.8;
      x.beginPath(); x.moveTo(st.x - l, st.y); x.lineTo(st.x + l, st.y); x.moveTo(st.x, st.y - l); x.lineTo(st.x, st.y + l); x.stroke();
      x.fillStyle = `rgba(${INK},${al + 0.2})`; x.fillRect(st.x - 0.7, st.y - 0.7, 1.4, 1.4);
    }
    x.save();
    x.beginPath(); x.rect(0, ft, W, fb - ft); x.clip();
    // меридианы через 15° — это и шкала характера: у нижнего края чисто, к левому — шум
    x.setLineDash([1, 6]); x.strokeStyle = `rgba(${INK},0.09)`; x.lineWidth = 1;
    for (let d = 15; d < 90; d += 15) {
      const t = (d * Math.PI) / 180, R = Math.hypot(W, fb - ft) + 10;
      x.beginPath(); x.moveTo(ox + Math.cos(t) * 46, oy - Math.sin(t) * 46); x.lineTo(ox + Math.cos(t) * R, oy - Math.sin(t) * R); x.stroke();
    }
    x.restore();
    // рамка поля: двойная тонкая линия, по верху и правому краю — шкала делений
    x.setLineDash([]);
    x.strokeStyle = `rgba(${INK},0.16)`; x.lineWidth = 1;
    x.strokeRect(4.5, ft + 0.5, W - 9, fb - ft - 1);
    x.strokeStyle = `rgba(${INK},0.07)`;
    x.strokeRect(8.5, ft + 4.5, W - 17, fb - ft - 9);
    x.strokeStyle = `rgba(${INK},0.14)`;
    x.beginPath();
    for (let i = 0, px = 12; px < W - 10; px += 8, i++) { const l = i % 5 ? 2.5 : 4.5; x.moveTo(Math.round(px) + 0.5, ft + 4.5); x.lineTo(Math.round(px) + 0.5, ft + 4.5 + l); }
    for (let i = 0, py = ft + 12; py < fb - 6; py += 8, i++) { const l = i % 5 ? 2.5 : 4.5; x.moveTo(W - 8.5, Math.round(py) + 0.5); x.lineTo(W - 8.5 - l, Math.round(py) + 0.5); }
    x.stroke();
    scan = c; scanId++;
  }

  const ink = (a) => `rgba(${INK},${a})`;
  // мягкое круглое свечение — рисуется один раз, потом только штампуется (солнце, туманности)
  const glowSprite = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d'), gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, `rgba(${INK},1)`); gr.addColorStop(0.35, `rgba(${INK},0.45)`); gr.addColorStop(1, `rgba(${INK},0)`);
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    return c;
  })();
  function glowAt(x, y, r, a) {
    if (a <= 0.003) return;
    const ga = g.globalAlpha;
    g.globalAlpha = ga * Math.min(1, a); g.drawImage(glowSprite, x - r, y - r, 2 * r, 2 * r); g.globalAlpha = ga;
  }
  const MAP = '"IM Fell English", Georgia, "Times New Roman", serif';   // подписи на поле — как на старых звёздных картах
  function mapText(s, x, y, size, a, align = 'left', italic = true) {
    g.font = `${italic ? 'italic ' : ''}${size}px ${MAP}`; g.fillStyle = ink(a); g.textAlign = align; g.textBaseline = 'middle';
    g.fillText(s, x, y);
  }
  function ring(x, y, r, a, w) {
    g.lineWidth = w; g.strokeStyle = ink(a);
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
  }
  function dot(x, y, r, a) {
    g.fillStyle = ink(a);
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  function diamond(x, y, s, a, filled) {
    g.save(); g.translate(x, y); g.rotate(Math.PI / 4);
    g.fillStyle = filled ? ink(a) : BG; g.fillRect(-s, -s, 2 * s, 2 * s);
    g.strokeStyle = ink(a); g.lineWidth = 1.3; g.strokeRect(-s, -s, 2 * s, 2 * s);
    g.restore();
  }
  function hairBox(x, y, w, h, a) {           // тонкая рамка: панели из той же графики, что поле
    g.strokeStyle = ink(a); g.lineWidth = 1;
    g.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
  }
  // один шрифт на всё — IM Fell English: в интерфейсе прямой, на карте курсив (mapText).
  // У него мельче очко, поэтому кегль чуть больше; жирного начертания нет — акцент яркостью
  function text(s, x, y, size, a, weight = 400, align = 'left') {
    g.font = `${size + 2}px ${MAP}`; g.fillStyle = ink(a); g.textAlign = align; g.textBaseline = 'middle';
    g.fillText(s, x, y);
  }

  // кривая по функции одного цикла: формы таблиц и LFO
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

  // контур кружка — его собственный звук: два периода сигнала, обёрнутые по кругу.
  // Синус — плавные лепестки, пила и fold — зубцы, шум — рваный край, биения — контур дышит
  function contour(v, x, y, r, a, lw, glow) {
    const n = v.nodes;
    let pts = null;
    if (n && n.live && n.vscope) {
      const b = v.buf || (v.buf = new Float32Array(1024));
      n.vscope.getFloatTimeDomainData(b);
      let s0 = 0;
      for (let i = 1; i < 480; i++) if (b[i - 1] < 0 && b[i] >= 0) { s0 = i; break; }
      const span = Math.round(clamp((ctx.sampleRate / freq(v)) * 2, 64, 520));
      let pk = 0;
      for (let i = 0; i < span; i++) pk = Math.max(pk, Math.abs(b[s0 + i]));
      v.pk = Math.max(pk, (v.pk || 0) * 0.92, 0.02);
      const k = (10 / v.pk) * Math.min(1, v.env * 1.4);
      pts = [];
      const N = 128;
      for (let j = 0; j < N; j++) {
        const th = (j / N) * Math.PI * 2 - Math.PI / 2;
        const rr = r + clamp(b[s0 + Math.floor((j / N) * span)] * k, -12, 12);
        pts.push(x + Math.cos(th) * rr, y + Math.sin(th) * rr);
      }
    }
    // свечение — не shadowBlur (в Safari это самое дорогое), а широкий бледный штрих под контуром
    const halo = glow ? 1 : fx.dirt > 0.25 ? (fx.dirt - 0.25) * 1.6 : 0;   // drive — планеты раскаляются
    g.lineJoin = 'round';
    g.beginPath();
    if (pts) { for (let i = 0; i < pts.length; i += 2) (i ? g.lineTo(pts[i], pts[i + 1]) : g.moveTo(pts[i], pts[i + 1])); g.closePath(); }
    else g.arc(x, y, r, 0, Math.PI * 2);
    if (halo) { g.lineWidth = lw + 7; g.strokeStyle = ink(0.07 * halo * a); g.stroke(); g.lineWidth = lw + 3; g.strokeStyle = ink(0.12 * halo * a); g.stroke(); }
    g.lineWidth = lw; g.strokeStyle = ink(a); g.stroke();
  }

  const AMP_MIN = 0.05, AMP_MAX = 1.8;
  const planetR = (v) => 34 * (0.55 + 0.45 * v.amp);   // громче — крупнее
  // орбита спутника (LFO) — по параметру: у каждого своя высота
  const MOON_R = { pitch: 50, wave: 56, cut: 62, res: 68, beat: 74, fm: 80, shift: 86, amp: 92 };

  // планета — осциллятор. Контур — его звук (атмосфера); внутри двойная звезда — пара генераторов,
  // которая вращается со скоростью биений detune. Закреплённая — с кольцом, как у Сатурна;
  // временная — комета: хвост от солнца, длиннее, пока гаснет. Спутники — LFO
  // чёрная дыра съедает свет: у края планета тускнеет и вытягивается к центру, глубже — падает в центр,
  // сжимается и гаснет; остаётся едва видный след — за него можно вытащить. Звук — шум — идёт дальше
  function drawVoice(v, now, dt) {
    if (v.hole < 0.005) { drawPlanet(v, now, dt); return; }
    const x = vx(v), y = vy(v), c = holeAt(), a = Math.atan2(y - c.y, x - c.x), h = v.hole;
    const e = clamp((h - 0.3) / 0.7) ** 1.5, s = 1 - 0.8 * e;      // e — насколько уже съедена
    const px = x + (c.x - x) * e, py = y + (c.y - y) * e;
    g.save();
    g.translate(px, py); g.rotate(a); g.scale((1 + 0.6 * h) * s, (1 - 0.35 * h) * s); g.rotate(-a); g.translate(-x, -y);
    g.globalAlpha = Math.max(0.07, 1 - 0.8 * h - 0.2 * e);
    drawPlanet(v, now, dt);
    g.restore();
  }
  function drawPlanet(v, now, dt) {
    const k = kick(v, performance.now()), x = vx(v) + k.x, y = vy(v) + k.y;
    const held = v.fingers.length > 0;
    const editing = editor && editor.kind === 'voice' && editor.group.includes(v);
    const R = planetR(v), far = v.dx + v.wob > zoom * 1.0001;   // за горизонтом зума — у края, бледно
    const a = Math.min(1, v.env * 1.3) * (far ? 0.4 : 1);
    if (!v.pinned) {                            // хвост кометы — от солнца
      const ang = Math.atan2(y - geo.oy, x - geo.ox), fade = v.envT === 0 ? 1 - v.env : 0;
      const len = 26 + 70 * fade;
      for (const k of [-0.12, 0, 0.12]) {
        const x0 = x + Math.cos(ang + k) * (R - 4), y0 = y + Math.sin(ang + k) * (R - 4);
        const ex = Math.cos(ang + k * 1.6) * len, ey = Math.sin(ang + k * 1.6) * len;   // хвост тает двумя ступенями
        g.lineWidth = k ? 1 : 1.4;
        g.strokeStyle = ink(a * (k ? 0.18 : 0.3));
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + ex * 0.5, y0 + ey * 0.5); g.stroke();
        g.strokeStyle = ink(a * (k ? 0.07 : 0.12));
        g.beginPath(); g.moveTo(x0 + ex * 0.5, y0 + ey * 0.5); g.lineTo(x0 + ex, y0 + ey); g.stroke();
      }
    }
    if (fx.rev > 0.03) {                        // hall: туманность вокруг планеты, decay — её размер
      glowAt(x, y, 48 + 80 * invLog(DECAY_MIN, DECAY_MAX, fx.decay), 0.12 * fx.rev * a);
    }
    g.fillStyle = 'rgba(0,0,0,0.82)';            // планета закрывает орбиты за собой
    g.beginPath(); g.arc(x, y, R - 3, 0, Math.PI * 2); g.fill();
    if (v.pinned) {                             // кольцо: задняя половина тусклее, передняя ярче
      g.save(); g.translate(x, y); g.rotate(-0.42);
      g.strokeStyle = ink(a * 0.22); g.lineWidth = 1;
      g.beginPath(); g.ellipse(0, 0, R + 16, 12 * R / 34, 0, Math.PI, Math.PI * 2); g.stroke();
      g.restore();
    }
    contour(v, x, y, R, held || editing ? a : a * 0.85, held ? 2 : 1.4, held || editing);
    if (v.pinned) {
      g.save(); g.translate(x, y); g.rotate(-0.42);
      g.strokeStyle = ink(a * 0.55); g.lineWidth = 1.1;
      g.beginPath(); g.ellipse(0, 0, R + 16, 12 * R / 34, 0, 0, Math.PI); g.stroke();
      g.restore();
    }
    // двойная звезда: быстрые биения сливаются в кольцо
    v.bph = ((v.bph || 0) + dt * v.beat) % 1;
    if (v.beat > 7) ring(x, y, 5, a * 0.6, 1.2);
    else {
      const t = v.bph * Math.PI * 2;
      dot(x + Math.cos(t) * 5, y + Math.sin(t) * 5, 1.9, a);
      dot(x - Math.cos(t) * 5, y - Math.sin(t) * 5, 1.9, a * 0.75);
    }
    if (sel.has(v)) {                           // выделен лассо — бегущий пунктир
      g.save(); g.setLineDash([4, 5]); g.lineDashOffset = -now * 0.03;
      ring(x, y, 44, Math.max(0.5, a), 1); g.restore();
    }
    // спутники: орбита по параметру, размер — глубина, след за спутником — форма LFO
    for (const [key, spec] of Object.entries(v.lfo)) {
      const r = MOON_R[key] || 60, ph = spec.vph || 0, fn = morphFn(spec.morph);
      g.strokeStyle = ink(a * 0.07); g.lineWidth = 1;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = ink(a * 0.3); g.lineWidth = 1; g.lineJoin = 'round';
      g.beginPath();
      for (let i = 0; i <= 40; i++) {
        const q = ph - (i / 40) * 0.4, th = q * Math.PI * 2, rr = r + fn(((q % 1) + 1) % 1) * 4 * spec.depth;
        const px = x + Math.cos(th) * rr, py = y + Math.sin(th) * rr;
        if (i) g.lineTo(px, py); else g.moveTo(px, py);
      }
      g.stroke();
      const th = ph * Math.PI * 2, rr = r + fn(ph) * 4 * spec.depth;
      dot(x + Math.cos(th) * rr, y + Math.sin(th) * rr, 1.3 + 2 * spec.depth, a);
    }
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
      contour(v, x, y, 34, 1, 2, true);
      if (Math.hypot(f.x - x, f.y - y) > 24) {
        g.strokeStyle = ink(0.3); g.lineWidth = 1;
        g.beginPath(); g.moveTo(x, y); g.lineTo(f.x, f.y); g.stroke();
      }
      dot(f.x, f.y, 3, 1);
    }
    text(br.m.type, (p.x + q.x) / 2, (p.y + q.y) / 2 - 18, 11, 0.6, 400, 'center');
  }

  // связи — гравитационные нити: кривая к солнцу, штрих — характер (fm, tzfm, am, rm), по нити от источника
  // к приёмнику летят частицы: их число — глубина, скорость — частота источника. На середине — ручка
  const LINK_DASH = { fm: [3, 6], tzfm: [1, 3], am: [10, 6], rm: [2, 2, 8, 2] };
  function drawLinks(now, skip) {
    g.save();
    for (const v of V) {
      if (!v.active) continue;
      for (const m of v.mods) {
        const s = m.src;
        if (!s.active || m === skip) continue;
        const k = m.auto ? 0.45 : 1;
        const editing = editor && editor.m === m;
        const a = (0.15 + 0.55 * Math.min(1, s.env * 1.2)) * (0.4 + 0.6 * m.depth) * k;
        const c = linkCurve(v, m);
        g.setLineDash(LINK_DASH[m.type]); g.lineDashOffset = -now * 0.02;
        g.strokeStyle = ink(editing && editor.cutting ? 0.12 : editing ? 0.9 : a); g.lineWidth = editing ? 1.5 : 1;
        g.beginPath(); g.moveTo(c.x1, c.y1); g.quadraticCurveTo(c.cx, c.cy, c.x2, c.y2); g.stroke();
        g.setLineDash([]);
        // поток частиц: глубже — гуще, выше источник — быстрее; у концов тают
        const n = 2 + Math.round(4 * m.depth), sp = 0.18 + 0.12 * Math.log2(freq(s) / F_LO);
        const ph = (now / 1000) * sp;
        for (let i = 0; i < n; i++) {
          const t = (ph + i / n) % 1, pt = bez(c, t), fade = Math.sin(Math.PI * t);
          dot(pt.x, pt.y, 1.2 + 1.6 * m.depth * fade, Math.min(1, a * 1.6) * fade);
        }
        if (!m.auto) {
          const mid = bez(c, 0.5);
          diamond(mid.x, mid.y, 5, editing ? 1 : 0.7, editing);
          text(m.type, mid.x + 10, mid.y - 9, 10, 0.5);
        }
      }
    }
    g.restore();
  }

  function valueText(v, key) {
    if (key === 'wave') return morphName(v.wave);
    if (key === 'cut') { const c = cutoff(v); return c >= 1000 ? (c / 1000).toFixed(1) + ' kHz' : Math.round(c) + ' Hz'; }
    if (key === 'res') return Math.round(v.res * 100) + '%';
    if (key === 'beat') return v.beat.toFixed(v.beat < 10 ? 2 : 1) + ' Hz';
    if (key === 'shift') { const h = shiftHz(v.shift); return h === 0 ? 'off' : (h > 0 ? '+' : '−') + Math.abs(h).toFixed(Math.abs(h) < 10 ? 1 : 0) + ' Hz'; }
    return Math.round(v.fm * 100) + '%';
  }

  // булавка из линий: головка, перекладина, игла; закреплено — кружок залит
  function drawPin(x, y, on) {
    if (on) { g.fillStyle = ink(0.95); g.beginPath(); g.arc(x, y, PIN_R, 0, Math.PI * 2); g.fill(); }
    else { g.fillStyle = 'rgba(0,0,0,0.9)'; g.beginPath(); g.arc(x, y, PIN_R, 0, Math.PI * 2); g.fill(); ring(x, y, PIN_R, 0.8, 1.2); }
    g.save(); g.translate(x, y); g.rotate(Math.PI / 4);
    g.strokeStyle = on ? BG : ink(0.9); g.fillStyle = on ? BG : ink(0.9); g.lineWidth = 1.4; g.lineCap = 'round';
    g.beginPath(); g.arc(0, -6, 3.2, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(-5, -1.5); g.lineTo(5, -1.5); g.moveTo(0, -1.5); g.lineTo(0, 9); g.stroke();
    g.restore();
  }

  // кольцо как прибор: тонкие лучи со шкалой, значение — поперечная риска; подпись на конце луча
  function drawRing(d) {
    const { cx, cy } = d, R1 = MENU_DEAD, R2 = MENU_DEAD + d.span;
    g.fillStyle = 'rgba(0,0,0,0.74)';
    g.beginPath(); g.arc(cx, cy, R2 + 40, 0, Math.PI * 2); g.fill();
    g.save(); g.setLineDash([2, 5]); ring(cx, cy, R1, d.centerOn ? 0.9 : 0.4, 1); g.restore();
    ring(cx, cy, R2, 0.08, 1);
    for (const sc of d.sectors) {
      const on = d.sel === sc.key, a = on ? 1 : d.sel ? 0.4 : 0.75;
      const c = Math.cos(sc.ang), s = Math.sin(sc.ang), px = -s, py = c;
      g.strokeStyle = ink(a * 0.4); g.lineWidth = 1;
      g.beginPath(); g.moveTo(cx + c * R1, cy + s * R1); g.lineTo(cx + c * R2, cy + s * R2); g.stroke();
      g.beginPath();                            // шкала: риски каждые 10%, середина длиннее
      for (let k = 1; k < 10; k++) {
        const r = R1 + (k / 10) * d.span, l = k === 5 ? 5 : 2.5;
        g.moveTo(cx + c * r - px * l, cy + s * r - py * l); g.lineTo(cx + c * r + px * l, cy + s * r + py * l);
      }
      if (sc.key === 'wave') for (let i = 0; i < NW; i++) {   // у волны — станции таблиц
        const r = R1 + (i / (NW - 1)) * d.span;
        g.moveTo(cx + c * r - px * 7, cy + s * r - py * 7); g.lineTo(cx + c * r + px * 7, cy + s * r + py * 7);
      }
      g.strokeStyle = ink(a * 0.35); g.stroke();
      const val = d.get(sc.key), lv = d.live && d.live(sc.key);
      const tick = (t, l, w, al) => {
        const r = R1 + t * d.span;
        g.strokeStyle = ink(al); g.lineWidth = w;
        g.beginPath(); g.moveTo(cx + c * r - px * l, cy + s * r - py * l); g.lineTo(cx + c * r + px * l, cy + s * r + py * l); g.stroke();
      };
      if (lv) {                                 // под LFO: полоса размаха, база — тусклая риска, значение едет
        const r1 = R1 + lv.lo * d.span, r2 = R1 + lv.hi * d.span;
        g.save(); g.lineCap = 'round'; g.strokeStyle = ink(0.16); g.lineWidth = 7;
        g.beginPath(); g.moveTo(cx + c * r1, cy + s * r1); g.lineTo(cx + c * r2, cy + s * r2); g.stroke(); g.restore();
        tick(val, 5, 1.2, a * 0.5);
        tick(lv.now, on ? 10 : 8, on ? 2.5 : 2, Math.max(a, 0.85));
        const rn = R1 + lv.now * d.span;
        dot(cx + c * rn, cy + s * rn, 2.2, 1);
      } else if (val > 0 || !d.link) tick(val, on ? 10 : 7, on ? 2.5 : 1.6, a);   // значение — яркая поперечная риска
      const lx = clamp(cx + c * (R2 + 22), 30, W - 30), ly = clamp(cy + s * (R2 + 22), 14, H - 14);
      text(sc.label + (d.lfoOn && d.lfoOn(sc.key) ? ' ~' : ''), lx, ly, 12, a, on ? 500 : 400, 'center');
    }
    if (d.centerLabel) text(d.centerLabel, cx, cy + R1 + 12, 10, 0.75, 400, 'center');
    if (d.pointer) {
      g.strokeStyle = ink(0.5); g.lineWidth = 1;
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(d.pointer.x, d.pointer.y); g.stroke();
      dot(d.pointer.x, d.pointer.y, 3, 1);
    }
    if (d.readout) text(d.readout, d.readoutAt.x, d.readoutAt.y, 15, 1, 500, 'center');
  }

  // нить от сдвинутого кольца к тому, что оно правит
  function tether(cx, cy, x, y) {
    if (Math.hypot(x - cx, y - cy) <= 12) return;
    g.save(); g.setLineDash([2, 4]); g.strokeStyle = ink(0.5); g.lineWidth = 1;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(x, y); g.stroke(); g.restore();
  }
  const readoutAt = (cx, cy) => ({ x: clamp(cx, 90, W - 90), y: Math.max(scopeY + 56, cy - MENU_DEAD - MENU_SPAN - 48) });

  function drawCloseChip() {
    const c = closeChip(), on = [...F.values()].some((f) => f.ui === 'void');
    g.fillStyle = 'rgba(0,0,0,0.9)'; g.fillRect(c.x, c.y, c.w, c.h);
    hairBox(c.x, c.y, c.w, c.h, on ? 0.9 : 0.5);
    text('close', c.x + c.w / 2, c.y + c.h / 2, 12, on ? 1 : 0.8, 400, 'center');
  }

  // закреплённое кольцо кружка или связи
  function drawEditor() {
    const e = editor;
    if (e.kind === 'voice') {
      const v = e.v, x = vx(v), y = vy(v);
      tether(e.cx, e.cy, x, y);
      const many = e.group.length > 1 ? `  ×${e.group.length}` : '';
      const sc = e.sectors.find((s) => s.key === e.key);
      drawRing({
        cx: e.cx, cy: e.cy, span: MENU_SPAN, sectors: e.sectors, sel: e.key,
        get: (k) => norm(v, k), live: (k) => liveRange(v, k), lfoOn: (k) => !!v.lfo[k], centerOn: !e.key,
        centerLabel: e.key === 'amp' ? 'amp' : e.key ? null : 'pitch',
        readout: sc ? `${sc.label} · ${valueText(v, sc.key)}${many}` : e.key === 'amp' ? `amp · ${(20 * Math.log10(v.amp)).toFixed(1)} dB${many}` : null,
        readoutAt: readoutAt(e.cx, e.cy),
      });
      if (e.key === 'wave') drawCurve(morphFn(clamp(v.wave + v.wv)), e.cx, e.cy, 30, 18, 1, 2, 1.4);
      contour(v, x, y, 34, 1, 2, true);
      return;
    }
    const m = e.m, mid = linkMid(e.dst, m);
    tether(e.cx, e.cy, mid.x, mid.y);
    drawRing({
      cx: e.cx, cy: e.cy, span: MENU_SPAN, sectors: e.sectors, sel: e.cutting ? 'cut' : m.type, link: true,
      get: (k) => (k === 'cut' ? (e.cutting ? 1 : 0) : m.type === k ? m.depth : 0),
      readout: e.cutting ? 'release to cut' : `${m.type} · ${Math.round(m.depth * 100)}%`,
      readoutAt: readoutAt(e.cx, e.cy),
    });
    diamond(e.cx, e.cy, 6, 1, true);
  }

  // кольцо на весу: указатель — движение пальца, перенесённое в кольцо; булавка — закрепить
  function drawHeld(m, pointer) {
    const pin = pinPos(m.cx, m.cy);
    const at = readoutAt(m.cx, m.cy);         // значение — над кольцом, где его не закрывает ни палец, ни булавка
    if (m.voice) {
      const v = m.voice;
      tether(m.cx, m.cy, vx(v), vy(v));
      drawRing({
        cx: m.cx, cy: m.cy, span: m.span, sectors: m.sectors, sel: m.sector ? m.sector.key : null,
        get: m.get, live: (k) => liveRange(v, k), lfoOn: (k) => !!v.lfo[k], centerOn: !m.sector, centerLabel: m.sector ? null : 'pitch',
        pointer: m.sector && pointer ? pointer : null,
        readout: m.sector ? `${m.sector.label} · ${m.text(m.sector.key)}` : null, readoutAt: at,
      });
      if (m.sector && m.sector.key === 'wave') drawCurve(morphFn(clamp(v.wave + v.wv)), at.x, at.y - 30, 60, 22, 1);
      contour(v, vx(v), vy(v), 34, 1, 2, true);
    } else {
      const mid = linkMid(m.dst, m.link);
      tether(m.cx, m.cy, mid.x, mid.y);
      drawRing({
        cx: m.cx, cy: m.cy, span: m.span, sectors: m.sectors, sel: m.sector ? m.sector.key : m.link.type, link: true,
        get: m.get, pointer: m.sector && pointer ? pointer : null,
        readout: m.sector ? `${m.sector.label} · ${m.text(m.sector.key)}` : `${m.link.type} · ${Math.round(m.link.depth * 100)}%`,
        readoutAt: at,
      });
      diamond(m.cx, m.cy, 6, 1, true);
    }
    if (pointer && !m.sector) {               // путь пальца, пока луч не выбран (например, к булавке)
      g.strokeStyle = ink(0.4); g.lineWidth = 1;
      g.beginPath(); g.moveTo(m.cx, m.cy); g.lineTo(pointer.x, pointer.y); g.stroke();
      dot(pointer.x, pointer.y, 3, 0.8);
    }
    if (m.overPin) { ring(pin.x, pin.y, PIN_R + 5, 0.35, 3); drawPin(pin.x, pin.y, true); }
    else drawPin(pin.x, pin.y, false);
  }

  // веер FX: тот же прибор, жест с удержанием
  function drawFx(f) {
    const m = f.menu, R2 = MENU_DEAD + m.span;
    const pointer = { x: m.cx + (f.x - m.gx), y: m.cy + (f.y - m.gy) };
    drawRing({
      cx: m.cx, cy: m.cy, span: m.span, sectors: m.sectors, sel: m.sector ? m.sector.key : null,
      get: m.get, pointer: m.sector ? pointer : null,
      readout: m.sector ? `${m.sector.label} · ${m.text(m.sector.key)}` : null,
      readoutAt: { x: m.cx - R2 * 0.55, y: m.cy + R2 + 64 },
    });
  }

  // панель LFO: полоса формы (те же таблицы с морфингом) и пад: вправо — скорость, вверх — глубина.
  // На паде бежит сама LFO-волна — видно и темп, и размах
  function drawLfoPanel(tg, now) {
    const p = lfoPanel(), spec = tg.v.lfo[tg.key], pd = p.pad;
    let lf = null;
    for (const f of F.values()) if (f.ui === 'lfo') lf = f;
    g.fillStyle = 'rgba(0,0,0,0.9)';
    g.fillRect(0, p.top - 10, W, p.bottom - p.top + 18);
    g.strokeStyle = ink(0.2); g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, p.top - 9.5); g.lineTo(W, p.top - 9.5); g.stroke();

    const many = tg.group && tg.group.length > 1 ? ` ×${tg.group.length}` : '';
    text(`LFO → ${LFO_TARGET_LABEL[tg.key]}${many}`, p.x, p.top + 6, 13, 1, 500);
    if (spec) {
      const hz = spec.rate < 1 ? spec.rate.toFixed(2) : spec.rate.toFixed(spec.rate < 10 ? 2 : 1);
      text(`${hz} Hz · ${Math.round(spec.depth * 100)}%`, p.x + p.w - 58, p.top + 6, 15, 1, 500, 'right');
      const o = offChip(), on = [...F.values()].some((f) => f.ui === 'lfooff');
      hairBox(o.x, o.y, o.w, o.h, on ? 0.9 : 0.45);
      text('off', o.x + o.w / 2, o.y + o.h / 2, 12, on ? 1 : 0.75, 400, 'center');
    } else text('drag the pad', p.x + p.w, p.top + 6, 12, 0.5, 400, 'right');

    // форма: таблицы по местам, рамка — текущая
    const sh = p.shape;
    hairBox(p.x, sh.y, p.w, sh.h, lf && lf.strip === 'shape' ? 0.8 : 0.3);
    for (let i = 0; i < NW; i++) drawCurve(WAVES[i].fn, p.x + 22 + (i / (NW - 1)) * (p.w - 44), sh.y + sh.h / 2, 24, 16, 0.3, 1, 1.1);
    if (spec) {
      const mx = p.x + 22 + spec.morph * (p.w - 44);
      hairBox(mx - 24, sh.y + 4, 48, sh.h - 8, 0.9);
      drawCurve(morphFn(spec.morph), mx, sh.y + sh.h / 2, 38, 22, 1, 1.5, 1.6);
    }

    // пад: шкала скорости по низу (0.1 / 1 / 10 Hz), глубины по левому краю
    const on = lf && lf.strip === 'pad';
    hairBox(p.x, pd.y, p.w, pd.h, on ? 0.8 : 0.3);
    const by = pd.y + pd.h - 0.5;
    g.strokeStyle = ink(0.1); g.lineWidth = 1;
    g.beginPath();
    for (const hz of [0.1, 1, 10]) { const x = Math.round(rateX(p, hz)) + 0.5; g.moveTo(x, pd.y + 1); g.lineTo(x, by); }
    for (const d of [0.25, 0.5, 0.75]) { const y = Math.round(depthY(p, d)) + 0.5; g.moveTo(p.x + 1, y); g.lineTo(p.x + 7, y); g.moveTo(p.x + p.w - 7, y); g.lineTo(p.x + p.w - 1, y); }
    g.stroke();
    g.strokeStyle = ink(0.3); g.beginPath();
    for (let k = -1; k <= 1; k++) for (let j = 1; j <= 9; j++) {   // логарифмические риски
      const hz = j * 10 ** k;
      if (hz < LFO_RATE_MIN || hz > LFO_RATE_MAX) continue;
      const x = Math.round(rateX(p, hz)) + 0.5;
      g.moveTo(x, by); g.lineTo(x, by - (j === 1 ? 7 : 3));
    }
    g.stroke();
    for (const [hz, s] of [[0.1, '0.1'], [1, '1'], [10, '10 Hz']]) text(s, rateX(p, hz) + 4, by - 12, 10, 0.45);
    text('depth', p.x + 10, pd.y + 12, 10, 0.45);
    if (!spec) return;

    // сама LFO-волна: окно в 2 с, правый край — «сейчас»; размах — глубина
    const cx = rateX(p, spec.rate), cy = depthY(p, spec.depth), mid = pd.y + pd.h / 2;
    const amp = spec.depth * (pd.h / 2 - PAD_IN), fn = morphFn(spec.morph), span = 2 * spec.rate;
    g.save();
    g.beginPath(); g.rect(p.x + 1, pd.y + 1, p.w - 2, pd.h - 2); g.clip();
    g.strokeStyle = ink(on ? 0.5 : 0.32); g.lineWidth = 1.2; g.lineJoin = 'round';
    g.beginPath();
    const N = Math.min(600, Math.max(120, Math.round(span * 24)));
    for (let i = 0; i <= N; i++) {
      const t = i / N, ph = (((spec.ph || 0) - (1 - t) * span) % 1 + 1) % 1;
      const x = p.x + PAD_IN + t * (p.w - 2 * PAD_IN), y = mid - fn(ph) * amp;
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.stroke();
    // перекрестье на значении и бегущая точка «сейчас»
    g.setLineDash([2, 4]); g.strokeStyle = ink(0.35); g.lineWidth = 1;
    g.beginPath(); g.moveTo(Math.round(cx) + 0.5, pd.y + 1); g.lineTo(Math.round(cx) + 0.5, by);
    g.moveTo(p.x + 1, Math.round(cy) + 0.5); g.lineTo(p.x + p.w - 1, Math.round(cy) + 0.5); g.stroke();
    g.restore();
    dot(p.x + p.w - PAD_IN, mid - fn(spec.ph || 0) * amp, 2.5, 0.9);
    ring(cx, cy, on ? 11 : 8, 1, on ? 2 : 1.4);
    dot(cx, cy, 2.5, 1);
  }

  // полоса громкости: шкала в дБ, риски −24 · −12 · −6 · 0, бегунок; при LFO на громкость — полоса размаха
  function drawAmpStrip(tg) {
    const a = ampStrip(), v = tg.v;
    let af = null;
    for (const f of F.values()) if (f.ui === 'amp') af = f;
    g.fillStyle = 'rgba(0,0,0,0.9)'; g.fillRect(0, a.y - 10, W, a.h + 16);
    hairBox(a.x, a.y, a.w, a.h, af ? 0.8 : 0.3);
    const X = (amp) => a.x + PAD_IN + ampT(amp) * (a.w - 2 * PAD_IN), by = a.y + a.h - 8;
    g.strokeStyle = ink(0.3); g.lineWidth = 1; g.beginPath();
    for (const db of [-24, -18, -12, -6, 0]) { const x = Math.round(X(10 ** (db / 20))) + 0.5; g.moveTo(x, by); g.lineTo(x, by - (db === 0 ? 8 : 4)); }
    g.stroke();
    const spec = v.lfo.amp;
    if (spec) {                                  // тремоло: размах
      const lo = Math.max(AMP_MIN, v.amp * (1 - spec.depth)), hi = Math.min(AMP_MAX, v.amp * (1 + spec.depth));
      g.fillStyle = ink(0.12); g.fillRect(X(lo), a.y + 4, X(hi) - X(lo), a.h - 8);
    }
    const x = X(v.amp);
    g.strokeStyle = ink(1); g.lineWidth = 2;
    g.beginPath(); g.moveTo(a.x + PAD_IN, by + 0.5); g.lineTo(x, by + 0.5); g.moveTo(x, a.y + 5); g.lineTo(x, by + 3); g.stroke();
    const db = 20 * Math.log10(v.amp), many = tg.group && tg.group.length > 1 ? ` ×${tg.group.length}` : '';
    text('amp' + (spec ? ' ~' : ''), a.x + 10, a.y + 12, 11, 0.55);
    text(`${Math.abs(db) < 0.05 ? '0' : (db > 0 ? '+' : '−') + Math.abs(db).toFixed(1)} dB${many}`, a.x + a.w - 10, a.y + 12, 13, 1, 500, 'right');
  }

  // поле по горизонтали — вертикальные полосы в оттенках серого. Без лада — диапазоны частот,
  // как на эквалайзере; с ладом — октавы от тоники и ноты лада. Пока тянешь кружок, его полоса
  // светлеет, внизу подписи; в ладу — ещё и нота, к которой он притянут
  const BANDS = [[55, 'sub'], [90, 'bass'], [250, 'low-mid'], [500, 'mid'], [1000, 'upper']];
  const semiOf = (hz) => 12 * Math.log2(hz / F_LO);
  const noteName = (n) => { const m = 33 + n; return NOTES[((n % 12) + 12) % 12] + (Math.floor(m / 12) - 1); };   // n — полутоны от A1
  function fieldCols() {
    const cols = [];
    if (scl.on) {
      const first = (((scl.root % 12) + 12) % 12);
      if (first > 0) cols.push({ s0: 0, s1: first, label: '' });
      for (let n = first; n < SEMIS; n += 12) cols.push({ s0: n, s1: Math.min(SEMIS, n + 12), label: noteName(n) });
    } else {
      BANDS.forEach(([hz, label], i) => {
        const s1 = i + 1 < BANDS.length ? semiOf(BANDS[i + 1][0]) : SEMIS;
        cols.push({ s0: semiOf(hz), s1, label, hz: i ? hz : null });
      });
    }
    const far = Math.hypot(W, geo.bot - geo.top) + 8;
    cols.forEach((c, i) => { c.r0 = i ? Math.min(far, rAt(xOf(c.s0))) : 0; c.r1 = c.s1 >= SEMIS ? far : Math.min(far, rAt(xOf(c.s1))); });
    return cols;
  }

  // солнце, как на гравюре: двойной диск, лучи — прямые и волнистые «пламенные» через один.
  // Медленно поворачивается; с громкостью лучи вытягиваются, а свечение за ним чуть ярче
  // чёрная дыра: тень (абсолютная чернота — свет и орбиты сюда не доходят), фотонное кольцо, наклонный аккреционный диск.
  // Тихо; диск разгорается и крутится быстрее, пока дыра ест; горизонт событий проявляется, когда тащишь планету рядом
  function drawHole(now) {
    const c = holeAt();
    g.save(); g.beginPath(); g.rect(c.x, c.y, W, H); g.clip();   // видна четверть
    let feed = 0, near = 0;
    for (const v of V) if (v.active) feed = Math.max(feed, v.hole * v.env);
    for (const f of F.values()) {
      const v = f.voice;
      if (v && f.moved && !f.ui && !f.parked && !f.bridge && !f.menu) near = Math.max(near, clamp((HOLE_R * 1.7 - Math.hypot(f.x + v.ox - c.x, f.y + v.oy - c.y)) / (HOLE_R * 0.7)));
    }
    const spin = now * (0.004 + 0.02 * feed), tilt = -0.5, S = HOLE_R * 0.46;
    const disk = (front) => {
      for (let i = 0; i < 4; i++) {
        const rx = HOLE_R * (0.62 + 0.22 * i), ry = rx * 0.3;
        g.strokeStyle = ink((0.1 + 0.3 * feed) * (1 - i * 0.2)); g.lineWidth = 0.8;
        g.setLineDash([2 + i, 4 + 2 * i]); g.lineDashOffset = -spin * (5 - i);
        g.beginPath(); g.ellipse(c.x, c.y, rx, ry, tilt, front ? 0 : Math.PI, front ? Math.PI : Math.PI * 2); g.stroke();
      }
      g.setLineDash([]);
    };
    disk(false);
    g.fillStyle = '#000'; g.beginPath(); g.arc(c.x, c.y, S, 0, Math.PI * 2); g.fill();
    ring(c.x, c.y, S + 1.5, 0.45 + 0.35 * feed, 1);
    ring(c.x, c.y, S + 4, 0.12 + 0.15 * feed, 0.8);
    disk(true);
    g.setLineDash([1, 6]); ring(c.x, c.y, HOLE_R, 0.1 + 0.35 * near, 1); g.setLineDash([]);
    g.restore();
  }

  // удар солнца: отдача — планету отбрасывает от солнца и она возвращается
  const STRIKE_MS = 110, NO_KICK = { x: 0, y: 0 };
  function kick(v, now) {
    const st = v.strike, age = st ? now - st.t0 : Infinity;
    if (age > 700) return NO_KICK;
    const m = (6 + 16 * st.p) * (1 - Math.exp(-age / 14)) * Math.exp(-age / 130);
    return { x: Math.cos(st.a) * m, y: Math.sin(st.a) * m };
  }

  function drawSun() {
    const { ox, oy } = geo, L = sunLevel, rot = performance.now() * 0.00004;
    glowAt(ox, oy, 90 + 50 * L + 60 * fx.dirt, 0.16 + 0.2 * L + 0.2 * fx.dirt);
    const N = 28;
    g.lineWidth = 0.9;
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2 + rot;
      if (Math.sin(a) > 0.05 || Math.cos(a) < -0.05) continue;   // видна только четверть
      const c = Math.cos(a), s = Math.sin(a), px = -s, py = c;
      const D = fx.dirt, jag = D > 0.2 ? (Math.random() - 0.3) * 14 * (D - 0.2) : 0;   // drive — лучи рвутся
      if (k % 2) {                              // прямой луч — узкий клин
        const l = 50 + 22 * L + 34 * D + jag, w = 2.6;
        g.strokeStyle = ink(0.42 + 0.3 * L);
        g.beginPath();
        g.moveTo(ox + c * 17 + px * w, oy + s * 17 + py * w); g.lineTo(ox + c * l, oy + s * l);
        g.lineTo(ox + c * 17 - px * w, oy + s * 17 - py * w); g.stroke();
      } else {                                  // волнистый — пламя
        const l = 38 + 16 * L + 26 * D + jag;
        g.strokeStyle = ink(0.3 + 0.3 * L);
        g.beginPath();
        for (let i = 0; i <= 14; i++) {
          const t = i / 14, r = 17 + t * (l - 17), wv = Math.sin(t * Math.PI * (3 + 3 * D) + rot * 40) * 2.2 * (1 + 2 * D) * (1 - t * 0.5);
          const X = ox + c * r + px * wv, Y = oy + s * r + py * wv;
          if (i) g.lineTo(X, Y); else g.moveTo(X, Y);
        }
        g.stroke();
      }
    }
    // планету тянут на солнце (палец заходит в его зону) — солнце бьёт её: молния, треск, отдача; глубже — чаще и сильнее
    const now = performance.now();
    for (const f of F.values()) {
      const v = f.voice;
      if (!v || !f.moved || f.ui || f.parked || f.bridge || f.menu) continue;
      const t = clamp((SUN_R + 24 - Math.hypot(f.x + v.ox - ox, f.y + v.oy - oy)) / 70);
      if (t <= 0 || now < (v.strikeNext || 0)) continue;
      v.strike = { t0: now, p: t, a: Math.atan2(vy(v) - oy, vx(v) - ox) };
      v.strikeNext = now + (440 - 320 * t) * (0.6 + 0.8 * Math.random());
      strikeSound(t);
    }
    for (const v of V) {                        // молния живёт ~0.1 с после удара и мерцает
      const st = v.strike;
      if (!st || !v.active || now - st.t0 > STRIKE_MS || Math.random() < 0.25) continue;
      const k = kick(v, now), px = vx(v) + k.x, py = vy(v) + k.y, d = Math.hypot(px - ox, py - oy), R = planetR(v), t = st.p;
      for (let s = 0, n = 1 + Math.round(2 * t); s < n; s++) {
        const a = st.a + ((Math.random() - 0.5) * R) / d, end = d - R * 0.85, c = Math.cos(a), s2 = Math.sin(a);
        g.strokeStyle = ink(0.4 + 0.5 * t); g.lineWidth = 0.8 + 0.8 * t;
        g.beginPath();
        for (let i = 0; i <= 8; i++) {
          const r = 17 + ((end - 17) * i) / 8, j = i && i < 8 ? (Math.random() - 0.5) * (6 + 8 * t) : 0;
          const X = ox + c * r - s2 * j, Y = oy + s2 * r + c * j;
          if (i) g.lineTo(X, Y); else g.moveTo(X, Y);
        }
        g.stroke();
        glowAt(ox + c * end, oy + s2 * end, 10 + 14 * t, 0.2 + 0.4 * t);
      }
    }
    g.fillStyle = BG; g.beginPath(); g.arc(ox, oy, 14, 0, Math.PI * 2); g.fill();
    ring(ox, oy, 14, 0.7, 1); ring(ox, oy, 10.5, 0.35, 0.8);
  }

  // гравированная орбита: двойная линия и засечки по внешней
  function engraved(r, a, g = cv.getContext('2d')) {
    const { ox, oy } = geo, Q = -Math.PI / 2;
    g.strokeStyle = ink(a); g.lineWidth = 1;
    g.beginPath(); g.arc(ox, oy, r, Q, 0); g.stroke();
    g.strokeStyle = ink(a * 0.5);
    g.beginPath(); g.arc(ox, oy, r + 2.5, Q, 0); g.stroke();
    g.strokeStyle = ink(a * 0.8);
    g.beginPath();
    for (let d = 1.5; d < 90; d += 3) {
      const t = (d * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
      g.moveTo(ox + c * (r + 2.5), oy - s * (r + 2.5)); g.lineTo(ox + c * (r + 5), oy - s * (r + 5));
    }
    g.stroke();
  }

  // где дуга радиуса r пересекает край поля: чистый конец (низ или правый край) и шумный (левый или верхний)
  function arcEnds(r) {
    const { oy, top, bot } = geo, h = oy - top - EDGE_T + 4;   // верх — под строкой кнопок
    const clean = r < W - 4 ? { x: r, y: bot } : { x: W, y: oy - Math.sqrt(Math.max(0, r * r - W * W)) };
    const noisy = r < h ? { x: 0, y: oy - r } : { x: Math.sqrt(Math.max(0, r * r - h * h)), y: oy - h };
    return { clean, noisy };
  }

  // слой орбит: границы диапазонов, а в ладу — ноты и тоники. Рисуется заново, только когда меняется
  // зум, лад или размер экрана; в кадре — одна копия картинки
  let orbC = null, orbKey = '';
  function orbitLayer(cols) {
    const key = `${zoom.toFixed(4)}|${scl.on}|${scl.idx}|${scl.root}|${W}x${H}|${DPR}`;
    if (orbC && key === orbKey) return orbC;
    orbKey = key;
    if (!orbC) orbC = document.createElement('canvas');
    orbC.width = Math.round(W * DPR); orbC.height = Math.round(H * DPR);
    const o = orbC.getContext('2d');
    o.setTransform(DPR, 0, 0, DPR, 0, 0);
    o.clearRect(0, 0, W, H);
    o.save(); o.beginPath(); o.rect(0, geo.top, W, geo.bot - geo.top); o.clip();
    cols.forEach((c, i) => { if (i && c.r0 < 1e5) engraved(c.r0, 0.12, o); });
    if (scl.on) {
      const Q = -Math.PI / 2;
      for (let n = 0; n <= SEMIS; n++) {         // ноты лада — пунктирные орбиты, тоники (октавы) — гравированные
        if (!inScale(n)) continue;
        const rn = rAt(xOf(n));
        if (rn === Infinity) break;
        if ((((n - scl.root) % 12) + 12) % 12 === 0) { o.setLineDash([]); engraved(rn, 0.16, o); continue; }
        o.setLineDash([1, 5]); o.strokeStyle = `rgba(${INK},0.16)`; o.lineWidth = 1;
        o.beginPath(); o.arc(geo.ox, geo.oy, rn, Q, 0); o.stroke();
      }
    }
    o.restore();
    return orbC;
  }

  // непрозрачный фон кадра: чёрный, звёзды с рамкой и меридианами, орбиты. Один проход по экрану вместо трёх;
  // собирается заново вместе со слоем орбит
  let bgC = null, bgKey = '', scanId = 0;
  function bgLayer(cols) {
    const L = orbitLayer(cols), key = orbKey + '|' + scanId;
    if (bgC && key === bgKey) return bgC;
    bgKey = key;
    if (!bgC) bgC = document.createElement('canvas');
    bgC.width = L.width; bgC.height = L.height;
    const b = bgC.getContext('2d');
    b.fillStyle = BG; b.fillRect(0, 0, bgC.width, bgC.height);
    if (scan) b.drawImage(scan, 0, 0);
    b.drawImage(L, 0, 0);
    // краешек дыры: свет слабо тает вдоль шумного края поля, на границе — едва видный пунктир
    b.setTransform(DPR, 0, 0, DPR, 0, 0);
    const ex = EDGE + RIM_W, ey = geo.top + EDGE_T + RIM_W, sy = geo.oy - SUN_R;
    let gr = b.createLinearGradient(0, 0, ex, 0);
    gr.addColorStop(0, 'rgba(0,0,0,0.7)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    b.fillStyle = gr; b.fillRect(0, ey, ex, sy - ey);
    gr = b.createLinearGradient(0, geo.top, 0, ey);
    gr.addColorStop(0, 'rgba(0,0,0,0.7)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    b.fillStyle = gr; b.fillRect(0, geo.top, W, ey - geo.top);
    b.setLineDash([1, 5]); b.strokeStyle = ink(0.14); b.lineWidth = 1;
    b.beginPath(); b.moveTo(EDGE, sy); b.lineTo(EDGE, geo.top + EDGE_T); b.lineTo(W, geo.top + EDGE_T); b.stroke();
    b.setLineDash([]); b.setTransform(1, 0, 0, 1, 0, 0);
    return bgC;
  }

  function drawField() {
    const { ox, oy, top, bot } = geo;
    const held = [];
    for (const f of F.values()) if (f.voice && !f.ui && !f.parked && !f.bridge && !f.menu) held.push(f.voice);
    const drag = held.length > 0;
    const zk = clamp((zoomShow - performance.now()) / 400);   // зум: 1 — пока щиплешь, дальше тает
    const heldS = held.map((v) => semi(soundX(v)));
    const cols = fieldCols();
    const Q = -Math.PI / 2;
    g.drawImage(bgLayer(cols), 0, 0, W, H);
    g.save();
    g.beginPath(); g.rect(0, top, W, bot - top); g.clip();
    drawSun();
    drawHole(performance.now());
    if (fx.chaos > 0.02 && geo.stars) {         // chaos — звёзды мерцают
      for (let k = 0, n = Math.round(fx.chaos * 14); k < n; k++) {
        const st = geo.stars[Math.floor(Math.random() * geo.stars.length)];
        if (st) dot(st.x, st.y, 1 + Math.random() * 1.4, Math.random() * 0.7 * fx.chaos + 0.1);
      }
    }
    cols.forEach((c) => {                       // полоса под кружком — едва светлее
      if (heldS.some((s) => s >= c.s0 && s < c.s1 + (c.s1 >= SEMIS ? 1 : 0))) {
        g.fillStyle = ink(0.045); g.beginPath(); g.arc(ox, oy, c.r1, Q, 0); g.arc(ox, oy, c.r0, 0, Q, true); g.closePath(); g.fill();
      }
    });
    // орбиты уже в фоне; при перетаскивании и зуме — поверх ещё раз, ярче
    const boost = drag ? 0.8 : 1.5 * zk;
    if (boost > 0.02) { g.globalAlpha = Math.min(1, boost); g.drawImage(orbitLayer(cols), 0, 0, W, H); g.globalAlpha = 1; }
    const tgt = new Map();                      // нота, к которой притянут кружок → сам кружок
    if (scl.on) {
      held.forEach((v, i) => tgt.set(Math.round(heldS[i]), v));
      for (const n of tgt.keys()) {             // её орбита — ярко
        const rn = rAt(xOf(n));
        if (!inScale(n) || rn === Infinity) continue;
        g.strokeStyle = ink(0.7); g.lineWidth = 1.4;
        g.beginPath(); g.arc(ox, oy, rn, Q, 0); g.stroke();
      }
    }
    g.restore();
    if (zk > 0) {                               // зум: докуда сейчас видно поле
      const hz = F_LO * 2 ** (semi(zoom) / 12);
      mapText(`55 – ${hz >= 1000 ? (hz / 1000).toFixed(2) + ' kHz' : Math.round(hz) + ' Hz'}`, W / 2, top + 76, 17, 0.9 * zk, 'center');
    }
    if (!drag && zk <= 0) return;
    const la = drag ? 1 : zk;                   // подписи — при перетаскивании или при зуме
    // подписи: имя полосы — у чистого конца её дуги, граница в герцах — у шумного
    cols.forEach((c) => {
      const on = heldS.some((s) => s >= c.s0 && s < c.s1 + (c.s1 >= SEMIS ? 1 : 0));
      const rm = c.s1 >= SEMIS ? (c.r0 + Math.min(c.r1, Math.hypot(W, bot - top))) / 2 : (c.r0 + c.r1) / 2;
      if (c.label && c.r1 - c.r0 > 16) {
        const e = arcEnds(rm).clean;
        const lab = scl.on ? c.label : c.label[0].toUpperCase() + c.label.slice(1);
        const al = on ? 0.95 : drag ? 0.5 : 0.85 * la;
        if (e.y >= bot - 1) mapText(lab, e.x, bot - 13, 15, al, 'center');
        else mapText(lab, W - 14, e.y, 15, al, 'right');
      }
      if (c.hz) {
        const e = arcEnds(c.r0).noisy;
        mapText(c.hz >= 1000 ? `${c.hz / 1000}k` : `${c.hz}`, e.x + 12, e.x < 1 ? e.y - 9 : top + EDGE_T - 4, 12, drag ? 0.5 : 0.75 * la);
      }
    });
    // в ладу — имя ноты рядом с кружком, снаружи по радиусу
    for (const [n, v] of tgt) {
      if (!inScale(n)) continue;
      const pt = place(xOf(n), v.y), a = Math.atan2(pt.y - oy, pt.x - ox);
      mapText(noteName(n), clamp(pt.x + Math.cos(a) * 54, 18, W - 18), clamp(pt.y + Math.sin(a) * 54, top + 12, bot - 12), 17, 1, 'center');
    }
  }

  // долгое касание пойманного кружка: дуга дорисовывается — и открывается кольцо
  function drawHold(now) {
    for (const f of F.values()) {
      if (f.menu || f.menuWas || f.moved || f.bridge || !f.caught || !f.voice || f.voice.fingers.length !== 1) continue;
      const p = (now - f.t0) / HOLD_MS;
      if (p < 0.15 || p >= 1) continue;
      const v = f.voice;
      g.strokeStyle = ink(0.85); g.lineWidth = 2;
      g.beginPath(); g.arc(vx(v), vy(v), 46, -Math.PI / 2, -Math.PI / 2 + ((p - 0.15) / 0.85) * Math.PI * 2); g.stroke();
    }
  }

  // громкость: узкая шкала-гравюра — двойная линия, засечка нуля, риска уровня; зажата — длинная шкала вниз с подписью
  function drawVol(held, dim) {
    const b = btnPos('vol'), h = 30, y0 = b.y - h / 2, ly = (t) => y0 + (1 - t) * h, z = ly(VOL_DEF);
    g.fillStyle = 'rgba(0,0,0,0.88)'; g.fillRect(b.x - 9, y0 - 6, 18, h + 12);
    const a = dim ? 0.15 : 1;
    g.strokeStyle = ink(0.35 * a); g.lineWidth = 1;
    g.beginPath(); g.moveTo(b.x - 1.5, y0); g.lineTo(b.x - 1.5, y0 + h); g.moveTo(b.x + 1.5, y0); g.lineTo(b.x + 1.5, y0 + h); g.stroke();
    g.beginPath(); g.moveTo(b.x - 5, z); g.lineTo(b.x - 2.5, z); g.moveTo(b.x + 2.5, z); g.lineTo(b.x + 5, z); g.stroke();
    g.strokeStyle = ink((held ? 1 : 0.8) * a); g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(b.x - 6, ly(vol)); g.lineTo(b.x + 6, ly(vol)); g.stroke();
    if (!held) return;
    const top = b.y + 34, L = VOL_TRAVEL, sy = (t) => top + (1 - t) * L;
    g.fillStyle = 'rgba(0,0,0,0.9)'; g.fillRect(b.x - 22, top - 14, 92, L + 28);
    hairBox(b.x - 22, top - 14, 92, L + 28, 0.3);
    g.strokeStyle = ink(0.4); g.lineWidth = 1;
    g.beginPath(); g.moveTo(b.x - 1.5, top); g.lineTo(b.x - 1.5, top + L); g.moveTo(b.x + 1.5, top); g.lineTo(b.x + 1.5, top + L); g.stroke();
    g.beginPath();
    for (let db = VOL_LO; db <= VOL_HI; db += 6) {   // засечки через 6 дБ, у нуля длиннее
      const y = sy((db - VOL_LO) / (VOL_HI - VOL_LO)), l = db === 0 ? 9 : 5;
      g.moveTo(b.x - 2.5 - l, y); g.lineTo(b.x - 2.5, y);
    }
    g.stroke();
    g.strokeStyle = ink(1); g.lineWidth = 2;
    g.beginPath(); g.moveTo(b.x - 9, sy(vol)); g.lineTo(b.x + 9, sy(vol)); g.stroke();
    text(volText(vol), b.x + 14, sy(vol), 14, 0.95);
  }

  function drawUI() {
    let revF = null, sclF = null, volF = null;
    for (const f of F.values()) { if (f.ui === 'rev') revF = f; if (f.ui === 'scl') sclF = f; if (f.ui === 'vol') volF = f; }

    // FX: три кольца; дуга вокруг — сколько зала
    // верхняя строка: тёмная подложка-градиент, слева заголовок
    const tb = g.createLinearGradient(0, 0, 0, scopeY + 64);
    tb.addColorStop(0, 'rgba(0,0,0,0.85)'); tb.addColorStop(0.6, 'rgba(0,0,0,0.55)'); tb.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = tb; g.fillRect(0, 0, W, scopeY + 64);
    mapText('touch2decay', 16, scopeY + 20, 19, sclF || revF ? 0.12 : 0.85);   // при открытом тулбоксе или веере FX заголовок уходит в тень
    g.font = `italic 19px ${MAP}`; titleW = g.measureText('touch2decay').width;
    drawVol(!!volF, !!(sclF || revF));
    // кнопки лежат поверх карты — у каждой тёмная подложка
    const pad = (p, rr) => { g.fillStyle = 'rgba(0,0,0,0.88)'; g.beginPath(); g.arc(p.x, p.y, rr, 0, Math.PI * 2); g.fill(); };
    pad(btnPos('rev'), BTN_R + 1); pad(btnPos('scl'), BTN_R + 1); pad(btnPos('undo'), CLR_R + 1); pad(btnPos('clr'), CLR_R + 1); pad(btnPos('dice'), CLR_R + 1);
    const r = btnPos('rev');
    ring(r.x, r.y, BTN_R, revF ? 1 : 0.45, 1.2);
    for (const [rr, a] of [[6, 0.9], [11, 0.55], [16, 0.3]]) ring(r.x, r.y, rr, a * (revF ? 1 : 0.8), 1);
    g.strokeStyle = ink(0.9); g.lineWidth = 2;
    g.beginPath(); g.arc(r.x, r.y, BTN_R + 5, -Math.PI / 2, -Math.PI / 2 + fx.rev * Math.PI * 2); g.stroke();

    // кубик: кружок с костью; после броска кость крутится
    const dq = btnPos('dice'), diceF = [...F.values()].some((f) => f.ui === 'dice');
    ring(dq.x, dq.y, CLR_R, diceF ? 1 : 0.45, 1.2);
    g.save(); g.translate(dq.x, dq.y); g.rotate(0.18 + (performance.now() - diceAt < 400 ? (performance.now() - diceAt) / 60 : 0));
    g.strokeStyle = ink(0.8); g.lineWidth = 1.2;
    g.beginPath(); g.roundRect ? g.roundRect(-7, -7, 14, 14, 2.5) : g.rect(-7, -7, 14, 14); g.stroke();
    g.fillStyle = ink(0.85);
    for (const [px, py] of [[-3.2, -3.2], [3.2, -3.2], [0, 0], [-3.2, 3.2], [3.2, 3.2]]) { g.beginPath(); g.arc(px, py, 1.1, 0, Math.PI * 2); g.fill(); }
    g.restore();

    // отмена: стрелка по дуге; под ней — точки по числу шагов в запасе
    const u = btnPos('undo'), can = hist.length > 0, flash = performance.now() - undoAt < 250;
    ring(u.x, u.y, CLR_R, flash ? 1 : can ? 0.45 : 0.18, flash ? 2 : 1.2);
    g.strokeStyle = ink(can ? 0.8 : 0.25); g.lineWidth = 1.4; g.lineCap = 'round';
    g.beginPath(); g.arc(u.x + 1, u.y + 1, 6, Math.PI * 1.05, Math.PI * 2.35); g.stroke();
    g.beginPath(); g.moveTo(u.x - 8.5, u.y - 3.5); g.lineTo(u.x - 5, u.y + 1.5); g.lineTo(u.x - 1, u.y - 2); g.stroke();
    g.lineCap = 'butt';
    for (let i = 0; i < hist.length; i++) dot(u.x - ((hist.length - 1) * 4) / 2 + i * 4, u.y + CLR_R + 7, 1.1, 0.5);

    // убрать всё: корзина (не крестик — его легко принять за «закрыть»)
    const c = btnPos('clr');
    const live = V.some((v) => v.active);
    ring(c.x, c.y, CLR_R, live ? 0.45 : 0.18, 1.2);
    g.strokeStyle = ink(live ? 0.75 : 0.25); g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(c.x - 7, c.y - 4.5); g.lineTo(c.x + 7, c.y - 4.5);                 // крышка
    g.moveTo(c.x - 2.5, c.y - 7); g.lineTo(c.x + 2.5, c.y - 7);                 // ручка
    g.moveTo(c.x - 5.5, c.y - 4.5); g.lineTo(c.x - 4.3, c.y + 7); g.lineTo(c.x + 4.3, c.y + 7); g.lineTo(c.x + 5.5, c.y - 4.5);
    g.moveTo(c.x - 1.6, c.y - 1.5); g.lineTo(c.x - 1.4, c.y + 4.5); g.moveTo(c.x + 1.6, c.y - 1.5); g.lineTo(c.x + 1.4, c.y + 4.5);
    g.stroke();

    // лад: лесенка; зажата — список ладов и тоники; вправо — карандаш
    const L = sclList(), b = L.b;
    if (sclF && sclF.lasso) {                   // обводка карандашом
      g.save(); g.setLineDash([3, 4]); g.strokeStyle = ink(0.85); g.lineWidth = 1.4;
      g.beginPath(); sclF.lasso.forEach((pt, i) => (i ? g.lineTo(pt.x, pt.y) : g.moveTo(pt.x, pt.y)));
      if (sclF.lasso.length > 2) g.closePath();
      g.stroke(); g.restore();
      const loop = loopOf(sclF.lasso);
      for (const v of V) if (v.active && loop.length > 2 && pointIn(loop, vx(v), vy(v))) ring(vx(v), vy(v), 48, 0.9, 1.5);
    }
    if (sclF && !sclF.lasso) {
      // слева от кнопки — карандаш: туда повести палец, чтобы обвести кружки
      const px = b.x - 64, py = b.y;
      g.save(); g.translate(px, py); g.rotate((-3 * Math.PI) / 4);
      g.strokeStyle = ink(0.8); g.lineWidth = 1.4;
      g.strokeRect(-12, -3.5, 20, 7);
      g.beginPath(); g.moveTo(8, -3.5); g.lineTo(14, 0); g.lineTo(8, 3.5); g.stroke();
      g.restore();
      g.strokeStyle = ink(0.4); g.lineWidth = 1;
      g.beginPath(); g.moveTo(b.x - BTN_R - 8, py); g.lineTo(px + 18, py); g.stroke();

      // список: off и лады — строки с тонкими разделителями
      const rows = ['off', ...SCALES.map((sc) => sc.label)];
      g.fillStyle = 'rgba(0,0,0,0.9)';
      g.fillRect(L.bx, L.top - 8, LIST_W, L.rows * ITEM_H + 16);
      hairBox(L.bx, L.top - 8, LIST_W, L.rows * ITEM_H + 16, 0.3);
      rows.forEach((label, i) => {
        const y = L.top + ITEM_H * (i + 0.5), on = i === 0 ? !scl.on : scl.on && i - 1 === scl.idx;
        text(label, L.bx + 22, y, 15, on ? 1 : 0.45, on ? 500 : 400);
        if (on) dot(L.bx + 12, y, 3, 1);
        if (i) { g.strokeStyle = ink(0.1); g.beginPath(); g.moveTo(L.bx + 8, Math.round(y + ITEM_H / 2) + 0.5); g.lineTo(L.bx + LIST_W - 8, Math.round(y + ITEM_H / 2) + 0.5); g.stroke(); }
      });
      // тоники: две колонки по шесть справа от списка
      g.fillStyle = 'rgba(0,0,0,0.9)';
      g.fillRect(L.rx - 4, L.top - 8, 2 * L.cw + 8, L.rows * ITEM_H + 16);
      hairBox(L.rx - 4, L.top - 8, 2 * L.cw + 8, L.rows * ITEM_H + 16, 0.3);
      NOTES.forEach((nm, i) => {
        const col = Math.floor(i / 6), row = i % 6, on = i === scl.root;
        const x = L.rx + L.cw * (col + 0.5), y = L.top + L.ch * (row + 0.5);
        if (on) hairBox(L.rx + L.cw * col + 4, L.top + L.ch * row + 4, L.cw - 8, L.ch - 8, 0.9);
        text(nm, x, y, 13, on ? 1 : 0.5, on ? 500 : 400, 'center');
      });
    } else if (scl.on && !sclF) {               // лад включён — его имя рядом с кнопкой
      text(`${NOTES[scl.root]} ${SCALES[scl.idx].label}`, 18, scopeY + 46, 11, 0.5);   // под заголовком
    }
    if (scl.on) { g.fillStyle = ink(0.9); g.beginPath(); g.arc(b.x, b.y, BTN_R, 0, Math.PI * 2); g.fill(); }
    else ring(b.x, b.y, BTN_R, 0.45, 1.2);
    g.strokeStyle = scl.on ? BG : ink(0.8); g.lineWidth = 1.6; g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(b.x - 11, b.y + 8);
    for (let i = 0; i < 4; i++) { const x = b.x - 11 + i * 6, y = b.y + 8 - i * 5; g.lineTo(x, y - 5); g.lineTo(x + 6, y - 5); }
    g.stroke();
  }

  // уровень выхода — для солнца (сам осциллограф не рисуется)
  function readLevel() {
    if (!an) return;
    an.getFloatTimeDomainData(scopeBuf);
    let e = 0;
    for (let i = 0; i < 1024; i += 4) e += scopeBuf[i] * scopeBuf[i];
    sunLevel += (Math.min(1, Math.sqrt(e / 256) * 2.2) - sunLevel) * 0.08;
  }

  let last = performance.now(), chaosAt = 0, sunLevel = 0, titleW = 120;

  // ---------- нагрузка: Safari не отдаёт ни CPU, ни память, поэтому три косвенных признака ----------
  // 1) сколько миллисекунд реально уходит на кадр (не частота кадров — энергосбережение её режет вдвое);
  // 2) отстают ли звуковые часы от настоящих — звук не успевает считаться, значит трещит;
  // 3) сколько звукового графа сейчас живо относительно предела. Берём худшее, растёт быстро, отходит медленно
  const strain = { work: 2, lvl: 0, ctxT: 0, wallT: 0, drift: 1, prev: 1, since: 0 };
  function measureStrain(now, workMs) {
    strain.work += (workMs - strain.work) * 0.05;
    // звуковые часы: первые 3 с после запуска не в счёт (старт идёт с задержкой);
    // отставание засчитывается, только если два двухсекундных окна подряд показали его
    if (ctx && ctx.state === 'running' && document.visibilityState === 'visible') {
      if (!strain.since) strain.since = now;
      if (now - strain.since < 3000) strain.wallT = 0;
      else if (!strain.wallT) { strain.wallT = now; strain.ctxT = ctx.currentTime; }
      else if (now - strain.wallT > 2000) {
        const span = (now - strain.wallT) / 1000;
        const r = span < 3 ? (ctx.currentTime - strain.ctxT) / span : 1;   // долгая пауза кадров — окно не мерило
        strain.drift = Math.max(r, strain.prev);
        strain.prev = r;
        strain.wallT = now; strain.ctxT = ctx.currentTime;
      }
    } else { strain.wallT = 0; strain.since = 0; strain.drift = 1; strain.prev = 1; }
    const act = V.filter((v) => v.active);
    const graph = (act.length + 0.15 * act.reduce((n, v) => n + Object.keys(v.lfo).length, 0)) / VOICES;
    const cap = ctx && typeof ctx.renderCapacity === 'object' && ctx.renderCapacity.averageLoad;   // где есть (Chrome)
    const target = Math.max(
      clamp((strain.work - 6) / 10),                // кадр дороже 6 мс — тревожно, 16 — плохо
      clamp((0.99 - strain.drift) / 0.04),          // звук отстаёт на 1…5 %
      0.8 * clamp((graph - 0.7) / 0.45),            // граф у предела
      cap ? clamp((cap - 0.6) / 0.35) : 0,
    );
    strain.lvl += (target - strain.lvl) * (target > strain.lvl ? 0.08 : 0.01);
  }

  // индикатор нагрузки — маленький Сатурн в правом верхнем углу поля. До 80 % почти не виден,
  // дальше проступает гуще; краснеет постепенно, вместе с нагрузкой
  function drawStrain() {
    const L = strain.lvl, x = 16 + titleW + 20, y = scopeY + 20;   // в верхней строке, сразу за заголовком
    const vis = L < 0.8 ? 0.07 + 0.05 * (L / 0.8) : 0.12 + 0.88 * ((L - 0.8) / 0.2);
    const gb = Math.round(237 * (1 - L));
    const col = (a) => `rgba(237,${gb},${gb},${a})`;
    g.save(); g.translate(x, y); g.rotate(-0.42);
    g.lineWidth = 1;
    g.strokeStyle = col(vis * 0.6);             // задняя половина кольца
    g.beginPath(); g.ellipse(0, 0, 15, 4, 0, Math.PI, Math.PI * 2); g.stroke();
    g.restore();
    g.fillStyle = L > 0.8 ? `rgba(200,24,24,${0.9 * (L - 0.8) / 0.2})` : BG;
    g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill();
    g.strokeStyle = col(vis); g.lineWidth = 1 + 0.6 * clamp((L - 0.8) / 0.2);
    g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.stroke();
    g.save(); g.translate(x, y); g.rotate(-0.42);
    g.strokeStyle = col(vis); g.lineWidth = 1;  // передняя половина — поверх планеты
    g.beginPath(); g.ellipse(0, 0, 15, 4, 0, 0, Math.PI); g.stroke();
    g.restore();
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const t0 = performance.now();
    const dtMs = now - last;
    const dt = Math.min(0.05, dtMs / 1000);
    last = now;

    // долгое касание пойманного кружка — кольцо свойств на весу
    for (const f of F.values()) {
      if (f.menu || f.menuWas || f.moved || f.bridge || !f.caught || !f.voice || f.voice.fingers.length !== 1) continue;
      if (now - f.t0 > HOLD_MS) openMenu(f);
    }

    if (now > chaosAt) { chaosAt = now + 400; chaosTick(now); }
    zoom += (zoomT - zoom) * (1 - Math.exp(-dt / 0.06));
    if (Math.abs(zoomT - zoom) < 1e-4) zoom = zoomT;

    // с ладом кружки плавно съезжают к нотам и обратно
    const sliding = now < scl.slideUntil;
    for (const v of V) {
      const tx = soundX(v);
      v.dx = sliding || scl.on ? v.dx + (tx - v.dx) * (1 - Math.exp(-dt / 0.07)) : v.x;
    }

    // LFO видно: высота качает кружок по полю, волна — форму
    for (const v of V) {
      v.wob = 0; v.wv = 0;
      for (const [key, spec] of Object.entries(v.lfo)) {
        spec.ph = ((spec.ph || 0) + dt * spec.rate) % 1;
        spec.vph = ((spec.vph || 0) + dt * Math.min(spec.rate, 2.5)) % 1;
        const val = morphFn(spec.morph)(spec.ph) * spec.depth;
        if (key === 'pitch') v.wob = xOf(semi(v.dx) + (val * 700) / 100) - v.dx;
        else if (key === 'wave') v.wv = val;
      }
    }

    for (const v of V) if (v.dirty) for (const u of V) if (u.mods.some((m) => m.src === v && m.type === 'tzfm')) u.dirty = true;
    let anyActive = false;
    for (const v of V) {
      if (v.dirty) { v.dirty = false; apply(v); }
      v.env += (v.envT - v.env) * (1 - Math.exp(-dt / v.envTau));
      v.hole += (v.holeT - v.hole) * (1 - Math.exp(-dt / 0.15));
      if (v.active && v.holeT > 0.9 && !v.fingers.length && v.envT !== 0) { v.pinned = false; release(v, 0.4); }   // отпущена в глубине дыры — умирает
      if (v.active && !v.pinned && !v.fingers.length && v.envT === 0 && v.env < 0.004) {
        v.active = false;
        sel.delete(v);
        unlinkAll(v);
        clearLfos(v);
        if (v.nodes && v.nodes.live) { v.nodes.out.disconnect(); v.nodes.vca.disconnect(v.nodes.vscope); v.nodes.live = false; }
      }
      if (v.active) anyActive = true;
    }
    if (editor && ((editor.kind === 'voice' && !editor.v.active) || (editor.kind === 'link' && !editor.dst.mods.includes(editor.m)))) editor = null;
    if (bus) {                                  // чем больше кружков, тем тише каждый
      const live = V.reduce((s, v) => s + (v.active ? v.env : 0), 0);
      bus.gain.setTargetAtTime(1 / Math.sqrt(Math.max(1, live)), ctx.currentTime, 0.3);
    }
    if (!anyActive && lock) { lock.release().catch(() => {}); lock = null; }

    // карта миров или другой мир — вместо поля (звук идёт дальше)
    if ((nav.view !== 'play' || nav.anim) && drawNav(now)) { measureStrain(now, performance.now() - t0); return; }

    // фон: зерно (ось шума) и полосы частот или октав (ось высоты)
    drawField();                                // фон, звёзды и орбиты — одной готовой картинкой

    // волны от кружков — в ритме биений detune: что видно, то и слышно
    for (const v of V) {
      if (!v.active || v.env < 0.02 || v.hole > 0.5) continue;   // из дыры свет не выходит
      v.emit += dt;
      if (v.emit >= clamp(1 / v.beat, 0.7, 4)) {      // быстрые биения — не чаще ~1.4 импульса в секунду
        v.emit = 0;
        const p = { x: vx(v), y: vy(v), r: 36, a: v.env * 0.7, sp: 40 + freq(v) * 0.1 };
        if (rings.length < 60) rings.push(p);
        // delay: тот же импульс повторяется пунктиром через время задержки, каждый повтор бледнее
        if (fx.dly > 0.04) for (let k = 1; k <= 3; k++) {
          const a = p.a * fx.dly * 1.6 * DLY_REPEATS ** (k - 1);
          if (a > 0.04 && rings.length < 60) rings.push({ ...p, a, wait: 0.45 * k, echo: true });
        }
      }
    }
    // hall и decay: чем больше зала и длиннее хвост, тем дальше уходят и дольше гаснут волны
    const Rmax = Math.hypot(W, H) * (0.3 + 0.35 * fx.rev + 0.35 * invLog(DECAY_MIN, DECAY_MAX, fx.decay));
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      if (r.wait > 0) { r.wait -= dt; continue; }
      r.r += r.sp * dt;
      if (r.r > Rmax) { rings.splice(i, 1); continue; }
      const al = Math.min(1, r.a * 0.28 * (1 - r.r / Rmax) ** 1.6);
      if (r.echo) { g.save(); g.setLineDash([2, 5]); ring(r.x, r.y, r.r, al, 1); g.restore(); }
      else ring(r.x, r.y, r.r, al, 1);
    }

    if (!touchedOnce) {                         // до первого касания — призрак кружка
      const x = W * 0.35, y = H * 0.6;
      const breathe = 0.5 + 0.5 * Math.sin(now / 900);
      [62, 98, 146].forEach((r, i) => ring(x, y, r + breathe * 6, [0.12, 0.07, 0.035][i], 1));
      ring(x, y, 34, 0.25 + 0.2 * breathe, 1.4);
    }

    let fxF = null, heldF = null, bridge = null;
    for (const f of F.values()) { if (f.menu) { if (f.menu.fx) fxF = f; else heldF = f; } if (f.bridge) bridge = f.bridge; }
    drawLinks(now, bridge && bridge.m);
    for (const v of V) {
      if (!v.active) continue;
      if (bridge && (bridge.A === v || bridge.B === v)) continue;
      drawVoice(v, now, dt);
    }
    drawHold(now);
    for (let i = full.length - 1; i >= 0; i--) {   // все голоса заняты: пунктирный кружок сжимается и гаснет
      const k = (now - full[i].t) / 600;
      if (k >= 1) { full.splice(i, 1); continue; }
      g.save(); g.setLineDash([3, 5]); ring(full[i].x, full[i].y, 34 * (1 - 0.4 * k), 0.7 * (1 - k), 1.2); g.restore();
    }
    if (bridge) drawBridge(bridge, now);
    if (editor) drawEditor();
    if (ghost && now > ghost.until) ghost = null;
    if (ghost && !editor) {                     // отпущенное кольцо гаснет; булавку ещё можно тапнуть
      g.save(); g.globalAlpha = 0.85 * ((ghost.until - now) / GHOST_MS) ** 0.6;
      drawHeld(ghost.menu, null); g.restore();
    }
    if (heldF) drawHeld(heldF.menu, { x: heldF.menu.cx + (heldF.x - heldF.menu.gx), y: heldF.menu.cy + (heldF.y - heldF.menu.gy) });

    readLevel();
    const tg = modTarget(null);
    if (tg) { drawLfoPanel(tg, now); drawAmpStrip(tg); }
    if (editor) drawCloseChip();
    drawUI();
    if (fxF) drawFx(fxF);                       // веер FX — поверх верхней строки
    drawStrain();
    measureStrain(now, performance.now() - t0);
  }

  // ---------- смежные миры: солнце — начало координат, вокруг него четыре четверти ----------
  // Universum: I (x>0, y>0) — Sol Niger, чёрный космос с планетами, играет. II, III, IV — пока только гравюры (идеи — в ROADMAP.md).
  // Тап по солнцу — карта миров; тап по четверти — влететь в мир; в мире тап по солнцу — снова карта
  const WORLDS = [
    null,
    { n: 'I', title: 'Sol Niger', sub: 'orbes · strepitus' },
    { n: 'II', title: 'Cabbala', sub: 'arbor vitae' },
    { n: 'III', title: 'Rosarium', sub: 'operatores quattuor' },
    { n: 'IV', title: 'Terra', sub: 'echo et reverberatio' },
  ];
  // Universum выключен, пока звук и идеи не готовы (сначала звук, потом графика); код миров и гравюры остаются
  const WORLDS_ON = false;
  const nav = { view: 'play', world: 1, anim: null };   // view: play | map | world; anim: { t0, dir: 'out' | 'in', w }
  const NAV_MS = 520;
  let snapC = null;                                       // снимок мира I для карты
  const arts = {};                                        // гравюры миров II–IV, рисуются один раз на размер экрана
  // настоящие гравюры (art/, обработка — tools/ink.py, источники — art/CREDITS.md); грузятся при первом выходе на карту
  const ART_SRC = { kircher: 'kircher-tree.png', leo: 'leo-viridis.png', leoWash: 'leo-viridis-wash.png', fons: 'fons-mercurialis.png', terra: 'terra-octobre.jpg' };
  const artImg = {};
  let artReady = 0;
  function loadArt() {
    if (artImg.kircher) return;
    for (const [k, f] of Object.entries(ART_SRC)) {
      const im = new Image();
      im.onload = () => { im.ok = true; artReady++; };
      im.src = `art/${f}`;
      artImg[k] = im;
    }
  }
  const img = (k) => (artImg[k] && artImg[k].ok ? artImg[k] : null);
  let leoSun = null;                                      // в Rosarium солнце — солнце с гравюры льва

  // прямоугольник четверти на карте; солнце — в центре экрана
  function panel(w) {
    const hw = W / 2, hh = H / 2;
    return [null, [hw, 0, hw, hh], [0, 0, hw, hh], [0, hh, hw, hh], [hw, hh, hw, hh]][w];
  }
  // угол, где в каждом мире стоит солнце (смежный с центром карты)
  const sunCorner = (w) => [null, [0, geo.bot], [W, H], [W, 0], [0, 0]][w];

  function goMap() {
    loadArt();
    if (!snapC) snapC = document.createElement('canvas');
    snapC.width = cv.width; snapC.height = cv.height;
    if (nav.view === 'play') snapC.getContext('2d').drawImage(cv, 0, 0);
    nav.anim = { t0: performance.now(), dir: 'out', w: nav.world };
    nav.view = 'map';
  }
  function goWorld(w) {
    nav.anim = { t0: performance.now(), dir: 'in', w };
    nav.world = w;
  }

  // касание, пока на экране карта или другой мир
  function navDown(f) {
    if (nav.anim) return;
    if (nav.view === 'map') {
      const dx = f.x - W / 2, dy = f.y - H / 2;
      if (Math.hypot(dx, dy) < 44) { goWorld(nav.world); return; }   // солнце — обратно в свой мир
      goWorld(dx >= 0 ? (dy < 0 ? 1 : 4) : dy < 0 ? 2 : 3);
      return;
    }
    const c = (nav.world === 3 && leoSun) || sunCorner(nav.world);   // в мирах II–IV: тап по солнцу — карта
    if (Math.hypot(f.x - c[0], f.y - c[1]) < 90) goMap();
  }

  const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  function worldImage(w) { return w === 1 ? snapC : artFor(w); }

  function drawNav(now) {
    let k = 1, a = nav.anim;
    if (a) {
      k = clamp((now - a.t0) / NAV_MS);
      if (k >= 1) {
        nav.anim = null;
        if (a.dir === 'in') nav.view = a.w === 1 ? 'play' : 'world';
        if (nav.view === 'play') return false;          // дальше рисует обычный кадр
        a = null; k = 1;
      }
    }
    g.fillStyle = BG; g.fillRect(0, 0, W, H);
    if (nav.view === 'world' && !a) {                    // мир II–IV во весь экран
      g.drawImage(artFor(nav.world), 0, 0, W, H);
      return true;
    }
    // карта: доля «отъезда» камеры — 0 во весь экран мира, 1 — карта
    const out = a ? (a.dir === 'out' ? easeIO(k) : 1 - easeIO(k)) : 1;
    const focus = a ? a.w : 0;
    for (let w = 1; w <= 4; w++) {
      const p = panel(w), img = worldImage(w);
      if (!img) continue;
      if (w === focus) {
        const r = [p[0] * out, p[1] * out, W + (p[2] - W) * out, H + (p[3] - H) * out];
        g.drawImage(img, r[0], r[1], r[2], r[3]);
      } else {
        g.globalAlpha = out; g.drawImage(img, p[0], p[1], p[2], p[3]); g.globalAlpha = 1;
      }
    }
    if (out > 0.02) drawMapChrome(out, now);
    return true;
  }

  // карта: декартовы оси с делениями, солнце в центре, номера и имена миров
  function drawMapChrome(al, now) {
    const cx = W / 2, cy = H / 2;
    g.globalAlpha = al;
    g.strokeStyle = ink(0.55); g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, cy + 0.5); g.lineTo(W, cy + 0.5); g.moveTo(cx + 0.5, 0); g.lineTo(cx + 0.5, H); g.stroke();
    g.strokeStyle = ink(0.35); g.beginPath();
    for (let i = 1; i * 12 < Math.max(W, H) / 2; i++) {
      const l = i % 5 ? 3 : 6, d = i * 12;
      g.moveTo(cx + d, cy - l); g.lineTo(cx + d, cy + l); g.moveTo(cx - d, cy - l); g.lineTo(cx - d, cy + l);
      g.moveTo(cx - l, cy + d); g.lineTo(cx + l, cy + d); g.moveTo(cx - l, cy - d); g.lineTo(cx + l, cy - d);
    }
    g.stroke();
    for (let w = 1; w <= 4; w++) {
      const p = panel(w), info = WORLDS[w];
      const right = p[0] >= cx, below = p[1] >= cy;
      const tx = right ? p[0] + 16 : p[0] + p[2] - 16, ty = below ? p[1] + p[3] - 34 : p[1] + 64;
      g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(right ? tx - 6 : tx - 150, ty - 20, 156, 46);
      mapText(`${info.n} · ${info.title}`, tx, ty - 4, 19, 0.95, right ? 'left' : 'right');
      mapText(info.sub, tx, ty + 16, 13, 0.6, right ? 'left' : 'right');
    }
    // солнце целиком
    g.fillStyle = BG; g.beginPath(); g.arc(cx, cy, 40, 0, Math.PI * 2); g.fill();
    sunGlyph(g, cx, cy, 0, Math.PI * 2, 1, now);
    mapText('tap a world', cx, cy + 62, 13, 0.5, 'center');
    g.fillStyle = 'rgba(0,0,0,0.7)'; g.fillRect(cx - 92, scopeY - 6, 184, 34);   // имя всей карты
    g.font = `20px ${MAP}`; g.fillStyle = ink(0.95); g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('U N I V E R S U M', cx, scopeY + 11);
    g.globalAlpha = 1;
  }

  // гравированное солнце для карты и миров: двойной диск, лучи прямые и волнистые через один (в секторе a0..a1).
  // col — цвет линий (rgb), disc — заливка диска
  function sunGlyph(x, ox, oy, a0, a1, scale = 1, now = 0, col = INK, disc = BG) {
    const rot = now * 0.00004, N = 28;
    x.lineWidth = 0.9;
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2 + rot;
      const aa = ((a - a0) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
      if (aa > a1 - a0 + 0.05) continue;
      const c = Math.cos(a), s = Math.sin(a), px = -s, py = c;
      if (k % 2) {
        const l = 50 * scale, w = 2.6;
        x.strokeStyle = `rgba(${col},0.7)`;
        x.beginPath(); x.moveTo(ox + c * 17 + px * w, oy + s * 17 + py * w); x.lineTo(ox + c * l, oy + s * l);
        x.lineTo(ox + c * 17 - px * w, oy + s * 17 - py * w); x.stroke();
      } else {
        const l = 38 * scale;
        x.strokeStyle = `rgba(${col},0.5)`;
        x.beginPath();
        for (let i = 0; i <= 14; i++) {
          const t = i / 14, r = 17 + t * (l - 17), wv = Math.sin(t * Math.PI * 3) * 2.2 * (1 - t * 0.5);
          const X = ox + c * r + px * wv, Y = oy + s * r + py * wv;
          if (i) x.lineTo(X, Y); else x.moveTo(X, Y);
        }
        x.stroke();
      }
    }
    x.fillStyle = disc; x.beginPath(); x.arc(ox, oy, 14, 0, Math.PI * 2); x.fill();
    x.strokeStyle = `rgba(${col},0.85)`; x.lineWidth = 1; x.beginPath(); x.arc(ox, oy, 14, 0, Math.PI * 2); x.stroke();
    x.strokeStyle = `rgba(${col},0.45)`; x.lineWidth = 0.8; x.beginPath(); x.arc(ox, oy, 10.5, 0, Math.PI * 2); x.stroke();
  }

  // ---------- гравюры миров: у каждого своя палитра ----------
  // Cabbala (II) — ночное небо: индиго, сусальное золото, сфиры в традиционных цветах.
  // Rosarium (III) — раскрашенная алхимическая гравюра: пергамент, сепия, киноварь, охра, лазурь, ярь-медянка, золото.
  // Terra — средневековая живопись (часослов, Джотто, Дуччо): ультрамарин, сусальное золото, малахит, охра, киноварь, свинцовые белила
  const PALS = {
    2: { ink: '214,180,96', paper: ['#1f2658', '#060918'], red: '170,40,40', gold: '222,186,96', white: '236,232,220', disc: '#e2b84a', disc2: '#10153a' },
    3: { ink: '62,42,26', paper: ['#efe3c6', '#cdb68a'], red: '178,52,38', gold: '190,140,44', green: '74,122,96', blue: '44,72,128', disc: '#e8c25a' },
    4: { ink: '28,20,14', paper: ['#2c4fa8', '#13245e'], red: '176,50,38', gold: '214,170,64', green: '70,128,78', blue: '44,86,170', ochre: '186,138,62', white: '246,240,224', disc: '#d6aa40' },
  };
  let PAL = null;
  const P = (a) => `rgba(${PAL ? PAL.ink : INK},${a})`;
  const C = (k, a) => `rgba(${PAL[k]},${a})`;

  function artFor(w) {
    const key = `${w}|${W}x${H}|${DPR}|${artReady}`;
    if (arts[w] && arts[w].key === key) return arts[w].c;
    const c = document.createElement('canvas');
    c.width = Math.round(W * DPR); c.height = Math.round(H * DPR);
    const x = c.getContext('2d');
    x.setTransform(DPR, 0, 0, DPR, 0, 0);
    PAL = PALS[w];
    // фон: бумага / ткань с затенёнными краями
    const bg = x.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.2, W / 2, H / 2, Math.hypot(W, H) * 0.6);
    bg.addColorStop(0, PAL.paper[0]); bg.addColorStop(1, PAL.paper[1]);
    x.fillStyle = bg; x.fillRect(0, 0, W, H);
    ({ 2: artCabbala, 3: artRosarium, 4: artTerra })[w](x);
    // рамка: двойная линия; у Terra — золотая кайма, как в рукописи
    if (w === 4) { x.strokeStyle = C('gold', 0.9); x.lineWidth = 3; x.strokeRect(6, 6, W - 12, H - 12); x.lineWidth = 1; x.strokeStyle = C('red', 0.7); x.strokeRect(11.5, 11.5, W - 23, H - 23); }
    else { x.strokeStyle = P(0.45); x.lineWidth = 1; x.strokeRect(4.5, 4.5, W - 9, H - 9); x.strokeStyle = P(0.2); x.strokeRect(9.5, 9.5, W - 19, H - 19); }
    const sc = sunCorner(w), q = { 2: [Math.PI, Math.PI * 1.5], 3: [Math.PI / 2, Math.PI], 4: [0, Math.PI / 2] }[w];
    if (!(w === 3 && leoSun)) sunGlyph(x, sc[0], sc[1], q[0], q[1], { 2: 1.3, 3: 1.5, 4: 1.9 }[w], 0, PAL.gold, PAL.disc);
    x.font = `italic 15px ${MAP}`; x.fillStyle = w === 4 || w === 2 ? C('white', 0.7) : P(0.65); x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('terra incognita · nondum', W / 2, H - 32);
    PAL = null;
    arts[w] = { key, c };
    return c;
  }

  function caps(x, s, X, Y, size, fill, spacing = 3) {   // разрядка заглавных, как на гравюре
    x.font = `${size}px ${MAP}`; x.fillStyle = fill; x.textBaseline = 'middle'; x.textAlign = 'left';
    const w = [...s].reduce((n, ch) => n + x.measureText(ch).width + spacing, -spacing);
    let px = X - w / 2;
    for (const ch of s) { x.fillText(ch, px, Y); px += x.measureText(ch).width + spacing; }
  }
  function hatch(x, ang, step, style, clipFn, lw = 0.7) {   // штриховка, как резцом
    x.save(); if (clipFn) { x.beginPath(); clipFn(); x.clip(); }
    x.strokeStyle = style; x.lineWidth = lw; x.beginPath();
    const L = Math.hypot(W, H), c = Math.cos(ang), s = Math.sin(ang);
    for (let d = -L; d < L; d += step) {
      const mx = W / 2 + -s * d, my = H / 2 + c * d;
      x.moveTo(mx - c * L, my - s * L); x.lineTo(mx + c * L, my + s * L);
    }
    x.stroke(); x.restore();
  }
  const itext = (x, s, X, Y, size, fill, align = 'center') => {
    x.font = `italic ${size}px ${MAP}`; x.fillStyle = fill; x.textAlign = align; x.textBaseline = 'middle'; x.fillText(s, X, Y);
  };
  // слой чернил (альфа = линия) → покрасить в цвет мира
  function inked(im, col) {
    const c = document.createElement('canvas');
    c.width = im.naturalWidth; c.height = im.naturalHeight;
    const x = c.getContext('2d');
    x.drawImage(im, 0, 0);
    x.globalCompositeOperation = 'source-in'; x.fillStyle = `rgb(${col})`; x.fillRect(0, 0, c.width, c.height);
    return c;
  }

  // II — Cabbala: ночное небо и Древо сфирот Афанасия Кирхера (1652), гравюра сусальным золотом;
  // десять сфирот подложены традиционными цветами. Солнце участвует: золотой луч из угла входит в Тиферет — сфиру Солнца
  const KIRCHER = {                                       // центры колец на гравюре, в долях картинки; радиус — доля ширины
    r: 0.084,
    Kether: [0.505, 0.165, '250,248,240'], Chokmah: [0.745, 0.290, '150,150,160'], Binah: [0.263, 0.284, '24,24,30'],
    Chesed: [0.744, 0.476, '50,90,190'], Geburah: [0.257, 0.473, '190,40,40'], Tiphareth: [0.506, 0.606, '226,184,74'],
    Netzach: [0.744, 0.690, '40,160,90'], Hod: [0.256, 0.690, '226,128,40'], Yesod: [0.515, 0.779, '120,60,170'], Malkuth: [0.518, 0.923, null],
  };
  function artCabbala(x) {
    let seed = 5;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 160; i++) {                      // звёзды
      const X = rnd() * W, Y = rnd() * H, r = rnd() < 0.12 ? 1.6 : 0.8;
      x.fillStyle = C('gold', 0.25 + 0.55 * rnd()); x.beginPath(); x.arc(X, Y, r, 0, Math.PI * 2); x.fill();
    }
    caps(x, 'CABBALA', W / 2, H * 0.06 + 16, 18, C('gold', 1), 6);
    itext(x, 'arbor vitae · decem sephiroth', W / 2, H * 0.06 + 38, 13, C('white', 0.8));
    const tree = img('kircher');
    if (!tree) return;
    const top = H * 0.06 + 58, bot = H - 52;
    const tw = Math.min(W - 24, (bot - top) * tree.naturalWidth / tree.naturalHeight), th = tw * tree.naturalHeight / tree.naturalWidth;
    const tx = (W - tw) / 2, ty = top + (bot - top - th) * 0.35;
    const pt = (k) => [tx + KIRCHER[k][0] * tw, ty + KIRCHER[k][1] * th], R = KIRCHER.r * tw;
    // луч солнца из угла в Тиферет — под гравюрой
    const sc = sunCorner(2), tp = pt('Tiphareth');
    for (let k = -3; k <= 3; k++) {
      x.strokeStyle = C('gold', 0.22 - Math.abs(k) * 0.05); x.lineWidth = 1;
      x.beginPath(); x.moveTo(sc[0], sc[1]); x.lineTo(tp[0] + k * 6, tp[1] + k * 3); x.stroke();
    }
    // сфиры — пятна цвета под кольцами
    for (const k of Object.keys(KIRCHER)) {
      if (k === 'r') continue;
      const [X, Y] = pt(k), col = KIRCHER[k][2];
      if (col) { x.fillStyle = `rgba(${col},0.6)`; x.beginPath(); x.arc(X, Y, R, 0, Math.PI * 2); x.fill(); }
      else {                                              // Малкут — четыре цвета стихий
        ['200,180,60', '110,120,50', '140,60,40', '20,20,20'].forEach((c, i) => {
          x.fillStyle = `rgba(${c},0.6)`; x.beginPath(); x.moveTo(X, Y); x.arc(X, Y, R, -Math.PI / 4 + (i * Math.PI) / 2, Math.PI / 4 + (i * Math.PI) / 2); x.closePath(); x.fill();
        });
      }
    }
    x.drawImage(inked(tree, PAL.gold), tx, ty, tw, th);
  }

  // III — Rosarium: «Розарий философов» (Франкфурт, 1550). Вверху справа зелёный лев пожирает солнце
  // (ксилография, раскраска отмывкой: зелёный лев, золотое солнце, кровь) — солнце гравюры и есть солнце мира;
  // ниже — ртутный фонтан, первая гравюра «Розария»; внизу розовый сад
  const LEO_SUN = [0.716, 0.21];                          // солнце на гравюре льва, в долях (как SUN в tools/ink.py)
  function artRosarium(x) {
    hatch(x, Math.PI / 4, 9, P(0.035));
    leoSun = null;
    const leo = img('leo'), wash = img('leoWash'), fons = img('fons');
    let y = 12;
    if (leo) {
      const lw = Math.min(W * 0.86, H * 0.42), lh = lw * leo.naturalHeight / leo.naturalWidth, lx = W - lw + 6;
      if (wash) { x.imageSmoothingQuality = 'high'; x.drawImage(wash, lx, y, lw, lh); }
      x.drawImage(inked(leo, PAL.ink), lx, y, lw, lh);
      leoSun = [lx + LEO_SUN[0] * lw, y + LEO_SUN[1] * lh];
      y += lh;
      itext(x, 'leo viridis solem devorat', W - 22, y + 2, 12, P(0.75), 'right');
      y += 14;
    }
    if (fons) {
      const fw = Math.min(W * 0.8, (H * 0.84 - y) * fons.naturalWidth / fons.naturalHeight), fh = fw * fons.naturalHeight / fons.naturalWidth;
      x.drawImage(inked(fons, PAL.ink), (W - fw) / 2, y, fw, fh);
      itext(x, 'fons mercurialis', W / 2, y + fh + 12, 12, P(0.7));
    }
    // розовый сад внизу: живая изгородь и розы
    const gy = H * 0.9;
    x.strokeStyle = C('green', 0.85); x.lineWidth = 1;
    for (let gx = 20; gx < W - 20; gx += 22) { x.beginPath(); x.arc(gx + 11, gy, 11, Math.PI, 0); x.stroke(); }
    for (let gx = 30; gx < W - 20; gx += 44) {
      for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; x.fillStyle = C('red', 0.75); x.beginPath(); x.arc(gx + Math.cos(a) * 3.2, gy - 10 + Math.sin(a) * 3.2, 3.2, 0, Math.PI * 2); x.fill(); }
      x.fillStyle = C('gold', 0.9); x.beginPath(); x.arc(gx, gy - 10, 1.6, 0, Math.PI * 2); x.fill();
    }
    // лента с названием и четыре стихии — четыре оператора
    const by = H * 0.06 + 14, bx0 = 16, bx1 = W * 0.46, bm = (bx0 + bx1) / 2;
    x.strokeStyle = P(0.8); x.lineWidth = 1; x.fillStyle = '#f6edd6';
    x.beginPath();
    x.moveTo(bx0, by - 14); x.quadraticCurveTo(bm, by - 24, bx1, by - 14);
    x.lineTo(bx1, by + 14); x.quadraticCurveTo(bm, by + 4, bx0, by + 14); x.closePath(); x.fill(); x.stroke();
    caps(x, 'ROSARIUM', bm, by - 5, 15, C('red', 0.95), 4);
    caps(x, 'PHILOSOPHORUM', bm, by + 9, 10, P(0.85), 2.5);
    const el = [['up', false, 'red'], ['up', true, 'gold'], ['down', false, 'blue'], ['down', true, 'green']];
    el.forEach(([dir, bar, col], i) => {
      const X = bx0 + 20 + i * 26, Y = by + 40, s = 8, u2 = dir === 'up' ? -1 : 1;
      x.beginPath(); x.moveTo(X, Y + u2 * s); x.lineTo(X - s * 0.9, Y - u2 * s * 0.6); x.lineTo(X + s * 0.9, Y - u2 * s * 0.6); x.closePath();
      x.fillStyle = C(col, 0.75); x.fill(); x.strokeStyle = P(0.9); x.lineWidth = 1; x.stroke();
      if (bar) { x.beginPath(); x.moveTo(X - s * 0.7, Y); x.lineTo(X + s * 0.7, Y); x.stroke(); }
    });
    itext(x, 'operatores quattuor', bx0 + 8, by + 60, 12, P(0.7), 'left');
  }

  // IV — Terra: «Октябрь» из «Великолепного часослова герцога Беррийского» (братья Лимбург, ок. 1415):
  // ультрамарин, сусальное золото, Лувр над Сеной, пахарь и сеятель. Солнце в углу светит на всё небо
  function artTerra(x) {
    const pic = img('terra');
    if (pic) {                                            // во весь экран, по высоте (обрезаются края)
      const k = Math.max(W / pic.naturalWidth, H / pic.naturalHeight), pw = pic.naturalWidth * k, ph = pic.naturalHeight * k;
      x.imageSmoothingQuality = 'high';
      x.drawImage(pic, (W - pw) / 2, (H - ph) / 2, pw, ph);
    }
    // название — на тёмной полосе внизу, чтобы не спорить с миниатюрой
    const fade = x.createLinearGradient(0, H * 0.8, 0, H);
    fade.addColorStop(0, 'rgba(10,14,34,0)'); fade.addColorStop(0.45, 'rgba(10,14,34,0.75)'); fade.addColorStop(1, 'rgba(10,14,34,0.9)');
    x.fillStyle = fade; x.fillRect(0, H * 0.8, W, H * 0.2);
    caps(x, 'TERRA', W / 2, H - 92, 20, C('gold', 1), 6);
    itext(x, 'tres undae · echo et reverberatio', W / 2, H - 66, 13, C('white', 0.85));
  }

  // ---------- события ----------
  cv.addEventListener('pointerdown', down, { passive: false });
  cv.addEventListener('pointermove', move);
  cv.addEventListener('pointerup', (e) => { up(e); commit(); });
  cv.addEventListener('pointercancel', (e) => { up(e); commit(); });

  // в iOS звук разрешается на «полноценных» жестах — ловим все
  document.addEventListener('pointerdown', unlock, { capture: true });
  document.addEventListener('touchend', unlock, { passive: true });
  document.addEventListener('click', unlock);

  document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  ['gesturestart', 'gesturechange', 'dblclick', 'contextmenu'].forEach((t) =>
    document.addEventListener(t, (e) => e.preventDefault()));
  cv.addEventListener('wheel', wheelZoom, { passive: false });
  // Safari на Mac шлёт щипок тачпада жестом; на iPhone жест идёт вместе с касаниями — там зумит свой щипок
  let gestZ = 0;
  document.addEventListener('gesturestart', () => { gestZ = zoomT; });
  document.addEventListener('gesturechange', (e) => { if (!F.size && nav.view === 'play' && e.scale) setZoom(gestZ / e.scale); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && V.some((v) => v.active)) wake();
  });
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  if (document.fonts && document.fonts.load) {
    document.fonts.load(`13px ${MAP}`).catch(() => {});
    document.fonts.load(`italic 13px ${MAP}`).catch(() => {});
  }

  window.t2d = {
    voices: V, fx, scl, sel, freq, cutoff, applyFx, place, unplace, semi,
    get ctx() { return ctx; }, strikeSound, holeAt, btnPos, get vol() { return vol; }, get zoom() { return zoomT; }, strain, linkMid, get editor() { return editor; },
  };   // для отладки из консоли

  resize();
  lastState = snapshot();
  requestAnimationFrame(frame);
})();
