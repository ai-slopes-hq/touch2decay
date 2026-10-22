// Laboratorium — мир III: перегонный куб алхимика. На атаноре (печь) три колбы — три синуса-оператора, змеевики между ними — FM.
// Всё живёт само: огонь гонит жидкость по цепи A → B → C (а замкнёшь кольцо — и C → A), уровни плывут — плывут и высоты
// (с ладом — шагами, мелодия рождается сама); из змеевика в колбу C капает — каждая капля — удар; жидкость кипит — пузыри качают
// высоту (биения). Огонь — тап: зажечь/погасить, вверх-вниз — жар (громкость, яркость, скорость перегонки и капель).
// Колба — тянешь вверх-вниз: долить/отлить (выше уровень — ниже тон); держишь — плашка. Змеевик — тап: ещё виток (глубже FM,
// после шестого — снова прямая трубка). Кольцо внизу — тап: замкнуть C → A (обратная связь, хаос, как у Lyra-8) / разомкнуть.
// FX: athanor (перегруз), bulla (кипение), spread, hall. Лампа Гермеса в углу — карта.
(() => {
  'use strict';
  const T = window.T2D;
  const TAU = Math.PI * 2;
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const INK = '232,220,200', BGC = '#0d0a08', PAPER = '13,10,8', FIRE = [239, 159, 39], BRASS = [196, 150, 82];
  const COL = [[226, 75, 74], [55, 138, 221], [99, 153, 34]];                 // A — киноварь, B — купорос, C — ярь-медянка
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const NOTES = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];
  const noteName = (st) => { const m = Math.round(st); return `${NOTES[((m % 12) + 12) % 12]}${Math.floor((m + 9) / 12) + 1}`; };
  const LMIN = 0.08, LMAX = 0.92, CMAX = 6;
  const BASE = [12, 24, 19];                                                    // полутоны от 55 Гц у пустой колбы (A2, A3, E3); полная — на 12 ниже

  // ---------- состояние ----------
  const fl = [0, 1, 2].map((i) => ({ i, L: [0.55, 0.5, 0.4][i], lvl: 0.7, wob: 0, mix: COL[i].slice() }));   // L — уровень жидкости; mix — цвет смеси
  const coil = [2, 1];                                  // витки змеевиков A→B, B→C
  const st = { fire: false, heat: 0.5, ring: false, ringCoil: 1 };
  const fx = { athanor: 0.3, bulla: 0.35, spread: 0.5, hall: 0.45 };
  const semiOf = (f) => { const s = BASE[f.i] - 12 * (f.L - LMIN) / (LMAX - LMIN); return T.scaleOn ? T.snapSemi(s) : s; };
  const freqOf = (f) => 55 * 2 ** (semiOf(f) / 12);
  const idxOf = (n) => n * 0.55;                        // витки → индекс модуляции

  // ---------- геометрия ----------
  function geo() {
    const W = T.W, H = T.H, top = T.topY + 6, bot = H - T.safeBot - 8, Ws = Math.min(W, (H - T.safeBot) * 0.62), cx = W / 2;
    const furn = bot - 96, r = Math.min(Ws * 0.16, 62, (furn - top - 150) / 7);   // верх атанора; колбы крупнее, цепь — во всю высоту
    const ay = furn - r - 56, by = Math.max(top + r * 1.4 + 60, ay - r * 4.2);
    const F = [{ x: cx - Ws * 0.29, y: ay }, { x: cx, y: by }, { x: cx + Ws * 0.29, y: ay }];
    return { W, H, top, bot, cx, Ws, r, furn, F, ringY: ay + r + 22, lamp: { x: cx - Ws / 2 + 34, y: top + 34, r: 34 } };
  }
  function tubes(G) {                                   // пути змеевиков: из горла колбы через дугу к соседней
    const [A, B, C] = G.F, r = G.r, neck = r * 1.35;
    const ab = [{ x: A.x, y: A.y - neck }, { x: A.x, y: B.y - r * 0.2 }, { x: B.x - r * 1.05, y: B.y - r * 0.2 }];
    const bc = [{ x: B.x + r * 1.05, y: B.y - r * 0.2 }, { x: C.x, y: B.y - r * 0.2 }, { x: C.x, y: C.y - neck }];
    const ca = [{ x: C.x + r * 0.7, y: C.y + r * 0.7 }, { x: C.x + r * 0.7, y: G.ringY }, { x: A.x - r * 0.7, y: G.ringY }, { x: A.x - r * 0.7, y: A.y + r * 0.7 }];
    return [ab, bc, ca];
  }
  function polyLen(P) { let L = 0; for (let i = 1; i < P.length; i++) L += Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y); return L; }
  function along(P, u) {                                // точка на ломаной, доля u
    let d = u * polyLen(P);
    for (let i = 1; i < P.length; i++) { const l = Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y); if (d <= l) { const k = d / (l || 1); return { x: P[i - 1].x + (P[i].x - P[i - 1].x) * k, y: P[i - 1].y + (P[i].y - P[i - 1].y) * k, i }; } d -= l; }
    return { ...P[P.length - 1], i: P.length - 1 };
  }
  function nearPoly(P, x, y) { let best = 1e9; for (let k = 0; k <= 40; k++) { const p = along(P, k / 40); best = Math.min(best, Math.hypot(p.x - x, p.y - y)); } return best; }

  // ---------- звук: три синуса, FM по змеевикам, кольцо — через задержку; сумма → перегруз (athanor) → огонь → зал ----------
  let actx = null, bus = null, ops = null, lastSound = 0;
  function build(ctx, input) {
    actx = ctx;
    const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const sum = g(1), sh = ctx.createWaveShaper(), fireG = g(0), pre = g(1), out = g(1), hallSend = g(0), h = T.hall();
    sum.connect(sh); sh.connect(fireG); fireG.connect(pre);
    pre.connect(out); pre.connect(hallSend); hallSend.connect(h.input); h.out.connect(g(0.9)).connect(out);
    bus = { sum, sh, fireG, pre, out, hallSend, hall: h, input, live: false, drive: -1 };
    ops = null;
    applyFx();
    if (st.fire) ignite(true);
  }
  function setLive(on) {
    if (!bus || bus.live === on) return;
    bus.live = on;
    if (on) bus.out.connect(bus.input); else bus.out.disconnect();
  }
  setInterval(() => { if (!bus) return; if (st.fire) lastSound = performance.now(); else if (performance.now() - lastSound > 9000) { setLive(false); stopOps(); } }, 1000);
  function startOps() {                                 // генераторы — только пока огонь (или ещё звучит хвост)
    if (ops || !actx) return;
    const ctx = actx, g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const o = fl.map((f) => { const osc = ctx.createOscillator(); osc.frequency.value = freqOf(f); const vg = g(0), pn = ctx.createStereoPanner(); osc.connect(vg).connect(pn).connect(bus.sum); osc.start(); return { osc, vg, pn }; });
    const ab = g(0), bc = g(0), ca = g(0), dl = ctx.createDelay(0.1);
    dl.delayTime.value = 0.011;
    o[0].osc.connect(ab).connect(o[1].osc.frequency); o[1].osc.connect(bc).connect(o[2].osc.frequency);
    o[2].osc.connect(dl); dl.connect(ca).connect(o[0].osc.frequency);
    ops = { o, ab, bc, ca, dl };
    update(true);
  }
  function stopOps() { if (!ops) return; for (const v of ops.o) { try { v.osc.stop(); } catch (e) {} v.pn.disconnect(); } ops.ab.disconnect(); ops.bc.disconnect(); ops.ca.disconnect(); ops.dl.disconnect(); ops = null; }
  function update(fast) {                               // частоты (с кипением), индексы FM, громкости
    if (!ops || !actx) return;
    const t = actx.currentTime, tc = fast === true ? 0.02 : 0.08;
    fl.forEach((f, i) => {
      const v = ops.o[i], fr = freqOf(f) * 2 ** (f.wob / 1200);
      v.osc.frequency.setTargetAtTime(fr, t, tc);
      v.vg.gain.setTargetAtTime(f.lvl * 0.12, t, 0.05);
      v.pn.pan.setTargetAtTime([-0.6, 0, 0.6][i] * fx.spread, t, 0.05);
    });
    ops.ab.gain.setTargetAtTime(idxOf(coil[0]) * freqOf(fl[1]), t, tc);
    ops.bc.gain.setTargetAtTime(idxOf(coil[1]) * freqOf(fl[2]), t, tc);
    ops.ca.gain.setTargetAtTime(st.ring ? idxOf(st.ringCoil) * freqOf(fl[0]) * 0.8 : 0, t, tc);
    bus.fireG.gain.setTargetAtTime(st.fire ? 0.25 + 0.75 * st.heat : 0, t, st.fire ? 0.15 : 0.8);
  }
  function shaperCurve(k) {                             // athanor: мягкий перегруз tanh, громкость выровнена
    const n = 1024, c = new Float32Array(n), d = 1 + 9 * k * k;
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * d) / Math.tanh(d); }
    return c;
  }
  function applyFx() {
    if (!bus) return;
    const t = actx.currentTime;
    if (Math.abs(bus.drive - fx.athanor) > 0.01) { bus.sh.curve = shaperCurve(fx.athanor); bus.drive = fx.athanor; }
    bus.hallSend.gain.setTargetAtTime(fx.hall * fx.hall * 1.5, t, 0.05);
    for (const l of bus.hall.lines) l.g.gain.setTargetAtTime(10 ** ((-3 * l.len) / (1.5 + fx.hall * 5)), t, 0.05);
    update();
  }
  function ignite(on) { st.fire = on; if (on) { startOps(); setLive(true); lastSound = performance.now(); } update(); }
  let drops = [], dropsN = 0, dropAt = 0;
  function plink(i, a) {                                // капля упала в колбу: её голос вспыхивает и тихий стеклянный «плинк» на октаву выше
    if (!ops || !actx) return;
    const t = actx.currentTime, f = fl[i], v = ops.o[i].vg.gain, base = f.lvl * 0.12;
    v.cancelScheduledValues(t); v.setValueAtTime(base, t); v.linearRampToValueAtTime(base * (1 + 1.4 * a), t + 0.004); v.setTargetAtTime(base, t + 0.006, 0.18);
    const o = actx.createOscillator(), e = actx.createGain();
    o.frequency.value = Math.min(8000, freqOf(f) * 4); e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(0.03 * a, t + 0.002); e.gain.exponentialRampToValueAtTime(0.0004, t + 0.5); e.gain.linearRampToValueAtTime(0, t + 0.52);
    o.connect(e).connect(bus.pre); o.start(t); o.stop(t + 0.55);
  }

  // ---------- жизнь: перегонка, капли, кипение ----------
  let flowVis = [0, 0, 0], lastT = 0;
  function tick(now, dt) {
    const d = Math.min(0.1, dt || 0.016);
    if (st.fire) {
      const rate = 0.006 + 0.03 * st.heat;              // доля уровня в секунду
      const gush = (k) => 0.15 + 1.7 * Math.max(0, Math.sin(now * [0.00021, 0.00034, 0.00055][k] + k * 2.1)) ** 2;   // перегонка идёт толчками, у каждой трубки свой период (30, 18, 11 с) — уровни бродят без конца
      const move = (a, b, k, kk = 1) => { const q = Math.min(rate * d * gush(k) * kk, fl[a].L - LMIN, LMAX - fl[b].L); if (q > 0) { fl[a].L -= q; fl[b].L += q; flowVis[k] = Math.min(1, flowVis[k] + q * 60); for (let c = 0; c < 3; c++) fl[b].mix[c] += (fl[a].mix[c] - fl[b].mix[c]) * q * 3; } };
      move(0, 1, 0); move(1, 2, 1); move(2, 0, 2, st.ring ? 1 : 0.5);   // без кольца из C в A возвращается конденсат — тише, без FM
      if (now > dropAt) {                               // капли из змеевика B→C (и C→A, если кольцо): чаще с жаром, с витками — реже, но крупнее
        dropAt = now + (1000 / (0.6 + 4.5 * st.heat)) * (0.4 + 1.2 * Math.random()) * (1 + coil[1] * 0.12);
        const to = st.ring && Math.random() < 0.4 ? 0 : 2;
        drops.push({ to, t0: now, dur: 380 });
      }
      for (const f of fl) f.wob = fx.bulla * st.heat * 14 * (Math.sin(now * 0.0031 * (1 + f.i * 0.37) + f.i) + 0.6 * Math.sin(now * 0.0117 * (1 + f.i * 0.21)));   // кипение: высота дрожит, в центах
    } else for (const f of fl) f.wob *= 0.95;
    for (let k = 0; k < 3; k++) flowVis[k] *= Math.exp(-d / 0.6);
    for (let j = drops.length - 1; j >= 0; j--) { const q = drops[j]; if (now - q.t0 >= q.dur) { drops.splice(j, 1); dropsN++; plink(q.to, 0.35 + 0.5 * st.heat); splash.push({ i: q.to, t: now }); } }
    if (splash.length > 12) splash.splice(0, splash.length - 12);
    if (now - lastT > 60) { lastT = now; update(); }
    for (const t of touches.values()) if (t.kind === 'flask' && !t.moved && !t.sheet && now - t.t0 > T.HOLD_MS) { t.sheet = true; flaskSheet(fl[t.i]); }
  }
  const splash = [];
  const sounding = () => st.fire;

  // ---------- касания ----------
  const touches = new Map();
  function down(f) {
    const G = geo(), now = performance.now();
    if (Math.abs(f.x - G.cx) < G.Ws * 0.42 && f.y > G.furn + 2 && f.y < G.bot + 6) { touches.set(f.id, { kind: 'fire', y0: f.y, h0: st.heat, t0: now, moved: false }); return; }
    const i = G.F.findIndex((p) => Math.hypot(f.x - p.x, f.y - p.y) < G.r * 1.15);
    if (i >= 0) { touches.set(f.id, { kind: 'flask', i, y0: f.y, L0: fl[i].L, t0: now, moved: false }); return; }
    const P = tubes(G), k = P.findIndex((p) => nearPoly(p, f.x, f.y) < 16);
    if (k >= 0) { touches.set(f.id, { kind: 'tube', k, t0: now }); return; }
    touches.set(f.id, { kind: 'none' });
  }
  function move(f) {
    const t = touches.get(f.id);
    if (!t || t.sheet) return;
    if (t.kind === 'fire') {
      if (Math.abs(f.y - t.y0) > 8) t.moved = true;
      if (t.moved) { st.heat = clamp(t.h0 + (t.y0 - f.y) / 140); if (!st.fire) ignite(true); else update(); }
    } else if (t.kind === 'flask') {
      if (Math.abs(f.y - t.y0) > 8) t.moved = true;
      if (t.moved) { fl[t.i].L = clamp(t.L0 + (t.y0 - f.y) / (geo().r * 2), LMIN, LMAX); update(true); }
    }
  }
  function up(f) {
    const t = touches.get(f.id);
    touches.delete(f.id);
    if (!t || t.sheet) return;
    const quick = performance.now() - (t.t0 || 0) < 300;
    if (t.kind === 'fire' && !t.moved && quick) ignite(!st.fire);
    else if (t.kind === 'tube' && quick) {
      if (t.k === 2) st.ring = !st.ring;                // кольцо: замкнуть / разомкнуть
      else coil[t.k] = (coil[t.k] + 1) % (CMAX + 1);    // ещё виток
      update();
    }
  }
  function flaskSheet(f) {
    T.openSheet({
      title: ['cucurbita I', 'cucurbita II', 'cucurbita III'][f.i], hint: 'flask — tap outside to close',
      rows: [{ key: 'L', label: 'liquor' }, { key: 'lvl', label: 'level' }],
      lfo: { id: `lab-f${f.i}`, keys: ['L', 'lvl'], shapes: 'random' },
      get: (k) => (k === 'L' ? (f.L - LMIN) / (LMAX - LMIN) : f[k]),
      set: (k, v) => { if (k === 'L') f.L = LMIN + v * (LMAX - LMIN); else f[k] = v; update(); },
      text: (k) => (k === 'L' ? `${noteName(semiOf(f))} · ${Math.round(freqOf(f))} Hz` : `${Math.round(f.lvl * 100)}%`),
    });
  }

  // ---------- рисование ----------
  const ink = (a) => `rgba(${INK},${a})`;
  let wallC = null, wallKey = '';
  function wall(G) {                                    // атанор: кладка, топка, решётка; полки и пол — штриховкой
    const key = `${G.W}x${G.H}x${T.DPR}|${G.furn}|${G.r}`;
    if (wallC && key === wallKey) return wallC;
    wallKey = key;
    wallC = document.createElement('canvas'); wallC.width = Math.round(G.W * T.DPR); wallC.height = Math.round(G.H * T.DPR);
    const x = wallC.getContext('2d'); x.setTransform(T.DPR, 0, 0, T.DPR, 0, 0);
    x.fillStyle = BGC; x.fillRect(0, 0, G.W, G.H);
    const w = G.Ws * 0.84, x0 = G.cx - w / 2, y0 = G.furn, h = G.bot - y0 - 6;
    x.lineWidth = 1; x.strokeStyle = ink(0.75); x.strokeRect(x0, y0, w, h);
    x.strokeStyle = ink(0.18); x.beginPath();
    for (let r = 0; r * 12 < h; r++) { const y = y0 + r * 12; x.moveTo(x0, y); x.lineTo(x0 + w, y); for (let c = (r % 2) * 12; c < w; c += 24) { x.moveTo(x0 + c, y); x.lineTo(x0 + c, Math.min(y0 + h, y + 12)); } }
    x.stroke();
    x.fillStyle = BGC; x.strokeStyle = ink(0.7); x.beginPath(); x.rect(x0 + w * 0.15, y0 + 14, w * 0.7, h - 22); x.fill(); x.stroke();   // топка
    x.strokeStyle = ink(0.4); x.beginPath(); for (let k = 1; k < 8; k++) { const px = x0 + w * 0.15 + (w * 0.7 * k) / 8; x.moveTo(px, y0 + h - 14); x.lineTo(px, y0 + h - 8); } x.stroke();
    x.strokeStyle = ink(0.6); x.beginPath(); x.moveTo(x0 - 8, y0); x.lineTo(x0 + w + 8, y0); x.stroke();
    x.strokeStyle = ink(0.08); x.beginPath(); for (let y = G.bot; y < G.H; y += 5) { x.moveTo(0, y); x.lineTo(G.W, y); } x.stroke();
    for (const p of G.F) { x.strokeStyle = ink(0.45); x.beginPath(); x.moveTo(p.x - G.r * 0.6, p.y + G.r + 4); x.lineTo(p.x - G.r * 0.75, G.furn); x.moveTo(p.x + G.r * 0.6, p.y + G.r + 4); x.lineTo(p.x + G.r * 0.75, G.furn); x.moveTo(p.x - G.r * 0.8, p.y + G.r + 4); x.lineTo(p.x + G.r * 0.8, p.y + G.r + 4); x.stroke(); }   // треноги
    return wallC;
  }
  function drawFire(c, G, now) {                        // пламя: высота — жар; погашен — угли
    const w = G.Ws * 0.84 * 0.7, x0 = G.cx - w / 2, yb = G.bot - 14, n = 9;
    if (!st.fire) { c.fillStyle = rgba(FIRE, 0.35); for (let k = 0; k < n; k++) c.fillRect(x0 + ((k + 0.5) * w) / n - 3, yb - 3, 6, 2); return; }
    const hmax = (G.bot - G.furn - 30) + 34 * st.heat;
    T.glowAt(G.cx, yb - hmax * 0.3, w * 0.3, 0.12 + 0.18 * st.heat);
    for (let k = 0; k < n; k++) {
      const px = x0 + ((k + 0.5) * w) / n, hh = hmax * (0.45 + 0.55 * st.heat) * (0.6 + 0.4 * Math.sin(now * 0.011 + k * 1.7)) * (k % 2 ? 0.75 : 1), ww = w / n * 0.42;
      c.fillStyle = rgba(FIRE, 0.75); c.beginPath(); c.moveTo(px - ww, yb); c.quadraticCurveTo(px - ww * 0.4, yb - hh * 0.6, px, yb - hh); c.quadraticCurveTo(px + ww * 0.4, yb - hh * 0.6, px + ww, yb); c.fill();
    }
  }
  function drawTube(c, G, P, k, now) {                  // змеевик: витки — петли посередине; течёт — цветные капли бегут
    const n = k === 2 ? (st.ring ? st.ringCoil : 0) : coil[k], open = k === 2 && !st.ring;
    c.strokeStyle = open ? ink(0.25) : rgba(BRASS, 0.85); c.lineWidth = open ? 1 : 1.6; if (open) c.setLineDash([3, 4]);
    c.beginPath(); P.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.stroke(); c.setLineDash([]);
    if (n > 0) {
      const m = along(P, 0.5), pr = P[Math.max(0, m.i - 1)], nx = P[m.i], L = Math.hypot(nx.x - pr.x, nx.y - pr.y) || 1, ux = (nx.x - pr.x) / L, uy = (nx.y - pr.y) / L, step = 7;
      c.strokeStyle = rgba(BRASS, 0.9); c.lineWidth = 1.3;
      for (let j = 0; j < n; j++) { const off = (j - (n - 1) / 2) * step, cx = m.x + ux * off, cy = m.y + uy * off; c.beginPath(); c.ellipse(cx, cy - uy * 0 , 4.5, 7, Math.atan2(uy, ux), 0, TAU); c.stroke(); }
    }
    c.lineWidth = 1;
    const fv = flowVis[k];
    if (fv > 0.02 && !open) { const src = fl[k === 2 ? 2 : k].mix; for (let j = 0; j < 3; j++) { const p = along(P, ((now * 0.00025 + j / 3) % 1)); c.fillStyle = rgba(src, 0.9 * fv); c.beginPath(); c.arc(p.x, p.y, 1.8, 0, TAU); c.fill(); } }
  }
  function drawFlask(c, G, f, now, held) {              // колба: шар с горлом; жидкость цветом смеси, поверхность дрожит от FM, пузыри — кипение
    const p = G.F[f.i], r = G.r, surfY = p.y + r - 2 * r * f.L, inIdx = f.i === 1 ? idxOf(coil[0]) : f.i === 2 ? idxOf(coil[1]) : st.ring ? idxOf(st.ringCoil) : 0;
    c.save(); c.beginPath(); c.arc(p.x, p.y, r - 1.5, 0, TAU); c.clip();
    c.fillStyle = rgba(f.mix, 0.32); c.beginPath(); c.moveTo(p.x - r, p.y + r);
    for (let k = 0; k <= 30; k++) { const u = k / 30, px = p.x - r + 2 * r * u, amp = (st.fire ? 1.2 + 1.8 * Math.min(1, inIdx / 2) : 0.3); c.lineTo(px, surfY + Math.sin(u * TAU * (1 + inIdx) + now * 0.008) * amp); }
    c.lineTo(p.x + r, p.y + r); c.closePath(); c.fill();
    c.strokeStyle = rgba(f.mix, 0.8); c.stroke();
    if (st.fire) { c.strokeStyle = ink(0.5); const nb = Math.round(2 + 6 * st.heat * fx.bulla); for (let k = 0; k < nb; k++) { const ph = ((now * 0.0004 * (1 + k * 0.3) + k * 0.37) % 1), bx = p.x + Math.sin(k * 2.3 + f.i) * r * 0.5, by = p.y + r - ph * (p.y + r - surfY); c.beginPath(); c.arc(bx, by, 1.2 + k % 3 * 0.6, 0, TAU); c.stroke(); } }
    c.restore();
    c.strokeStyle = ink(0.85); c.lineWidth = 1.1; c.beginPath(); c.arc(p.x, p.y, r, -Math.PI / 2 + 0.28, -Math.PI / 2 - 0.28 + TAU); c.stroke();
    const nx = r * 0.27; c.beginPath(); c.moveTo(p.x - nx, p.y - r * 0.96); c.lineTo(p.x - nx, p.y - r * 1.35); c.moveTo(p.x + nx, p.y - r * 0.96); c.lineTo(p.x + nx, p.y - r * 1.35); c.stroke(); c.lineWidth = 1;
    c.strokeStyle = ink(0.25); c.beginPath(); c.arc(p.x - r * 0.25, p.y, r * 0.6, Math.PI * 1.08, Math.PI * 1.4); c.stroke();   // блик
    for (const s of splash) { if (s.i !== f.i) continue; const k = (now - s.t) / 500; if (k > 1) continue; c.strokeStyle = rgba(f.mix, 0.7 * (1 - k)); c.beginPath(); c.ellipse(p.x, surfY, 3 + r * 0.5 * k, 1 + 2 * k, 0, 0, TAU); c.stroke(); }
    if (held) T.mapText(`${noteName(semiOf(f))} · ${Math.round(freqOf(f))} Hz`, p.x, p.y - r * 1.35 - 14, 13, 0.9, 'center');
  }
  function drawLamp(c, G, now) {                        // лампа Гермеса — карта
    const L = G.lamp;
    c.strokeStyle = rgba(BRASS, 0.85); c.lineWidth = 1; c.beginPath(); c.moveTo(L.x - 16, L.y + 6); c.quadraticCurveTo(L.x, L.y + 16, L.x + 16, L.y + 6); c.lineTo(L.x + 24, L.y + 1); c.moveTo(L.x - 16, L.y + 6); c.quadraticCurveTo(L.x - 22, L.y, L.x - 12, L.y + 1); c.stroke();
    c.beginPath(); c.ellipse(L.x, L.y + 4, 12, 3, 0, 0, TAU); c.stroke();
    T.glowAt(L.x + 26, L.y - 8, 16, 0.25);
    c.fillStyle = rgba(FIRE, 0.9); c.beginPath(); c.moveTo(L.x + 23, L.y); c.quadraticCurveTo(L.x + 20 + Math.sin(now * 0.01) * 1.5, L.y - 9, L.x + 26, L.y - 16); c.quadraticCurveTo(L.x + 30, L.y - 7, L.x + 27, L.y); c.fill();
  }
  function draw(now) {
    const c = T.g, G = geo(), P = tubes(G);
    c.drawImage(wall(G), 0, 0, T.W, T.H);
    drawFire(c, G, now);
    P.forEach((p, k) => drawTube(c, G, p, k, now));
    for (const q of drops) {                            // капля: из конца змеевика в колбу
      const P2 = q.to === 2 ? P[1] : P[2], end = P2[P2.length - 1], tgt = G.F[q.to], k = (now - q.t0) / q.dur;
      const y = end.y + (tgt.y + G.r - 2 * G.r * fl[q.to].L - end.y) * k * k;
      c.fillStyle = rgba(fl[q.to === 2 ? 1 : 2].mix, 0.95); c.beginPath(); c.ellipse(end.x, y, 1.6, 2.6, 0, 0, TAU); c.fill();
    }
    const held = new Set([...touches.values()].filter((t) => t.kind === 'flask' && t.moved).map((t) => t.i));
    for (const f of fl) drawFlask(c, G, f, now, held.has(f.i));
    const ft = [...touches.values()].find((t) => t.kind === 'fire' && t.moved);
    if (ft) T.mapText(`ignis ${Math.round(st.heat * 100)}%`, G.cx, G.furn - 14, 13, 0.9, 'center');
    drawLamp(c, G, now);
  }

  // ---------- мир ----------
  const deg = (d) => (d * Math.PI) / 180;
  const fxw = {
    sectors: [{ key: 'athanor', label: 'athanor', ang: deg(170) }, { key: 'bulla', label: 'bulla', ang: deg(140) }, { key: 'spread', label: 'spread', ang: deg(110) }, { key: 'hall', label: 'hall', ang: deg(80) }],
    get: (k) => fx[k], set: (k, v) => { fx[k] = v; applyFx(); }, text: (k) => `${Math.round(fx[k] * 100)}%`,
    lfo: { keys: ['athanor', 'bulla', 'spread', 'hall'], shapes: 'random' },
    arc: () => fx.hall, save: () => ({ ...fx }), load: (o) => { Object.assign(fx, o); applyFx(); },
  };
  function dice() {
    const R = Math.random;
    fl.forEach((f) => { f.L = LMIN + R() * (LMAX - LMIN); f.mix = COL[f.i].slice(); });
    coil[0] = Math.floor(R() * 4); coil[1] = Math.floor(R() * 4); st.ring = R() < 0.35; st.ringCoil = 1 + Math.floor(R() * 2); st.heat = 0.3 + R() * 0.5;
    ignite(true);
  }
  const lab = {
    n: 'III', title: 'Laboratorium', sub: 'alembicus · FM', theme: { ink: INK, bg: BGC, paper: PAPER },
    corner: { hit: (f) => { const L = geo().lamp; return Math.hypot(f.x - L.x, f.y - L.y) < L.r; }, draw: () => {} },   // лампа Гермеса — карта
    fx: fxw,
    legend: [['tap', 'tap the fire', 'light it / put it out'], ['up', 'drag the fire up or down', 'heat: louder, brighter, faster flow and drops'],
      ['up', 'drag inside a flask', 'pour or draw off: more liquor — lower'], ['tap', 'tap a coil', 'one more turn — deeper FM (after six — straight again)'],
      ['tap', 'tap the ring below', 'close C → A: feedback, chaos'], ['hold', 'hold a flask', 'its sheet: liquor, level'], ['tap', 'tap the lamp', 'map of worlds']],
    build, tick, draw, down, move, up, dice,
    clear() { ignite(false); },
    snapshot: () => JSON.stringify({ L: fl.map((f) => f.L), lv: fl.map((f) => f.lvl), coil, st, fx }),
    restore(js) {
      const s = JSON.parse(js);
      if (!s.L) return;                                 // снимок старого Laboratorium — не трогаем
      s.L.forEach((v, i) => { fl[i].L = v; fl[i].lvl = s.lv[i]; fl[i].mix = COL[i].slice(); });
      coil[0] = s.coil[0]; coil[1] = s.coil[1]; Object.assign(st, s.st); Object.assign(fx, s.fx); applyFx(); ignite(st.fire);
    },
    sounding,
  };
  T.registerWorld(3, lab);
  window.t2d.lab = { fl, coil, st, fx, geo, tubes: () => tubes(geo()), freq: freqOf, setFx: (k, v) => fxw.set(k, v), get drops() { return dropsN; }, get ops() { return !!ops; } };
})();
