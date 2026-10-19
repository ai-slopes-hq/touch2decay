// touch2decay — дрон / нойз на 1–2 пальца. Web Audio + canvas, без зависимостей.
(() => {
  'use strict';

  // ---------- палитра: пока ч/б, цвета добавлять здесь ----------
  const INK = '237,237,237';                 // rgb без альфы
  const LINE = 'rgba(237,237,237,0.10)';
  const BG = '#000';

  // ---------- звук ----------
  const F_LO = 27.5;        // нижняя нота поля (A0)
  const OCT = 3;            // ширина поля, октав (до A3 = 220 Гц)
  const BEAT_MIN = 0.12;    // один палец: еле заметное фазирование
  const BEAT_MAX = 24;      // два пальца врозь: жёсткие биения
  const FB_BASE = 0.3;      // резонанс гребёнки по умолчанию
  const FB_MAX = 0.93;
  const SHARP_DEF = 0.4;    // волна: 0 — треугольник, 1 — меандр
  const TAIL_DEF = 1.6;     // хвост после отпускания (τ, с)
  const TAIL_MIN = 0.25, TAIL_MAX = 8;
  const UNPIN_TAIL = 0.8;   // хвост после снятия с закрепления
  const FM_DEPTH = 0.7;     // глубина связи: девиация в долях частоты

  // ---------- жесты ----------
  const VOICES = 8;         // сколько кружков может звучать одновременно
  const GRAB_R = 52;        // радиус, в котором палец «ловит» кружок, px
  const TAP_MS = 220, TAP_MOVE = 14;   // что считается тапом
  const DTAP_MS = 320;      // окно двойного тапа
  const HOLD_MS = 420, HOLD_MOVE = 10; // долгое нажатие на кружке — свойства
  const MENU_DEAD = 40, MENU_SPAN = 150;

  const SECTORS = [
    { key: 'sharp', label: 'волна', ang: -Math.PI / 2 },
    { key: 'tail', label: 'хвост', ang: Math.PI / 6 },
    { key: 'link', label: 'связь', ang: (5 * Math.PI) / 6 },
  ];

  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const $ = (id) => document.getElementById(id);

  const cv = $('field');
  const g = cv.getContext('2d');
  const safeTop = $('safe-top');
  const hint = $('hint');

  let W = 0, H = 0, DPR = 1, scopeY = 120, scan = null;

  // ---------- голоса (кружки) ----------
  const V = Array.from({ length: VOICES }, (_, i) => ({
    i, x: 0.35, y: 0.22, ox: 0, oy: 0, beat: BEAT_MIN, fb: FB_BASE,
    sharp: SHARP_DEF, tail: TAIL_DEF, mods: [],
    fingers: [], pinned: false, active: false,
    env: 0, envT: 0, envTau: 0.05, emit: 0, t: 0,
    dirty: true, snap: true, nodes: null,
  }));
  let focus = V[0];
  let touchedOnce = false;
  let lastTap = null;       // { v, t } — для двойного тапа
  const F = new Map();      // pointerId -> палец
  const rings = [];

  const freq = (v) => F_LO * 2 ** (v.x * OCT);
  const noiseAmt = (v) => v.y ** 1.3;
  const cutoff = (v) => 160 * 2 ** (v.y * 5.6);
  const vx = (v) => v.x * W;
  const vy = (v) => (1 - v.y) * H;

  function centroid(v) {
    let x = 0, y = 0;
    for (const id of v.fingers) { const f = F.get(id); x += f.x; y += f.y; }
    return [x / v.fingers.length, y / v.fingers.length];
  }

  // состав пальцев сменился — запомнить смещение, чтобы кружок не прыгал
  function rebase(v) {
    if (v.fingers.length !== 1) return;
    const [cx, cy] = centroid(v);
    v.ox = vx(v) - cx;
    v.oy = vy(v) - cy;
  }

  function follow(v) {
    if (!v.fingers.length) return;
    if (v.fingers.some((id) => F.get(id).menu)) return;   // в меню кружок стоит на месте
    const [cx, cy] = centroid(v);
    if (v.fingers.length === 1) {
      v.x = clamp((cx + v.ox) / W);
      v.y = clamp(1 - (cy + v.oy) / H);
    } else {
      v.x = clamp(cx / W);
      v.y = clamp(1 - cy / H);
      const a = F.get(v.fingers[0]), b = F.get(v.fingers[1]);
      const d = Math.hypot(b.x - a.x, b.y - a.y) / Math.hypot(W, H);
      v.beat = BEAT_MIN + clamp(d / 0.8) ** 2 * (BEAT_MAX - BEAT_MIN);
      const s = Math.abs(Math.sin(Math.atan2(b.y - a.y, b.x - a.x)));
      v.fb = FB_BASE * 0.5 + (FB_MAX - FB_BASE * 0.5) * s;
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
    v.x = clamp(f.x / W); v.y = clamp(1 - f.y / H); v.ox = 0; v.oy = 0;
    v.beat = BEAT_MIN; v.fb = FB_BASE; v.sharp = SHARP_DEF; v.tail = TAIL_DEF;
    v.pinned = false; v.fingers = [];
    v.snap = v.env < 0.02; v.dirty = true; v.emit = 1e9;
    attack(v);
    return v;
  }

  function attack(v) {
    v.active = true; v.envT = 1; v.envTau = 0.05;
    if (v.nodes) {
      v.nodes.env.gain.setTargetAtTime(1, ctx.currentTime, 0.05);
      v.nodes.mod.gain.setTargetAtTime(1, ctx.currentTime, 0.05);
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
  function toggleLink(dst, src) {
    const i = dst.mods.findIndex((m) => m.src === src);
    if (i >= 0) {
      if (dst.mods[i].g) dst.mods[i].g.disconnect();
      dst.mods.splice(i, 1);
      return;
    }
    const m = { src, g: null };
    if (ctx && dst.nodes && src.nodes) {
      m.g = ctx.createGain();
      m.g.gain.value = 0;
      src.nodes.mod.connect(m.g);
      for (const p of dst.nodes.fmTargets) m.g.connect(p);
    }
    dst.mods.push(m);
    dst.dirty = true;
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

  // ---------- касания ----------
  function down(e) {
    e.preventDefault();
    unlock();
    if (!touchedOnce) { touchedOnce = true; hint.style.opacity = '0'; }
    try { cv.setPointerCapture(e.pointerId); } catch (_) { /* ok */ }
    const now = performance.now();
    const f = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: now, voice: null, caught: false, moved: false, menu: null };
    F.set(e.pointerId, f);

    // 1) поймать существующий кружок под пальцем (закреплённый или ещё звучащий хвост)
    let v = null, best = GRAB_R;
    for (const u of V) {
      if (!u.active || u.fingers.length) continue;
      const d = Math.hypot(vx(u) - f.x, vy(u) - f.y);
      if (d < best) { best = d; v = u; }
    }
    if (v) { f.caught = true; if (!v.pinned) attack(v); }
    // 2) второй палец — к кружку, который сейчас ведёт один палец
    if (!v) v = V.filter((u) => u.active && u.fingers.length === 1).sort((a, b) => b.t - a.t)[0] || null;
    // 3) новый кружок
    if (!v) v = spawn(f);
    if (!v) return;

    v.fingers.push(e.pointerId);
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
    if (f.menu) menuMove(f);
    else if (f.voice) follow(f.voice);
  }

  function up(e) {
    const f = F.get(e.pointerId);
    if (!f) return;
    F.delete(e.pointerId);
    const v = f.voice;
    if (f.menu) menuCommit(f);
    if (!v) return;
    v.fingers = v.fingers.filter((id) => id !== e.pointerId);

    const now = performance.now();
    const tap = !f.menu && now - f.t0 < TAP_MS && Math.hypot(f.x - f.x0, f.y - f.y0) < TAP_MOVE;
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

  // ---------- кольцо свойств ----------
  function openMenu(f) {
    const v = f.voice;
    f.menu = { cx: vx(v), cy: vy(v), sector: null, val: 0, target: null, orig: { sharp: v.sharp, tail: v.tail } };
    focus = v;
  }

  function menuMove(f) {
    const m = f.menu, v = f.voice;
    const dx = f.x - m.cx, dy = f.y - m.cy, d = Math.hypot(dx, dy);
    if (d < MENU_DEAD) {                      // вернулся в центр — отмена
      if (m.sector) { v.sharp = m.orig.sharp; v.tail = m.orig.tail; v.dirty = true; }
      m.sector = null; m.target = null;
      return;
    }
    if (!m.sector && d > MENU_DEAD + 16) {
      const a = Math.atan2(dy, dx);
      let bestS = null, bd = 9;
      for (const s of SECTORS) {
        const diff = Math.abs(Math.atan2(Math.sin(a - s.ang), Math.cos(a - s.ang)));
        if (diff < bd) { bd = diff; bestS = s; }
      }
      m.sector = bestS;
    }
    if (!m.sector) return;
    m.val = clamp((d - MENU_DEAD) / MENU_SPAN);
    if (m.sector.key === 'sharp') { v.sharp = m.val; v.dirty = true; }
    else if (m.sector.key === 'tail') { v.tail = TAIL_MIN * (TAIL_MAX / TAIL_MIN) ** m.val; v.dirty = true; }
    else {
      m.target = null;
      let bd = GRAB_R;
      for (const u of V) {
        if (u === v || !u.active) continue;
        const du = Math.hypot(vx(u) - f.x, vy(u) - f.y);
        if (du < bd) { bd = du; m.target = u; }
      }
    }
  }

  function menuCommit(f) {
    const m = f.menu, v = f.voice;
    if (m.sector && m.sector.key === 'link' && m.target) toggleLink(v, m.target);
  }

  // ---------- аудио ----------
  let ctx = null, an = null, scopeBuf = null, bus = null;

  // tanh-кривая: norm=true — выход до ±1 (мастер), false — наклон 1 в нуле (петля обратной связи)
  function soft(k, norm) {
    const n = 4096, c = new Float32Array(n), d = norm ? Math.tanh(k) : k;
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / d; }
    return c;
  }

  function build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC({ latencyHint: 'interactive' });

    const len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf; noise.loop = true; noise.start();

    // общая шина: сатурация суммы голосов даёт гармоники, слышные даже из динамика айфона
    bus = ctx.createGain();
    const sat = ctx.createWaveShaper(); sat.curve = soft(2.6, true); sat.oversample = '4x';
    const post = ctx.createGain(); post.gain.value = 0.5;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 24;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 5;
    comp.attack.value = 0.008; comp.release.value = 0.35;
    const master = ctx.createGain(); master.gain.value = 0.9;
    an = ctx.createAnalyser(); an.fftSize = 2048; scopeBuf = new Float32Array(an.fftSize);
    bus.connect(sat).connect(post).connect(hp).connect(comp).connect(master);
    master.connect(ctx.destination);
    master.connect(an);

    for (const v of V) { v.nodes = voiceNodes(v, noise, bus); v.snap = true; v.dirty = true; }
  }

  function voiceNodes(v, noise, bus) {
    const k = 1 + v.i * 0.13;
    const panTo = (node, p, dest) => {
      if (!ctx.createStereoPanner) { node.connect(dest); return; }
      const s = ctx.createStereoPanner(); s.pan.value = p; node.connect(s).connect(dest);
    };
    const tone = ctx.createGain();
    const nz = ctx.createGain(); nz.gain.value = 0;
    const env = ctx.createGain(); env.gain.value = 0;
    tone.connect(env); nz.connect(env);

    const osc = (type, gain, pan) => {
      const o = ctx.createOscillator(), a = ctx.createGain();
      o.type = type; a.gain.value = gain; o.connect(a); panTo(a, pan, tone); o.start();
      o.level = a.gain;
      return o;
    };
    const drift = (param, rate, depth) => {
      const l = ctx.createOscillator(), a = ctx.createGain();
      l.frequency.value = rate * k; a.gain.value = depth; l.connect(a).connect(param); l.start();
    };

    // группа A — основная, B — сдвинута на частоту биений.
    // «волна» = перетекание треугольника в меандр у главных осцилляторов
    const a1t = osc('triangle', 0, -0.35), a1s = osc('square', 0, -0.35);
    const a2 = osc('sine', 0.55, 0);          // саб, октавой ниже (и источник связи)
    const a3 = osc('sawtooth', 0.09, -0.2);   // квинта
    const b1t = osc('triangle', 0, 0.35), b1s = osc('square', 0, 0.35);
    const b2 = osc('sine', 0.35, 0.2);
    for (const o of [a1t, a1s]) drift(o.detune, 0.071, 6);
    drift(a3.detune, 0.043, 9);
    for (const o of [b1t, b1s]) drift(o.detune, 0.057, 7);

    // выход для связей: чистый саб этого кружка, гаснет вместе с ним
    const mod = ctx.createGain(); mod.gain.value = 0;
    a2.connect(mod);

    // шум: узкая полоса, привязанная к высоте, + сырое шипение наверху поля
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
    const bpg = ctx.createGain(); bpg.gain.value = 2.2;
    noise.connect(bp).connect(bpg).connect(nz);
    const hiss = ctx.createGain(); hiss.gain.value = 0;
    noise.connect(hiss).connect(nz);

    // гребёнка, настроенная на высоту: резонанс = обратная связь, tanh в петле держит её в узде
    const sum = ctx.createGain();
    env.connect(sum);
    const dl = ctx.createDelay(1);
    const loopLP = ctx.createBiquadFilter(); loopLP.type = 'lowpass'; loopLP.frequency.value = 2400; loopLP.Q.value = -3;
    const loopSat = ctx.createWaveShaper(); loopSat.curve = soft(1.6, false);
    const fb = ctx.createGain(); fb.gain.value = FB_BASE;
    env.connect(dl);
    dl.connect(loopLP).connect(loopSat).connect(fb).connect(dl);
    const wet = ctx.createGain(); wet.gain.value = 0.6;
    dl.connect(wet).connect(sum);

    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 3;
    const lvl = ctx.createGain();
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    sum.connect(lp).connect(lvl);
    (pan ? lvl.connect(pan) : lvl).connect(bus);

    // саб (a2, b2) связью не модулируется — так в графе не бывает петель без задержки
    const fmTargets = [a1t, a1s, a3, b1t, b1s].map((o) => o.frequency);
    return { a1t, a1s, a2, a3, b1t, b1s, b2, tone, nz, env, mod, bp, hiss, dl, fb, lp, lvl, pan, fmTargets };
  }

  function apply(v) {
    const n = v.nodes;
    if (!n) return;
    const t = ctx.currentTime, s = v.snap;
    v.snap = false;
    const T = (p, val, tau) => p.setTargetAtTime(val, t, s ? 0.004 : tau);
    const f = freq(v), ny = noiseAmt(v), G = 0.16;
    T(n.a1t.frequency, f, G); T(n.a1s.frequency, f, G);
    T(n.a2.frequency, f / 2, G);
    T(n.a3.frequency, f * 1.5, G);
    T(n.b1t.frequency, f + v.beat, G); T(n.b1s.frequency, f + v.beat, G);
    T(n.b2.frequency, f / 2 + v.beat, G);
    const tri = (1 - v.sharp) * 0.42, sq = v.sharp * 0.2;
    T(n.a1t.level, tri, 0.05); T(n.a1s.level, sq, 0.05);
    T(n.b1t.level, tri * 0.9, 0.05); T(n.b1s.level, sq * 0.9, 0.05);
    T(n.tone.gain, 1 - 0.78 * ny, 0.08);
    T(n.nz.gain, ny * 1.1, 0.08);
    T(n.bp.frequency, Math.min(f * 2 * 2 ** (v.y * 3.6), 9000), 0.1);
    T(n.bp.Q, 16 - 13 * v.y, 0.1);
    T(n.hiss.gain, v.y ** 3 * 0.22, 0.1);
    T(n.lp.frequency, cutoff(v), 0.1);
    let d = 1 / f;
    while (d < 0.006) d *= 2;
    T(n.dl.delayTime, d, G);
    T(n.fb.gain, v.fb, 0.12);
    T(n.lvl.gain, 0.35 + 0.55 * v.y, 0.1);
    if (n.pan) T(n.pan.pan, (v.x - 0.5) * 0.7, 0.2);
    for (const m of v.mods) if (m.g) T(m.g.gain, f * FM_DEPTH, 0.1);
    for (const u of V) if (u !== v && u.mods.some((m) => m.src === v)) u.dirty = true;   // девиация считается от частоты приёмника
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

  const tailSec = (v) => v.tail * 3;   // примерно до тишины

  // ---------- рисование ----------
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 3);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    scopeY = safeTop.offsetHeight + 18;
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
  // метка закреплённого кружка: форма показывает «волну» — круг у треугольника, квадрат у меандра
  function pinMark(x, y, sharp, a) {
    const s = 9, r = s * (1 - sharp);
    g.fillStyle = ink(a);
    g.beginPath();
    if (g.roundRect) g.roundRect(x - s, y - s, 2 * s, 2 * s, r);
    else g.rect(x - s, y - s, 2 * s, 2 * s);
    g.fill();
  }

  function drawVoice(v) {
    const x = vx(v), y = vy(v);
    const a = v.fingers.length ? 1 : Math.min(1, v.env * 1.2);
    if (v.fingers.length) glowRing(x, y, 36, a); else ring(x, y, 36, a, 2);
    if (v.pinned) { pinMark(x, y, v.sharp, a); ring(x, y, 46, a * 0.45, 1); }
    else dot(x, y, 3.5, a);
  }

  function drawPair(v, now) {
    const p = F.get(v.fingers[0]), q = F.get(v.fingers[1]);
    const dx = q.x - p.x, dy = q.y - p.y, L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L, ny = dx / L;
    const amp = 2 + v.fb * 9, waves = 3 + v.beat * 0.6, ph = (now / 1000) * v.beat * Math.PI * 2;
    g.strokeStyle = ink(0.75); g.lineWidth = 1.2; g.beginPath();
    for (let i = 0; i <= 96; i++) {
      const t = i / 96, o = amp * Math.sin(t * Math.PI) * Math.sin(t * waves * Math.PI * 2 - ph);
      const x = p.x + dx * t + nx * o, y = p.y + dy * t + ny * o;
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.stroke();
    for (const f of [p, q]) { glowRing(f.x, f.y, 30, 1); dot(f.x, f.y, 3, 1); }

    const cx = vx(v), cy = vy(v);
    let th = Math.atan2(-dy, dx);
    if (th > Math.PI / 2) th -= Math.PI;
    if (th <= -Math.PI / 2) th += Math.PI;
    g.strokeStyle = ink(0.5); g.lineWidth = 1;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + 54, cy); g.stroke();
    g.strokeStyle = ink(1); g.lineWidth = 1.5;
    g.beginPath(); g.arc(cx, cy, 42, 0, -th, th > 0); g.stroke();
    g.save(); g.translate(cx, cy); g.rotate(Math.PI / 4);
    g.fillStyle = BG; g.fillRect(-6, -6, 12, 12); g.strokeRect(-6, -6, 12, 12);
    g.restore();
    g.fillStyle = ink(0.8);
    g.font = '11px "IBM Plex Mono", ui-monospace, monospace';
    g.fillText(Math.round(Math.abs(th) * 180 / Math.PI) + '°', cx + 58, cy - 8);
  }

  // связь: пунктир от источника к приёмнику, по нему бежит точка
  function drawLinks(now) {
    g.save();
    g.lineWidth = 1;
    g.setLineDash([3, 6]);
    for (const v of V) {
      if (!v.active) continue;
      for (const m of v.mods) {
        const s = m.src;
        if (!s.active) continue;
        const a = 0.15 + 0.55 * Math.min(1, Math.max(s.env, 0) * 1.2);
        const x1 = vx(s), y1 = vy(s), x2 = vx(v), y2 = vy(v);
        g.lineDashOffset = -now * 0.02;
        g.strokeStyle = ink(a);
        g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
        const t = ((now / 1000) * (0.3 + freq(s) / 400)) % 1;
        dot(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, 2.5, a);
      }
    }
    g.restore();
  }

  function drawMenu(f) {
    const m = f.menu, v = f.voice;
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.beginPath(); g.arc(m.cx, m.cy, MENU_DEAD + MENU_SPAN + 30, 0, Math.PI * 2); g.fill();
    g.save(); g.setLineDash([2, 5]); ring(m.cx, m.cy, MENU_DEAD, 0.5, 1); ring(m.cx, m.cy, MENU_DEAD + MENU_SPAN, 0.18, 1); g.restore();
    g.font = '12px "IBM Plex Mono", ui-monospace, monospace';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const s of SECTORS) {
      const on = m.sector === s;
      const r = MENU_DEAD + 52;
      const x = m.cx + Math.cos(s.ang) * r, y = m.cy + Math.sin(s.ang) * r;
      g.fillStyle = ink(on ? 1 : m.sector ? 0.25 : 0.7);
      g.fillText(s.label, x, y);
    }
    if (m.sector) {
      g.strokeStyle = ink(0.7); g.lineWidth = 1;
      g.beginPath(); g.moveTo(m.cx, m.cy); g.lineTo(f.x, f.y); g.stroke();
      let label = '';
      if (m.sector.key === 'sharp') label = Math.round(v.sharp * 100) + '%';
      else if (m.sector.key === 'tail') label = tailSec(v).toFixed(1) + ' с';
      else if (m.target) {
        label = v.mods.some((k) => k.src === m.target) ? 'разорвать' : 'связать';
        glowRing(vx(m.target), vy(m.target), 46, 1);
      } else label = 'тяни к кружку';
      g.fillStyle = ink(1);
      g.fillText(m.sector.key === 'link' ? label : `${m.sector.label} ${label}`, f.x, f.y - 64);
    }
    g.textAlign = 'start'; g.textBaseline = 'alphabetic';
    glowRing(m.cx, m.cy, 36, 1);
    if (v.pinned) pinMark(m.cx, m.cy, v.sharp, 1); else dot(m.cx, m.cy, 3.5, 1);
  }

  function drawScope() {
    const sx = 22, sw = W - 44, sh = 40, mid = scopeY + sh / 2;
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

    // долгое нажатие на пойманном кружке открывает свойства
    for (const f of F.values()) {
      if (f.menu || f.moved || !f.caught || !f.voice || f.voice.fingers.length !== 1) continue;
      if (now - f.t0 > HOLD_MS) openMenu(f);
    }

    let anyActive = false;
    for (const v of V) {
      if (v.dirty) { v.dirty = false; apply(v); }
      v.env += (v.envT - v.env) * (1 - Math.exp(-dt / v.envTau));
      if (v.active && !v.pinned && !v.fingers.length && v.envT === 0 && v.env < 0.004) {
        v.active = false;
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

    // перекрестие текущего кружка
    const fx = Math.round(vx(focus)) + 0.5, fy = Math.round(vy(focus)) + 0.5;
    g.strokeStyle = LINE; g.lineWidth = 1; g.beginPath();
    g.moveTo(fx, 0); g.lineTo(fx, H); g.moveTo(0, fy); g.lineTo(W, fy); g.stroke();

    // волны от кружков; у пары — с частотой биений
    for (const v of V) {
      if (!v.active || v.env < 0.02) continue;
      const period = v.beat > BEAT_MIN * 2 ? clamp(1 / v.beat, 0.07, 1.4) : 1.1 - 0.6 * v.y;
      v.emit += dt;
      if (v.emit >= period) {
        v.emit = 0;
        if (rings.length < 220) rings.push({ x: vx(v), y: vy(v), r: 34, a: v.env, sp: 70 + freq(v) * 1.1 });
      }
    }
    const Rmax = Math.hypot(W, H) * 0.75;
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.r += r.sp * dt;
      if (r.r > Rmax) { rings.splice(i, 1); continue; }
      ring(r.x, r.y, r.r, Math.min(1, r.a * 0.5 * (1 - r.r / Rmax) ** 1.6), 1);
    }

    if (!touchedOnce) {
      const x = vx(V[0]), y = vy(V[0]);
      [62, 98, 146, 208].forEach((r, i) => ring(x, y, r, [0.14, 0.09, 0.05, 0.025][i], 1));
      ring(x, y, 36, 0.35, 1.5);
    }

    drawLinks(now);
    let menuFinger = null;
    for (const f of F.values()) if (f.menu) menuFinger = f;
    for (const v of V) {
      if (!v.active || (menuFinger && menuFinger.voice === v)) continue;
      if (v.fingers.length === 2) drawPair(v, now); else drawVoice(v);
    }
    for (const f of F.values()) if (!f.voice) dot(f.x, f.y, 3, 0.35);
    if (menuFinger) drawMenu(menuFinger);

    drawScope();
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

  window.t2d = { voices: V, get ctx() { return ctx; } };   // для отладки из консоли

  resize();
  requestAnimationFrame(frame);
})();
