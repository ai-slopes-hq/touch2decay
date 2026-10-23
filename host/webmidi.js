// Web MIDI (компьютер, Android): байты часов с MIDI-входов → ядро (разбор и сетка — core/sdk/transport.hpp; host/midi.js byte).
// На iPhone Web MIDI нет (WebKit) — там часы даёт оболочка. Включается строкой «midi clock» в панели audio, помнится в audioPref.
import { audioPref, saveAudioPref } from './audio.js';

export const webMidi = () => typeof navigator !== 'undefined' && !!navigator.requestMIDIAccess;
export const midiIn = { state: 'off', names: [] };    // off | wait (спрашиваем разрешение) | on | denied
let access = null, send = () => {};
const srcs = new Map();                               // у каждого входа свой номер — и свой счёт тиков в ядре

function onMsg(ev) {
  const s = ev.data[0];
  if (s < 0xF8) return;                               // только системные реального времени
  if (!srcs.has(ev.target)) srcs.set(ev.target, srcs.size % 8);
  const now = performance.now(), ts = ev.timeStamp > 0 && ev.timeStamp <= now + 5 ? ev.timeStamp : now;   // timeStamp — часы performance.now; иное — время прихода
  send(srcs.get(ev.target), s, (now - ts) / 1000);
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
export function initWebMidi(fn) {                     // fn(src, байт, ago) — приёмник (midi.byte); включено в прошлый раз — подключиться снова
  send = fn;
  if (webMidi() && audioPref.midi) setWebMidi(true);
}
