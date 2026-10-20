// Laboratorium — мир III: четыре колбы — четыре свободных генератора, как у Lyra-8; модулируют друг друга по трубкам (FM).
// Колба — синус своей высоты: тянешь вбок — высота (с ладом — по ступеням), вверх-вниз — уровень жидкости: у модулятора индекс,
// у несущей — громкость. Поверхность колышется тем чаще, чем выше колба звучит. Трубка от горлышка к другой колбе — первая
// модулирует вторую; от горлышка в саму себя — «пеликан», обратная связь; тап по трубке — снять. Колбы сами встают по ярусам:
// кто никуда не льёт — несущая, внизу, сливает в яйцо на атаноре. Цвета смешиваются по трубкам. Тап по печи — огонь:
// горит — дрон звучит; кувшин с водой у печи — тап: заливает огонь, всё затихает. Семь банок металлов (♄ ♃ ♂ ☉ ♀ ☿ ☽) — клавиши, как сенсоры Lyra: держишь — аппарат
// звучит на ноте банки (до трёх разом), двойной тап — оставить звучать, банку вверх-вниз — её нота. Поверхность жидкости — форма волны
// колбы (FM считается напрямую), в яйце — живая осциллограмма выхода. FX: athanor — жар (сатуратор), vitrum — стеклянный ревер, circulatio — медленное бурление индексов.
// Солнце — четверть в правом верхнем углу (к центру карты), тап — карта; в правом нижнем — четверть древа жизни (корни — у змей).
// Спека: docs/superpowers/specs/2026-10-20-laboratorium-design.md
(() => {
  'use strict';
  const T = window.T2D;
  const TAU = Math.PI * 2;
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const F_LO = 27.5, F_HI = 1760;

  // ---------- состояние ----------
  const OPS = [
    { key: 'ignis', col: [206, 62, 42], up: true, bar: false, shape: 'round', f: 110, level: 0.7, fb: 0 },
    { key: 'aer', col: [228, 192, 72], up: true, bar: true, shape: 'pear', f: 165, level: 0.5, fb: 0 },
    { key: 'aqua', col: [58, 112, 206], up: false, bar: false, shape: 'flat', f: 55, level: 0.45, fb: 0 },
    { key: 'terra', col: [74, 156, 92], up: false, bar: true, shape: 'gourd', f: 331, level: 0.35, fb: 0.4 },
  ];
  let mods = [[3, 2], [2, 0]];               // terra → aqua → ignis; aer — несущая сама по себе
  const fx = { athanor: 0.35, vitrum: 0.35, circulatio: 0.25 };
  let fire = false, heat = 0;                // огонь: горит ли и как разгорелся (картинка)
  // банки: ноты в полутонах от 55 Гц (по умолчанию — A натуральный минор от A2); нота банки транспонирует весь аппарат относительно A2
  const JAR_DEF = [12, 14, 15, 17, 19, 20, 22], REF = 110;
  const jars = JAR_DEF.slice();

  const carriers = () => OPS.map((_, i) => i).filter((i) => !mods.some((m) => m[0] === i));
  function levelOf(i, seen = new Set()) {
    if (seen.has(i)) return 0;
    seen.add(i);
    const outs = mods.filter((m) => m[0] === i).map((m) => m[1]);
    return outs.length ? 1 + Math.max(...outs.map((j) => levelOf(j, new Set(seen)))) : 0;
  }
  const reaches = (a, b, seen = new Set()) => a === b || (!seen.has(a) && (seen.add(a), mods.some(([s, d]) => s === a && reaches(d, b, seen))));
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
  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const noteName = (f) => { const m = Math.round(33 + 12 * Math.log2(f / 55)); return `${NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`; };

  // ---------- геометрия: ярусы по алгоритму; на экране колбы плавно доезжают ----------
  function geo() {
    const W = T.W, H = T.H, top = T.topY + 6, bot = H - T.safeBot - 8, h = bot - top;
    const shelf = bot - 18, egg = { x: W / 2, y: shelf - 0.25 * h }, furn = { y0: egg.y + 22, y1: shelf - 62 };
    const dy = 0.18 * h, r = Math.min(34, W * 0.085, dy / 4.3), L0 = egg.y - 0.17 * h;
    const pos = [], car = carriers();
    car.forEach((i, k) => { pos[i] = { x: W * (car.length === 1 ? 0.5 : 0.24 + (0.52 * k) / (car.length - 1)), y: L0 }; });
    const lv = OPS.map((_, i) => levelOf(i));
    for (let l = 1; l <= 3; l++) {
      const at = OPS.map((_, i) => i).filter((i) => lv[i] === l);
      at.forEach((i, k) => {
        const outs = mods.filter((m) => m[0] === i).map((m) => pos[m[1]]).filter(Boolean);
        const x = outs.length ? outs.reduce((s, p) => s + p.x, 0) / outs.length : W / 2;
        pos[i] = { x: clamp(x + (k - (at.length - 1) / 2) * W * 0.3, W * 0.16, W * 0.84), y: L0 - l * dy };
      });
    }
    return { W, H, top, bot, h, shelf, egg, furn, r, pos, sun: { x: W, y: T.topY + 2, r: Math.min(64, W * 0.16) } };   // солнце — в правом верхнем углу, к центру карты
  }
  const shown = [];                          // где колбы нарисованы сейчас (едут к своим ярусам)
  function ease(G, dt) {
    const k = 1 - Math.exp(-dt / 0.12);
    G.pos.forEach((p, i) => { if (!shown[i]) shown[i] = { ...p }; shown[i].x += (p.x - shown[i].x) * k; shown[i].y += (p.y - shown[i].y) * k; });
  }
  const P = (i) => shown[i] || geo().pos[i];

  // ---------- колбы: форма — у каждой стихии своя ----------
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
  function flaskGeo(G, i) {
    const p = P(i), [yTop, yBot, hw] = bodyBox(OPS[i].shape, p.x, p.y, G.r);
    return { p, yTop, yBot, hw, neckTop: p.y - G.r * 1.95, nw: G.r * 0.26 };
  }

  // форма волны колбы — то, что она звучит: FM считается напрямую по фазе (как в звуке: девиация = уровень × 3 × частота приёмника),
  // окно — тем больше периодов, чем выше колба звучит; кеш по параметрам
  const waveCache = new Map();
  function waveOf(i) {
    const key = `${i}|${OPS.map((o) => `${o.f.toFixed(2)},${o.level.toFixed(3)},${o.fb}`).join(';')}|${mods.join(';')}`;
    let w = waveCache.get(key);
    if (w) return w;
    if (waveCache.size > 64) waveCache.clear();
    const per = clamp(1 + Math.log2(OPS[i].f / F_LO) * 0.8, 1, 6), N = 72, STEP = 9, M = (N - 1) * STEP + 1, dt = per / OPS[i].f / M;
    const ph = new Float64Array(4), y = new Float64Array(4);
    w = new Float32Array(N);
    for (let s = 0; s < M; s++) {
      for (let k = 0; k < 4; k++) y[k] = Math.sin(ph[k]);
      if (s % STEP === 0) w[s / STEP] = y[i];
      for (let k = 0; k < 4; k++) {
        const o = OPS[k];
        let fr = o.f + o.fb * o.f * 1.2 * y[k];
        for (const [a, b] of mods) if (b === k) fr += OPS[a].level * 3 * o.f * y[a];
        ph[k] += TAU * fr * dt;
      }
    }
    waveCache.set(key, w);
    return w;
  }

  const tubes = [];                          // для попадания пальцем: [{ s, d, pts }] и пеликаны [{ i, pts }]
  function drawFlask(c, i, G, now, held) {
    const o = OPS[i], { p, yTop, yBot, hw } = flaskGeo(G, i), r = G.r, col = mixed(i);
    c.save();
    c.beginPath(); flaskPath(c, o.shape, p.x, p.y, r); c.closePath(); c.clip();
    const sy = yBot - o.level * (yBot - yTop), wv = waveOf(i), n = wv.length, amp = Math.min(5, (yBot - yTop) * 0.12) * (0.8 + 0.3 * heat);
    c.beginPath(); c.moveTo(p.x - hw - 2, yBot + 4);
    for (let k = 0; k < n; k++) c.lineTo(p.x - hw - 2 + (k / (n - 1)) * (2 * hw + 4), sy - wv[k] * amp);   // поверхность — форма волны
    c.lineTo(p.x + hw + 2, yBot + 4); c.closePath();
    c.fillStyle = rgba(col, 0.78); c.fill();
    c.strokeStyle = rgba(col.map((v) => Math.min(255, v + 60)), 0.9); c.lineWidth = 1; c.stroke();
    const nb = Math.round(heat * (1 + fx.athanor * 4));   // пузыри — пока горит огонь
    for (let k = 0; k < nb; k++) {
      const t = (now / (1400 + k * 230) + k * 0.37) % 1, bx = p.x + Math.sin(k * 2.3 + t * 5) * hw * 0.5, by = yBot - 4 - t * (yBot - sy - 4);
      T.ring(bx, by, 1.2 + k * 0.3, 0.5 * (1 - t), 0.8);
    }
    c.restore();
    c.strokeStyle = T.ink(held ? 1 : 0.9); c.lineWidth = held ? 1.8 : 1.2;   // стекло: контур, устье, блик
    c.beginPath(); const nk = flaskPath(c, o.shape, p.x, p.y, r); c.stroke();
    c.beginPath(); c.ellipse(p.x, nk.neckTop, nk.nw + 2.5, 2, 0, 0, TAU); c.stroke();
    c.strokeStyle = T.ink(0.35); c.lineWidth = 1;
    c.beginPath(); c.arc(p.x - hw * 0.15, (yTop + yBot) / 2, hw * 0.62, Math.PI * 1.08, Math.PI * 1.4); c.stroke();
    if (o.fb > 0.02) {                           // пеликан — наружу, толще — сильнее
      const sd = p.x <= G.W / 2 ? -1 : 1;
      const sx = p.x + sd * nk.nw, s0 = nk.neckTop + r * 0.35, ex = p.x + sd * hw * 0.92, ey = (yTop + yBot) / 2 + r * 0.15;
      const cp = [[sx, s0], [sx + sd * r * 1.5, s0 - r * 0.9], [ex + sd * r * 1.4, ey - r * 0.3], [ex, ey]];
      tube(c, () => { c.beginPath(); c.moveTo(...cp[0]); c.bezierCurveTo(...cp[1], ...cp[2], ...cp[3]); }, 2 + 3 * o.fb, rgba(col, 0.85), now, o.fb * heat);
      tubes.push({ i, pts: sample([cp]) });
    }
    const out = p.x <= G.W / 2 ? -1 : 1, lx = p.x + out * (hw + 16), ly = Math.max(yTop + 8, p.y + r * 0.2);   // стихия — снаружи, у тела колбы
    elementGlyph(c, lx, ly, o.up, o.bar, 6, 0.75);
    T.mapText(o.key, lx, ly + 18, 11, 0.4, 'center');
  }
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
  const bez = (a, b, c2, d, t) => { const u = 1 - t; return [u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c2[0] + t * t * t * d[0], u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c2[1] + t * t * t * d[1]]; };
  const sample = (segs) => segs.flatMap((s) => Array.from({ length: 13 }, (_, k) => bez(...s, k / 12)));
  function modSegs(G, s, d) {                       // трубка от горлышка s к горлышку d: выгиб к середине, мимо своих колб
    const a = flaskGeo(G, s), b = flaskGeo(G, d), ax = a.p.x, ay = a.neckTop, bx = b.p.x, by = b.neckTop;
    const side = ax <= G.W / 2 ? 1 : -1, o = G.r * 1.7;
    return [[[ax, ay - 2], [ax + side * o * 0.4, ay - 40], [ax + side * o, ay - 10], [ax + side * o, (ay + by) / 2]],
      [[ax + side * o, (ay + by) / 2], [ax + side * o, by - 24], [bx, by - 22], [bx, by - 4]]];
  }
  function drawTubes(c, G, now) {
    for (const [s, d] of mods) {
      const segs = modSegs(G, s, d);
      tube(c, () => { c.beginPath(); c.moveTo(...segs[0][0]); for (const sg of segs) c.bezierCurveTo(...sg[1], ...sg[2], ...sg[3]); }, 3, rgba(mixed(s), 0.95), now, OPS[s].level * heat);
      tubes.push({ s, d, pts: sample(segs) });
    }
    for (const i of carriers()) {                 // несущие сливают снизу в приёмник
      const { p, yBot } = flaskGeo(G, i), e = G.egg;
      const path = () => { c.beginPath(); c.moveTo(p.x, yBot + 40); c.bezierCurveTo(p.x, e.y - 60, e.x + (p.x - e.x) * 0.25, e.y - 70, e.x + (p.x - e.x) * 0.08, e.y - 46); };
      tube(c, path, 3, rgba(mixed(i), 0.95), now, OPS[i].level * heat);
      c.strokeStyle = T.ink(0.8); c.lineWidth = 1.2;
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
    const sc = scope(40);                            // поверхность — живая осциллограмма выхода
    for (let k = 0; k <= 40; k++) c.lineTo(e.x - rx + (k / 40) * 2 * rx, sy - (sc ? sc[Math.min(39, k)] * 7 : 0));
    c.lineTo(e.x + rx, e.y + ry); c.closePath(); c.fill();
    c.restore();
    c.strokeStyle = T.ink(0.9); c.lineWidth = 1.2;
    c.beginPath(); c.ellipse(e.x, e.y, rx, ry, 0, -Math.PI / 2 + 0.25, -Math.PI / 2 - 0.25 + TAU); c.stroke();
    c.beginPath(); c.moveTo(e.x - 6, e.y - ry + 1); c.lineTo(e.x - 6, e.y - ry - 14); c.moveTo(e.x + 6, e.y - ry + 1); c.lineTo(e.x + 6, e.y - ry - 14); c.stroke();
    c.beginPath(); c.ellipse(e.x, e.y - ry - 14, 8.5, 2, 0, 0, TAU); c.stroke();
    c.strokeStyle = T.ink(0.35); c.beginPath(); c.arc(e.x - 4, e.y - 2, rx * 0.65, Math.PI * 1.05, Math.PI * 1.4); c.stroke();
  }
  // атанор — печь-башня из кирпича; горит огонь — дрон звучит (тап по печи), выше пламя — сильнее жар (FX athanor)
  const furnBox = (G) => ({ x0: G.W / 2 - 46, x1: G.W / 2 + 46, y0: G.furn.y0, y1: G.furn.y1 });
  function drawFurnace(c, G, now) {
    const { x0, x1, y0, y1 } = furnBox(G);
    c.fillStyle = T.BG; c.fillRect(x0, y0, x1 - x0, y1 - y0);
    c.strokeStyle = T.ink(0.85); c.lineWidth = 1.2; c.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0);
    c.beginPath(); c.moveTo(x0 - 6, y0); c.lineTo(x1 + 6, y0); c.moveTo(x0 - 6, y1); c.lineTo(x1 + 6, y1); c.stroke();
    c.strokeStyle = T.ink(0.22); c.lineWidth = 0.8; c.beginPath();
    for (let y = y0 + 9, row = 0; y < y1; y += 9, row++) { c.moveTo(x0, y); c.lineTo(x1, y); for (let x = x0 + (row % 2 ? 9 : 0); x < x1; x += 18) { c.moveTo(x, y - 9); c.lineTo(x, y); } }
    c.stroke();
    const ax = G.W / 2, ay = y1, aw = 24, ah = Math.min(44, (y1 - y0) * 0.75);
    c.fillStyle = T.BG; c.beginPath(); c.moveTo(ax - aw, ay); c.lineTo(ax - aw, ay - ah + aw); c.arc(ax, ay - ah + aw, aw, Math.PI, 0); c.lineTo(ax + aw, ay); c.closePath(); c.fill();
    c.strokeStyle = T.ink(0.85); c.lineWidth = 1.2; c.stroke();
    if (heat < 0.05) {                             // погас — тлеют угли
      for (let k = 0; k < 5; k++) T.dot(ax - 14 + k * 7, ay - 3 - (k % 2) * 2, 1.3, 0.35 + 0.15 * Math.sin(now * 0.003 + k));
      return;
    }
    const n = 3 + Math.round(fx.athanor * 3);
    for (let k = 0; k < n; k++) {
      const fxp = ax - aw * 0.7 + (k / (n - 1)) * aw * 1.4, hh = heat * (10 + 22 * fx.athanor) * (0.75 + 0.25 * Math.sin(now * 0.011 + k * 1.9)), w = 5;
      c.strokeStyle = T.ink(0.85); c.lineWidth = 1;
      c.beginPath(); c.moveTo(fxp - w, ay - 2); c.quadraticCurveTo(fxp - w * 0.6, ay - hh * 0.6, fxp + Math.sin(now * 0.007 + k) * 2, ay - hh);
      c.quadraticCurveTo(fxp + w * 0.6, ay - hh * 0.6, fxp + w, ay - 2); c.stroke();
    }
  }

  // кувшин с водой у печи: тап — заливает огонь, всё в лаборатории затихает (пар и шипение)
  let pourAt = -1e9;
  const POUR_MS = 1600;
  const jugBox = (G) => { const b = furnBox(G); return { x: b.x1 + 34, y: b.y1, w: 26, h: 40 }; };
  function drawJug(c, G, now) {
    const { x, y, h } = jugBox(G), k = clamp((now - pourAt) / POUR_MS), tilt = k < 1 ? Math.sin(Math.min(1, k * 1.6) * Math.PI) * -0.95 : 0;
    const b = furnBox(G), ax = G.W / 2, ay = b.y1 - 14;
    if (k < 1 && tilt < -0.4) {                        // струя из носика в топку
      const sx = x - 24, sy = y - h + 6;
      c.strokeStyle = rgba(OPS[2].col, 0.85); c.lineWidth = 2.2;
      c.setLineDash([4, 3]); c.lineDashOffset = -now * 0.12;
      c.beginPath(); c.moveTo(sx, sy); c.quadraticCurveTo(sx - 20, sy - 8, ax + 10, ay); c.stroke();
      c.setLineDash([]); c.lineDashOffset = 0;
    }
    if (k < 1 && k > 0.25) {                           // пар из арки
      for (let i = 0; i < 6; i++) {
        const t = (k - 0.25) / 0.75, px = ax - 14 + i * 6 + Math.sin(now * 0.004 + i) * 4, py = ay - 10 - t * 70 - i * 6;
        c.strokeStyle = T.ink(0.5 * (1 - t)); c.lineWidth = 1;
        c.beginPath(); c.arc(px, py, 4 + t * 8, Math.PI * 1.1, Math.PI * 1.9); c.stroke();
      }
    }
    c.save(); c.translate(x, y); c.rotate(tilt);
    const body = () => {                                // кувшин: пузатое тело, горло, носик влево, ручка вправо
      c.beginPath(); c.moveTo(-9, 0); c.bezierCurveTo(-17, -10, -15, -26, -7, -30); c.lineTo(-8, -h + 4); c.lineTo(-14, -h + 1);
      c.lineTo(-7, -h); c.lineTo(8, -h); c.lineTo(7, -30); c.bezierCurveTo(15, -26, 17, -10, 9, 0); c.closePath();
    };
    c.fillStyle = T.BG; body(); c.fill();
    c.save(); body(); c.clip();
    const wl = k < 1 ? -18 + 12 * k : -20;             // вода внутри — убывает, пока льём
    c.fillStyle = rgba(OPS[2].col, 0.55); c.fillRect(-20, wl, 40, 30);
    c.restore();
    c.strokeStyle = T.ink(0.9); c.lineWidth = 1.2; body(); c.stroke();
    c.beginPath(); c.moveTo(8, -h + 6); c.bezierCurveTo(20, -h + 4, 22, -18, 12, -12); c.stroke();   // ручка
    c.strokeStyle = T.ink(0.35); c.beginPath(); c.arc(-3, -14, 8, Math.PI * 1.05, Math.PI * 1.45); c.stroke();
    c.restore();
  }
  // шипение пара — короткий шум через полосовой фильтр
  function hiss() {
    if (!actx || !bus) return;
    const ctx = actx, t = ctx.currentTime, n = Math.round(ctx.sampleRate * 1.4), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = buf; bp.type = 'bandpass'; bp.frequency.value = 3200; bp.Q.value = 0.8;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.18, t + 0.25); g.gain.exponentialRampToValueAtTime(0.001, t + 1.35);
    src.connect(bp).connect(g).connect(bus.out); src.start(t); src.stop(t + 1.4);
  }
  function douse() {                                  // залить огонь: гаснет всё — огонь и оставленные банки
    pourAt = performance.now();
    setTimeout(() => {
      hiss();
      for (const [k, gr] of [...voices]) if (k !== 'fire') { kill(gr, 0.4); voices.delete(k); }
      setFire(false);
    }, 450);
  }

  // ---------- семь банок металлов — клавиши, как сенсоры Lyra (♄ ♃ ♂ ☉ ♀ ☿ ☽ — снизу вверх) ----------
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
  const jarBox = (G, i) => { const x0 = 16, x1 = G.W - 78, n = 7, w = Math.min(34, (x1 - x0) / n - 7), X = x0 + ((i + 0.5) / n) * (x1 - x0); return { X, y: G.shelf, w, h: 40 }; };
  function drawJars(c, G, now) {
    const { x: _x } = { x: 0 }, xr = G.W - 74;
    c.strokeStyle = T.ink(0.8); c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(10, G.shelf + 0.5); c.lineTo(xr, G.shelf + 0.5); c.moveTo(10, G.shelf + 5.5); c.lineTo(xr, G.shelf + 5.5); c.stroke();
    for (let i = 0; i < 7; i++) {
      const { X, y, w, h } = jarBox(G, i), v = voices.get(i), on = !!(v && v.on), a = on ? 1 : 0.6;
      c.strokeStyle = T.ink(a); c.lineWidth = on ? 1.6 : 1.1;
      c.beginPath();
      c.moveTo(X - w / 2, y); c.lineTo(X - w / 2, y - h + 10); c.quadraticCurveTo(X - w / 2, y - h + 4, X - w / 4, y - h + 3);
      c.lineTo(X + w / 4, y - h + 3); c.quadraticCurveTo(X + w / 2, y - h + 4, X + w / 2, y - h + 10); c.lineTo(X + w / 2, y); c.stroke();
      c.strokeRect(X - w / 4 - 1, y - h - 2, w / 2 + 2, 5);
      c.beginPath(); c.arc(X, y - h - 4, 2, Math.PI, 0); c.stroke();
      planet(c, METALS[i], X, y - h / 2 + 4, 7, a);
      if (on) T.glowAt(X, y - h / 2, 26, 0.18);
      if (v && v.latched) T.dot(X, y + 11, 1.8, 0.8);   // оставлена звучать
    }
  }

  // солнце — четверть из правого верхнего угла (угол к центру карты); белым по чёрному
  function drawSun(c, G, now) { T.quarterSun(c, G.sun.x, G.sun.y, G.sun.r, -1, now); }

  // ---------- стена: бледные алхимические рисунки, одна картинка на размер экрана ----------
  // квадратура круга (круг — треугольник — круг — квадрат — круг, как в Atalanta Fugiens), девиз, уроборос, знаки веществ
  let wallC = null, wallKey = '';
  function wall(G) {
    const key = `${G.W}x${G.H}x${T.DPR}|${G.top}|${G.bot}`;
    if (wallC && key === wallKey) return wallC;
    wallKey = key;
    wallC = document.createElement('canvas');
    wallC.width = Math.round(G.W * T.DPR); wallC.height = Math.round(G.H * T.DPR);
    const x = wallC.getContext('2d');
    x.setTransform(T.DPR, 0, 0, T.DPR, 0, 0);
    x.fillStyle = T.BG; x.fillRect(0, 0, G.W, G.H);
    const ink = (a) => `rgba(237,237,237,${a})`;
    // квадратура круга
    const cx = G.W * 0.62, cy = G.top + 0.36 * G.h, R = Math.min(G.W * 0.34, G.h * 0.2);
    x.strokeStyle = ink(0.1); x.lineWidth = 1;
    const circ = (r) => { x.beginPath(); x.arc(cx, cy, r, 0, TAU); x.stroke(); };
    circ(R); circ(R + 4);
    x.beginPath(); for (let k = 0; k < 3; k++) { const a = -Math.PI / 2 + (k * TAU) / 3; k ? x.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R) : x.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); } x.closePath(); x.stroke();
    circ(R / 2);
    const q = R / 2 / Math.SQRT2; x.strokeRect(cx - q, cy - q, 2 * q, 2 * q);
    circ(q);
    x.beginPath(); x.moveTo(cx, cy - R - 10); x.lineTo(cx, cy + R + 10); x.moveTo(cx - R - 10, cy); x.lineTo(cx + R + 10, cy); x.setLineDash([2, 5]); x.stroke(); x.setLineDash([]);
    for (let d = 0; d < 360; d += 10) {                // шкала по внешнему кругу
      const a = (d * Math.PI) / 180, l = d % 30 ? 3 : 6;
      x.beginPath(); x.moveTo(cx + Math.cos(a) * (R + 4), cy + Math.sin(a) * (R + 4)); x.lineTo(cx + Math.cos(a) * (R + 4 + l), cy + Math.sin(a) * (R + 4 + l)); x.stroke();
    }
    // девиз по дуге под кругом
    x.font = `italic 13px ${T.MAP}`; x.fillStyle = ink(0.16); x.textAlign = 'center'; x.textBaseline = 'middle';
    const motto = 'SOLVE  ET  COAGVLA', span = 1.1;
    [...motto].forEach((ch, i) => {
      const a = Math.PI / 2 + span / 2 - (i / (motto.length - 1)) * span;
      x.save(); x.translate(cx + Math.cos(a) * (R + 20), cy + Math.sin(a) * (R + 20)); x.rotate(a - Math.PI / 2); x.fillText(ch, 0, 0); x.restore();
    });
    // уроборос слева от печи: змей кусает свой хвост; чешуя — засечки
    const ox = G.W * 0.15, oy = G.furn.y0 + 26, orr = Math.min(28, G.W * 0.07);
    x.strokeStyle = ink(0.14); x.lineWidth = 1;
    x.beginPath(); x.arc(ox, oy, orr + 4, -Math.PI / 2 + 0.25, -Math.PI / 2 + TAU - 0.05); x.stroke();
    x.beginPath(); x.arc(ox, oy, orr - 4, -Math.PI / 2 + 0.25, -Math.PI / 2 + TAU - 0.05); x.stroke();
    for (let k = 0; k < 36; k++) { const a = -Math.PI / 2 + 0.35 + k * 0.165; x.beginPath(); x.moveTo(ox + Math.cos(a) * (orr - 3), oy + Math.sin(a) * (orr - 3)); x.lineTo(ox + Math.cos(a + 0.08) * (orr + 3), oy + Math.sin(a + 0.08) * (orr + 3)); x.stroke(); }
    const hx = ox + 3, hy = oy - orr;                 // голова у хвоста
    x.beginPath(); x.ellipse(hx, hy, 8, 5.5, 0, 0, TAU); x.stroke();
    x.beginPath(); x.arc(hx + 2, hy - 1.5, 1, 0, TAU); x.stroke();
    x.beginPath(); x.moveTo(hx - 8, hy); x.lineTo(hx - 13, hy + 1); x.stroke();
    // знаки веществ по стене: сера, соль, ртуть, сурьма, купорос, огонь философов
    const glyphs = [[0.1, 0.12], [0.88, 0.5], [0.12, 0.47], [0.9, 0.7], [0.5, 0.06], [0.42, 0.62]];
    x.strokeStyle = ink(0.13); x.lineWidth = 1;
    glyphs.forEach(([gx, gy], i) => {
      const X = G.W * gx, Y = G.top + G.h * gy, s = 7;
      x.beginPath();
      if (i === 0) { x.moveTo(X, Y - s); x.lineTo(X - s * 0.8, Y + s * 0.3); x.lineTo(X + s * 0.8, Y + s * 0.3); x.closePath(); x.moveTo(X, Y + s * 0.3); x.lineTo(X, Y + s * 1.3); x.moveTo(X - s * 0.45, Y + s * 0.85); x.lineTo(X + s * 0.45, Y + s * 0.85); }   // сера
      else if (i === 1) { x.arc(X, Y, s * 0.7, 0, TAU); x.moveTo(X - s * 0.7, Y); x.lineTo(X + s * 0.7, Y); }   // соль
      else if (i === 2) { x.arc(X, Y, s * 0.5, 0, TAU); x.moveTo(X - s * 0.5, Y - s); x.quadraticCurveTo(X, Y - s * 0.3, X + s * 0.5, Y - s); x.moveTo(X, Y + s * 0.5); x.lineTo(X, Y + s * 1.3); x.moveTo(X - s * 0.35, Y + s * 0.9); x.lineTo(X + s * 0.35, Y + s * 0.9); }   // ртуть
      else if (i === 3) { x.arc(X, Y + s * 0.3, s * 0.6, 0, TAU); x.moveTo(X, Y - s * 0.3); x.lineTo(X, Y - s * 1.2); x.moveTo(X - s * 0.4, Y - s * 0.8); x.lineTo(X + s * 0.4, Y - s * 0.8); }   // сурьма
      else if (i === 4) { x.moveTo(X - s, Y - s * 0.6); x.lineTo(X + s, Y - s * 0.6); x.lineTo(X, Y + s); x.closePath(); x.moveTo(X - s * 0.5, Y); x.lineTo(X + s * 0.5, Y); }   // воздух
      else { x.arc(X, Y, s * 0.8, 0, TAU); x.moveTo(X - s * 0.8, Y); x.lineTo(X + s * 0.8, Y); x.moveTo(X, Y - s * 0.8); x.lineTo(X, Y + s * 0.8); }   // купорос
      x.stroke();
    });
    return wallC;
  }

  // четверть древа жизни в правом нижнем углу: медальон с центром на границе с Serpentes (мир под нами) —
  // здесь видна верхняя четверть, крона и ствол; у змей в правом верхнем углу — нижняя, корни. Пока ни к чему не ведёт
  function drawRoot(c) {
    const W = T.W, x = W, y = T.H - T.safeBot, R = Math.min(84, W * 0.22);
    c.save(); c.beginPath(); c.rect(0, 0, W, y); c.clip();   // только верхняя четверть — нижняя у змей
    c.fillStyle = T.BG; c.beginPath(); c.arc(x, y, R + 6, 0, TAU); c.fill();
    T.ring(x, y, R, 0.85, 1.4); T.ring(x, y, R - 5, 0.4, 0.9);
    c.beginPath(); c.arc(x, y, R - 7, 0, TAU); c.clip();
    c.fillStyle = T.ink(0.85);                          // ствол — по краю экрана, уходит вниз к змеям
    c.beginPath(); c.moveTo(x - 6, y + 2); c.quadraticCurveTo(x - 4, y - R * 0.25, x - 2.5, y - R * 0.42); c.lineTo(x, y - R * 0.42); c.lineTo(x, y + 2); c.closePath(); c.fill();
    c.strokeStyle = T.ink(0.85); c.lineWidth = 1.4; c.lineCap = 'round';
    for (const [a, l] of [[-2.2, 0.32], [-2.6, 0.26], [-1.9, 0.3]]) {   // ветви
      const sx = x - 2, sy = y - R * 0.4, ex = sx + Math.cos(a) * R * l, ey = sy + Math.sin(a) * R * l;
      c.beginPath(); c.moveTo(sx, sy); c.quadraticCurveTo((sx + ex) / 2, (sy + ey) / 2 - 4, ex, ey); c.stroke();
    }
    c.lineCap = 'butt';
    const cx = x, cy = y - R * 0.6, cr = R * 0.36;       // крона: фестоны по кругу, внутри плоды
    c.fillStyle = T.BG; c.strokeStyle = T.ink(0.9); c.lineWidth = 1.2;
    c.beginPath();
    for (let k = 0; k < 9; k++) {
      const a0 = (k / 9) * TAU, a1 = ((k + 1) / 9) * TAU, am = (a0 + a1) / 2;
      if (!k) c.moveTo(cx + Math.cos(a0) * cr, cy + Math.sin(a0) * cr);
      c.quadraticCurveTo(cx + Math.cos(am) * cr * 1.35, cy + Math.sin(am) * cr * 1.3, cx + Math.cos(a1) * cr, cy + Math.sin(a1) * cr);
    }
    c.closePath(); c.fill(); c.stroke();
    for (const [dx, dy] of [[-0.45, -0.2], [-0.2, 0.35], [-0.6, 0.3], [-0.25, -0.55]]) {
      c.beginPath(); c.arc(cx + dx * cr, cy + dy * cr, 2.6, 0, TAU); c.stroke();
      c.beginPath(); c.moveTo(cx + dx * cr, cy + dy * cr - 2.6); c.lineTo(cx + dx * cr + 1.2, cy + dy * cr - 5); c.stroke();
    }
    c.strokeStyle = T.ink(0.6); c.lineWidth = 1; c.beginPath();   // корешки начинаются у самой границы
    for (const d of [0.35, 0.6]) { c.moveTo(x - 3, y - 2); c.quadraticCurveTo(x - R * d * 0.5, y - 1, x - R * d, y + 4); }
    c.stroke();
    c.restore();
  }

  // ---------- звук: на каждый звучащий источник (огонь, банка) — свой граф из четырёх синусов с трубками и пеликанами;
  // несущие → общая сумма → жар (tanh) → выход и стекло (ревер); у графа свой гейт ----------
  let actx = null, bus = null, offTimer = 0, curveK = -1;
  const voices = new Map();                       // 'fire' | номер банки → граф { ratio, on, latched, … }
  const VOICE_MAX = 3;                            // банок звучит разом не больше трёх
  function build(ctx, input) {
    actx = ctx;
    const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const sum = g(1), shaper = ctx.createWaveShaper(), out = g(1.3), hallSend = g(0), h = T.hall(), an = ctx.createAnalyser();
    shaper.oversample = '2x'; an.fftSize = 1024;
    sum.connect(shaper).connect(out);
    shaper.connect(hallSend); hallSend.connect(h.input); h.out.connect(g(0.9)).connect(out);
    out.connect(input); out.connect(an);
    bus = { sum, shaper, out, hallSend, hall: h, an, buf: new Float32Array(1024) };
    voices.clear(); curveK = -1;
    applyFx();
    if (fire) setFire(true);
  }
  function scope(n) {                              // n точек осциллограммы выхода от восходящего нуля; null — тихо
    if (!bus || !voices.size) return null;
    const b = bus.buf; bus.an.getFloatTimeDomainData(b);
    let z = 0, peak = 0;
    for (let i = 1; i < 512; i++) if (b[i - 1] < 0 && b[i] >= 0) { z = i; break; }
    for (let i = 0; i < 1024; i++) peak = Math.max(peak, Math.abs(b[i]));
    if (peak < 1e-3) return null;
    const out = new Float32Array(n), span = 400, k = Math.min(1, 0.8 / peak);
    for (let i = 0; i < n; i++) out[i] = b[Math.min(1023, z + Math.round((i / n) * span))] * k;
    return out;
  }
  function applyFx() {
    if (!bus) return;
    const t = actx.currentTime, k = 1 + fx.athanor * 6;
    if (Math.abs(k - curveK) > 0.05) {
      curveK = k;
      const n = 1024, cv = new Float32Array(n), norm = Math.tanh(k);
      for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; cv[i] = Math.tanh(k * x) / norm; }
      bus.shaper.curve = cv;
    }
    bus.hallSend.gain.setTargetAtTime(fx.vitrum * fx.vitrum * 1.3, t, 0.05);
    const tail = 0.4 + fx.vitrum * 2.4;
    for (const l of bus.hall.lines) l.g.gain.setTargetAtTime(10 ** ((-3 * l.len) / tail), t, 0.05);
    setParams();
  }
  // граф аппарата: ratio — транспонирование (банка), gate входит за tau
  function makeGraph(ratio, on, tau) {
    const ctx = actx, t = ctx.currentTime, g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const xf = g(0); xf.connect(bus.sum);
    const oscs = OPS.map((o) => { const n = ctx.createOscillator(); n.frequency.value = o.f * ratio; return n; });
    const lfo = ctx.createOscillator();
    const edges = mods.map(([s, d]) => { const e = g(0), lg = g(0); oscs[s].connect(e).connect(oscs[d].frequency); lfo.connect(lg).connect(e.gain); return { s, d, e, lg }; });
    const fbs = OPS.map((o, i) => {                 // пеликан: через задержку (петля в графе без неё молчит)
      if (o.fb <= 0.02) return null;
      const dl = ctx.createDelay(0.05), fg = g(0); dl.delayTime.value = 0.001;
      oscs[i].connect(dl).connect(fg).connect(oscs[i].frequency); return fg;
    });
    const car = carriers(), outs = OPS.map((_, i) => { const og = g(0); if (car.includes(i)) oscs[i].connect(og).connect(xf); return og; });
    for (const n of oscs) n.start();
    lfo.start();
    const gr = { oscs, lfo, edges, fbs, outs, xf, car, ratio, on, latched: false, t0: performance.now() };
    setParams(true, gr);
    xf.gain.setTargetAtTime(on ? 1 : 0, t, tau);
    return gr;
  }
  function kill(gr, tau) {
    gr.on = false;
    gr.xf.gain.setTargetAtTime(0, actx.currentTime, tau);
    setTimeout(() => { for (const n of gr.oscs) n.stop(); gr.lfo.stop(); gr.xf.disconnect(); }, tau * 8000 + 50);
  }
  function setParams(now = false, only = null) {
    if (!actx) return;
    const t = actx.currentTime, tau = now ? 0.005 : 0.03, S = (p, v) => p.setTargetAtTime(v, t, tau);
    for (const gr of only ? [only] : voices.values()) {
      OPS.forEach((o, i) => {
        S(gr.oscs[i].frequency, o.f * gr.ratio);
        S(gr.outs[i].gain, gr.car.includes(i) ? o.level * 0.3 : 0);
        if (gr.fbs[i]) S(gr.fbs[i].gain, o.fb * o.f * gr.ratio * 1.2);
      });
      for (const e of gr.edges) {                   // индекс до 3: девиация = уровень × 3 × частота приёмника
        const base = OPS[e.s].level * 3 * OPS[e.d].f * gr.ratio;
        S(e.e.gain, base); S(e.lg.gain, base * fx.circulatio * 0.6);
      }
      S(gr.lfo.frequency, 0.05 + fx.circulatio * 0.5);
    }
  }
  // смена трубок: каждый звучащий граф — заново, перекрёстком без щелчка
  function rewire() {
    if (!bus) return;
    for (const [k, gr] of voices) {
      const n = makeGraph(gr.ratio, gr.on, 0.03);
      n.latched = gr.latched; n.t0 = gr.t0;
      voices.set(k, n); kill(gr, 0.03);
    }
  }
  function setFire(on) {
    fire = on;
    clearTimeout(offTimer);
    if (!bus) return;
    const gr = voices.get('fire');
    if (on) {
      if (gr && gr.on) return;
      if (gr) kill(gr, 0.03);
      voices.set('fire', makeGraph(1, true, 0.35));
      return;
    }
    if (!gr) return;
    gr.on = false; gr.xf.gain.setTargetAtTime(0, actx.currentTime, 0.6);
    offTimer = setTimeout(() => {                    // погас и затих — генераторы останавливаются, не греют телефон
      const g2 = voices.get('fire');
      if (fire || !g2 || g2.on) return;
      kill(g2, 0.01); voices.delete('fire');
    }, 4500);
  }
  const jarRatio = (j) => (55 * 2 ** (jars[j] / 12)) / REF;
  function jarOn(j) {
    if (!bus) return;
    const old = voices.get(j);
    if (old) { kill(old, 0.02); voices.delete(j); }
    const keys = [...voices.keys()].filter((k) => k !== 'fire');
    if (keys.length >= VOICE_MAX) {                  // лишняя — самая старая неоставленная (оставленные — тоже, если все такие)
      const victim = keys.map((k) => [k, voices.get(k)]).sort((a, b) => (a[1].latched - b[1].latched) || (a[1].t0 - b[1].t0))[0][0];
      kill(voices.get(victim), 0.05); voices.delete(victim);
    }
    voices.set(j, makeGraph(jarRatio(j), true, 0.04));
  }
  function jarOff(j) {
    const gr = voices.get(j);
    if (!gr || gr.latched) return;
    kill(gr, 0.3); voices.delete(j);
  }

  // ---------- касания ----------
  const touches = new Map();
  let lastJarTap = null;
  function hitFlask(G, x, y) {
    for (let i = 0; i < OPS.length; i++) {
      const q = flaskGeo(G, i);
      if (Math.abs(x - q.p.x) < 20 && y > q.neckTop - 16 && y < q.yTop + 4) return { i, part: 'neck' };
      if (Math.abs(x - q.p.x) < q.hw + 10 && y > q.yTop - 4 && y < q.yBot + 10) return { i, part: 'body' };
    }
    return null;
  }
  function hitJar(G, x, y) {
    for (let i = 0; i < 7; i++) { const b = jarBox(G, i); if (Math.abs(x - b.X) < b.w / 2 + 4 && y > b.y - b.h - 10 && y < b.y + 12) return i; }
    return -1;
  }
  const segDist = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, t = l ? clamp(((px - ax) * dx + (py - ay) * dy) / l) : 0;
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
  };
  function hitTube(x, y) {                          // расстояние до ломаной трубки, с запасом под палец
    let best = null, bd = 18;
    for (const t of tubes) for (let k = 1; k < t.pts.length; k++) {
      const d = segDist(x, y, ...t.pts[k - 1], ...t.pts[k]);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }
  function down(f) {
    const G = geo(), j = hitJar(G, f.x, f.y);
    if (j >= 0) {
      const now = performance.now(), dbl = lastJarTap && lastJarTap.j === j && now - lastJarTap.t < T.DTAP_MS;
      const v = voices.get(j);
      if (dbl && v && v.latched) { v.latched = false; jarOff(j); lastJarTap = null; touches.set(f.id, { kind: 'none' }); return; }
      if (!v || !v.on) jarOn(j);
      touches.set(f.id, { kind: 'jar', j, s0: jars[j], dbl });
      return;
    }
    const h = hitFlask(G, f.x, f.y);
    if (h && h.part === 'neck') { touches.set(f.id, { kind: 'tube', src: h.i }); return; }
    const tb = hitTube(f.x, f.y);                    // трубка — раньше тела колбы: её конец лежит у горлышка
    if (tb && !(h && h.part === 'body')) { touches.set(f.id, { kind: 'tubeTap', t: tb }); return; }
    if (h) { const o = OPS[h.i]; touches.set(f.id, { kind: 'flask', i: h.i, f0: o.f, l0: o.level, axis: null }); return; }
    const jb = jugBox(G);
    if (Math.abs(f.x - jb.x) < 26 && f.y > jb.y - jb.h - 12 && f.y < jb.y + 10) { touches.set(f.id, { kind: 'jug' }); return; }
    const b = furnBox(G);
    if (f.x > b.x0 - 6 && f.x < b.x1 + 6 && f.y > b.y0 && f.y < b.y1 + 10) { touches.set(f.id, { kind: 'fire' }); return; }
    touches.set(f.id, { kind: 'none' });
  }
  function move(f) {
    const t = touches.get(f.id);
    if (!t) return;
    t.x = f.x; t.y = f.y;
    const dx = f.x - f.x0, dy = f.y - f.y0;
    if (t.kind === 'jar') {                          // банку вверх-вниз — её нота (6 px на полутон, с ладом — по ступеням)
      if (!t.drag && Math.abs(dy) > 10) t.drag = true;
      if (!t.drag) return;
      let s = clamp(Math.round(t.s0 - dy / 6), 0, 48);
      if (T.scaleOn) s = T.snapSemi(s);
      if (s !== jars[t.j]) { jars[t.j] = s; const gr = voices.get(t.j); if (gr) { gr.ratio = jarRatio(t.j); setParams(false, gr); } }
      return;
    }
    if (t.kind !== 'flask') return;
    if (!t.axis && Math.hypot(dx, dy) > 8) t.axis = Math.abs(dx) > Math.abs(dy) ? 'pitch' : 'level';
    const o = OPS[t.i];
    if (t.axis === 'pitch') {                        // вбок: 6 px на полутон; с ладом — по ступеням
      let s = 12 * Math.log2(t.f0 / 55) + dx / 6;
      s = clamp(s, -12, 60);
      if (T.scaleOn) s = T.snapSemi(Math.round(s));
      o.f = 55 * 2 ** (s / 12);
    } else if (t.axis === 'level') o.level = clamp(t.l0 - dy / 140);
    setParams();
  }
  function up(f) {
    const t = touches.get(f.id);
    touches.delete(f.id);
    if (!t) return;
    const moved = Math.hypot(f.x - f.x0, f.y - f.y0) > 12;
    if (t.kind === 'jar') {
      const v = voices.get(t.j), quick = performance.now() - f.t0 < 300 && !t.drag;
      if (t.dbl && quick && v) { v.latched = true; lastJarTap = null; return; }   // двойной тап — оставить звучать
      lastJarTap = quick ? { j: t.j, t: performance.now() } : null;
      jarOff(t.j);
      return;
    }
    if (t.kind === 'fire' && !moved) { if (!fire) setFire(true); }   // печь только зажигает; гасит кувшин
    else if (t.kind === 'jug' && !moved) douse();
    else if (t.kind === 'tubeTap') {                 // тап или вытянуть — трубка снята
      if (t.t.i != null) OPS[t.t.i].fb = 0;
      else mods = mods.filter(([s, d]) => !(s === t.t.s && d === t.t.d));
      rewire();
    } else if (t.kind === 'tube' && moved) {
      const h = hitFlask(geo(), f.x, f.y);
      if (!h) return;
      if (h.i === t.src) OPS[t.src].fb = OPS[t.src].fb > 0.02 ? 0 : 0.5;       // в себя — пеликан
      else if (mods.some(([s, d]) => s === t.src && d === h.i)) mods = mods.filter(([s, d]) => !(s === t.src && d === h.i));
      else if (!reaches(h.i, t.src)) mods = [...mods, [t.src, h.i]];          // петли между колбами нет — только пеликан
      rewire();
    }
  }
  function drawTouches(c, G, now) {
    for (const t of touches.values()) {
      const f = t.x == null ? null : { x: t.x, y: t.y };
      if (t.kind === 'tube' && f) {
        const a = flaskGeo(G, t.src);
        tube(c, () => { c.beginPath(); c.moveTo(a.p.x, a.neckTop - 2); c.quadraticCurveTo(a.p.x, Math.min(a.neckTop, f.y) - 40, f.x, f.y); }, 3, rgba(mixed(t.src), 0.9), now, 0.5);
      } else if (t.kind === 'flask' && t.axis === 'pitch') {
        const a = flaskGeo(G, t.i), o = OPS[t.i];
        T.mapText(`${noteName(o.f)} · ${Math.round(o.f)} Hz`, a.p.x, a.neckTop - 18, 14, 0.9, 'center');
      } else if (t.kind === 'jar' && t.drag) {
        const b = jarBox(G, t.j);
        T.mapText(noteName(55 * 2 ** (jars[t.j] / 12)), b.X, b.y - b.h - 22, 15, 0.95, 'center');
      }
    }
  }

  // ---------- мир ----------
  const deg = (d) => (d * Math.PI) / 180;
  const fxw = {
    sectors: [
      { key: 'athanor', label: 'athanor', ang: deg(180) },
      { key: 'vitrum', label: 'vitrum', ang: deg(150) },
      { key: 'circulatio', label: 'circulatio', ang: deg(120) },
    ],
    get: (k) => fx[k], set: (k, v) => { fx[k] = v; applyFx(); }, text: (k) => `${Math.round(fx[k] * 100)}%`,
    arc: () => fx.vitrum, save: () => ({ ...fx }), load: (o) => { Object.assign(fx, o); applyFx(); },
  };
  // кубик: алхимическая схема (цепь, два брака, квинтэссенция, …) и высоты от одной тоники, с лёгким дрейфом, как у Lyra
  const SCHEMES = [[[1, 0], [2, 1], [3, 2]], [[1, 0], [3, 2]], [[1, 0], [2, 0], [3, 0]], [[3, 2], [2, 0]], [[2, 0], [3, 1]], [[3, 0]]];
  function dice() {
    const R = Math.random;
    mods = SCHEMES[Math.floor(R() * SCHEMES.length)].map((m) => m.slice());
    let s = [0, 3, 5, 7, 10, 12, 15][Math.floor(R() * 7)];
    if (T.scaleOn) s = T.snapSemi(s);
    const base = 55 * 2 ** (s / 12), ratios = [0.5, 1, 1.5, 2, 3, 4];
    OPS.forEach((o) => { o.f = clamp(base * ratios[Math.floor(R() * ratios.length)] * (1 + (R() - 0.5) * 0.008), F_LO, F_HI); o.level = 0.25 + R() * 0.6; o.fb = 0; });
    const top = OPS.map((_, i) => i).filter((i) => !mods.some((m) => m[1] === i) && mods.some((m) => m[0] === i));
    if (top.length && R() < 0.6) OPS[top[0]].fb = 0.3 + R() * 0.4;
    rewire(); setFire(true);
  }

  let last = performance.now();
  const lab = {
    n: 'III', title: 'Laboratorium', sub: 'operatores quattuor',
    corner: { hit: (f) => { const G = geo(); return f.y > G.sun.y && Math.hypot(f.x - G.sun.x, f.y - G.sun.y) < G.sun.r + 6; }, draw: () => {} },   // солнце — карта; древо в углу пока просто стоит
    fx: fxw,
    build,
    draw(now) {
      const c = T.g, G = geo(), dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ease(G, dt);
      heat += ((fire ? 1 : 0) - heat) * (1 - Math.exp(-dt / (fire ? 0.35 : 0.6)));
      tubes.length = 0;
      c.drawImage(wall(G), 0, 0, T.W, T.H);
      drawSun(c, G, now);
      drawFurnace(c, G, now);
      drawJug(c, G, now);
      drawTubes(c, G, now);
      const held = new Set([...touches.values()].filter((t) => t.kind === 'flask').map((t) => t.i));
      for (let i = 0; i < OPS.length; i++) drawFlask(c, i, G, now, held.has(i));
      drawEgg(c, G, now);
      drawJars(c, G, now);
      drawRoot(c);
      drawTouches(c, G, now);
    },
    down, move, up, dice,
    clear() {
      mods = []; for (const o of OPS) o.fb = 0;
      for (const [k, gr] of [...voices]) if (k !== 'fire') { kill(gr, 0.2); voices.delete(k); }
      rewire(); setFire(false);
    },
    snapshot: () => JSON.stringify({ ops: OPS.map((o) => ({ f: Math.round(o.f * 100) / 100, level: Math.round(o.level * 1e3) / 1e3, fb: o.fb })), mods, fx, fire, jars }),
    restore(js) {
      const st = JSON.parse(js);
      st.ops.forEach((s, i) => Object.assign(OPS[i], s));
      mods = st.mods.map((m) => m.slice()); Object.assign(fx, st.fx);
      if (st.jars) st.jars.forEach((v, i) => { jars[i] = v; });
      applyFx(); rewire(); if (st.fire !== fire) setFire(st.fire);
    },
    sounding: () => fire || [...voices.values()].some((v) => v.on),
  };
  T.registerWorld(3, lab);
  window.t2d.lab = {
    OPS, fx, geo, mixed, jars, waveOf, get mods() { return mods; }, get fire() { return fire; }, get live() { return voices.has('fire'); },
    get voices() { return [...voices].map(([k, v]) => ({ k, on: v.on, latched: v.latched })); },
    jar: (i) => { const b = jarBox(geo(), i); return { x: b.X, y: b.y - b.h / 2 }; },
    at: (i) => { const q = flaskGeo(geo(), i); return { x: q.p.x, y: (q.yTop + q.yBot) / 2, neckY: q.neckTop + 4 }; },
    jug: () => { const b = jugBox(geo()); return { x: b.x, y: b.y - b.h / 2 }; },
    furnace: () => { const b = furnBox(geo()); return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 }; },
    tubeAt: (s, d) => { const t = tubes.find((q) => q.s === s && q.d === d); return t && { x: t.pts[8][0], y: t.pts[8][1] }; },
  };
})();
