// Oceanus — картинка и касания: карта T-O, вокруг — Мировой океан, по краю — двенадцать ветров.
// Касание → действие модели (звук не трогает); форма кольца, место луны и уровни голосов — метры engine (только чтение).
import { N, PIN_MAX } from './model.js';

const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const INK = '206,222,226', BGC = '#081018', PAPER = '8,16,24';
const NOTES = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];
const WINDS = ['Septentrio', 'Aquilo', 'Subsolanus', 'Eurus', 'Auster', 'Africus', 'Favonius', 'Corus'];
const CLIMA = ['litus', 'medium', 'Hierusalem'];
const SWAY_TO = ['tension', 'pitch', 'damping'];
const PATHS = ['orbis', 'retro', 'pendulum'];             // путь скана: по кругу, против, туда-обратно
const noteName = (f) => { const m = Math.round(12 * Math.log2(f / 55)); return `${NOTES[((m % 12) + 12) % 12]}${Math.floor((m + 9) / 12) + 1}`; };

// ---------- геометрия: портрет по центру; земля — круг Rd, океан до Ro, рамка ветров Rf ----------
export function geo(T) {
  const W = T.W, H = T.H, top = T.topY + 6, bot = H - T.safeBot - 8, h = bot - top, Ws = Math.min(W, (H - T.safeBot) * 0.62), cx = W / 2, cy = top + h * 0.5;
  const Ro = Math.min(Ws / 2 - 42, h * 0.34), Rd = Ro * 0.62, Rr = (Rd + Ro) / 2 + Ro * 0.04, amp = (Ro - Rd) * 0.42;
  return { W, H, top, bot, cx, cy, Ws, Ro, Rd, Rr, amp, Rf: Ro + 16, sun: { x: 0, y: T.topY + 2, r: Math.min(56, Ws * 0.15) } };
}
export const polar = (G, x, y) => ({ d: Math.hypot(x - G.cx, y - G.cy), a: (Math.atan2(x - G.cx, -(y - G.cy)) + TAU) % TAU });   // угол от верха по часовой
export const at = (G, a, r) => ({ x: G.cx + Math.sin(a) * r, y: G.cy - Math.cos(a) * r });
export const surf = (G, shape, a) => { const p = (a / TAU) * N, i = Math.floor(p), u = p - i; return G.Rr + G.amp * (shape[i % N] * (1 - u) + shape[(i + 1) % N] * u); };
export const moonPos = (G, moon) => at(G, moon * TAU, G.Rf + 22);

export function createView(T, model, engine) {
  const { voices, fx, luna } = model.state, hzOf = model.hz, f0 = hzOf;
  const G0 = () => geo(T);

  // ---------- касания ----------
  const touches = new Map();
  let lastTap = null;
  function voiceAt(G, x, y) {
    let best = null, bd = 26;
    for (const v of voices) { const p = at(G, v.ang, v.rn * G.Rd); const d = Math.hypot(x - p.x, y - p.y); if (d < bd) { bd = d; best = v; } }
    return best;
  }
  function down(f) {
    const G = G0(), P = polar(G, f.x, f.y), now = performance.now(), mp = moonPos(G, engine.moon);
    if (Math.hypot(f.x - mp.x, f.y - mp.y) < 26) { touches.set(f.id, { kind: 'moon', t0: now }); return; }   // луна: держишь — её плашка
    if (P.d < G.Rd - 2) {                                  // земля: города-голоса
      const near = voiceAt(G, f.x, f.y);
      if (near && near.pinned) {
        if (lastTap && lastTap.v === near && now - lastTap.t < T.DTAP_MS) { lastTap = null; model.dropVoice(near); touches.set(f.id, { kind: 'none' }); return; }   // двойной тап по оставленному — отпустить
        lastTap = { v: near, t: now };
        touches.set(f.id, { kind: 'voice', v: near, x0: f.x, y0: f.y, t0: now, moved: false });
        return;
      }
      const rn = clamp(P.d / G.Rd, 0, 0.98);
      if (lastTap && !lastTap.v && now - lastTap.t < T.DTAP_MS && Math.hypot(f.x - lastTap.x, f.y - lastTap.y) < 34 && voices.filter((v) => v.pinned).length < PIN_MAX) {
        lastTap = null; model.addVoice(P.a, rn, true); touches.set(f.id, { kind: 'none' }); return;   // двойной тап — город остаётся и звучит
      }
      lastTap = { x: f.x, y: f.y, t: now };
      const v = model.addVoice(P.a, rn, false);
      touches.set(f.id, v ? { kind: 'voice', v, temp: true, x0: f.x, y0: f.y, t0: now, moved: false } : { kind: 'none' });
      return;
    }
    if (P.d < G.Rf + 8) {                                  // вода: тянешь к пальцу; быстрый тап — всплеск
      touches.set(f.id, { kind: 'water', t0: now, x0: f.x, y0: f.y, moved: false });
      pushTo(f.id, G, P);
      return;
    }
    touches.set(f.id, { kind: 'none' });
  }
  function pushTo(id, G, P) { model.push(id, P.a / TAU, clamp((P.d - G.Rr) / G.amp, -2.5, 2.5)); }
  function move(f) {
    const t = touches.get(f.id);
    if (!t || t.kind === 'none' || t.sheet) return;
    const G = G0();
    if (Math.hypot(f.x - t.x0, f.y - t.y0) > 8) t.moved = true;
    if (t.kind === 'water') { pushTo(f.id, G, polar(G, f.x, f.y)); return; }
    if (t.kind === 'voice' && t.moved) {                   // ведёшь город — нота
      const P = polar(G, f.x, f.y);
      model.moveVoice(t.v, P.a, clamp(P.d / G.Rd, 0, 0.98));
    }
  }
  function up(f) {
    const t = touches.get(f.id);
    touches.delete(f.id);
    if (!t) return;
    if (t.kind === 'water') {
      model.release(f.id);
      if (!t.moved && performance.now() - t.t0 < 220) { const G = G0(), P = polar(G, t.x0, t.y0); model.splash(P.a / TAU, P.d > G.Rr ? 0.35 : -0.35); ripple(t.x0, t.y0, 1); }
      else if (t.moved) ripple(f.x, f.y, 0.5);
    }
    if (t.kind === 'voice' && t.temp && voices.includes(t.v)) model.dropVoice(t.v);
  }
  function lunaSheet() {
    T.openSheet({
      title: 'luna', hint: 'the moon — tap outside to close',
      rows: [{ key: 'orbit', label: 'orbit' }, { key: 'storm', label: 'shape' }, { key: 'pull', label: 'pull' }, { key: 'sway', label: 'sway' }, { key: 'to', label: 'sway to' }],
      get: (k) => (k === 'pull' ? fx.tide : k === 'to' ? (luna.to + 0.5) / 3 : luna[k]),
      set: (k, v) => { if (k === 'pull') model.setFx('tide', v); else if (k === 'storm') model.setLuna({ storm: v >= 0.5 ? 1 : 0 }); else if (k === 'to') model.setLuna({ to: Math.min(2, Math.floor(v * 3)) }); else model.setLuna({ [k]: v }); },
      text: (k) => (k === 'orbit' ? `${(1 / (0.005 * 40 ** luna.orbit)).toFixed(0)} s` : k === 'storm' ? (luna.storm ? 'storm' : 'sine') : k === 'to' ? SWAY_TO[luna.to] : k === 'sway' && luna.sway < 0.01 ? 'off' : `${Math.round((k === 'pull' ? fx.tide : luna[k]) * 100)}%`),
    });
  }
  function voiceSheet(v) {
    T.openSheet({
      title: 'civitas', hint: 'city — tap outside to close',
      rows: [{ key: 'lvl', label: 'level' }, { key: 'oct', label: 'octave' }, { key: 'path', label: 'path' }],
      get: (k) => (k === 'oct' ? (v.oct + 1) / 2 : k === 'path' ? v.path / 2 : v.lvl),
      set: (k, x) => model.setVoice(v, k === 'oct' ? { oct: Math.round(x * 2) - 1 } : k === 'path' ? { path: Math.round(x * 2) } : { lvl: x }),
      text: (k) => (k === 'oct' ? ['octave −1', 'octave 0', 'octave +1'][v.oct + 1] : k === 'path' ? PATHS[v.path] : `${Math.round(v.lvl * 100)}%`),
    });
  }
  function tick(now) {
    for (const t of touches.values()) if (t.kind === 'moon' && !t.sheet && now - t.t0 > T.HOLD_MS * 0.6) { t.sheet = true; lunaSheet(); }
    for (const t of touches.values()) if (t.kind === 'voice' && !t.temp && !t.moved && !t.sheet && now - t.t0 > T.HOLD_MS) { t.sheet = true; voiceSheet(t.v); }   // держишь оставленный город — плашка
  }

  // ---------- рисование ----------
  let wallC = null, wallKey = '';
  const ink = (a) => `rgba(${INK},${a})`;
  function wall(G) {                                      // рамка ветров с румбами, земля T-O с климатами, деления нот по краю земли
    const pcs = T.scalePCs, key = `${G.W}x${G.H}x${T.DPR}|${G.cy}|${pcs ? pcs.join(',') : '-'}|${model.root()}`;
    if (wallC && key === wallKey) return wallC;
    wallKey = key;
    wallC = document.createElement('canvas');
    wallC.width = Math.round(G.W * T.DPR); wallC.height = Math.round(G.H * T.DPR);
    const x = wallC.getContext('2d');
    x.setTransform(T.DPR, 0, 0, T.DPR, 0, 0);
    x.fillStyle = BGC; x.fillRect(0, 0, G.W, G.H);
    const { cx, cy, Rf, Rd } = G;
    x.lineWidth = 1;
    x.strokeStyle = ink(0.07); x.beginPath();               // румбы портолана — из центра и с 16 точек рамки
    for (let k = 0; k < 16; k++) { const a = (k / 16) * TAU, p = at(G, a, Rf); x.moveTo(cx, cy); x.lineTo(p.x, p.y); for (let j = k + 3; j < k + 14; j += 5) { const q = at(G, (j / 16) * TAU, Rf); x.moveTo(p.x, p.y); x.lineTo(q.x, q.y); } }
    x.stroke();
    x.strokeStyle = ink(0.6); x.beginPath(); x.arc(cx, cy, Rf, 0, TAU); x.stroke();
    x.strokeStyle = ink(0.25); x.beginPath(); x.arc(cx, cy, Rf - 4, 0, TAU); x.stroke();
    x.strokeStyle = ink(0.4); x.beginPath();
    for (let k = 0; k < 32; k++) { const a = (k / 32) * TAU, l = k % 4 ? 2.5 : 5, p = at(G, a, Rf), q = at(G, a, Rf + l); x.moveTo(p.x, p.y); x.lineTo(q.x, q.y); }
    x.stroke();
    x.fillStyle = BGC; x.beginPath(); x.arc(cx, cy, Rd, 0, TAU); x.fill();                 // земля
    x.strokeStyle = ink(0.75); x.beginPath(); x.arc(cx, cy, Rd, 0, TAU); x.stroke();
    x.strokeStyle = ink(0.16); x.setLineDash([2, 4]);                                         // климаты — октавы
    for (const k of [1 / 3, 2 / 3]) { x.beginPath(); x.arc(cx, cy, Rd * k, 0, TAU); x.stroke(); }
    x.setLineDash([]);
    x.strokeStyle = ink(0.5); x.beginPath();                                                  // T: Танаис — Нил поперёк, Средиземное море вниз
    x.moveTo(cx - Rd, cy); x.lineTo(cx + Rd, cy); x.moveTo(cx, cy); x.lineTo(cx, cy + Rd); x.stroke();
    x.strokeStyle = ink(0.6); x.beginPath(); x.arc(cx, cy, 3, 0, TAU); x.stroke();          // Иерусалим — пуп земли
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = `italic 11px ${T.MAP}`; x.fillStyle = ink(0.42);                                // воды буквы T: Танаис и Нил — поперёк, Великое море — вниз
    x.fillText('Tanais', cx - Rd * 0.5, cy - 8); x.fillText('Nilus', cx + Rd * 0.5, cy - 8);
    x.save(); x.translate(cx + 8, cy + Rd * 0.55); x.rotate(Math.PI / 2); x.fillText('Mare Magnum', 0, 0); x.restore();
    x.font = `italic 10px ${T.MAP}`; x.fillStyle = ink(0.26);                                // части света — по сыновьям Ноя
    x.fillText('Sem', cx - Rd * 0.42, cy - Rd * 0.3); x.fillText('Iafeth', cx - Rd * 0.42, cy + Rd * 0.62); x.fillText('Cham', cx + Rd * 0.42, cy + Rd * 0.62);
    x.fillText('Hierusalem', cx, cy + 11);
    const py = cy - Rd * 0.68, pr = Math.max(7, Rd * 0.07);                                   // земной рай на востоке (наверху): ограда и четыре реки
    x.strokeStyle = ink(0.55); x.beginPath(); x.arc(cx, py, pr, 0, TAU); x.stroke();
    x.strokeStyle = ink(0.25); x.beginPath(); x.arc(cx, py, pr - 2.5, 0, TAU); x.stroke();
    x.strokeStyle = ink(0.35); x.beginPath();
    for (const a of [-0.9, -0.3, 0.3, 0.9]) { const sx = cx + Math.sin(a) * pr, sy = py + Math.cos(a) * pr; x.moveTo(sx, sy); x.quadraticCurveTo(sx + Math.sin(a) * 10, sy + 8, sx + Math.sin(a) * 16, sy + 16 + Math.abs(a) * 4); }
    x.stroke();
    x.fillStyle = ink(0.4); x.fillText('Paradisus', cx, py + pr + 27);
    for (let k = 0; k < 12; k++) {                        // полутоны по краю земли; ступени лада — длиннее
      const pc = (k + model.root()) % 12, inScale = !pcs || pcs.includes(pc), a = (k / 12) * TAU, p = at(G, a, Rd), q = at(G, a, Rd - (inScale ? 7 : 3));
      x.strokeStyle = ink(inScale ? 0.55 : 0.22); x.beginPath(); x.moveTo(p.x, p.y); x.lineTo(q.x, q.y); x.stroke();
    }
    return wallC;
  }
  const ripples = [], foam = Array.from({ length: 44 }, (_, i) => ({ a: Math.random() * TAU, lane: 0.2 + 0.7 * Math.random(), dir: i % 2 ? 1 : -1, len: 0.03 + Math.random() * 0.05 }));
  let foamT = 0, shape = engine.shape;                    // форма кольца — снимок метра engine на кадр
  const sf = (G, a) => surf(G, shape, a);
  function ripple(x, y, k) { ripples.push({ x, y, t: performance.now(), k }); if (ripples.length > 12) ripples.shift(); }
  function drawCurrents(c, G, now) {                      // течения: пена бежит по кругу двумя потоками — быстрее с натяжением; круги от всплесков
    const dt = foamT ? Math.min(0.1, (now - foamT) / 1000) : 0, w = 0.05 + 0.35 * fx.tension;
    foamT = now;
    c.lineWidth = 0.8;
    for (const f of foam) {
      f.a = (f.a + f.dir * w * dt * (0.6 + f.lane) + TAU) % TAU;
      const r = G.Rd + (sf(G, f.a) - G.Rd) * f.lane, al = 0.1 + 0.25 * f.lane + 0.25 * fx.wind;
      c.strokeStyle = ink(al); c.beginPath(); c.arc(G.cx, G.cy, r, f.a - Math.PI / 2, f.a - Math.PI / 2 + f.len * f.dir, f.dir < 0); c.stroke();
    }
    for (let i = ripples.length - 1; i >= 0; i--) {
      const q = ripples[i], k = (now - q.t) / 1300;
      if (k >= 1) { ripples.splice(i, 1); continue; }
      c.strokeStyle = ink(0.5 * (1 - k) * q.k); c.lineWidth = 1;
      for (const m of [1, 0.6]) { c.beginPath(); c.arc(q.x, q.y, 4 + 30 * k * m, 0, TAU); c.stroke(); }
    }
  }
  function drawReflection(c, G, now) {                    // луна отражается в воде: дрожащие штрихи под поверхностью, по форме кольца
    if (fx.tide < 0.03) return;
    const ma = engine.moon * TAU, r0 = sf(G, ma);
    c.lineWidth = 1;
    for (let j = 0; j < 5; j++) {
      const r = r0 - 6 - j * 5, wob = Math.sin(now * 0.004 + j * 1.7) * 0.02 + (shape[Math.floor((ma / TAU) * N + j) % N] || 0) * 0.03, half = (0.07 - j * 0.011) * (0.6 + 0.4 * fx.tide);
      if (r < G.Rd + 3) break;
      c.strokeStyle = ink((0.4 - j * 0.06) * Math.min(1, fx.tide * 1.5)); c.beginPath(); c.arc(G.cx, G.cy, r, ma + wob - half - Math.PI / 2, ma + wob + half - Math.PI / 2); c.stroke();
    }
  }
  function drawOcean(c, G, now) {                         // вода: поверхность — форма кольца, две линии штриховки следуют за ней
    drawCurrents(c, G, now); drawReflection(c, G, now);
    const M = 96;
    for (const [k, al] of [[1, 0.85], [0.66, 0.3], [0.33, 0.18]]) {
      c.strokeStyle = ink(al); c.lineWidth = k === 1 ? 1.2 : 0.8; c.beginPath();
      for (let i = 0; i <= M; i++) { const a = (i / M) * TAU, r = G.Rd + (sf(G, a) - G.Rd) * k, p = at(G, a, r); i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y); }
      c.closePath(); c.stroke();
    }
    c.strokeStyle = ink(0.22); c.lineWidth = 0.8; c.beginPath();   // гребешки волн: короткие штрихи там, где вода круче
    for (let i = 0; i < N; i++) {
      const d = shape[(i + 1) % N] - shape[i], a = ((i + 0.5) / N) * TAU;
      if (Math.abs(d) < 0.06) continue;
      const r = sf(G, a) + 3, p = at(G, a, r), q = at(G, a + Math.sign(d) * 0.05, r + Math.min(6, Math.abs(d) * 30));
      c.moveTo(p.x, p.y); c.lineTo(q.x, q.y);
    }
    c.stroke();
    const ma = engine.moon * TAU, mp = moonPos(G, engine.moon), mr = 5 + 4 * fx.tide;   // луна тянет воду на себя
    if (luna.sway > 0.01) { c.strokeStyle = ink(0.15 + 0.35 * luna.sway); c.lineWidth = 1; c.setLineDash(luna.storm ? [2, 3] : []); c.beginPath(); c.arc(mp.x, mp.y, mr + 4 + 6 * luna.sway * (0.5 + 0.5 * Math.sin(ma)), 0, TAU); c.stroke(); c.setLineDash([]); }   // качание: ореол дышит с луной
    c.fillStyle = ink(0.85); c.beginPath(); c.arc(mp.x, mp.y, mr, 0, TAU); c.fill();
    c.fillStyle = BGC; c.beginPath(); c.arc(mp.x + mr * 0.45, mp.y - mr * 0.2, mr * 0.88, 0, TAU); c.fill();
    if (fx.tide > 0.05) { c.strokeStyle = ink(0.12 + 0.2 * fx.tide); c.setLineDash([2, 5]); c.beginPath(); const q = at(G, ma, sf(G, ma) + 4); c.moveTo(mp.x, mp.y); c.lineTo(q.x, q.y); c.stroke(); c.setLineDash([]); }
    c.font = `italic 10.5px ${T.MAP}`; c.textAlign = 'center'; c.textBaseline = 'middle';   // ветры по кругу: ярче с ветром
    WINDS.forEach((nm, k) => {
      const a = (k / 8) * TAU, p = at(G, a, G.Rf + 10);
      c.save(); c.translate(p.x, p.y); c.rotate(a > Math.PI / 2 && a < Math.PI * 1.5 ? a + Math.PI : a);
      c.fillStyle = ink(0.28 + 0.6 * fx.wind * (0.6 + 0.4 * Math.sin(now * 0.002 + k))); c.fillText(nm, 0, k % 2 ? 0 : 0); c.restore();
    });
  }
  function drawVoices(c, G, now) {
    const gains = engine.gains;
    for (const v of voices) {
      const ph = (now * 0.00025 * Math.sqrt(f0(v) / 55)) % 1, qq = v.path === 1 ? 1 - ph : v.path === 2 ? (ph < 0.5 ? 2 * ph : 2 - 2 * ph) : ph;   // луч скана идёт по своему пути
      const p = at(G, v.ang, v.rn * G.Rd), g = gains[v.slot] || 0, sa = qq * TAU, q = at(G, sa, sf(G, sa));
      c.strokeStyle = ink(0.12 + 0.35 * g); c.lineWidth = 0.8; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(q.x, q.y); c.stroke();   // луч скана: голос читает кольцо по кругу
      if (g > 0.05) T.glowAt(p.x, p.y, 18, g * 0.35);
      c.fillStyle = BGC; c.strokeStyle = ink(0.9); c.lineWidth = 1;
      c.beginPath(); c.arc(p.x, p.y, 6, 0, TAU); c.fill(); c.stroke();
      if (v.pinned) { c.beginPath(); c.arc(p.x, p.y, 9, 0, TAU); c.stroke(); }
      c.beginPath(); c.moveTo(p.x, p.y - 4); c.lineTo(p.x, p.y + 4); c.moveTo(p.x - 4, p.y); c.lineTo(p.x + 4, p.y); c.stroke();   // город: крест в круге
    }
    for (const t of touches.values()) {                   // подписи — только пока трогаешь
      if (t.kind !== 'voice') continue;
      const v = t.v, p = at(G, v.ang, v.rn * G.Rd), f = hzOf(v), zone = v.rn > 2 / 3 ? 0 : v.rn > 1 / 3 ? 1 : 2;
      T.mapText(`${noteName(f)} · ${Math.round(f)} Hz`, p.x, p.y - 26, 14, 0.95, 'center');
      T.mapText(`clima ${CLIMA[zone]}`, p.x, p.y - 12, 11, 0.55, 'center');
    }
  }
  let noSun = false;
  function draw(now) {
    const c = T.g, G = G0();
    shape = engine.shape;
    c.drawImage(wall(G), 0, 0, T.W, T.H);
    drawOcean(c, G, now);
    drawVoices(c, G, now);
    if (!noSun) T.quarterSun(c, G.sun.x, G.sun.y, G.sun.r, 1, now, INK, BGC);
  }

  // ---------- плашка FX, легенда, угол ----------
  const deg = (d) => (d * Math.PI) / 180;
  const fxw = {
    sectors: [
      { key: 'tension', label: 'tension', ang: deg(200) }, { key: 'damping', label: 'damping', ang: deg(170) }, { key: 'tide', label: 'tide', ang: deg(140) },
      { key: 'wind', label: 'wind', ang: deg(110) }, { key: 'hall', label: 'hall', ang: deg(80) },
    ],
    get: (k) => fx[k], set: (k, v) => model.setFx(k, v), text: (k) => `${Math.round(fx[k] * 100)}%`,
    lfo: { keys: ['tension', 'damping', 'tide', 'wind', 'hall'], shapes: 'classic' },
    arc: () => fx.hall, save: () => ({ ...fx }), load: (o) => model.loadFx(o),
  };
  const legend = [['tap', 'touch the land', 'a city sings while you hold it'], ['double', 'double tap the land', 'the city stays (up to four)'],
    ['drag', 'drag a city', 'pitch · clockwise — semitones, inland — octave up'], ['hold', 'hold a staying city', 'its sheet: level, octave'],
    ['drag', 'touch the ocean', 'pull the water · waves run round — the timbre lives'], ['tap', 'quick tap on the water', 'splash'],
    ['hold', 'hold the moon', 'its sheet: orbit, shape, pull, sway — the moon as an LFO'], ['tap', 'tap the sun', 'map of worlds']];
  const corner = { hit: (f) => { const G = G0(); return f.y > G.sun.y && Math.hypot(f.x - G.sun.x, f.y - G.sun.y) < G.sun.r + 6; }, draw: () => {} };   // солнце — карта

  return {
    theme: { ink: INK, bg: BGC, paper: PAPER }, corner, fx: fxw, legend,
    down, move, up, tick, draw, mapShot(on) { noSun = on; },
    get ripples() { return ripples.length; },
  };
}
