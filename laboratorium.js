// Laboratorium — мир III: FM на четырёх операторах-стихиях. Эскиз картинки, без звука.
// Оператор — колба своего цвета: ignis, aer, aqua, terra. Форма колбы — ratio, уровень жидкости — индекс (у несущей — громкость),
// поверхность жидкости — синус с ratio волнами. Алгоритм — как колбы стоят: модулятор выше и льёт по трубке в того, кого модулирует,
// несущие — нижний ряд, сливают в общий приёмник на атаноре. Цвета смешиваются по трубкам. Обратная связь — «пеликан»,
// трубка из колбы в саму себя. Играть — семь банок металлов-планет (♄ ♃ ♂ ☉ ♀ ☿ ☽) — семь ступеней лада.
// Солнце — в круглом окне справа под верхней строкой; в правом нижнем углу череп с костями — тап — карта. Спека: docs/superpowers/specs/2026-10-20-laboratorium-design.md
(() => {
  'use strict';
  const T = window.T2D;
  const TAU = Math.PI * 2;
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

  // ---------- состояние (демо) ----------
  const OPS = [
    { key: 'ignis', col: [206, 62, 42], up: true, bar: false, ratio: 1, level: 0.7, fb: 0 },
    { key: 'aer', col: [228, 192, 72], up: true, bar: true, ratio: 2, level: 0.5, fb: 0 },
    { key: 'aqua', col: [58, 112, 206], up: false, bar: false, ratio: 0.5, level: 0.62, fb: 0 },
    { key: 'terra', col: [74, 156, 92], up: false, bar: true, ratio: 3, level: 0.4, fb: 0.6 },
  ];
  const mods = [[3, 2], [2, 0]];            // terra → aqua → ignis; aer — несущая сама по себе
  const fx = { athanor: 0.55, vitrum: 0.35, circulatio: 0.3 };

  const carriers = () => OPS.map((_, i) => i).filter((i) => !mods.some((m) => m[0] === i));
  function levelOf(i, seen = new Set()) {
    if (seen.has(i)) return 0;
    seen.add(i);
    const outs = mods.filter((m) => m[0] === i).map((m) => m[1]);
    return outs.length ? 1 + Math.max(...outs.map((j) => levelOf(j, seen))) : 0;
  }
  // цвет жидкости: свой + всё, что в колбу натекло (вес — уровень модулятора)
  function mixed(i, depth = 0) {
    let w = 1, c = OPS[i].col.slice();
    if (depth < 4) for (const [s, d] of mods) if (d === i) {
      const k = 0.6 * OPS[s].level, sc = mixed(s, depth + 1);
      for (let q = 0; q < 3; q++) c[q] += sc[q] * k;
      w += k;
    }
    return c.map((v) => Math.round(v / w));
  }

  // ---------- геометрия: ярусы по алгоритму ----------
  function geo() {
    const W = T.W, H = T.H, top = T.topY + 6, bot = H - T.safeBot - 8, h = bot - top;
    const shelf = bot - 18, egg = { x: W / 2, y: shelf - 0.25 * h }, furn = { y0: egg.y + 22, y1: shelf - 62 };
    const dy = 0.18 * h, r = Math.min(34, W * 0.085, dy / 4.3), L0 = egg.y - 0.17 * h;
    const pos = [], car = carriers();
    car.forEach((i, k) => { pos[i] = { x: W * (car.length === 1 ? 0.5 : 0.28 + (0.46 * k) / (car.length - 1)), y: L0 }; });
    const lv = OPS.map((_, i) => levelOf(i));
    for (let l = 1; l <= 3; l++) {
      const at = OPS.map((_, i) => i).filter((i) => lv[i] === l);
      at.forEach((i, k) => {
        const outs = mods.filter((m) => m[0] === i).map((m) => pos[m[1]]).filter(Boolean);
        const x = outs.length ? outs.reduce((s, p) => s + p.x, 0) / outs.length : W / 2;
        pos[i] = { x: x + (k - (at.length - 1) / 2) * W * 0.3, y: L0 - l * dy };
      });
    }
    return { W, H, top, bot, h, shelf, egg, furn, r, pos, win: { x: W, y: top + 62, r: 48 } };
  }

  // ---------- колбы: форма — ratio ----------
  const shapeOf = (ratio) => (ratio < 1 ? 'flat' : ratio < 2 ? 'round' : ratio < 3 ? 'pear' : ratio < 4 ? 'gourd' : 'tube');
  // контур колбы без устья; neck — верх горлышка
  function flaskPath(c, kind, x, y, r) {
    const nw = r * 0.26, neckTop = y - r * 1.95;
    c.moveTo(x - nw, neckTop);
    const ell = (cx, cy, rx, ry) => { const f = Math.asin(nw / rx); c.lineTo(x - nw, cy - ry * Math.cos(f)); c.ellipse(cx, cy, rx, ry, 0, -Math.PI / 2 - f, -Math.PI / 2 + f, true); };
    if (kind === 'flat') ell(x, y + r * 0.25, r * 1.3, r * 0.68);
    else if (kind === 'round') ell(x, y, r, r);
    else if (kind === 'pear') ell(x, y - r * 0.1, r * 0.78, r * 1.2);
    else if (kind === 'gourd') {
      const ru = r * 0.5, yu = y - r * 0.85, f = Math.asin(nw / ru);
      c.lineTo(x - nw, yu - ru * Math.cos(f));
      c.arc(x, yu, ru, -Math.PI / 2 - f, Math.PI * 0.72, true);
      c.ellipse(x, y + r * 0.2, r * 0.95, r * 0.78, 0, -Math.PI * 0.62, -Math.PI * 0.38, true);
      c.arc(x, yu, ru, Math.PI * 0.28, -Math.PI / 2 + f, true);
    } else { c.lineTo(x - nw * 1.3, y + r * 0.6); c.arc(x, y + r * 0.6, nw * 1.3, Math.PI, 0, true); c.lineTo(x + nw, neckTop); }
    c.lineTo(x + nw, neckTop);
    return { neckTop, nw };
  }
  const bodyBox = (kind, x, y, r) => ({ flat: [y + r * 0.25 - r * 0.68, y + r * 0.93, r * 1.3], round: [y - r, y + r, r], pear: [y - r * 1.3, y + r * 1.1, r * 0.78], gourd: [y - r * 1.35, y + r * 0.98, r * 0.95], tube: [y - r * 1.4, y + r * 0.6 + r * 0.34, r * 0.34] })[kind];

  function drawFlask(c, i, G, now) {
    const o = OPS[i], p = G.pos[i];
    if (!p) return;
    const kind = shapeOf(o.ratio), r = G.r, col = mixed(i);
    const [yTop, yBot, hw] = bodyBox(kind, p.x, p.y, r);
    // жидкость: уровень — индекс; поверхность — синус с ratio волнами, колышется
    c.save();
    c.beginPath(); flaskPath(c, kind, p.x, p.y, r); c.closePath(); c.clip();
    const sy = yBot - o.level * (yBot - yTop), ph = now * 0.002 * (1 + o.ratio * 0.3);
    c.beginPath(); c.moveTo(p.x - hw - 2, yBot + 4);
    for (let X = -hw - 2; X <= hw + 2; X += 2) c.lineTo(p.x + X, sy + Math.sin((X / (2 * hw)) * TAU * o.ratio + ph) * 1.6);
    c.lineTo(p.x + hw + 2, yBot + 4); c.closePath();
    c.fillStyle = rgba(col, 0.78); c.fill();
    c.strokeStyle = rgba(col.map((v) => Math.min(255, v + 60)), 0.9); c.lineWidth = 1; c.stroke();
    // пузыри — огонь атанора
    const nb = Math.round(fx.athanor * 5);
    for (let k = 0; k < nb; k++) {
      const t = (now / (1400 + k * 230) + k * 0.37) % 1, bx = p.x + Math.sin(k * 2.3 + t * 5) * hw * 0.5, by = yBot - 4 - t * (yBot - sy - 4);
      T.ring(bx, by, 1.2 + k * 0.3, 0.5 * (1 - t), 0.8);
    }
    c.restore();
    // стекло: белый контур, устье, блик
    c.strokeStyle = T.ink(0.9); c.lineWidth = 1.2;
    c.beginPath(); const nk = flaskPath(c, kind, p.x, p.y, r); c.stroke();
    c.beginPath(); c.ellipse(p.x, nk.neckTop, nk.nw + 2.5, 2, 0, 0, TAU); c.stroke();
    c.strokeStyle = T.ink(0.35); c.lineWidth = 1;
    c.beginPath(); c.arc(p.x - hw * 0.15, (yTop + yBot) / 2, hw * 0.62, Math.PI * 1.08, Math.PI * 1.4); c.stroke();
    // пеликан — обратная связь: трубка из горлышка обратно в тело, тем толще, чем сильнее
    if (o.fb > 0.02) {
      const sd = p.x <= G.W / 2 ? -1 : 1;           // пеликан — наружу, трубки к соседям — к середине
      const sx = p.x + sd * nk.nw, s0 = nk.neckTop + r * 0.35, ex = p.x + sd * hw * 0.92, ey = (yTop + yBot) / 2 + r * 0.15;
      const path = () => { c.beginPath(); c.moveTo(sx, s0); c.bezierCurveTo(sx + sd * r * 1.5, s0 - r * 0.9, ex + sd * r * 1.4, ey - r * 0.3, ex, ey); };
      tube(c, path, 2 + 3 * o.fb, rgba(col, 0.85), now, o.fb);
    }
    // стихия и ratio — под колбой
    const out = p.x <= G.W / 2 ? -1 : 1, lx = p.x + out * (hw + 16), ly = Math.max(yTop + 8, p.y + r * 0.2);   // подпись — снаружи, у тела колбы
    elementGlyph(c, lx, ly, o.up, o.bar, 6, 0.75);
    T.mapText(ratioText(o.ratio), lx, ly + 17, 14, 0.75, 'center');
    T.mapText(o.key, lx, ly + 32, 11, 0.4, 'center');
  }
  const ratioText = (r) => (r === 0.5 ? '½' : ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'][Math.round(r)] || String(r));
  function elementGlyph(c, x, y, up, bar, s, a) {
    const u = up ? -1 : 1;
    c.strokeStyle = T.ink(a); c.lineWidth = 1;
    c.beginPath(); c.moveTo(x, y + u * s); c.lineTo(x - s * 0.9, y - u * s * 0.6); c.lineTo(x + s * 0.9, y - u * s * 0.6); c.closePath(); c.stroke();
    if (bar) { c.beginPath(); c.moveTo(x - s * 0.8, y + u * s * 0.1); c.lineTo(x + s * 0.8, y + u * s * 0.1); c.stroke(); }
  }
  // стеклянная трубка: белый контур, тёмный просвет, бегут капли цвета источника
  function tube(c, path, w, drop, now, rate = 0.5) {
    c.lineCap = 'round';
    path(); c.strokeStyle = T.ink(0.75); c.lineWidth = w + 2.4; c.stroke();
    path(); c.strokeStyle = T.BG; c.lineWidth = w; c.stroke();
    path(); c.strokeStyle = drop; c.lineWidth = Math.max(1.2, w - 1.2);
    c.setLineDash([2, 7]); c.lineDashOffset = -now * (0.01 + 0.03 * rate); c.stroke(); c.setLineDash([]); c.lineDashOffset = 0;
    c.lineCap = 'butt';
  }

  function drawTubes(c, G, now) {
    const neck = (i) => { const p = G.pos[i]; return { x: p.x, y: p.y - G.r * 1.95 }; };
    for (const [s, d] of mods) {                  // модулятор льёт в горлышко того, кого модулирует
      const a = neck(s), b = neck(d), side = a.x <= G.W / 2 ? 1 : -1, o = G.r * 1.7;   // выгиб — к середине, мимо своих колб
      const path = () => { c.beginPath(); c.moveTo(a.x, a.y - 2); c.bezierCurveTo(a.x + side * o * 0.4, a.y - 40, a.x + side * o, a.y - 10, a.x + side * o, (a.y + b.y) / 2); c.bezierCurveTo(a.x + side * o, b.y - 24, b.x, b.y - 22, b.x, b.y - 4); };
      tube(c, path, 3, rgba(mixed(s), 0.95), now, OPS[s].level);
    }
    for (const i of carriers()) {                 // несущие сливают снизу в приёмник
      const p = G.pos[i], [, yBot] = bodyBox(shapeOf(OPS[i].ratio), p.x, p.y, G.r), e = G.egg;
      const path = () => { c.beginPath(); c.moveTo(p.x, yBot + 40); c.bezierCurveTo(p.x, e.y - 60, e.x + (p.x - e.x) * 0.25, e.y - 70, e.x + (p.x - e.x) * 0.08, e.y - 46); };
      tube(c, path, 3, rgba(mixed(i), 0.95), now, OPS[i].level);
      c.strokeStyle = T.ink(0.8); c.lineWidth = 1.2;  // кран под колбой
      c.beginPath(); c.moveTo(p.x, yBot); c.lineTo(p.x, yBot + 40); c.stroke();
      c.strokeRect(p.x - 4, yBot + 34, 8, 4);
    }
  }

  // приёмник — яйцо философов на атаноре; жидкость — смесь несущих
  function drawEgg(c, G, now) {
    const e = G.egg, car = carriers(), rx = 24, ry = 30;
    let col = [0, 0, 0], w = 0;
    for (const i of car) { const m = mixed(i), k = OPS[i].level; for (let q = 0; q < 3; q++) col[q] += m[q] * k; w += k; }
    col = col.map((v) => Math.round(v / (w || 1)));
    const lv = clamp(w / car.length);
    c.save(); c.beginPath(); c.ellipse(e.x, e.y, rx, ry, 0, 0, TAU); c.clip();
    const sy = e.y + ry - lv * 2 * ry * 0.8;
    c.fillStyle = rgba(col, 0.8); c.beginPath(); c.moveTo(e.x - rx, e.y + ry);
    for (let X = -rx; X <= rx; X += 2) c.lineTo(e.x + X, sy + Math.sin(X * 0.3 + now * 0.003) * 1.4);
    c.lineTo(e.x + rx, e.y + ry); c.closePath(); c.fill();
    c.restore();
    c.strokeStyle = T.ink(0.9); c.lineWidth = 1.2;
    c.beginPath(); c.ellipse(e.x, e.y, rx, ry, 0, -Math.PI / 2 + 0.25, -Math.PI / 2 - 0.25 + TAU); c.stroke();
    c.beginPath(); c.moveTo(e.x - 6, e.y - ry + 1); c.lineTo(e.x - 6, e.y - ry - 14); c.moveTo(e.x + 6, e.y - ry + 1); c.lineTo(e.x + 6, e.y - ry - 14); c.stroke();
    c.beginPath(); c.ellipse(e.x, e.y - ry - 14, 8.5, 2, 0, 0, TAU); c.stroke();
    c.strokeStyle = T.ink(0.35); c.beginPath(); c.arc(e.x - 4, e.y - 2, rx * 0.65, Math.PI * 1.05, Math.PI * 1.4); c.stroke();
  }
  // атанор — печь-башня из кирпича, в арке огонь (FX athanor — выше и гуще)
  function drawFurnace(c, G, now) {
    const { W } = G, x0 = W / 2 - 46, x1 = W / 2 + 46, y0 = G.furn.y0, y1 = G.furn.y1;
    c.fillStyle = T.BG; c.fillRect(x0, y0, x1 - x0, y1 - y0);
    c.strokeStyle = T.ink(0.85); c.lineWidth = 1.2; c.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0);
    c.beginPath(); c.moveTo(x0 - 6, y0); c.lineTo(x1 + 6, y0); c.moveTo(x0 - 6, y1); c.lineTo(x1 + 6, y1); c.stroke();
    c.strokeStyle = T.ink(0.22); c.lineWidth = 0.8; c.beginPath();       // кладка
    for (let y = y0 + 9, row = 0; y < y1; y += 9, row++) { c.moveTo(x0, y); c.lineTo(x1, y); for (let x = x0 + (row % 2 ? 9 : 0); x < x1; x += 18) { c.moveTo(x, y - 9); c.lineTo(x, y); } }
    c.stroke();
    const ax = W / 2, ay = y1, aw = 24, ah = Math.min(44, (y1 - y0) * 0.75);   // арка топки
    c.fillStyle = T.BG; c.beginPath(); c.moveTo(ax - aw, ay); c.lineTo(ax - aw, ay - ah + aw); c.arc(ax, ay - ah + aw, aw, Math.PI, 0); c.lineTo(ax + aw, ay); c.closePath(); c.fill();
    c.strokeStyle = T.ink(0.85); c.lineWidth = 1.2; c.stroke();
    const n = 3 + Math.round(fx.athanor * 3);
    for (let k = 0; k < n; k++) {                 // языки пламени
      const fxp = ax - aw * 0.7 + (k / (n - 1)) * aw * 1.4, hh = (10 + 22 * fx.athanor) * (0.75 + 0.25 * Math.sin(now * 0.011 + k * 1.9)), w = 5;
      c.strokeStyle = T.ink(0.85); c.lineWidth = 1;
      c.beginPath(); c.moveTo(fxp - w, ay - 2); c.quadraticCurveTo(fxp - w * 0.6, ay - hh * 0.6, fxp + Math.sin(now * 0.007 + k) * 2, ay - hh);
      c.quadraticCurveTo(fxp + w * 0.6, ay - hh * 0.6, fxp + w, ay - 2); c.stroke();
    }
  }

  // ---------- семь банок металлов — клавиши (♄ ♃ ♂ ☉ ♀ ☿ ☽ — снизу вверх по ладу) ----------
  const METALS = ['saturnus', 'iupiter', 'mars', 'sol', 'venus', 'mercurius', 'luna'];
  function planet(c, k, x, y, s, a) {
    c.strokeStyle = T.ink(a); c.lineWidth = 1.1; c.beginPath();
    const O = (cx, cy, r) => { c.moveTo(cx + r, cy); c.arc(cx, cy, r, 0, TAU); };
    if (k === 'sol') { O(x, y, s * 0.7); c.stroke(); T.dot(x, y, 1.2, a); return; }
    if (k === 'luna') { c.arc(x, y, s * 0.8, Math.PI * 0.6, Math.PI * 1.4); c.arc(x - s * 0.55, y, s * 0.62, Math.PI * 1.3, Math.PI * 0.7, true); c.stroke(); return; }
    if (k === 'venus') { O(x, y - s * 0.3, s * 0.5); c.moveTo(x, y + s * 0.2); c.lineTo(x, y + s); c.moveTo(x - s * 0.35, y + s * 0.6); c.lineTo(x + s * 0.35, y + s * 0.6); }
    else if (k === 'mars') { O(x - s * 0.15, y + s * 0.2, s * 0.5); c.moveTo(x + s * 0.2, y - s * 0.15); c.lineTo(x + s * 0.75, y - s * 0.7); c.lineTo(x + s * 0.25, y - s * 0.7); c.moveTo(x + s * 0.75, y - s * 0.7); c.lineTo(x + s * 0.75, y - s * 0.2); }
    else if (k === 'mercurius') { O(x, y - s * 0.1, s * 0.4); c.moveTo(x - s * 0.4, y - s); c.quadraticCurveTo(x, y - s * 0.35, x + s * 0.4, y - s); c.moveTo(x, y + s * 0.3); c.lineTo(x, y + s); c.moveTo(x - s * 0.3, y + s * 0.65); c.lineTo(x + s * 0.3, y + s * 0.65); }
    else if (k === 'iupiter') { c.moveTo(x - s * 0.6, y - s * 0.6); c.quadraticCurveTo(x - s * 0.1, y - s * 0.9, x - s * 0.2, y - s * 0.2); c.lineTo(x - s * 0.7, y + s * 0.3); c.lineTo(x + s * 0.7, y + s * 0.3); c.moveTo(x + s * 0.35, y - s * 0.8); c.lineTo(x + s * 0.35, y + s); }
    else if (k === 'saturnus') { c.moveTo(x - s * 0.3, y - s); c.lineTo(x - s * 0.3, y + s * 0.3); c.moveTo(x - s * 0.7, y - s * 0.6); c.lineTo(x + s * 0.1, y - s * 0.6); c.moveTo(x - s * 0.3, y - s * 0.05); c.quadraticCurveTo(x + s * 0.6, y - s * 0.5, x + s * 0.35, y + s * 0.4); c.quadraticCurveTo(x + s * 0.15, y + s, x + s * 0.6, y + s * 0.85); }
    c.stroke();
  }
  function drawJars(c, G, now) {
    const n = 7, y = G.shelf, x0 = 16, x1 = G.W - 78, w = Math.min(34, (x1 - x0) / n - 7);
    c.strokeStyle = T.ink(0.8); c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(10, y + 0.5); c.lineTo(x1 + 4, y + 0.5); c.moveTo(10, y + 5.5); c.lineTo(x1 + 4, y + 5.5); c.stroke();
    const playing = Math.floor(now / 625) % n;          // эскиз: «играет» по очереди
    for (let i = 0; i < n; i++) {
      const X = x0 + ((i + 0.5) / n) * (x1 - x0), h = 40, on = i === playing, a = on ? 1 : 0.6;
      c.strokeStyle = T.ink(a); c.lineWidth = on ? 1.5 : 1.1;
      c.beginPath();                                  // банка: плечики, горло, крышка
      c.moveTo(X - w / 2, y); c.lineTo(X - w / 2, y - h + 10); c.quadraticCurveTo(X - w / 2, y - h + 4, X - w / 4, y - h + 3);
      c.lineTo(X + w / 4, y - h + 3); c.quadraticCurveTo(X + w / 2, y - h + 4, X + w / 2, y - h + 10); c.lineTo(X + w / 2, y); c.stroke();
      c.strokeRect(X - w / 4 - 1, y - h - 2, w / 2 + 2, 5);
      c.beginPath(); c.arc(X, y - h - 4, 2, Math.PI, 0); c.stroke();
      planet(c, METALS[i], X, y - h / 2 + 4, 7, a);
    }
  }

  // круглое окно справа — в нём солнце; луч света падает в лабораторию
  function drawWindow(c, G, now) {
    const { x, y, r } = G.win;
    c.save();
    c.strokeStyle = T.ink(0.05); c.lineWidth = 1; c.beginPath();
    for (let k = -5; k <= 5; k++) { c.moveTo(x - r * 0.6, y + k * 6); c.lineTo(x - G.W * 0.75, y + G.h * 0.55 + k * 10); }
    c.stroke();
    c.fillStyle = T.BG; c.beginPath(); c.arc(x, y, r + 6, 0, TAU); c.fill();
    c.beginPath(); c.arc(x, y, r, 0, TAU); c.clip();
    T.sunGlyph(c, x - 10, y, 0, TAU, 0.95, now);
    c.restore();
    T.ring(x, y, r, 0.85, 1.4); T.ring(x, y, r + 5, 0.4, 1);
    c.strokeStyle = T.ink(0.5); c.lineWidth = 1; c.beginPath();       // переплёт
    for (const a of [Math.PI * 0.5, Math.PI, Math.PI * 1.5]) { c.moveTo(x, y); c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
    c.stroke();
    c.strokeStyle = T.ink(0.35); c.beginPath(); c.arc(x, y, r * 0.5, Math.PI / 2, Math.PI * 1.5); c.stroke();
  }

  // череп с костями в правом нижнем углу (у Cymatica там резонатор, у Natura напротив — надгробие): тап — карта
  const skullAt = () => ({ x: T.W - 38, y: T.H - T.safeBot - 40 });
  function drawSkull(c) {
    const { x, y } = skullAt();
    const bone = (a) => {                             // кость: стержень и по два мыщелка на концах
      const cs = Math.cos(a), sn = Math.sin(a), L = 30, px = -sn, py = cs;
      c.strokeStyle = T.ink(0.85); c.lineWidth = 1.1; c.fillStyle = T.BG;
      c.beginPath(); c.moveTo(x - cs * L + px * 2.5, y + 8 - sn * L + py * 2.5); c.lineTo(x + cs * L + px * 2.5, y + 8 + sn * L + py * 2.5);
      c.moveTo(x - cs * L - px * 2.5, y + 8 - sn * L - py * 2.5); c.lineTo(x + cs * L - px * 2.5, y + 8 + sn * L - py * 2.5); c.stroke();
      for (const e of [-1, 1]) for (const q of [-1, 1]) {
        const ex = x + e * cs * (L + 2) + q * px * 3.5, ey = y + 8 + e * sn * (L + 2) + q * py * 3.5;
        c.beginPath(); c.arc(ex, ey, 4, 0, TAU); c.fill(); c.stroke();
      }
    };
    bone(Math.PI / 5); bone(-Math.PI / 5);
    c.fillStyle = T.BG; c.strokeStyle = T.ink(0.9); c.lineWidth = 1.3;
    c.beginPath(); c.arc(x, y - 4, 17, Math.PI * 0.82, Math.PI * 2.18);   // свод
    c.lineTo(x + 10, y + 12); c.lineTo(x + 9, y + 20); c.lineTo(x - 9, y + 20); c.lineTo(x - 10, y + 12); c.closePath(); c.fill(); c.stroke();
    c.lineWidth = 1.1;
    c.strokeStyle = T.ink(0.85);
    for (const e of [-1, 1]) { c.beginPath(); c.ellipse(x + e * 7, y - 2, 5, 5.5, e * 0.3, 0, TAU); c.stroke(); }   // глазницы — тёмные, обведены
    c.beginPath(); c.moveTo(x, y + 4); c.lineTo(x - 2.5, y + 9); c.lineTo(x + 2.5, y + 9); c.closePath(); c.stroke();
    c.strokeStyle = T.ink(0.35); c.lineWidth = 0.7; c.beginPath();      // штриховка в глазницах
    for (const e of [-1, 1]) for (let q = -3; q <= 3; q += 2) { c.moveTo(x + e * 7 - 3, y - 2 + q); c.lineTo(x + e * 7 + 3, y - 2 + q + 1.5); }
    c.stroke(); c.lineWidth = 1.1;
    c.strokeStyle = T.ink(0.75); c.beginPath(); c.moveTo(x - 8, y + 15); c.lineTo(x + 8, y + 15);
    for (let k = -6; k <= 6; k += 3) { c.moveTo(x + k, y + 12.5); c.lineTo(x + k, y + 18); }
    c.stroke();
    c.strokeStyle = T.ink(0.3); c.beginPath(); c.arc(x - 3, y - 6, 12, Math.PI * 1.1, Math.PI * 1.45); c.stroke();   // блик на своде
  }

  // ---------- мир ----------
  const deg = (d) => (d * Math.PI) / 180;
  const fxw = {
    sectors: [
      { key: 'athanor', label: 'athanor', ang: deg(180) },
      { key: 'vitrum', label: 'vitrum', ang: deg(150) },
      { key: 'circulatio', label: 'circulatio', ang: deg(120) },
    ],
    get: (k) => fx[k], set: (k, v) => { fx[k] = v; }, text: (k) => `${Math.round(fx[k] * 100)}%`,
    arc: () => fx.vitrum, save: () => ({ ...fx }), load: (o) => Object.assign(fx, o),
  };
  const lab = {
    n: 'III', title: 'Laboratorium', sub: 'operatores quattuor · nondum sonat',
    corner: { hit: (f) => { const p = skullAt(); return Math.hypot(f.x - p.x, f.y - p.y) < 46; }, draw: drawSkull },
    fx: fxw,
    draw(now) {
      const c = T.g, G = geo();
      c.fillStyle = T.BG; c.fillRect(0, 0, T.W, T.H);
      drawWindow(c, G, now);
      drawFurnace(c, G, now);
      drawTubes(c, G, now);
      for (let i = 0; i < OPS.length; i++) drawFlask(c, i, G, now);
      drawEgg(c, G, now);
      drawJars(c, G, now);
      drawSkull(c);
    },
    down() {}, move() {}, up() {},
    clear() {}, snapshot: () => JSON.stringify({ fx }), restore(js) { Object.assign(fx, JSON.parse(js).fx); },
    sounding: () => false,
  };
  T.registerWorld(3, lab);
  window.t2d.lab = { OPS, mods, fx, geo, mixed };
})();
