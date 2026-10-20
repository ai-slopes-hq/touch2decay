// Natura — мир IV: река с кувшинками, древо, туча, птицы; карта Таро чёрным по сепии. Звучит: шаговый секвенсер на трёх простых волнах.
// Секвенсер — река от гор к зрителю: вдоль течения 16 мест (шагов), кувшинка на месте — шаг; поперёк — нота
// (у левого берега ниже, у правого выше; пунктир по течению — октавы). Цветок на кувшинке — голос (ромашка — синус,
// тюльпан — меандр, звёздочка — треугольник), раскрывается на шаге — огибающая. Бегунок — лист-лодочка по течению,
// запруда — длина петли. Древо на правом берегу, туча над ним поливает; дождь гуще — time; круги от задетой кувшинки
// повторяются — delay; облака вокруг тучи — тоже delay; птиц больше — chorus (хор); туман на горах — reverb.
// В сцене: туча вверх-вниз — cutoff (выше — светлее и ярче), горы вверх-вниз — res, мельница — огибающая: вверх-вниз attack, вбок release;
// колесо на каждой ноте раскручивается (attack) и по инерции замедляется (release).
// Жесты: тап по реке — посадить кувшинку (тап по ней — убрать), тянешь кувшинку поперёк — нота, вдоль — шаг, держишь — сменить цветок;
// запасной кораблик на левом берегу: берёшь и водишь по реке — поперёк звучит нота (с ладом — по ступеням, без — плавно), вниз по течению ярче;
// запруда тянешь — длина петли; причал у истока: тап — пуск/стоп (лодочка отчаливает), вбок — темп.
// Солнце — четверть в левом верхнем углу (к центру карты), тап — карта; надгробие слева внизу пока ни к чему не ведёт.
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
  const fx = { reverb: 0.4, delay: 0.45, time: 0.5, chorus: 0.4, cutoff: 0.62, res: 0.25, att: 0.08, rel: 0.45 };
  // огибающая: attack 2 мс … 0.6 с, release 50 мс … 1.9 с (мельница)
  const attSec = () => 0.002 + fx.att * fx.att * 0.6, relSec = () => 0.05 + fx.rel * fx.rel * 1.85;
  const envAt = (ms) => { const a = attSec() * 1000; return ms < a ? ms / a : Math.exp(-(ms - a) / (relSec() * 1000 / 2.5)); };
  let shake = 0, birdsAt = -1e9;                   // как сильно тормошат дерево (0…1, само затихает); когда спугнули птиц
  const seq = { playing: false, bpm: 96, next: 0, step: 0 };
  let lastWave = 0;
  // кувшинки: место по течению — шаг; note — ступень лада (0–14); wave — какой цветок (голос)
  const pads = { len: 12, at: [
    { note: 2, wave: 0 }, null, { note: 7, wave: 1 }, { note: 5, wave: 0 }, null, { note: 11, wave: 2 }, { note: 9, wave: 0 }, null,
    { note: 4, wave: 1 }, { note: 7, wave: 2 }, null, { note: 0, wave: 0 }, null, { note: 12, wave: 1 }, null, null] };

  // ---------- геометрия: река от гор к зрителю и вправо, надгробие слева — на ближнем берегу, шире к нам; «поперёк» — по нормали к течению ----------
  function geo() {
    const W = T.W, H = T.H, top = T.topY + 26, bot = H - T.safeBot - 40, h = bot - top;
    const hor = top + 0.3 * h, y1 = bot - 6;
    const sun = { x: 13, y: T.topY + 2, r: Math.min(70, W * 0.18) };   // неподвижно: четверть в левом верхнем углу (к центру карты)
    const tree = { x: W * 0.85, y: top + 0.47 * h };
    const P0 = [W * 0.44, hor], P1 = [W * 0.12, hor + 0.66 * (top + 0.76 * h - hor)], P2 = [W * 1.12, top + 0.76 * h];
    return { W, H, top, bot, h, hor, y1, sun, tree, cloudY: top + 0.06 * h, P: [P0, P1, P2] };
  }
  // точка реки: центр, ширина, нормаль n (к «высокому» берегу) и направление течения
  const river = (G, t) => {                         // t: 0 — у гор, 1 — у зрителя, слева
    const [a, b, d] = G.P, u = 1 - t;
    const x = u * u * a[0] + 2 * u * t * b[0] + t * t * d[0], y = u * u * a[1] + 2 * u * t * b[1] + t * t * d[1];
    let tx = 2 * u * (b[0] - a[0]) + 2 * t * (d[0] - b[0]), ty = 2 * u * (b[1] - a[1]) + 2 * t * (d[1] - b[1]);
    const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
    return { x, y, w: G.W * (0.12 + 0.5 * t ** 0.9), tx, ty, nx: ty, ny: -tx };
  };
  const across = (r, q) => ({ x: r.x + r.nx * q * r.w, y: r.y + r.ny * q * r.w });   // q: −0.5 … 0.5 — от берега до берега
  // обратно: точка экрана → место на реке (t, поперёк в долях ширины)
  function onRiver(G, x, y) {
    let best = null, bd = 1e9;
    for (let k = 0; k <= 96; k++) {
      const t = k / 96, r = river(G, t), dx = x - r.x, dy = y - r.y, al = dx * r.tx + dy * r.ty;
      if (Math.abs(al) < bd) { bd = Math.abs(al); best = { t, q: (dx * r.nx + dy * r.ny) / r.w }; }
    }
    return best;
  }
  // 16 мест — в видимой части реки (дальше она уходит за правый край): запруду при любой длине видно и можно схватить
  const T0 = 0.14, TS = 0.72;
  const slotT = (i) => T0 + ((i + 0.5) / 16) * TS;
  function padXY(G, i, note) {
    const t = slotT(i), r = river(G, t), p = across(r, (note / 14 - 0.5) * 0.78);
    return { x: p.x, y: p.y, t, s: 0.6 + 0.8 * t };
  }

  // ---------- кеш: бумага (под небом); земля и рамка (поверх неба) ----------
  let skyC = null, landC = null, key = '';
  function canvas() { const c = document.createElement('canvas'); c.width = Math.round(T.W * T.DPR); c.height = Math.round(T.H * T.DPR); const x = c.getContext('2d'); x.setTransform(T.DPR, 0, 0, T.DPR, 0, 0); return [c, x]; }
  function layers(G) {
    const k = `${G.W}x${G.H}x${T.DPR}|${G.top}|${G.bot}|${Math.round(fx.res * 24)}`;   // горы растут с резонансом
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

  // горы, луг, берега, запруда-заготовка; рамка с украшениями
  function drawLand(x, G, rnd) {
    const { W } = G;
    x.save(); x.beginPath(); x.rect(13, 13, W - 26, G.H - T.safeBot - 26); x.clip();
    const mh = 0.45 + 1.3 * (Math.round(fx.res * 24) / 24);   // резонанс — выше горы
    ridge(x, G, G.hor, 4, 0.08 * G.h * mh, 0.14 * G.h * mh, 0.45, 5);
    ridge(x, G, G.hor + 0.02 * G.h, 6, 0.03 * G.h * mh, 0.06 * G.h * mh, 0.8, 9);
    // река: заливка бумагой, берега, пунктир по течению — октавы (ступени 0, 7, 14)
    const N = 80, edge = (s) => { for (let k = 0; k <= N; k++) { const p = across(river(G, k / N), s / 2); k ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y); } };
    x.fillStyle = `rgb(${PAPER})`; x.beginPath(); edge(-1); for (let k = N; k >= 0; k--) { const p = across(river(G, k / N), 0.5); x.lineTo(p.x, p.y); } x.closePath(); x.fill();
    line(x, 0.85, 1.4); x.beginPath(); edge(-1); x.stroke(); x.beginPath(); edge(1); x.stroke();
    x.setLineDash([2, 5]); line(x, 0.22, 0.8);
    for (const q of [0, 0.5, 1]) { x.beginPath(); for (let k = 4; k <= N; k++) { const p = across(river(G, k / N), (q - 0.5) * 0.78); k > 4 ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y); } x.stroke(); }
    x.setLineDash([]);
    line(x, 0.35, 0.8); x.beginPath();               // волны по воде — короткие штрихи, к нам крупнее
    for (let k = 0; k < 70; k++) { const t = rnd() ** 0.8, p = across(river(G, t), (rnd() - 0.5) * 0.9), l = 3 + 8 * t; x.moveTo(p.x - l, p.y + 2); x.quadraticCurveTo(p.x, p.y, p.x + l, p.y + 2); }
    x.stroke();
    // засечки мест по левому берегу — куда можно посадить кувшинку
    line(x, 0.45, 1); x.beginPath();
    for (let i = 0; i < 16; i++) { const r = river(G, slotT(i)), a = across(r, -0.5), l = 4 + 4 * slotT(i); x.moveTo(a.x - r.nx * l, a.y - r.ny * l); x.lineTo(a.x - r.nx, a.y - r.ny); }
    x.stroke();
    // луг: пучки травы по берегам
    line(x, 0.55, 0.9);
    for (let i = 0; i < 22; i++) {
      const t = 0.15 + rnd() * 0.85, r = river(G, t), sd = rnd() < 0.5 ? -1 : 1, p = across(r, sd * (0.5 + (10 + rnd() * 60) / r.w));
      if (p.x < 18 || p.x > W - 18 || p.y > G.bot - 6 || (p.x < 100 && p.y > G.bot - 110)) continue;
      tuft(x, p.x, p.y, 0.6 + 0.6 * t);
    }
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
    x.fillText('N A T V R A', W / 2 + 28, by + 11);   // чуть вправо — слева надгробие
  }

  function leafPath(x, X, Y, ang, s) { x.save(); x.translate(X, Y); x.rotate(ang); x.beginPath(); x.moveTo(0, 0); x.quadraticCurveTo(4 * s, -6 * s, 0, -12 * s); x.quadraticCurveTo(-4 * s, -6 * s, 0, 0); x.stroke(); x.restore(); }

  // ---------- живое ----------
  // солнце Таро: четверть диска из левого верхнего угла — угла к центру карты (общая функция хоста)
  let noSun = false;                                // снимок для карты — без солнца: на карте солнце одно, в центре
  function drawSun(c, G, now) { if (!noSun) T.quarterSun(c, G.sun.x, G.sun.y, G.sun.r, 1, now, INK, pap(1)); }
  function drawFog(c, G, now) {                      // туман — reverb: дальние холмы тонут
    const r = fx.reverb;
    if (r < 0.03) return;
    c.fillStyle = pap(0.8 * r); c.fillRect(13, G.hor - 0.15 * G.h, G.W - 26, 0.15 * G.h + 0.02 * G.h);
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
  function leaf(c, X, Y, ang, s, a, fill = true) { // миндалевидный лист с жилкой
    c.save(); c.translate(X, Y); c.rotate(ang);
    c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(4.5 * s, -6 * s, 0, -13 * s); c.quadraticCurveTo(-4.5 * s, -6 * s, 0, 0);
    if (fill) { c.fillStyle = pap(1); c.fill(); }
    c.strokeStyle = ink(a); c.lineWidth = 1.1; c.stroke();
    c.lineWidth = 0.6; c.beginPath(); c.moveTo(0, -1); c.lineTo(0, -11 * s); c.stroke();
    c.restore();
  }

  // облако, как на картах Таро: пухлые клубы разного размера (сверху крупнее), внутри завитки у краёв клубов,
  // снизу тень штрихом. Контур — объединение кругов: сначала все обводятся толстой линией, потом заливаются бумагой
  const LOBES = [[-0.3, -0.02, 0.19], [-0.1, -0.2, 0.25], [0.15, -0.16, 0.23], [0.34, -0.02, 0.17],
    [0.22, 0.11, 0.15], [0.0, 0.13, 0.17], [-0.22, 0.12, 0.15], [-0.42, 0.05, 0.12]];
  function cloud(c, X, Y, s, a) {
    const w = 64 * s;
    c.save(); c.translate(X, Y);
    const each = (fn) => { for (const [dx, dy, r] of LOBES) { c.beginPath(); c.arc(dx * w, dy * w, r * w, 0, TAU); fn(); } };
    c.strokeStyle = ink(a); c.lineWidth = 2.6; each(() => c.stroke());
    c.fillStyle = pap(1); each(() => c.fill());
    c.beginPath(); for (const [dx, dy, r] of LOBES) { c.moveTo(dx * w + r * w, dy * w); c.arc(dx * w, dy * w, r * w, 0, TAU); } c.clip();
    c.strokeStyle = ink(a * 0.3); c.lineWidth = 0.7; c.beginPath();      // тень снизу — короткие дуги-штрихи
    for (let y = 0.11 * w; y < 0.32 * w; y += 3) { c.moveTo(-0.5 * w, y); c.quadraticCurveTo(0, y + 0.04 * w, 0.5 * w, y); }
    c.stroke();
    c.strokeStyle = ink(a * 0.75); c.lineWidth = 1;   // завитки у верхних клубов
    LOBES.slice(0, 4).forEach(([dx, dy, r], i) => {
      const cx = dx * w, cy = dy * w + r * w * 0.25, rr = r * w * 0.55;
      c.beginPath(); c.arc(cx, cy, rr, Math.PI * 1.05, Math.PI * (i % 2 ? 1.75 : 1.85)); c.stroke();
      c.beginPath(); c.arc(cx + rr * 0.15, cy, rr * 0.45, Math.PI * 1.2, Math.PI * 1.9); c.stroke();
    });
    c.restore();
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

  // запруда — длина петли: ряд кольев поперёк реки за последним шагом, связанных жердью (читается при любом повороте реки)
  function drawBridge(c, G) {
    const t = bridgeT(), r = river(G, t), n = 7, h = 10 + 16 * t;
    const pts = Array.from({ length: n }, (_, k) => across(r, -0.5 - 6 / r.w + (k / (n - 1)) * (1 + 12 / r.w)));
    c.strokeStyle = ink(0.9); c.lineWidth = 1.3; c.fillStyle = pap(1);
    c.beginPath(); pts.forEach((p, k) => (k ? c.lineTo(p.x, p.y - h * 0.7) : c.moveTo(p.x, p.y - h * 0.7))); c.stroke();   // жердь
    for (const p of pts) {                            // колья: столбик с заострённой макушкой, рябь у основания
      c.beginPath(); c.moveTo(p.x - 2.2, p.y + 1); c.lineTo(p.x - 2.2, p.y - h); c.lineTo(p.x, p.y - h - 4); c.lineTo(p.x + 2.2, p.y - h); c.lineTo(p.x + 2.2, p.y + 1); c.closePath(); c.fill(); c.stroke();
      c.lineWidth = 0.8; c.beginPath(); c.moveTo(p.x - 6, p.y + 2); c.quadraticCurveTo(p.x, p.y + 4, p.x + 6, p.y + 2); c.stroke(); c.lineWidth = 1.3;
    }
  }

  // кувшинка: лист с вырезом, сверху цветок-голос; на шаге раскрывается, от неё круги (с delay — повторяются)
  function lily(c, p, wave, open, a) {
    const rx = 15 * p.s, ry = rx * 0.48;
    c.fillStyle = pap(1); c.strokeStyle = ink(a); c.lineWidth = 1.1;
    c.beginPath(); c.ellipse(p.x, p.y, rx, ry, 0, 0.35, TAU - 0.05); c.lineTo(p.x, p.y); c.closePath(); c.fill(); c.stroke();
    c.lineWidth = 0.6; c.strokeStyle = ink(a * 0.5); c.beginPath();
    for (const q of [1.2, 2.1, 3.0, 3.9, 4.8]) { c.moveTo(p.x, p.y); c.lineTo(p.x + Math.cos(q) * rx * 0.8, p.y + Math.sin(q) * ry * 0.8); }
    c.stroke();
    flower(c, p.x - rx * 0.15, p.y - ry * 0.4, wave, (4 + 4 * p.s) * (0.75 + 0.45 * open), a);
  }
  function drawPads(c, G, now) {
    const stepMs = stepSec() * 1000, ph = phase(), playing = ph != null, pos = playing ? ph : 0, cur = playing ? Math.floor(pos) % pads.len : -1;
    const echoes = 1 + Math.round(fx.delay * 3), gap = delaySec() * 1000;
    for (let i = 0; i < pads.len && playing; i++) {   // круги от задетых кувшинок — только что и эхом (через время задержки)
      const pd = pads.at[i];
      if (!pd) continue;
      const p = padXY(G, i, pd.note), since = ((((pos - i) % pads.len) + pads.len) % pads.len) * stepMs;
      for (let e = 0; e < echoes; e++) {
        const k = (since - e * gap) / 700;
        if (k < 0 || k > 1) continue;
        c.strokeStyle = ink(0.6 * (1 - k) * 0.7 ** e); c.lineWidth = 1;
        c.beginPath(); c.ellipse(p.x, p.y, 12 * p.s + 26 * p.s * k, (12 * p.s + 26 * p.s * k) * 0.45, 0, 0, TAU); c.stroke();
      }
    }
    for (let i = 0; i < 16; i++) {
      if (i === pads.len) drawBridge(c, G);           // запруда — между последним шагом и бледными за ним
      const pd = pads.at[i];
      if (!pd) continue;
      const p = padXY(G, i, pd.note), on = i === cur && i < pads.len;
      const open = on ? envAt((pos % 1) * stepMs) : 0, held = [...touches.values()].some((t) => t.kind === 'pad' && t.i === i);
      lily(c, p, pd.wave, open, i < pads.len ? (held ? 1 : 0.95) : 0.3);   // за запрудаом — бледные, не играют
    }
    if (pads.len >= 16) drawBridge(c, G);
    // лист-лодочка плывёт по течению: между местами — плавно
    const { x: bx, y: by, s } = boatXY(G, now);
    boatShape(c, bx, by, s, -0.15, !playing);
  }
  function boatShape(c, bx, by, s, tilt, paused) {
    c.save(); c.translate(bx, by); c.rotate(tilt);
    c.fillStyle = pap(1); c.strokeStyle = ink(0.95); c.lineWidth = 1.1;
    c.beginPath(); c.moveTo(-11 * s, 0); c.quadraticCurveTo(0, 6 * s, 11 * s, 0); c.quadraticCurveTo(0, -3 * s, -11 * s, 0); c.closePath(); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(-9 * s, 0.5); c.lineTo(9 * s, 0.5); c.stroke();
    c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -9 * s); c.lineTo(6 * s, -2 * s); c.closePath(); c.fill(); c.stroke();   // парус из листа
    if (paused) { c.lineWidth = 1; c.strokeRect(-3 * s, -14 * s, 1.6 * s, 4 * s); c.strokeRect(0.6 * s, -14 * s, 1.6 * s, 4 * s); }   // стоит — знак паузы над парусом
    c.restore();
  }

  // ---------- мельница на ближнем берегу: огибающая. На каждой ноте вода из жёлоба бьёт по колесу —
  // оно раскручивается (attack) и по инерции замедляется (release). Тянешь мельницу: вверх-вниз — attack, вбок — release ----------
  let wheelA = 0, wheelLast = performance.now();
  function millAt(G) { const r = river(G, 0.5), p = across(r, -0.5), R = Math.min(24, G.W * 0.06); return { x: p.x - r.nx * R * 0.6, y: p.y - r.ny * R * 0.6, R, r }; }
  function drawMill(c, G, now) {
    const { x, y, R, r } = millAt(G), hx = x - r.nx * (R + 26), hy = y - r.ny * (R + 26) + 6;
    const dt = Math.min(0.1, (now - wheelLast) / 1000); wheelLast = now;
    const sp = noteAt > -1e8 ? envAt(now - noteAt) : 0;  // скорость колеса — огибающая последней ноты
    wheelA += sp * dt * 9;
    c.fillStyle = pap(1); c.strokeStyle = ink(0.9); c.lineWidth = 1.2;  // дом: стена, крутая крыша, дверь, окно
    c.beginPath(); c.rect(hx - 20, hy - 26, 40, 30); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(hx - 25, hy - 26); c.lineTo(hx, hy - 50); c.lineTo(hx + 25, hy - 26); c.closePath(); c.fill(); c.stroke();
    hatchIn(c, () => { c.moveTo(hx, hy - 50); c.lineTo(hx + 25, hy - 26); c.lineTo(hx, hy - 26); c.closePath(); }, 1.1, 2.6, 0.5);
    c.beginPath(); c.rect(hx - 6, hy - 14, 10, 18); c.stroke(); c.beginPath(); c.rect(hx + 9, hy - 20, 7, 7); c.moveTo(hx + 12.5, hy - 20); c.lineTo(hx + 12.5, hy - 13); c.stroke();
    // жёлоб и вода — бьёт по колесу, пока идёт attack
    const jx = x + r.tx * -36, jy = y + r.ty * -36 - R - 4;
    c.lineWidth = 1.1; c.beginPath(); c.moveTo(jx - 4, jy); c.lineTo(x - 2, y - R - 6); c.moveTo(jx - 4, jy + 4); c.lineTo(x - 2, y - R - 2); c.stroke();
    if (sp > 0.05) { c.strokeStyle = ink(0.6 * sp); c.setLineDash([3, 3]); c.lineDashOffset = -now * 0.1; c.beginPath(); c.moveTo(x - 2, y - R - 4); c.quadraticCurveTo(x + 6, y - R, x + R * 0.5, y - R * 0.6); c.stroke(); c.setLineDash([]); c.lineDashOffset = 0; c.strokeStyle = ink(0.9); }
    c.fillStyle = pap(1); c.beginPath(); c.arc(x, y, R, 0, TAU); c.fill();   // колесо: обод, спицы, лопасти
    T.ring(x, y, R, 0.9, 1.3); T.ring(x, y, R * 0.3, 0.7, 1);
    c.lineWidth = 1; c.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = wheelA + (k / 8) * TAU, cs = Math.cos(a), sn = Math.sin(a);
      c.moveTo(x + cs * R * 0.3, y + sn * R * 0.3); c.lineTo(x + cs * R, y + sn * R);
      c.moveTo(x + cs * R, y + sn * R); c.lineTo(x + cs * (R + 5) - sn * 3, y + sn * (R + 5) + cs * 3);
    }
    c.stroke();
    if (sp > 0.1) { c.strokeStyle = ink(0.4 * sp); c.beginPath(); c.ellipse(x, y + R - 2, R * 1.2 * (1 + sp * 0.3), 4, 0, 0, Math.PI); c.stroke(); }   // брызги под колесом
  }

  // ---------- запасной кораблик: лежит на левом берегу; водишь по реке — играет ----------
  const skiff = { x: 0, y: 0, held: false, home: true, voice: null, trail: [], back: null };
  const skiffHome = (G) => { const r = river(G, 0.3), p = across(r, -0.5 - 30 / r.w); return { x: p.x, y: p.y + 4 }; };
  function drawSkiff(c, G, now) {
    const home = skiffHome(G);
    if (skiff.home) { skiff.x = home.x; skiff.y = home.y; }
    else if (!skiff.held && skiff.back) {             // отпустили — сам плывёт к берегу
      const k = clamp((now - skiff.back.t0) / 900), e = 1 - (1 - k) ** 3;
      skiff.x = skiff.back.x + (home.x - skiff.back.x) * e; skiff.y = skiff.back.y + (home.y - skiff.back.y) * e;
      if (k >= 1) { skiff.home = true; skiff.back = null; }
    }
    for (const w of skiff.trail) {                    // след на воде — расходящиеся дуги
      const k = (now - w.t) / 1400;
      if (k > 1) continue;
      c.strokeStyle = ink(0.45 * (1 - k)); c.lineWidth = 0.9;
      c.beginPath(); c.ellipse(w.x, w.y + 2, 6 + 22 * k, (6 + 22 * k) * 0.4, 0, Math.PI * 0.1, Math.PI * 0.9); c.stroke();
    }
    skiff.trail = skiff.trail.filter((w) => now - w.t < 1400);
    const onWater = skiff.held && skiff.voice;
    boatShape(c, skiff.x, skiff.y - (onWater ? 2 : 0), 1.25, skiff.home ? -0.35 : Math.sin(now * 0.004) * 0.08, false);
    if (onWater && skiff.label) T.mapText(skiff.label, skiff.x, skiff.y - 30, 15, 0.95, 'center');
  }
  function boatXY(G, now) {                         // лист-лодочка: плывёт по течению между местами; стоит — у причала
    const ph = phase();
    if (ph == null) { const q = pierXY(G); return { x: q.x + 16, y: q.y + 3, s: 0.8 }; }
    const t = T0 + ((ph % pads.len) / 16) * TS, p = across(river(G, t), Math.sin(now * 0.0015) * 0.06);
    return { x: p.x, y: p.y - 2, s: 0.75 + 1.0 * t };
  }
  // причал у истока, на левом берегу: тап — пуск/стоп, вбок — темп
  const pierXY = (G) => { const r = river(G, 0.06), p = across(r, -0.5); return { x: p.x - 8, y: p.y }; };
  function drawPier(c, G) {
    const { x, y } = pierXY(G);
    c.fillStyle = pap(1); c.strokeStyle = ink(0.9); c.lineWidth = 1.1;
    c.beginPath(); c.rect(x - 14, y - 4, 30, 7); c.fill(); c.stroke();         // настил
    c.lineWidth = 0.8; c.beginPath(); for (let k = 1; k < 5; k++) { c.moveTo(x - 14 + k * 6, y - 4); c.lineTo(x - 14 + k * 6, y + 3); } c.stroke();
    c.lineWidth = 1.4; c.beginPath(); c.moveTo(x + 14, y - 12); c.lineTo(x + 14, y + 8); c.moveTo(x - 12, y + 3); c.lineTo(x - 12, y + 9); c.stroke();   // столб и свая
    if (!seq.playing) { c.lineWidth = 0.8; c.beginPath(); c.moveTo(x + 14, y - 8); c.quadraticCurveTo(x + 20, y, x + 24, y + 2); c.stroke(); }   // верёвка к лодочке
  }
  const bridgeT = () => slotT(pads.len - 1) + (TS / 16) * 0.75;
  // дождь по воде — кружки (гуще с time)
  function drawRainRings(c, G, now) {
    const n = Math.round(4 + 14 * fx.time);
    c.lineWidth = 0.8;
    for (let i = 0; i < n; i++) {
      const per = 1300 + (i % 5) * 170, k = ((now + i * 397) % per) / per, cyc = Math.floor((now + i * 397) / per);
      const h1 = ((i * 7919 + cyc * 104729) % 1000) / 1000, h2 = ((i * 3301 + cyc * 7727) % 1000) / 1000;
      const t = 0.15 + h1 * 0.8, p = across(river(G, t), (h2 - 0.5) * 0.85), R = (2 + 8 * k) * (0.5 + t);
      c.strokeStyle = ink(0.35 * (1 - k)); c.beginPath(); c.ellipse(p.x, p.y, R, R * 0.4, 0, 0, TAU); c.stroke();
    }
  }
  // камыши по обоим берегам ближней части — cutoff
  const REEDS = [0.55, 0.92, 0.7, 0.62, 0.84, 0.97, 0.75, 0.66, 0.88, 0.58, 0.8, 0.94, 0.72, 0.6, 0.86, 0.78];
  function drawReeds(c, G, now) {
    const k = 0.5, n = 10;                            // камыши — просто берег (cutoff теперь — туча)
    for (let i = 0; i < n; i++) {
      const t = REEDS[i], r = river(G, t), sd = i % 2 ? 1 : -1, p = across(r, sd * (0.5 + (2 + (i % 3) * 5) / r.w)), X = p.x, base = p.y + 2;
      if (X < 16 || X > G.W - 16 || base > G.bot) continue;
      const hh = (12 + k * 42) * (0.6 + 0.6 * t) * (0.8 + 0.2 * Math.sin(i * 2.7)), sw = Math.sin(now * 0.0012 + i) * 2.5 * (hh / 50), tx = X + sw, ty = base - hh;
      c.strokeStyle = ink(0.85); c.lineWidth = 1;
      c.beginPath(); c.moveTo(X, base); c.quadraticCurveTo(X, base - hh * 0.5, tx, ty); c.stroke();
      c.beginPath(); c.moveTo(tx, ty); c.lineTo(tx + sw * 0.2, ty - 5); c.stroke();
      c.fillStyle = ink(0.85); c.beginPath(); c.ellipse(tx, ty + 5, 1.8, 4.5, 0, 0, TAU); c.fill();
      c.strokeStyle = ink(0.7); c.lineWidth = 0.9; c.beginPath();
      for (const d of [-1, 1]) { c.moveTo(X, base); c.quadraticCurveTo(X + d * 3, base - hh * 0.45, X + d * 9 + sw * 0.6, base - hh * 0.7); }
      c.stroke();
    }
  }
  // древо жизни на правом берегу: ствол с корнями, круглая крона-фестон с листьями и плодами — просто древо, без нот
  function drawTree(c, G) {
    const { y } = G.tree, R = Math.min(G.W * 0.16, G.h * 0.09), cy = y - G.h * 0.13 - R * 0.6;
    const x = G.tree.x + Math.sin(performance.now() * 0.03) * shake * 5;   // тормошат — крона ходит
    c.fillStyle = ink(0.9);
    c.beginPath(); c.moveTo(x - 6, y); c.quadraticCurveTo(x - 3, (y + cy) / 2, x - 2.5, cy); c.lineTo(x + 2.5, cy); c.quadraticCurveTo(x + 3, (y + cy) / 2, x + 6, y); c.closePath(); c.fill();
    c.strokeStyle = ink(0.9); c.lineWidth = 1.2; c.beginPath();
    for (const d of [-1, 1]) { c.moveTo(x + d * 3, y - 2); c.quadraticCurveTo(x + d * 9, y + 1, x + d * 22, y + 5); }
    c.stroke();
    const lobes = 9;                                    // крона: фестоны по кругу
    c.fillStyle = pap(1); c.strokeStyle = ink(0.9); c.lineWidth = 1.3;
    c.beginPath();
    for (let k = 0; k < lobes; k++) {
      const a0 = (k / lobes) * TAU, a1 = ((k + 1) / lobes) * TAU, am = (a0 + a1) / 2;
      const p0x = x + Math.cos(a0) * R, p0y = cy + Math.sin(a0) * R * 0.92;
      if (!k) c.moveTo(p0x, p0y);
      c.quadraticCurveTo(x + Math.cos(am) * R * 1.32, cy + Math.sin(am) * R * 1.22, x + Math.cos(a1) * R, cy + Math.sin(a1) * R * 0.92);
    }
    c.closePath(); c.fill(); c.stroke();
    hatchIn(c, () => c.arc(x + R * 0.2, cy + R * 0.15, R * 0.95, -0.4, 1.9), 0.8, 3, 0.35);   // тень справа-снизу
    for (let k = 0; k < 7; k++) {                       // листья и плоды внутри
      const a = k * 2.4, rr = R * (0.25 + 0.55 * ((k * 37) % 10) / 10), lx = x + Math.cos(a) * rr, ly = cy + Math.sin(a) * rr * 0.9;
      if (k % 2) { c.fillStyle = pap(1); c.strokeStyle = ink(0.85); c.lineWidth = 1; c.beginPath(); c.arc(lx, ly, 3.2, 0, TAU); c.fill(); c.stroke(); c.beginPath(); c.moveTo(lx, ly - 3.2); c.lineTo(lx + 1.5, ly - 6); c.stroke(); }
      else leaf(c, lx, ly + 5, a, 0.75, 0.75);
    }
    const nf = Math.round(shake * 8), now = performance.now();       // опадают листья
    for (let k = 0; k < nf; k++) {
      const t = ((now / (900 + k * 130) + k * 0.31) % 1), lx = x + Math.sin(k * 2.7) * R * 0.9 + Math.sin(t * 9 + k) * 8, ly = cy + R * 0.6 + t * G.h * 0.14;
      leaf(c, lx, ly, t * 6 + k, 0.6, 0.7 * (1 - t));
    }
  }
  // туча над древом, поливает его и берег; облака вокруг — delay
  const EXTRA = [[-0.3, 0.6, 0.55], [0.12, -0.5, 0.6], [-0.55, -0.3, 0.45], [-0.15, 0.9, 0.5], [0.05, 0.4, 0.4]];
  function drawCloud(c, G, now) {
    const { s, cx, cy } = cloudAt(G);
    const n = fx.delay < 0.15 ? 0 : Math.ceil(((fx.delay - 0.15) / 0.85) * EXTRA.length);
    for (let i = 0; i < n; i++) {
      const [dx, dy, k] = EXTRA[i], bob = Math.sin(now * 0.0006 + i * 1.7) * 2;
      cloud(c, cx + dx * G.W, cy + dy * 40 + bob, s * k, 0.55 + 0.1 * (i % 2));
    }
    rain(c, cx, cy + 0.2 * 64 * s, G.W * 0.3, G.tree.y + 20, 0.42, now, 0.4 + 1.6 * fx.time);
    cloud(c, cx, cy, s, 0.95);
    if (fx.cutoff < 0.6) {                            // низкая туча — тяжёлая: гуще тень снизу
      c.save(); c.translate(cx, cy); c.strokeStyle = ink(0.35 * (0.6 - fx.cutoff) / 0.6); c.lineWidth = 0.8; c.beginPath();
      for (let y = 0; y < 14 * s; y += 2.2) { c.moveTo(-22 * s, y); c.lineTo(22 * s, y); }
      c.stroke(); c.restore();
    }
  }
  // туча: выше — фильтр открыт, ниже — глухо
  const cloudAt = (G) => { const s = (G.W * 0.34) / 64; return { s, cx: Math.min(G.tree.x, G.W - 34 * s), cy: G.cloudY + G.h * 0.04 + (1 - fx.cutoff) * G.h * 0.12 }; };
  // птицы — хор: больше chorus — больше птиц; машут крыльями, медленно кружат над горами
  // птицы — хор: больше chorus — больше птиц; тап — спугнуть: вспархивают вверх и врассыпную, через пару секунд возвращаются
  function birdList(G, now) {
    const n = Math.round(fx.chorus * 16), k = clamp((now - birdsAt) / 2600), up = k < 1 ? Math.sin(k * Math.PI) : 0, out = [];
    for (let i = 0; i < n; i++) {
      const h1 = ((i * 7919) % 1000) / 1000, h2 = ((i * 3301) % 1000) / 1000;
      const X = G.W * (0.3 + 0.55 * h1) + Math.sin(now * 0.0002 + i) * 18 + up * (h1 - 0.5) * 160, Y = G.top + G.h * (0.12 + 0.13 * h2) + Math.cos(now * 0.00027 + i * 1.3) * 6 - up * (60 + 50 * h2);
      out.push({ X, Y, s: 1 + 0.8 * h2, i, fast: up });
    }
    return out;
  }
  function drawBirds(c, G, now) {
    c.strokeStyle = ink(0.8); c.lineWidth = 1.2;
    for (const { X, Y, s, i, fast } of birdList(G, now)) {
      const f = Math.sin(now * (0.006 + 0.03 * fast) + i * 2.1) * 3 * s;
      c.beginPath(); c.moveTo(X - 6 * s, Y - f * 0.4); c.quadraticCurveTo(X - 3 * s, Y - 3 * s - f, X, Y); c.quadraticCurveTo(X + 3 * s, Y - 3 * s - f, X + 6 * s, Y - f * 0.4); c.stroke();
    }
  }


  // надгробие в левом нижнем углу; выступает из угла поверх рамки
  function drawStone(c, G) {                        // четверть надгробия из левого нижнего угла, как древо жизни у алхимиков: ось камня — край экрана
    const yb = G.H - T.safeBot, R = Math.min(84, G.W * 0.22), top = yb - R * 1.55, sh = yb - R * 0.55;
    c.save(); c.beginPath(); c.rect(0, 0, G.W, yb); c.clip();
    const outline = (d) => { c.moveTo(0, top + d); c.arc(0, sh, R - d, -Math.PI / 2, 0); c.lineTo(R - d, yb + 2); };
    c.fillStyle = pap(1); c.beginPath(); outline(0); c.lineTo(0, yb + 2); c.closePath(); c.fill();
    c.strokeStyle = ink(0.95); c.lineWidth = 1.7; c.beginPath(); outline(0); c.stroke();
    c.strokeStyle = ink(0.55); c.lineWidth = 0.9; c.beginPath(); outline(7); c.stroke();
    hatchIn(c, () => { c.moveTo(R * 0.7, sh); c.arc(0, sh, R, -0.75, 0); c.lineTo(R, yb); c.lineTo(R * 0.7, yb); c.closePath(); }, Math.PI / 2, 2.6, 0.45);
    c.strokeStyle = ink(0.85); c.lineWidth = 2.2; c.beginPath();      // крест — половина, по оси камня
    c.moveTo(1, top + R * 0.3); c.lineTo(1, top + R * 0.95); c.moveTo(0, top + R * 0.5); c.lineTo(R * 0.3, top + R * 0.5); c.stroke();
    c.lineWidth = 0.9; c.strokeStyle = ink(0.55);
    for (let k = 0; k < 3; k++) { c.beginPath(); c.moveTo(0, top + R * (1.12 + k * 0.1)); c.lineTo(R * 0.5, top + R * (1.12 + k * 0.1)); c.stroke(); }   // стёртая надпись
    c.strokeStyle = ink(0.6); c.beginPath(); c.moveTo(R * 0.72, top + R * 0.42); c.lineTo(R * 0.6, top + R * 0.62); c.lineTo(R * 0.66, top + R * 0.75); c.lineTo(R * 0.55, top + R * 0.95); c.stroke();   // трещина
    c.restore();
    line(c, 0.6, 0.9); tuft(c, R + 8, yb - 2, 0.9); tuft(c, R + 22, yb - 1, 0.7);
  }



  // ---------- звук: нота — синус / меандр / треугольник → фильтр с огибающей → хор (птицы) → задержка (облака) и зал (туман) ----------
  let actx = null, bus = null;
  const stepSec = () => 60 / seq.bpm / 4;
  const DIVS = [['1/16', 1 / 4], ['1/8', 1 / 2], ['1/8d', 3 / 4], ['1/4', 1], ['1/4d', 1.5], ['1/2', 2]];
  const div = () => DIVS[Math.round(fx.time * (DIVS.length - 1))];
  const delaySec = () => (div()[1] * 60) / seq.bpm;
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
  let lastSound = 0;
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
    S(bus.dSend.gain, fx.delay * 0.7); S(bus.dfb.gain, 0.2 + 0.55 * fx.delay); S(bus.dl.delayTime, delaySec(), 0.15);
    S(bus.rSend.gain, fx.reverb * fx.reverb * 1.3);
    const tail = 1.5 + fx.reverb * 6;
    for (const l of bus.hall.lines) S(l.g.gain, 10 ** ((-3 * l.len) / tail));
  }
  // нота кувшинки: ступень лада от тоники (без лада — ля минор), две октавы с лишним
  function noteHz(n) {
    const root = T.scaleRoot, pcs = T.scalePCs;
    const steps = pcs ? pcs.map((pc) => (pc - root + 12) % 12).sort((a, b) => a - b) : [0, 2, 3, 5, 7, 8, 10];
    const semis = steps[n % steps.length] + 12 * Math.floor(n / steps.length);
    return 110 * 2 ** ((root + semis) / 12);
  }
  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const noteName = (f) => { const m = Math.round(33 + 12 * Math.log2(f / 55)); return `${NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`; };
  let prevHz = 0, noteAt = -1e9;
  function playNote(pd, t) {
    if (!bus) return;
    const ctx = actx, o = ctx.createOscillator(), lp = ctx.createBiquadFilter(), a = ctx.createGain();
    o.type = ['sine', 'square', 'triangle'][pd.wave];
    const hz = noteHz(pd.note);
    if (pd.glide && prevHz) { o.frequency.setValueAtTime(prevHz, t); o.frequency.exponentialRampToValueAtTime(hz, t + stepSec() * 0.8); }   // глайд из прошлой ноты
    else o.frequency.setValueAtTime(hz, t);
    prevHz = hz;
    noteAt = performance.now() + (t - actx.currentTime) * 1000;   // для мельницы: когда вода ударит по колесу
    const base = 180 * 2 ** (fx.cutoff * 6.6), peak = Math.min(16000, base * 6), A = attSec(), dec = relSec() / 2.5;
    lp.type = 'lowpass'; lp.Q.value = 0.7 + fx.res * 16;   // резонанс — луч res (и горы)
    lp.frequency.setValueAtTime(base, t); lp.frequency.linearRampToValueAtTime(peak, t + A); lp.frequency.setTargetAtTime(base, t + A, 0.03 + dec * 0.6);
    const lvl = [0.32, 0.13, 0.3][pd.wave], end = t + A + dec * 5;
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
  // шелест листвы, пока тормошат дерево; высокий срез — по тому, как сильно
  let rustle = null;
  function shakeTick(dt) {
    shake *= Math.exp(-dt / 1.4);
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
  function skiffHz(q) {
    const d = clamp((q / 0.78 + 0.5) * 14, 0, 14);
    if (T.scaleOn) return noteHz(Math.round(d));
    const lo = Math.floor(d), hi = Math.min(14, lo + 1), a = Math.log2(noteHz(lo)), b = Math.log2(noteHz(hi));
    return 2 ** (a + (b - a) * (d - lo));               // без лада — плавно между ступенями
  }
  function skiffSound(o) {                            // o = { t, q } или null — с воды
    if (!bus) return;
    const t = actx.currentTime;
    if (!o) {
      if (skiff.voice) { const v = skiff.voice; skiff.voice = null; v.a.gain.setTargetAtTime(0, t, 0.25); setTimeout(() => { v.o.stop(); v.o.disconnect(); v.lp.disconnect(); v.a.disconnect(); }, 2000); }
      return;
    }
    if (!skiff.voice) {
      const ctx = actx, osc = ctx.createOscillator(), lp = ctx.createBiquadFilter(), a = ctx.createGain();
      osc.type = ['sine', 'square', 'triangle'][lastWave]; lp.type = 'lowpass'; a.gain.value = 0;
      osc.frequency.value = skiffHz(o.q); osc.connect(lp).connect(a).connect(bus.vin); osc.start();
      skiff.voice = { o: osc, lp, a };
      a.gain.setTargetAtTime([0.26, 0.11, 0.25][lastWave], t, 0.04);
    }
    const hz = skiffHz(o.q), v = skiff.voice;
    v.o.frequency.setTargetAtTime(hz, t, T.scaleOn ? 0.015 : 0.03);
    v.lp.Q.value = 0.7 + fx.res * 10;
    v.lp.frequency.setTargetAtTime(180 * 2 ** (fx.cutoff * 6.6) * (0.5 + 1.8 * o.t), t, 0.05);
    skiff.label = noteName(hz);
    lastSound = performance.now(); setLive(true);
  }

  // часы — по звуковому времени с запасом вперёд (таймер 25 мс, окно 200 мс)
  function schedule() {
    if (!seq.playing || !actx) return;
    const now = actx.currentTime, ahead = now + 0.2;     // запас 200 мс: телефон занят картинкой — ноты всё равно вовремя
    if (!seq.next) seq.next = now + 0.05;
    while (seq.next < ahead) {
      const pd = pads.at[seq.step % pads.len];
      if (pd && seq.next > now + 0.003) playNote(pd, seq.next);   // опоздавшую ноту пропускаем — задним числом она щёлкает
      seq.step++; seq.next += stepSec();
    }
  }
  setInterval(schedule, 25);
  function play(on = !seq.playing) { seq.playing = on; seq.step = 0; seq.next = 0; if (on) schedule(); }
  const phase = () => (seq.playing && actx && seq.next ? Math.max(0, seq.step - (seq.next - actx.currentTime) / stepSec()) : null);

  // ---------- касания: кувшинки, запруда, лодочка ----------
  const touches = new Map();
  const slotOf = (o) => clamp(Math.round(((o.t - T0) / TS) * 16 - 0.5), 0, 15);
  const noteOf = (o) => clamp(Math.round((o.q / 0.78 + 0.5) * 14), 0, 14);
  const inRiver = (G, x, y) => { const o = onRiver(G, x, y); return o && o.t > 0.1 && o.t < 0.995 && Math.abs(o.q) < 0.5 + 6 / river(G, o.t).w; };
  function down(f) {
    const G = geo(), now = performance.now(), pq = pierXY(G);
    if (Math.hypot(f.x - skiff.x, f.y - skiff.y + 4) < 26) {   // запасной кораблик — взять
      skiff.held = true; skiff.home = false; skiff.back = null; skiff.dx = skiff.x - f.x; skiff.dy = skiff.y - f.y;
      touches.set(f.id, { kind: 'skiff' }); return;
    }
    const br = river(G, bridgeT()), bdx = f.x - br.x, bdy = f.y - br.y, al = bdx * br.tx + bdy * br.ty, ac = bdx * br.nx + bdy * br.ny;
    if (Math.abs(al) < 24 && Math.abs(ac) < br.w / 2 + 22) { touches.set(f.id, { kind: 'bridge' }); return; }
    for (let i = 0; i < 16; i++) {                    // кувшинки — раньше лодочки: та плывёт мимо и не должна перехватывать
      const pd = pads.at[i];
      if (!pd) continue;
      const p = padXY(G, i, pd.note);
      if (Math.hypot(f.x - p.x, (f.y - p.y) * 1.4) < 15 * p.s + 8) { touches.set(f.id, { kind: 'pad', i, t0: now }); return; }
    }

    if (Math.hypot(f.x - pq.x - 4, f.y - pq.y) < 24) { touches.set(f.id, { kind: 'boat', bpm0: seq.bpm }); return; }   // причал — после кувшинок
    if (inRiver(G, f.x, f.y)) { touches.set(f.id, { kind: 'plant', path: [[f.x, f.y]] }); return; }
    const cl = cloudAt(G);
    if (Math.abs(f.x - cl.cx) < 34 * cl.s && f.y > cl.cy - 22 * cl.s && f.y < cl.cy + 12 * cl.s) { touches.set(f.id, { kind: 'cloud', v0: fx.cutoff }); return; }
    const tr = G.tree, R = Math.min(G.W * 0.16, G.h * 0.09), cy = tr.y - G.h * 0.13 - R * 0.6;
    if (Math.hypot(f.x - tr.x, f.y - cy) < R * 1.3 || (Math.abs(f.x - tr.x) < 14 && f.y > cy && f.y < tr.y + 6)) { touches.set(f.id, { kind: 'tree', lx: f.x, ly: f.y }); return; }
    if (birdList(G, now).some((b) => Math.hypot(f.x - b.X, f.y - b.Y) < 22)) { touches.set(f.id, { kind: 'birds' }); return; }
    const mi = millAt(G);
    if (Math.hypot(f.x - mi.x, f.y - mi.y) < mi.R + 14 || Math.hypot(f.x - (mi.x - mi.r.nx * (mi.R + 26)), f.y - (mi.y - mi.r.ny * (mi.R + 26) - 14)) < 30) {
      touches.set(f.id, { kind: 'mill', a0: fx.att, r0: fx.rel }); return;
    }
    if (f.y > G.hor - 0.24 * G.h && f.y < G.hor + 4) { touches.set(f.id, { kind: 'mountains', v0: fx.res }); return; }
    touches.set(f.id, { kind: 'none' });
  }
  function move(f) {
    const t = touches.get(f.id);
    if (!t) return;
    const G = geo(), dx = f.x - f.x0, dy = f.y - f.y0;
    if (!t.moved && Math.hypot(dx, dy) > 8) t.moved = true;
    if (t.kind === 'skiff') {                         // ведёшь кораблик: на воде — звучит
      skiff.x = f.x + skiff.dx; skiff.y = f.y + skiff.dy;
      const o = inRiver(G, skiff.x, skiff.y) ? onRiver(G, skiff.x, skiff.y) : null;
      skiffSound(o);
      const last = skiff.trail[skiff.trail.length - 1];
      if (o && (!last || Math.hypot(last.x - skiff.x, last.y - skiff.y) > 10)) skiff.trail.push({ x: skiff.x, y: skiff.y, t: performance.now() });
      return;
    }
    if (t.kind === 'cloud') { fx.cutoff = clamp(t.v0 - dy / 220); t.moved = true; return; }   // туча выше — ярче
    if (t.kind === 'mountains') { fx.res = clamp(t.v0 - dy / 160); t.moved = true; return; }  // горы выше — резонанс
    if (t.kind === 'mill') { fx.att = clamp(t.a0 - dy / 200); fx.rel = clamp(t.r0 + dx / 200); t.moved = true; return; }   // вверх — attack, вбок — release
    if (t.kind === 'tree') {                          // тормошим: чем быстрее водишь по дереву, тем сильнее
      const v = Math.hypot(f.x - t.lx, f.y - t.ly); t.lx = f.x; t.ly = f.y;
      shake = Math.min(1, shake + v / 260); return;
    }
    if (t.kind === 'plant' && t.moved) { t.path.push([f.x, f.y]); return; }   // рисуем по воде
    if (!t.moved) return;
    if (t.kind === 'boat') { seq.bpm = Math.round(clamp(t.bpm0 + dx / 2, 40, 200)); applyFx(); }
    else if (t.kind === 'bridge') { const o = onRiver(G, f.x, f.y); if (o) pads.len = clamp(slotOf({ t: o.t + 0.02 }) + 1, 2, 16); }
    else if (t.kind === 'pad') {                      // поперёк — нота, вдоль — на другое место (если свободно)
      const o = onRiver(G, f.x, f.y), pd = pads.at[t.i], j = slotOf(o), n = noteOf(o);
      if (j !== t.i && !pads.at[j]) { pads.at[j] = pd; pads.at[t.i] = null; t.i = j; }
      if (n !== pd.note) { pd.note = n; if (actx) playNote(pd, actx.currentTime); }
    }
  }
  function up(f) {
    const t = touches.get(f.id);
    touches.delete(f.id);
    if (!t) return;
    const G = geo();
    if (t.kind === 'skiff') { skiff.held = false; skiffSound(null); skiff.back = { x: skiff.x, y: skiff.y, t0: performance.now() }; return; }
    if (t.kind === 'boat' && !t.moved) play();
    else if (t.kind === 'pad' && !t.moved && !t.cycled) pads.at[t.i] = null;      // тап по кувшинке — убрать
    else if (t.kind === 'birds' && !t.moved) { birdsAt = performance.now(); laser(); }   // спугнули — лазер
    else if (t.kind === 'plant' && t.moved) {                                      // провёл по воде через кувшинки — глайд в них
      const hit = [];
      for (let i = 0; i < 16; i++) {
        const pd = pads.at[i];
        if (!pd) continue;
        const p = padXY(G, i, pd.note);
        if (t.path.some(([x, y]) => Math.hypot(x - p.x, (y - p.y) * 1.4) < 15 * p.s + 10)) hit.push(pd);
      }
      const on = !hit.every((pd) => pd.glide);          // все уже скользили — снять
      for (const pd of hit) pd.glide = on;
      wake = { path: t.path, at: performance.now() };
    } else if (t.kind === 'plant' && !t.moved) {                                     // тап по воде — посадить
      const o = onRiver(G, f.x, f.y), i = slotOf(o);
      if (!pads.at[i]) { pads.at[i] = { note: noteOf(o), wave: lastWave }; if (actx) playNote(pads.at[i], actx.currentTime); }
    }
  }
  let lastTick = performance.now();
  function tick(now) {                                // держишь кувшинку — сменить цветок (голос); дерево успокаивается
    shakeTick(Math.min(0.1, (now - lastTick) / 1000)); lastTick = now;
    for (const t of touches.values()) {
      if (t.kind !== 'pad' || t.moved || t.cycled || now - t.t0 < 450) continue;
      const pd = pads.at[t.i];
      if (!pd) continue;
      pd.wave = (pd.wave + 1) % 3; lastWave = pd.wave; t.cycled = true;
      if (actx) playNote(pd, actx.currentTime);
    }
  }
  // глайд: от прошлой кувшинки к скользящей — волнистая струя по воде; свежий след пальца гаснет
  let wake = null;
  function drawGlides(c, G, now) {
    let prev = null;
    c.strokeStyle = ink(0.55); c.lineWidth = 1.1;
    for (let i = 0; i < pads.len; i++) {
      const pd = pads.at[i];
      if (!pd) continue;
      const p = padXY(G, i, pd.note);
      if (pd.glide && prev) {
        c.beginPath();
        for (let k = 0; k <= 16; k++) { const u = k / 16, x = prev.x + (p.x - prev.x) * u, y = prev.y + (p.y - prev.y) * u + Math.sin(u * TAU * 2 + now * 0.004) * 2.2; k ? c.lineTo(x, y) : c.moveTo(x, y); }
        c.stroke();
      }
      prev = p;
    }
    const trails = [...touches.values()].filter((t) => t.kind === 'plant' && t.moved).map((t) => ({ path: t.path, a: 0.7 }));
    if (wake) { const k = (now - wake.at) / 900; if (k < 1) trails.push({ path: wake.path, a: 0.6 * (1 - k) }); else wake = null; }
    for (const tr of trails) {
      c.strokeStyle = ink(tr.a); c.lineWidth = 1.4; c.setLineDash([4, 4]);
      c.beginPath(); tr.path.forEach(([x, y], k) => (k ? c.lineTo(x, y) : c.moveTo(x, y))); c.stroke(); c.setLineDash([]);
    }
  }
  function drawTouches(c, G) {                      // подписи — только пока тянешь
    for (const t of touches.values()) {
      if (!t.moved) continue;
      if (t.kind === 'boat') { const q = pierXY(G); T.mapText(`${seq.bpm} BPM`, q.x, q.y - 26, 15, 0.9, 'center'); }
      else if (t.kind === 'cloud') { const cl = cloudAt(G); T.mapText(`cutoff · ${Math.round(180 * 2 ** (fx.cutoff * 6.6))} Hz`, cl.cx, cl.cy + 24 * cl.s, 14, 0.9, 'center'); }
      else if (t.kind === 'mountains') T.mapText(`res · ${Math.round(fx.res * 100)}%`, G.W / 2, G.hor - 0.26 * G.h, 14, 0.9, 'center');
      else if (t.kind === 'mill') { const mi = millAt(G), ms = (v) => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`); T.mapText(`A ${ms(attSec())} · R ${ms(relSec())}`, mi.x, mi.y + mi.R + 22, 14, 0.9, 'center'); }
      else if (t.kind === 'bridge') { const r = river(G, bridgeT()), p = across(r, 0.5 + 22 / r.w); T.mapText(String(pads.len), p.x, p.y - 12, 16, 0.9, 'center'); }
      else if (t.kind === 'pad' && pads.at[t.i]) { const p = padXY(G, t.i, pads.at[t.i].note); T.mapText(noteName(noteHz(pads.at[t.i].note)), p.x, p.y - 24 - 8 * p.s, 15, 0.95, 'center'); }
    }
  }

  // ---------- мир ----------
  const deg = (d) => (d * Math.PI) / 180;
  const fxw = {
    sectors: [
      { key: 'reverb', label: 'reverb', ang: deg(180) },
      { key: 'delay', label: 'delay', ang: deg(162) },
      { key: 'time', label: 'time', ang: deg(144) },
      { key: 'chorus', label: 'chorus', ang: deg(126) },   // cutoff, res и огибающая — в сцене: туча, горы, мельница
    ],
    get: (k) => fx[k], set: (k, v) => { fx[k] = v; applyFx(); },
    text: (k) => (k === 'time' ? div()[0] : `${Math.round(fx[k] * 100)}%`),
    arc: () => fx.reverb,
    save: () => ({ ...fx }),
    load: (o) => { Object.assign(fx, o); applyFx(); },
  };
  const natura = {
    n: 'IV', title: 'Natura', sub: 'flumen · nymphaeae',
    theme: { ink: INK, bg: `rgb(${PAPER})`, paper: PAPER },
    corner: { hit: (f) => { const G = geo(); return f.y > G.sun.y && Math.hypot(f.x - G.sun.x, f.y - G.sun.y) < G.sun.r + 6; }, draw: () => {} },   // солнце — карта; надгробие пока просто стоит
    fx: fxw,
    draw(now) {
      const c = T.g, G = geo();
      layers(G);
      c.drawImage(skyC, 0, 0, T.W, T.H);
      c.save(); c.beginPath(); c.rect(13, 13, T.W - 26, T.H - T.safeBot - 26); c.clip();
      drawSun(c, G, now);
      drawBirds(c, G, now);
      c.restore();
      c.drawImage(landC, 0, 0, T.W, T.H);
      drawFog(c, G, now);
      drawRainRings(c, G, now);
      drawPier(c, G);
      drawGlides(c, G, now);
      drawPads(c, G, now);
      drawReeds(c, G, now);
      drawTree(c, G);
      drawCloud(c, G, now);
      drawMill(c, G, now);
      drawSkiff(c, G, now);
      drawStone(c, G);
      drawTouches(c, G);
    },
    build, tick, down, move, up,
    mapShot(on) { noSun = on; },
    dice() {                                        // кувшинки по Евклиду, ноты — блуждание по ступеням, цветы — случайно; лодочка плывёт
      const R = Math.random, n = 8 + Math.floor(R() * 9), k = 3 + Math.floor(R() * (n - 4));
      let note = Math.floor(R() * 8);
      pads.len = n;
      pads.at = Array.from({ length: 16 }, (_, i) => {
        if (i >= n || (i * k) % n >= k) return null;
        note = clamp(note + [-2, -1, 1, 2][Math.floor(R() * 4)], 0, 14);
        return { note, wave: Math.floor(R() * 3) };
      });
      if (!seq.playing) play(true);
    },
    clear() { pads.at = Array(16).fill(null); },
    snapshot: () => JSON.stringify({ fx, len: pads.len, at: pads.at, bpm: seq.bpm }),
    restore(js) {
      const st = JSON.parse(js);
      Object.assign(fx, st.fx); delete fx.env; pads.len = st.len; pads.at = st.at.map((p) => (p ? { ...p } : null)); seq.bpm = st.bpm;
      applyFx();
    },
    sounding: () => seq.playing && pads.at.slice(0, pads.len).some(Boolean),
  };
  T.registerWorld(4, natura);
  window.t2d.nat = {
    fx, pads, geo, seq, play, get phase() { return phase(); }, get shake() { return shake; }, get birdsAt() { return birdsAt; },
    skiff: () => ({ x: skiff.x, y: skiff.y - 4, playing: !!skiff.voice, home: skiff.home }),
    cloud: () => { const cl = cloudAt(geo()); return { x: cl.cx, y: cl.cy }; },
    mill: () => { const m = millAt(geo()); return { x: m.x, y: m.y }; },
    tree: () => { const G = geo(), R = Math.min(G.W * 0.16, G.h * 0.09); return { x: G.tree.x, y: G.tree.y - G.h * 0.13 - R * 0.6 }; },
    bird: () => { const b = birdList(geo(), performance.now())[0]; return b && { x: b.X, y: b.Y }; },
    setFx: (k, v) => fxw.set(k, v),
    pad: (i) => { const pd = pads.at[i]; const p = padXY(geo(), i, pd ? pd.note : 7); return { x: p.x, y: p.y }; },
    slot: (i, note) => { const p = padXY(geo(), i, note); return { x: p.x, y: p.y }; },
    boat: () => { const q = pierXY(geo()); return { x: q.x, y: q.y }; },
    bridge: () => { const G = geo(), r = river(G, bridgeT()); return { x: r.x, y: r.y - 6 }; },
  };
})();
