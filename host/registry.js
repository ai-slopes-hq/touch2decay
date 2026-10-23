// реестр миров: номер → мир, навигация (карта или мир на экране), выключенные миры
export const ENTER = new Set([1, 2]);                          // куда можно влететь; III и IV — пока бледные nondum
// view: play | map; anim: { t0, dir: 'out' | 'in', w }
export const nav = { view: 'map', world: 1, anim: null, settings: false };   // приложение открывается на карте
export const worlds = {};                                      // номер четверти → мир
export const cur = () => worlds[nav.world];
// кто ещё хочет знать о новом мире (история отмены) — onRegister.push((n, w) => …)
export const onRegister = [];

// выключенные миры (автор, 22.10): номера за ними, код на месте — не регистрируются: нет на карте (рубашка), в микшере, звуке, легенде.
// Вернуть мир — убрать его номер отсюда.
export const HIDDEN = new Set([3, 6, 17, 18]), hiddenW = {};   // 6 — Paradisus в архиве (23.10: «не очень интересный, звук всегда проблемный»); 17, 18 — DLC vol. I в бэклоге (22.10: «скучные»)
export function registerWorld(n, w) {
  if (HIDDEN.has(n)) { hiddenW[n] = w; return; }
  if (n > 2) ENTER.add(n);                     // III и IV — модули-эскизы: пока без звука, но в них можно влететь
  worlds[n] = w;
  for (const f of onRegister) f(n, w);
}
