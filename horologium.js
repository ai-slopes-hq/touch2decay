// Horologium (Nova) — мир IX: волшебные числа музыки. Астрономические часы: одно колесо-«единица» (стрелка с солнцем) и
// концентрические кольца II…IX. Кольцо n — n ударов за оборот, каждый — нота n-й гармоники (как Rhythmicon Кауэлла и Термена):
// 2 : 3, 3 : 4, 4 : 5 : 6 — медленно это полиритм, быстро — интервал и аккорд в чистом строе. Двойной тап по кольцу — унтертон
// (12/n ударов, ноты вниз: 1/IV : 1/V : 1/VI — минор). Ведёшь пальцем вдоль кольца — его фаза (удары сдвигаются от «раза»).
// Маятник — как в детстве: хватаешь и качаешь — часы идут от руки (каждый проход через низ — спуск, колесо на четверть оборота);
// бросил сильно — раскачан, часы разгоняются и медленно успокаиваются к темпу; перекинул через верх — крутится, и ритм за порогом
// (limen) сливается в тон; поймал — стоп. Звук — horo-worklet.js (щелчок в резонатор). Солнце — четвертью справа сверху: карта.
(() => {
  'use strict';
  const T = window.T2D;
  const TAU = Math.PI * 2;
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const INK = '214,180,110', BGC = '#0c0a07', PAPER = '12,10,7';
  const NOTES = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];
  const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
  const NR = 8, Z = 4;                                    // кольца II…IX; спуск: четыре прохода маятника за оборот
  const MAGIC = [[2, 3], [3, 4], [4, 5, 6], [3, 4, 5], [2, 3, 5], [4, 5, 6, 7], [5, 7, 9], [6, 7, 8, 9], [8, 9], [2, 3, 4, 5, 6], [5, 6], [4, 5]];
  const NAMES = [[[1, 2], 'diapason'], [[2, 3], 'diapente'], [[3, 4], 'diatessaron'], [[4, 5], 'ditonus'], [[5, 6], 'semiditonus'], [[8, 9], 'tonus'], [[4, 5, 6], 'trias harmonica'], [[10, 12, 15], 'trias mollis'], [[4, 5, 6, 7], 'septima naturalis'], [[3, 4, 5], 'trias harmonica'], [[2, 3, 4], 'diapente · diapason']];

  // ---------- состояние ----------
  const rings = Array.from({ length: NR }, (_, i) => ({ n: i + 2, on: [4, 5, 6].includes(i + 2), under: false, phi: 0, lvl: 0.8 }));
  const fx = { aequalis: 0, materia: 0.35, concursus: 0.4, chance: 1, hall: 0.35 };
  const clock = { run: false, u: 0, bpm: 100 };            // u — во сколько октав быстрее темпа (оборот колеса = такт)
  const pend = { th: 0, ph: 0, spin: false, held: false };
  const Ft = () => clock.bpm / 240;
  const Fnow = () => (clock.run && !pend.held ? Ft() * 2 ** clock.u : 0);
  const mOf = (r) => { const m = r.under ? 12 / r.n : r.n; if (fx.aequalis <= 0) return m; const et = 2 ** (Math.round(12 * Math.log2(m)) / 12); return m * (et / m) ** fx.aequalis; };
  const baseB = () => 55 * 2 ** ((T.scaleOn ? T.scaleRoot : 0) / 12);
  const noteName = (f) => { const m = Math.round(12 * Math.log2(f / 55)); return `${NOTES[((m % 12) + 12) % 12]}${Math.floor((m + 9) / 12) + 1}`; };
  const ET = 0.0447, OM0 = TAU * 0.8;                      // энергия маятника на темпе (размах 0.3 рад); его собственная частота
  const uOfE = (e) => clamp(0.9 * Math.log2(e / ET), -3, 8);
  const eOfU = (u) => ET * 2 ** (u / 0.9);

  // ---------- геометрия: циферблат сверху, под ним отношение и шкала tempus, ниже маятник ----------
  function geo() {
    const W = T.W, H = T.H, top = T.topY + 6, bot = H - T.safeBot - 8, Ws = Math.min(W, (H - T.safeBot) * 0.62), cx = W / 2;
    const R = Math.min(Ws * 0.44, (bot - top) * 0.23), cy = top + 26 + R;
    const r0 = R * 0.17, dr = (R - 22 - r0) / (NR - 1);
    const ty = cy + R + 46, sy = ty + 56, L = Math.max(50, Math.min(100, (bot - sy - 40) / 2 - 12)), py = Math.max(sy + 30 + L, bot - L - 26);   // маятнику есть место перекинуться через верх, не задевая шкалу
    return { W, H, top, bot, cx, cy, R, r0, dr, Ws, ty, strip: { x0: cx - Ws * 0.4, x1: cx + Ws * 0.4, y: sy }, piv: { x: cx, y: py }, L, bob: 13, sun: { x: W, y: T.topY + 2, r: Math.min(42, W * 0.11) } };
  }
  const ringR = (G, i) => G.r0 + i * G.dr;
  function ringAt(G, x, y) { const d = Math.hypot(x - G.cx, y - G.cy), i = Math.round((d - G.r0) / G.dr); return i >= 0 && i < NR && Math.abs(d - ringR(G, i)) < G.dr * 0.62 ? i : -1; }
  const bobXY = (G) => ({ x: G.piv.x + Math.sin(pend.th) * G.L, y: G.piv.y + Math.cos(pend.th) * G.L });

  // ---------- звук ----------
  let actx = null, node = null, bus = null, ready = false, started = false, lastSound = 0;
  const queue = [];
  const send = (m) => { if (node && ready) node.port.postMessage(m); else if (m.t !== 'step') queue.push(m); };
  const VER = (document.currentScript && new URL(document.currentScript.src, location.href).searchParams.get('v')) || '0';
  let Pm = 0, Fm = 0, tP = 0, strikes = 0;                 // зеркало колеса из worklet: положение, скорость, когда пришло
  const ringHit = new Array(NR).fill(0);
  let conc = { t: 0, a: 0 };
  function build(ctx, input) {
    actx = ctx;
    const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const pre = g(1), out = g(1.5), hallSend = g(0), h = T.hall();
    pre.connect(out); pre.connect(hallSend); hallSend.connect(h.input); h.out.connect(g(0.9)).connect(out);
    bus = { pre, out, hallSend, hall: h, input, live: false };
    ready = false; node = null; started = false; queue.length = 0;
    applyFx();
  }
  function start() {                                       // колесо и кольца (horo-worklet.js) — когда в мир впервые зашли
    if (started || !actx) return;
    started = true;
    actx.audioWorklet.addModule(`horo-worklet.js?v=${VER}`).then(() => {
      node = new AudioWorkletNode(actx, 'horo', { numberOfInputs: 0, outputChannelCount: [2] });
      node.connect(bus.pre); ready = true;
      node.port.onmessage = (e) => {
        const d = e.data; if (d.t !== 'p') return;
        const now = performance.now();
        Pm = d.P; Fm = d.F; tP = now;
        if (d.hits.length) { for (const i of d.hits) ringHit[i] = now; strikes += d.hits.length; if (new Set(d.hits).size > 1 && fx.concursus > 0.05) conc = { t: now, a: (d.P % 1) * TAU }; lastSound = now; }
      };
      sendAll(); applyFx();
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
    if (sounding()) lastSound = performance.now();
    else if (performance.now() - lastSound > 8000) setLive(false);
  }, 1000);
  function applyFx() {
    if (!bus) return;
    const t = actx.currentTime;
    bus.hallSend.gain.setTargetAtTime(fx.hall * fx.hall * 1.4, t, 0.05);
    for (const l of bus.hall.lines) l.g.gain.setTargetAtTime(10 ** ((-3 * l.len) / (1.5 + fx.hall * 4)), t, 0.05);
    send({ t: 'set', mat: fx.materia, conc: fx.concursus, chance: fx.chance, aeq: fx.aequalis });
  }
  let sentF = -1, sentB = -1;
  function sendAll() { send({ t: 'set', rings: rings.map(({ on, under, phi, lvl }) => ({ on, under, phi, lvl })), B: baseB(), F: Fnow() }); sentF = Fnow(); sentB = baseB(); }
  function live() { start(); setLive(true); lastSound = performance.now(); }
  const Pvis = () => Pm + Fm * Math.min(0.1, (performance.now() - tP) / 1000);
  const sounding = () => (clock.run || pend.held) && rings.some((r) => r.on);

  // ---------- маятник и ход ----------
  function setRun(on, u = 0) { clock.run = on; clock.u = u; if (on) { live(); const A = Math.acos(1 - Math.min(1.9, eOfU(u))); pend.ph = Math.asin(clamp(pend.th / A, -1, 1)); } }
  function release(th, om) {                               // отпустил маятник: энергия броска → скорость хода
    const e = (om / OM0) ** 2 / 2 + (1 - Math.cos(th));
    pend.held = false;
    if (e < ET / 6 || (Math.abs(om) < 0.3 && Math.abs(th) < 0.45)) { clock.run = false; return; }   // поймал и отпустил у низа — стоп; поднял повыше и отпустил — пошёл
    clock.run = true; clock.u = uOfE(e); live();
    pend.spin = e >= 1.95;
    if (!pend.spin) { const A = Math.acos(1 - e); pend.ph = om >= 0 ? Math.asin(clamp(th / A, -1, 1)) : Math.PI - Math.asin(clamp(th / A, -1, 1)); }
  }
  function tickClock(dt) {
    if (clock.run && !pend.held) {
      if (clock.u > 0) clock.u -= clock.u * dt / 6;        // раскачанный — медленно успокаивается к темпу
      else clock.u += -clock.u * dt / 1.5;                 // слабый — спуск подталкивает к темпу
      const e = eOfU(clock.u), F = Fnow();
      if (e < 1.95) {
        const A = Math.acos(1 - e);
        if (pend.spin) { pend.spin = false; pend.ph = Math.asin(clamp(Math.sin(pend.th) / A, -1, 1)); }
        pend.ph += TAU * (Z * F / 2) * dt; pend.th = A * Math.sin(pend.ph);
      } else { pend.spin = true; pend.th = ((pend.th + TAU * Z * F * dt / 2 + Math.PI) % TAU + TAU) % TAU - Math.PI; }
    } else if (!pend.held) { pend.th *= Math.exp(-dt * 3); }   // стоит — повисает отвесно
    const F = Fnow(), B = baseB();
    if (Math.abs(F - sentF) > Math.max(0.002, sentF * 0.004) || B !== sentB) { send({ t: 'set', F, B }); sentF = F; sentB = B; }
  }

  // ---------- касания ----------
  const touches = new Map();
  let lastRingTap = null;
  function down(f) {
    const G = geo(), now = performance.now(), b = bobXY(G), dp = Math.hypot(f.x - G.piv.x, f.y - G.piv.y);
    start();
    if (Math.hypot(f.x - b.x, f.y - b.y) < G.bob + 24 || (pend.spin && Math.abs(dp - G.L) < 30)) {   // маятник: схватить
      const th = Math.atan2(f.x - G.piv.x, f.y - G.piv.y);
      touches.set(f.id, { kind: 'pend', x0: f.x, y0: f.y, t0: now, th, tt: now, om: 0, moved: false, was: clock.run });
      pend.held = true; pend.spin = false; pend.th = th; send({ t: 'set', F: 0 }); sentF = 0; live();
      return;
    }
    const dh = Math.hypot(f.x - G.cx, f.y - G.cy);
    if (dh < G.r0 - 6) { touches.set(f.id, { kind: 'hub', t0: now, x0: f.x, y0: f.y, moved: false }); return; }
    const i = ringAt(G, f.x, f.y);
    if (i >= 0) {
      const r = rings[i];
      if (lastRingTap && lastRingTap.i === i && now - lastRingTap.t < T.DTAP_MS) { r.under = !r.under; r.on = true; lastRingTap = null; sendAll(); live(); touches.set(f.id, { kind: 'none' }); return; }   // двойной тап — унтертон
      touches.set(f.id, { kind: 'ring', i, t0: now, x0: f.x, y0: f.y, a0: Math.atan2(f.x - G.cx, -(f.y - G.cy)), phi0: r.phi, moved: false, was: r.on });
      return;
    }
    touches.set(f.id, { kind: 'none' });
  }
  function move(f) {
    const t = touches.get(f.id);
    if (!t || t.kind === 'none' || t.sheet) return;
    const G = geo(), now = performance.now();
    if (Math.hypot(f.x - t.x0, f.y - t.y0) > 8) t.moved = true;
    if (t.kind === 'pend') {                              // ведёшь маятник: каждый проход через низ — спуск, колесо на 1/Z оборота
      const th = Math.atan2(f.x - G.piv.x, f.y - G.piv.y), dt = Math.max(1, now - t.tt) / 1000;
      let d = th - t.th; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU;
      if (Math.sign(th) !== Math.sign(t.th) && Math.abs(th) < Math.PI / 2 && Math.abs(t.th) < Math.PI / 2) { send({ t: 'step', d: 1 / Z }); handSteps++; }
      t.om = 0.6 * t.om + 0.4 * (d / dt); t.th = th; t.tt = now; pend.th = th;
      return;
    }
    if (t.kind === 'ring' && t.moved) {                   // вдоль кольца — фаза
      const a = Math.atan2(f.x - G.cx, -(f.y - G.cy)); let d = a - t.a0; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU;
      const r = rings[t.i], m = mOf(r); r.phi = ((t.phi0 - (d / TAU) * m) % 1 + 1) % 1; t.a0 = a; t.phi0 = r.phi; t.ph = true;
      send({ t: 'set', rings: rings.map(({ on, under, phi, lvl }) => ({ on, under, phi, lvl })) });
    }
  }
  let handSteps = 0;
  function up(f) {
    const t = touches.get(f.id);
    touches.delete(f.id);
    if (!t) return;
    const now = performance.now();
    if (t.kind === 'pend') {
      if (!t.moved && now - t.t0 < 300) { pend.held = false; if (t.was) clock.run = false; else setRun(true, 0); return; }   // тап — пуск / стоп
      if (now - t.tt > 120) t.om = 0;                     // держал неподвижно — поймал
      release(t.th, t.om); return;
    }
    if (t.kind === 'hub' && !t.moved && !t.sheet) { if (clock.run) clock.run = false; else setRun(true, 0); return; }
    if (t.kind === 'ring' && !t.moved && !t.sheet) { const r = rings[t.i]; r.on = !r.on; lastRingTap = { i: t.i, t: now }; sendAll(); if (r.on) live(); }
  }
  function ringSheet(i) {
    const r = rings[i];
    T.openSheet({
      title: `circulus ${ROMAN[r.n]}`, hint: 'ring — tap outside to close',
      rows: [{ key: 'on', label: 'sounds' }, { key: 'under', label: 'undertone' }, { key: 'phi', label: 'phase' }, { key: 'lvl', label: 'level' }],
      lfo: { id: `horo-r${i}`, keys: ['phi', 'lvl'], shapes: 'classic' },
      get: (k) => (k === 'on' || k === 'under' ? (r[k] ? 1 : 0) : r[k]),
      set: (k, v) => { if (k === 'on' || k === 'under') r[k] = v >= 0.5; else r[k] = v; sendAll(); },
      text: (k) => (k === 'on' ? (r.on ? 'yes' : 'no') : k === 'under' ? (r.under ? `1/${r.n} · ${+(12 / r.n).toFixed(2)} a turn` : `${r.n} a turn`) : k === 'phi' ? `${Math.round(r.phi * 360)}°` : `${Math.round(r.lvl * 100)}%`),
    });
  }
  function hubSheet() {
    T.openSheet({
      title: 'tempus', hint: 'one turn of the wheel = one bar — tap outside to close',
      rows: [{ key: 'bpm', label: 'tempo' }],
      get: () => (clock.bpm - 40) / 160, set: (k, v) => { clock.bpm = Math.round(40 + v * 160); T.tempoFrom(9, clock.bpm); }, text: () => `${clock.bpm} bpm`,
    });
  }
  function tick(now, dt) {
    tickClock(dt);
    for (const t of touches.values()) {
      if (t.sheet || t.moved || now - t.t0 <= T.HOLD_MS) continue;
      if (t.kind === 'ring') { t.sheet = true; ringSheet(t.i); }
      else if (t.kind === 'hub') { t.sheet = true; hubSheet(); }
    }
  }

  // ---------- рисование ----------
  const ink = (a) => `rgba(${INK},${a})`;
  let wallC = null, wallKey = '';
  function wall(G) {                                      // неподвижное: обод, деления, unitas, шкала tempus, ось маятника
    const key = `${G.W}x${G.H}x${T.DPR}|${G.cy}|${G.R}|${G.strip.y}`;
    if (wallC && key === wallKey) return wallC;
    wallKey = key;
    wallC = document.createElement('canvas');
    wallC.width = Math.round(G.W * T.DPR); wallC.height = Math.round(G.H * T.DPR);
    const x = wallC.getContext('2d');
    x.setTransform(T.DPR, 0, 0, T.DPR, 0, 0);
    x.fillStyle = BGC; x.fillRect(0, 0, G.W, G.H);
    const { cx, cy, R } = G;
    x.lineWidth = 1;
    x.strokeStyle = ink(0.85); x.beginPath(); x.arc(cx, cy, R, 0, TAU); x.stroke();
    x.strokeStyle = ink(0.3); x.beginPath(); x.arc(cx, cy, R - 4, 0, TAU); x.stroke();
    x.strokeStyle = ink(0.45); x.beginPath();
    for (let k = 0; k < 96; k++) { const a = (k / 96) * TAU, l = k % 4 ? 3 : 7; x.moveTo(cx + Math.sin(a) * (R - 4), cy - Math.cos(a) * (R - 4)); x.lineTo(cx + Math.sin(a) * (R - 4 - l), cy - Math.cos(a) * (R - 4 - l)); }
    x.stroke();
    x.font = `${Math.max(9, Math.min(12, R * 0.07))}px ${T.MAP}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = ink(0.75);   // цифры, как на часах: XII наверху
    for (let k = 1; k <= 12; k++) { const a = (k / 12) * TAU, rr = R + 11; x.save(); x.translate(cx + Math.sin(a) * rr, cy - Math.cos(a) * rr); x.rotate(a); x.fillText(ROMAN[k], 0, 0); x.restore(); }
    x.strokeStyle = ink(0.12); x.setLineDash([1, 3]); x.beginPath(); x.moveTo(cx, cy - G.r0 + 4); x.lineTo(cx, cy - R + 10); x.stroke(); x.setLineDash([]);   // «раз»: здесь все кольца сходятся
    const S = G.strip;                                    // шкала tempus: от ритма к тону
    x.strokeStyle = ink(0.5); x.beginPath(); x.moveTo(S.x0, S.y); x.lineTo(S.x1, S.y); x.stroke();
    x.beginPath(); for (let k = 0; k <= 40; k++) { const px = S.x0 + ((S.x1 - S.x0) * k) / 40, l = k % 5 ? 3 : 6; x.moveTo(px, S.y); x.lineTo(px, S.y + l); } x.stroke();
    x.font = `italic 10.5px ${T.MAP}`; x.fillStyle = ink(0.45); x.textAlign = 'left'; x.fillText('rhythmus', S.x0, S.y - 9); x.textAlign = 'right'; x.fillText('tonus', S.x1, S.y - 9);
    x.fillStyle = ink(0.7); x.beginPath(); x.arc(G.piv.x, G.piv.y, 3, 0, TAU); x.fill();
    return wallC;
  }
  const FLO = 0.05, FHI = 120, stripX = (S, F) => S.x0 + (S.x1 - S.x0) * clamp(Math.log(F / FLO) / Math.log(FHI / FLO));
  function marksOf(r, P) {                                // удары этого оборота: углы
    const m = mOf(r), P0 = Math.floor(P), out = [];
    for (let k = Math.ceil(P0 * m + r.phi); k < (P0 + 1) * m + r.phi; k++) out.push({ k, a: ((k - r.phi) / m - P0) * TAU });
    return out;
  }
  function drawRings(c, G, now, P) {
    const fast = Fm > 4;
    rings.forEach((r, i) => {
      const rr = ringR(G, i), on = r.on, m = mOf(r), hit = clamp(1 - (now - ringHit[i]) / 260), cur = Math.floor(P * m + r.phi);
      c.lineWidth = 1; c.strokeStyle = ink(on ? 0.5 + 0.2 * r.lvl : 0.13); c.setLineDash(on ? [] : [2, 4]); c.beginPath(); c.arc(G.cx, G.cy, rr, 0, TAU); c.stroke(); c.setLineDash([]);
      if (on && r.under) { c.strokeStyle = ink(0.3); c.beginPath(); c.arc(G.cx, G.cy, rr - 3, 0, TAU); c.stroke(); }   // унтертон — двойной обвод
      for (const q of marksOf(r, P)) {
        const x = G.cx + Math.sin(q.a) * rr, y = G.cy - Math.cos(q.a) * rr;
        if (!on) { c.strokeStyle = ink(0.22); c.beginPath(); c.arc(x, y, 1.8, 0, TAU); c.stroke(); continue; }
        const g = fast ? 0.35 + 0.4 * r.lvl : q.k === cur ? hit : 0;
        if (g > 0.05) T.glowAt(x, y, 10 + 8 * g, 0.35 * g);
        c.fillStyle = ink(Math.min(1, 0.55 + 0.45 * g));
        if (r.under) { c.beginPath(); c.moveTo(x, y - 3.6); c.lineTo(x + 3, y); c.lineTo(x, y + 3.6); c.lineTo(x - 3, y); c.closePath(); c.fill(); }
        else { c.beginPath(); c.arc(x, y, 3.1, 0, TAU); c.fill(); }
      }
      let la = Math.PI + 0.35;                            // число кольца — внизу слева, в просвете между метками
      const ms = marksOf(r, P).map((q) => ((q.a % TAU) + TAU) % TAU).sort((x, y) => x - y);
      if (ms.length) { let best = la, bd = 9; for (let j = 0; j < ms.length; j++) { const a0 = ms[j], a1 = j + 1 < ms.length ? ms[j + 1] : ms[0] + TAU, mid = (a0 + a1) / 2, d = Math.abs(((mid - la + Math.PI) % TAU + TAU) % TAU - Math.PI); if (d < bd) { bd = d; best = mid; } } la = best; }
      const lx = G.cx + Math.sin(la) * rr, ly = G.cy - Math.cos(la) * rr;
      c.font = `italic ${on ? 11 : 9.5}px ${T.MAP}`; c.textAlign = 'center'; c.textBaseline = 'middle';
      const lab = r.under ? `1/${ROMAN[r.n]}` : ROMAN[r.n], w = c.measureText(lab).width;
      c.fillStyle = BGC; c.fillRect(lx - w / 2 - 2, ly - 6, w + 4, 12);
      c.fillStyle = ink(on ? 0.9 : 0.32); c.fillText(lab, lx, ly);
    });
  }
  function drawHour(c, G, P) {                            // часовая стрелка — считает такты: деление за такт, круг — 12 тактов
    const Fh = Fm / 12, R = G.R * 0.58;
    const bar = ((Math.floor(P) % 12) + 12) % 12, na = ((bar + 1) / 12) * TAU, rr = G.R + 11;   // цифра такта, к которому идёт стрелка, — ярче
    T.glowAt(G.cx + Math.sin(na) * rr, G.cy - Math.cos(na) * rr, 16, 0.25);
    c.save(); c.translate(G.cx + Math.sin(na) * rr, G.cy - Math.cos(na) * rr); c.rotate(na);
    c.font = `${Math.max(9, Math.min(12, G.R * 0.07))}px ${T.MAP}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = ink(1); c.fillText(ROMAN[bar + 1], 0, 0); c.restore();
    if (Fh > 4) { c.strokeStyle = ink(0.05); c.beginPath(); for (let j = 0; j < 60; j++) { const a = (j / 60) * TAU; c.moveTo(G.cx, G.cy); c.lineTo(G.cx + Math.sin(a) * R, G.cy - Math.cos(a) * R); } c.stroke(); return; }
    const a = (((P / 12) % 1 + 1) % 1) * TAU, sx = Math.sin(a), cy = -Math.cos(a), px = cy, py = -sx;   // ромб-наконечник, широкая игла
    const tip = [G.cx + sx * R, G.cy + cy * R], mid = [G.cx + sx * R * 0.78, G.cy + cy * R * 0.78], w = 5;
    c.fillStyle = BGC; c.strokeStyle = ink(0.8); c.lineWidth = 1;
    c.beginPath(); c.moveTo(G.cx + px * 2.5, G.cy + py * 2.5); c.lineTo(mid[0] + px * 1.2, mid[1] + py * 1.2); c.lineTo(mid[0] + sx * 4 + px * w, mid[1] + cy * 4 + py * w); c.lineTo(tip[0], tip[1]); c.lineTo(mid[0] + sx * 4 - px * w, mid[1] + cy * 4 - py * w); c.lineTo(mid[0] - px * 1.2, mid[1] - py * 1.2); c.lineTo(G.cx - px * 2.5, G.cy - py * 2.5); c.closePath(); c.fill(); c.stroke();
  }
  function drawHand(c, G, now, P) {
    drawHour(c, G, P);
    const R = G.R - 14;
    if (Fm > 4) {                                         // быстро — стрелка слилась в диск
      const k = clamp((Fm - 4) / 12);
      c.strokeStyle = ink(0.05 * k + 0.02); c.beginPath(); for (let j = 0; j < 120; j++) { const a = (j / 120) * TAU; c.moveTo(G.cx, G.cy); c.lineTo(G.cx + Math.sin(a) * R, G.cy - Math.cos(a) * R); } c.stroke();
      c.strokeStyle = ink(0.5); c.beginPath(); c.arc(G.cx, G.cy, R, 0, TAU); c.stroke();
    } else {
      const a = (((P % 1) + 1) % 1) * TAU, hx = G.cx + Math.sin(a) * R, hy = G.cy - Math.cos(a) * R;
      for (let j = 1; j < 10; j++) { const b = a - j * 0.04 * clamp(Fm); c.strokeStyle = ink(0.05 * (1 - j / 10)); c.beginPath(); c.moveTo(G.cx, G.cy); c.lineTo(G.cx + Math.sin(b) * R, G.cy - Math.cos(b) * R); c.stroke(); }
      c.strokeStyle = ink(0.85); c.lineWidth = 1.2; c.beginPath(); c.moveTo(G.cx, G.cy); c.lineTo(hx, hy); c.stroke(); c.lineWidth = 1;
      c.fillStyle = BGC; c.beginPath(); c.arc(hx, hy, 7, 0, TAU); c.fill(); c.strokeStyle = ink(0.95); c.stroke();
      c.beginPath(); for (let k = 0; k < 12; k++) { const b = (k / 12) * TAU + now * 0.0004; c.moveTo(hx + Math.cos(b) * 9, hy + Math.sin(b) * 9); c.lineTo(hx + Math.cos(b) * 13, hy + Math.sin(b) * 13); } c.stroke();
    }
    const ck = clamp(1 - (now - conc.t) / 350);           // concursus: кольца совпали — луч
    if (ck > 0 && Fm <= 4) { c.strokeStyle = ink(0.5 * ck); c.beginPath(); c.moveTo(G.cx, G.cy); c.lineTo(G.cx + Math.sin(conc.a) * (G.R - 4), G.cy - Math.cos(conc.a) * (G.R - 4)); c.stroke(); }
    c.fillStyle = BGC; c.beginPath(); c.arc(G.cx, G.cy, G.r0 - 8, 0, TAU); c.fill();   // ступица: тап — пуск, держишь — темп
    c.strokeStyle = ink(clock.run ? 0.8 : 0.5); c.beginPath(); c.arc(G.cx, G.cy, G.r0 - 8, 0, TAU); c.stroke();
    if (!clock.run && !pend.held) { c.fillStyle = ink(0.8); const s = 5; c.beginPath(); c.moveTo(G.cx - s * 0.6, G.cy - s); c.lineTo(G.cx + s, G.cy); c.lineTo(G.cx - s * 0.6, G.cy + s); c.closePath(); c.fill(); }
    else { c.fillStyle = ink(0.9); c.beginPath(); c.arc(G.cx, G.cy, 3.2, 0, TAU); c.fill(); }
  }
  function ratioText() {                                  // что звучит: отношение и его имя
    const act = rings.filter((r) => r.on);
    if (!act.length) return { a: 'quies', b: 'tap a ring' };
    const a = act.map((r) => (r.under ? `1/${ROMAN[r.n]}` : ROMAN[r.n])).join(' : ');
    const ms = act.map((r) => (r.under ? 12 / r.n : r.n)).sort((x, y) => x - y);
    let name = '';
    for (const [set, nm] of NAMES) if (set.length === ms.length && set.every((v, k) => Math.abs(v / set[0] - ms[k] / ms[0]) < 1e-6)) { name = nm; break; }
    const tone = Fm * ms[0] >= 20;
    const b = tone ? `tonus${name ? ` — ${name}` : ''} · ${ms.map((m) => noteName(m * Fm)).join(' ')}` : `rhythmus · ${ms.map((m) => +m.toFixed(2)).join(' · ')} ictus in circuitu${name ? ` · ${name}` : ''}`;
    return { a, b };
  }
  function drawPendulum(c, G) {
    const { x: px, y: py } = G.piv, L = G.L, rate = clock.run && !pend.held ? (Z * Fnow()) / 2 : 0;
    if (pend.spin && rate > 3) {                          // крутится — расплылся
      c.strokeStyle = ink(0.1); c.beginPath(); c.arc(px, py, L, 0, TAU); c.stroke();
      for (let j = 0; j < 7; j++) { const a = pend.th + (j / 7) * TAU; c.strokeStyle = ink(0.12); c.beginPath(); c.moveTo(px, py); c.lineTo(px + Math.sin(a) * L, py + Math.cos(a) * L); c.stroke(); c.beginPath(); c.arc(px + Math.sin(a) * L, py + Math.cos(a) * L, G.bob, 0, TAU); c.stroke(); }
      return;
    }
    if (rate > 2.5 && !pend.spin) {                       // качается быстро — веером
      const A = Math.acos(1 - Math.min(1.9, eOfU(clock.u)));
      for (const s of [-1, -0.5, 0, 0.5, 1]) { const a = s * A; c.strokeStyle = ink(0.1); c.beginPath(); c.moveTo(px, py); c.lineTo(px + Math.sin(a) * L, py + Math.cos(a) * L); c.stroke(); }
    }
    const b = bobXY(G);
    c.strokeStyle = ink(0.65); c.beginPath(); c.moveTo(px, py); c.lineTo(b.x, b.y); c.stroke();
    c.fillStyle = BGC; c.strokeStyle = ink(pend.held ? 1 : 0.9); c.beginPath(); c.arc(b.x, b.y, G.bob, 0, TAU); c.fill(); c.stroke();
    c.strokeStyle = ink(0.35); c.beginPath(); c.arc(b.x, b.y, G.bob - 4, 0, TAU); c.stroke();
  }
  let noSun = false;
  function draw(now) {
    const c = T.g, G = geo(), P = Pvis();
    c.drawImage(wall(G), 0, 0, T.W, T.H);
    drawRings(c, G, now, P);
    drawHand(c, G, now, P);
    const rt = ratioText();
    T.mapText(rt.a, G.cx, G.ty, 19, 0.95, 'center');
    T.mapText(rt.b, G.cx, G.ty + 21, 12, 0.6, 'center');
    const S = G.strip, act = rings.filter((r) => r.on), mAvg = act.length ? act.reduce((s, r) => s + mOf(r), 0) / act.length : 4, lim = stripX(S, 20 / mAvg);   // limen: где удары сливаются в тон
    c.strokeStyle = ink(0.35); c.setLineDash([2, 3]); c.beginPath(); c.moveTo(lim, S.y - 14); c.lineTo(lim, S.y + 14); c.stroke(); c.setLineDash([]);
    T.mapText('limen', lim, S.y + 22, 10.5, 0.45, 'center');
    if (Fm > 0.01) { const mx = stripX(S, Fm); c.fillStyle = ink(0.95); c.beginPath(); c.moveTo(mx, S.y - 3); c.lineTo(mx - 5, S.y - 11); c.lineTo(mx + 5, S.y - 11); c.closePath(); c.fill(); T.mapText(`${Fm < 10 ? Fm.toFixed(2) : Math.round(Fm)} / s`, mx, S.y - 20, 11, 0.75, 'center'); }
    drawPendulum(c, G);
    for (const t of touches.values()) if (t.kind === 'ring' && t.ph) { const r = rings[t.i]; T.mapText(`${ROMAN[r.n]} · ${Math.round(r.phi * 360)}°`, G.cx, G.cy + G.R + 14, 12, 0.85, 'center'); }
    if (!noSun) T.quarterSun(c, G.sun.x, G.sun.y, G.sun.r, -1, now, INK, BGC);
  }

  // ---------- мир ----------
  const deg = (d) => (d * Math.PI) / 180;
  const fxw = {
    sectors: [{ key: 'aequalis', label: 'aequalis', ang: deg(190) }, { key: 'materia', label: 'materia', ang: deg(160) }, { key: 'concursus', label: 'concursus', ang: deg(130) }, { key: 'chance', label: 'chance', ang: deg(105) }, { key: 'hall', label: 'hall', ang: deg(80) }],
    get: (k) => fx[k], set: (k, v) => { fx[k] = v; applyFx(); },
    text: (k) => (k === 'aequalis' ? (fx.aequalis < 0.01 ? 'pure' : fx.aequalis > 0.99 ? 'equal' : `${Math.round(fx.aequalis * 100)}% equal`) : k === 'materia' ? `${fx.materia < 0.5 ? 'lignum' : 'metallum'} ${Math.round(fx.materia * 100)}%` : `${Math.round(fx[k] * 100)}%`),
    lfo: { keys: ['aequalis', 'materia', 'concursus', 'chance', 'hall'], shapes: 'random' },
    arc: () => fx.hall, save: () => ({ ...fx }), load: (o) => { Object.assign(fx, o); applyFx(); },
  };
  function dice() {                                       // волшебное отношение, иногда — унтертонами; фаза — у одного кольца; часы идут
    const R = Math.random, set = MAGIC[Math.floor(R() * MAGIC.length)], under = R() < 0.25;
    rings.forEach((r) => { r.on = set.includes(r.n); r.under = under; r.phi = 0; r.lvl = 0.8; });
    if (R() < 0.4) { const on = rings.filter((r) => r.on); on[Math.floor(R() * on.length)].phi = [0.25, 0.5, 0.75][Math.floor(R() * 3)]; }
    fx.materia = R(); applyFx(); sendAll(); setRun(true, 0);
  }
  const horo = {
    n: 'IX', title: 'Horologium', sub: 'numeri · horae', theme: { ink: INK, bg: BGC, paper: PAPER },
    corner: { hit: (f) => { const G = geo(); return f.y > G.sun.y && Math.hypot(f.x - G.sun.x, f.y - G.sun.y) < G.sun.r + 6; }, draw: () => {} },   // солнце — карта
    fx: fxw,
    legend: [['tap', 'tap a ring', 'it sounds: n strikes a turn, the n-th harmonic'], ['double', 'double tap a ring', 'undertone 1/n'], ['drag', 'drag along a ring', 'its phase'],
      ['hold', 'hold a ring', 'its sheet'], ['throw', 'swing the pendulum', 'by hand — it ticks · throw — faster · over the top — a chord · catch — stop'],
      ['tap', 'tap the hub', 'run / stop · hold — tempo'], ['tap', 'tap the sun', 'map of worlds']],
    build, tick, draw, down, move, up, dice, enter: start,
    clear() { for (const r of rings) r.on = false; clock.run = false; sendAll(); },
    snapshot: () => JSON.stringify({ r: rings.map(({ on, under, phi, lvl }) => ({ on, under, phi, lvl })), fx, bpm: clock.bpm, run: clock.run, u: clock.u }),
    restore(js) {
      const st = JSON.parse(js);
      if (!st.r) return;                                   // снимок старого Horologium — не наш
      st.r.forEach((q, i) => Object.assign(rings[i], q));
      Object.assign(fx, st.fx); clock.bpm = st.bpm; clock.run = st.run; clock.u = st.u || 0; applyFx(); sendAll();
    },
    sounding, tempo: { set: (bpm) => { clock.bpm = bpm; } }, mapShot(on) { noSun = on; },
  };
  T.registerWorld(9, horo);
  window.t2d.horo = {
    rings, fx, clock, pend, geo, setFx: (k, v) => fxw.set(k, v), get ready() { return ready; }, get live() { return !!(bus && bus.live); }, get F() { return Fm; }, get P() { return Pm; }, get strikes() { return strikes; }, get handSteps() { return handSteps; },
    ring: (i, a = 0) => { const G = geo(), r = ringR(G, i); return { x: G.cx + Math.sin(a) * r, y: G.cy - Math.cos(a) * r }; }, bob: () => bobXY(geo()), hub: () => { const G = geo(); return { x: G.cx, y: G.cy }; }, run: setRun, ratio: ratioText,
  };
})();
