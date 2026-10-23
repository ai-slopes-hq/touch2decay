// Oceanus — фасад модели. Сама модель живёт в ядре (core/worlds/oceanus → t2d.wasm, узел t2d-worklet.js хоста, слот 8), здесь — её
// зеркало и действия касаний. API — прежней JS-модели (эталон — tools/ref/oceanus-model.js), без DOM, холста и Web Audio:
// state.voices — живые объекты по id (view держит ссылку на город под пальцем), правятся на месте из зеркала.
// Действия применяются к state сразу (addVoice — синхронно: слот — первый свободный, как в ядре, id — свой) и уходят в ядро через send
// (порт узла ядра, асинхронно; send → номер сообщения). Зеркало (sync) приходит ~60 раз в секунду с числом уже применённых ядром
// сообщений: поля города, которые здесь правили, а ядро ещё не видело, зеркало не перетирает; добавленный здесь, ещё не дошедший, —
// не убирает; убранный здесь — не возвращает (как фасад Firmamentum). clear, restore и кубик — целиком здесь (кубик — алгоритм эталона
// на rng) и в ядро: restore — одним сообщением со слотами и id городов. Форма кольца, место луны и громкости голосов — только из зеркала.
// hz — по полям города и ладу хоста, как в ядре. События listen — из действий и разницы зеркал: { t: 'voice', v, on, added? }, 'fx',
// 'push' { id, a, d } / 'release' { id } / 'splash' { a, amt }.
const TAU = Math.PI * 2;
export const N = 64, VMAX = 6, PIN_MAX = 4;              // N — масс в кольце (форма в зеркале — столько же точек)
export const FX_DEF = { tension: 0.45, damping: 0.4, wind: 0, tide: 0.55, hall: 0.4 };
export const LUNA_DEF = { orbit: 0.45, storm: 0, sway: 0, to: 0 };   // луна — LFO мира: орбита, рывки, качание (sway) натяжения, высоты или затухания
// ядро: слот мира в хосте, коды action, ключи set, fx и луны, раскладка зеркала — core/worlds/oceanus/world.hpp
export const SLOT = 8;
export const ACT = { add: 0, drop: 1, move: 2, set: 3, fx: 4, luna: 5, push: 6, release: 7, splash: 8, clear: 9, dice: 10 };
export const SET_KEYS = ['lvl', 'oct', 'path', 'pinned'];
export const FX_KEYS = Object.keys(FX_DEF), LUNA_KEYS = Object.keys(LUNA_DEF);
export const MVOICE = ['slot', 'id', 'ang', 'rn', 'pinned', 'lvl', 'oct', 'path', 'hz', 'gain'];   // город в зеркале
export const HEAD = FX_KEYS.length + LUNA_KEYS.length + 1 + N + 1;   // fx, luna, moon, форма кольца, число городов
const OWN = ['slot', 'ang', 'rn', 'pinned', 'lvl', 'oct', 'path'];   // поля, которые правит фасад; остальное — только ядро

export function createModel({ scale = { on: false, root: 0, snap: (s) => s }, rng = Math.random, send = () => 0 } = {}) {
  const voices = [];                                     // {slot, id, ang, rn, pinned, lvl, oct, path, hz, gain}
  const fx = { ...FX_DEF }, luna = { ...LUNA_DEF };
  const state = { voices, fx, luna, time: 0, shape: new Float32Array(N), moon: 0 };
  const listeners = [];
  const emit = (e) => { for (const fn of listeners) fn(e); };
  let post = send, serial = 0;
  const dirty = new Map(), gone = new Map();             // id → номер сообщения: город правили / убрали здесь, ядро ещё не видело
  let wipe = 0, fxAt = 0;                                // номер последнего restore / clear и последней правки fx / луны
  const act = (kind, i = 0, a = []) => post({ t: 'action', slot: SLOT, kind, i, a });
  const live = (v) => !!v && voices.includes(v);

  const root = () => (scale.on ? scale.root : 0);
  function semiOf(v) {                                  // климат (три пояса) — октава, угол — полутоны по часовой от верха
    const zone = v.rn > 2 / 3 ? 0 : v.rn > 1 / 3 ? 1 : 2;
    let s = zone * 12 + (v.ang / TAU) * 12 + root();
    if (scale.on) s = scale.snap(Math.round(s));
    return s;
  }
  const hz = (v) => 55 * 2 ** (semiOf(v) / 12) * 2 ** (v.oct || 0);

  function make(ang, rn, pinned) {                       // новый город здесь: первый свободный слот, свой id
    const used = new Set(voices.map((v) => v.slot)), slot = [...Array(VMAX).keys()].find((k) => !used.has(k));
    if (slot == null) return null;
    const v = { slot, id: ++serial, ang, rn, pinned, lvl: 0.8, oct: 0, path: 0, hz: 0, gain: 0 };
    voices.push(v);
    return v;
  }
  function addVoice(ang, rn, pinned) {
    const v = make(ang, rn, pinned);
    if (!v) return null;
    dirty.set(v.id, act(ACT.add, 0, [ang, rn, pinned ? 1 : 0, v.slot, v.id]));
    emit({ t: 'voice', v, on: true, added: true });
    return v;
  }
  function dropVoice(v) {
    if (!live(v)) return;
    emit({ t: 'voice', v, on: false });
    voices.splice(voices.indexOf(v), 1); dirty.delete(v.id);
    gone.set(v.id, act(ACT.drop, v.id));
  }
  function moveVoice(v, ang, rn) {
    if (!live(v)) return;
    v.ang = ang; v.rn = rn;
    dirty.set(v.id, act(ACT.move, v.id, [ang, rn]));
    emit({ t: 'voice', v, on: true });
  }
  function setVoice(v, patch) {
    if (!live(v)) return;
    let q = 0;
    for (const k of SET_KEYS) if (patch[k] != null) { v[k] = patch[k]; q = act(ACT.set, v.id, [SET_KEYS.indexOf(k), +patch[k]]); }
    if (q) dirty.set(v.id, q);
    emit({ t: 'voice', v, on: true });
  }
  function setFx(k, v) { const i = FX_KEYS.indexOf(k); if (i < 0) return; fx[k] = v; fxAt = act(ACT.fx, i, [v]); emit({ t: 'fx' }); }
  function loadFx(o) { for (const [k, v] of Object.entries(o || {})) { const i = FX_KEYS.indexOf(k); if (i >= 0) { fx[k] = v; fxAt = act(ACT.fx, i, [v]); } } emit({ t: 'fx' }); }
  function setLuna(patch) {
    for (const [k, v] of Object.entries(patch || {})) { const i = LUNA_KEYS.indexOf(k); if (i >= 0) { luna[k] = v; fxAt = act(ACT.luna, i, [v]); } }
    emit({ t: 'fx' });
  }
  const push = (id, a, d) => { act(ACT.push, 0, [id, a, d]); emit({ t: 'push', id, a, d }); };   // a — доля круга, d — куда тянуть
  const release = (id) => { act(ACT.release, 0, [id]); emit({ t: 'release', id }); };
  const splash = (a, amt) => { act(ACT.splash, 0, [a, amt]); emit({ t: 'splash', a, amt }); };
  function dropAll() { const was = voices.splice(0); dirty.clear(); gone.clear(); for (const v of was) emit({ t: 'voice', v, on: false }); }
  function clear() { dropAll(); wipe = act(ACT.clear); }
  function tick(dt) { state.time += dt; }                // своего времени у мира нет: волны и луна — в ядре

  const scene = () => JSON.stringify({ v: voices.map(({ slot, id, ang, rn, pinned, lvl, oct, path }) => ({ ang, rn, lvl, oct, path, slot, id, pinned })), fx, luna });
  function replace(list, fo, lo) {                       // сцена целиком: здесь — сразу, в ядро — одним restore со слотами и id
    dropAll();
    for (const q of list) {
      const v = make(q.ang, q.rn, true);
      if (!v) continue;
      v.lvl = q.lvl ?? 0.8; v.oct = q.oct ?? 0; v.path = q.path || 0;
    }
    if (fo) Object.assign(fx, fo);
    if (lo) Object.assign(luna, lo);
    wipe = fxAt = post({ t: 'restore', slot: SLOT, js: scene() });
    for (const v of voices) emit({ t: 'voice', v, on: true, added: true });
    emit({ t: 'fx' });
  }
  function dice() {                                     // два-три города на ступенях лада, натяжение и затухание — вразброс, всплеск (как эталон)
    const R = rng, list = [];
    const n = 2 + Math.floor(R() * 2);
    for (let k = 0; k < n; k++) list.push({ ang: Math.floor(R() * 12) / 12 * TAU + 0.01, rn: [0.84, 0.5, 0.18][Math.floor(R() * 3)] });
    const tension = 0.2 + 0.6 * R(), damping = 0.15 + 0.6 * R(), a = R();
    for (const q of list) q.path = Math.floor(R() * 3);
    replace(list, { tension, damping });
    splash(a, 0.4);
  }
  const snapshot = () => JSON.stringify({ v: voices.filter((v) => v.pinned).map(({ ang, rn, lvl, oct, path }) => ({ ang, rn, lvl, oct, path })), fx, luna: { ...luna } });
  function restore(js) { const st = JSON.parse(js); replace(st.v || [], st.fx, st.luna); }

  function sync(m, applied) {                           // зеркало ядра → state; applied — сколько сообщений ядро уже применило
    const nf = FX_KEYS.length, nl = LUNA_KEYS.length;
    state.moon = m[nf + nl];
    state.shape.set(m.slice(nf + nl + 1, nf + nl + 1 + N));
    if (applied >= fxAt) {
      let changed = false;
      FX_KEYS.forEach((k, i) => { if (fx[k] !== m[i]) { fx[k] = m[i]; changed = true; } });
      LUNA_KEYS.forEach((k, i) => { if (luna[k] !== m[nf + i]) { luna[k] = m[nf + i]; changed = true; } });
      if (changed) emit({ t: 'fx' });
    }
    if (applied < wipe) return;                         // ядро ещё до последней сцены целиком — города в зеркале старые
    for (const [id, q] of dirty) if (q <= applied) dirty.delete(id);
    for (const [id, q] of gone) if (q <= applied) gone.delete(id);
    const byId = new Map(voices.map((v) => [v.id, v])), next = [], ev = [], NV = MVOICE.length;
    for (let i = 0; i < m[HEAD - 1]; i++) {
      const o = HEAD + i * NV, id = m[o + 1];
      if (gone.has(id)) continue;                       // убран здесь — ядро ещё не видело
      let v = byId.get(id);
      const added = !v;
      if (added) v = { id };
      byId.delete(id);
      const was = added ? null : OWN.map((k) => v[k]);
      MVOICE.forEach((k, j) => {
        if (k === 'id' || (dirty.has(id) && OWN.includes(k))) return;   // свои правки в пути — поля не трогаем
        v[k] = k === 'pinned' ? !!m[o + j] : m[o + j];
      });
      serial = Math.max(serial, id);
      next.push(v);
      if (added) ev.push({ t: 'voice', v, on: true, added: true });
      else if (OWN.some((k, j) => was[j] !== v[k])) ev.push({ t: 'voice', v, on: true });
    }
    for (const v of byId.values()) {                    // в зеркале нет
      if (dirty.has(v.id)) next.push(v);                // добавлен здесь, ядро ещё не видело
      else ev.push({ t: 'voice', v, on: false });       // убрало ядро
    }
    voices.length = 0; voices.push(...next);
    for (const e of ev) emit(e);
  }
  function bind(fn) {                                   // новый узел ядра (новый контекст): счёт сообщений — заново, сцена — туда целиком
    post = fn; dirty.clear(); gone.clear();
    wipe = fxAt = post({ t: 'restore', slot: SLOT, js: scene() });
  }

  return {
    state, root, semiOf, hz,
    addVoice, dropVoice, moveVoice, setVoice, setFx, loadFx, setLuna, push, release, splash, clear, dice,
    tick, snapshot, restore, sounding: () => voices.length > 0,
    listen(fn) { listeners.push(fn); },
    sync, bind,
  };
}
