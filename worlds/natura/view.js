// Natura — картинка и касания: река на карте Таро (пейзаж и гравюры — scene.js) и живое на ней — кувшинки с кругами, лист-лодочка,
// утки и утята, кораблик, лягушка, рыба, стрекозы, птицы; плашка кувшинки, меню волн, FX-веер. Касание → действие модели (звук не трогает);
// от engine — метры (phase — бегунок, has, skiff) и что услышано (heard): нота ударит — утки; кувшинка шага — лягушка и стрекозы.
// Сцена портретная: на широком экране (iPad, компьютер) — по центру шириной не больше 0.62 высоты, по бокам бумага; касания сдвигаются (sh).
import { WAVES, GONE_S, attOf, relOf } from './model.js';
import { createScene, clamp, TAU, INK, PAPER, ink, pap } from './scene.js';

export function createView(T, model, engine) {
  const st = model.state, { fx, seq, pads } = st, val = model.val;
  const shown = (k) => fx[k];                        // пейзаж — общие настройки
  const scene = createScene(T, st);
  const { stage, sh, geo, river, across, onRiver, T0, TS, padXY, layers, flower, sunAt, drawFog, drawBridge, LILY, lily, boatShape,
    pondAt, ducksAt, duck, drawPond, flyer, ducklings, skiffHome, pierXY, drawPier, bridgeT, drawRainRings, drawReeds, drawTree, drawCloud, cloudAt, drawStone } = scene;

  // утки улетели (в них кинули кораблик) — полёт; огибающую открывает модель (scare, envOpen), пока не вернутся
  let ducksGone = null;                              // { t0 } — время спугивания
  const GONE = { away: 700, back: 3000, land: GONE_S * 1000 };   // улетают 0.7 с, вдали до 3 с, за секунду возвращаются
  const scare = (now) => { ducksGone = { t0: now }; model.scare(); };
  const envAt = (ms, pd) => { const a = model.attSec(pd) * 1000; return ms < a ? ms / a : Math.exp(-(ms - a) / (model.relSec(pd) * 1000 / 2.5)); };
  let birdsAt = -1e9;                                // когда спугнули птиц
  // что услышано (engine): нота прозвучит в at — утки; кувшинка шага — лягушка и стрекозы
  let noteAt = -1e9, notePd = null;
  const playedAt = Array(16).fill(0);               // когда кувшинка звучала в последний раз (для лягушки и стрекоз)
  function heard(e) {
    if (e.note) { noteAt = e.at; notePd = e.note; }
    if (e.played != null) playedAt[e.played] = e.at;
  }
  let noSun = false;                                // снимок для карты — без солнца: на карте солнце одно, в центре
  // смена дня по темпу: медленно — солнце клонится к горам (за ними и садится), быстро — в зените
  function drawSun(c, G, now) { if (!noSun) { const S = sunAt(G); T.quarterSun(c, S.x, S.y, S.r, 1, now, INK, pap(1), Math.min(S.y, G.sun.y)); } }   // садится — виден весь диск над краем рамки
  function drawPads(c, G, now) {
    const stepMs = model.stepSec() * 1000, ph = engine.phase(), playing = ph != null, pos = playing ? ph : 0, cur = playing ? Math.floor(pos) % pads.len : -1;
    const echoes = 1 + Math.round(fx.delay * 3), gap = model.delaySec() * 1000;
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
      const open = on ? envAt((pos % 1) * stepMs, pd) : 0, held = [...touches.values()].some((t) => t.kind === 'pad' && t.i === i);
      lily(c, p, pd.wave, open, i < pads.len ? (held ? 1 : 0.95) : 0.3, pd.lock && Object.keys(pd.lock).length, pd.chance ?? 1);   // за запрудаом — бледные, не играют
    }
    if (pads.len >= 16) drawBridge(c, G);
    // лист-лодочка плывёт по течению: между местами — плавно
    const { x: bx, y: by, s } = boatXY(G, now);
    boatShape(c, bx, by, s, -0.15, !playing);
  }
  let splash = null;
  function drawDucks(c, G, now) {
    drawPond(c, G, now);
    if (splash) {                                     // плюх: брызги и круги
      const k = (now - splash.t0) / 900;
      if (k > 1) splash = null;
      else {
        c.strokeStyle = ink(0.6 * (1 - k)); c.lineWidth = 1;
        for (const q of [0, 0.3]) { const kk = k - q; if (kk > 0) { c.beginPath(); c.ellipse(splash.x, splash.y + 2, 8 + 30 * kk, (8 + 30 * kk) * 0.3, 0, 0, TAU); c.stroke(); } }
        c.beginPath();
        for (let i = 0; i < 6; i++) { const an = Math.PI * (1.15 + i * 0.14), r = 6 + 16 * k; c.moveTo(splash.x + Math.cos(an) * r, splash.y + Math.sin(an) * r * 1.4 - 10 * Math.sin(Math.PI * k)); c.lineTo(splash.x + Math.cos(an) * (r + 3), splash.y + Math.sin(an) * (r + 3) * 1.4 - 10 * Math.sin(Math.PI * k)); }
        c.stroke();
      }
    }
    if (ducksGone) {                                  // утки улетели: туда — за горы, вдали, обратно — садятся
      const D = ducksAt(G), e = now - ducksGone.t0;
      if (e >= GONE.land) ducksGone = null;
      else {
        const far = { x: G.W * 0.2, y: G.hor - G.h * 0.12 };
        let k = e < GONE.away ? e / GONE.away : e < GONE.back ? 1 : 1 - (e - GONE.back) / (GONE.land - GONE.back);
        k = k * k * (3 - 2 * k);
        if (k < 0.995) for (const [d, side] of [[D.A, 0], [D.R, 1]]) {
          const x = d.x + (far.x + side * 22 - d.x) * k, y = d.y - 10 + (far.y + side * 8 - (d.y - 10)) * k - Math.sin(Math.PI * k) * 30;
          const back = e > GONE.back, dir = (far.x - d.x) * (back ? -1 : 1) > 0 ? 1 : -1;
          flyer(c, x, y, d.s * 1.1 * (1 - 0.6 * k), dir, Math.sin(now * 0.018 + side * 1.3));
        }
        for (const d of ducklings(G, now, D)) duck(c, d, 0);   // утята не летают — ждут в заводи
        return;
      }
    }
    const D = ducksAt(G), ms = now - noteAt, a = model.attSec(notePd) * 1000, r = model.relSec(notePd) * 1000;
    const dur = Math.max(a, 140), nod = noteAt > -1e8 && ms > 0 && ms < dur ? Math.sin((Math.PI * ms) / dur) : 0;
    if (noteAt > -1e8 && ms > a && ms < a + r * 2) {     // круги от правой утки: расходятся за release
      const k = (ms - a) / (r * 2), e = envAt(ms, notePd);
      for (const q of [0, 0.35]) {
        const kk = k - q;
        if (kk <= 0) continue;
        const R = D.R.s * (1.3 + kk * 2.2);
        c.strokeStyle = ink(0.55 * e * (1 - kk)); c.lineWidth = 1; c.beginPath(); c.ellipse(D.R.x, D.R.y + 1, R, R * 0.3, 0, 0, TAU); c.stroke();
      }
    }
    if (nod > 0.05) { c.strokeStyle = ink(0.5 * nod); c.lineWidth = 1; c.beginPath(); c.ellipse(D.A.x + D.A.s * 0.9, D.A.y + 1, D.A.s * 0.5 * (1 + nod), D.A.s * 0.14, 0, 0, TAU); c.stroke(); }   // где голова под водой — кружок
    const P = pondAt(G), kids = ducklings(G, now, D);
    c.save(); c.beginPath(); c.ellipse(P.x, P.y, P.rx - 1, P.ry - 1, 0, 0, TAU); c.clip();   // отражения в заводи: бледные, перевёрнутые; с reverb — размытее
    const blur = fx.reverb > 0.35 ? [-1.5, 1.5] : [0];
    c.globalAlpha = 0.16 / blur.length;
    for (const ox of blur) for (const d of [{ ...D.A, n: nod }, { ...D.R, n: 0 }, ...kids]) {
      c.save(); c.translate(ox + Math.sin(now * 0.002 + d.x) * fx.reverb * 1.5, 2 * d.y + 4); c.scale(1, -1); duck(c, { ...d, y: d.y }, d.n || 0); c.restore();
    }
    c.globalAlpha = 1; c.restore();
    duck(c, D.A, nod); duck(c, D.R, 0);
    for (const d of kids) duck(c, d, 0);              // утята ближе к нам — поверх
  }
  const skiff = { x: 0, y: 0, held: false, home: true, voice: null, trail: [], back: null };
  function drawSkiff(c, G, now) {
    const home = skiffHome(G);
    if (skiff.home) { skiff.x = home.x; skiff.y = home.y; }
    else if (!skiff.held && skiff.fly) {              // брошен в заводь — летит дугой, плюх, утки взлетают
      const F = skiff.fly, k = clamp((now - F.t0) / F.ms);
      skiff.x = F.x0 + (F.x1 - F.x0) * k; skiff.y = F.y0 + (F.y1 - F.y0) * k - Math.sin(Math.PI * k) * 40;
      if (k >= 1) { skiff.fly = null; splash = { x: F.x1, y: F.y1, t0: now }; scare(now); skiff.back = { x: F.x1, y: F.y1, t0: now + 600 }; }
    }
    else if (!skiff.held && skiff.back && now >= skiff.back.t0) {             // отпустили — сам плывёт к берегу
      const k = clamp((now - skiff.back.t0) / 1200), e = 1 - (1 - k) ** 3;
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
    const onWater = skiff.held && engine.skiff;
    boatShape(c, skiff.x, skiff.y - (onWater ? 2 : 0), 1.25, skiff.home ? -0.35 : Math.sin(now * 0.004) * 0.08, false);
    if (onWater && skiff.label) T.mapText(skiff.label, skiff.x, skiff.y - 30, 15, 0.95, 'center');
  }
  function boatXY(G, now) {                         // лист-лодочка: плывёт по течению между местами; стоит — у причала
    const ph = engine.phase();
    if (ph == null) { const q = pierXY(G); return { x: q.x + 16, y: q.y + 3, s: 0.8 }; }
    const t = T0 + ((ph % pads.len) / 16) * TS, p = across(river(G, t), Math.sin(now * 0.0015) * 0.06);
    return { x: p.x, y: p.y - 2, s: 0.75 + 1.0 * t };
  }
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
  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const noteName = (f) => { const m = Math.round(33 + 12 * Math.log2(f / 55)); return `${NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`; };
  // ---------- касания: кувшинки, запруда, лодочка ----------
  const touches = new Map();
  const slotOf = (o) => clamp(Math.round(((o.t - T0) / TS) * 16 - 0.5), 0, 15);
  const noteOf = (o) => clamp(Math.round((o.q / 0.78 + 0.5) * 14), 0, 14);
  const inRiver = (G, x, y) => { const o = onRiver(G, x, y); return o && o.t > 0.1 && o.t < 0.995 && Math.abs(o.q) < 0.5 + 6 / river(G, o.t).w; };
  const lockOf = (k) => ({ lock: -1, v0: fx[k] });   // пейзаж — общие настройки (свои у кувшинки — в её кольце)
  const setP = (t, k, v) => model.setScene(k, v);
  // ближайшая кувшинка под пальцем (листья крупные и могут касаться соседей)
  function padAt(G, x, y, extra = 12) {
    let best = -1, bd = 1e9;
    for (let i = 0; i < 16; i++) {
      const pd = pads.at[i];
      if (!pd) continue;
      const p = padXY(G, i, pd.note), d = Math.hypot(x - p.x, (y - p.y) * 1.4);
      if (d < LILY * p.s + extra && d < bd) { bd = d; best = i; }
    }
    return best;
  }
  function down(f) {
    const G = geo(), now = performance.now(), pq = pierXY(G);
    if (menu && !menu.held) {                         // открытое меню волн: тап по цветку — выбрать, мимо — закрыть
      const k = menuHit(G, f.x, f.y);
      if (k >= 0) pickWave(k);
      menu = null; touches.set(f.id, { kind: 'none' }); return;
    }
    if (Math.hypot(f.x - skiff.x, f.y - skiff.y + 4) < 26) {   // запасной кораблик — взять
      skiff.held = true; skiff.home = false; skiff.back = null; skiff.dx = skiff.x - f.x; skiff.dy = skiff.y - f.y;
      touches.set(f.id, { kind: 'skiff', t0: now }); return;
    }
    const br = river(G, bridgeT()), bdx = f.x - br.x, bdy = f.y - br.y, al = bdx * br.tx + bdy * br.ty, ac = bdx * br.nx + bdy * br.ny;
    if (Math.abs(al) < 24 && Math.abs(ac) < br.w / 2 + 22) { touches.set(f.id, { kind: 'bridge' }); return; }
    const D = ducksAt(G);
    if (!ducksGone) for (const [kind, key] of [['duckA', 'att'], ['duckR', 'rel']]) {
      const d = D[kind === 'duckA' ? 'A' : 'R'];
      if (Math.hypot(f.x - d.x, f.y - (d.y - d.s * 0.35)) < Math.max(28, d.s * 1.6)) { touches.set(f.id, { kind, key, ...lockOf(key) }); return; }
    }
    if (frog.at && frog.i >= 0 && pads.at[frog.i] && Math.hypot(f.x - frog.at.x, f.y - frog.at.y) < 16) { touches.set(f.id, { kind: 'pad', i: frog.i, t0: now, fx: f.x, fy: f.y, frog: true }); return; }   // лягушка: тап — квакает; потянул или держишь — это её кувшинка
    const pi = padAt(G, f.x, f.y);                    // кувшинки — раньше лодочки: та плывёт мимо и не должна перехватывать
    if (pi >= 0) { touches.set(f.id, { kind: 'pad', i: pi, t0: now, fx: f.x, fy: f.y }); return; }

    if (Math.hypot(f.x - pq.x - 4, f.y - pq.y) < 30) { touches.set(f.id, { kind: 'boat', bpm0: seq.bpm }); return; }   // причал — после кувшинок
    if (inRiver(G, f.x, f.y)) { touches.set(f.id, { kind: 'plant', path: [[f.x, f.y]] }); return; }
    const cl = cloudAt(G);
    if (Math.abs(f.x - cl.cx) < 34 * cl.s && f.y > cl.cy - 22 * cl.s && f.y < cl.cy + 12 * cl.s) { touches.set(f.id, { kind: 'cloud', ...lockOf('cutoff') }); return; }
    const tr = G.tree, R = Math.min(G.W * 0.16, G.h * 0.09), cy = tr.y - G.h * 0.13 - R * 0.6;
    if (Math.hypot(f.x - tr.x, f.y - cy) < R * 1.3 || (Math.abs(f.x - tr.x) < 14 && f.y > cy && f.y < tr.y + 6)) { touches.set(f.id, { kind: 'tree', lx: f.x, ly: f.y }); return; }
    if (birdList(G, now).some((b) => Math.hypot(f.x - b.X, f.y - b.Y) < 22)) { touches.set(f.id, { kind: 'birds' }); return; }
    if (f.y > G.hor - 0.24 * G.h && f.y < G.hor + 4) { touches.set(f.id, { kind: 'mountains', ...lockOf('res') }); return; }
    touches.set(f.id, { kind: 'none' });
  }
  function move(f) {
    const t = touches.get(f.id);
    if (!t) return;
    const G = geo(), dx = f.x - f.x0, dy = f.y - f.y0;
    t.x = f.x; t.y = f.y;
    if (menu && menu.tid === t) { menu.hover = menuHit(G, f.x, f.y); return; }   // меню волн: тот же палец ведёт по цветкам
    if (!t.moved && Math.hypot(dx, dy) > 8) t.moved = true;
    if (t.kind === 'skiff') {                         // ведёшь кораблик: на воде — звучит
      skiff.x = f.x + skiff.dx; skiff.y = f.y + skiff.dy;
      (t.hist = t.hist || []).push({ x: skiff.x, y: skiff.y, t: performance.now() }); if (t.hist.length > 8) t.hist.shift();
      const o = inRiver(G, skiff.x, skiff.y) ? onRiver(G, skiff.x, skiff.y) : null;
      skiffTo(o);
      const last = skiff.trail[skiff.trail.length - 1];
      if (o && (!last || Math.hypot(last.x - skiff.x, last.y - skiff.y) > 10)) skiff.trail.push({ x: skiff.x, y: skiff.y, t: performance.now() });
      return;
    }
    if (t.kind === 'cloud') { setP(t, 'cutoff', clamp(t.v0 - dy / 220)); t.moved = true; return; }   // туча выше — ярче
    if (t.kind === 'mountains') { setP(t, 'res', clamp(t.v0 - dy / 160)); t.moved = true; return; }  // горы выше — резонанс
    if (t.kind === 'duckA' || t.kind === 'duckR') { setP(t, t.key, clamp(t.v0 - dy / 160)); t.moved = true; return; }   // утку вверх — больше: длиннее attack / release   // вверх — attack, вбок — release
    if (t.kind === 'tree') {                          // тормошим: чем быстрее водишь по дереву, тем сильнее
      const v = Math.hypot(f.x - t.lx, f.y - t.ly); t.lx = f.x; t.ly = f.y;
      model.shakeBy(v / 260); return;
    }
    if (t.kind === 'plant' && t.moved) { t.path.push([f.x, f.y]); return; }   // рисуем по воде
    if (!t.moved) return;
    if (t.kind === 'boat') { model.setBpm(Math.round(clamp(t.bpm0 + dx / 2, 40, 200))); T.tempoFrom(4, seq.bpm); }
    else if (t.kind === 'bridge') { const o = onRiver(G, f.x, f.y); if (o) model.setLen(clamp(slotOf({ t: o.t + 0.02 }) + 1, 2, 16)); }
    else if (t.kind === 'pad' && !t.cycled) {         // поперёк — нота, вдоль — на другое место (если свободно)
      const o = onRiver(G, f.x, f.y), j = slotOf(o), n = noteOf(o);
      if (model.movePad(t.i, j)) t.i = j;
      model.setNote(t.i, n);
    }
  }
  function up(f) {
    const t = touches.get(f.id);
    touches.delete(f.id);
    if (!t) return;
    const G = geo();
    if (menu && menu.tid === t) {                     // отпустил на цветке — выбран; мимо — меню ждёт тапа
      const k = menuHit(G, f.x, f.y);
      if (t.kind === 'skiff') { skiff.held = false; skiff.home = true; skiffTo(null); }
      if (k >= 0) { pickWave(k); menu = null; } else { menu.held = false; menu.hover = -1; }
      return;
    }
    if (t.kind === 'skiff') {
      skiff.held = false; skiffTo(null);
      const now = performance.now(), P = pondAt(G), h = (t.hist || []).filter((q) => now - q.t < 250).slice(-4);
      const inPond = (x, y) => ((x - P.x) / P.rx) ** 2 + ((y - P.y) / P.ry) ** 2 < 1.3;
      let hit = inPond(skiff.x, skiff.y) ? { x: skiff.x, y: skiff.y } : null;
      if (!hit && h.length >= 2 && !model.envOpen()) {      // бросок: продолжить движение пальца — попадёт ли в заводь
        const a = h[0], b = h[h.length - 1], dt = Math.max(16, b.t - a.t), vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt;
        if (Math.hypot(vx, vy) > 0.35) for (let d = 0; d < 520; d += 8) {
          const sp = Math.hypot(vx, vy), x = skiff.x + (vx / sp) * d, y = skiff.y + (vy / sp) * d;
          if (inPond(x, y)) { hit = { x: P.x + (x - P.x) * 0.5, y: P.y + (y - P.y) * 0.3 }; break; }
        }
      }
      if (hit && !model.envOpen()) skiff.fly = { x0: skiff.x, y0: skiff.y, x1: hit.x, y1: hit.y, t0: now, ms: 120 + 0.6 * Math.hypot(hit.x - skiff.x, hit.y - skiff.y) };
      else skiff.back = { x: skiff.x, y: skiff.y, t0: now };
      return;
    }
    if (t.kind === 'frog' && !t.moved) { croak(); return; }
    if (t.kind === 'boat' && !t.moved) { model.play(); T.tempoFrom(4, seq.bpm); T.transportFrom(4, seq.playing); }
    else if (t.kind === 'pad' && t.frog && !t.moved && !t.cycled) croak();
    else if (t.kind === 'pad' && !t.moved && !t.cycled) model.remove(t.i);      // тап по кувшинке — убрать
    else if (t.kind === 'birds' && !t.moved) { birdsAt = performance.now(); model.scatter(); }   // спугнули — лазер
    else if (t.kind === 'plant' && t.moved) {                                      // провёл по воде через кувшинки — глайд в них (все уже скользили — снять)
      const hit = [];
      for (let i = 0; i < 16; i++) {
        const pd = pads.at[i];
        if (!pd) continue;
        const p = padXY(G, i, pd.note);
        if (t.path.some(([x, y]) => Math.hypot(x - p.x, (y - p.y) * 1.4) < LILY * p.s + 8)) hit.push(i);
      }
      model.glide(hit);
      wake = { path: t.path, at: performance.now() };
    } else if (t.kind === 'plant' && !t.moved) {                                     // тап по воде — посадить
      const o = onRiver(G, f.x, f.y), i = slotOf(o);
      model.plant(i, noteOf(o));
    }
  }
  function tick(now) {                                // держишь кувшинку — плашка; кораблик на берегу — меню волн (дерево успокаивается в модели)
    for (const t of touches.values()) {               // держишь кувшинку — её кольцо; кораблик на берегу — меню волн
      if ((t.kind !== 'pad' && t.kind !== 'skiff') || t.moved || t.cycled || now - t.t0 < T.HOLD_MS || menu) continue;
      if (t.kind === 'pad' && !pads.at[t.i]) continue;
      const G = geo();
      t.cycled = true;
      if (t.kind === 'pad') lilySheet(t.i);         // держишь кувшинку — плашка её настроек снизу
      else menu = { tid: t, kind: t.kind, i: t.i, x: skiff.x, y: skiff.y, held: true, hover: -1 };
    }
  }
  const msTxt = (v) => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`);
  // плашка кувшинки: wave, cutoff, res, attack, release, chance; в скобках — общее значение из пейзажа, двойной тап по строке — снова общее
  const LILY_ROWS = [{ key: 'form', label: 'wave' }, { key: 'cutoff', label: 'cutoff' }, { key: 'res', label: 'res' }, { key: 'att', label: 'attack' }, { key: 'rel', label: 'release' }, { key: 'chance', label: 'chance' }];
  function lilySheet(i) {
    const pd = pads.at[i];
    if (!pd) return;
    let heardAt = 0;
    T.openSheet({
      title: `lily ${i + 1} · ${noteName(model.noteHz(pd.note))}`, hint: '( ) general · double tap — reset', rows: LILY_ROWS,
      get: (k) => (k === 'form' ? pd.wave / (WAVES.length - 1) : k === 'chance' ? pd.chance ?? 1 : val(pd, k)),
      set: (k, v) => {
        if (k === 'form') { if (model.setWave(pd, Math.round(v * (WAVES.length - 1)))) heardAt = 0; }
        else if (k === 'chance') model.setChance(pd, Math.round(v * 20) / 20);
        else model.setLock(pd, k, v);
        const now = performance.now();
        if (engine.has && !seq.playing && now - heardAt > 260) { heardAt = now; model.hear(pd); }   // послушать
      },
      text: (k) => {
        if (k === 'form') return WAVES[pd.wave];
        if (k === 'chance') return `${Math.round((pd.chance ?? 1) * 100)}%`;
        const t = k === 'cutoff' ? hzTxt(180 * 2 ** (val(pd, k) * 6.6)) : k === 'res' ? `${Math.round(val(pd, k) * 100)}%` : msTxt(k === 'att' ? attOf(val(pd, k)) : relOf(val(pd, k)));
        return pd.lock && pd.lock[k] != null ? t : `(${t})`;
      },
      reset: (k) => model.resetPad(pd, k),
    });
  }
  const hzTxt = (hz) => (hz >= 1000 ? `${(hz / 1000).toFixed(1)} kHz` : `${Math.round(hz)} Hz`);
  // меню волн: пять цветов дугой над корабликом; тот же палец ведёт и отпускает на цветке, или тап потом
  let menu = null;
  function menuOpts(G) {
    const R = 74, cx = clamp(menu.x, R + 26, G.W - R - 26), up = menu.y - R - 30 > G.top + 40, cy = up ? menu.y - 8 : menu.y + 8;
    return WAVES.map((_, k) => { const an = up ? Math.PI + ((k + 0.5) / WAVES.length) * Math.PI : Math.PI - ((k + 0.5) / WAVES.length) * Math.PI; return { x: cx + Math.cos(an) * R, y: cy + Math.sin(an) * R }; });
  }
  const menuHit = (G, x, y) => menuOpts(G).findIndex((o) => Math.hypot(x - o.x, y - o.y) < 26);
  const menuWave = () => (menu.kind === 'pad' ? pads.at[menu.i] && pads.at[menu.i].wave : st.lastWave);
  const pickWave = (k) => model.pickWave(k, menu.kind === 'pad' ? pads.at[menu.i] : null);   // цветок кувшинки (и послушать) или голос кораблика
  function drawMenu(c, G) {
    if (!menu) return;
    const O = menuOpts(G), cur = menuWave();
    O.forEach((o, k) => {
      const on = k === menu.hover || (menu.hover < 0 && k === cur);
      c.fillStyle = pap(1); c.beginPath(); c.arc(o.x, o.y, 22, 0, TAU); c.fill();
      T.ring(o.x, o.y, 22, on ? 0.95 : 0.6, 1); if (k === cur) T.ring(o.x, o.y, 25, 0.5, 0.7);
      flower(c, o.x, o.y + 1, k, 10, on ? 1 : 0.75);
    });
    const k = menu.hover >= 0 ? menu.hover : cur;
    if (k != null && k >= 0) { const o = O[k]; T.mapText(WAVES[k], o.x, o.y - 30, 14, 0.9, 'center'); }
  }
  // ---------- лягушка: сидит на давно молчащей кувшинке; заиграла её — прыгает на самую молчаливую; тап — квакает нотой шага ----------
  const frog = { i: -1, from: null, t0: 0, seen: 0, croak: 0, sat: 0 };   // sat — когда села: сидит не меньше 8 с
  function frogPos(G, now) {
    const live = []; for (let i = 0; i < pads.len; i++) if (pads.at[i]) live.push(i);
    if (!live.length) { frog.i = -1; return null; }
    const quiet = (ex) => live.filter((i) => i !== ex).sort((a, b) => playedAt[a] - playedAt[b])[0];
    if (frog.i < 0 || !pads.at[frog.i] || frog.i >= pads.len) { frog.i = quiet(-1); frog.from = null; }
    if (playedAt[frog.i] > frog.seen && playedAt[frog.i] <= now && live.length > 1 && now - frog.sat > 8000 && Math.random() < 0.35) {   // её кувшинка заиграла — изредка прыгает, неспешно
      const pd0 = pads.at[frog.i], p0 = padXY(G, frog.i, pd0.note);
      frog.from = { x: p0.x, y: p0.y }; frog.t0 = now; frog.sat = now + 700; frog.i = quiet(frog.i);
    }
    frog.seen = now;
    const pd = pads.at[frog.i], p = padXY(G, frog.i, pd.note), to = { x: p.x + 4 * p.s, y: p.y - 3 * p.s, s: 0.7 + 0.5 * p.s };
    if (!frog.from) return to;
    const k = clamp((now - frog.t0) / 700);
    if (k >= 1) { frog.from = null; return to; }
    const e = k * k * (3 - 2 * k);
    return { x: frog.from.x + (to.x - frog.from.x) * e, y: frog.from.y + (to.y - frog.from.y) * e - Math.sin(Math.PI * e) * 20, s: to.s, air: true };
  }
  function drawFrog(c, G, now) {
    const f = frogPos(G, now);
    if (!f) return;
    frog.at = f;
    const s = 7 * f.s;
    c.save(); c.translate(f.x, f.y);
    c.fillStyle = pap(1); c.strokeStyle = ink(0.9); c.lineWidth = 1;
    if (f.air) { c.beginPath(); c.moveTo(-s * 0.6, s * 0.3); c.lineTo(-s * 1.5, s * 0.9); c.moveTo(s * 0.6, s * 0.3); c.lineTo(s * 1.5, s * 0.9); c.stroke(); }   // в прыжке — ноги вытянуты
    else { c.beginPath(); c.moveTo(-s * 0.8, s * 0.4); c.lineTo(-s * 1.2, -s * 0.05); c.lineTo(-s * 0.7, s * 0.55); c.moveTo(s * 0.8, s * 0.4); c.lineTo(s * 1.2, -s * 0.05); c.lineTo(s * 0.7, s * 0.55); c.stroke(); }
    c.beginPath(); c.ellipse(0, 0, s * 0.85, s * 0.6, 0, 0, TAU); c.fill(); c.stroke();
    for (const ex of [-0.38, 0.38]) { c.beginPath(); c.arc(ex * s, -s * 0.5, s * 0.24, 0, TAU); c.fill(); c.stroke(); c.beginPath(); c.arc(ex * s, -s * 0.52, s * 0.08, 0, TAU); c.fillStyle = ink(0.9); c.fill(); c.fillStyle = pap(1); }
    const ck = (now - frog.croak) / 320;
    if (ck >= 0 && ck < 1) { c.beginPath(); c.arc(0, s * 0.45, s * 0.35 * (1 + Math.sin(Math.PI * ck)), 0, TAU); c.fill(); c.stroke(); }   // горловой мешок
    c.restore();
  }
  function croak() {
    const pd = pads.at[frog.i];
    frog.croak = performance.now();
    model.croak(pd);                                  // квакает нотой своей кувшинки (engine)
  }
  // ---------- рыба выпрыгивает на первом шаге петли — метроном раз в такт ----------
  let fish = null, fishStep = -1;
  function drawFish(c, G, now) {
    const ph = engine.phase();
    if (ph != null) {
      const st = Math.floor(ph);
      if (st !== fishStep) {
        fishStep = st;
        if (st % pads.len === 0) { const t = 0.25 + Math.random() * 0.5, r = river(G, t), q = (Math.random() - 0.5) * 0.5, p = across(r, q); fish = { x: p.x, y: p.y, t0: now, dir: Math.random() < 0.5 ? -1 : 1, s: 0.7 + 0.6 * t }; }
      }
    }
    if (!fish) return;
    const k = (now - fish.t0) / 650;
    if (k > 1.6) { fish = null; return; }
    const L = 34 * fish.s;
    c.strokeStyle = ink(0.5 * Math.max(0, 1 - Math.abs(k - 0.05) * 2)); c.lineWidth = 0.9;   // круги: где нырнула вверх и где вошла
    for (const [x0, k0] of [[fish.x - (fish.dir * L) / 2, 0], [fish.x + (fish.dir * L) / 2, 1]]) {
      const kk = (k - k0) / 0.6;
      if (kk < 0 || kk > 1) continue;
      c.strokeStyle = ink(0.5 * (1 - kk)); c.beginPath(); c.ellipse(x0, fish.y, 5 + 16 * kk, (5 + 16 * kk) * 0.35, 0, 0, TAU); c.stroke();
    }
    if (k > 1) return;
    const x = fish.x + fish.dir * L * (k - 0.5), y = fish.y - Math.sin(Math.PI * k) * 22 * fish.s, ang = Math.atan2(-Math.cos(Math.PI * k) * 22 * Math.PI * fish.s, fish.dir * L);
    const sz = 7 * fish.s;
    c.save(); c.translate(x, y); c.rotate(fish.dir > 0 ? ang : ang + Math.PI); c.scale(fish.dir > 0 ? 1 : -1, 1);
    c.fillStyle = pap(1); c.strokeStyle = ink(0.9); c.lineWidth = 1;
    c.beginPath(); c.moveTo(sz, 0); c.quadraticCurveTo(0, -sz * 0.5, -sz * 0.8, 0); c.quadraticCurveTo(0, sz * 0.5, sz, 0); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(-sz * 0.75, 0); c.lineTo(-sz * 1.25, -sz * 0.35); c.lineTo(-sz * 1.2, sz * 0.35); c.closePath(); c.fill(); c.stroke();
    c.beginPath(); c.arc(sz * 0.55, -sz * 0.08, 0.9, 0, TAU); c.fillStyle = ink(0.9); c.fill();
    c.restore();
  }
  // ---------- стрекозы над водой: больше chorus — больше стрекоз (до 3), зависают над только что сыгравшими кувшинками ----------
  const flies = [0, 1, 2].map((k) => ({ x: 0, y: 0, k, ok: false, i: null, until: 0 }));
  let fliesLast = performance.now();
  function drawFlies(c, G, now) {
    const n = fx.chorus < 0.2 ? 0 : Math.ceil(((fx.chorus - 0.2) / 0.8) * 3), dt = Math.min(0.1, (now - fliesLast) / 1000); fliesLast = now;
    const order = []; for (let i = 0; i < pads.len; i++) if (pads.at[i]) order.push(i);
    order.sort((a, b) => playedAt[b] - playedAt[a]);
    for (let j = 0; j < n; j++) {
      const F = flies[j];
      if (!F.until || now > F.until || !pads.at[F.i]) {   // цель меняет редко: висит над кувшинкой 6–12 с, потом — к недавно сыгравшей
        F.i = order[j % Math.max(1, order.length)]; F.until = now + 6000 + Math.random() * 6000;
      }
      let tx = G.W * (0.3 + 0.2 * j), ty = G.hor + G.h * (0.25 + 0.1 * j);
      if (F.i != null && pads.at[F.i]) { const pd = pads.at[F.i], p = padXY(G, F.i, pd.note); tx = p.x + Math.sin(now * 0.0003 + j * 2) * 6; ty = p.y - 22 * p.s - 8 + Math.sin(now * 0.0005 + j) * 2; }
      if (!F.ok) { F.x = tx; F.y = ty; F.ok = true; }
      const k = Math.min(1, dt * 0.8);                // плавно, без рывков
      F.x += (tx - F.x) * k; F.y += (ty - F.y) * k;
      const fl = 0.7 + 0.3 * Math.sin(now * 0.03 + j);
      c.save(); c.translate(F.x, F.y); c.rotate(Math.sin(now * 0.0003 + j) * 0.12);
      c.strokeStyle = ink(0.85); c.lineWidth = 1.1; c.beginPath(); c.moveTo(-7, 0); c.lineTo(6, 0); c.stroke();
      c.beginPath(); c.arc(7, 0, 1.4, 0, TAU); c.fillStyle = ink(0.85); c.fill();
      c.strokeStyle = ink(0.65 * fl); c.lineWidth = 0.8;
      for (const [x0, sy] of [[2, -1], [2, 1], [-1, -1], [-1, 1]]) { c.beginPath(); c.ellipse(x0, sy * 4, 1.6, 4.2, sy * 0.4, 0, TAU); c.stroke(); }
      c.restore();
    }
    for (let j = n; j < 3; j++) flies[j].ok = false;
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
      else if (t.kind === 'cloud') { const cl = cloudAt(G); T.mapText(`cutoff · ${Math.round(180 * 2 ** (shown('cutoff') * 6.6))} Hz`, Math.min(cl.cx, G.W - 90), cl.cy + 24 * cl.s, 14, 0.9, 'center'); }
      else if (t.kind === 'mountains') T.mapText(`res · ${Math.round(shown('res') * 100)}%`, G.W / 2, G.hor - 0.26 * G.h, 14, 0.9, 'center');
      else if (t.kind === 'duckA' || t.kind === 'duckR') {
        const d = ducksAt(G)[t.kind === 'duckA' ? 'A' : 'R'], v = t.kind === 'duckA' ? attOf(shown('att')) : relOf(shown('rel')), ms = v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`;
        T.mapText(`${t.kind === 'duckA' ? 'attack' : 'release'} · ${ms}`, clamp(d.x, 80, G.W - 80), d.y - d.s * 1.4 - 14, 14, 0.9, 'center');
      }
      else if (t.kind === 'bridge') { const r = river(G, bridgeT()), p = across(r, 0.5 + 22 / r.w); T.mapText(String(pads.len), p.x, p.y - 12, 16, 0.9, 'center'); }
      else if (t.kind === 'pad' && pads.at[t.i]) { const p = padXY(G, t.i, pads.at[t.i].note); T.mapText(noteName(model.noteHz(pads.at[t.i].note)), p.x, p.y - 24 - 8 * p.s, 15, 0.95, 'center'); }
    }
  }
  const deg = (d) => (d * Math.PI) / 180;
  const fxw = {
    sectors: [
      { key: 'reverb', label: 'reverb', ang: deg(180) },
      { key: 'delay', label: 'delay', ang: deg(162) },
      { key: 'time', label: 'time', ang: deg(144) },
      { key: 'chorus', label: 'chorus', ang: deg(126) },
      { key: 'chance', label: 'chance', ang: deg(108) },   // cutoff, res и огибающая — в сцене: туча, горы, мельница
    ],
    get: (k) => fx[k], set: (k, v) => model.setFx(k, v),
    text: (k) => (k === 'time' ? model.div()[0] : `${Math.round(fx[k] * 100)}%`),
    arc: () => fx.reverb,
    save: () => ({ ...fx }),
    load: (o) => model.loadFx(o),
  };
  // кораблик на воде (o = { t, q }) или с воды (null): голос — engine, подпись ноты — здесь
  function skiffTo(o) {
    model.skiff(o);
    if (o && engine.skiff) skiff.label = noteName(model.skiffHz(o.q));
  }
  function draw(now) {
    const c = T.g, G = geo(), { ox } = stage();
    layers(G);
    if (ox) { c.fillStyle = `rgb(${PAPER})`; c.fillRect(0, 0, T.W, T.H); }
    c.save(); c.translate(ox, 0);
    c.drawImage(scene.skyC, 0, 0, T.W, T.H);
    c.save(); c.beginPath(); c.rect(13, 13, G.W - 26, T.H - T.safeBot - 26); c.clip();
    drawSun(c, G, now);
    drawBirds(c, G, now);
    c.restore();
    c.drawImage(scene.landC, 0, 0, T.W, T.H);
    drawFog(c, G, now);
    drawRainRings(c, G, now);
    drawPier(c, G);
    drawGlides(c, G, now);
    drawFish(c, G, now);
    drawPads(c, G, now);
    drawFrog(c, G, now);
    drawReeds(c, G, now);
    drawTree(c, G);
    drawCloud(c, G, now);
    drawDucks(c, G, now);
    drawSkiff(c, G, now);
    drawFlies(c, G, now);
    drawStone(c, G);
    drawTouches(c, G);
    drawMenu(c, G);
    c.restore();
  }
  const corner = { hit: (f0) => { const f = sh(f0), S = sunAt(geo()); return f.y > S.y && Math.hypot(f.x - S.x, f.y - S.y) < S.r + 6; }, draw: () => {} };   // солнце — карта; надгробие пока просто стоит

  return {
    theme: { ink: INK, bg: `rgb(${PAPER})`, paper: PAPER }, corner, fx: fxw,
    draw, tick, heard, down: (f) => down(sh(f)), move: (f) => move(sh(f)), up: (f) => up(sh(f)),
    mapShot(on) { noSun = on; },
    geo, scare: () => scare(performance.now()),
    get birdsAt() { return birdsAt; }, get fish() { return !!fish; }, get ducksGone() { return !!ducksGone; },
    // для t2d.nat (сценарии shot.py): где что на экране
    nat: {
      skiff: () => ({ x: skiff.x, y: skiff.y - 4, playing: !!engine.skiff, home: skiff.home }),
      ring: () => null,                               // старое кольцо кувшинки убрано — плашка (lilySheet)
      frog: () => frog.at && frog.i >= 0 && { x: frog.at.x, y: frog.at.y, i: frog.i, croak: frog.croak }, sun: () => sunAt(geo()),
      pond: () => pondAt(geo()),
      cloud: () => { const cl = cloudAt(geo()); return { x: cl.cx, y: cl.cy }; },
      menu: () => menu && { open: true, held: menu.held, opts: menuOpts(geo()) },
      duck: (k) => { const d = ducksAt(geo())[k]; return { x: d.x, y: d.y - d.s * 0.35, s: d.s }; },
      tree: () => { const G = geo(), R = Math.min(G.W * 0.16, G.h * 0.09); return { x: G.tree.x, y: G.tree.y - G.h * 0.13 - R * 0.6 }; },
      bird: () => { const b = birdList(geo(), performance.now())[0]; return b && { x: b.X, y: b.Y }; },
      setFx: (k, v) => fxw.set(k, v),
      pad: (i) => { const pd = pads.at[i]; const p = padXY(geo(), i, pd ? pd.note : 7); return { x: p.x, y: p.y }; },
      slot: (i, note) => { const p = padXY(geo(), i, note); return { x: p.x, y: p.y }; },
      boat: () => { const q = pierXY(geo()); return { x: q.x, y: q.y }; },
      bridge: () => { const G = geo(), r = river(G, bridgeT()); return { x: r.x, y: r.y - 6 }; },
    },
  };
}
