// Метроном (host/clock.js): каждые 25 мс звукового времени — сообщение странице. iOS будит таймеры скрытой страницы раз в секунду,
// звуковой поток — нет: от этого тика планировщики секвенсоров ставят шаги и в фоне. Выход — тишина.
class Clock extends AudioWorkletProcessor {
  constructor() { super(); this.n = 0; this.every = Math.round(sampleRate * 0.025); }
  process(inputs, outputs) {
    this.n += outputs[0][0] ? outputs[0][0].length : 128;
    if (this.n >= this.every) { this.n -= this.every; this.port.postMessage(1); }
    return true;
  }
}
registerProcessor('clock', Clock);
