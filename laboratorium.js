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
  let soot = 0, catUp = 0;                      // сажа на стене над лампой — копится, пока горит; кот поднял голову (время)
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
    // свиток с формой волны — вверху, слева от солнца; под ним ярусы колб растягиваются на всю высоту:
    // меньше ярусов — крупнее колбы и шире шаг
    const scroll = { x0: 16, x1: W - 96, y0: top + 8, y1: top + 8 + Math.min(64, 0.09 * h) };
    const lv = OPS.map((_, i) => levelOf(i)), nT = Math.max(...lv) + 1;
    const perTier = Math.max(...Array.from({ length: nT }, (_, l) => lv.filter((v) => v === l).length));
    const L0 = egg.y - 0.17 * h, yMin = scroll.y1 + 34;
    let r = Math.min(42, W / (perTier * 3.2));
    if (nT > 1) r = Math.min(r, (L0 - yMin) / (2.7 * (nT - 1) + 2.4));   // ярусы вразбежку — колбы могут стоять теснее по высоте
    r = Math.max(20, r);
    const dy = nT > 1 ? (L0 - yMin - 2.4 * r) / (nT - 1) : 0;
    const pos = [], car = carriers();
    car.forEach((i, k) => { pos[i] = { x: W * (car.length === 1 ? 0.5 : 0.22 + (0.56 * k) / (car.length - 1)), y: L0 }; });
    for (let l = 1; l <= 3; l++) {
      const at = OPS.map((_, i) => i).filter((i) => lv[i] === l);
      at.forEach((i, k) => {
        const outs = mods.filter((m) => m[0] === i).map((m) => pos[m[1]]).filter(Boolean);
        const x = outs.length ? outs.reduce((s, p) => s + p.x, 0) / outs.length : W / 2;
        const zig = at.length === 1 ? (l % 2 ? 1 : -1) * W * 0.21 : (k - (at.length - 1) / 2) * W * 0.32;   // один на ярусе — вразбежку от того, в кого льёт: трубки читаются, колонки нет
        pos[i] = { x: clamp(x + zig, W * 0.17, W * 0.83), y: L0 - l * dy };
      });
    }
    return { W, H, top, bot, h, shelf, egg, furn, r, pos, scroll, tiers: Array.from({ length: nT }, (_, l) => L0 - l * dy), sun: { x: W, y: T.topY + 2, r: Math.min(64, W * 0.16) } };   // солнце — в правом верхнем углу, к центру карты
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

  // свиток: крупно форма волны — колбы, которую держишь (её цветом, с нотой), иначе бледно — всего аппарата
  let focusI = null, focusUntil = 0;
  function drawScroll(c, G, now) {
    const { x0, x1, y0, y1 } = G.scroll, cy = (y0 + y1) / 2, hh = (y1 - y0) / 2;
    const live = focusI != null && now < focusUntil;
    c.fillStyle = T.BG; c.fillRect(x0 + 6, y0, x1 - x0 - 12, y1 - y0);
    c.strokeStyle = T.ink(0.75); c.lineWidth = 1.1;
    c.beginPath(); c.moveTo(x0 + 6, y0 + 0.5); c.lineTo(x1 - 6, y0 + 0.5); c.moveTo(x0 + 6, y1 - 0.5); c.lineTo(x1 - 6, y1 - 0.5); c.stroke();
    for (const [x, d] of [[x0 + 6, -1], [x1 - 6, 1]]) {   // свёрнутые концы свитка
      c.beginPath(); c.ellipse(x, cy, 6, hh, 0, 0, TAU); c.stroke();
      c.beginPath(); c.arc(x + d * 1, cy - hh * 0.35, 2.5, 0, TAU); c.stroke();
    }
    c.strokeStyle = T.ink(0.15); c.lineWidth = 0.8; c.setLineDash([2, 4]);
    c.beginPath(); c.moveTo(x0 + 14, cy); c.lineTo(x1 - 14, cy); c.stroke(); c.setLineDash([]);
    const w = live ? waveOf(focusI) : waveOut();
    if (!w) return;
    const n = w.length, xa = x0 + 16, xb = x1 - 16, amp = hh - 7;
    c.strokeStyle = live ? rgba(mixed(focusI).map((v) => Math.min(255, v + 50)), 0.95) : T.ink(heat > 0.05 || voices.size ? 0.55 : 0.3);
    c.lineWidth = live ? 1.8 : 1.2; c.lineJoin = 'round';
    c.beginPath();
    for (let k = 0; k < n; k++) { const X = xa + (k / (n - 1)) * (xb - xa), Y = cy - w[k] * amp; k ? c.lineTo(X, Y) : c.moveTo(X, Y); }
    c.stroke();
    if (live) { const o = OPS[focusI]; T.mapText(`${o.key} · ${noteName(o.f)}`, xa, y0 + 10, 12, 0.75, 'left'); }
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

  // стеллаж: под каждым ярусом колб — полка двойной линией на кронштейнах (несущие — на нижней, над яйцом)
  function drawRack(c, G) {
    c.strokeStyle = T.ink(0.5); c.lineWidth = 1;
    for (const y0 of G.tiers) {                    // полка — только под колбами своего яруса, шея нижних её не пересекает
      const xs = OPS.map((_, i) => P(i)).filter((p) => Math.abs(p.y - y0) < 2).map((p) => p.x);
      if (!xs.length) continue;
      const y = y0 + G.r * 0.95 + 4, x0 = Math.max(10, Math.min(...xs) - G.r * 1.6), x1 = Math.min(G.W - 10, Math.max(...xs) + G.r * 1.6);
      c.beginPath(); c.moveTo(x0, y + 0.5); c.lineTo(x1, y + 0.5); c.moveTo(x0, y + 4.5); c.lineTo(x1, y + 4.5); c.stroke();
      c.beginPath(); for (const bx of [x0 + 10, x1 - 10]) { c.moveTo(bx, y + 5); c.lineTo(bx, y + 16); c.lineTo(bx + (bx < G.W / 2 ? 10 : -10), y + 5); } c.stroke();
    }
  }
  const tubes = [];                          // для попадания пальцем: [{ s, d, pts }] и пеликаны [{ i, pts }]
  function drawFlask(c, i, G, now, held) {
    const o = OPS[i], { p, yTop, yBot, hw } = flaskGeo(G, i), r = G.r, col = mixed(i);
    c.save();
    c.beginPath(); flaskPath(c, o.shape, p.x, p.y, r); c.closePath(); c.clip();
    const lvl = o.level * (1 - drain[i]), sy = yBot - lvl * (yBot - yTop), wv = waveOf(i), n = wv.length, amp = Math.min(5, (yBot - yTop) * 0.12) * (0.8 + 0.3 * heat);
    c.beginPath(); c.moveTo(p.x - hw - 2, yBot + 4);
    for (let k = 0; k < n; k++) c.lineTo(p.x - hw - 2 + (k / (n - 1)) * (2 * hw + 4), sy - wv[k] * amp);   // поверхность — форма волны
    c.lineTo(p.x + hw + 2, yBot + 4); c.closePath();
    c.fillStyle = rgba(col, 0.78); c.fill();
    c.strokeStyle = rgba(col.map((v) => Math.min(255, v + 60)), 0.9); c.lineWidth = 1; c.stroke();
    // пузыри — пока горит огонь, в такт биениям FM: чем больше индекс, тем мельче и чаще; у пеликана — кипит
    const idx = mods.filter(([a, d]) => d === i && !broken[a]).reduce((q, [a]) => q + OPS[a].level, 0), boil = broken[i] ? 0 : o.fb;
    const nb = broken[i] ? 0 : Math.round(heat * (1 + fx.athanor * 2 + idx * 4 + boil * 8)), per = 1500 / (1 + idx * 1.5 + boil * 3);
    for (let k = 0; k < nb; k++) {
      const t = (now / (per + k * 170) + k * 0.37) % 1, bx = p.x + Math.sin(k * 2.3 + t * 5) * hw * 0.55, by = yBot - 4 - t * (yBot - sy - 4);
      T.ring(bx, by, (1.8 + (k % 3) * 0.5) / (1 + idx * 0.8) + boil * 1.2, 0.5 * (1 - t), 0.8);
    }
    c.restore();
    c.strokeStyle = T.ink(held ? 1 : 0.9); c.lineWidth = held ? 1.8 : 1.2;   // стекло: контур, устье, блик
    c.beginPath(); const nk = flaskPath(c, o.shape, p.x, p.y, r); c.stroke();
    c.beginPath(); c.ellipse(p.x, nk.neckTop, nk.nw + 2.5, 2, 0, 0, TAU); c.stroke();
    c.strokeStyle = T.ink(0.35); c.lineWidth = 1;
    c.beginPath(); c.arc(p.x - hw * 0.15, (yTop + yBot) / 2, hw * 0.62, Math.PI * 1.08, Math.PI * 1.4); c.stroke();
    if (drain[i] > 0) {                              // трещины: зигзаг от удара, жидкость каплями стекает вниз
      const cx = p.x + hw * 0.25, cy = (yTop + yBot) / 2 + r * 0.1;
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
    if (o.fb > 0.02) {                           // пеликан — наружу, толще — сильнее
      let sd = p.x <= G.W / 2 ? -1 : 1;
      if (p.x + sd * (hw + r * 1.6) < 8 || p.x + sd * (hw + r * 1.6) > G.W - 8) sd = -sd;   // у края — петля внутрь, не за экран
      const sx = p.x + sd * nk.nw, s0 = nk.neckTop + r * 0.35, ex = p.x + sd * hw * 0.92, ey = (yTop + yBot) / 2 + r * 0.15;
      const cp = [[sx, s0], [sx + sd * r * 1.5, s0 - r * 0.9], [ex + sd * r * 1.4, ey - r * 0.3], [ex, ey]];
      tube(c, () => { c.beginPath(); c.moveTo(...cp[0]); c.bezierCurveTo(...cp[1], ...cp[2], ...cp[3]); }, 2 + 3 * o.fb, rgba(col, 0.85), now, o.fb * heat);
      tubes.push({ i, pts: sample([cp]) });
    }
    const out = p.x <= G.W / 2 ? -1 : 1, lx = clamp(p.x + out * (hw + 16), 16, G.W - 16), ly = Math.max(yTop + 8, p.y + r * 0.2);   // стихия — снаружи, у тела колбы
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
  function modSegs(G, s, d) {                       // трубка от горлышка s к горлышку d: выгиб к середине, мимо своих колб
    const a = flaskGeo(G, s), b = flaskGeo(G, d), ax = a.p.x, ay = a.neckTop, bx = b.p.x, by = b.neckTop;
    const side = ax <= G.W / 2 ? 1 : -1, o = G.r * 1.7;
    return [[[ax, ay - 2], [ax + side * o * 0.4, ay - 40], [ax + side * o, ay - 10], [ax + side * o, (ay + by) / 2]],
      [[ax + side * o, (ay + by) / 2], [ax + side * o, by - 24], [bx, by - 22], [bx, by - 4]]];
  }
  function drawTubes(c, G, now) {
    for (const [s, d] of mods) {
      const segs = modSegs(G, s, d);
      tube(c, () => { c.beginPath(); c.moveTo(...segs[0][0]); for (const sg of segs) c.bezierCurveTo(...sg[1], ...sg[2], ...sg[3]); }, 3, rgba(mixed(s), 0.95), now, broken[s] ? 0 : heat * Math.log2(OPS[s].f / 20) / 2.5, true);   // капли — скорость по частоте модулятора
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
  const furnBox = (G) => ({ x0: G.W / 2 - 74, x1: G.W / 2 + 74, y0: G.furn.y0, y1: G.furn.y1 });   // атанор шире: на его лице — уроборосы solve и coagula
  function drawFurnace(c, G, now) {
    const { x0, x1, y0, y1 } = furnBox(G);
    c.fillStyle = T.BG; c.fillRect(x0, y0, x1 - x0, y1 - y0);
    c.strokeStyle = T.ink(0.85); c.lineWidth = 1.2; c.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0);
    c.beginPath(); c.moveTo(x0 - 6, y0); c.lineTo(x1 + 6, y0); c.moveTo(x0 - 6, y1); c.lineTo(x1 + 6, y1); c.stroke();
    c.strokeStyle = T.ink(0.22); c.lineWidth = 0.8; c.beginPath();
    for (let y = y0 + 9, row = 0; y < y1; y += 9, row++) { c.moveTo(x0, y); c.lineTo(x1, y); for (let x = x0 + (row % 2 ? 9 : 0); x < x1; x += 18) { c.moveTo(x, y - 9); c.lineTo(x, y); } }
    c.stroke();
    const ax = G.W / 2, ay = y1, aw = 28, ah = Math.min(52, (y1 - y0) * 0.78);
    c.fillStyle = T.BG; c.beginPath(); c.moveTo(ax - aw, ay); c.lineTo(ax - aw, ay - ah + aw); c.arc(ax, ay - ah + aw, aw, Math.PI, 0); c.lineTo(ax + aw, ay); c.closePath(); c.fill();
    c.strokeStyle = T.ink(0.85); c.lineWidth = 1.2; c.stroke();
    drawLamp(c, ax, ay, Math.min(aw * 0.75, ah * 0.32), now);
  }
  // лампа Гермеса в арке атанора: стеклянный резервуар со спиртом, фитиль; тап — загорается. Пламя — жар (athanor)
  const lampBox = (G) => { const b = furnBox(G); return { x: G.W / 2, y: b.y1, w: 34, h: Math.min(52, (b.y1 - b.y0) * 0.78) }; };
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
  // сажа над лампой: копится, пока горит, кувшин её не смывает — история сессии
  function drawSoot(c, G) {
    if (soot < 0.01) return;
    const b = furnBox(G), x = G.W / 2, y0 = b.y0 - 2, H = 90 + 120 * soot;
    c.strokeStyle = T.ink(0.07 + 0.22 * soot); c.lineWidth = 0.8; c.beginPath();
    for (let k = -8; k <= 8; k++) {
      const xx = x + k * 4.5, hh = H * (1 - Math.abs(k) / 9) * (0.8 + 0.2 * Math.sin(k * 7.3));
      c.moveTo(xx, y0); c.quadraticCurveTo(xx + k * 0.8, y0 - hh * 0.6, xx + k * 1.6, y0 - hh);
    }
    c.stroke();
  }
  // кот у печи: спит клубком; на athanor в максимуме при огне — отходит от жара; на шипение кувшина поднимает голову
  let catX = null, catLeave = 0, catPokes = [];   // достали — уходит и не вернётся до перезагрузки
  function meow(grump) {                            // мяу: пила сквозь полосу, высота вверх-вниз; уходя — ворчит ниже
    if (!actx || !bus) return;
    const ctx = actx, t = ctx.currentTime, o = ctx.createOscillator(), bp = ctx.createBiquadFilter(), g = ctx.createGain(), d = grump ? 0.7 : 0.45;
    o.type = 'sawtooth';
    if (grump) { o.frequency.setValueAtTime(260, t); o.frequency.linearRampToValueAtTime(200, t + d); }
    else { o.frequency.setValueAtTime(520, t); o.frequency.linearRampToValueAtTime(820, t + d * 0.35); o.frequency.exponentialRampToValueAtTime(480, t + d); }
    bp.type = 'bandpass'; bp.frequency.value = grump ? 700 : 1500; bp.Q.value = 3;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + d); g.gain.linearRampToValueAtTime(0, t + d + 0.01);
    o.connect(bp).connect(g).connect(bus.out); o.start(t); o.stop(t + d + 0.03);
    o.onended = () => { o.disconnect(); bp.disconnect(); g.disconnect(); };
    lastSound = performance.now(); setLive(true);
  }
  function pokeCat(now) {
    catPokes = catPokes.filter((t) => now - t < 8000); catPokes.push(now);
    if (catPokes.length >= 5) { catLeave = now; meow(true); return; }
    catUp = now; meow(false);
  }
  const catHit = (G, x, y) => catX != null && !catLeave && Math.abs(x - catX) < 26 && y > furnBox(G).y1 - 30 && y < furnBox(G).y1 + 6;
  function drawCat(c, G, now, dt) {
    const b = furnBox(G), hot = fire && fx.athanor > 0.85, home = b.x0 - 34, away = Math.max(28, b.x0 - 96);
    if (catX == null) catX = home;
    if (catLeave) {                                  // достали — уходит за край, насовсем (до перезагрузки)
      if (catX < -60) return;
      catX -= dt * 60;
    } else catX += ((hot ? away : home) - catX) * (1 - Math.exp(-dt / 0.9));
    const x = catX, y = b.y1, s = 13, target = catLeave ? -999 : hot ? away : home, walking = !!catLeave || Math.abs(target - catX) > 2, up = now - catUp < 2200;
    c.save(); c.translate(x, y); c.fillStyle = T.BG; c.strokeStyle = T.ink(0.8); c.lineWidth = 1; c.lineCap = 'round'; c.lineJoin = 'round';
    if (walking) {                                   // идёт: профиль, ноги переступают, хвост трубой
      const dir = target < catX ? -1 : 1, ph = now * 0.012;
      c.scale(dir, 1);
      for (const [lx, o] of [[0.75, 0], [0.55, Math.PI], [-0.55, Math.PI], [-0.75, 0]]) {   // ноги: дальние бледнее
        const sw = Math.sin(ph + o) * 0.25;
        c.strokeStyle = T.ink(o ? 0.5 : 0.8); c.beginPath(); c.moveTo(lx * s, -0.7 * s); c.quadraticCurveTo((lx + sw * 0.5) * s, -0.35 * s, (lx + sw) * s, 0); c.stroke();
      }
      c.strokeStyle = T.ink(0.8);
      c.beginPath(); c.moveTo(-0.95 * s, -0.75 * s); c.bezierCurveTo(-0.7 * s, -1.25 * s, 0.6 * s, -1.2 * s, 0.95 * s, -0.95 * s);   // спина
      c.bezierCurveTo(1.15 * s, -0.75 * s, 1.0 * s, -0.5 * s, 0.75 * s, -0.55 * s); c.bezierCurveTo(0.2 * s, -0.45 * s, -0.4 * s, -0.45 * s, -0.8 * s, -0.55 * s); c.closePath(); c.fill(); c.stroke();
      c.lineWidth = s * 0.22; c.beginPath(); c.moveTo(-0.95 * s, -0.85 * s); c.bezierCurveTo(-1.5 * s, -1.0 * s, -1.4 * s, -1.9 * s, -1.75 * s, -2.0 * s); c.stroke();   // хвост трубой
      c.strokeStyle = T.BG; c.lineWidth = s * 0.22 - 2; c.stroke(); c.lineWidth = 1; c.strokeStyle = T.ink(0.8);
      catHead(c, 1.15 * s, -1.25 * s, s, true, 1);
    } else {                                          // спит клубком (или поднял голову): спина дугой, хвост обёрнут вокруг
      c.beginPath(); c.moveTo(-1.0 * s, 0); c.bezierCurveTo(-1.35 * s, -0.75 * s, -0.55 * s, -1.2 * s, 0.25 * s, -1.08 * s);
      c.bezierCurveTo(1.05 * s, -0.98 * s, 1.5 * s, -0.45 * s, 1.3 * s, 0); c.closePath(); c.fill(); c.stroke();
      c.strokeStyle = T.ink(0.35); c.beginPath();                                       // шерсть — короткие штрихи по спине
      for (let k = 0; k < 6; k++) { const t = 0.15 + k * 0.13, ax = (-0.9 + t * 2.1) * s, ay = -(0.95 - 1.6 * (t - 0.55) ** 2) * s; c.moveTo(ax, ay + 2); c.quadraticCurveTo(ax + 2, ay + 4, ax + 1, ay + 7); }
      c.stroke(); c.strokeStyle = T.ink(0.8);
      c.lineWidth = s * 0.26; c.beginPath(); c.moveTo(1.2 * s, -0.12 * s); c.bezierCurveTo(1.5 * s, 0.25 * s, 0.2 * s, 0.22 * s, -0.75 * s, 0.05 * s); c.stroke();   // хвост вокруг лап
      c.strokeStyle = T.BG; c.lineWidth = s * 0.26 - 2; c.stroke(); c.lineWidth = 1; c.strokeStyle = T.ink(0.8);
      c.beginPath(); c.ellipse(-1.25 * s, -0.04 * s, 0.28 * s, 0.1 * s, 0, 0, TAU); c.fill(); c.stroke();   // лапы
      const hx = up ? -0.95 * s : -1.1 * s, hy = up ? -1.25 * s : -0.42 * s;
      if (up) { c.beginPath(); c.moveTo(-0.7 * s, -0.95 * s); c.quadraticCurveTo(-0.95 * s, -1.0 * s, hx + 0.1 * s, hy + 0.3 * s); c.stroke(); }   // шея
      catHead(c, hx, hy, s, up, -1);
      if (!up) { c.strokeStyle = T.ink(0.35); const zt = (now / 2600) % 1; c.beginPath(); c.arc(hx - 0.1 * s, hy - 0.7 * s - zt * 14, 1.5 + zt * 2, Math.PI, TAU); c.stroke(); }   // сопит
    }
    c.restore();
  }
  // голова кота: круглая, уши — изогнутые треугольники, глаза — прищур или открытые, нос и усы; face: −1 — мордой влево
  function catHead(c, hx, hy, s, open, face) {
    const r = 0.46 * s;
    c.strokeStyle = T.ink(0.8); c.fillStyle = T.BG;
    for (const e of [-1, 1]) {                        // уши: под головой, видна верхняя часть
      const bx = hx + e * 0.26 * s, by = hy - 0.25 * s;
      c.beginPath(); c.moveTo(bx - 0.17 * s, by + 0.05 * s); c.quadraticCurveTo(bx - 0.06 * s + e * 0.04 * s, by - 0.42 * s, bx + e * 0.06 * s, by - 0.5 * s);
      c.quadraticCurveTo(bx + 0.12 * s, by - 0.25 * s, bx + 0.19 * s, by + 0.02 * s); c.closePath(); c.fill(); c.stroke();
    }
    c.beginPath(); c.ellipse(hx, hy, r * 1.08, r, 0, 0, TAU); c.fill(); c.stroke();
    const ex = hx + face * 0.1 * s;
    if (open) {
      for (const e of [-1, 1]) { c.beginPath(); c.ellipse(ex + e * 0.17 * s, hy - 0.05 * s, 0.09 * s, 0.06 * s, 0, 0, TAU); c.stroke(); T.dot(ex + e * 0.17 * s, hy - 0.05 * s, 0.9, 0.9); }
    } else {
      c.beginPath(); for (const e of [-1, 1]) { c.moveTo(ex + e * 0.17 * s - 0.08 * s, hy - 0.03 * s); c.quadraticCurveTo(ex + e * 0.17 * s, hy + 0.04 * s, ex + e * 0.17 * s + 0.08 * s, hy - 0.03 * s); } c.stroke();
    }
    c.beginPath(); c.moveTo(ex - 0.05 * s, hy + 0.12 * s); c.lineTo(ex + 0.05 * s, hy + 0.12 * s); c.lineTo(ex, hy + 0.18 * s); c.closePath(); c.stroke();   // нос
    c.strokeStyle = T.ink(0.4); c.beginPath();
    for (const e of [-1, 1]) for (const d of [-0.04, 0.05]) { c.moveTo(ex + e * 0.12 * s, hy + 0.17 * s); c.lineTo(ex + e * 0.55 * s, hy + (0.12 + d) * s); }
    c.stroke(); c.strokeStyle = T.ink(0.8);
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
    pourAt = performance.now(); catUp = pourAt + 450;
    setTimeout(() => {
      hiss();
      for (const [k, gr] of [...voices]) if (k !== 'fire') { kill(gr, 0.4); voices.delete(k); }
      setFire(false);
    }, 450);
  }

  // ---------- две крутилки-уробороса у печи: слева solve, справа coagula ----------
  // тело змеи растёт по кругу со значением; на максимуме голова кусает хвост
  const KNOBS = ['solve', 'coagula'];
  const knobAt = (G, k) => { const b = furnBox(G); return { x: G.W / 2 + (k === 'solve' ? -48 : 48), y: b.y0 + Math.min(30, (b.y1 - b.y0) * 0.36), R: 15 }; };   // на лице атанора, по бокам арки
  function drawKnob(c, G, k, now, held) {
    const { x, y, R } = knobAt(G, k), v = fx[k], a0 = -Math.PI / 2 + 0.32, sweep = 0.5 + v * (TAU - 0.5 - 0.42), a1 = a0 + sweep;
    const bite = v > 0.985, al = held ? 1 : 0.55 + 0.35 * v;
    c.strokeStyle = T.ink(0.12); c.lineWidth = 1; c.setLineDash([1.5, 4]);   // куда ещё может дорасти
    c.beginPath(); c.arc(x, y, R, 0, TAU); c.stroke(); c.setLineDash([]);
    c.strokeStyle = T.ink(al); c.lineWidth = 1.1;
    c.beginPath(); c.arc(x, y, R + 4, a0 + 0.12, a1); c.stroke();
    c.beginPath(); c.arc(x, y, R - 4, a0 + 0.12, a1); c.stroke();
    c.beginPath(); c.moveTo(x + Math.cos(a0) * R, y + Math.sin(a0) * R);          // хвост — остриём
    c.lineTo(x + Math.cos(a0 + 0.12) * (R + 4), y + Math.sin(a0 + 0.12) * (R + 4)); c.moveTo(x + Math.cos(a0) * R, y + Math.sin(a0) * R);
    c.lineTo(x + Math.cos(a0 + 0.12) * (R - 4), y + Math.sin(a0 + 0.12) * (R - 4)); c.stroke();
    c.strokeStyle = T.ink(al * 0.6); c.lineWidth = 0.8; c.beginPath();           // чешуя
    for (let a = a0 + 0.22; a < a1 - 0.05; a += 0.17) { c.moveTo(x + Math.cos(a) * (R - 3), y + Math.sin(a) * (R - 3)); c.lineTo(x + Math.cos(a + 0.08) * (R + 3), y + Math.sin(a + 0.08) * (R + 3)); }
    c.stroke();
    const hx = x + Math.cos(a1 + 0.12) * R, hy = y + Math.sin(a1 + 0.12) * R, dir = a1 + Math.PI / 2;   // голова по касательной
    c.save(); c.translate(hx, hy); c.rotate(dir);
    c.fillStyle = T.BG; c.strokeStyle = T.ink(al); c.lineWidth = 1.1;
    c.beginPath(); c.ellipse(2, 0, 8, 5.5, 0, 0, TAU); c.fill(); c.stroke();
    const jaw = bite ? 0.05 : 0.45;                                               // пасть: открыта — тянется к хвосту, закрыта — кусает
    c.beginPath(); c.moveTo(9, 0); c.lineTo(14, -6 * jaw); c.moveTo(9, 0); c.lineTo(14, 6 * jaw); c.stroke();
    c.beginPath(); c.arc(3, -2.2, 1.1, 0, TAU); c.fillStyle = T.ink(al); c.fill();
    c.restore();
    if (held) T.mapText(`${k} · ${fxw.text(k)}`, x, y - R - 20, 13, 0.9, 'center');
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
      const pcs = T.scalePCs, inScale = pcs && pcs.includes(((jars[i] % 12) + 12) % 12);   // нота банки в ладу — знак металла светится
      if (inScale) T.glowAt(X, y - h / 2 + 4, 16, 0.14);
      planet(c, METALS[i], X, y - h / 2 + 4, 7, inScale ? Math.max(a, 0.95) : a);
      if (on) T.glowAt(X, y - h / 2, 26, 0.18);
      if (v && v.latched) T.dot(X, y + 11, 1.8, 0.8);   // оставлена звучать
    }
  }

  // солнце — четверть из правого верхнего угла (угол к центру карты); белым по чёрному
  let noSun = false;                                // снимок для карты — без солнца: на карте солнце одно, в центре
  function drawSun(c, G, now) { if (!noSun) T.quarterSun(c, G.sun.x, G.sun.y, G.sun.r, -1, now); }

  // ---------- стена: бледные алхимические рисунки, одна картинка на размер экрана ----------
  // квадратура круга (круг — треугольник — круг — квадрат — круг, как в Atalanta Fugiens), девиз, уроборос, знаки веществ
  let wallC = null, wallKey = '';
  const emblem = (G) => ({ cx: G.W * 0.62, cy: G.top + 0.36 * G.h, R: Math.min(G.W * 0.34, G.h * 0.2) });
  // девиз по дуге под кругом — живой: разгорается с coagula, буквы дрожат, когда solve длинный (крошево)
  function drawMotto(c, G, now) {
    const { cx, cy, R } = emblem(G), motto = 'SOLVE  ET  COAGVLA', span = 1.1, a0 = 0.16 + 0.6 * fx.coagula, jit = fx.coagula > 0.02 ? fx.solve * fx.solve * 2.5 : 0;
    c.font = `italic 13px ${T.MAP}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    [...motto].forEach((ch, i) => {
      const a = Math.PI / 2 + span / 2 - (i / (motto.length - 1)) * span, j = jit * Math.sin(now * 0.013 * (1 + (i % 3)) + i * 1.7);
      c.fillStyle = T.ink(a0 * (0.85 + 0.15 * Math.sin(now * 0.002 + i)));
      c.save(); c.translate(cx + Math.cos(a) * (R + 20 + j), cy + Math.sin(a) * (R + 20 + j)); c.rotate(a - Math.PI / 2); c.fillText(ch, 0, 0); c.restore();
    });
  }
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
    const { cx, cy, R } = emblem(G);
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
    if (best) best.dist = bd;
    return best;
  }
  function down(f) {
    const G = geo();
    if (catHit(G, f.x, f.y)) { touches.set(f.id, { kind: 'cat' }); return; }
    for (const k of KNOBS) { const q = knobAt(G, k); if (Math.hypot(f.x - q.x, f.y - q.y) < q.R + 14) { touches.set(f.id, { kind: 'knob', k, v0: fx[k] }); return; } }
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
    if (h) { const o = OPS[h.i]; touches.set(f.id, { kind: 'flask', i: h.i, f0: o.f, l0: o.level, axis: null }); focusI = h.i; focusUntil = performance.now() + 1500; return; }
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
    if (t.kind !== 'flask') return;
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
    if (t.kind === 'flask' && !t.axis && performance.now() - f.t0 < 300) {   // двойной тап по колбе — разбить / починить
      const now = performance.now();
      if (lastFlaskTap && lastFlaskTap.i === t.i && now - lastFlaskTap.t < T.DTAP_MS) { broken[t.i] = !broken[t.i]; lastFlaskTap = null; if (broken[t.i]) crack(); setParams(); }
      else lastFlaskTap = { i: t.i, t: now };
      return;
    }
    if (t.kind === 'cat') { pokeCat(performance.now()); return; }
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
      ease(G, dt);
      heat += ((fire ? 1 : 0) - heat) * (1 - Math.exp(-dt / (fire ? 0.35 : 0.6)));
      for (let i = 0; i < 4; i++) drain[i] = clamp(drain[i] + (broken[i] ? dt / 1.6 : -dt / 0.5));   // вытекает за 1.6 с, чинится за 0.5
      soot = Math.min(1, soot + (dt * heat) / 240);   // за 4 минуты огня — густая
      tubes.length = 0;
      c.drawImage(wall(G), 0, 0, T.W, T.H);
      drawMotto(c, G, now);
      drawSun(c, G, now);
      drawScroll(c, G, now);
      drawSoot(c, G);
      drawFurnace(c, G, now);
      drawJug(c, G, now);
      drawCat(c, G, now, dt);
      const heldK = new Set([...touches.values()].filter((t) => t.kind === 'knob').map((t) => t.k));
      for (const k of KNOBS) drawKnob(c, G, k, now, heldK.has(k));
      drawRack(c, G);
      drawTubes(c, G, now);
      const held = new Set([...touches.values()].filter((t) => t.kind === 'flask').map((t) => t.i));
      for (let i = 0; i < OPS.length; i++) drawFlask(c, i, G, now, held.has(i));
      drawSteam(c, G, now);
      drawEgg(c, G, now);
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
    get broken() { return broken.slice(); }, get soot() { return soot; }, get catX() { return catX; }, poke: () => pokeCat(performance.now()), get catGone() { return !!catLeave; }, get catUp() { return catUp; }, lamp: () => { const b = lampBox(geo()); return { x: b.x, y: b.y - b.h / 2 }; },
    get voices() { return [...voices].map(([k, v]) => ({ k, on: v.on, latched: v.latched })); },
    jar: (i) => { const b = jarBox(geo(), i); return { x: b.X, y: b.y - b.h / 2 }; },
    at: (i) => { const q = flaskGeo(geo(), i); return { x: q.p.x, y: (q.yTop + q.yBot) / 2, neckY: q.neckTop + 4 }; },
    knob: (k) => { const q = knobAt(geo(), k); return { x: q.x, y: q.y }; },
    jug: () => { const b = jugBox(geo()); return { x: b.x, y: b.y - b.h / 2 }; },
    furnace: () => { const b = lampBox(geo()); return { x: b.x, y: b.y - b.h / 2 }; },
    tubeAt: (s, d) => { const t = tubes.find((q) => q.s === s && q.d === d), G = geo(); if (!t) return null; const p = t.pts.find((q, k) => k > 3 && !hitFlask(G, q[0], q[1])) || t.pts[8]; return { x: p[0], y: p[1] }; },   // точка трубки не над колбой
  };
})();
