// Laboratorium — мир III: четыре колбы — четыре свободных генератора, как у Lyra-8; модулируют друг друга по трубкам (FM).
// Колба — синус своей высоты: тянешь вбок — высота (с ладом — по ступеням), вверх-вниз — уровень жидкости: у модулятора индекс,
// у несущей — громкость. Поверхность колышется тем чаще, чем выше колба звучит. Трубка от горлышка к другой колбе — первая
// модулирует вторую; от горлышка в саму себя — «пеликан», обратная связь; тап по трубке — снять. Колбы сами встают по ярусам:
// кто никуда не льёт — несущая, внизу, сливает в яйцо на атаноре. Цвета смешиваются по трубкам. Тап по лампе Гермеса в арке атанора — огонь:
// горит — дрон звучит; кувшин с водой у печи — тап: заливает огонь, всё затихает. Семь банок металлов (♄ ♃ ♂ ☉ ♀ ☿ ☽) — клавиши, как сенсоры Lyra: держишь — аппарат
// звучит на ноте банки (до трёх разом), двойной тап — оставить звучать, банку вверх-вниз — её нота. Поверхность жидкости — форма волны
// колбы (FM считается напрямую), в яйце — живая осциллограмма выхода. FX: athanor — жар (сатуратор), vitrum — стеклянный ревер, circulatio — медленное бурление индексов,
// solve · coagula — грязная задержка с фильтром в петле, как у Make Noise Strega (караоке-чип PT2399): solve — время (коротко — резонанс,
// дальше эхо, длинно — крошево: меньше бит, слышно тиканье часов чипа), coagula — сколько эффекта и повторов (0 — выключен).
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
  const fx = { athanor: 0.35, vitrum: 0.35, circulatio: 0.25, solve: 0.35, coagula: 0 };
  let fire = false, heat = 0;                // огонь: горит ли и как разгорелся (картинка)
  const broken = [false, false, false, false];  // разбитая колба: оператор выпал из цепочки, жидкость вытекла
  const drain = [0, 0, 0, 0];                   // 0 — цела, 1 — вытекла (картинка: доля утёкшего)
  let soot = 0;                      // сажа на стене над лампой — копится, пока горит; кот поднял голову (время)
  // банки: ноты в полутонах от 55 Гц (по умолчанию — A натуральный минор от A2); нота банки транспонирует весь аппарат относительно A2
  const JAR_DEF = [12, 14, 15, 17, 19, 20, 22], REF = 110;
  const jars = JAR_DEF.slice();

  const carriers = () => OPS.map((_, i) => i).filter((i) => !mods.some((m) => m[0] === i));
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

  // ---------- геометрия: эмблема «квадратура круга» (как в Atalanta Fugiens) — колбы на углах квадрата, вписанного в круг,
  // яйцо философов в центре на треножнике над лампой Гермеса; у каждой стихии свой угол: aer — слева сверху, ignis — справа сверху,
  // terra — слева снизу, aqua — справа снизу. Сверху — лента со свитком волны, снизу — полоса медальонов-металлов ----------
  const CORNER = [[1, -1], [-1, -1], [1, 1], [-1, 1]];          // ignis, aer, aqua, terra
  const deg = (d) => (d * Math.PI) / 180;
  function geo() {
    const W = T.W, H = T.H, top = T.topY + 6, bot = H - T.safeBot - 8, h = bot - top;
    const sun = { x: W, y: T.topY + 2, r: Math.min(42, W * 0.11) };   // солнце — четвертью в правом верхнем углу, к центру карты
    const bh = clamp(h * 0.11, 40, 84), band = bot - 34;        // лента и полоса металлов
    const yA = top + 6 + bh + 34, yB = band - 58;               // эмблема — между лентой и металлами, с надписями solve · coagula
    const R = Math.max(110, Math.min(W * 0.45, (yB - yA) / 2 - 18)), cx = W / 2, cy = (yA + yB) / 2;
    const by1 = Math.max(top + 6 + bh, cy - R - 40), banner = { x0: 34, x1: W - 114, y0: by1 - bh, y1: by1 };   // лента — над самой эмблемой
    const s = R * 0.52, r = R * 0.15;
    const pos = CORNER.map(([dx, dy]) => ({ x: cx + dx * s, y: cy + dy * s }));
    return { W, H, top, bot, h, cx, cy, R, s, r, pos, banner, band, sun, egg: { x: cx, y: cy - 4, rx: R * 0.14, ry: R * 0.18 }, lamp: { x: cx, y: cy + R * 0.48 } };
  }
  const lighter = (col) => col.map((v) => Math.min(255, v + 50));
  function flaskGeo(G, i) {                          // круглая колба: тело — круг, горлышко вверх
    const p = G.pos[i], r = G.r;
    return { p, yTop: p.y - r, yBot: p.y + r, hw: r, neckTop: p.y - r * 1.9, nw: r * 0.21 };
  }

  // форма волны колбы — то, что она звучит: FM считается напрямую по фазе (как в звуке: девиация = уровень × 3 × частота приёмника),
  // окно — тем больше периодов, чем выше колба звучит; кеш по параметрам
  const waveCache = new Map();
  const paramKey = () => `${OPS.map((o) => `${o.f.toFixed(2)},${o.level.toFixed(3)},${o.fb}`).join(';')}|${mods.join(';')}`;
  function sim(key, dur, pick) {                    // фаза всех четырёх колб сразу; pick(y) — что записывать
    let w = waveCache.get(key);
    if (w) return w;
    if (waveCache.size > 64) waveCache.clear();
    const N = 72, STEP = 9, M = (N - 1) * STEP + 1, dt = dur / M, ph = new Float64Array(4), y = new Float64Array(4);
    w = new Float32Array(N);
    for (let s = 0; s < M; s++) {
      for (let k = 0; k < 4; k++) y[k] = Math.sin(ph[k]);
      if (s % STEP === 0) w[s / STEP] = pick(y);
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
  function waveOf(i) {
    const per = clamp(1 + Math.log2(OPS[i].f / F_LO) * 0.8, 1, 6);
    return sim(`${i}|${paramKey()}`, per / OPS[i].f, (y) => y[i]);
  }
  function waveOut() {                              // то, что выходит из аппарата: сумма несущих, два периода самой низкой
    const car = carriers();
    if (!car.length) return null;
    const base = Math.min(...car.map((i) => OPS[i].f)), tot = car.reduce((s, i) => s + OPS[i].level, 0) || 1;
    const w = sim(`out|${paramKey()}`, 2 / base, (y) => car.reduce((s, i) => s + OPS[i].level * y[i], 0) / tot);
    let m = 0;
    for (const v of w) m = Math.max(m, Math.abs(v));
    return m > 1e-3 ? w.map((v) => v / m) : w;
  }

  // лента-филактерий вверху: крупно форма волны — колбы, которую держишь (её цветом, с подписью), иначе бледно — всего аппарата
  let focusI = null, focusUntil = 0;
  function drawBanner(c, G, now) {
    const { x0, x1, y0, y1 } = G.banner, cy = (y0 + y1) / 2, hh = (y1 - y0) / 2;
    const live = focusI != null && now < focusUntil;
    c.fillStyle = T.BG; c.fillRect(x0, y0, x1 - x0, y1 - y0);
    c.strokeStyle = T.ink(0.75); c.lineWidth = 1; c.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0);
    c.strokeStyle = T.ink(0.55);
    for (const d of [-1, 1]) {                       // концы ленты загнуты и раздвоены
      const x = d < 0 ? x0 : x1;
      c.beginPath();
      c.moveTo(x, y0 + 0.5); c.quadraticCurveTo(x + d * 12, y0, x + d * 14, cy - 2); c.quadraticCurveTo(x + d * 15, y1 - 2, x + d * 4, y1); c.lineTo(x, y1);
      c.moveTo(x + d * 14, cy - 2); c.lineTo(x + d * 20, y1 + 4); c.lineTo(x + d * 4, y1);
      c.stroke();
    }
    const w = live ? waveOf(focusI) : waveOut();
    if (!w) return;
    const n = w.length, xa = x0 + 8, xb = x1 - 8, amp = hh - 5;
    c.strokeStyle = live ? rgba(lighter(mixed(focusI)), 0.95) : T.ink(heat > 0.05 || voices.size ? 0.55 : 0.3);
    c.lineWidth = live ? 1.5 : 1.1; c.lineJoin = 'round';
    c.beginPath();
    for (let k = 0; k < n; k++) { const X = xa + (k / (n - 1)) * (xb - xa), Y = cy - w[k] * amp; k ? c.lineTo(X, Y) : c.moveTo(X, Y); }
    c.stroke();
    if (live) {
      const o = OPS[focusI], to = mods.filter((m) => m[0] === focusI).map((m) => OPS[m[1]].key);
      T.mapText(`${o.key} · ${noteName(o.f)} · ${to.length ? 'index' : 'volume'} ${Math.round(o.level * 100)}%${to.length ? ` → ${to.join(', ')}` : ''}`, (x0 + x1) / 2, y1 + 15, 13, 0.8, 'center');
    }
  }
  // пар из горлышек — хвост стекла (vitrum): выше и дольше, пока звучит
  function drawSteam(c, G, now) {
    const on = heat > 0.05 || [...voices.values()].some((v) => v.on);
    if (!on || fx.vitrum < 0.03) return;
    c.lineWidth = 1;
    for (let i = 0; i < OPS.length; i++) {
      const q = flaskGeo(G, i), H = 16 + fx.vitrum * 70;
      for (let k = 0; k < 3; k++) {
        const t = ((now / (1800 + k * 300) + k / 3 + i * 0.21) % 1), y = q.neckTop - 6 - t * H, x = q.p.x + Math.sin(t * 5 + i + k) * (3 + t * 6);
        c.strokeStyle = T.ink(0.32 * (1 - t) * Math.min(1, heat + 0.3));
        c.beginPath(); c.arc(x, y, 2.5 + t * 4, Math.PI * (0.9 + 0.2 * k), Math.PI * (1.7 + 0.2 * k)); c.stroke();
      }
    }
  }

  // колба: стекло — тонкой линией, жидкость — как раскрашенная от руки гравюра: бледная заливка и штриховка цветом смеси,
  // поверхность — форма волны колбы; знак стихии на стекле, имя — под колбой
  const tubes = [];                          // для попадания пальцем: [{ s, d, pts }] и пеликаны [{ i, pts }]
  function drawFlask(c, i, G, now, held) {
    const o = OPS[i], { p, yTop, yBot, hw, neckTop, nw } = flaskGeo(G, i), r = G.r, col = mixed(i);
    if (held) { c.strokeStyle = rgba(col, 0.22); c.lineWidth = 8; c.beginPath(); c.arc(p.x, p.y, r + 11, 0, TAU); c.stroke(); }
    c.fillStyle = T.BG; c.beginPath(); c.arc(p.x, p.y, r, 0, TAU); c.fill();
    c.save(); c.beginPath(); c.arc(p.x, p.y, r - 1, 0, TAU); c.clip();
    const lvl = o.level * (1 - drain[i]), sy = yBot - 2 - lvl * (yBot - yTop - 6), wv = waveOf(i), n = wv.length, amp = Math.min(4, r * 0.14) * (0.8 + 0.3 * heat);
    const surf = () => { for (let k = 0; k < n; k++) { const X = p.x - hw + (k / (n - 1)) * 2 * hw, Y = sy - wv[k] * amp; k ? c.lineTo(X, Y) : c.moveTo(X, Y); } };
    c.beginPath(); surf(); c.lineTo(p.x + hw, yBot); c.lineTo(p.x - hw, yBot); c.closePath();
    c.fillStyle = rgba(col, 0.12); c.fill();
    c.save(); c.clip();
    c.strokeStyle = rgba(col, 0.5); c.lineWidth = 1; c.beginPath();
    for (let y = sy - amp + 2; y < yBot; y += 3.4) { c.moveTo(p.x - hw, y); c.lineTo(p.x + hw, y); }
    c.stroke(); c.restore();
    c.beginPath(); surf(); c.strokeStyle = rgba(lighter(col), 0.95); c.lineWidth = 1.4; c.stroke();
    // пузыри — пока горит огонь, в такт биениям FM: чем больше индекс, тем мельче и чаще; у пеликана — кипит
    const idx = mods.filter(([a, d]) => d === i && !broken[a]).reduce((q, [a]) => q + OPS[a].level, 0), boil = broken[i] ? 0 : o.fb;
    const nb = broken[i] ? 0 : Math.round(heat * (1 + fx.athanor * 2 + idx * 4 + boil * 8)), per = 1500 / (1 + idx * 1.5 + boil * 3);
    c.lineWidth = 0.8;
    for (let k = 0; k < nb; k++) {
      const t = (now / (per + k * 170) + k * 0.37) % 1, bx = p.x + Math.sin(k * 2.3 + t * 5) * hw * 0.55, by = yBot - 4 - t * (yBot - sy - 4);
      c.strokeStyle = rgba(lighter(col), 0.7 * (1 - t)); c.beginPath(); c.arc(bx, by, (1.8 + (k % 3) * 0.5) / (1 + idx * 0.8) + boil * 1.2, 0, TAU); c.stroke();
    }
    c.restore();
    c.strokeStyle = T.ink(held ? 1 : 0.9); c.lineWidth = held ? 1.6 : 1.2;   // стекло: тело с горлышком, устье, блик
    const fa = Math.asin(nw / r);
    c.beginPath(); c.moveTo(p.x - nw, neckTop); c.lineTo(p.x - nw, p.y - r * Math.cos(fa)); c.arc(p.x, p.y, r, -Math.PI / 2 - fa, -Math.PI / 2 + fa, true); c.lineTo(p.x + nw, neckTop); c.stroke();
    c.beginPath(); c.ellipse(p.x, neckTop, nw + 2.5, 2, 0, 0, TAU); c.stroke();
    c.strokeStyle = T.ink(0.35); c.lineWidth = 1;
    c.beginPath(); c.arc(p.x - hw * 0.15, p.y, hw * 0.62, Math.PI * 1.08, Math.PI * 1.4); c.stroke();
    if (drain[i] > 0) {                              // трещины: зигзаг от удара, жидкость каплями стекает вниз
      const cx = p.x + hw * 0.25, cy = p.y + r * 0.1;
      c.strokeStyle = T.ink(0.85 * drain[i]); c.lineWidth = 1; c.beginPath();
      for (const [a, L] of [[-2.3, 1], [-0.6, 0.8], [0.9, 0.9], [2.4, 0.6]]) {
        c.moveTo(cx, cy);
        for (let q = 1; q <= 3; q++) c.lineTo(cx + Math.cos(a + (q % 2 ? 0.35 : -0.35)) * hw * 0.32 * L * q, cy + Math.sin(a + (q % 2 ? 0.35 : -0.35)) * hw * 0.32 * L * q);
      }
      c.stroke();
      if (broken[i]) for (let k = 0; k < 3; k++) {    // капли падают из трещины
        const t = (now / 900 + k / 3) % 1;
        c.fillStyle = rgba(mixed(i), 0.8 * (1 - t) * Math.max(0.2, 1 - drain[i] * 0.7)); c.beginPath(); c.arc(cx + 2, cy + 6 + t * 46, 1.6, 0, TAU); c.fill();
      }
    }
    if (o.fb > 0.02) {                           // пеликан — горлышко загнуто обратно в тело, с наружной стороны; толще — сильнее
      const sd = CORNER[i][0], sx = p.x + sd * nw, s0 = neckTop + r * 0.35, ex = p.x + sd * hw * 0.92, ey = p.y + r * 0.15;
      const cp = [[sx, s0], [sx + sd * r * 1.5, s0 - r * 0.9], [ex + sd * r * 1.4, ey - r * 0.3], [ex, ey]];
      tube(c, () => { c.beginPath(); c.moveTo(...cp[0]); c.bezierCurveTo(...cp[1], ...cp[2], ...cp[3]); }, 2 + 3 * o.fb, rgba(lighter(col), 0.85), now, o.fb * heat);
      tubes.push({ i, pts: sample([cp]) });
    }
    elementGlyph(c, p.x, p.y - r * 0.42, o.up, o.bar, 5, 0.6);   // знак стихии — на стекле
    T.mapText(o.key, p.x, yBot + 14, 12, held ? 0.9 : 0.55, 'center');
  }
  function elementGlyph(c, x, y, up, bar, s, a) {
    const u = up ? -1 : 1;
    c.strokeStyle = T.ink(a); c.lineWidth = 1;
    c.beginPath(); c.moveTo(x, y + u * s); c.lineTo(x - s * 0.9, y - u * s * 0.6); c.lineTo(x + s * 0.9, y - u * s * 0.6); c.closePath(); c.stroke();
    if (bar) { c.beginPath(); c.moveTo(x - s * 0.8, y + u * s * 0.1); c.lineTo(x + s * 0.8, y + u * s * 0.1); c.stroke(); }
  }
  // стеклянная трубка: белый контур, тёмный просвет, бегут капли цвета источника
  function tube(c, path, w, drop, now, rate = 0.5, drops = false) {
    c.lineCap = 'round';
    path(); c.strokeStyle = T.ink(0.75); c.lineWidth = w + 2.4; c.stroke();
    path(); c.strokeStyle = T.BG; c.lineWidth = w; c.stroke();
    path(); c.strokeStyle = drop; c.lineWidth = Math.max(1.2, w - (drops ? 0.6 : 1.2));
    c.setLineDash(drops ? [0.1, 9] : [2, 7]); c.lineDashOffset = -now * (0.01 + 0.03 * rate); c.stroke(); c.setLineDash([]); c.lineDashOffset = 0;   // капли — круглые
    c.lineCap = 'butt';
  }
  const bez = (a, b, c2, d, t) => { const u = 1 - t; return [u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c2[0] + t * t * t * d[0], u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c2[1] + t * t * t * d[1]]; };
  const sample = (segs) => segs.flatMap((s) => Array.from({ length: 13 }, (_, k) => bez(...s, k / 12)));
  // трубки модуляции идут по «дороге» вокруг квадрата — скруглённому прямоугольнику между колбами и кольцом, каждая в своей полосе.
  // От горлышка: у верхних колб — прямо вверх на дорогу, у нижних — вбок наружу над плечом; в чужое горлышко трубка входит так же
  function road(G, lane) {
    const e = G.s + G.r + 12 + lane * 6, x0 = G.cx - e, x1 = G.cx + e, y0 = G.cy - G.s - G.r * 1.9 - 12 - lane * 6, y1 = G.cy + G.s + G.r + 30 + lane * 6;   // снизу — под подписями колб
    const q = 56 + lane * 14;                          // углы скруглены круто — дорога не выходит за кольцо
    const pts = [];
    for (const [cx, cy, a0] of [[x0 + q, y0 + q, Math.PI], [x1 - q, y0 + q, -Math.PI / 2], [x1 - q, y1 - q, 0], [x0 + q, y1 - q, Math.PI / 2]]) {
      for (let k = 0; k <= 6; k++) { const a = a0 + (k / 6) * (Math.PI / 2); pts.push([cx + Math.cos(a) * q, cy + Math.sin(a) * q]); }
    }
    const out = [];                                   // прямые стороны — точками через 10 px: к дороге можно примкнуть где угодно
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k], b = pts[(k + 1) % pts.length], m = Math.max(1, Math.floor(Math.hypot(b[0] - a[0], b[1] - a[1]) / 10));
      for (let j = 0; j < m; j++) out.push([a[0] + ((b[0] - a[0]) * j) / m, a[1] + ((b[1] - a[1]) * j) / m]);
    }
    return { pts: out, x0, x1, y0, y1 };
  }
  function stub(G, i, rd) {                           // от горлышка до дороги
    const q = flaskGeo(G, i), [dx, dy] = CORNER[i], x = q.p.x, n = q.neckTop - 2;
    if (dy < 0) return [[x, n], [x, n - 8]];
    return [[x, n], [x, n - 14], [dx < 0 ? rd.x0 : rd.x1, n - 14]];
  }
  function route(G, s, d, lane) {
    const rd = road(G, lane), a = stub(G, s, rd), b = stub(G, d, rd).reverse(), N = rd.pts.length;
    const near = (p) => { let bi = 0, bd = 1e9; rd.pts.forEach((q, k) => { const dd = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2; if (dd < bd) { bd = dd; bi = k; } }); return bi; };
    const ia = near(a[a.length - 1]), ib = near(b[0]), fw = (ib - ia + N) % N, bw = (ia - ib + N) % N, mid = [];
    if (fw <= bw) for (let k = 1; k < fw; k++) mid.push(rd.pts[(ia + k) % N]);
    else for (let k = 1; k < bw; k++) mid.push(rd.pts[(ia - k + N) % N]);
    return [...a, ...mid, ...b];
  }
  function smooth(c, pts) {                           // ломаная со скруглёнными изломами
    c.beginPath(); c.moveTo(...pts[0]);
    for (let k = 1; k < pts.length - 1; k++) c.quadraticCurveTo(pts[k][0], pts[k][1], (pts[k][0] + pts[k + 1][0]) / 2, (pts[k][1] + pts[k + 1][1]) / 2);
    c.lineTo(...pts[pts.length - 1]);
  }
  function drawTubes(c, G, now) {
    mods.forEach(([s, d], k) => {
      const pts = route(G, s, d, k % 3);
      tube(c, () => smooth(c, pts), 3, rgba(lighter(mixed(s)), 0.95), now, broken[s] ? 0 : heat * Math.log2(OPS[s].f / 20) / 2.5, true);   // капли — скорость по частоте модулятора
      tubes.push({ s, d, pts });
    });
    for (const i of carriers()) {                 // несущие сливают из горлышка в яйцо
      const q = flaskGeo(G, i), e = G.egg, N = [q.p.x, q.neckTop - 2], M = [e.x + (q.p.x < e.x ? -3 : 3), e.y - e.ry - 12];
      const seg = [N, [N[0], N[1] - (CORNER[i][1] < 0 ? 26 : 30)], [M[0] + (N[0] - M[0]) * 0.45, M[1] - 44], M];
      tube(c, () => { c.beginPath(); c.moveTo(...seg[0]); c.bezierCurveTo(...seg[1], ...seg[2], ...seg[3]); }, 3, rgba(lighter(mixed(i)), 0.95), now, broken[i] ? 0 : OPS[i].level * heat, true);
    }
  }

  // яйцо философов в центре: жидкость — смесь несущих штрихом, поверхность — живая осциллограмма выхода; горлышко — куда льют несущие
  function drawEgg(c, G, now) {
    const e = G.egg, car = carriers(), rx = e.rx, ry = e.ry;
    let col = [0, 0, 0], w = 0;
    for (const i of car) { const m = mixed(i), k = OPS[i].level; for (let q = 0; q < 3; q++) col[q] += m[q] * k; w += k; }
    col = w ? col.map((v) => Math.round(v / w)) : [200, 122, 74];
    const lv = car.length ? clamp(w / car.length) : 0.3, sy = e.y + ry - lv * 2 * ry * 0.8, sc = scope(40);
    c.fillStyle = T.BG; c.beginPath(); c.ellipse(e.x, e.y, rx, ry, 0, 0, TAU); c.fill();
    c.save(); c.beginPath(); c.ellipse(e.x, e.y, rx - 1, ry - 1, 0, 0, TAU); c.clip();
    const surf = () => { for (let k = 0; k <= 40; k++) { const X = e.x - rx + (k / 40) * 2 * rx, Y = sy - (sc ? sc[Math.min(39, k)] * 7 : 0); k ? c.lineTo(X, Y) : c.moveTo(X, Y); } };
    c.strokeStyle = rgba(col, 0.45); c.lineWidth = 1; c.beginPath();
    for (let y = sy + 2; y < e.y + ry; y += 3.4) { c.moveTo(e.x - rx, y); c.lineTo(e.x + rx, y); }
    c.stroke();
    c.beginPath(); surf(); c.strokeStyle = rgba(lighter(col), 0.95); c.lineWidth = 1.4; c.stroke();
    c.restore();
    c.strokeStyle = T.ink(0.9); c.lineWidth = 1.2;
    c.beginPath(); c.ellipse(e.x, e.y, rx, ry, 0, -Math.PI / 2 + 0.25, -Math.PI / 2 - 0.25 + TAU); c.stroke();
    c.strokeStyle = T.ink(0.25); c.lineWidth = 1; c.beginPath(); c.ellipse(e.x, e.y, rx - 4, ry - 4, 0, 0, TAU); c.stroke();
    c.strokeStyle = T.ink(0.9); c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(e.x - 6, e.y - ry + 1); c.lineTo(e.x - 6, e.y - ry - 12); c.moveTo(e.x + 6, e.y - ry + 1); c.lineTo(e.x + 6, e.y - ry - 12); c.stroke();
    c.beginPath(); c.ellipse(e.x, e.y - ry - 12, 8.5, 2, 0, 0, TAU); c.stroke();
  }
  // треножник под яйцом и лампа Гермеса между его ногами: тап — огонь; пламя лижет яйцо, выше — сильнее жар (athanor)
  const lampBox = (G) => ({ x: G.lamp.x, y: G.lamp.y, w: 30, h: 48 });
  function drawStand(c, G, now) {
    const e = G.egg, L = G.lamp;
    c.strokeStyle = T.ink(0.6); c.lineWidth = 1; c.beginPath();
    for (const d of [-1, 1]) { c.moveTo(e.x + d * e.rx * 0.55, e.y + e.ry * 0.83); c.lineTo(e.x + d * e.rx * 1.15, L.y); c.moveTo(e.x + d * (e.rx * 1.15 - 5), L.y); c.lineTo(e.x + d * (e.rx * 1.15 + 5), L.y); }
    c.stroke();
    drawLamp(c, L.x, L.y, 11, now);
  }
  function drawLamp(c, x, y, r, now) {
    const by = y - r - 2;
    c.fillStyle = T.BG; c.strokeStyle = T.ink(0.9); c.lineWidth = 1.1;
    c.beginPath(); c.ellipse(x, by, r, r * 0.8, 0, 0, TAU); c.fill(); c.stroke();   // резервуар
    c.save(); c.beginPath(); c.ellipse(x, by, r - 1, r * 0.8 - 1, 0, 0, TAU); c.clip();
    c.fillStyle = rgba([150, 190, 220], 0.28); c.fillRect(x - r, by - r * 0.1, 2 * r, r);   // спирт
    c.restore();
    c.beginPath(); c.moveTo(x - r * 0.9, y); c.lineTo(x + r * 0.9, y); c.stroke();   // подставка
    c.beginPath(); c.rect(x - 3, by - r * 0.8 - 6, 6, 6); c.stroke();               // горлышко с фитилём
    c.beginPath(); c.moveTo(x, by - r * 0.8 - 6); c.lineTo(x, by - r * 0.8 - 9); c.stroke();
    const top = by - r * 0.8 - 9;
    if (heat < 0.05) { T.dot(x, top, 1.2, 0.35 + 0.15 * Math.sin(now * 0.003)); return; }   // погас — тлеет фитиль
    const hh = heat * (12 + 26 * fx.athanor) * (0.85 + 0.15 * Math.sin(now * 0.013)), w = 4 + 3 * fx.athanor, sway = Math.sin(now * 0.006) * 2;
    for (const [k, a] of [[1, 0.9], [0.55, 0.55]]) {  // пламя: внешнее и внутреннее
      c.strokeStyle = T.ink(a); c.lineWidth = 1;
      c.beginPath(); c.moveTo(x - w * k, top); c.quadraticCurveTo(x - w * k, top - hh * k * 0.55, x + sway * k, top - hh * k);
      c.quadraticCurveTo(x + w * k, top - hh * k * 0.55, x + w * k, top); c.quadraticCurveTo(x, top + 3, x - w * k, top); c.stroke();
    }
  }
  // сажа: над яйцом копится, пока горит; кувшин её не смывает — история сессии
  function drawSoot(c, G) {
    if (soot < 0.01) return;
    const e = G.egg, x = e.x, y0 = e.y - e.ry - 16, H = 20 + 60 * soot;
    c.strokeStyle = T.ink(0.06 + 0.2 * soot); c.lineWidth = 0.8; c.beginPath();
    for (let k = -6; k <= 6; k++) {
      const xx = x + k * 4, hh = H * (1 - Math.abs(k) / 7) * (0.8 + 0.2 * Math.sin(k * 7.3));
      c.moveTo(xx, y0); c.quadraticCurveTo(xx + k * 0.8, y0 - hh * 0.6, xx + k * 1.6, y0 - hh);
    }
    c.stroke();
  }

  // кувшин с водой — за кольцом слева внизу: тап — заливает огонь, всё в лаборатории затихает (пар и шипение)
  let pourAt = -1e9;
  const POUR_MS = 1600;
  const jugBox = (G) => ({ x: Math.max(30, G.cx - G.R * 0.92), y: Math.min(G.cy + G.R + 70, G.band - 22), w: 26, h: 40 });
  function drawJug(c, G, now) {
    const { x, y, h } = jugBox(G), k = clamp((now - pourAt) / POUR_MS), tilt = k < 1 ? Math.sin(Math.min(1, k * 1.6) * Math.PI) * -0.95 : 0;
    const L = G.lamp;
    if (k < 1 && tilt < -0.4) {                        // струя из носика к лампе
      const sx = x + 24, sy = y - h + 6;
      c.strokeStyle = rgba(OPS[2].col, 0.85); c.lineWidth = 2.2;
      c.setLineDash([4, 3]); c.lineDashOffset = -now * 0.12;
      c.beginPath(); c.moveTo(sx, sy); c.quadraticCurveTo(sx + 30, sy - 60, L.x - 4, L.y - 20); c.stroke();
      c.setLineDash([]); c.lineDashOffset = 0;
    }
    if (k < 1 && k > 0.25) {                           // пар от лампы
      for (let i = 0; i < 6; i++) {
        const t = (k - 0.25) / 0.75, px = L.x - 14 + i * 6 + Math.sin(now * 0.004 + i) * 4, py = L.y - 24 - t * 60 - i * 5;
        c.strokeStyle = T.ink(0.5 * (1 - t)); c.lineWidth = 1;
        c.beginPath(); c.arc(px, py, 4 + t * 8, Math.PI * 1.1, Math.PI * 1.9); c.stroke();
      }
    }
    c.save(); c.translate(x, y); c.scale(-1, 1); c.rotate(tilt);   // носик — вправо, к лампе
    const body = () => {
      c.beginPath(); c.moveTo(-9, 0); c.bezierCurveTo(-17, -10, -15, -26, -7, -30); c.lineTo(-8, -h + 4); c.lineTo(-14, -h + 1);
      c.lineTo(-7, -h); c.lineTo(8, -h); c.lineTo(7, -30); c.bezierCurveTo(15, -26, 17, -10, 9, 0); c.closePath();
    };
    c.fillStyle = T.BG; body(); c.fill();
    c.save(); body(); c.clip();
    const wl = k < 1 ? -18 + 12 * k : -20;             // вода — штрихом, убывает, пока льём
    c.strokeStyle = rgba(OPS[2].col, 0.6); c.lineWidth = 1; c.beginPath();
    for (let yy = wl; yy < 0; yy += 3.4) { c.moveTo(-20, yy); c.lineTo(20, yy); }
    c.stroke();
    c.restore();
    c.strokeStyle = T.ink(0.85); c.lineWidth = 1.1; body(); c.stroke();
    c.beginPath(); c.moveTo(8, -h + 6); c.bezierCurveTo(20, -h + 4, 22, -18, 12, -12); c.stroke();   // ручка
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
    lastSound = performance.now(); setLive(true);
  }
  function crack() {                                 // звон разбитого стекла: короткие высокие синусы и щелчок шума
    if (!actx || !bus) return;
    const ctx = actx, t = ctx.currentTime;
    for (const [hz, d, a] of [[3170, 0.25, 0.05], [4410, 0.18, 0.04], [5830, 0.12, 0.03], [2390, 0.3, 0.03]]) {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = hz * (1 + (Math.random() - 0.5) * 0.04);
      g.gain.setValueAtTime(a, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d); o.connect(g).connect(bus.out); o.start(t); o.stop(t + d + 0.02);
      o.onended = () => { o.disconnect(); g.disconnect(); };
    }
    lastSound = performance.now(); setLive(true);
  }
  function douse() {                                  // залить огонь: гаснет всё — огонь и оставленные банки
    pourAt = performance.now();
    setTimeout(() => {
      hiss();
      for (const [k, gr] of [...voices]) if (k !== 'fire') { kill(gr, 0.4); voices.delete(k); }
      setFire(false);
    }, 450);
  }

  // ---------- solve и coagula — дуги на кольце эмблемы, слева и справа внизу (под большой палец); тянешь вверх или вправо — больше.
  // Залитая часть дуги — значение: solve — ртуть, coagula — сера; слова гравированы по кольцу снаружи и разгораются с coagula ----------
  const KNOBS = ['solve', 'coagula'];
  const ARC = { solve: [166, 118], coagula: [62, 14] };        // градусы: значение 0 → 1, слева направо по низу кольца
  const VIAL = { solve: [200, 206, 216], coagula: [217, 182, 74] };
  const arcAng = (k, v) => deg(ARC[k][0] + (ARC[k][1] - ARC[k][0]) * v);
  const knobAt = (G, k) => { const a = arcAng(k, 0.5); return { x: G.cx + Math.cos(a) * (G.R + 4), y: G.cy + Math.sin(a) * (G.R + 4), R: 14 }; };
  function knobHit(G, k, x, y) {
    const d = Math.hypot(x - G.cx, y - G.cy), a = ((Math.atan2(y - G.cy, x - G.cx) * 180) / Math.PI + 360) % 360, [a0, a1] = ARC[k];
    return Math.abs(d - G.R - 4) < 20 && a > Math.min(a0, a1) - 5 && a < Math.max(a0, a1) + 5;
  }
  function drawArcs(c, G, now, held) {
    for (const k of KNOBS) {
      const [a0, a1] = ARC[k], rr = G.R + 4, v = fx[k], h = held.has(k);
      c.strokeStyle = T.ink(h ? 0.3 : 0.16); c.lineWidth = 7;
      c.beginPath(); c.arc(G.cx, G.cy, rr, deg(Math.min(a0, a1)), deg(Math.max(a0, a1))); c.stroke();
      if (v > 0.005) { c.strokeStyle = rgba(VIAL[k], h ? 0.95 : 0.8); c.beginPath(); c.arc(G.cx, G.cy, rr, arcAng(k, v), deg(a0)); c.stroke(); }
      const e = arcAng(k, v);                           // засечка на конце значения
      c.strokeStyle = T.ink(0.8); c.lineWidth = 1;
      c.beginPath(); c.moveTo(G.cx + Math.cos(e) * (rr - 6), G.cy + Math.sin(e) * (rr - 6)); c.lineTo(G.cx + Math.cos(e) * (rr + 6), G.cy + Math.sin(e) * (rr + 6)); c.stroke();
      // слово по кольцу: буквы вдоль дуги; coagula разгорается, при длинном solve буквы дрожат (крошево)
      const word = k.toUpperCase(), step = 4.6, mid = (a0 + a1) / 2, al = (k === 'coagula' ? 0.35 + 0.55 * fx.coagula : 0.55) + (h ? 0.2 : 0);
      const jit = fx.coagula > 0.02 ? fx.solve * fx.solve * 2.5 : 0;
      c.font = `13px ${T.MAP}`; c.textAlign = 'center'; c.textBaseline = 'middle';
      [...word].forEach((ch, j) => {
        const a = deg(mid + ((word.length - 1) / 2 - j) * step), q = jit * Math.sin(now * 0.013 * (1 + (j % 3)) + j * 1.7), R2 = G.R + 26 + q;
        c.fillStyle = T.ink(Math.min(1, al));
        c.save(); c.translate(G.cx + Math.cos(a) * R2, G.cy + Math.sin(a) * R2); c.rotate(a - Math.PI / 2); c.fillText(ch, 0, 0); c.restore();
      });
      if (h) { const a = deg(mid), p = [G.cx + Math.cos(a) * (G.R - 22), G.cy + Math.sin(a) * (G.R - 22)]; T.mapText(fxw.text(k), p[0], p[1], 13, 0.9, 'center'); }
    }
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
  // семь металлов — полоса медальонов под эмблемой, по пологой дуге; металл в ладу — двойной обвод и знак ярче
  const jarBox = (G, i) => { const x0 = 34, x1 = G.W - 116, X = x0 + (i / 6) * (x1 - x0), cy = G.band - 10 + (i - 3) ** 2 * 2; return { X, y: cy + 17, w: 34, h: 34, cy }; };
  function drawJars(c, G, now) {
    for (let i = 0; i < 7; i++) {
      const { X, cy } = jarBox(G, i), v = voices.get(i), on = !!(v && v.on);
      const pcs = T.scalePCs, inScale = pcs && pcs.includes(((jars[i] % 12) + 12) % 12);
      if (on) T.glowAt(X, cy, 30, 0.2);
      c.fillStyle = T.BG; c.beginPath(); c.arc(X, cy, 16, 0, TAU); c.fill();
      T.ring(X, cy, 16, on ? 1 : inScale ? 0.85 : 0.4, on ? 1.5 : 1);
      if (inScale) T.ring(X, cy, 20, 0.25, 1);
      planet(c, METALS[i], X, cy, 7, on ? 1 : inScale ? 0.95 : 0.45);
      if (v && v.latched) T.dot(X, cy + 25, 1.8, 0.8);   // оставлена звучать
    }
  }

  // солнце — четверть из правого верхнего угла (угол к центру карты); белым по чёрному
  let noSun = false;                                // снимок для карты — без солнца: на карте солнце одно, в центре
  function drawSun(c, G, now) { if (!noSun) T.quarterSun(c, G.sun.x, G.sun.y, G.sun.r, -1, now); }

  // ---------- фон: чёрное поле и бледная геометрия эмблемы — квадрат через колбы, треугольник, круги; кольцо со шкалой.
  // Одна картинка на размер экрана ----------
  let wallC = null, wallKey = '';
  function wall(G) {
    const key = `${G.W}x${G.H}x${T.DPR}|${G.cx}|${G.cy}|${G.R}`;
    if (wallC && key === wallKey) return wallC;
    wallKey = key;
    wallC = document.createElement('canvas');
    wallC.width = Math.round(G.W * T.DPR); wallC.height = Math.round(G.H * T.DPR);
    const x = wallC.getContext('2d');
    x.setTransform(T.DPR, 0, 0, T.DPR, 0, 0);
    x.fillStyle = T.BG; x.fillRect(0, 0, G.W, G.H);
    const ink = (a) => `rgba(237,237,237,${a})`, { cx, cy, R, s } = G;
    const circ = (r, a) => { x.strokeStyle = ink(a); x.beginPath(); x.arc(cx, cy, r, 0, TAU); x.stroke(); };
    x.lineWidth = 1;
    x.strokeStyle = ink(0.11); x.strokeRect(cx - s, cy - s, 2 * s, 2 * s);
    x.beginPath(); for (let k = 0; k < 3; k++) { const a = -Math.PI / 2 + (k * TAU) / 3; k ? x.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R) : x.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); } x.closePath(); x.stroke();
    circ(s * Math.SQRT2, 0.1); circ(R * 0.36, 0.11);
    circ(R, 0.75); circ(R + 8, 0.3);
    x.strokeStyle = ink(0.35); x.beginPath();
    for (let d = 0; d < 360; d += 5) { const a = deg(d), l = d % 15 ? 2.5 : 5; x.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); x.lineTo(cx + Math.cos(a) * (R + l), cy + Math.sin(a) * (R + l)); }
    x.stroke();
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
    const sc = makeSolve(ctx); shaper.connect(sc.input); sc.wet.connect(out); sc.wet.connect(hallSend);
    shaper.connect(hallSend); hallSend.connect(h.input); h.out.connect(g(0.9)).connect(out);
    bus = { sum, shaper, out, hallSend, hall: h, an, buf: new Float32Array(1024), sc, input, live: false };
    voices.clear(); curveK = -1;
    applyFx();
    if (fire) setFire(true);
  }
  // solve · coagula: три отвода одной задержки → фильтр → «биты» (ступенчатый шейпер) → срез низа → петля; тиканье часов чипа
  function makeSolve(ctx) {
    const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const bq = (type, f, q) => { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; return n; };
    const input = g(0), head = g(1), mix = g(1), lp = bq('lowpass', 6000, 1.4), hp = bq('highpass', 70, 0.7), crush = ctx.createWaveShaper(), fb = g(0), wet = g(0);
    const taps = [[1, 1], [2 / 3, 0.4], [1 / 3, 0.25]].map(([k, a]) => { const d = ctx.createDelay(2.5); head.connect(d); d.connect(g(a)).connect(mix); return { d, k }; });
    input.connect(head); mix.connect(lp).connect(crush).connect(hp); hp.connect(fb).connect(head); hp.connect(wet);
    return { input, taps, lp, crush, fb, wet, mix, tick: null, tickG: null, bits: 0 };
  }
  function solveFx(t) {
    const sc = bus.sc, ctx = actx, on = fx.coagula > 0.02, sec = 0.002 * 600 ** fx.solve, S = (p, v, tau = 0.05) => p.setTargetAtTime(v, t, tau);
    S(sc.input.gain, on ? 1 : 0); S(sc.wet.gain, Math.min(1, fx.coagula * 1.4)); S(sc.fb.gain, fx.coagula * 0.55);
    for (const tp of sc.taps) S(tp.d.delayTime, sec * tp.k, 0.08);   // время едет — тон плывёт, как у чипа
    S(sc.lp.frequency, 600 + 9000 * (1 - fx.solve) ** 2);             // длиннее — темнее
    const bits = Math.round(12 - 8 * fx.solve);   // плохой чип: длиннее задержка — меньше бит
    if (bits !== sc.bits) {                                            // меньше бит — грубее ступени
      sc.bits = bits;
      const n = 4096, cv = new Float32Array(n), st = 2 ** (bits - 1);
      for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; cv[i] = Math.round(x * st) / st; }
      sc.crush.curve = cv;
    }
    if (on && !sc.tick) {                                              // тиканье часов и шип чипа — только пока эффект включён
      sc.tick = ctx.createOscillator(); sc.tick.type = 'square'; sc.tickG = g0(ctx, 0);
      sc.tick.connect(sc.tickG).connect(sc.mix); sc.tick.start();
      const n = ctx.sampleRate, buf = ctx.createBuffer(1, n, n), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      sc.hissSrc = ctx.createBufferSource(); sc.hissSrc.buffer = buf; sc.hissSrc.loop = true; sc.hissG = g0(ctx, 0);
      sc.hissSrc.connect(sc.hissG).connect(sc.mix); sc.hissSrc.start();
    } else if (!on && sc.tick) {
      sc.tick.stop(); sc.tick.disconnect(); sc.tick = null;
      sc.hissSrc.stop(); sc.hissSrc.disconnect(); sc.hissSrc = null;
    }
    if (sc.tick) {
      S(sc.tick.frequency, Math.min(3000, 30 / sec)); S(sc.tickG.gain, 0.006 * fx.solve * fx.solve);
      S(sc.hissG.gain, 0.012 * fx.solve ** 3);
    }
  }
  const g0 = (ctx, v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
  // молчит дольше хвоста — лаборатория отцеплена от выхода и от анализатора: её граф, стекло и solve не считаются
  let lastSound = 0;
  function setLive(on) {
    if (!bus || bus.live === on) return;
    bus.live = on;
    if (on) { bus.out.connect(bus.input); bus.out.connect(bus.an); } else bus.out.disconnect();
  }
  setInterval(() => {
    if (!bus) return;
    if (voices.size) lastSound = performance.now();
    else if (performance.now() - lastSound > 7000) setLive(false);
  }, 1000);
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
    solveFx(t);
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
    lastSound = performance.now(); setLive(true);
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
        S(gr.outs[i].gain, gr.car.includes(i) && !broken[i] ? o.level * 0.3 : 0);
        if (gr.fbs[i]) S(gr.fbs[i].gain, broken[i] ? 0 : o.fb * o.f * gr.ratio * 1.2);
      });
      for (const e of gr.edges) {                   // индекс до 3: девиация = уровень × 3 × частота приёмника
        const base = broken[e.s] ? 0 : OPS[e.s].level * 3 * OPS[e.d].f * gr.ratio;   // разбитая колба не модулирует
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
  let lastJarTap = null, lastFlaskTap = null;
  function hitFlask(G, x, y) {
    for (let i = 0; i < OPS.length; i++) {
      const q = flaskGeo(G, i);
      if (Math.abs(x - q.p.x) < 20 && y > q.neckTop - 16 && y < q.yTop + 4) return { i, part: 'neck' };
      if (Math.abs(x - q.p.x) < q.hw + 10 && y > q.yTop - 4 && y < q.yBot + 10) return { i, part: 'body' };
    }
    return null;
  }
  function hitJar(G, x, y) {
    for (let i = 0; i < 7; i++) { const b = jarBox(G, i); if (Math.hypot(x - b.X, y - b.cy) < 21) return i; }
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
    if (best) best.dist = bd;
    return best;
  }
  function down(f) {
    const G = geo();
    for (const k of KNOBS) if (knobHit(G, k, f.x, f.y)) { touches.set(f.id, { kind: 'knob', k, v0: fx[k] }); return; }
    const j = hitJar(G, f.x, f.y);
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
    if (h) { const o = OPS[h.i]; touches.set(f.id, { kind: 'flask', i: h.i, f0: o.f, l0: o.level, axis: null, t0: performance.now() }); focusI = h.i; focusUntil = performance.now() + 1500; return; }
    const jb = jugBox(G);
    if (Math.abs(f.x - jb.x) < 26 && f.y > jb.y - jb.h - 12 && f.y < jb.y + 10) { touches.set(f.id, { kind: 'jug' }); return; }
    const lb = lampBox(G);
    if (Math.abs(f.x - lb.x) < lb.w + 6 && f.y > lb.y - lb.h - 14 && f.y < lb.y + 10) { touches.set(f.id, { kind: 'fire' }); return; }   // лампа в арке — зажечь
    touches.set(f.id, { kind: 'none' });
  }
  function move(f) {
    const t = touches.get(f.id);
    if (!t) return;
    t.x = f.x; t.y = f.y;
    const dx = f.x - f.x0, dy = f.y - f.y0;
    if (t.kind === 'knob') { fxw.set(t.k, clamp(t.v0 + (dx - dy) / 160)); return; }   // вверх или вправо — больше
    if (t.kind === 'jar') {                          // банку вверх-вниз — её нота (6 px на полутон, с ладом — по ступеням)
      if (!t.drag && Math.abs(dy) > 10) t.drag = true;
      if (!t.drag) return;
      let s = clamp(Math.round(t.s0 - dy / 6), 0, 48);
      if (T.scaleOn) s = T.snapSemi(s);
      if (s !== jars[t.j]) { jars[t.j] = s; const gr = voices.get(t.j); if (gr) { gr.ratio = jarRatio(t.j); setParams(false, gr); } }
      return;
    }
    if (t.kind !== 'flask' || t.sheet) return;   // открыта плашка колбы — палец больше ничего не двигает
    focusI = t.i; focusUntil = performance.now() + 1500;
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
    if (t.kind === 'flask' && t.sheet) return;
    if (t.kind === 'flask' && !t.axis && performance.now() - f.t0 < 300) {   // двойной тап по колбе — разбить / починить
      const now = performance.now();
      if (lastFlaskTap && lastFlaskTap.i === t.i && now - lastFlaskTap.t < T.DTAP_MS) { broken[t.i] = !broken[t.i]; lastFlaskTap = null; if (broken[t.i]) crack(); setParams(); }
      else lastFlaskTap = { i: t.i, t: now };
      return;
    }
    if (t.kind === 'fire' && !moved) { if (!fire) setFire(true); }   // лампа только зажигает; гасит кувшин
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
        T.mapText(noteName(55 * 2 ** (jars[t.j] / 12)), b.X, b.cy - 30, 15, 0.95, 'center');
      }
    }
  }

  // плашка колбы (держишь тело): высота, уровень (у несущей — громкость, у модулятора — индекс), пеликан
  function flaskSheet(i) {
    const o = OPS[i], car = () => !mods.some((m) => m[0] === i);
    focusI = i; focusUntil = performance.now() + 3000;
    T.openSheet({
      title: o.key, hint: 'flask — tap outside to close',
      rows: [{ key: 'pitch', label: 'pitch' }, { key: 'level', label: car() ? 'volume' : 'index' }, { key: 'fb', label: 'pelican' }],
      get: (k) => (k === 'pitch' ? (12 * Math.log2(o.f / 55) + 12) / 72 : o[k]),
      set: (k, t) => {
        if (k === 'pitch') { let st = -12 + t * 72; if (T.scaleOn) st = T.snapSemi(Math.round(st)); o.f = 55 * 2 ** (st / 12); }
        else if (k === 'fb') { const was = o.fb > 0.02; o.fb = t < 0.02 ? 0 : t; if (was !== o.fb > 0.02) rewire(); }
        else o.level = t;
        focusI = i; focusUntil = performance.now() + 1500;
        setParams();
      },
      text: (k) => (k === 'pitch' ? `${noteName(o.f)} · ${Math.round(o.f)} Hz` : k === 'fb' ? (o.fb > 0.02 ? `${Math.round(o.fb * 100)}%` : 'off') : `${Math.round(o.level * 100)}%`),
    });
  }

  // ---------- мир ----------
  const fxw = {
    sectors: [
      { key: 'athanor', label: 'athanor', ang: deg(180) },
      { key: 'vitrum', label: 'vitrum', ang: deg(150) },
      { key: 'circulatio', label: 'circulatio', ang: deg(120) },   // solve и coagula — уроборосы у печи, не в веере
    ],
    get: (k) => fx[k], set: (k, v) => { fx[k] = v; applyFx(); }, text: (k) => { if (k === 'solve') { const ms = 2 * 600 ** fx.solve; return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`; } return `${Math.round(fx[k] * 100)}%`; },
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
    rewire();                                         // огонь не трогает: погашен — так и остаётся
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
      for (const t of touches.values()) if (t.kind === 'flask' && !t.axis && !t.sheet && now - t.t0 > T.HOLD_MS) { t.sheet = true; flaskSheet(t.i); }   // держишь колбу — плашка снизу
      heat += ((fire ? 1 : 0) - heat) * (1 - Math.exp(-dt / (fire ? 0.35 : 0.6)));
      for (let i = 0; i < 4; i++) drain[i] = clamp(drain[i] + (broken[i] ? dt / 1.6 : -dt / 0.5));   // вытекает за 1.6 с, чинится за 0.5
      soot = Math.min(1, soot + (dt * heat) / 240);   // за 4 минуты огня — густая
      tubes.length = 0;
      c.drawImage(wall(G), 0, 0, T.W, T.H);
      drawSun(c, G, now);
      drawBanner(c, G, now);
      drawSoot(c, G);
      const heldK = new Set([...touches.values()].filter((t) => t.kind === 'knob').map((t) => t.k));
      drawArcs(c, G, now, heldK);
      drawTubes(c, G, now);
      drawStand(c, G, now);
      drawEgg(c, G, now);
      const held = new Set([...touches.values()].filter((t) => t.kind === 'flask').map((t) => t.i));
      for (let i = 0; i < OPS.length; i++) drawFlask(c, i, G, now, held.has(i));
      drawSteam(c, G, now);
      drawJug(c, G, now);
      drawJars(c, G, now);
      drawRoot(c);
      drawTouches(c, G, now);
    },
    down, move, up, dice,
    mapShot(on) { noSun = on; },
    clear() {
      mods = []; for (const o of OPS) o.fb = 0; broken.fill(false);
      for (const [k, gr] of [...voices]) if (k !== 'fire') { kill(gr, 0.2); voices.delete(k); }
      rewire(); setFire(false);
    },
    snapshot: () => JSON.stringify({ ops: OPS.map((o) => ({ f: Math.round(o.f * 100) / 100, level: Math.round(o.level * 1e3) / 1e3, fb: o.fb })), mods, fx, fire, jars, broken }),
    restore(js) {
      const st = JSON.parse(js);
      st.ops.forEach((s, i) => Object.assign(OPS[i], s));
      mods = st.mods.map((m) => m.slice()); Object.assign(fx, st.fx);
      if (st.jars) st.jars.forEach((v, i) => { jars[i] = v; });
      for (let i = 0; i < 4; i++) broken[i] = !!(st.broken && st.broken[i]);
      applyFx(); rewire(); if (st.fire !== fire) setFire(st.fire);
    },
    sounding: () => fire || [...voices.values()].some((v) => v.on),
  };
  T.registerWorld(3, lab);
  window.t2d.lab = {
    OPS, fx, geo, mixed, jars, waveOf, waveOut, get focus() { return focusI; }, setFx: (k, v) => fxw.set(k, v), get solveOn() { return !!(bus && bus.sc.tick); }, get mods() { return mods; }, get fire() { return fire; }, get live() { return voices.has('fire'); },
    get broken() { return broken.slice(); }, get soot() { return soot; }, lamp: () => { const b = lampBox(geo()); return { x: b.x, y: b.y - 14 }; },
    get voices() { return [...voices].map(([k, v]) => ({ k, on: v.on, latched: v.latched })); },
    jar: (i) => { const b = jarBox(geo(), i); return { x: b.X, y: b.cy }; },
    at: (i) => { const q = flaskGeo(geo(), i); return { x: q.p.x, y: (q.yTop + q.yBot) / 2, neckY: q.neckTop + 4 }; },
    knob: (k) => { const q = knobAt(geo(), k); return { x: q.x, y: q.y }; },
    jug: () => { const b = jugBox(geo()); return { x: b.x, y: b.y - b.h / 2 }; },
    furnace: () => { const b = lampBox(geo()); return { x: b.x, y: b.y - 14 }; },
    tubeAt: (s, d) => { const t = tubes.find((q) => q.s === s && q.d === d), G = geo(); if (!t) return null; const p = t.pts.find((q, k) => k > 3 && !hitFlask(G, q[0], q[1])) || t.pts[8]; return { x: p[0], y: p[1] }; },   // точка трубки не над колбой
  };
})();
