// Эталон модели Oceanus: worlds/oceanus/model.js до SDK B (как был; в вебе теперь фасад над ядром). Сверка ядра — tools/ocean-scenarios.mjs.
// Oceanus — модель: города-голоса на земле T-O, общие FX, луна (LFO мира). Только данные и алгоритм — без DOM, холста и Web Audio.
// Форма кольца и место луны считает worklet — их модель не знает (это метры engine). Случайность — rng, лад — scale { on, root, snap }.
// Что должно прозвучать — события слушателям (listen): { t: 'voice', v, on, added? } — город целиком, 'fx' — FX и луна,
// 'push' { id, a, d } / 'release' { id } — палец тянет воду, 'splash' { a, amt } — всплеск.
const TAU = Math.PI * 2;
export const N = 64, VMAX = 6, PIN_MAX = 4;              // N — масс в кольце worklet (форма из engine — столько же точек)
export const FX_DEF = { tension: 0.45, damping: 0.4, wind: 0, tide: 0.55, hall: 0.4 };
export const LUNA_DEF = { orbit: 0.45, storm: 0, sway: 0, to: 0 };   // луна — LFO мира: орбита, рывки, качание (sway) натяжения, высоты или затухания

export function createModel({ scale = { on: false, root: 0, snap: (s) => s }, rng = Math.random } = {}) {
  const voices = [];                                     // {slot, ang, rn, pinned, lvl, oct, path}
  const fx = { ...FX_DEF }, luna = { ...LUNA_DEF };
  const state = { voices, fx, luna, time: 0 };
  const listeners = [];
  const emit = (e) => { for (const fn of listeners) fn(e); };

  const root = () => (scale.on ? scale.root : 0);
  function semiOf(v) {                                  // климат (три пояса) — октава, угол — полутоны по часовой от верха
    const zone = v.rn > 2 / 3 ? 0 : v.rn > 1 / 3 ? 1 : 2;
    let s = zone * 12 + (v.ang / TAU) * 12 + root();
    if (scale.on) s = scale.snap(Math.round(s));
    return s;
  }
  const hz = (v) => 55 * 2 ** (semiOf(v) / 12) * 2 ** (v.oct || 0);

  function addVoice(ang, rn, pinned) {
    const used = new Set(voices.map((v) => v.slot)), slot = [...Array(VMAX).keys()].find((k) => !used.has(k));
    if (slot == null) return null;
    const v = { slot, ang, rn, pinned, lvl: 0.8, oct: 0, path: 0 };
    voices.push(v); emit({ t: 'voice', v, on: true, added: true });
    return v;
  }
  function dropVoice(v) { emit({ t: 'voice', v, on: false }); voices.splice(voices.indexOf(v), 1); }
  function moveVoice(v, ang, rn) { v.ang = ang; v.rn = rn; emit({ t: 'voice', v, on: true }); }
  function setVoice(v, patch) { Object.assign(v, patch); emit({ t: 'voice', v, on: true }); }
  function setFx(k, v) { fx[k] = v; emit({ t: 'fx' }); }
  function loadFx(o) { Object.assign(fx, o); emit({ t: 'fx' }); }
  function setLuna(patch) { Object.assign(luna, patch); emit({ t: 'fx' }); }
  const push = (id, a, d) => emit({ t: 'push', id, a, d });   // a — доля круга, d — куда тянуть (от середины кольца, в амплитудах)
  const release = (id) => emit({ t: 'release', id });
  const splash = (a, amt) => emit({ t: 'splash', a, amt });
  function clear() { while (voices.length) dropVoice(voices[0]); }
  function tick(dt) { state.time += dt; }                // своего времени у мира нет: волны и луна — в worklet

  function dice() {                                     // два-три города на ступенях лада, натяжение и затухание — вразброс, всплеск
    const R = rng;
    clear();
    const n = 2 + Math.floor(R() * 2);
    for (let k = 0; k < n; k++) addVoice(Math.floor(R() * 12) / 12 * TAU + 0.01, [0.84, 0.5, 0.18][Math.floor(R() * 3)], true);
    fx.tension = 0.2 + 0.6 * R(); fx.damping = 0.15 + 0.6 * R(); emit({ t: 'fx' });
    splash(R(), 0.4);
    for (const v of voices) setVoice(v, { path: Math.floor(R() * 3) });
  }
  const snapshot = () => JSON.stringify({ v: voices.filter((v) => v.pinned).map(({ ang, rn, lvl, oct, path }) => ({ ang, rn, lvl, oct, path })), fx, luna: { ...luna } });
  function restore(js) {
    const st = JSON.parse(js);
    clear();
    for (const q of st.v) { const v = addVoice(q.ang, q.rn, true); if (v) setVoice(v, { lvl: q.lvl, oct: q.oct, path: q.path || 0 }); }
    Object.assign(fx, st.fx); if (st.luna) Object.assign(luna, st.luna); emit({ t: 'fx' });
  }

  return {
    state, root, semiOf, hz,
    addVoice, dropVoice, moveVoice, setVoice, setFx, loadFx, setLuna, push, release, splash, clear, dice,
    tick, snapshot, restore, sounding: () => voices.length > 0,
    listen(fn) { listeners.push(fn); },
  };
}
