// Inferno — модель: девять кругов воронки, общие FX, иней Коцита, буря второго круга. Только данные и алгоритм — без DOM, холста и Web Audio.
// Время — секунды (tick(dt)), случайность — rng, лад — scale { on, snap, pcs }.
// Что должно прозвучать — события слушателям (listen): { t: 'strike', k, vel } — удар по кругу, 'burn' { k } — круг тлеет или гаснет (burning(k)),
// 'tune' { k } — перенастроить резонатор круга, 'color' { k } — сменился цвет шума, 'ice' — иней сдвинулся (перенастроить все), 'fx'.
const TAU = Math.PI * 2;
export const NAMES = ['Limbus', 'Luxuria', 'Gula', 'Avaritia', 'Ira', 'Haeresis', 'Violentia', 'Fraus', 'Proditio'];
export const COLORS = ['white', 'pink', 'brown', 'crackle', 'grain'];
export const PIN_MAX = 4;
export const SPAN = 60 / 9;                             // у каждого круга своя зона ~⅔ октавы: 55–1760 Гц на девять кругов
export const CIRC_KEYS = ['pos', 'sinner', 'color', 'width', 'drive', 'level'];   // что круга сохраняется в снимке
export const FX_DEF = { structure: 0, fire: 0.2, smoke: 0.35, ice: 0, storm: 0.6 };

export function createModel({ scale = { on: false, snap: (s) => s, pcs: null }, rng = Math.random } = {}) {
  const circ = NAMES.map((_, k) => ({ pos: 0.5, sinner: false, held: 0, color: k < 3 ? 0 : k < 6 ? 1 : k < 8 ? 2 : 3, width: 0.5, drive: 0.15 + k * 0.08, level: 0.7, lvl: 0 }));
  const fx = { ...FX_DEF };
  const state = { circ, fx, iceE: 0, stormSemi: 0, stormPh: 0, time: 0 };   // иней растёт постепенно; буря второго круга качает его высоту
  let iceSet = 0, stormAt = 0;
  const listeners = [];
  const emit = (e) => { for (const fn of listeners) fn(e); };

  const semiOf = (k, pos) => { let s = (8 - k) * SPAN + pos * SPAN; if (scale.on) s = scale.snap(Math.round(s)); return s; };
  const hzOf = (k) => 55 * 2 ** ((semiOf(k, circ[k].pos) + (k === 1 ? state.stormSemi : 0)) / 12);
  const Qof = (c) => (4 + (1 - c.width) * 60) * (1 + state.iceE * 8);
  const structName = () => (fx.structure < 1 / 3 ? 'harmonic' : fx.structure < 2 / 3 ? 'scale' : 'metal');
  function ratios(k) {                                  // три полосы резонатора круга
    if (fx.structure < 1 / 3) return [1, 2, 3];        // гармоники: шум поёт нотой
    if (fx.structure < 2 / 3) {                         // лад: шум поёт аккордом — нота, ступень через одну и ещё через одну вверх
      const pcs = scale.pcs, s = Math.round(semiOf(k, circ[k].pos));
      if (!pcs) return [1, 2 ** (3 / 12), 2 ** (7 / 12)];
      const up = []; for (let d = 1; d <= 12 && up.length < 4; d++) if (pcs.includes((((s + d) % 12) + 12) % 12)) up.push(d);
      return [1, 2 ** ((up[1] ?? 3) / 12), 2 ** ((up[3] ?? 7) / 12)];
    }
    return [1, 2.76, 5.4];                              // металл: брусок
  }
  const burning = (k) => circ[k].sinner || circ[k].held > 0;
  const sounding = () => circ.some((c) => c.sinner || c.held > 0);

  // ---------- действия ----------
  function strike(k, vel = 1) { circ[k].lvl = 1; emit({ t: 'strike', k, vel }); }   // удар: всплеск шума звенит в резонаторе круга
  function setPos(k, pos) { circ[k].pos = pos; emit({ t: 'tune', k }); }           // высота внутри зоны круга
  function hold(k, d) { circ[k].held += d; emit({ t: 'burn', k }); }               // палец на круге (+1) / ушёл (−1) — круг тлеет, пока держат
  function pin(k, pos) {                                // двойной тап — грешник: круг горит сам (до PIN_MAX); ещё раз — отпустить
    const c = circ[k];
    if (c.sinner) c.sinner = false;
    else if (circ.filter((q) => q.sinner).length < PIN_MAX) { c.sinner = true; setPos(k, pos); }
    emit({ t: 'burn', k });
    return c.sinner;
  }
  function setCirc(k, key, v) {                         // строка плашки круга: color — номер шума, остальное — 0…1
    const c = circ[k];
    if (key === 'color') { if (v !== c.color) { c.color = v; emit({ t: 'color', k }); } } else { c[key] = v; emit({ t: 'tune', k }); }
  }
  function setFx(k, v) { fx[k] = v; emit({ t: 'fx' }); }
  function loadFx(o) { Object.assign(fx, o); emit({ t: 'fx' }); }
  function clear() { for (let k = 0; k < 9; k++) { circ[k].sinner = false; emit({ t: 'burn', k }); } }
  function dice() {                                     // 2–3 грешника на случайных кругах, случайная structure
    const R = rng;
    for (let k = 0; k < 9; k++) if (circ[k].sinner) { circ[k].sinner = false; emit({ t: 'burn', k }); }
    fx.structure = [0.15, 0.5, 0.85][Math.floor(R() * 3)];
    const n = 2 + Math.floor(R() * 2), ks = [0, 1, 2, 3, 4, 5, 6, 7, 8].sort(() => R() - 0.5).slice(0, n);
    for (const k of ks) { circ[k].sinner = true; circ[k].pos = R(); circ[k].color = Math.floor(R() * 5); emit({ t: 'color', k }); }
    emit({ t: 'fx' });
    for (const k of ks) emit({ t: 'burn', k });
  }
  const snapshot = () => JSON.stringify({ circ: circ.map((q) => ({ pos: q.pos, sinner: q.sinner, color: q.color, width: q.width, drive: q.drive, level: q.level })), fx });
  function restore(js) {
    const st = JSON.parse(js);
    st.circ.forEach((s, k) => { const was = circ[k].color; Object.assign(circ[k], s); if (was !== s.color) emit({ t: 'color', k }); });
    Object.assign(fx, st.fx); emit({ t: 'fx' });
    for (let k = 0; k < 9; k++) emit({ t: 'burn', k });
  }

  function tick(dt) {
    const now = (state.time += dt);
    circ.forEach((c) => {                               // уровень круга (для картинки и надписи): вспыхивает быстро, гаснет медленнее, со льдом — дольше
      const target = c.sinner || c.held > 0 ? c.level : 0;
      c.lvl += (target - c.lvl) * (1 - Math.exp(-dt / (target > c.lvl ? 0.08 : 0.4 + state.iceE * 3)));
    });
    state.iceE += (fx.ice - state.iceE) * (1 - Math.exp(-dt / (fx.ice > state.iceE ? 6 : 3)));   // Коцит замерзает медленно, оттаивает быстрее
    if (Math.abs(state.iceE - iceSet) > 0.02) { iceSet = state.iceE; emit({ t: 'ice' }); }
    if (burning(1) && fx.storm > 0.01) {                // буря второго круга (Luxuria): ветер сам качает его высоту; storm = 0 — выключена
      state.stormPh += dt * (0.11 + 0.06 * Math.sin(now * 0.31));
      state.stormSemi = fx.storm * (5.8 * Math.sin(state.stormPh * TAU) + 2 * Math.sin(state.stormPh * TAU * 2.7 + 1));
      if (now - stormAt > 0.05) { stormAt = now; emit({ t: 'tune', k: 1 }); }   // резонатор второго круга — не чаще раза в 50 мс
    } else state.stormSemi *= 0.9;
  }

  return {
    state, semiOf, hzOf, Qof, ratios, structName, burning, sounding,
    strike, setPos, hold, pin, setCirc, setFx, loadFx, clear, dice, snapshot, restore, tick,
    listen(fn) { listeners.push(fn); },
  };
}
