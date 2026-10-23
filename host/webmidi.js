// Web MIDI (компьютер, Android): часы с MIDI-входов → window.t2dMidi, те же сообщения, что шлёт оболочка iOS.
// На iPhone Web MIDI нет (WebKit) — там часы даёт оболочка. Включается строкой «midi clock» в панели audio, помнится в audioPref.
import { audioPref, saveAudioPref } from './audio.js';
import { clockParser } from './midi.js';

export const webMidi = () => typeof navigator !== 'undefined' && !!navigator.requestMIDIAccess;
export const midiIn = { state: 'off', names: [] };    // off | wait (спрашиваем разрешение) | on | denied
let access = null, send = () => {};
const parsers = new Map();                            // у каждого входа свой счёт тиков

function onMsg(ev) {
  const s = ev.data[0];
  if (s < 0xF8) return;                               // только системные реального времени
  let p = parsers.get(ev.target);
  if (!p) parsers.set(ev.target, (p = clockParser((m, at) => send({ ...m, ago: performance.now() / 1000 - at }))));
  const now = performance.now(), ts = ev.timeStamp > 0 && ev.timeStamp <= now + 5 ? ev.timeStamp : now;   // timeStamp — часы performance.now; иное — время прихода
  p(s, ts / 1000);
}
function hook() {                                     // входы появились / пропали — переподписаться
  midiIn.names = [];
  for (const inp of access.inputs.values()) {
    const on = midiIn.state === 'on' && inp.state !== 'disconnected';
    inp.onmidimessage = on ? onMsg : null;
    if (on) midiIn.names.push(inp.name);
  }
}
async function setWebMidi(on) {
  audioPref.midi = on; saveAudioPref();
  if (!on) { midiIn.state = 'off'; if (access) hook(); return; }
  midiIn.state = 'wait';
  try { access = access || (await navigator.requestMIDIAccess()); }
  catch (_) { midiIn.state = 'denied'; audioPref.midi = false; saveAudioPref(); return; }   // отказ — не спрашивать на каждом запуске
  if (!audioPref.midi) return;                        // выключили, пока ждали ответа
  midiIn.state = 'on'; access.onstatechange = hook; hook();
}
export const toggleWebMidi = () => setWebMidi(midiIn.state !== 'on' && midiIn.state !== 'wait');
export function initWebMidi(fn) {                     // fn — приёмник сообщений (midi.message); включено в прошлый раз — подключиться снова
  send = fn;
  if (webMidi() && audioPref.midi) setWebMidi(true);
}
