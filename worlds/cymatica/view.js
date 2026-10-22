// Cymatica — картинка и касания: пластина-ханг посередине, астролябия (кольца мелодии и ритма), ▶ ● сетка луна, резонатор в углу.
// Касание → действие модели (звук не трогает). От engine — метры (energy, voices) и «услышано»: шаг часов (мигание, созвездия), отзыв резонатора.
import { SLOTS, F_MIN, F_DEF, ECHO_DIVS, clamp, nearestIdx, noteName, cellIdx, cellOf, cellCenter, twistOrPinch } from './core.js';
import { DRIFT_RATES } from './model.js';

// смычки (живой — держишь палец, закреплённые — двойной тап, кольцо смычка) выключены: апплет — о полиритмах и модах.
// Код на месте; вернуть — BOWS_ON = true (тесты смычков в tools/shot.py включатся сами)
export const BOWS_ON = false;
const BOW_AFTER = 150;                     // мс: дольше держишь — удар переходит в смычок
const TAP_MS = 250, TAP_MOVE = 12, MARK_R = 18;
const STRUCT = ['string', 'membrane', 'plate', 'bell', 'bowl', 'handpan', 'marimba', 'kalimba'];   // тела по лучу structure
const deg = (d) => (d * Math.PI) / 180;
// щипок: ход пальцев линейный — без лада 12 px на полутон, с ладом 18 px на ступень (лишних ступеней нет, не застревает)
const PX_SEMI = 12, PX_DEG = 18;

export function createView(T, model, engine) {
  const { plate, seq, drift } = model.state, S = model.state;
  const { noteList, degPerOct, scaleSemis, effF0, fs, notesOf, driftRate, driftDepth, echoDiv } = model;
  const touches = new Map();                 // палец → касание пластины
  let ringF = null, two = null, lastTap = null, labelUntil = 0, gesture = null, twistLabel = null;
  let lastStep = null;                       // последний тик { r, m, atMs }
  const born = { r: new Float64Array(SLOTS), m: new Float64Array(SLOTS) }, pulse = { r: new Float64Array(SLOTS), m: new Float64Array(SLOTS) };
  let answerAt = -1e9, answerNote = '';

  // ---------- что услышано (engine) и что изменилось в узоре (модель) ----------
  function heard(d) {
    if (d.t === 'step') {                      // играет шаг — его удар и нота мигают
      const now = performance.now();
      lastStep = { r: d.r, m: d.m, atMs: now };
      if (seq.rhythm.steps[d.r] && d.hit !== false) {
        pulse.r[d.r] = now;
        const st = seq.melody.steps[d.m];
        if (st) { pulse.m[d.m] = now; starPush(st, now); }
      }
    } else if (d.t === 'answer') { answerAt = d.at; answerNote = d.note; }
  }
  function changed(e) {                        // новое в гнезде — вспышка: видно, куда легло
    if (e.t !== 'seq') return;
    const now = performance.now();
    for (const i of e.born.r) born.r[i] = now;
    for (const i of e.born.m) born.m[i] = now;
  }

  // созвездия: сыгранные места соединяются тонкими линиями, фигура медленно гаснет (полиритм виден рисунком)
  const stars = [];
  function starPush(st, now) { stars.push({ x: st.x, y: st.y, t: now }); while (stars.length > 24) stars.shift(); }
  function drawStars(g, now) {
    const c = T.g, LIFE = 5000;
    while (stars.length && now - stars[0].t > LIFE) stars.shift();
    c.lineWidth = 0.8;
    for (let i = 1; i < stars.length; i++) {
      const a = stars[i - 1], b = stars[i], k = 1 - (now - a.t) / LIFE;
      if (a.x === b.x && a.y === b.y) continue;
      const p = fromPlate(a, g), q = fromPlate(b, g);
      c.strokeStyle = T.ink(0.3 * k); c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(q.x, q.y); c.stroke();
    }
    for (const s of stars) { const k = 1 - (now - s.t) / LIFE, p = fromPlate(s, g); T.dot(p.x, p.y, 1.4, 0.55 * k); }
  }

  // ---------- высота = размер пластины ----------
  function setF0(hz) { labelUntil = performance.now() + 1000; model.setF0(hz); }
  function stepScale(fromSemi, steps) { labelUntil = performance.now() + 1000; model.stepScale(fromSemi, steps); }
  let shownF0 = F_DEF, wheelAcc = 0;
  function pinchTo(f00, dd) {
    if (!T.scaleOn) { setF0(f00 * 2 ** (-dd / PX_SEMI / 12)); return; }
    stepScale(12 * Math.log2(f00 / F_MIN), Math.round(-dd / PX_DEG));
  }

  // ---------- геометрия: пластина посередине; радиус по высоте: r ∝ f^−1/4 ----------
  // по высоте — пластина, кольца астролябии над ней (+64), ▶/● под ней (+104): блок по центру между строкой и низом
  function plateGeo() {
    const top = T.topY, bot = T.H - T.safeBot;
    const rMax = Math.max(40, Math.min(T.W / 2 - 64, (bot - top - 176) / 2));
    const cy = top + (bot - top - (2 * rMax + 168)) / 2 + rMax + 64;
    return { cx: T.W / 2, cy, rMax, r: rMax * (F_MIN / shownF0) ** 0.25 };   // размер едет плавно к высоте; закон мягче физического (f ∝ 1/r²) — клетки ханга остаются под палец
  }
  const toPlate = (f, g) => ({ x: (f.x - g.cx) / g.r, y: (f.y - g.cy) / g.r });
  const fromPlate = (b, g) => ({ x: g.cx + b.x * g.r, y: g.cy + b.y * g.r });
  function bowAt(f, g) {
    for (const b of plate.bows) { const p = fromPlate(b, g); if (Math.hypot(f.x - p.x, f.y - p.y) < MARK_R) return b; }
    return null;
  }

  // ---------- астролябия: кольцо мелодии (внутри) и ритма (снаружи), 16 гнёзд от верха по часовой; внизу ▶ и ● ----------
  // кольцо мелодии R1 — ноты сидят на нём, как бусины; кольцо ритма R2 — удары на нём; граница зон между ними — RM
  function astro(g) { return { R1: g.rMax + 22, R2: g.rMax + 48, RM: g.rMax + 35, ty: g.cy + g.rMax + 82, playX: g.cx - 90, recX: g.cx - 30, gridX: g.cx + 30, driftX: g.cx + 90 }; }
  const slotAng = (i) => -Math.PI / 2 + (i * Math.PI * 2) / SLOTS;
  const slotXY = (g, i, R) => ({ x: g.cx + R * Math.cos(slotAng(i)), y: g.cy + R * Math.sin(slotAng(i)) });
  const slotOf = (f, g) => ((((Math.atan2(f.y - g.cy, f.x - g.cx) + Math.PI / 2) / (Math.PI * 2)) * SLOTS) % SLOTS + SLOTS) % SLOTS;
  let bpmUntil = 0, noteEdit = null, chanceEdit = null;            // подписи — только пока правишь
  function astroHit(f, g) {
    const A = astro(g), d = Math.hypot(f.x - g.cx, f.y - g.cy);
    if (Math.hypot(f.x - A.playX, f.y - A.ty) < 22) return { k: 'play' };
    if (Math.hypot(f.x - A.recX, f.y - A.ty) < 22) return { k: 'rec' };
    if (Math.hypot(f.x - A.gridX, f.y - A.ty) < 22) return { k: 'grid' };
    if (Math.hypot(f.x - A.driftX, f.y - A.ty) < 22) return { k: 'drift' };
    const s = slotOf(f, g), ring = d >= A.RM && d < A.R2 + 14 ? 'rhythm' : d >= A.R1 - 14 && d < A.RM ? 'melody' : null;
    if (ring) {                                  // край заливки длины кольца (между гнёздами) — тянуть по кругу
      const e = Math.abs(((s - (seq[ring].len - 0.5)) % SLOTS + SLOTS + SLOTS / 2) % SLOTS - SLOTS / 2);
      if (e < 0.3) return { k: 'len', ring };
    }
    const i = Math.round(s) % SLOTS;
    if (ring === 'rhythm') return { k: 'rtick', i, r0: d, c0: seq.rhythm.steps[i] ? seq.rhythm.steps[i].chance ?? 1 : 1 };
    if (ring === 'melody') {                     // бусина — нота места этого шага: его клетка
      const st = seq.melody.steps[i];
      return { k: 'mtick', i, r0: d, ci: st ? cellIdx(st.x, st.y, nearestIdx(noteList(), fs()), degPerOct()) : null };
    }
    return null;
  }
  function astroMove(f, g) {
    const h = f.astro;
    if (h.k === 'play' && f.moved) {             // зажал ▶ и ведёшь — темп
      const bpm = Math.round(clamp(f.bpm0 + (f.x - f.x0) * 0.5, 40, 200));
      if (bpm !== seq.bpm) { model.setBpm(bpm); T.tempoFrom(2, bpm); }
      bpmUntil = performance.now() + 1000;
    } else if (h.k === 'len') {
      model.setLen(h.ring, Math.round(clamp(slotOf(f, g) + 0.5, 1, SLOTS)));   // у каждого кольца своя длина
    } else if (h.k === 'rtick' && f.moved && seq.rhythm.steps[h.i]) {   // удар тянешь к центру — реже (шанс), наружу — чаще
      model.setChance(h.i, Math.round(clamp(h.c0 + (Math.hypot(f.x - g.cx, f.y - g.cy) - h.r0) / 70, 0.05, 1) * 20) / 20);
      chanceEdit = { i: h.i, until: performance.now() + 1000 };
    } else if (h.k === 'drift' && f.moved) {
    } else if (h.k === 'mtick' && f.moved && h.ci != null) {   // бусину — от центра выше, к центру ниже на ступени; место переезжает в клетку ноты
      if (!seq.melody.steps[h.i]) return;
      model.nudgeNote(h.i, h.ci, Math.round((Math.hypot(f.x - g.cx, f.y - g.cy) - h.r0) / 6));
      noteEdit = { i: h.i, until: performance.now() + 1000 };
    }
  }
  function astroUp(f) {
    const h = f.astro;
    if (h.k === 'grid' && !f.combed) model.cycleGrid();   // тап — сетка 1/16 → 1/8 → 1/4
    if (h.k === 'play' && !f.moved) { model.setCursor(null); model.play(); T.tempoFrom(2, seq.bpm); T.transportFrom(2, seq.playing); }
    else if (h.k === 'rec') { model.setCursor(null); if (seq.playing) model.rec(); else model.stepRecToggle(); }   // часы стоят — запись по шагам
    else if (h.k === 'rtick' && !f.moved) model.toggleBeat(h.i);
    else if (h.k === 'drift' && !f.moved && !f.menu && !T.sheetOpen) model.toggleDrift();
    else if (h.k === 'mtick' && !f.moved && !seq.playing) model.setCursor(h.i % seq.melody.len);   // тап по гнезду мелодии, часы стоят — курсор пошагового ввода туда
  }
  // пошаговый ввод: курсор появляется тапом по гнезду кольца мелодии (часы стоят); тап по пластине пишет место в гнездо
  // курсора и двигает его дальше; ▶, ● или тап мимо пластины и колец — курсор убран
  function drawCursor(g) {
    if (S.cursor == null || seq.playing) return;
    const A = astro(g), i = S.cursor % seq.melody.len, p = slotXY(g, i, A.R1);
    T.ring(p.x, p.y, 15, 0.9, 1.6);
    T.mapText(`step ${i + 1} / ${seq.melody.len}`, A.playX - 62, A.ty, 13, 0.7, 'center');
  }
  // метка места мелодии на пластине
  function markAt(f, g) {
    for (let i = 0; i < SLOTS; i++) {
      const st = seq.melody.steps[i];
      if (!st) continue;
      const p = fromPlate(st, g);
      if (Math.hypot(f.x - p.x, f.y - p.y) < 11) return i;
    }
    return -1;
  }

  // ---------- вращение: кольца — сдвиг узора, пластина — транспонирование; два пальца или Shift-мышь ----------
  const wrapDeg = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
  const origOf = () => ({ r: seq.rhythm.steps.slice(), m: seq.melody.steps.slice() });
  // что крутим — по расстоянию от центра пластины (у двух пальцев — среднее: оно не меняется при повороте), с запасом:
  // внутри стола — пластина, до границы зон между кольцами — мелодия, всё дальше — ритм
  function twistTarget(d, g) {
    const A = astro(g);
    return d < g.rMax ? 'plate' : d < A.RM ? 'melody' : 'rhythm';
  }
  function startTwo(o, f, g) {
    if (o.bowing) { model.bowOff(o.bid); o.bowing = false; }   // смычок первого пальца гаснет
    o.live = false; o.astro = null; o.mk = null; o.cb = null;
    touches.set(f.id, f);
    o.two = f.two = true;
    two = {
      a: o, b: f, a0: Math.atan2(f.y - o.y, f.x - o.x), d0: Math.max(20, Math.hypot(f.x - o.x, f.y - o.y)),
      kind: null, target: twistTarget((Math.hypot(o.x - g.cx, o.y - g.cy) + Math.hypot(f.x - g.cx, f.y - g.cy)) / 2, g),
      f00: plate.f0, orig: origOf(), deg: 0, k: 0,
    };
    two.last = two.a0;
  }
  function moveTwo(g) {
    const t = two, a1 = Math.atan2(t.b.y - t.a.y, t.b.x - t.a.x), d1 = Math.max(20, Math.hypot(t.b.x - t.a.x, t.b.y - t.a.y));
    if (!t.kind) { t.kind = twistOrPinch(t.a0, a1, t.d0, d1); if (t.kind) gesture = t.kind; }
    if (t.kind === 'pinch') pinchTo(t.f00, d1 - t.d0);   // развёл — пластина больше и ниже
    if (t.kind !== 'twist' || !t.target) return;
    const dd = wrapDeg(((a1 - t.last) * 180) / Math.PI);
    t.last = a1; t.deg += dd;
    twistTo(t, t.target, t.deg, (t.a.x + t.b.x) / 2, (t.a.y + t.b.y) / 2);
  }
  // поворот относительно начала жеста: кольца — 22.5° на гнездо, пластина — 20° на ступень лада (по часовой — вперёд/вверх)
  const ringTurn = { melody: 0, rhythm: 0 }, ringOrn = { melody: 0, rhythm: 0 };   // ringTurn — остаток поворота кольца в градусах (кольцо идёт за пальцами, отпустил — встаёт в гнездо); ringOrn — накопленный поворот узора кольца
  function twistTo(t, target, deg, x, y) {
    const k = Math.round(deg / (target === 'plate' ? 20 : 22.5));
    if (target !== 'plate') ringTurn[target] = deg - k * 22.5;   // кольца крутятся порознь — сдвиг ритма против мелодии
    twistLabel = { text: `${k > 0 ? '+' : ''}${k}`, x, y, until: performance.now() + 1000 };
    if (k === t.k) return;
    t.k = k;
    model.turn(target, t.orig, k);             // пластина: каждое место — на k ступеней; вернул в ноль — места как были
  }
  function endTurn(t) {                          // отпустил — кольцо встаёт в гнездо, его узор остаётся повёрнутым
    if (t.target === 'melody' || t.target === 'rhythm') ringOrn[t.target] = (ringOrn[t.target] + t.k * 22.5) % 360;
    ringTurn.melody = ringTurn.rhythm = 0;
  }
  // ---------- касания ----------
  function down(f, e) {
    const g = plateGeo();
    if (e && e.shiftKey) {                       // Shift + мышь — вращение того, что под курсором
      const target = twistTarget(Math.hypot(f.x - g.cx, f.y - g.cy), g);
      if (target) { touches.set(f.id, f); f.twist1 = { target, last: Math.atan2(f.y - g.cy, f.x - g.cx), deg: 0, orig: origOf(), k: 0 }; return; }
    }
    const h0 = astroHit(f, g);                   // ▶ и ● работают и вторым пальцем — в пару не идут
    if (h0 && (h0.k === 'play' || h0.k === 'rec' || h0.k === 'grid' || h0.k === 'drift')) { touches.set(f.id, f); f.astro = h0; f.bpm0 = seq.bpm; return; }
    for (const o of touches.values()) {          // второй палец — поворот или щипок (решится по первым ~10° / ~20 px)
      if (o === f || o === ringF || two || o.twist1 || (o.astro && (o.astro.k === 'play' || o.astro.k === 'rec' || o.astro.k === 'grid' || o.astro.k === 'drift'))) continue;   // ▶ и ● — не в пару
      startTwo(o, f, g);
      return;
    }
    const h = astroHit(f, g);
    if (h) { touches.set(f.id, f); f.astro = h; f.bpm0 = seq.bpm; return; }
    if (Math.hypot(f.x - g.cx, f.y - g.cy) > g.rMax) { touches.set(f.id, f); f.away = true; return; }   // мимо стола: убирает курсор, второй палец — вращение
    touches.set(f.id, f);
    const b = BOWS_ON ? bowAt(f, g) : null;
    if (b) { f.cb = b; return; }
    const mk = seq.rec || (S.cursor != null && !seq.playing) ? -1 : markAt(f, g);   // при записи и пошаговом вводе метки не мешают: тап в ту же точку — снова пишется
    if (mk >= 0) {                              // тап по метке звучит сразу; повёл — тащишь метку
      f.mk = mk;
      model.markStrike(mk);
      return;
    }
    const p = toPlate(f, g);
    if (Math.hypot(p.x, p.y) > 1) { f.away = true; return; }   // вне пластины (но на столе) — только для щипка
    const now = performance.now();
    // удар: звук, запись игрой (ближайший шаг — по часам последнего тика), по шагам, пошаговый ввод — в модели
    if (model.strikeAt(p, now, lastStep) == null) return;   // клетка за 1760 Гц — молчит
    f.live = true; f.bid = `t${f.id}`;
    starPush(p, now);
  }
  function move(f) {
    if (!touches.has(f.id)) return;
    if (f === ringF) { T.menuMove(f); return; }
    const g = plateGeo();
    if (f.astro) { astroMove(f, g); return; }
    if (f.mk != null && f.moved) {               // метку тащишь — место меняется
      const p = toPlate(f, g);
      model.moveMark(f.mk, p.x, p.y);
      return;
    }
    if (f.twist1) {                              // Shift-мышь: угол вокруг центра пластины
      const a = Math.atan2(f.y - g.cy, f.x - g.cx), t = f.twist1;
      t.deg += wrapDeg(((a - t.last) * 180) / Math.PI); t.last = a;
      twistTo(t, t.target, t.deg, f.x, f.y);
      return;
    }
    if (f.two && two) { moveTwo(g); return; }
    if (f.cb && f.moved) { const p = toPlate(f, g); model.moveBow(f.cb, p.x, p.y); return; }
    if (f.bowing) { const p = toPlate(f, g); model.bowMove(f.bid, p.x, p.y); }
  }
  function up(f) {
    if (!touches.has(f.id)) return;
    touches.delete(f.id);
    const now = performance.now();
    if (f === ringF) { ringF = null; return; }
    if (f.astro) { astroUp(f); return; }
    if (f.mk != null) {
      const st = seq.melody.steps[f.mk];
      if (st && f.moved && Math.hypot(st.x, st.y) > 1.05) model.dropMark(f.mk);   // за край — место удалено, шаг — пауза
      return;
    }
    if (f.twist1) { endTurn(f.twist1); return; }
    if (f.two) { if (two && (two.a === f || two.b === f)) { endTurn(two); two = null; } return; }
    if (f.cb) {
      if (Math.hypot(f.cb.x, f.cb.y) > 1.05) model.dropBow(f.cb);   // утащил за край — смычок убран
      return;
    }
    if (f.away) {
      if (S.stepRec && Math.hypot(f.x - f.x0, f.y - f.y0) < TAP_MOVE) { model.skipStep(); return; }   // запись по шагам: тап мимо пластины — пауза, курсоры дальше
      model.setCursor(null); return;
    }
    if (!f.live) return;
    if (f.bowing) model.bowOff(f.bid);
    const tap = now - f.t0 < TAP_MS && Math.hypot(f.x - f.x0, f.y - f.y0) < TAP_MOVE;
    if (!tap) return;
    if (BOWS_ON && lastTap && now - lastTap.t < T.DTAP_MS && Math.hypot(f.x - lastTap.x, f.y - lastTap.y) < 30) {
      lastTap = null;
      if (plate.bows.length >= T.PIN_MAX) return;   // закреплённых уже три
      const p = toPlate(f, plateGeo());
      model.addBow(p.x, p.y);
      return;
    }
    lastTap = { t: now, x: f.x, y: f.y };
  }
  // корзина или отмена, пока палец держит метку или кольцо открыто: палец отпускает старый смычок,
  // иначе он снова включил бы в worklet смычок, которого больше нет в plate.bows
  function detach() {
    for (const f of touches.values()) { f.cb = null; if (f === ringF) { f.menu = null; ringF = null; } }
  }
  // кольцо закреплённого смычка — на весу, как веер FX: центр — откат, отпустил — значения остаются
  const BOW_SECTORS = [
    { key: 'exciter', label: 'bow ↔ breath', ang: -Math.PI / 2 },
    { key: 'pressure', label: 'pressure', ang: Math.PI / 6 },
    { key: 'amp', label: 'amp', ang: (5 * Math.PI) / 6 },
  ];
  function openRing(f) {
    const b = f.cb, g = plateGeo(), p = fromPlate(b, g), c = T.ringCenter(p.x, p.y), orig = { ...b };
    f.menu = {
      cx: c.cx, cy: c.cy, gx: f.x, gy: f.y, sector: null, sectors: BOW_SECTORS, span: T.MENU_SPAN, fx: true,
      get: (k) => b[k], set: (k, t) => { model.setBow(b, { [k]: t }); },
      text: (k) => (k === 'exciter' ? (b.exciter < 0.5 ? 'bow' : 'breath') : `${Math.round(b[k] * 100)}%`),
      restore: () => { model.setBow(b, orig); },
    };
    ringF = f;
  }
  const DRIFT_SECTORS = [
    { key: 'depth', label: 'depth', ang: -Math.PI / 2 },
    { key: 'rate', label: 'rate', ang: -Math.PI / 6 - Math.PI / 3, marks: DRIFT_RATES.map((r) => r[0]) },
    { key: 'shape', label: 'shape', ang: -Math.PI / 6 },
  ];
  function openDrift() {                          // плашка луны снизу (как FX): depth, rate, sine ↔ random
    T.openSheet({
      title: 'luna', hint: 'plate drift — tap outside to close', rows: DRIFT_SECTORS,
      get: (k) => drift[k],
      set: (k, t) => { model.setDrift(k, t); },
      text: (k) => (k === 'depth' ? `±${driftDepth()} steps` : k === 'rate' ? driftRate()[0] : drift.shape < 0.5 ? 'sine' : 'random'),
    });
  }
  // каждый кадр: держишь дольше 150 мс — удар становится смычком; держишь метку — кольцо
  function tick(now) {
    const g = plateGeo();
    for (const f of touches.values()) {
      if (BOWS_ON && f.live && !f.bowing && now - f.t0 > BOW_AFTER) {
        const p = toPlate(f, g);
        f.bowing = true;
        model.bowStart(f.bid, p.x, p.y);
      }
      if (f.cb && !f.moved && !f.menu && now - f.t0 > T.HOLD_MS) openRing(f);
      if (f.astro && f.astro.k === 'drift' && !f.menu && !f.moved && now - f.t0 > T.HOLD_MS) { f.menu = true; openDrift(); }   // зажал луну — плашка: глубина, такт, форма
      if (f.astro && f.astro.k === 'grid' && !f.combed && !f.moved && now - f.t0 > T.HOLD_MS) {   // зажал сетку — причесать ритм
        f.combed = true;
        model.comb();
      }
    }
  }

  // ---------- веер FX: пластина и пространство ----------
  const fxw = {
    sectors: [
      { key: 'structure', label: 'structure', ang: deg(180) },
      { key: 'damping', label: 'damping', ang: deg(165) },
      { key: 'brightness', label: 'brightness', ang: deg(150) },
      { key: 'hall', label: 'hall', ang: deg(135) },
      { key: 'echo', label: 'echo', ang: deg(120) },
      { key: 'chance', label: 'chance', ang: deg(105) },
      { key: 'time', label: 'time', ang: deg(90), marks: ECHO_DIVS.map((d) => d[0]) },
    ],
    get: (k) => plate.fx[k],
    set: (k, t) => { model.setFx(k, t); },
    text: (k) => {
      const v = plate.fx[k];
      if (k === 'structure') return STRUCT[Math.round(v * (STRUCT.length - 1))];
      if (k === 'time') return echoDiv()[0];
      if (k === 'damping') { const s = 0.08 * 150 ** v; return `${s.toFixed(s < 10 ? 1 : 0)} s`; }
      return `${Math.round(v * 100)}%`;
    },
    arc: () => plate.fx.hall,
    save: () => ({ ...plate.fx }),
    load: (o) => { model.loadFx(o); },
  };

  // ---------- рисование: строгая гравюра, как Tenebrae ----------
  function drawPlate(g) {
    const c = T.g;
    T.ring(g.cx, g.cy, g.rMax, 0.08, 1);               // стол — едва видно, сколько места под щипок
    T.ring(g.cx, g.cy, g.r, 0.55, 1);
    T.ring(g.cx, g.cy, g.r + 3, 0.25, 1);
    c.strokeStyle = T.ink(0.3); c.lineWidth = 1;
    c.beginPath();
    for (let d = 0; d < 360; d += 6) {
      const a = (d * Math.PI) / 180, x = Math.cos(a), y = Math.sin(a);
      c.moveTo(g.cx + x * (g.r + 3), g.cy + y * (g.r + 3)); c.lineTo(g.cx + x * (g.r + 7), g.cy + y * (g.r + 7));
    }
    c.stroke();
  }
  // клетки ханга: сетка видна всегда; клетка горит, пока звучит её нота (гейт — по уровню голоса из worklet: −50…−10 дБ);
  // названия нот — только пока играешь (палец на пластине, метка, бусина, жест, секунда после щипка)
  const glowOf = (lv) => clamp((10 * Math.log10(lv + 1e-20) + 50) / 40);
  function litCells() {                          // 'кольцо,сектор' → яркость
    const out = new Map(), list = noteList(), b = nearestIdx(list, fs()), n = degPerOct();
    for (const v of engine.voices) {
      const gl = glowOf(v.level);
      if (gl < 0.02) continue;
      const s = 12 * Math.log2(v.hz / F_MIN), cl = cellOf(list.findIndex((x) => Math.abs(x - s) < 0.05), b, n);
      if (!cl) continue;                         // нота не из раскладки (удар без клетки) — не горит
      const key = `${cl.ring},${cl.sector}`;
      out.set(key, Math.max(out.get(key) || 0, gl));
    }
    return out;
  }
  function showNotes(now) {
    return !!two || now < labelUntil || [...touches.values()].some((f) => f.live || f.mk != null || (f.astro && f.astro.k === 'mtick'));
  }
  const RINGS = [1, Math.sqrt(2 / 3), Math.sqrt(1 / 3), 0];   // границы колец: край, 0|1, 1|2, центр
  function cellPath(c, g, ring, sector, n) {     // контур клетки: дуга снаружи, дуга внутри, два луча
    const a0 = (sector / n) * Math.PI * 2 - Math.PI / 2, a1 = ((sector + 1) / n) * Math.PI * 2 - Math.PI / 2;
    const ro = RINGS[ring] * g.r, ri = RINGS[ring + 1] * g.r;
    c.beginPath(); c.arc(g.cx, g.cy, ro, a0, a1);
    if (ri > 0) c.arc(g.cx, g.cy, ri, a1, a0, true); else c.lineTo(g.cx, g.cy);
    c.closePath();
  }
  function drawCells(g, now) {
    const c = T.g, n = degPerOct();
    c.strokeStyle = T.ink(0.25); c.lineWidth = 1; c.beginPath();
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 - Math.PI / 2;
      c.moveTo(g.cx, g.cy); c.lineTo(g.cx + Math.cos(a) * g.r, g.cy + Math.sin(a) * g.r);
    }
    for (const r of [RINGS[1], RINGS[2]]) { c.moveTo(g.cx + r * g.r, g.cy); c.arc(g.cx, g.cy, r * g.r, 0, Math.PI * 2); }
    c.stroke();
    for (const [key, gl] of litCells()) {        // звучит — клетка светится и гаснет вместе с нотой
      const [ring, sector] = key.split(',').map(Number);
      cellPath(c, g, ring, sector, n);
      c.fillStyle = T.ink(0.12 * gl); c.fill();
      c.strokeStyle = T.ink(0.3 + 0.6 * gl); c.lineWidth = 1 + 0.6 * gl; c.stroke();
    }
    if (!showNotes(now)) return;
    const list = noteList(), b = nearestIdx(list, fs());
    for (let ring = 0; ring < 3; ring++) {
      for (let s = 0; s < n; s++) {
        const note = list[b + ring * n + s];
        if (note == null) continue;              // за 1760 Гц — без подписи
        const p = cellCenter(ring, s, n), x = g.cx + p.x * g.r, y = g.cy + p.y * g.r;
        c.fillStyle = 'rgba(0,0,0,0.6)'; c.beginPath(); c.arc(x, y, 9, 0, Math.PI * 2); c.fill();
        T.mapText(noteName(F_MIN * 2 ** (note / 12)), x, y, 10, 0.5, 'center');
      }
    }
  }
  function drawBows(g) {
    const c = T.g;
    // закреплённый смычок — гравированный скрипичный смычок по касательной к пластине: трость, волос, колодочка;
    // волос дрожит, пока звучит; «дыхание» — волос пунктиром
    let e = 0;
    for (let k = 0; k < 24; k++) e += engine.energy[k];
    const shake = Math.min(1, Math.sqrt(e) * 2);
    for (const b of plate.bows) {
      const p = fromPlate(b, g), th = Math.hypot(b.x, b.y) > 0.02 ? Math.atan2(b.y, b.x) : 0;
      c.save(); c.translate(p.x, p.y); c.rotate(th + Math.PI / 2);   // x — вдоль касательной, −y — наружу
      c.strokeStyle = T.BG; c.lineWidth = 5;                          // тёмная подложка — смычок читается поверх песка
      c.beginPath(); c.moveTo(-15, -1); c.quadraticCurveTo(0, -8, 15, -1); c.moveTo(-13, 0.5); c.lineTo(14, 0.5); c.stroke();
      c.strokeStyle = T.ink(0.9); c.lineWidth = 1.3;
      c.beginPath(); c.moveTo(-15, -1); c.quadraticCurveTo(0, -8, 15, -1); c.stroke();   // трость
      c.lineWidth = 1; c.beginPath(); c.moveTo(15, -1); c.lineTo(14, 0.5); c.stroke();   // головка
      c.strokeRect(-16.5, -4, 4, 4.5);                                                   // колодочка
      if (b.exciter >= 0.5) c.setLineDash([1.5, 2]);
      const j = (Math.random() - 0.5) * 2 * shake;
      c.strokeStyle = T.ink(0.7); c.beginPath(); c.moveTo(-13, 0.5); c.lineTo(0, 0.5 + j); c.lineTo(14, 0.5); c.stroke();   // волос
      c.restore();
    }
    for (const f of touches.values()) if (f.bowing) T.ring(f.x, f.y, 26, 0.35, 1);   // живой смычок под пальцем
  }
  function flash(t, x, y, now) {                 // запись в гнездо — расходящийся круг, полсекунды
    const k = (now - t) / 500;
    if (k >= 0 && k < 1) T.ring(x, y, 5 + 16 * k, 0.9 * (1 - k), 1.4);
  }
  // астролябия: двойные кольца с засечками гнёзд, удары ритма — точки, ноты мелодии — засечки внутрь по высоте;
  // стрелки — пока часы идут; выступы длины; ▶/■ и ● внизу; метки ударов на пластине вспыхивают на своём шаге
  function drawAstro(g, now) {
    const c = T.g, A = astro(g), stepMs = 60000 / seq.bpm / 4, grid = S.grid, stepRec = S.stepRec;
    for (const R of [A.R1, A.R2]) { T.ring(g.cx, g.cy, R, 0.6, 1.1); T.ring(g.cx, g.cy, R + 2.5, 0.2, 1); }
    c.lineWidth = 1;
    const tr = (ringTurn.rhythm * Math.PI) / 180, tm = (ringTurn.melody * Math.PI) / 180;
    // узор колец — шкала, как у лимба астролябии: мелкие деления и звезда-указатель; крутится вместе с кольцом
    for (const [R, o, side] of [[A.R2, ringOrn.rhythm + ringTurn.rhythm, 1], [A.R1 - 11, ringOrn.melody + ringTurn.melody, -1]]) {
      const base = (o * Math.PI) / 180;
      c.strokeStyle = T.ink(0.22); c.lineWidth = 0.8; c.beginPath();
      for (let j = 0; j < 64; j++) {
        const a = base + (j * Math.PI) / 32, l = j % 4 ? 2.5 : 4;
        c.moveTo(g.cx + Math.cos(a) * (R + side * 3), g.cy + Math.sin(a) * (R + side * 3));
        c.lineTo(g.cx + Math.cos(a) * (R + side * (3 + l)), g.cy + Math.sin(a) * (R + side * (3 + l)));
      }
      c.stroke();
      for (let q = 0; q < 1; q++) {                 // звезда-указатель — между гнёздами; показывает, насколько кольцо провернули
        const a = base - Math.PI / 2 + Math.PI / 16 + (side < 0 ? Math.PI : 0), px = g.cx + Math.cos(a) * (R + side * 10), py = g.cy + Math.sin(a) * (R + side * 10);
        const ux = Math.cos(a) * 4 * side, uy = Math.sin(a) * 4 * side, vx = -Math.sin(a) * 2, vy = Math.cos(a) * 2;
        c.strokeStyle = T.ink(0.45); c.beginPath();
        c.moveTo(px - ux, py - uy); c.lineTo(px + vx, py + vy); c.lineTo(px + ux, py + uy); c.lineTo(px - vx, py - vy); c.closePath(); c.stroke();
      }
    }
    for (const [ring, R, w] of [['rhythm', A.R2, 16], ['melody', A.R1, 26]]) {   // длина кольца — заливка от начала до края; край тянется
      const rot = ring === 'rhythm' ? tr : tm, len = seq[ring].len, a0 = slotAng(-0.5) + rot, a1 = slotAng(len - 0.5) + rot;
      const held = [...touches.values()].some((f) => f.astro && f.astro.k === 'len' && f.astro.ring === ring);
      c.strokeStyle = T.ink(held ? 0.2 : 0.09); c.lineWidth = w;   // рисуется до бусин и точек — под ними
      c.beginPath(); c.arc(g.cx, g.cy, R, a0, a1 - (len === SLOTS ? 1e-4 : 0)); c.stroke();
      c.strokeStyle = T.ink(held ? 1 : 0.7); c.lineWidth = held ? 2 : 1.4;   // край заливки — за него тянуть
      c.beginPath(); c.moveTo(g.cx + Math.cos(a1) * (R - w / 2), g.cy + Math.sin(a1) * (R - w / 2)); c.lineTo(g.cx + Math.cos(a1) * (R + w / 2), g.cy + Math.sin(a1) * (R + w / 2)); c.stroke();
      const q = { x: g.cx + Math.cos(a1 + 0.09) * R, y: g.cy + Math.sin(a1 + 0.09) * R };
      T.mapText(String(len), q.x, q.y, 12, held ? 1 : 0.6, 'center');
    }
    // ритм: удар — крупная точка, пустое гнездо — колечко; мелодия — название ноты у гнезда, пусто — «·»;
    // играющий шаг мигает (точка и нота вспыхивают), новое в гнезде — расходящийся круг
    const blink = (t) => Math.max(0, 1 - (now - t) / 220), notes = notesOf(seq.melody.steps);
    for (let i = 0; i < SLOTS; i++) {
      let a = slotAng(i) + tr, x = Math.cos(a), y = Math.sin(a);
      const onR = i < seq.rhythm.len, onM = i < seq.melody.len, st = seq.rhythm.steps[i], s = notes[i];
      const lg = i % grid === 0 ? 7 : 4;          // доли сетки записи — засечки длиннее
      c.strokeStyle = T.ink(onR ? 0.45 : 0.12); c.lineWidth = 1;
      c.beginPath(); c.moveTo(g.cx + x * (A.R2 + 8), g.cy + y * (A.R2 + 8)); c.lineTo(g.cx + x * (A.R2 + 8 + lg), g.cy + y * (A.R2 + 8 + lg)); c.stroke();
      const rx = g.cx + x * A.R2, ry = g.cy + y * A.R2, br = blink(pulse.r[i]);
      if (st && onR) {
        const ch = st.chance ?? 1;                 // шанс < 100 % — точка меньше и бледнее, вокруг пунктир
        T.dot(rx, ry, (5.5 + 3 * br) * (0.55 + 0.45 * ch), 0.45 + 0.55 * ch); if (br) T.ring(rx, ry, 10 + 6 * (1 - br), br, 1.6);
        if (ch < 1) { c.save(); c.setLineDash([1.5, 2.5]); T.ring(rx, ry, 8, 0.6, 1); c.restore(); }
      }
      else if (onR) { c.fillStyle = T.BG; c.beginPath(); c.arc(rx, ry, 3.5, 0, Math.PI * 2); c.fill(); T.ring(rx, ry, 3.5, 0.6, 1.1); }
      else T.dot(rx, ry, 1, 0.12);                 // за длиной кольца — гаснет
      flash(born.r[i], rx, ry, now);
      a = slotAng(i) + tm; x = Math.cos(a); y = Math.sin(a);
      const mx = g.cx + x * A.R1, my = g.cy + y * A.R1, bm = blink(pulse.m[i]);
      if (!onM) T.dot(mx, my, 1, 0.12);            // за длиной кольца — гаснет, подписи нет
      else {
        c.fillStyle = 'rgba(0,0,0,0.85)'; c.beginPath(); c.arc(mx, my, 11, 0, Math.PI * 2); c.fill();   // тёмная подложка — читается поверх волн
        if (s != null) T.mapText(noteName(F_MIN * 2 ** (s / 12)), mx, my, 14 + 4 * bm, 1, 'center');
        else T.dot(mx, my, 2, 0.6);
        T.ring(mx, my, 11, 0.25 + 0.75 * bm, 1 + 0.6 * bm);
      }
      flash(born.m[i], mx, my, now);
    }
    if (seq.playing && lastStep) {               // стрелки: от края стола к своему кольцу, плавно между тиками
      const fr = clamp((now - lastStep.atMs) / stepMs);
      for (const [i, R, a] of [[lastStep.r, A.R2 + 6, 0.6], [lastStep.m, A.R1 - 12, 0.45]]) {
        const ang = slotAng(i + fr);
        c.strokeStyle = T.ink(a); c.lineWidth = 0.8;
        c.beginPath(); c.moveTo(g.cx + Math.cos(ang) * (g.rMax + 2), g.cy + Math.sin(ang) * (g.rMax + 2)); c.lineTo(g.cx + Math.cos(ang) * R, g.cy + Math.sin(ang) * R); c.stroke();
      }
    }
    for (let i = 0; i < SLOTS; i++) {            // метки мест мелодии на пластине; вспыхивает та, по которой бьёт удар
      const st = seq.melody.steps[i];
      if (!st) continue;
      const p = fromPlate(st, g), hot = seq.playing && lastStep && lastStep.m === i && seq.rhythm.steps[lastStep.r] && now - lastStep.atMs < 160;
      if (hot) T.ring(p.x, p.y, 7, 0.9, 1.2);
      T.dot(p.x, p.y, 2.2, i < seq.melody.len ? 0.8 : 0.25);
    }
    // ▶/■ и ●
    for (const x of [A.playX, A.recX, A.gridX, A.driftX]) {
      c.fillStyle = 'rgba(0,0,0,0.88)'; c.beginPath(); c.arc(x, A.ty, 18, 0, Math.PI * 2); c.fill();
      T.ring(x, A.ty, 17, 0.45, 1.2);
    }
    {                                              // луна на орбите вокруг пластины: ширина орбиты — глубина, место на ней и фаза — где сейчас пластина в качании
      const x0 = A.driftX, y0 = A.ty, a = drift.on ? 0.95 : 0.45, ph = drift.on ? clamp(drift.k / Math.max(1, driftDepth()), -1, 1) : 0.6;
      const ox = 6 + 8 * drift.depth, oy = ox * 0.5, r = 3.4;
      c.setLineDash([1.5, 2.5]); c.strokeStyle = T.ink(a * 0.5); c.lineWidth = 1; c.beginPath(); c.ellipse(x0, y0, ox, oy, 0, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
      T.dot(x0, y0, 1.6, a * 0.7);                                       // пластина
      const x = x0 + ph * ox, y = y0 - Math.sqrt(Math.max(0, 1 - ph * ph)) * oy;
      c.fillStyle = 'rgba(0,0,0,1)'; c.beginPath(); c.arc(x, y, r + 1.5, 0, Math.PI * 2); c.fill();
      T.ring(x, y, r, a, 1);
      c.fillStyle = T.ink(a * 0.8); c.beginPath(); c.arc(x, y, r, -Math.PI / 2, Math.PI / 2); c.ellipse(x, y, Math.abs(ph) * r, r, 0, Math.PI / 2, -Math.PI / 2, ph > 0); c.fill();
      if (drift.on && drift.shape >= 0.5) { T.dot(x0 - 11, y0 - 10, 1.2, 0.7); T.dot(x0 + 11, y0 - 10, 1.2, 0.7); }   // random — две звёздочки
    }
    {                                              // подписи под кнопками — тихо, латынью
      const cy = A.ty + 30;
      T.mapText(`${seq.bpm} bpm`, A.playX, cy, 12, 0.5, 'center');
      if (!stepRec) T.mapText(seq.playing ? 'scribe' : 'per gradus', A.recX, cy, 12, seq.rec ? 0.85 : 0.5, 'center');
      T.mapText('grid', A.gridX, cy, 12, 0.5, 'center');
      T.mapText(drift.on ? `luna ±${driftDepth()}` : 'luna', A.driftX, cy, 12, drift.on ? 0.75 : 0.5, 'center');
    }
    if (stepRec) {                                 // запись по шагам: курсоры на обоих кольцах, подпись
      const pr = slotXY(g, stepRec.r, A.R2), pm = slotXY(g, stepRec.m, A.R1);
      T.ring(pr.x, pr.y, 12, 0.9, 1.4); T.ring(pm.x, pm.y, 15, 0.9, 1.4);
      T.mapText(`step ${stepRec.r + 1} · ${stepRec.m + 1}`, A.recX, A.ty + 30, 13, 0.75, 'center');
    }
    if (chanceEdit && now < chanceEdit.until && seq.rhythm.steps[chanceEdit.i]) {
      const p = slotXY(g, chanceEdit.i, A.R2 + 26);
      T.mapText(`chance ${Math.round((seq.rhythm.steps[chanceEdit.i].chance ?? 1) * 100)}%`, p.x, p.y, 13, 0.9, 'center');
    }
    c.strokeStyle = T.ink(0.85); c.lineWidth = 1.2; c.beginPath();
    if (seq.playing) c.rect(A.playX - 5, A.ty - 5, 10, 10);
    else { c.moveTo(A.playX - 4, A.ty - 6); c.lineTo(A.playX + 5, A.ty); c.lineTo(A.playX - 4, A.ty + 6); c.closePath(); }
    c.stroke();
    if (seq.rec) T.dot(A.recX, A.ty, 5, 0.95); else if (stepRec) { T.ring(A.recX, A.ty, 5, 0.95, 1.4); T.dot(A.recX, A.ty, 2, 0.95); } else T.ring(A.recX, A.ty, 5, 0.6, 1.2);
    T.mapText(String(16 / grid), A.gridX, A.ty, 15, 0.8, 'center');   // сетка записи: 16, 8, 4
    if (now < bpmUntil) T.mapText(`${seq.bpm} BPM`, A.playX, A.ty - 30, 14, 0.85, 'center');
    if (noteEdit && now < noteEdit.until) {      // тянешь засечку мелодии — гнездо обведено, нота у гнезда меняется
      const p = slotXY(g, noteEdit.i, A.R1);
      T.ring(p.x, p.y, 13, 0.9, 1.4);
    }
  }
  function drawTwist(now) {
    if (!twistLabel || now > twistLabel.until) return;
    T.mapText(twistLabel.text, twistLabel.x, twistLabel.y - 44, 16, 0.9 * Math.min(1, (twistLabel.until - now) / 400), 'center');
  }
  function drawLabel(g, now) {
    if (now > labelUntil) return;
    const a = Math.min(1, (labelUntil - now) / 400);
    T.mapText(`${noteName(plate.f0)} · ${Math.round(plate.f0)} Hz`, g.cx, g.cy - g.rMax - 50, 15, 0.85 * a, 'center');
  }
  function drawRingHeld() {
    const f = ringF, m = f.menu;
    T.drawRing({
      cx: m.cx, cy: m.cy, span: m.span, sectors: m.sectors, sel: m.sector ? m.sector.key : null, get: m.get,
      pointer: m.sector ? { x: m.cx + (f.x - m.gx), y: m.cy + (f.y - m.gy) } : null,
      readout: m.sector ? `${m.sector.label} · ${m.text(m.sector.key)}` : null, readoutAt: T.readoutAt(m.cx, m.cy),
    });
  }

  // резонатор Гельмгольца: латунный шар с горлышком, выступает из правого нижнего угла на четверть;
  // настроен на основной тон пластины: звучит мода (0,1) — линии ярче, у горлышка дрожит воздух
  function drawResonator() {
    const g = T.g, x = T.W, y = T.H - T.safeBot, L = Math.min(1, Math.sqrt(engine.energy[0]) * 2), a = 0.45 + 0.4 * L;
    g.fillStyle = T.BG; g.beginPath(); g.arc(x, y, 36, 0, Math.PI * 2); g.fill();
    T.ring(x, y, 34, a, 1);
    T.ring(x, y, 30, a * 0.5, 0.8);
    g.strokeStyle = T.ink(a * 0.35); g.lineWidth = 0.8;   // штриховка дугами — объём шара
    for (let k = 1; k <= 5; k++) { g.beginPath(); g.arc(x + k * 2, y + k * 2, 30 - k * 4, Math.PI, Math.PI * 1.5); g.stroke(); }
    // горлышко — к центру экрана (вверх-влево)
    const dx = -Math.SQRT1_2, dy = -Math.SQRT1_2, px = Math.SQRT1_2, py = -Math.SQRT1_2, w = 5, n0 = 33, n1 = 50;
    g.strokeStyle = T.ink(a); g.lineWidth = 1;
    g.beginPath();
    for (const s of [-1, 1]) { g.moveTo(x + dx * n0 + px * w * s, y + dy * n0 + py * w * s); g.lineTo(x + dx * n1 + px * w * s, y + dy * n1 + py * w * s); }
    g.stroke();
    g.beginPath(); g.ellipse(x + dx * n1, y + dy * n1, w, w * 0.45, Math.atan2(py, px), 0, Math.PI * 2); g.stroke();
    const ak = (performance.now() - answerAt) / 1400;   // отозвался своей нотой — подпись проступает на шаре
    if (ak >= 0 && ak < 1) { T.ring(x, y, 38 + 8 * ak, 0.5 * (1 - ak), 1); T.mapText(answerNote, x - 18, y - 16, 15, 0.95 * (1 - ak), 'center'); }
    for (let k = 1; k <= 2; k++) {                     // воздух в горлышке — дуги у устья, видны, пока звучит
      if (L < 0.03) break;
      g.strokeStyle = T.ink(L * (0.5 - 0.2 * k)); g.beginPath();
      g.arc(x + dx * n1, y + dy * n1, w + 4 * k, Math.PI * 0.95, Math.PI * 1.55); g.stroke();
    }
  }

  // ---------- фон: волны и интерференция ----------
  // из угла резонатора и из противоположного угла расходятся тонкие круги; шаг — длина волны основного тона пластины
  // (больше пластина, ниже звук — реже). Рисуется один раз и пересобирается, когда высота сместится на полутон
  let wavesC = null, wavesKey = '';
  const waveStep = () => 24 * (F_MIN * 2 ** (Math.round(fs()) / 12) / 110) ** (-1 / 3);
  function wavesLayer() {
    const key = `${T.W}x${T.H}x${T.DPR}|${Math.round(fs())}|${T.topY}|${T.safeBot}`;
    if (wavesC && key === wavesKey) return wavesC;
    wavesKey = key;
    if (!wavesC) wavesC = document.createElement('canvas');
    wavesC.width = Math.round(T.W * T.DPR); wavesC.height = Math.round(T.H * T.DPR);
    const x = wavesC.getContext('2d'), step = waveStep(), far = Math.hypot(T.W, T.H);
    x.setTransform(T.DPR, 0, 0, T.DPR, 0, 0);
    x.fillStyle = T.BG; x.fillRect(0, 0, T.W, T.H);
    x.strokeStyle = T.ink(0.045); x.lineWidth = 0.8;
    for (const [sx, sy] of [[T.W, T.H - T.safeBot], [0, T.topY]]) {
      x.beginPath();
      for (let r = step; r < far; r += step) { x.moveTo(sx + r, sy); x.arc(sx, sy, r, 0, Math.PI * 2); }
      x.stroke();
    }
    return wavesC;
  }

  function draw(now, dt) {
    const c = T.g, g = plateGeo();
    c.drawImage(wavesLayer(), 0, 0, T.W, T.H);   // фон с волнами — одной готовой картинкой
    drawPlate(g);
    shownF0 += (effF0() - shownF0) * (1 - Math.exp(-(dt || 1 / 60) / 0.08));   // пластина плавно доезжает до размера
    drawCells(g, now);
    drawStars(g, now);
    drawAstro(g, now);
    drawCursor(g);
    drawBows(g);
    drawLabel(g, now);
    drawTwist(now);
    drawResonator();
    if (ringF) drawRingHeld();
  }
  function wheel(e) {                            // колесо / щипок тачпада: вверх (развёл) — больше и ниже
    const k = e.ctrlKey ? 0.01 : 0.0025, d = e.deltaMode ? e.deltaY * 16 : e.deltaY;
    const ds = (12 * clamp(d * k, -0.5, 0.5)) / Math.LN2;   // полутонов за щелчок
    if (!T.scaleOn) { setF0(plate.f0 * 2 ** (ds / 12)); return; }
    wheelAcc += (ds * scaleSemis().filter((s) => s < 12).length) / 12;   // с ладом — копим ход, шагаем по ступеням
    const st = Math.trunc(wheelAcc);
    if (st) { wheelAcc -= st; stepScale(fs(), st); }
  }

  return {
    corner: { hit: (f) => Math.hypot(f.x - T.W, f.y - (T.H - T.safeBot)) < 46, draw: drawResonator },
    fx: fxw, tick, draw, down, move, up, wheel, heard, changed, detach,
    geo: plateGeo, astro, litCells, showNotes, waveStep,
    touching: () => touches.size > 0,
    get ringOpen() { return !!ringF; }, get live() { return [...touches.values()].filter((f) => f.bowing).length; },
    get lastStep() { return lastStep; }, get gesture() { return gesture; }, get shownF0() { return shownF0; }, get ringTurn() { return { ...ringTurn }; },
    get stars() { return stars.length; }, get answerAt() { return answerAt; }, get bornM() { return Array.from(born.m); },
  };
}
