// Portus — фасад модели. Сама модель живёт в ядре (core/worlds/portus → t2d.wasm, узел t2d-worklet.js хоста, слот 13), здесь — её зеркало и
// действия касаний. API — прежней JS-модели (эталон — tools/ref/portus-model.js), без DOM, холста и Web Audio: state.isles — живые кораблики
// (view держит ссылки), luna, echo, buoy, fog, pharos, fx, seq правятся на месте из зеркала.
// Действия применяются к state сразу и уходят в ядро через send (порт узла ядра, асинхронно; send → номер сообщения). Зеркало (sync) приходит
// ~60 раз в секунду с числом уже применённых ядром сообщений: поле, которое здесь правили, а ядро ещё не видело, зеркало не перетирает (как
// фасады Monochordum, Firmamentum и Goetia). Кубик — здесь (алгоритм эталона на rng), в ядро — одним restore; шаги, шанс удара (chance),
// высота места в момент удара и звук — в ядре. События listen — как у прежней модели: 'fx' (шина), 'play', 'audition' {is}; 'kill' ядру уходит
// сразу (эхо гаснет), событие остаётся для вида.
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const NOTES = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];
export const CHORDS = [                                  // голоса — как у стабов Basic Channel
  { name: '5', iv: [0, 7, 12, 19] }, { name: 'sus', iv: [0, 5, 10, 14] }, { name: 'm7', iv: [0, 7, 10, 15] },
  { name: 'm9', iv: [0, 7, 10, 14, 15] }, { name: 'm11', iv: [0, 7, 10, 14, 15, 17] },
];
export const DT = [2, 3, 4, 6, 8], DT_NAME = ['1/8', '3/16', '1/4', '3/8', '1/2'];   // время эха в шестнадцатых
export const NSTEP = 16, PSPAN = 12;                    // 16 мест вдоль фарватера; поперёк — октава
// берега бухты (в долях полуширины воды, d — 0 у набережной … 1 на горизонте): мысы выступают в воду — слева большой у нас под рукой и дальний, справа — мыс с маяком и дальний
const gs = (d, c, w) => Math.exp(-(((d - c) / w) ** 2));
export const edge = (G, side, d) => side * (1 - (side < 0 ? 0.62 * gs(d, 0.2, 0.13) + 0.3 * gs(d, 0.58, 0.08) + 0.12 * gs(d, 0.86, 0.05) : 0.42 * gs(d, 0.05, 0.12) + 0.32 * gs(d, 0.72, 0.07)) - 0.022 * Math.sin(d * 17 + side) * (0.3 + d) - 0.012 * Math.sin(d * 43 + 2 * side) * d);

// ядро: слот мира в хосте, коды action, ключи, раскладка зеркала — core/worlds/portus/world.hpp
export const SLOT = 13;
export const ACT = { PLACE: 0, SINK: 1, MOVE: 2, NOTE: 3, ISLE: 4, LUNA: 5, BUOY: 6, ECHO: 7, FOG: 8, PHAROS: 9, BPM: 10, FX: 11, CLEAR: 12, PLAY: 13, KILL: 14, AUDITION: 15 };
export const LUNA_KEYS = ['cut', 'res', 'env'], ECHO_KEYS = ['time', 'tone', 'mix', 'fb'], FOG_KEYS = ['amt', 'size'];
export const PHAROS_KEYS = ['chord', 'oct', 'len', 'lvl', 'swing'], FX_KEYS = ['wow', 'mare', 'drive', 'spread', 'chance'];
export const MIRROR_HEAD = 24, MIRROR_ISLE = 5, MIRROR_N = MIRROR_HEAD + NSTEP * MIRROR_ISLE;   // шаг, играет, голосов, bpm, … затем 16 × (занято, p, oct, lvl, sd)

export function createModel({ scale = { on: false, root: 0, snap: (s) => s }, rng = Math.random, send = () => 0 } = {}) {
  const isles = [];                                     // кораблики {step (место 0…15), p (0…12 полутонов поперёк), oct (свой сдвиг октавы), lvl, sd}
  const luna = { cut: 0.42, res: 0.35, env: 0.45 };     // фильтр
  const echo = { time: 1, tone: 0.45, mix: 0.6 };       // эхо: время (индекс DT), темнота, сколько посылать; повторы — по месту буя
  const buoy = { u: 0.35, d: 0.45 };
  const fog = { amt: 0.45, size: 0.7 };                 // ревер
  const pharos = { chord: 2, oct: 0, len: 0.25, lvl: 0.8, swing: 0 };   // аккорд и октава всей дорожки
  const fx = { wow: 0.25, mare: 0, drive: 0.25, spread: 0.6, chance: 1 };
  const seq = { playing: false, bpm: 120 };             // часы (когда следующий шаг и его номер) — в ядре
  const state = { isles, luna, echo, buoy, fog, pharos, fx, seq, time: 0 };
  const listeners = [];
  const emit = (e) => { for (const fn of listeners) fn(e); };
  const changed = () => emit({ t: 'fx' });
  let post = send;
  let parAt = 0, isleAt = 0, playAt = 0;                // номер последнего сообщения, правившего параметры сцены / кораблики / пуск
  const act = (kind, i = 0, a = []) => post({ t: 'action', slot: SLOT, kind, i, a });

  const stepSec = () => 60 / seq.bpm / 4;
  const root = () => (scale.on ? scale.root : 0);
  const isleOn = (j) => isles.find((i) => i.step === j);
  const typeOf = () => pharos.chord;                     // аккорд — один, у маяка; кораблик — только нота
  function semiOf(is) {                                 // тоника от A2: поперёк фарватера — полутоны (с ладом — ступени), плюс октава маяка и кораблика
    let a = is.p + root();
    if (scale.on) a = scale.snap(a + 24) - 24;
    return a + 12 * (pharos.oct + (is.oct || 0));
  }
  const hzOf = (is) => 110 * 2 ** (semiOf(is) / 12);
  const nameOf = (is) => { const m = semiOf(is); return `${NOTES[((m % 12) + 12) % 12]}${CHORDS[typeOf(is)].name}`; };
  const fcOf = () => 90 * 2 ** (7.2 * luna.cut);         // срез: 90 Гц … 13 кГц
  const fbOf = () => clamp(0.15 + buoy.d * 0.84, 0, 0.985);   // дальше буй — дольше эхо
  const buoyU = () => { const a = edge(null, -1, buoy.d), b = edge(null, 1, buoy.d); buoy.u = a + 0.03 + (echo.time / 4) * (b - a - 0.06); };   // буй поперёк — по времени эха

  // ---------- кораблики ----------
  function place(i, p) {                                // кораблик на место i, нота p: место занято — переплывает на новую ноту
    let is = isleOn(i);
    if (is) { is.p = p; isleAt = act(ACT.NOTE, i, [p]); return is; }
    is = { step: i, p, oct: 0, lvl: 1, sd: rng() * 1000 };
    isles.push(is); isleAt = act(ACT.PLACE, i, [p, is.sd]); return is;
  }
  function sink(is) { const k = isles.indexOf(is); if (k >= 0) { isles.splice(k, 1); isleAt = act(ACT.SINK, is.step); } }   // тонет
  function moveIsle(is, i) { if (i !== is.step && !isleOn(i)) { const from = is.step, alive = isles.includes(is); is.step = i; if (alive) isleAt = act(ACT.MOVE, from, [i]); } }   // вдоль фарватера — на свободное место
  function setNote(is, p) { is.p = p; if (isles.includes(is)) isleAt = act(ACT.NOTE, is.step, [p]); }
  function setIsle(is, k, v) {
    if (!isles.includes(is)) return;
    if (k === 'oct') is.oct = v; else is.lvl = v;
    isleAt = act(ACT.ISLE, is.step, [k === 'oct' ? 0 : 1, v]);
  }
  const audition = (is) => emit({ t: 'audition', is });   // часы стоят — услышать аккорд, пока ставишь (engine решает, звучать ли)

  // ---------- сцена: луна, буй, туман, маяк, FX ----------
  function setLuna(k, v) { luna[k] = v; parAt = act(ACT.LUNA, LUNA_KEYS.indexOf(k), [v]); }   // срез и резонанс читает каждый удар — событие не нужно
  function setBuoy(u, d) {                              // тянешь буй: вдаль — повторы, поперёк (между берегами) — время
    buoy.d = clamp(d, 0.03, 0.95);
    const a = edge(null, -1, buoy.d), b = edge(null, 1, buoy.d); buoy.u = clamp(u, a + 0.03, b - 0.03); echo.time = clamp(Math.round(((buoy.u - a) / (b - a)) * 4), 0, 4);
    parAt = act(ACT.BUOY, 0, [u, d]); changed();
  }
  function setEcho(k, v) {                              // плашка: time — индекс, fb — 0…1
    if (k === 'time') echo.time = v; else if (k === 'fb') buoy.d = 0.03 + v * 0.92; else echo[k] = v;
    buoyU(); parAt = act(ACT.ECHO, ECHO_KEYS.indexOf(k), [v]); changed();
  }
  function setFog(k, v) { fog[k] = v; parAt = act(ACT.FOG, FOG_KEYS.indexOf(k), [v]); changed(); }
  function setPharos(k, v) { pharos[k] = v; parAt = act(ACT.PHAROS, PHAROS_KEYS.indexOf(k), [v]); }
  function setBpm(b) { seq.bpm = b; parAt = act(ACT.BPM, 0, [b]); changed(); }
  function setFx(k, v) { const i = FX_KEYS.indexOf(k); if (i < 0) return; fx[k] = v; parAt = act(ACT.FX, i, [v]); changed(); }
  function loadFx(o) { for (const [k, v] of Object.entries(o || {})) { const i = FX_KEYS.indexOf(k); if (i >= 0) { fx[k] = v; parAt = act(ACT.FX, i, [v]); } } changed(); }
  const killEcho = () => { act(ACT.KILL); emit({ t: 'kill' }); };   // падающая звезда: эхо гаснет за долю секунды, потом снова слушает

  // ---------- секвенсер: шаги ставит ядро (sdk::Steps); здесь — тот же алгоритм для картинки и тестов ----------
  function play(on = !seq.playing) { seq.playing = on; playAt = act(ACT.PLAY, 0, [on ? 1 : 0]); emit({ t: 'play', on }); }
  const swing = (j) => (j % 2 ? pharos.swing * stepSec() * 0.5 : 0);   // нечётные шестнадцатые — позже
  function nextGap(step) { for (let k = 1; k <= NSTEP; k++) if (isleOn((step + k) % NSTEP)) return k * stepSec(); return NSTEP * stepSec(); }
  function step(j) {                                    // удар шага j: кораблик, сила, до следующего удара; null — пусто или пропущен (chance)
    const is = isleOn(j);
    if (!is || !(rng() < fx.chance)) return null;
    return { is, vel: j % 4 === 2 ? 1 : 0.85, gap: nextGap(j) };
  }

  // ---------- патч ----------
  const sounding = () => seq.playing && isles.length > 0;
  function dice() {                                     // дорожка: 3–7 ударов, больше на «и»; две-три тоники ступенями лада, сменяются по половинам такта; эхо, туман, луна
    const R = rng, pick = (a) => a[Math.floor(R() * a.length)];
    isles.length = 0;
    const roots = [0, pick([3, 5, 7, 10]), pick([0, 5, 7, 12])], chord = pick([2, 2, 3, 3, 1, 4]);
    const order = [2, 6, 10, 14, 3, 11, 7, 15, 0, 9, 13, 5].filter(() => R() < 0.62).slice(0, 7);
    if (order.length < 3) order.push(2, 10);
    for (const j of new Set(order)) isles.push({ step: j, p: roots[j < 8 ? 0 : R() < 0.7 ? 1 : 2], oct: 0, lvl: 1, sd: R() * 1000 });
    pharos.chord = chord;
    echo.time = Math.floor(R() * 5); buoy.d = 0.25 + R() * 0.55; buoyU();
    pharos.oct = R() < 0.6 ? -1 : 0;
    luna.cut = 0.25 + R() * 0.45; luna.res = R() * 0.6; fog.amt = 0.25 + R() * 0.55;
    parAt = isleAt = post({ t: 'restore', slot: SLOT, js: snapshot() });   // сцена — в ядро одним сообщением (пуск не трогаем)
    changed();
    if (!seq.playing) play(true);
  }
  function clear() { isles.length = 0; isleAt = act(ACT.CLEAR); }
  const snapshot = () => JSON.stringify({ isles: isles.map(({ step, p, oct, lvl, sd }) => ({ step, p, oct, lvl, sd })), luna, echo, buoy, fog, pharos, fx, bpm: seq.bpm });
  function restore(js) {
    const st = JSON.parse(js);
    isles.length = 0; for (const q of st.isles) if (q.step != null) isles.push({ ...q });
    Object.assign(luna, st.luna); Object.assign(echo, st.echo); Object.assign(buoy, st.buoy); Object.assign(fog, st.fog); Object.assign(pharos, st.pharos); Object.assign(fx, st.fx); seq.bpm = st.bpm;
    parAt = isleAt = post({ t: 'restore', slot: SLOT, js });
    changed();
  }

  function sync(m, applied) {                           // зеркало ядра → state; applied — сколько сообщений ядро уже применило
    if (!m || m.length < MIRROR_N) return;              // старый t2d.wasm без слота 13 отвечает пустым зеркалом
    if (applied >= playAt) seq.playing = m[1] !== 0;
    if (applied >= parAt) {
      let o = 3;
      seq.bpm = m[o++];
      for (const [grp, keys] of [[luna, LUNA_KEYS], [echo, ECHO_KEYS.slice(0, 3)], [buoy, ['u', 'd']], [fog, FOG_KEYS], [pharos, PHAROS_KEYS], [fx, FX_KEYS]]) {
        for (const k of keys) grp[k] = m[o++];
      }                                                 // ядро параметры само не меняет — событие 'fx' зеркало не шлёт
    }
    if (applied >= isleAt) {                            // кораблики: по месту — те же объекты, лишние тонут, новые всплывают
      for (let j = 0; j < NSTEP; j++) {
        const o = MIRROR_HEAD + j * MIRROR_ISLE, is = isleOn(j);
        if (m[o] === 0) { if (is) isles.splice(isles.indexOf(is), 1); continue; }
        if (is) { is.p = m[o + 1]; is.oct = m[o + 2]; is.lvl = m[o + 3]; is.sd = m[o + 4]; }
        else isles.push({ step: j, p: m[o + 1], oct: m[o + 2], lvl: m[o + 3], sd: m[o + 4] });
      }
    }
  }
  function bind(fn) {                                   // новый узел ядра (новый контекст): счёт сообщений — заново, сцена и пуск — туда целиком
    post = fn;
    parAt = isleAt = playAt = post({ t: 'restore', slot: SLOT, js: snapshot() });
    if (seq.playing) playAt = act(ACT.PLAY, 0, [1]);
  }

  return {
    state, stepSec, root, isleOn, typeOf, semiOf, hzOf, nameOf, fcOf, fbOf,
    place, sink, moveIsle, setNote, setIsle, audition, setLuna, setBuoy, setEcho, setFog, setPharos, setBpm, setFx, loadFx, killEcho,
    play, swing, nextGap, step, sounding, dice, clear, snapshot, restore,
    tick(dt) { state.time += dt; },                     // своего времени у бухты нет: часы — в ядре
    listen(fn) { listeners.push(fn); },
    sync, bind,
  };
}
