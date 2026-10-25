// Inferno — фасад модели. Сама модель живёт в ядре (core/worlds/inferno → t2d.wasm, слот 5 узла t2d-worklet.js хоста), здесь — её зеркало
// и действия касаний. API — прежней JS-модели (эталон — tools/ref/inferno-model.js), без DOM, холста и Web Audio.
// Поля кругов и FX правит только фасад: действие применяется к state сразу (view и плашка читают живые объекты) и уходит в ядро через send
// (порт узла, асинхронно; send → номер сообщения). Из зеркала (~60 раз в секунду) приходит только то, что считает ядро: время, иней iceE,
// буря stormSemi / stormPh и уровень кругов lvl (удар поднимает lvl здесь сразу — зеркало, ещё не видевшее удара, его не опускает).
// События listen — из действий, как у прежней модели; ice и tune второго круга (буря) — по зеркалу, с теми же порогами (0.02, 50 мс).
// Кубик и restore — целиком здесь (кубик — алгоритм эталона на rng), в ядро — одним restore. Что звучит — решает ядро по этим же действиям.
const TAU = Math.PI * 2;
export const NAMES = ['Limbus', 'Luxuria', 'Gula', 'Avaritia', 'Ira', 'Haeresis', 'Violentia', 'Fraus', 'Proditio'];
export const COLORS = ['white', 'pink', 'brown', 'crackle', 'grain'];
export const PIN_MAX = 4;
export const SPAN = 60 / 9;                             // у каждого круга своя зона ~⅔ октавы: 55–1760 Гц на девять кругов
export const CIRC_KEYS = ['pos', 'sinner', 'color', 'width', 'drive', 'level'];   // что круга сохраняется в снимке
export const FX_DEF = { structure: 0, fire: 0.2, smoke: 0.35, ice: 0, storm: 0.6 };
// ядро: слот мира в хосте, коды action, ключи строк плашки и fx, раскладка зеркала — core/worlds/inferno/world.hpp
export const SLOT = 5;
export const ACT = { strike: 0, pos: 1, hold: 2, pin: 3, circ: 4, fx: 5, clear: 6, dice: 7 };
export const SET_KEYS = ['pos', 'width', 'drive', 'level', 'color'];
export const FX_KEYS = Object.keys(FX_DEF);             // structure, fire, smoke, ice, storm
export const HEAD = 4 + FX_KEYS.length, CIRC_N = 8;     // time, iceE, stormSemi, stormPh, fx; на круг: pos, sinner, held, color, width, drive, level, lvl

export function createModel({ scale = { on: false, snap: (s) => s, pcs: null }, rng = Math.random, send = () => 0 } = {}) {
  const circ = NAMES.map((_, k) => ({ pos: 0.5, sinner: false, held: 0, color: k < 3 ? 0 : k < 6 ? 1 : k < 8 ? 2 : 3, width: 0.5, drive: 0.15 + k * 0.08, level: 0.7, lvl: 0 }));
  const fx = { ...FX_DEF };
  const state = { circ, fx, iceE: 0, stormSemi: 0, stormPh: 0, time: 0 };
  let iceSet = 0, stormAt = 0, post = send;
  const lvlAt = new Array(9).fill(0);                   // номер сообщения последнего удара по кругу: пока ядро его не применило, lvl из зеркала не берём
  const listeners = [];
  const emit = (e) => { for (const fn of listeners) fn(e); };
  const act = (kind, i = 0, a = []) => post({ t: 'action', slot: SLOT, kind, i, a });

  const semiOf = (k, pos) => { let s = (8 - k) * SPAN + pos * SPAN; if (scale.on) s = scale.snap(Math.round(s)); return s; };
  const hzOf = (k) => 55 * 2 ** ((semiOf(k, circ[k].pos) + (k === 1 ? state.stormSemi : 0)) / 12);
  const Qof = (c) => (4 + (1 - c.width) * 60) * (1 + state.iceE * 8);
  const structName = () => (fx.structure < 1 / 3 ? 'harmonic' : fx.structure < 2 / 3 ? 'scale' : 'metal');
  function ratios(k) {                                  // три полосы резонатора круга (для картинки; звук считает ядро по тем же правилам)
    if (fx.structure < 1 / 3) return [1, 2, 3];
    if (fx.structure < 2 / 3) {
      const pcs = scale.pcs, s = Math.round(semiOf(k, circ[k].pos));
      if (!pcs) return [1, 2 ** (3 / 12), 2 ** (7 / 12)];
      const up = []; for (let d = 1; d <= 12 && up.length < 4; d++) if (pcs.includes((((s + d) % 12) + 12) % 12)) up.push(d);
      return [1, 2 ** ((up[1] ?? 3) / 12), 2 ** ((up[3] ?? 7) / 12)];
    }
    return [1, 2.76, 5.4];
  }
  const burning = (k) => circ[k].sinner || circ[k].held > 0;
  const sounding = () => circ.some((c) => c.sinner || c.held > 0);

  // ---------- действия ----------
  function strike(k, vel = 1) { circ[k].lvl = 1; lvlAt[k] = act(ACT.strike, k, [vel]); emit({ t: 'strike', k, vel }); }
  function setPos(k, pos) { circ[k].pos = pos; act(ACT.pos, k, [pos]); emit({ t: 'tune', k }); }
  function hold(k, d) { circ[k].held += d; act(ACT.hold, k, [d]); emit({ t: 'burn', k }); }
  function pin(k, pos) {                                // двойной тап — грешник (до PIN_MAX); ещё раз — отпустить. Ядро решает так же, по тем же полям
    const c = circ[k];
    if (c.sinner) c.sinner = false;
    else if (circ.filter((q) => q.sinner).length < PIN_MAX) { c.sinner = true; c.pos = pos; }
    act(ACT.pin, k, [pos]);
    if (c.sinner) emit({ t: 'tune', k });
    emit({ t: 'burn', k });
    return c.sinner;
  }
  function setCirc(k, key, v) {                         // строка плашки круга: color — номер шума, остальное — 0…1
    const c = circ[k];
    if (key === 'color') { if (v !== c.color) { c.color = v; act(ACT.circ, k, [SET_KEYS.indexOf('color'), v]); emit({ t: 'color', k }); } return; }
    c[key] = v; act(ACT.circ, k, [SET_KEYS.indexOf(key), v]); emit({ t: 'tune', k });
  }
  function setFx(k, v) { fx[k] = v; act(ACT.fx, FX_KEYS.indexOf(k), [v]); emit({ t: 'fx' }); }
  function loadFx(o) { for (const [k, v] of Object.entries(o || {})) if (k in fx) { fx[k] = v; act(ACT.fx, FX_KEYS.indexOf(k), [v]); } emit({ t: 'fx' }); }
  function clear() { for (let k = 0; k < 9; k++) { circ[k].sinner = false; emit({ t: 'burn', k }); } act(ACT.clear); }
  const snapshot = () => JSON.stringify({ circ: circ.map((q) => ({ pos: q.pos, sinner: q.sinner, color: q.color, width: q.width, drive: q.drive, level: q.level })), fx });
  const toCore = () => post({ t: 'restore', slot: SLOT, js: snapshot() });
  function dice() {                                     // 2–3 грешника на случайных кругах, случайная structure (как эталон) — и в ядро целиком
    const R = rng;
    for (let k = 0; k < 9; k++) if (circ[k].sinner) { circ[k].sinner = false; emit({ t: 'burn', k }); }
    fx.structure = [0.15, 0.5, 0.85][Math.floor(R() * 3)];
    const n = 2 + Math.floor(R() * 2), ks = [0, 1, 2, 3, 4, 5, 6, 7, 8].sort(() => R() - 0.5).slice(0, n);
    for (const k of ks) { circ[k].sinner = true; circ[k].pos = R(); circ[k].color = Math.floor(R() * 5); emit({ t: 'color', k }); }
    toCore();
    emit({ t: 'fx' });
    for (const k of ks) emit({ t: 'burn', k });
  }
  function restore(js) {
    const st = JSON.parse(js);
    st.circ.forEach((s, k) => { const was = circ[k].color; Object.assign(circ[k], s); if (was !== s.color) emit({ t: 'color', k }); });
    Object.assign(fx, st.fx);
    toCore();
    emit({ t: 'fx' });
    for (let k = 0; k < 9; k++) emit({ t: 'burn', k });
  }

  function sync(m, applied) {                           // зеркало ядра → state; applied — сколько сообщений ядро уже применило
    state.time = m[0]; state.iceE = m[1]; state.stormSemi = m[2]; state.stormPh = m[3];
    for (let k = 0; k < 9; k++) if (applied >= lvlAt[k]) circ[k].lvl = m[HEAD + k * CIRC_N + 7];
    if (Math.abs(state.iceE - iceSet) > 0.02) { iceSet = state.iceE; emit({ t: 'ice' }); }
    if (burning(1) && fx.storm > 0.01 && state.time - stormAt > 0.05) { stormAt = state.time; emit({ t: 'tune', k: 1 }); }
  }
  function bind(fn) {                                   // новый узел ядра (новый контекст): счёт сообщений — заново, сцена и пальцы — туда целиком
    post = fn; lvlAt.fill(0);
    toCore();
    for (let k = 0; k < 9; k++) if (circ[k].held > 0) act(ACT.hold, k, [circ[k].held]);
  }

  return {
    state, semiOf, hzOf, Qof, ratios, structName, burning, sounding,
    strike, setPos, hold, pin, setCirc, setFx, loadFx, clear, dice, snapshot, restore,
    tick() {},                                          // время модели идёт в ядре
    listen(fn) { listeners.push(fn); },
    sync, bind,
  };
}
