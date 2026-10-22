// ---------- нагрузка: Safari не отдаёт ни CPU, ни память, поэтому три косвенных признака ----------
import { ctx } from './audio.js';
import { BG, g, scopeY } from './draw.js';
import { TITLE_X, titleW } from './ui-top.js';
import { clamp } from './util.js';
// 1) сколько миллисекунд реально уходит на кадр (не частота кадров — энергосбережение её режет вдвое);
// 2) отстают ли звуковые часы от настоящих — звук не успевает считаться, значит трещит;
// 3) сколько звукового графа сейчас живо относительно предела. Берём худшее, растёт быстро, отходит медленно
// сколько звукового графа живо относительно предела (0..1+) — даёт мир I (app.js)
let graphLoad = () => 0;
export function setGraphLoad(fn) { graphLoad = fn; }
export const strain = { work: 2, lvl: 0, ctxT: 0, wallT: 0, drift: 1, prev: 1, since: 0 };
export function measureStrain(now, workMs) {
  strain.work += (workMs - strain.work) * 0.05;
  // звуковые часы: первые 3 с после запуска не в счёт (старт идёт с задержкой);
  // отставание засчитывается, только если два двухсекундных окна подряд показали его
  if (ctx && ctx.state === 'running' && document.visibilityState === 'visible') {
    if (!strain.since) strain.since = now;
    if (now - strain.since < 3000) strain.wallT = 0;
    else if (!strain.wallT) { strain.wallT = now; strain.ctxT = ctx.currentTime; }
    else if (now - strain.wallT > 2000) {
      const span = (now - strain.wallT) / 1000;
      const r = span < 3 ? (ctx.currentTime - strain.ctxT) / span : 1;   // долгая пауза кадров — окно не мерило
      strain.drift = Math.max(r, strain.prev);
      strain.prev = r;
      strain.wallT = now; strain.ctxT = ctx.currentTime;
    }
  } else { strain.wallT = 0; strain.since = 0; strain.drift = 1; strain.prev = 1; }
  const graph = graphLoad();
  const cap = ctx && typeof ctx.renderCapacity === 'object' && ctx.renderCapacity.averageLoad;   // где есть (Chrome)
  const target = Math.max(
    clamp((strain.work - 6) / 10),                // кадр дороже 6 мс — тревожно, 16 — плохо
    clamp((0.99 - strain.drift) / 0.04),          // звук отстаёт на 1…5 %
    0.8 * clamp((graph - 0.7) / 0.45),            // граф у предела
    cap ? clamp((cap - 0.6) / 0.35) : 0,
  );
  strain.lvl += (target - strain.lvl) * (target > strain.lvl ? 0.08 : 0.01);
}

// индикатор нагрузки — маленький Сатурн в правом верхнем углу поля. До 80 % почти не виден,
// дальше проступает гуще; краснеет постепенно, вместе с нагрузкой
export function drawStrain() {
  const L = strain.lvl, x = TITLE_X + titleW + 16, y = scopeY + 20;   // в верхней строке, сразу за заголовком
  const vis = L < 0.8 ? 0.07 + 0.05 * (L / 0.8) : 0.12 + 0.88 * ((L - 0.8) / 0.2);
  const gb = Math.round(237 * (1 - L));
  const col = (a) => `rgba(237,${gb},${gb},${a})`;
  g.save(); g.translate(x, y); g.rotate(-0.42);
  g.lineWidth = 1;
  g.strokeStyle = col(vis * 0.6);             // задняя половина кольца
  g.beginPath(); g.ellipse(0, 0, 15, 4, 0, Math.PI, Math.PI * 2); g.stroke();
  g.restore();
  g.fillStyle = L > 0.8 ? `rgba(200,24,24,${0.9 * (L - 0.8) / 0.2})` : BG;
  g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill();
  g.strokeStyle = col(vis); g.lineWidth = 1 + 0.6 * clamp((L - 0.8) / 0.2);
  g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.stroke();
  g.save(); g.translate(x, y); g.rotate(-0.42);
  g.strokeStyle = col(vis); g.lineWidth = 1;  // передняя половина — поверх планеты
  g.beginPath(); g.ellipse(0, 0, 15, 4, 0, 0, Math.PI); g.stroke();
  g.restore();
}
