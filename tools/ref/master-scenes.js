// Сцены сверки мастера (tools/master-bus.py): действия миров SDK (слот 10, Firmamentum) для core/build/mix-cli; веб получает уже готовую сумму ядра.
// Сцена — { secs, acts: [[t, slot, kind, i, a]] }; виды — enum Act и Fx в core/worlds/firmamentum (world.hpp, model.hpp).
export const SR = 48000;
const SLOT = 10;
export const ACT = { ADD: 0, CLOSE: 1, MOVE: 2, SET: 3, FX: 4, CLEAR: 5, DICE: 6, LAUNCH: 7 };
export const FX = { SCINTILLA: 0, DRIFT: 1, COMETA: 2, CREPITUS: 3, FULGUR: 4, SPREAD: 5, HALL: 6 };

const add = (h, u) => [0, SLOT, ACT.ADD, 0, [h, u]];
const fx = (k, v) => [0, SLOT, ACT.FX, k, [v]];

export const SCENES = {
  quiet: { secs: 6, acts: [add(0.3, 0.1)] },
  // шесть звезд по своду, треск, молния и зал выкручены: компрессор и колено работают
  full: { secs: 8, acts: [
    add(0.2, -0.5), add(0.35, -0.3), add(0.5, -0.1), add(0.65, 0.1), add(0.8, 0.3), add(0.95, 0.5),
    fx(FX.CREPITUS, 0.8), fx(FX.FULGUR, 1), fx(FX.HALL, 0.8)] },
  dice: { secs: 8, acts: [[0, SLOT, ACT.DICE, 0, []], fx(FX.COMETA, 1), [0, SLOT, ACT.LAUNCH, 0, []]] },
};

// stdin для mix-cli: у каждой строки act — все поля
export const cliInput = ({ secs, acts }) =>
  `secs ${secs}\n${acts.map(([t, slot, kind, i, a]) => `act ${t} ${slot} ${kind} ${i}${a.map((v) => ` ${v}`).join('')}\n`).join('')}`;
