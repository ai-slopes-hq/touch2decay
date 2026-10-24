// Cymatica — звук: модель, пластина и часы секвенсера живут в ядре SDK (core/worlds/cymatica → t2d.wasm, узел хоста T.core, слот 2).
// Здесь: сухой выход ×2.5 — в канал микшера (посыл в пластинчатый зал и фейдер, эхо по долям темпа и гул резонатора — в ядре). Порт ядра
// отдаётся фасаду модели (bind), зеркало — ему (sync); удары по меткам и живые смычки под пальцем — action пластины (bridge.js; пока узла нет,
// ждут в очереди хоста). Метры — energy, voices, level из зеркала (~60/с). Обратно (listen) — что услышано:
// { t: 'step', r, m, time, hit } — играет шаг; { t: 'answer', note, at } — резонатор отзывается (ядро решает, отзывается ли: класс высоты ноты = основной тон).
import { F_MIN, noteName } from './core.js';
import { SLOT, M, toAction, parseHeard, parseAnswers, parseMirror, parseEcho } from './bridge.js';

export function createEngine(T, model, ver) {
  let k = null, echo = { chains: [], max: 0 };
  let energy = new Float32Array(24), level = 0, voices = [];
  const listeners = [], bowId = new Map();
  const heard = (e) => { for (const fn of listeners) fn(e); };
  const idOf = (id) => { if (!bowId.has(id)) bowId.set(id, bowId.size + 1); return bowId.get(id); };
  function send(msg) {                           // сообщение формата прежнего worklet → action ядра (t0 сетки — во времени контекста, abs)
    const a = toAction(msg, idOf);
    if (a && k) k.send({ t: 'action', slot: SLOT, kind: a.kind, i: a.i, a: a.a, abs: a.abs });
  }
  // сетка MIDI-часов — в ядре (там тики секвенсера); шлём при смене, не каждые 25 мс
  let lockSent = null;
  function syncLock() {
    if (!k) return;                              // ядра ещё нет (до первого build)
    const g0 = T.midiGrid(), g = g0 && g0.p > 0 ? g0 : null, a = lockSent;   // сетка с p ≤ 0 — не сетка
    if (g ? a && a.t0 === g.t0 && a.p === g.p : !a) return;
    lockSent = g ? { t0: g.t0, p: g.p } : null;
    send(g ? { t: 'lock', t0: g.t0, p: g.p } : { t: 'lock', off: true });
  }
  T.onTick(syncLock);                            // таймер 25 мс + метроном из звукового потока
  model.onAct(syncLock);                         // и перед каждым действием модели: сетка — раньше пуска часов
  function build(ctx, input) {
    const out = ctx.createGain();
    out.gain.value = 2.5;                        // +8 дБ: пластина вровень с планетами Tenebrae (пики ловит общий ограничитель)
    out.connect(input);
    k = T.core; lockSent = null; bowId.clear();  // новый контекст — новый узел ядра, модель в нём с нуля (перезапуск звука после смены выхода)
    k.dry[SLOT].connect(out);
    k.listen(heardFrom);
    model.bind(k.send);                          // сцена — в новый узел целиком (высота, ручки тела, узор, смычки, ход)
    syncLock();                                  // новый узел — сетка заново
  }
  function heardFrom(d) {                        // ~60 раз в секунду: зеркало и услышанное
    const w = d.w && d.w[SLOT];
    if (!w) return;
    if (w.mirror.length >= 32) { const m = parseMirror(w.mirror); energy = m.energy; voices = m.voices; level = m.level; }
    if (w.mirror.length >= M.N) { model.sync(w.mirror, d.n); echo = parseEcho(w.mirror); }   // модель — в фасад (что ядро уже применило — по номеру сообщения)
    if (w.heard.length) {
      for (const e of parseHeard(w.heard)) heard(e);          // играет шаг — view мигает удар и ноту
      for (const e of parseAnswers(w.heard)) answer(e.semi);  // нота удара совпала с основным тоном — резонатор отзывается
    }
  }
  // резонатор отзывается (ядро решило: класс высоты ноты удара = основной тон пластины; гул звучит там же) — подпись ноты
  const answer = (semi) => heard({ t: 'answer', note: noteName(F_MIN * 2 ** (semi / 12)), at: performance.now() });
  function on(e) {                               // событие модели → ядро
    if (e.t === 'seq') {
      syncLock();                                // сетка — раньше действий узора: пуск часов сразу встаёт на узел (не ждёт следующих 25 мс)
    } else if (e.t === 'bow' || e.t === 'strike') send(e.msg);   // живой смычок под пальцем и удар по метке места — на уровне пластины; узор, высота, ручки, эхо, закреплённые смычки — в ядре, у модели
  }

  return {
    build, on, send,                               // send — только для отладки (t2d.cym.strike, bow)
    start() {},                                    // ядро всегда в сборке — заводить нечего
    listen(fn) { listeners.push(fn); },
    get ready() { return !!(k && k.ready); }, get energy() { return energy; }, get voices() { return voices; }, get level() { return level; },
    get echoMax() { return echo.max; }, get echoChains() { return echo.chains; },
  };
}
