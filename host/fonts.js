// два шрифта: красивое (поле, карта, названия миров) — IM Fell English; где читают — EB Garamond.
// face — текущее лицо для text() и mapText(); reading(fn) рисует fn шрифтом для чтения
export const MAP = '"IM Fell English", Georgia, "Times New Roman", serif';   // подписи на поле — как на старых звёздных картах
// где читают (легенда, плашки, concordia, микшер) — EB Garamond: спокойнее и разборчивее; красивое — IM Fell
export const READ = '"EB Garamond", Garamond, Georgia, serif';
export let face = MAP;
export const reading = (fn) => (...a) => { const was = face; face = READ; try { return fn(...a); } finally { face = was; } };
