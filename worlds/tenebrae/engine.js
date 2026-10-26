// Звук Tenebrae (мир I) — в ядре SDK (core/worlds/tenebrae → t2d.wasm, узел хоста core, слот 1). Здесь — тонкий клей с прежним API «действий»:
// модель (app.js) шлёт поля голоса, связи, LFO и FX, клей переводит их в {t:'action', slot: 1, kind, i, a} (коды — enum Act в world.hpp).
// Сухой выход мира — в канал микшера мира I; посыл в общий зал, фейдер посыла, шина (1/√Σ огибающих), лад — в ядре.
// Из ядра обратно — только зеркало: [6, по голосу: live, env, 128 точек контура] → scope(i). Клей помнит последнее действие каждого вида
// по голосу: после смены аудиоконтекста bind() шлёт новому ядру всё заново. Эталон прежнего движка на узлах Web Audio — tools/ref/tenebrae-engine.js.

// коды действий — те же числа, что enum Act в core/worlds/tenebrae/world.hpp
export const ACT = { VOICE: 0, ON: 1, OFF: 2, LIVE: 3, LINKS: 4, LFO: 5, FX: 6, STRIKE: 7, CLEAR: 8 };
export const LINK_TYPES = ['fm', 'tzfm', 'am', 'rm'];
export const LFO_KEYS = ['pitch', 'wave', 'cut', 'res', 'beat', 'shift', 'amp', 'fm'];

export const RES_MAX = 24;       // res: Q фильтра в дБ (как в ядре) — для подписей и LFO res на поле
export const DLY_REPEATS = 0.46; // обратная связь дилея (как в ядре) — для эха на поле
const SLOT = 1, VOICES = 6, SCOPE_N = 128;
const M_HEAD = 1, M_V = 2 + SCOPE_N;   // зеркало: MIRROR_HEAD, MIRROR_V

// core — ядро хоста (host/audio.js: send, dry, listen); out — вход канала мира I
export function createEngine({ core, out }) {
  let k = null, dryTo = null, mir = null;
  const vo = new Array(VOICES).fill(null);              // последний VOICE: 11 чисел (null — ещё не присылали)
  const lv = new Array(VOICES).fill(false);             // LIVE
  const up = new Array(VOICES).fill(false);             // последним было ON (а не OFF)
  const lk = Array.from({ length: VOICES }, () => []);  // LINKS: плоский [src, type, depth] × k
  const lf = Array.from({ length: VOICES }, () => new Map());   // LFO: код ключа → [key, morph, rate, depth]
  let fxA = null;
  const pts = Array.from({ length: VOICES }, () => new Float32Array(SCOPE_N));

  const act = (kind, i, a) => { if (k) k.send({ t: 'action', slot: SLOT, kind, i, a }); };
  const same = (a, b) => a.length === b.length && a.every((x, j) => x === b[j]);
  const mirrorFrom = (d) => { const w = d.w && d.w[SLOT]; if (w && w.mirror) mir = w.mirror; };

  const E = {
    // новое ядро (после смены аудиоконтекста — новый узел и пустой мир в нём): сухой выход — в канал, и всё, что помним, — заново.
    // Порядок как у solBuild в вебе: FX; LIVE раньше полей и ON (ядро ставит неживому голосу цели без хода — ON до LIVE дал бы скачок);
    // связи и LFO всех голосов — до полей; поля — со snap; ON — тем, у кого последним был ON
    bind({ core: c, out: o }) {
      if (dryTo) { try { k.dry[SLOT].disconnect(dryTo); } catch (_) { /* старый контекст закрыт */ } }
      k = c; dryTo = o; mir = null;
      k.dry[SLOT].connect(o);
      k.listen(mirrorFrom);
      if (fxA) act(ACT.FX, 0, fxA);
      for (let i = 0; i < VOICES; i++) if (lv[i]) act(ACT.LIVE, i, [1]);
      for (let i = 0; i < VOICES; i++) {
        if (lk[i].length) act(ACT.LINKS, i, lk[i]);
        for (const a of lf[i].values()) act(ACT.LFO, i, a);
      }
      for (let i = 0; i < VOICES; i++) if (vo[i]) { const a = vo[i].slice(); a[10] = 1; act(ACT.VOICE, i, a); }
      for (let i = 0; i < VOICES; i++) if (lv[i] && up[i]) act(ACT.ON, i, []);
    },
    // v — поля голоса модели: x, y, cut, res, wave, beat (Гц), fm, shift, amp, holeT, snap
    voice(i, v) {
      const a = [v.x, v.y, v.cut, v.res, v.wave, v.beat, v.fm, v.shift, v.amp, v.holeT, v.snap ? 1 : 0];
      vo[i] = a;
      act(ACT.VOICE, i, a);
    },
    on(i) { up[i] = true; act(ACT.ON, i, []); },
    off(i, tau) { up[i] = false; act(ACT.OFF, i, [tau]); },
    // молчащий кружок в ядре не считается
    live(i, on) {
      if (!!on === lv[i]) return;
      lv[i] = !!on;
      act(ACT.LIVE, i, [on ? 1 : 0]);
    },
    // mods — все связи приёмника i: [{ src (номер голоса), type ('fm' | 'tzfm' | 'am' | 'rm' или его номер), depth }]
    links(i, mods) {
      const a = [];
      for (const q of mods) a.push(q.src, typeof q.type === 'number' ? q.type : LINK_TYPES.indexOf(q.type), q.depth);
      if (same(a, lk[i])) return;
      lk[i] = a;
      act(ACT.LINKS, i, a);
    },
    // key — 'pitch' … 'fm' или его номер; spec — { morph, rate, depth } или null (снять: depth 0)
    lfo(i, key, spec) {
      const c = typeof key === 'number' ? key : LFO_KEYS.indexOf(key);
      if (c < 0 || c >= LFO_KEYS.length) return;
      const m = lf[i];
      if (!spec) {
        if (!m.has(c)) return;
        m.delete(c);
        act(ACT.LFO, i, [c, 0, 0, 0]);
        return;
      }
      const a = [c, spec.morph, spec.rate, spec.depth], was = m.get(c);
      if (was && same(a, was)) return;
      m.set(c, a);
      act(ACT.LFO, i, a);
    },
    fx({ rev, dly, dirt }) { fxA = [rev, dly, dirt]; act(ACT.FX, 0, fxA); },
    strike(p) { act(ACT.STRIKE, 0, [p]); },
    // корзина: ядро снимает связи всех и гасит живых за четверть секунды (LFO снимает модель, когда голос умолкнет)
    clear() {
      for (let i = 0; i < VOICES; i++) { lk[i] = []; if (lv[i]) up[i] = false; }
      act(ACT.CLEAR, 0, []);
    },
    busEnv() { /* шину по огибающим ядро считает само */ },
    // контур кружка: 128 точек из последнего зеркала (≈ 60 раз в секунду); голос не живой или без полей — null
    scope(i) {
      if (!mir || !vo[i]) return null;
      const b = M_HEAD + i * M_V;
      if (!mir[b]) return null;
      const p = pts[i];
      for (let j = 0; j < SCOPE_N; j++) p[j] = mir[b + 2 + j] || 0;
      return p;
    },
    dispose() { if (dryTo) { try { k.dry[SLOT].disconnect(dryTo); } catch (_) { /* ok */ } dryTo = null; } k = null; },
  };
  E.bind({ core, out });
  return E;
}
