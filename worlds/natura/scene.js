// Natura — пейзаж карты Таро: геометрия реки (сцена портретная, на широком экране — по центру) и гравюры — горы, рамка, древо, туча,
// заводь с утками, кувшинки, кораблики, надгробие. Только картинка: читает состояние модели (fx, seq, pads, shake), звук не трогает.
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const TAU = Math.PI * 2;
export const INK = '38,26,16', PAPER = '226,211,174';
export const ink = (a) => `rgba(${INK},${a})`;
export const pap = (a) => `rgba(${PAPER},${a})`;

export function createScene(T, st) {
  const { fx, seq, pads } = st;
  const shown = (k) => fx[k];                        // пейзаж — общие настройки

  // ---------- геометрия: река от гор к зрителю и вправо, надгробие слева — на ближнем берегу, шире к нам; «поперёк» — по нормали к течению ----------
  // сцена — карта Таро, портретная: на широком экране (iPad, компьютер) рисуется по центру шириной не больше 0.62 высоты,
  // по бокам — та же бумага; касания сдвигаются на её левый край (stage)
  const stage = () => { const w = Math.min(T.W, Math.round((T.H - T.safeBot) * 0.62)); return { w, ox: Math.round((T.W - w) / 2) }; };
  const sh = (f) => { const o = stage().ox; return o ? { ...f, x: f.x - o, x0: f.x0 - o } : f; };
  function geo() {
    const W = stage().w, H = T.H, top = T.topY + 26, bot = H - T.safeBot - 40, h = bot - top;
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
    const k = `${G.W}x${G.H}x${T.DPR}|${G.top}|${G.bot}|${Math.round(shown('res') * 24)}`;   // горы растут с резонансом
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
    const mh = 0.45 + 1.3 * (Math.round(shown('res') * 24) / 24);   // резонанс — выше горы
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
  const sunAt = (G) => ({ x: G.sun.x, y: G.sun.y + clamp((96 - seq.bpm) / 56) * (G.hor - G.sun.y - G.sun.r * 0.35), r: G.sun.r });
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
  function cloud(c, X, Y, s, a, heavy = 0) {
    const w = 64 * s;
    c.save(); c.translate(X, Y);
    const each = (fn) => { for (const [dx, dy, r] of LOBES) { c.beginPath(); c.arc(dx * w, dy * w, r * w, 0, TAU); fn(); } };
    c.strokeStyle = ink(a); c.lineWidth = 2.6; each(() => c.stroke());
    c.fillStyle = pap(1); each(() => c.fill());
    c.beginPath(); for (const [dx, dy, r] of LOBES) { c.moveTo(dx * w + r * w, dy * w); c.arc(dx * w, dy * w, r * w, 0, TAU); } c.clip();
    c.strokeStyle = ink(a * 0.3); c.lineWidth = 0.7; c.beginPath();      // тень снизу — короткие дуги-штрихи
    for (let y = (0.11 - 0.3 * heavy) * w; y < 0.32 * w; y += 3 - heavy) { c.moveTo(-0.6 * w, y); c.quadraticCurveTo(0, y + 0.04 * w, 0.6 * w, y); }
    c.stroke();   // низкая туча (cutoff закрыт) — тень поднимается выше, туча тяжелеет — только внутри клубов
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
    } else if (w === 3) {                             // пила — вертушка: лепестки-зубья, все в одну сторону
      for (let k = 0; k < 5; k++) {
        c.save(); c.rotate((k / 5) * TAU); c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -s * 1.08); c.quadraticCurveTo(s * 0.62, -s * 0.5, s * 0.5, -s * 0.12); c.closePath(); c.fill(); c.stroke(); c.restore();
      }
      c.beginPath(); c.arc(0, 0, s * 0.18, 0, TAU); c.fillStyle = ink(a); c.fill();
    } else if (w === 4) {                             // шарп — чертополох: чашечка в сетку и колючий венец
      c.beginPath();
      for (let k = 0; k <= 8; k++) { const an = Math.PI * (1.1 + (k / 8) * 0.8), r = k % 2 ? s * 0.7 : s * 1.15; c.lineTo(Math.cos(an) * r, Math.sin(an) * r - s * 0.15); }
      c.stroke();
      c.beginPath(); c.ellipse(0, s * 0.05, s * 0.48, s * 0.42, 0, 0, TAU); c.fill(); c.stroke();
      c.lineWidth = 0.6; c.beginPath(); c.moveTo(-s * 0.3, -s * 0.2); c.lineTo(s * 0.3, s * 0.3); c.moveTo(s * 0.3, -s * 0.2); c.lineTo(-s * 0.3, s * 0.3); c.moveTo(-s * 0.45, s * 0.05); c.lineTo(s * 0.45, s * 0.05); c.stroke();
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
  const LILY = 18;                                   // полуширина листа (×перспектива): под палец
  function lily(c, p, wave, open, a, locked, chance = 1) {
    const rx = LILY * p.s, ry = rx * 0.48;
    if (locked) { c.strokeStyle = ink(a * 0.55); c.lineWidth = 0.7; c.beginPath(); c.ellipse(p.x, p.y, rx + 3.5, ry + 2.2, 0, 0.35, TAU - 0.05); c.stroke(); }   // своё значение — двойной обвод, как рамка гравюры
    c.fillStyle = pap(1); c.strokeStyle = ink(a); c.lineWidth = 1.1;
    if (chance < 1) { a *= 0.45 + 0.55 * chance; c.strokeStyle = ink(a); c.setLineDash([4, 2.5]); }   // шанс < 100 % — бледнее, лист пунктиром
    c.beginPath(); c.ellipse(p.x, p.y, rx, ry, 0, 0.35, TAU - 0.05); c.lineTo(p.x, p.y); c.closePath(); c.fill(); c.stroke(); c.setLineDash([]);
    c.lineWidth = 0.6; c.strokeStyle = ink(a * 0.5); c.beginPath();
    for (const q of [1.2, 2.1, 3.0, 3.9, 4.8]) { c.moveTo(p.x, p.y); c.lineTo(p.x + Math.cos(q) * rx * 0.8, p.y + Math.sin(q) * ry * 0.8); }
    c.stroke();
    flower(c, p.x - rx * 0.15, p.y - ry * 0.4, wave, (5 + 5.5 * p.s) * (0.75 + 0.45 * open), a);
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
  // ---------- утки внизу реки, лицом к лицу: огибающая. Левая — attack (на ноте ныряет головой: дольше attack — медленнее),
  // правая — release (круги от неё расходятся и гаснут за release). Тянешь утку вверх — больше и длиннее, вниз — меньше ----------
  const pondAt = (G) => ({ x: G.W * 0.36, y: G.y1 - G.h * 0.115, rx: G.W * 0.16, ry: 19 });   // заводь на ближнем берегу: утки не мешают кувшинкам
  function ducksAt(G) {
    const P = pondAt(G), gap = P.rx * 0.4, r = { x: P.x, y: P.y + 3 };
    const bob = (k) => Math.sin(performance.now() * 0.0014 + k * 2.1) * 1.2, S = (v) => 12 + 14 * v;
    return {
      A: { x: r.x - gap, y: r.y + bob(0), s: S(shown('att')), dir: 1 },
      R: { x: r.x + gap, y: r.y + bob(1), s: S(shown('rel')), dir: -1 },
    };
  }
  function duck(c, d, nod) {
    const { x, y, s, dir } = d;
    c.save(); c.translate(x, y); c.scale(dir * s, s);
    c.lineWidth = 1.15 / s; c.strokeStyle = ink(0.9); c.fillStyle = pap(1);
    c.beginPath();                                    // тело: хвост торчком, круглая грудь
    c.moveTo(-1.15, -0.55); c.quadraticCurveTo(-1.05, 0.05, -0.75, 0.1); c.quadraticCurveTo(-0.1, 0.3, 0.55, 0.12);
    c.quadraticCurveTo(0.9, -0.05, 0.72, -0.38); c.quadraticCurveTo(0.2, -0.62, -0.55, -0.42); c.closePath(); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(-0.7, -0.3); c.quadraticCurveTo(-0.15, -0.02, 0.4, -0.22);   // крыло и перья
    c.moveTo(-0.55, -0.2); c.lineTo(-0.85, -0.12); c.moveTo(-0.35, -0.13); c.lineTo(-0.7, -0.02); c.stroke();
    c.lineWidth = 0.7 / s; c.strokeStyle = ink(0.5); c.beginPath();   // штрих по низу — тень на воде
    for (let k = 0; k < 4; k++) { const u = -0.6 + k * 0.32; c.moveTo(u, 0.02 + k * 0.01); c.lineTo(u + 0.22, 0.12); }
    c.stroke();
    c.save(); c.translate(0.55, -0.4); c.rotate(nod * 1.5);   // голова — на шее, ныряет вперёд
    c.lineWidth = 1.15 / s; c.strokeStyle = ink(0.9);
    c.beginPath(); c.moveTo(-0.08, 0.02); c.quadraticCurveTo(-0.05, -0.35, 0.02, -0.5); c.moveTo(0.18, 0.02); c.quadraticCurveTo(0.14, -0.3, 0.2, -0.45); c.stroke();
    c.beginPath(); c.arc(0.1, -0.62, 0.24, 0, TAU); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(0.3, -0.66); c.quadraticCurveTo(0.52, -0.66, 0.6, -0.56); c.quadraticCurveTo(0.45, -0.5, 0.3, -0.54); c.fill(); c.stroke();
    c.fillStyle = ink(0.9); c.beginPath(); c.arc(0.16, -0.68, 0.04, 0, TAU); c.fill();
    c.restore();
    c.lineWidth = 0.8 / s; c.strokeStyle = ink(0.55); c.beginPath();   // вода у бортов
    c.moveTo(-1.45, 0.16); c.lineTo(-1.0, 0.16); c.moveTo(0.75, 0.16); c.lineTo(1.15, 0.16); c.stroke();
    c.restore();
  }
  function drawPond(c, G, now) {
    const P = pondAt(G);
    c.fillStyle = pap(1); c.strokeStyle = ink(0.8); c.lineWidth = 1.1;
    c.beginPath(); c.ellipse(P.x, P.y, P.rx, P.ry, 0, 0, TAU); c.fill(); c.stroke();
    c.strokeStyle = ink(0.35); c.lineWidth = 0.8; c.beginPath();   // вода — волнистые штрихи, как на реке
    for (const [u, v, l] of [[-0.6, -0.35, 0.3], [0.15, -0.45, 0.35], [-0.2, 0.5, 0.4], [0.45, 0.35, 0.25]]) {
      const x0 = P.x + u * P.rx, y0 = P.y + v * P.ry, L = l * P.rx;
      c.moveTo(x0, y0); c.quadraticCurveTo(x0 + L / 4, y0 - 2, x0 + L / 2, y0); c.quadraticCurveTo(x0 + (3 * L) / 4, y0 + 2, x0 + L, y0);
    }
    c.stroke();
    c.strokeStyle = ink(0.7); c.lineWidth = 0.9;      // пара камышин у края
    for (const [u, h] of [[-0.95, 26], [-0.85, 18], [0.93, 22]]) {
      const x0 = P.x + u * P.rx, y0 = P.y - 2;
      c.beginPath(); c.moveTo(x0, y0); c.quadraticCurveTo(x0 + 1, y0 - h / 2, x0 + 3, y0 - h); c.stroke();
      c.beginPath(); c.ellipse(x0 + 2.6, y0 - h + 4, 1.8, 4.5, 0.15, 0, TAU); c.fillStyle = ink(0.75); c.fill();
    }
  }
  function flyer(c, x, y, s, dir, flap) {            // утка в полёте, профиль: шея вытянута, крылья машут (дальнее бледнее)
    c.save(); c.translate(x, y); c.scale(dir * s, s);
    c.lineWidth = 1.1 / s; c.lineJoin = 'round'; c.fillStyle = pap(1);
    const wing = (f, a) => {                          // крыло от плеча: f — взмах (1 вверх, −1 вниз)
      const tipX = -0.45, tipY = -0.1 - 1.15 * f;
      c.strokeStyle = ink(a); c.beginPath(); c.moveTo(0.35, -0.12);
      c.bezierCurveTo(0.5, -0.12 - 0.7 * f, 0.1, tipY + 0.15 * f, tipX, tipY);
      c.bezierCurveTo(-0.2, -0.1 - 0.55 * f, -0.15, -0.12 - 0.15 * f, -0.2, -0.08); c.closePath(); c.fill(); c.stroke();
      c.beginPath();                                  // маховые перья у кончика
      for (let k = 1; k <= 3; k++) { const u = k / 4; c.moveTo(tipX + 0.18 * u, tipY + (0.25 + 0.2 * u) * f); c.lineTo(tipX + 0.05 + 0.3 * u, tipY + (0.55 + 0.1 * u) * f); }
      c.strokeStyle = ink(a * 0.5); c.stroke();
    };
    wing(flap * 0.85, 0.5);
    c.strokeStyle = ink(0.9);
    c.beginPath(); c.moveTo(0.95, -0.06); c.bezierCurveTo(0.55, 0.3, -0.55, 0.28, -0.95, 0.04); c.bezierCurveTo(-0.6, -0.2, 0.45, -0.26, 0.95, -0.06); c.fill(); c.stroke();   // тело
    c.beginPath(); c.moveTo(-0.92, 0.0); c.lineTo(-1.2, -0.08); c.lineTo(-1.14, 0.1); c.closePath(); c.fill(); c.stroke();   // хвост
    c.beginPath(); c.moveTo(0.85, -0.12); c.quadraticCurveTo(1.15, -0.2, 1.36, -0.2); c.moveTo(0.92, 0.04); c.quadraticCurveTo(1.18, -0.02, 1.38, -0.06); c.stroke();   // шея
    c.beginPath(); c.ellipse(1.47, -0.14, 0.15, 0.12, -0.2, 0, TAU); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(1.58, -0.17); c.quadraticCurveTo(1.75, -0.16, 1.84, -0.09); c.quadraticCurveTo(1.72, -0.07, 1.6, -0.08); c.fill(); c.stroke();   // клюв
    c.fillStyle = ink(0.9); c.beginPath(); c.arc(1.5, -0.17, 0.025, 0, TAU); c.fill(); c.fillStyle = pap(1);
    c.strokeStyle = ink(0.5); c.beginPath(); c.moveTo(0.88, -0.1); c.lineTo(0.94, 0.03); c.stroke();   // белый ошейник
    wing(flap, 0.9);
    c.restore();
  }
  // утята за правой уткой: больше release — больше утят (до 4), плывут по краю заводи; когда утки улетают — остаются
  function ducklings(G, now, D) {
    const n = Math.round(fx.rel * 4), P = pondAt(G), out = [];
    for (let k = 0; k < n; k++) {
      const a = 0.45 + k * 0.5 + Math.sin(now * 0.0007 + k) * 0.05;   // вереницей по ближнему краю заводи, за мамой
      out.push({ x: P.x + P.rx * 0.8 * Math.cos(a), y: P.y + 3 + P.ry * 0.62 * Math.sin(a) + Math.sin(now * 0.002 + k * 1.3) * 0.8, s: 7, dir: -1 });
    }
    return out;
  }
  const skiffHome = (G) => { const r = river(G, 0.3), p = across(r, -0.5 - 30 / r.w); return { x: p.x, y: p.y + 4 }; };
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
    const x = G.tree.x + Math.sin(performance.now() * 0.03) * st.shake * 5;   // тормошат — крона ходит
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
    const nf = Math.round(st.shake * 8), now = performance.now();       // опадают листья
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
    cloud(c, cx, cy, s, 0.95, clamp((0.6 - shown('cutoff')) / 0.6));
  }
  // туча: выше — фильтр открыт, ниже — глухо
  const cloudAt = (G) => { const s = (G.W * 0.34) / 64; return { s, cx: Math.min(G.tree.x, G.W - 34 * s), cy: G.cloudY + G.h * 0.04 + (1 - shown('cutoff')) * G.h * 0.07 }; };
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

  return {
    stage, sh, geo, river, across, onRiver, T0, TS, slotT, padXY, layers, get skyC() { return skyC; }, get landC() { return landC; },
    hatchIn, leaf, cloud, rain, flower, sunAt, drawFog, drawBridge, LILY, lily, boatShape, pondAt, ducksAt, duck, drawPond, flyer, ducklings,
    skiffHome, pierXY, drawPier, bridgeT, drawRainRings, drawReeds, drawTree, drawCloud, cloudAt, drawStone,
  };
}
