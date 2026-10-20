// Natura — мир IV: дерево, дождь, цветы; карта Таро чёрным по сепии. Эскиз картинки, без звука.
// Ритм — бинарное дерево в середине (ствол — такт, развилка — деление пополам, конец ветки — шаг длиной в эту ветку).
// Ноты — листья на концах веток: выше лист на побеге — выше нота; голая ветка — пауза.
// Голоса — цветы у корней (ромашка — синус, тюльпан — меандр, звёздочка — треугольник; крупнее — громче), раскрываются на каждом шаге.
// Бегунок — туча над кроной: плывёт по такту, вечный дождь падает на ветку, которая звучит. FX = пейзаж: туман на дальних холмах —
// reverb, тучки-эхо за тучей — delay, рябь на реке — chorus, камыши у берега — cutoff, раскрытие цветов — огибающая.
// В левом нижнем углу — надгробие (пока ни к чему не ведёт); солнце — четверть в правом верхнем углу, тап — карта. Спека: docs/superpowers/specs/2026-10-20-natura-design.md
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
  // дерево в куче: узел i → дети 2i+1, 2i+2; глубина 0 (такт) … 4 (шестнадцатая)
  const N = 31, split = new Array(N).fill(false), note = new Array(N).fill(null);
  const grow = (i) => { split[i] = true; };
  grow(0); grow(1); grow(2);                 // такт → половины → четверти
  grow(3); note[7] = 0; note[8] = 4;         // 1-я четверть — две восьмые
  note[4] = 2;                               // 2-я — четверть
  grow(5); grow(11); note[23] = 7; note[24] = 9; note[12] = 5;   // 3-я: две шестнадцатые и восьмая
  grow(6); note[13] = 4;                     // 4-я: восьмая и пауза (голая ветка)
  const voices = [{ wave: 0, level: 0.8 }, { wave: 1, level: 0.5 }, { wave: 2, level: 0.65 }];

  const depth = (i) => Math.floor(Math.log2(i + 1));
  const span = (i) => { const d = depth(i), j = i + 1 - 2 ** d; return [j / 2 ** d, (j + 1) / 2 ** d]; };
  function tips(i = 0, out = []) {          // концы веток слева направо
    if (i >= N) return out;
    if (split[i] && 2 * i + 2 < N) { tips(2 * i + 1, out); tips(2 * i + 2, out); } else out.push(i);
    return out;
  }

  // ---------- геометрия ----------
  function geo() {
    const W = T.W, H = T.H, top = T.topY + 26, bot = H - T.safeBot - 40, h = bot - top;
    const yT = top + 0.28 * h, gap = 0.09 * h, yRoot = yT + 4 * gap, hor = top + 0.6 * h, yG = top + 0.8 * h;
    const sun = { x: W - 13, y: T.topY + 2, r: Math.min(70, W * 0.18) };   // неподвижно: четверть в правом верхнем углу
    return { W, H, top, bot, h, yT, gap, yRoot, hor, yG, x0: 56, x1: W - 56, sun, cloudY: yT - 1.25 * gap,
      river: [hor + 0.035 * h, hor + 0.085 * h], stone: { x: 0, y: H - T.safeBot } };
  }
  const nodeXY = (G, i) => { const s = span(i); return { x: G.x0 + ((s[0] + s[1]) / 2) * (G.x1 - G.x0), y: G.yRoot - depth(i) * G.gap }; };

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

  // дальние холмы, луг, рамка Таро; заливка бумагой закрывает небо ниже холмов
  const hills = (G, X) => G.hor - 14 * Math.sin((X / G.W) * Math.PI * 1.6 + 0.4) - 10 * Math.sin((X / G.W) * Math.PI * 3.1);
  function drawLand(x, G, rnd) {
    const { W } = G;
    x.save(); x.beginPath(); x.rect(13, 13, W - 26, G.H - T.safeBot - 26); x.clip();
    x.fillStyle = `rgb(${PAPER})`;
    x.beginPath(); x.moveTo(0, G.H); for (let X = 0; X <= W; X += 4) x.lineTo(X, hills(G, X)); x.lineTo(W, G.H); x.closePath(); x.fill();
    line(x, 0.75, 1.2);
    x.beginPath(); for (let X = 0; X <= W; X += 4) X ? x.lineTo(X, hills(G, X)) : x.moveTo(X, hills(G, X)); x.stroke();
    hatchIn(x, () => { x.moveTo(0, G.H); for (let X = 0; X <= W; X += 4) x.lineTo(X, hills(G, X) + 3); x.lineTo(W, G.river[0]); x.lineTo(0, G.river[0]); x.closePath(); }, -0.45, 5, 0.3);
    // луг: пучки травы, земля под деревом
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

  // ---------- живое ----------
  // солнце Таро: четверть диска из правого верхнего угла (общая функция хоста)
  function drawSun(c, G, now) { T.quarterSun(c, G.sun.x, G.sun.y, G.sun.r, -1, now, INK, pap(1)); }
  function drawFog(c, G, now) {                      // туман — reverb: дальние холмы тонут
    const r = fx.reverb;
    if (r < 0.03) return;
    c.fillStyle = pap(0.85 * r); c.fillRect(13, G.hor - 30, G.W - 26, G.river[0] - G.hor + 28);
    c.strokeStyle = ink(0.3 * r); c.lineWidth = 0.9;
    const n = Math.round(2 + r * 5);
    c.setLineDash([10 + 8 * r, 6]);
    for (let i = 0; i < n; i++) {
      const yy = G.hor - 24 + i * 7, ph = now * 0.0003 * (i % 2 ? 1 : -1) + i;
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

  function drawTree(c, G, now) {
    const barMs = (4 * 60000) / bpm, t = (now % barMs) / barMs, ts = tips();
    const root = nodeXY(G, 0);
    c.strokeStyle = ink(0.9); c.lineCap = 'round';
    c.lineWidth = 5; c.beginPath(); c.moveTo(root.x, G.yG); c.lineTo(root.x, root.y); c.stroke();
    c.lineWidth = 0.8; c.strokeStyle = pap(0.8);
    c.beginPath(); for (let y = root.y + 6; y < G.yG - 2; y += 7) { c.moveTo(root.x - 1.5, y); c.lineTo(root.x + 1, y + 3); } c.stroke();
    c.strokeStyle = ink(0.9); c.lineWidth = 1.2;     // корни
    c.beginPath(); for (const d of [-1, 1]) { c.moveTo(root.x, G.yG - 4); c.quadraticCurveTo(root.x + d * 8, G.yG, root.x + d * 20, G.yG + 6); } c.stroke();
    const branch = (i) => {
      if (!split[i]) return;
      const p = nodeXY(G, i), d = depth(i);
      for (const ch of [2 * i + 1, 2 * i + 2]) {
        const q = nodeXY(G, ch);
        c.strokeStyle = ink(0.9); c.lineWidth = 3.8 - d * 0.7;
        c.beginPath(); c.moveTo(p.x, p.y); c.bezierCurveTo(p.x, p.y - G.gap * 0.55, q.x, q.y + G.gap * 0.45, q.x, q.y); c.stroke();
        branch(ch);
      }
    };
    branch(0);
    c.lineCap = 'butt';
    for (let j = 0; j < 16; j++) T.dot(G.x0 + ((j + 0.5) / 16) * (G.x1 - G.x0), G.yT, 0.9, 0.14);   // где можно привить — едва видно
    // концы веток: лист на побеге (выше побег — выше нота), голая ветка — пауза; под тучей лист вздрагивает
    let cur = null;
    for (const i of ts) {
      const s = span(i), p = nodeXY(G, i), on = t >= s[0] && t < s[1];
      if (on) cur = { i, p, s };
      if (note[i] == null) { c.strokeStyle = ink(0.45); c.lineWidth = 1; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x + 3, p.y - 5); c.stroke(); continue; }
      const k = on ? Math.exp(-((t - s[0]) * barMs) / 260) : 0;
      const hgt = 6 + note[i] * 3.6, tipY = p.y - hgt, sway = Math.sin(now * 0.02) * 0.25 * k;
      c.strokeStyle = ink(0.85); c.lineWidth = 1;
      c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x, tipY); c.stroke();
      leaf(c, p.x, tipY, (i % 2 ? 0.35 : -0.35) + sway, 1.05 + 0.3 * k, 0.8 + 0.2 * k);
    }
    return { cur, t, barMs };
  }

  // туча-бегунок над кроной и тучки-эхо за ней; дождь идёт всегда
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
  function rain(c, X, Y, w, toY, a, now, seed) {     // косые штрихи, падают вечно; детерминированно по времени
    c.strokeStyle = ink(a); c.lineWidth = 0.8; c.beginPath();
    const n = Math.round(w / 3), fall = toY - Y, per = Math.max(2, Math.round(fall / 45));   // на каждую струйку — несколько капель
    for (let i = 0; i < n; i++) for (let q = 0; q < per; q++) {
      const h = ((i * 7919 + q * 3301 + seed * 104729) % 1000) / 1000;
      const yy = Y + ((now * 0.32 + h * fall + (q * fall) / per) % fall), xx = X - w / 2 + (i + 0.5) * (w / n) - (yy - Y) * 0.06;
      c.moveTo(xx, yy); c.lineTo(xx - 0.9, yy + 9);
    }
    c.stroke();
  }
  function drawCloud(c, G, st, now) {
    const span = G.x1 - G.x0, cx = G.x0 + st.t * span, cy = G.cloudY;
    // эхо: каждое отстаёт на долю такта (time), мельче и бледнее; сколько видно — delay
    const n = Math.round(fx.delay * 5), lag = (0.06 + 0.25 * fx.time) * span;
    let s = 0.82, a = 0.7;
    for (let i = 1; i <= n; i++) {
      let X = cx - i * lag;
      while (X < G.x0) X += span;
      rain(c, X, cy + 2, 40 * s, G.yT - 10, 0.18 * a, now, i);
      cloud(c, X, cy - 6 + (i % 2) * 8, s, a);
      s *= 0.85; a *= 0.75;
    }
    rain(c, cx, cy + 2, 64, G.yG + 40, 0.5, now, 0);   // главный дождь — сквозь крону до цветов
    cloud(c, cx, cy, 1.25, 0.95);
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
    const decay = 90 + fx.env * 900, cur = st.cur;
    const tau = cur && note[cur.i] != null ? (st.t - cur.s[0]) * st.barMs : 1e9, open = Math.exp(-tau / decay);
    const at = [[0.33, 40], [0.58, 30], [0.74, 52]];
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
      drawCloud(c, G, st, now);
      drawStone(c, G);
    },
    down() {}, move() {}, up() {},
    clear() {}, snapshot: () => JSON.stringify({ fx }), restore(js) { Object.assign(fx, JSON.parse(js).fx); },
    sounding: () => false,
  };
  T.registerWorld(4, natura);
  window.t2d.nat = { fx, tips, geo };
})();
