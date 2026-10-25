// Natura — звук и часы живут в ядре SDK (core/worlds/natura → t2d.wasm, узел хоста T.core, слот 4): волны (sine / square / triangle / saw /
// sharp — band-limited), фильтр с огибающей, шина (срез дерева, хор, лента-задержка), посыл в общий зал, кораблик, лазер, лягушка, шелест;
// шаги по часам хоста (свой темп или сетка MIDI-часов — с точностью до сэмпла). Этап 1: модель остаётся в вебе (model.js) — ядру уходит
// её состояние целиком (STATE) при каждом изменении, остальное — действия: пуск, послушать, кораблик, дерево, лазер, лягушка, испуг.
// Здесь — тонкая склейка: сухой выход мира — в канал микшера, посыл в зал и фейдер — в ядре; зеркало ядра — бегунок и голоса;
// «услышано» → view: { note: pd, at } — нота ударила (утки), { played: i, at } — кувшинка шага (лягушка, стрекозы).
// Эталон прежнего движка на узлах Web Audio — tools/ref/natura-engine.js.
export const SLOT = 4;
export const ACT = { STATE: 0, PLAY: 1, HEAR: 2, SHAKE: 3, SKIFF: 4, SKIFF_OFF: 5, WAVE: 6, CROAK: 7, LASER: 8, SCARE: 9 };
const FX = ['reverb', 'delay', 'time', 'chorus', 'cutoff', 'res', 'att', 'rel', 'chance'];
const LOCKS = ['cutoff', 'res', 'att', 'rel'];

// состояние модели → числа для ядра: [bpm, len, fx×9, 16 × (занято, note, wave, glide, chance, cutoff, res, att, rel)]; −1 — общее / не задан
export function stateArgs(S) {
  const a = [S.seq.bpm, S.pads.len, ...FX.map((k) => S.fx[k])];
  for (let i = 0; i < 16; i++) {
    const pd = S.pads.at[i];
    if (!pd) { a.push(0, 0, 0, 0, -1, -1, -1, -1, -1); continue; }
    a.push(1, pd.note, pd.wave, pd.glide ? 1 : 0, pd.chance ?? -1, ...LOCKS.map((k) => (pd.lock && pd.lock[k] != null ? pd.lock[k] : -1)));
  }
  return a;
}

export function createEngine(T, model) {
  const S = model.state;
  let k = null, last = '', gone = null, shake = 0, skiffOn = false;
  let mp = -1, mAt = 0, mPlay = false, voices = 0;       // зеркало: бегунок (шагов), когда пришёл, играет ли, голосов
  const listeners = [];
  const heard = (e) => { for (const fn of listeners) fn(e); };
  const act = (kind, i = 0, a = []) => { if (k) k.send({ t: 'action', slot: SLOT, kind, i, a }); };

  function build(ctx, input) {                           // новый контекст — новый узел ядра и новый мир в нём: состояние и пуск — заново
    k = T.core; last = ''; shake = 0; skiffOn = false; mp = -1; mPlay = false; voices = 0; gone = S.goneAt;
    k.dry[SLOT].connect(input);
    k.listen(mirrorFrom);
    poll();
    if (S.seq.playing) act(ACT.PLAY, 0, [1]);
  }
  // раз в кадр (tick мира) и перед событиями: изменилось состояние — ядру целиком (правки, плашки, LFO, консоль — всё сходится в одном месте)
  function poll() {
    if (!k) return;
    const a = stateArgs(S), key = a.join(',');
    if (key !== last) { last = key; act(ACT.STATE, 0, a); }
    if (S.goneAt !== gone) { gone = S.goneAt; if (gone != null) act(ACT.SCARE); }
  }
  function mirrorFrom(d) {                               // ~60 раз в секунду
    const w = d.w && d.w[SLOT];
    if (!w) return;
    const m = w.mirror || [];
    mp = m[0] ?? -1; mPlay = (m[1] ?? 0) > 0; voices = m[2] ?? 0; mAt = performance.now();
    for (const h of w.heard || []) {
      for (let i = 0; i + 1 < h.length; i += 2) {
        const now = performance.now();
        if (h[i] === 2) { const pd = S.pads.at[h[i + 1]]; if (pd) heard({ note: pd, at: now }); }   // для уток: нота ударила
        else if (h[i] === 1) heard({ played: h[i + 1], at: now });                                  // лягушка, стрекозы
      }
    }
  }
  // бегунок: шагов с начала; между зеркалами (16 мс) — вперёд по темпу, не дальше шага
  const phase = () => (S.seq.playing && k && mPlay && mp >= 0 ? mp + Math.min(1, (performance.now() - mAt) / (model.stepSec() * 1000)) : null);

  function on(e) {                                       // событие модели → ядро
    if (!k) return;
    if (e.t === 'play') { poll(); act(ACT.PLAY, 0, [e.on ? 1 : 0]); }
    else if (e.t === 'fx') poll();
    else if (e.t === 'hear') { poll(); const i = S.pads.at.indexOf(e.pd); if (i >= 0) act(ACT.HEAR, i); }
    else if (e.t === 'shake') { if (e.v > 0.0005 || shake > 0.0005) act(ACT.SHAKE, 0, [e.v]); shake = e.v; }
    else if (e.t === 'skiff') {
      poll();
      if (e.o) { skiffOn = true; act(ACT.SKIFF, 0, [e.o.q, e.o.t, S.lastWave]); } else { skiffOn = false; act(ACT.SKIFF_OFF); }
    }
    else if (e.t === 'wave') act(ACT.WAVE, 0, [e.w]);
    else if (e.t === 'laser') act(ACT.LASER);
    else if (e.t === 'croak') { if (e.pd) act(ACT.CROAK, 0, [e.pd.note]); }
  }

  return {
    build, on, poll, phase, clock: { next: 0, step: 0 },
    listen(fn) { listeners.push(fn); },
    get has() { return !!k; }, get skiff() { return skiffOn; }, get live() { return !!(k && k.ready); }, get voices() { return voices; }, get ready() { return !!(k && k.ready); },
  };
}
