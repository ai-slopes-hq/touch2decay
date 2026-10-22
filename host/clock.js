// метроном секвенсоров: подписчики onTick (планировщики Portus, Natura, автострама Monochordum) зовутся каждые 25 мс — от таймера
// и от звукового потока (clock-worklet.js). В фоне iOS будит таймеры скрытой страницы раз в секунду, а шаги ставятся на 200 мс
// вперёд — опоздавшие пропадали; звуковой поток в фоне идёт, его тик доходит. Таймер остаётся: пока worklet не поднялся или не поднимется
export const TICK_MS = 25;
const subs = new Set();
let ver = '0', cur = null, node = null;

export const setClockVer = (v) => { ver = v; };
export const onTick = (fn) => { subs.add(fn); };
export const clockLive = () => !!node;
function tick() {
  for (const fn of subs) {
    try { fn(); } catch (err) { console.error('tick:', err); }
  }
}
const timer = setInterval(tick, TICK_MS);
if (timer.unref) timer.unref();                         // Node (тесты): таймер не держит процесс

export function startClock(ctx) {                       // на каждом новом контексте (build); старый метроном — отцепить
  if (node) { node.port.onmessage = null; node.disconnect(); node = null; }
  cur = ctx;
  ctx.audioWorklet.addModule(`clock-worklet.js?v=${ver}`).then(() => {
    if (cur !== ctx) return;
    node = new AudioWorkletNode(ctx, 'clock', { numberOfInputs: 0, outputChannelCount: [1] });
    const mute = ctx.createGain(); mute.gain.value = 0;
    node.connect(mute).connect(ctx.destination);          // без выхода в граф узел может не считаться
    node.port.onmessage = tick;
  }).catch(() => {});                                   // нет worklet — остаётся таймер
}
