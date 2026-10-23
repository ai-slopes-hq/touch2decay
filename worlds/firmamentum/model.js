// Firmamentum — фасад модели. Сама модель живёт в ядре (core/worlds/firmamentum → t2d.wasm, узел t2d-worklet.js хоста), здесь — её
// зеркало и действия касаний. API — прежней JS-модели (эталон — tools/ref/firmamentum-model.js), без DOM, холста и Web Audio:
// state.stars — живые объекты по id (view держит ссылку на звезду под пальцем), правятся на месте из зеркала.
// Действия применяются к state сразу (addStar — синхронно: слот — первый свободный, как в ядре, id — свой) и уходят в ядро через send
// (порт узла ядра, асинхронно; send → номер сообщения). Зеркало (sync) приходит ~60 раз в секунду с числом уже применённых ядром
// сообщений: поля звезды, которые здесь правили, а ядро ещё не видело, зеркало не перетирает; добавленную здесь звезду, ещё не дошедшую,
// не убирает; закрытую здесь — не возвращает. clear, restore и кубик — целиком здесь (кубик — алгоритм эталона на rng) и в ядро:
// restore — одним сообщением со слотами и id звёзд (правило id — core/worlds/firmamentum/world.hpp, ADD), так что снимок и отмена видят
// результат сразу, а id здесь и в ядре совпадают и до прихода зеркала. Время, комета, drift (dr), разгон кометой (cm), громкость голоса
// (gain) и счётчик пульсаретов (count) — только из зеркала. fp / ff — по полям звезды и ладу хоста, как в ядре (сверка — тесты модели).
// События listen — из действий и разницы зеркал: { t: 'star', s, on, added? }, 'fp', 'ff', 'fx' (склейке — закрытая звезда снимает LFO).
export const SMAX = 6;
export const FP_LO = 0.7, FP_HI = 520, FF_LO = 140, FF_HI = 4800;
export const LIMEN = Math.log(20 / FP_LO) / Math.log(FP_HI / FP_LO);   // высота, где ритм становится тоном
export const STAR_KEYS = ['h', 'u', 'cyc', 'win', 'mask', 'lvl'];      // что звезды сохраняется в снимке
export const FX_DEF = { scintilla: 0.1, drift: 0.2, cometa: 0, crepitus: 0, fulgur: 0, spread: 0.6, hall: 0.45 };
// ядро: слот мира в хосте, коды action, ключи set и fx, раскладка зеркала — core/worlds/firmamentum/world.hpp
export const SLOT = 10;
export const ACT = { add: 0, close: 1, move: 2, set: 3, fx: 4, clear: 5, dice: 6, launch: 7 };
export const SET_KEYS = ['cyc', 'win', 'mask', 'lvl', 'h', 'u'];
export const FX_KEYS = Object.keys(FX_DEF);             // scintilla, drift, cometa, crepitus, fulgur, spread, hall
export const MSTAR = ['slot', 'id', 'h', 'u', 'cyc', 'win', 'mask', 'lvl', 'dr', 'cm', 'fp', 'ff', 'gain', 'count'];   // звезда в зеркале
export const HEAD = 2 + 7 + FX_KEYS.length + 1;         // time, comets, comet [on, a.h, a.u, b.h, b.u, t0, dur], fx, число звёзд
const OWN = ['slot', 'h', 'u', 'cyc', 'win', 'mask', 'lvl'];   // поля, которые правит фасад; остальное — только ядро

export function createModel({ scale = { on: false, snap: (s) => s }, rng = Math.random, place = (s) => ({ x: s.u, y: -s.h }), send = () => 0 } = {}) {
  const stars = [], fx = { ...FX_DEF };
  const state = { stars, fx, comet: null, comets: 0, time: 0 };   // comet {a, b — точки свода, t0, dur — с}
  const listeners = [];
  const emit = (e) => { for (const fn of listeners) fn(e); };
  let post = send, serial = 0;
  const dirty = new Map(), gone = new Map();            // id → номер сообщения: звезду правили / закрыли здесь, ядро ещё не видело
  let wipe = 0, fxAt = 0;                               // номер последнего restore / clear (звёзды целиком) и последней правки fx
  const act = (kind, i = 0, a = []) => post({ t: 'action', slot: SLOT, kind, i, a });
  const live = (s) => !!s && stars.includes(s);

  function fp(s) {                                      // высота — частота пульсаций; в области тона с ладом — по ступеням
    let f = FP_LO * (FP_HI / FP_LO) ** s.h;
    if (scale.on && f > 27.5) { const st = 12 * Math.log2(f / 55); f = 55 * 2 ** ((scale.snap(Math.round(st) + 24) - 24) / 12); }
    return f * (s.cm || 1);
  }
  const ff = (s) => FF_LO * (FF_HI / FF_LO) ** ((s.u + 1) / 2) * 2 ** (s.dr || 0);

  function make(h, u) {                                 // новая звезда здесь: первый свободный слот, свой id
    const used = new Set(stars.map((s) => s.slot)), slot = [...Array(SMAX).keys()].find((k) => !used.has(k));
    if (slot == null) return null;
    const s = { slot, id: ++serial, h, u, cyc: 3, win: 0.2, mask: 0, lvl: 0.8, dr: 0, cm: 1, gain: 0, count: 0 };
    stars.push(s);
    return s;
  }
  function addStar(h, u) {
    const s = make(h, u);
    if (!s) return null;
    dirty.set(s.id, act(ACT.add, 0, [h, u, s.slot, s.id]));
    emit({ t: 'star', s, on: true, added: true });
    return s;
  }
  function closeStar(s) {
    if (!live(s)) return;
    stars.splice(stars.indexOf(s), 1); dirty.delete(s.id);
    gone.set(s.id, act(ACT.close, s.id));
    emit({ t: 'star', s, on: false });
  }
  function moveStar(s, h, u) {                          // закрытая (в том числе ядром) — мимо, без ошибки
    if (!live(s)) return;
    s.h = h; s.u = u;
    dirty.set(s.id, act(ACT.move, s.id, [h, u]));
    emit({ t: 'star', s, on: true });
  }
  function setStar(s, patch) {
    if (!live(s)) return;
    let q = 0;
    for (const k of SET_KEYS) if (patch[k] != null) { s[k] = patch[k]; q = act(ACT.set, s.id, [SET_KEYS.indexOf(k), patch[k]]); }
    if (q) dirty.set(s.id, q);
    emit({ t: 'star', s, on: true });
  }
  function setFx(k, v) { const i = FX_KEYS.indexOf(k); if (i < 0) return; fx[k] = v; fxAt = act(ACT.fx, i, [v]); emit({ t: 'fx' }); }
  function loadFx(o) { for (const [k, v] of Object.entries(o || {})) { const i = FX_KEYS.indexOf(k); if (i >= 0) { fx[k] = v; fxAt = act(ACT.fx, i, [v]); } } emit({ t: 'fx' }); }
  function dropAll() { const was = stars.splice(0); dirty.clear(); gone.clear(); for (const s of was) emit({ t: 'star', s, on: false }); }
  function clear() { dropAll(); wipe = act(ACT.clear); }

  const scene = () => JSON.stringify({ s: stars.map((s) => ({ ...Object.fromEntries(STAR_KEYS.map((k) => [k, s[k]])), slot: s.slot, id: s.id })), fx });
  function replace(list, fo) {                          // сцена целиком: здесь — сразу, в ядро — одним restore со слотами и id
    dropAll();
    for (const q of list) {
      const s = make(q.h ?? 0, q.u ?? 0);
      if (!s) continue;
      for (const k of STAR_KEYS) if (q[k] != null) s[k] = q[k];
    }
    if (fo) Object.assign(fx, fo);
    wipe = fxAt = post({ t: 'restore', slot: SLOT, js: scene() });
    for (const s of stars) emit({ t: 'star', s, on: true, added: true });
    emit({ t: 'fx' });
  }
  function dice() {                                     // одна звезда — ритм у горизонта, две-три — тоны выше; окна и циклы вразброс (как эталон)
    const R = rng, list = [];
    const h0 = 0.08 + R() * (LIMEN - 0.12), u0 = R() * 1.6 - 0.8;
    list.push({ h: h0, u: u0, cyc: 1 + Math.floor(R() * 3), win: 0.4 + R() * 0.3 });
    const n = 2 + Math.floor(R() * 2);
    for (let k = 0; k < n; k++) { const h = LIMEN + 0.08 + R() * 0.45, u = R() * 1.8 - 0.9; list.push({ h, u, cyc: 2 + Math.floor(R() * 6), win: R() * 0.6, mask: R() < 0.3 ? 0.3 : 0 }); }
    replace(list);
  }
  const snapshot = () => JSON.stringify({ s: stars.map((s) => Object.fromEntries(STAR_KEYS.map((k) => [k, s[k]]))), fx });
  function restore(js) { const st = JSON.parse(js); replace(st.s || [], st.fx); }

  function sync(m, applied) {                           // зеркало ядра → state; applied — сколько сообщений ядро уже применило
    state.time = m[0]; state.comets = m[1];
    state.comet = m[2] ? { a: { h: m[3], u: m[4] }, b: { h: m[5], u: m[6] }, t0: m[7], dur: m[8] } : null;
    if (applied >= fxAt) {
      let changed = false;
      FX_KEYS.forEach((k, i) => { if (fx[k] !== m[9 + i]) { fx[k] = m[9 + i]; changed = true; } });
      if (changed) emit({ t: 'fx' });
    }
    if (applied < wipe) return;                         // ядро ещё до последней сцены целиком — звёзды в зеркале старые
    for (const [id, q] of dirty) if (q <= applied) dirty.delete(id);
    for (const [id, q] of gone) if (q <= applied) gone.delete(id);
    const byId = new Map(stars.map((s) => [s.id, s])), next = [], ev = [], N = MSTAR.length;
    for (let i = 0; i < m[HEAD - 1]; i++) {
      const o = HEAD + i * N, id = m[o + 1];
      if (gone.has(id)) continue;                       // закрыта здесь — ядро ещё не видело
      let s = byId.get(id);
      const added = !s;
      if (added) s = { id };
      byId.delete(id);
      const was = added ? null : { fp: s.fp, ff: s.ff, own: OWN.map((k) => s[k]) };
      MSTAR.forEach((k, j) => { if (k !== 'id' && !(dirty.has(id) && OWN.includes(k))) s[k] = m[o + j]; });   // свои правки в пути — поля не трогаем
      serial = Math.max(serial, id);
      next.push(s);
      if (added) ev.push({ t: 'star', s, on: true, added: true });
      else {
        if (OWN.some((k, j) => was.own[j] !== s[k])) ev.push({ t: 'star', s, on: true });
        if (was.fp !== s.fp) ev.push({ t: 'fp', s });
        if (was.ff !== s.ff) ev.push({ t: 'ff', s });
      }
    }
    for (const s of byId.values()) {                    // в зеркале нет
      if (dirty.has(s.id)) next.push(s);                // добавлена здесь, ядро ещё не видело
      else ev.push({ t: 'star', s, on: false });        // закрыло ядро
    }
    stars.length = 0; stars.push(...next);
    for (const e of ev) emit(e);
  }
  function bind(fn) {                                   // новый узел ядра (новый контекст): счёт сообщений — заново, сцена — туда целиком
    post = fn; dirty.clear(); gone.clear();
    wipe = fxAt = post({ t: 'restore', slot: SLOT, js: scene() });
  }
  function cometAt(now = state.time) {                  // где комета: k — доля пути, x, y — на экране (линейно между концами, как летит)
    const c = state.comet;
    if (!c) return null;
    const k = Math.min(1, (now - c.t0) / c.dur), A = place(c.a), B = place(c.b);
    return { k, x: A.x + (B.x - A.x) * k, y: A.y + (B.y - A.y) * k, A, B };
  }

  return {
    state, fp, ff, LIMEN, cometAt,
    addStar, closeStar, moveStar, setStar, setFx, loadFx, clear, dice,
    tick() {}, snapshot, restore, sounding: () => stars.length > 0,   // время модели идёт в ядре
    listen(fn) { listeners.push(fn); },
    launch() { act(ACT.launch); },                      // для тестов: комета — на следующем шаге ядра
    sync, bind,
  };
}
