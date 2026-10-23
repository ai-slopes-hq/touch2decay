// Cymatica — звук: пластина в plate-worklet.js (часы секвенсера — тоже там), зал, эхо по долям темпа, гул резонатора.
// События модели → сообщения worklet (пока узел грузится, ждут в очереди). Метры — energy, voices, level (из сообщения energy ~30/с).
// Обратно (listen) — что услышано: сообщение worklet { t: 'step', r, m, time, hit } — играет шаг; { t: 'answer', note, at } — резонатор отозвался.
import { F_MIN, noteName } from './core.js';

export function createEngine(T, model, ver) {
  const { plate, seq } = model.state;
  let node = null, ready = false, nodes = null, actx = null, entered = false, started = false;
  let energy = new Float32Array(24), level = 0, voices = [], echoBpm = 0;
  const queue = [], listeners = [];
  const heard = (e) => { for (const fn of listeners) fn(e); };
  function send(msg) { if (ready) node.port.postMessage(msg); else queue.push(msg); }
  // сетка MIDI-часов — в worklet (там тики секвенсера); шлём при смене, не каждые 25 мс
  let lockSent = null;
  function syncLock() {
    if (!started) return;                        // модуль пластины не заведён — слать некому (очередь не копим)
    const g0 = T.midiGrid(), g = g0 && g0.p > 0 ? g0 : null, a = lockSent;   // сетка с p ≤ 0 — не сетка
    if (g ? a && a.t0 === g.t0 && a.p === g.p : !a) return;
    lockSent = g ? { t0: g.t0, p: g.p } : null;
    send(g ? { t: 'lock', t0: g.t0, p: g.p } : { t: 'lock', off: true });
  }
  T.onTick(syncLock);                            // таймер 25 мс + метроном из звукового потока
  function sendParams() {
    const { structure, damping, brightness } = plate.fx;
    send({ t: 'params', structure, damping, brightness });
  }
  function applyFx() {
    if (!nodes) return;
    const t = T.ctx.currentTime;
    nodes.hallSend.gain.setTargetAtTime(plate.fx.hall * plate.fx.hall * 1.4, t, 0.05);
    nodes.echoSend.gain.setTargetAtTime(plate.fx.echo * 0.8, t, 0.05);
    const cur = echoes[echoes.length - 1];
    if (cur) for (const f of cur.fb) f.gain.setTargetAtTime(model.echoFb(), t, 0.05);
    retime();
  }
  // эхо: на каждую долю — своя пара линий крест-накрест. Сменил долю или темп — звук идёт в новую пару с точным временем,
  // старая больше не принимает и дозванивает своим (время задержки не едет — нет скрежета); живёт до 6 с, не больше 4 пар
  let echoes = [], echoAt = 0, echoTimer = 0;
  function echoPair(sec) {
    const ctx = actx, g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const inp = g(0), dL = ctx.createDelay(3), dR = ctx.createDelay(3), merge = ctx.createChannelMerger(2), outG = g(1);
    dL.delayTime.value = dR.delayTime.value = sec;
    const lp = (n) => { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 3000; n.connect(f); return f; };
    const fb = [g(model.echoFb()), g(model.echoFb())], fL = lp(dL), fR = lp(dR);
    inp.connect(dL); fL.connect(fb[0]).connect(dR); fR.connect(fb[1]).connect(dL);
    dL.connect(merge, 0, 0); dR.connect(merge, 0, 1); merge.connect(outG).connect(nodes.out);
    nodes.echoSend.connect(inp);
    inp.gain.setTargetAtTime(1, ctx.currentTime, 0.01);
    return { sec, inp, dL, dR, fb, outG, all: [inp, dL, dR, merge, outG, fL, fR, ...fb] };
  }
  function dropPair(p, fade) {
    const i = echoes.indexOf(p);
    if (i >= 0) echoes.splice(i, 1);
    if (p.gone) return;
    p.gone = true; clearTimeout(p.timer);
    p.inp.gain.setTargetAtTime(0, actx.currentTime, 0.01);
    p.outG.gain.setTargetAtTime(0, actx.currentTime, fade);
    setTimeout(() => { for (const n of p.all) n.disconnect(); }, fade * 6000);
  }
  function retime() {
    if (!nodes) return;
    const cur = echoes[echoes.length - 1], sec = model.echoSec(), now = performance.now();
    if (cur && Math.abs(cur.sec - sec) < 1e-4) return;
    clearTimeout(echoTimer);
    if (cur && now - echoAt < 90) { echoTimer = setTimeout(retime, 90 - (now - echoAt)); return; }   // тянешь луч или темп — не чаще 11 раз в секунду
    echoAt = now;
    if (cur) {
      cur.inp.gain.setTargetAtTime(0, actx.currentTime, 0.01);
      cur.timer = setTimeout(() => dropPair(cur, 0.3), 6000);
    }
    while (echoes.length >= 4) dropPair(echoes[0], 0.02);
    echoes.push(echoPair(sec));
  }
  function build(ctx, input) {
    const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const out = g(2.5);                          // +8 дБ: пластина вровень с планетами Tenebrae (пики ловит общий ограничитель)
    out.connect(input);
    // посыл — в пластинчатый ревербер ядра (T.send('plate')); прежний ×2.5 стоял после возврата зала (out) — он и здесь: hall²·1.4·2.5
    const hallSend = g(0);
    hallSend.connect(g(2.5)).connect(T.send('plate'));
    const echoSend = g(0);                       // эхо — пары линий в retime(), доля темпа с луча time (1/4d на 40 BPM — 2.25 с)
    nodes = { out, hallSend, echoSend };
    actx = ctx; echoes = [];                     // новый звуковой контекст — пары эха заводятся заново
    started = false; ready = false; node = null; lockSent = null;  // и модуль пластины — заново (перезапуск звука после смены выхода)
    applyFx();
    if (entered) start();
    send({ t: 'f0', hz: model.effF0() });
    sendParams();
    syncLock();                                  // новый узел — сетка заново
    for (const b of plate.bows) send(model.bowMsg(b, true));
  }
  // модуль пластины — только когда в Cymatica впервые зашли и звук уже есть: тем, кто играет лишь в Tenebrae, он ничего не стоит
  function start() {
    if (started || !actx) return;
    started = true;
    const ctx = actx;
    ctx.audioWorklet.addModule(`plate-worklet.js?v=${ver}`).then(() => {
      node = new AudioWorkletNode(ctx, 'plate', { numberOfInputs: 0, outputChannelCount: [2] });
      node.connect(nodes.out); node.connect(nodes.hallSend); node.connect(nodes.echoSend);
      node.port.onmessage = (e) => onMsg(e.data);
      ready = true;
      for (const m of queue.splice(0)) node.port.postMessage(m);
    });
  }
  function enter() { entered = true; start(); }  // вход в мир: модуль пластины заводится (и после перезапуска звука — тоже)
  function onMsg(d) {
    if (d.t === 'step') {                        // играет шаг — view мигает удар и ноту; нота своя — резонатор отзывается
      heard(d);
      if (seq.rhythm.steps[d.r] && d.hit !== false && seq.melody.steps[d.m]) {
        const n = model.state.sentSeq && model.state.sentSeq.melody.steps[d.m];
        if (n) answer(n.s);
      }
      return;
    }
    if (d.t === 'energy') { voices = d.voices; energy = d.e; level = d.voices.reduce((s, v) => s + v.level, 0); }   // формы мод (shapes) больше не нужны: песка нет
  }
  // резонатор отзывается: нота удара совпала с его собственной (класс высоты основного тона пластины) — тихий гул и подпись ноты
  let answerLast = 0;
  function answer(semi) {
    const own = Math.round(model.fs());
    if (((semi - own) % 12 + 12) % 12 !== 0) return;
    const now = performance.now();
    heard({ t: 'answer', note: noteName(F_MIN * 2 ** (semi / 12)), at: now });
    if (!nodes || !actx || now - answerLast < 250) return;
    answerLast = now;
    const t = actx.currentTime, o = actx.createOscillator(), o2 = actx.createOscillator(), gn = actx.createGain();
    const hz = F_MIN * 2 ** (own / 12);
    o.frequency.value = hz / 2; o2.frequency.value = hz; o2.detune.value = 4;
    gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(0.05, t + 0.15); gn.gain.exponentialRampToValueAtTime(0.0001, t + 1.6); gn.gain.linearRampToValueAtTime(0, t + 1.62);
    o.connect(gn); o2.connect(gn); gn.connect(nodes.out); gn.connect(nodes.hallSend);
    o.start(t); o2.start(t); o.stop(t + 1.65); o2.stop(t + 1.65);
    o.onended = () => { o.disconnect(); o2.disconnect(); gn.disconnect(); };
  }
  function on(e) {                               // событие модели → worklet
    if (e.t === 'seq') {
      syncLock();                                // сетка — раньше узора: пуск в worklet сразу встаёт на узел (не ждёт следующих 25 мс)
      send(e.msg);
      if (nodes && echoBpm !== seq.bpm) { echoBpm = seq.bpm; applyFx(); }   // эхо идёт за темпом
    } else if (e.t === 'f0') send({ t: 'f0', hz: e.hz });
    else if (e.t === 'params') sendParams();
    else if (e.t === 'fx') applyFx();
    else if (e.t === 'bow') send(e.msg);
    else if (e.t === 'strike') { send(e.msg); if (e.answer != null) answer(e.answer); }
  }

  return {
    build, on, send,                               // send — только для отладки (t2d.cym.strike, bow)
    start: enter,
    listen(fn) { listeners.push(fn); },
    get ready() { return ready; }, get energy() { return energy; }, get voices() { return voices; }, get level() { return level; },
    get echoMax() { return echoes.length ? echoes[echoes.length - 1].dL.delayTime.maxValue : 0; },
    get echoChains() { return echoes.map((p) => ({ sec: p.sec, real: p.dL.delayTime.value })); },
  };
}
