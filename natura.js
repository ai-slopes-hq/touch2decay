// Natura — мир IV: древо жизни, туча, цветы; карта Таро чёрным по сепии. Эскиз картинки, без звука.
// Шаги — ветви кроны веером слева направо (2–16). Нота — длина ветви: длиннее — выше, силуэт кроны — контур мелодии;
// листья на её конце; голый сучок — пауза. Голоса — цветы у корней (ромашка — синус, тюльпан — меандр, звёздочка — треугольник;
// крупнее — громче), раскрываются на каждом шаге. Одна туча поливает древо и цветы. FX = пейзаж: туман на горах — reverb,
// облака вокруг тучи появляются с delay, дождь гуще — time, рябь на реке — chorus, камыши у берега — cutoff, раскрытие цветов — огибающая.
// Солнце — четверть в левом верхнем углу (угол к центру карты), тап — карта; в левом нижнем углу надгробие (пока ни к чему не ведёт).
// Спека: docs/superpowers/specs/2026-10-20-natura-design.md
(() => {
  'use strict';
  const T = window.T2D;
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const TAU = Math.PI * 2;
  const INK = '38,26,16', PAPER = '226,211,174';
  const ink = (a) => `rgba(${INK},${a})`;
  const pap = (a) => `rgba(${PAPER},${a})`;

  // ---------- состояние (демо) ----------
  const fx = { reverb: 0.4, delay: 0.45, time: 0.5, chorus: 0.35, cutoff: 0.62, env: 0.5 };
  const bpm = 96;
  // узор: шаги снизу вверх; нота — ступень лада (0–14), null — пауза
  const steps = { len: 16, notes: [0, 4, null, 7, 5, null, 9, 4, 2, null, 7, 11, 9, null, 5, 3] };
  const voices = [{ wave: 0, level: 0.8 }, { wave: 1, level: 0.5 }, { wave: 2, level: 0.65 }];

  // ---------- геометрия ----------
  function geo() {
    const W = T.W, H = T.H, top = T.topY + 26, bot = H - T.safeBot - 40, h = bot - top;
    const hor = top + 0.6 * h, yG = top + 0.8 * h, yC = top + 0.47 * h, R0 = Math.min(W * 0.12, 0.07 * h), R1 = Math.min(W * 0.44, 0.32 * h);
    const sun = { x: 13, y: T.topY + 2, r: Math.min(70, W * 0.18) };   // неподвижно: четверть в левом верхнем углу (к центру карты)
    return { W, H, top, bot, h, hor, yG, yC, R0, R1, cx: W / 2, sun, cloudY: top + 0.06 * h,
      river: [hor + 0.035 * h, hor + 0.085 * h] };
  }
  // ветвь шага i: из макушки ствола веером слева направо; длина — нота
  const ANG0 = Math.PI - 0.1, ANG1 = TAU + 0.1;
  function branchOf(G, i) {
    const a = ANG0 + ((i + 0.5) / 16) * (ANG1 - ANG0), nt = steps.notes[i];
    const r = nt == null ? G.R0 * 0.55 : G.R0 + (nt / 14) * (G.R1 - G.R0);
    const sx = G.cx + Math.cos(a) * 4, sy = G.yC + Math.sin(a) * 4;
    return { a, nt, r, sx, sy, ex: G.cx + Math.cos(a) * r, ey: G.yC + Math.sin(a) * r };
  }

  // ---------- кеш: бумага (под небом); земля и рамка (поверх неба) ----------
  let skyC = null, landC = null, key = '';
  function canvas() { const c = document.createElement('canvas'); c.width = Math.round(T.W * T.DPR); c.height = Math.round(T.H * T.DPR); const x = c.getContext('2d'); x.setTransform(T.DPR, 0, 0, T.DPR, 0, 0); return [c, x]; }
  function layers(G) {
    const k = `${G.W}x${G.H}x${T.DPR}|${G.top}|${G.bot}`;
    if (k === key) return;
    key = k;
    let x;
    [skyC, x] = canvas();
    x.fillStyle = `rgb(${PAPER})`; x.fillRect(0, 0, G.W, G.H);
    let seed = 11;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    x.fillStyle = ink(0.05);                       // крап старой бумаги
    for (let i = 0; i < 260; i++) { x.beginPath(); x.arc(rnd() * G.W, rnd() * G.H, rnd() * 1.1, 0, TAU); x.fill(); }
    [landC, x] = canvas();
    drawLand(x, G, rnd);
  }

  const line = (x, a, w) => { x.strokeStyle = ink(a); x.lineWidth = w; };
  function tuft(x, X, Y, s = 1) {                  // пучок травы, как на картах Марсель
    x.beginPath();
    for (const d of [-2, -1, 0, 1, 2]) { x.moveTo(X + d * 0.7, Y); x.quadraticCurveTo(X + d * 1.2 * s, Y - 4 * s, X + d * 3.4 * s, Y - (7 - Math.abs(d) * 1.4) * s); }
    x.stroke();
  }
  function hatchIn(x, clip, ang, step, a, w = 0.7) {
    x.save(); x.beginPath(); clip(); x.clip();
    line(x, a, w); x.beginPath();
    const L = Math.hypot(T.W, T.H), c = Math.cos(ang), s = Math.sin(ang);
    for (let d = -L; d < L; d += step) { const mx = T.W / 2 - s * d, my = T.H / 2 + c * d; x.moveTo(mx - c * L, my - s * L); x.lineTo(mx + c * L, my + s * L); }
    x.stroke(); x.restore();
  }

  // горы, как на картах Таро: дальний хребет бледнее, ближний — со штриховкой теней и снежными шапками;
  // заливка бумагой закрывает небо ниже гор. Луг с травой, рамка с украшениями
  function ridge(x, G, base, peaks, hMin, hMax, a, seed) {
    let sd = seed;
    const r = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
    const pts = [[0, base]];
    for (let k = 0; k < peaks; k++) {
      const px = ((k + 0.5) / peaks) * G.W + (r() - 0.5) * 24, ph = hMin + r() * (hMax - hMin);
      pts.push([px - ph * 0.75, base - ph * 0.15], [px, base - ph], [px + ph * 0.8, base - ph * 0.1]);
    }
    pts.push([G.W, base]);
    x.fillStyle = `rgb(${PAPER})`;
    x.beginPath(); x.moveTo(0, G.H); for (const [X, Y] of pts) x.lineTo(X, Y); x.lineTo(G.W, G.H); x.closePath(); x.fill();
    line(x, a, 1.2);
    x.beginPath(); pts.forEach(([X, Y], i) => (i ? x.lineTo(X, Y) : x.moveTo(X, Y))); x.stroke();
    for (let k = 1; k + 2 < pts.length; k += 3) {      // тень на правом склоне и снег на вершине
      const [ax, ay] = pts[k + 1], [bx, by] = pts[k + 2], ph = base - ay;
      hatchIn(x, () => { x.moveTo(ax, ay); x.lineTo(bx, by); x.lineTo(bx, base); x.lineTo(ax, base); x.closePath(); }, 1.1, 3.2, a * 0.5);
      line(x, a * 0.8, 0.9);
      x.beginPath(); x.moveTo(ax - ph * 0.2, ay + ph * 0.22); x.lineTo(ax - ph * 0.08, ay + ph * 0.16); x.lineTo(ax, ay + ph * 0.25); x.lineTo(ax + ph * 0.1, ay + ph * 0.17); x.lineTo(ax + ph * 0.2, ay + ph * 0.24); x.stroke();
    }
  }
  function drawLand(x, G, rnd) {
    const { W } = G;
    x.save(); x.beginPath(); x.rect(13, 13, W - 26, G.H - T.safeBot - 26); x.clip();
    ridge(x, G, G.hor, 4, 0.07 * G.h, 0.12 * G.h, 0.45, 5);
    ridge(x, G, G.river[0] - 2, 6, 0.03 * G.h, 0.055 * G.h, 0.8, 9);
    // птицы над горами
    line(x, 0.6, 1);
    for (const [bx, by, s] of [[0.84, 0.47, 1], [0.9, 0.44, 0.8], [0.14, 0.5, 0.7]]) {
      const X = W * bx, Y = G.top + G.h * by;
      x.beginPath(); x.moveTo(X - 6 * s, Y); x.quadraticCurveTo(X - 3 * s, Y - 4 * s, X, Y); x.quadraticCurveTo(X + 3 * s, Y - 4 * s, X + 6 * s, Y); x.stroke();
    }
    // луг: пучки травы, земля под древом
    line(x, 0.55, 0.9);
    for (let i = 0; i < 14; i++) {
      const X = 20 + rnd() * (W - 40), Y = G.river[1] + 12 + rnd() * (G.bot - G.river[1] - 24);
      if (X < 90 && Y > G.bot - 90) continue;      // у надгробия — пусто
      tuft(x, X, Y, 0.8 + 0.4 * ((Y - G.hor) / G.h));
    }
    line(x, 0.85, 1.4);
    x.beginPath(); x.moveTo(W * 0.24, G.yG + 6); x.quadraticCurveTo(W * 0.5, G.yG - 8, W * 0.76, G.yG + 6); x.stroke();
    x.restore();
    drawCard(x, G);
  }

  // рамка карты Таро: двойная, сверху номер, снизу плашка с именем
  function drawCard(x, G) {
    const { W, H } = G, b = H - T.safeBot;
    line(x, 0.9, 1.8); x.strokeRect(7, 7, W - 14, b - 14);
    line(x, 0.6, 0.9); x.strokeRect(12.5, 12.5, W - 25, b - 25);
    x.fillStyle = ink(0.5);                           // точечный орнамент между линиями рамки
    for (let X = 16; X < W - 12; X += 9) { x.beginPath(); x.arc(X, 9.8, 0.8, 0, TAU); x.arc(X, b - 9.8, 0.8, 0, TAU); x.fill(); }
    for (let Y = 16; Y < b - 12; Y += 9) { x.beginPath(); x.arc(9.8, Y, 0.8, 0, TAU); x.arc(W - 9.8, Y, 0.8, 0, TAU); x.fill(); }
    const fleur = (X, Y, sx) => {                      // завиток-лист в углу рамки
      line(x, 0.7, 1); x.beginPath();
      x.moveTo(X, Y); x.bezierCurveTo(X + sx * 16, Y - 2, X + sx * 20, Y - 16, X + sx * 8, Y - 18);
      x.quadraticCurveTo(X + sx * 2, Y - 14, X + sx * 8, Y - 10); x.stroke();
      leafPath(x, X + sx * 4, Y - 1, sx * 1.1, 0.7);
    };
    fleur(16, b - 36, 1); fleur(W - 16, b - 36, -1);
    const ny = G.top - 12;
    x.fillStyle = `rgb(${PAPER})`; x.fillRect(W / 2 - 22, ny - 10, 44, 20);
    line(x, 0.85, 1.1); x.strokeRect(W / 2 - 22 + 0.5, ny - 10 + 0.5, 44, 20);
    x.font = `16px ${T.MAP}`; x.fillStyle = ink(0.95); x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('IV', W / 2, ny + 1);
    const by = b - 32;
    x.fillStyle = `rgb(${PAPER})`; x.fillRect(12.5, by, W - 25, 19.5);
    line(x, 0.85, 1.1); x.beginPath(); x.moveTo(12.5, by + 0.5); x.lineTo(W - 12.5, by + 0.5); x.stroke();
    x.font = `15px ${T.MAP}`; x.fillStyle = ink(0.95);
    x.fillText('N A T V R A', W / 2 + 24, by + 11);   // чуть вправо — слева надгробие
  }

  function leafPath(x, X, Y, ang, s) { x.save(); x.translate(X, Y); x.rotate(ang); x.beginPath(); x.moveTo(0, 0); x.quadraticCurveTo(4 * s, -6 * s, 0, -12 * s); x.quadraticCurveTo(-4 * s, -6 * s, 0, 0); x.stroke(); x.restore(); }

  // ---------- живое ----------
  // солнце Таро: четверть диска из левого верхнего угла — угла к центру карты (общая функция хоста)
  function drawSun(c, G, now) { T.quarterSun(c, G.sun.x, G.sun.y, G.sun.r, 1, now, INK, pap(1)); }
  function drawFog(c, G, now) {                      // туман — reverb: дальние холмы тонут
    const r = fx.reverb;
    if (r < 0.03) return;
    c.fillStyle = pap(0.8 * r); c.fillRect(13, G.hor - 0.13 * G.h, G.W - 26, G.river[0] - G.hor + 0.13 * G.h - 2);
    c.strokeStyle = ink(0.3 * r); c.lineWidth = 0.9;
    const n = Math.round(2 + r * 5);
    c.setLineDash([10 + 8 * r, 6]);
    for (let i = 0; i < n; i++) {
      const yy = G.hor - 0.1 * G.h + i * 8, ph = now * 0.0003 * (i % 2 ? 1 : -1) + i;
      c.beginPath();
      for (let X = 16; X < G.W - 16; X += 6) { const Y = yy + Math.sin(X * 0.04 + ph) * 2; X === 16 ? c.moveTo(X, Y) : c.lineTo(X, Y); }
      c.stroke();
    }
    c.setLineDash([]);
  }
  function drawRiver(c, G, now) {                    // река — волнистые линии; рябь сильнее с chorus
    const [y0, y1] = G.river, ch = fx.chorus;
    c.fillStyle = pap(1); c.fillRect(13, y0 - 3, G.W - 26, y1 - y0 + 6);
    c.strokeStyle = ink(0.85); c.lineWidth = 1.3;
    for (const y of [y0, y1]) { c.beginPath(); c.moveTo(13, y); for (let X = 13; X < G.W - 13; X += 8) c.quadraticCurveTo(X + 4, y + (y === y0 ? -2 : 2), X + 8, y); c.stroke(); }
    const rows = 2 + Math.round(ch * 3), amp = 0.6 + ch * 2.6, ph = now * (0.0008 + ch * 0.003);
    c.strokeStyle = ink(0.5); c.lineWidth = 0.9;
    for (let k = 0; k < rows; k++) {
      const y = y0 + ((k + 1) * (y1 - y0)) / (rows + 1), off = (k * 37) % 23;
      c.beginPath();
      for (let X = 18 + off; X < G.W - 30; X += 30 + (k % 3) * 6) {
        c.moveTo(X, y);
        for (let q = 1; q <= 6; q++) c.lineTo(X + q * 3, y + Math.sin(q * 1.2 + ph + X * 0.05) * amp);
      }
      c.stroke();
    }
  }

  // камыши у ближнего берега — cutoff: открыт фильтр — камыш густой и высокий, закрыт — пара низких стеблей
  const REEDS = [0.08, 0.83, 0.3, 0.62, 0.17, 0.92, 0.4, 0.71, 0.24, 0.56, 0.12, 0.87, 0.35, 0.66, 0.77, 0.2];
  function drawReeds(c, G, now) {
    const k = fx.cutoff, n = 3 + Math.round(k * 13), hgt = 12 + k * 46, base = G.river[1] + 3;
    for (let i = 0; i < n; i++) {
      const X = 20 + REEDS[i] * (G.W - 40);
      if (Math.abs(X - G.W / 2) < 16) continue;    // у ствола — пусто
      const hh = hgt * (0.75 + 0.25 * Math.sin(i * 2.7)), sw = Math.sin(now * 0.0012 + i) * 2.5 * (hh / 50), tx = X + sw, ty = base - hh;
      c.strokeStyle = ink(0.85); c.lineWidth = 1;
      c.beginPath(); c.moveTo(X, base); c.quadraticCurveTo(X, base - hh * 0.5, tx, ty); c.stroke();
      c.beginPath(); c.moveTo(tx, ty); c.lineTo(tx + sw * 0.2, ty - 5); c.stroke();           // острый кончик
      c.fillStyle = ink(0.85); c.beginPath(); c.ellipse(tx - sw * 0.05, ty + 5, 1.8, 4.5, sw * 0.02, 0, TAU); c.fill();   // початок
      c.strokeStyle = ink(0.7); c.lineWidth = 0.9; c.beginPath();                            // листья-ленты
      for (const d of [-1, 1]) { c.moveTo(X, base); c.quadraticCurveTo(X + d * 3, base - hh * 0.45, X + d * 9 + sw * 0.6, base - hh * 0.7); }
      c.stroke();
    }
  }

  function leaf(c, X, Y, ang, s, a, fill = true) { // миндалевидный лист с жилкой
    c.save(); c.translate(X, Y); c.rotate(ang);
    c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(4.5 * s, -6 * s, 0, -13 * s); c.quadraticCurveTo(-4.5 * s, -6 * s, 0, 0);
    if (fill) { c.fillStyle = pap(1); c.fill(); }
    c.strokeStyle = ink(a); c.lineWidth = 1.1; c.stroke();
    c.lineWidth = 0.6; c.beginPath(); c.moveTo(0, -1); c.lineTo(0, -11 * s); c.stroke();
    c.restore();
  }

  // древо жизни: ствол с корой и корнями, крона веером; бледные дуги — октавы (где ступени 0, 7, 14)
  function drawTree(c, G, now) {
    const stepMs = 60000 / bpm / 4, cur = Math.floor(now / stepMs) % steps.len, k = Math.exp(-(now % stepMs) / 200);
    const x = G.cx, yb = G.yG, yt = G.yC;
    c.strokeStyle = ink(0.16); c.lineWidth = 0.8; c.setLineDash([2, 4]);
    for (const d of [0, 7, 14]) { c.beginPath(); c.arc(x, yt, G.R0 + (d / 14) * (G.R1 - G.R0), ANG0, ANG1); c.stroke(); }
    c.setLineDash([]);
    c.fillStyle = ink(0.9);
    c.beginPath(); c.moveTo(x - 8, yb); c.quadraticCurveTo(x - 4, (yb + yt) / 2, x - 3, yt + 4); c.lineTo(x + 3, yt + 4); c.quadraticCurveTo(x + 4, (yb + yt) / 2, x + 8, yb); c.closePath(); c.fill();
    c.strokeStyle = pap(0.7); c.lineWidth = 0.8; c.beginPath();
    for (let y = yt + 12; y < yb - 4; y += 9) { const w = 2 + 4 * ((y - yt) / (yb - yt)); c.moveTo(x - w * 0.6, y); c.lineTo(x + w * 0.4, y + 4); }
    c.stroke();
    c.strokeStyle = ink(0.9); c.lineWidth = 1.3; c.beginPath();      // корни
    for (const d of [-1, 1]) for (const q of [0.6, 1]) { c.moveTo(x + d * 4, yb - 2); c.quadraticCurveTo(x + d * 12 * q, yb + 2, x + d * 30 * q, yb + 8 * q); }
    c.stroke();
    c.lineCap = 'round';
    for (let i = 0; i < 16; i++) {
      const b = branchOf(G, i);
      if (i >= steps.len) { T.dot(x + Math.cos(b.a) * G.R0 * 0.4, yt + Math.sin(b.a) * G.R0 * 0.4, 1.1, 0.25); continue; }   // за длиной — почка
      const on = i === cur, kk = on ? k : 0;
      const mx = (b.sx + b.ex) / 2, my = (b.sy + b.ey) / 2 - 0.12 * b.r * Math.abs(Math.cos(b.a));   // ветвь чуть выгнута кверху
      c.strokeStyle = ink(0.9); c.lineWidth = b.nt == null ? 2 : 2.6 - 0.8 * (b.r / G.R1);
      c.beginPath(); c.moveTo(b.sx, b.sy); c.quadraticCurveTo(mx, my, b.ex, b.ey); c.stroke();
      if (b.nt == null) { if (on) T.ring(b.ex, b.ey, 4 + 6 * (1 - kk), 0.6 * kk + 0.2, 1); continue; }   // пауза — голый сучок
      const dir = b.a + Math.PI / 2, s = 0.95 + 0.35 * kk, al = 0.8 + 0.2 * kk;
      for (const q of [-0.6, 0, 0.6]) leaf(c, b.ex, b.ey, dir + q, s * (q ? 0.8 : 1), al);   // листья на конце
      if (on) T.ring(b.ex + Math.cos(b.a) * 8, b.ey + Math.sin(b.a) * 8, 8 + 10 * (1 - kk), 0.7 * kk + 0.15, 1.1);   // капля упала — круг
    }
    c.lineCap = 'butt';
    return { cur, k };
  }

  // одна туча над древом поливает его и цветы; дождь гуще с time; облака вокруг появляются с delay
  function cloud(c, X, Y, s, a) {
    const w = 64 * s, h = 16 * s;
    c.save(); c.translate(X, Y);
    c.beginPath(); c.moveTo(-w / 2, 0);
    let px = -w / 2;
    for (const k of [0.75, 1.15, 0.95, 0.7]) { const r = (w / 7) * k; c.arc(px + r, 0, r, Math.PI, 0); px += 2 * r * 0.78; }
    c.lineTo(-w / 2, 0); c.closePath();
    c.fillStyle = pap(1); c.fill(); c.strokeStyle = ink(a); c.lineWidth = 1.2; c.stroke();
    c.clip(); c.strokeStyle = ink(a * 0.45); c.lineWidth = 0.7; c.beginPath();
    for (let y = -1; y > -h * 0.7; y -= 2.6) { c.moveTo(-w / 2, y); c.lineTo(w / 2, y); }
    c.stroke(); c.restore();
  }
  function rain(c, X, Y, w, toY, a, now, dens) {    // косые штрихи, падают вечно; детерминированно по времени
    c.strokeStyle = ink(a); c.lineWidth = 0.8; c.beginPath();
    const n = Math.round((w / 7) * dens), fall = toY - Y, per = Math.max(2, Math.round(fall / 70));
    for (let i = 0; i < n; i++) for (let q = 0; q < per; q++) {
      const h = ((i * 7919 + q * 3301) % 1000) / 1000;
      const yy = Y + ((now * 0.3 + h * fall + (q * fall) / per) % fall), xx = X - w / 2 + (i + 0.5) * (w / n) - (yy - Y) * 0.05;
      c.moveTo(xx, yy); c.lineTo(xx - 0.8, yy + 8);
    }
    c.stroke();
  }
  const EXTRA = [[-0.33, 0.55, 0.55], [0.34, 0.25, 0.6], [-0.2, -0.45, 0.45], [0.22, -0.55, 0.5], [0.4, 0.75, 0.4]];
  function drawCloud(c, G, now) {
    const s = (G.W * 0.5) / 64, cy = G.cloudY;
    const n = fx.delay < 0.15 ? 0 : Math.ceil(((fx.delay - 0.15) / 0.85) * EXTRA.length);   // delay — облака вокруг
    for (let i = 0; i < n; i++) {
      const [dx, dy, k] = EXTRA[i], bob = Math.sin(now * 0.0006 + i * 1.7) * 2;
      cloud(c, G.cx + dx * G.W, cy + dy * 40 + bob, s * k, 0.55 + 0.1 * (i % 2));
    }
    rain(c, G.cx, cy + 2, G.W * 0.48, G.yG + 50, 0.42, now, 0.4 + 1.6 * fx.time);   // дождь — на древо и цветы
    cloud(c, G.cx, cy, s, 0.95);
  }

  // цветы-голоса у корней: вид — волна, крупнее — громче; на каждом шаге раскрываются и закрываются (огибающая)
  function flower(c, X, Y, w, s, a) {
    c.save(); c.translate(X, Y);
    c.strokeStyle = ink(a); c.lineWidth = 1.1; c.fillStyle = pap(1);
    if (w === 0) {
      for (let k = 0; k < 8; k++) { c.save(); c.rotate((k / 8) * TAU); c.beginPath(); c.ellipse(0, -s * 0.62, s * 0.24, s * 0.5, 0, 0, TAU); c.fill(); c.stroke(); c.restore(); }
      c.beginPath(); c.arc(0, 0, s * 0.26, 0, TAU); c.fillStyle = ink(a * 0.85); c.fill();
    } else if (w === 1) {
      const hw = s * 0.62, h = s * 1.1;
      c.beginPath(); c.moveTo(-hw, -h); c.lineTo(-hw, 0); c.quadraticCurveTo(0, h * 0.5, hw, 0); c.lineTo(hw, -h);
      c.lineTo(hw * 0.5, -h * 0.62); c.lineTo(0, -h); c.lineTo(-hw * 0.5, -h * 0.62); c.closePath(); c.fill(); c.stroke();
      c.beginPath(); c.moveTo(0, -h * 0.9); c.lineTo(0, h * 0.2); c.stroke();
    } else {
      c.beginPath();
      for (let k = 0; k < 10; k++) { const r = k % 2 ? s * 0.32 : s * 1.05, an = (k / 10) * TAU - Math.PI / 2; k ? c.lineTo(Math.cos(an) * r, Math.sin(an) * r) : c.moveTo(Math.cos(an) * r, Math.sin(an) * r); }
      c.closePath(); c.fill(); c.stroke();
      c.beginPath(); c.arc(0, 0, s * 0.16, 0, TAU); c.fillStyle = ink(a); c.fill();
    }
    c.restore();
  }
  function drawFlowers(c, G, st) {
    const stepMs = 60000 / bpm / 4, hit = steps.notes[st.cur] != null;
    const open = hit ? Math.exp(-(performance.now() % stepMs) / (40 + fx.env * 400)) : 0;
    const at = [[0.3, 40], [0.64, 30], [0.76, 52]];
    voices.forEach((v, k) => {
      const X = G.W * at[k][0], base = G.yG + at[k][1] + 24, top = base - 26 - 26 * v.level;
      c.strokeStyle = ink(0.85); c.lineWidth = 1.1;
      c.beginPath(); c.moveTo(X, base); c.quadraticCurveTo(X - 4, (base + top) / 2, X, top); c.stroke();
      leaf(c, X - 1, base - 10, -1.0, 0.8, 0.8);
      flower(c, X, top, v.wave, (6 + 9 * v.level) * (0.7 + 0.45 * open), 0.95);
    });
  }

  // надгробие в левом нижнем углу; выступает из угла поверх рамки
  function drawStone(c, G) {
    const x0 = 6, yb = G.H - T.safeBot - 4, w = 62, h = 86;
    c.fillStyle = pap(1);
    c.beginPath(); c.moveTo(x0, yb); c.lineTo(x0, yb - h + w / 2); c.arc(x0 + w / 2, yb - h + w / 2, w / 2, Math.PI, 0); c.lineTo(x0 + w, yb); c.closePath(); c.fill();
    c.strokeStyle = ink(0.95); c.lineWidth = 1.6; c.stroke();
    c.lineWidth = 0.9; c.strokeStyle = ink(0.6);
    c.beginPath(); c.moveTo(x0 + 5, yb); c.lineTo(x0 + 5, yb - h + w / 2); c.arc(x0 + w / 2, yb - h + w / 2, w / 2 - 5, Math.PI, 0); c.lineTo(x0 + w - 5, yb); c.stroke();
    hatchIn(c, () => { c.moveTo(x0 + w * 0.62, yb); c.lineTo(x0 + w * 0.62, yb - h + w / 2); c.arc(x0 + w / 2, yb - h + w / 2, w / 2, -0.6, 0); c.lineTo(x0 + w, yb); c.closePath(); }, Math.PI / 2, 2.6, 0.45);
    const cx = x0 + w / 2, cy = yb - h + w / 2;       // крест в нише
    c.strokeStyle = ink(0.85); c.lineWidth = 2;
    c.beginPath(); c.moveTo(cx, cy - 16); c.lineTo(cx, cy + 14); c.moveTo(cx - 9, cy - 6); c.lineTo(cx + 9, cy - 6); c.stroke();
    c.lineWidth = 0.9; c.strokeStyle = ink(0.6);
    for (let k = 0; k < 3; k++) { c.beginPath(); c.moveTo(cx - 16, cy + 26 + k * 6); c.lineTo(cx + 16, cy + 26 + k * 6); c.stroke(); }
    line(c, 0.6, 0.9); tuft(c, x0 + w + 6, yb - 2, 0.9); tuft(c, x0 + 10, yb - 1, 0.7);
  }

  // ---------- мир ----------
  const deg = (d) => (d * Math.PI) / 180;
  const fxw = {
    sectors: [
      { key: 'reverb', label: 'reverb', ang: deg(180) },
      { key: 'delay', label: 'delay', ang: deg(162) },
      { key: 'time', label: 'time', ang: deg(144) },
      { key: 'chorus', label: 'chorus', ang: deg(126) },
      { key: 'cutoff', label: 'cutoff', ang: deg(108) },
      { key: 'env', label: 'env', ang: deg(90) },
    ],
    get: (k) => fx[k], set: (k, v) => { fx[k] = v; },
    text: (k) => `${Math.round(fx[k] * 100)}%`,
    arc: () => fx.reverb,
    save: () => ({ ...fx }), load: (o) => Object.assign(fx, o),
  };
  const natura = {
    n: 'IV', title: 'Natura', sub: 'arbor · pluvia · nondum sonat',
    theme: { ink: INK, bg: `rgb(${PAPER})`, paper: PAPER },
    corner: { hit: (f) => { const G = geo(); return f.y > G.sun.y && Math.hypot(f.x - G.sun.x, f.y - G.sun.y) < G.sun.r + 6; }, draw: () => {} },   // солнце — карта; надгробие пока просто стоит
    fx: fxw,
    draw(now) {
      const c = T.g, G = geo();
      layers(G);
      c.drawImage(skyC, 0, 0, T.W, T.H);
      c.save(); c.beginPath(); c.rect(13, 13, T.W - 26, T.H - T.safeBot - 26); c.clip();
      drawSun(c, G, now);
      c.restore();
      c.drawImage(landC, 0, 0, T.W, T.H);
      drawFog(c, G, now);
      drawRiver(c, G, now);
      drawReeds(c, G, now);
      const st = drawTree(c, G, now);
      drawFlowers(c, G, st);
      drawCloud(c, G, now);
      drawStone(c, G);
    },
    down() {}, move() {}, up() {},
    clear() {}, snapshot: () => JSON.stringify({ fx }), restore(js) { Object.assign(fx, JSON.parse(js).fx); },
    sounding: () => false,
  };
  T.registerWorld(4, natura);
  window.t2d.nat = { fx, steps, geo, branchOf };
})();
