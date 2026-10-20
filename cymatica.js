// Cymatica — мир II: звучащая пластина Хладни. Пока пустая пластина и резонатор Гельмгольца в углу;
// звук, песок и астролябия — следующие подпроекты (docs/superpowers/specs/2026-10-20-cymatica-design.md).
(() => {
  'use strict';
  const T = window.T2D;

  // ---------- пластина: круг посередине, под строкой кнопок ----------
  function plateGeo() {
    const top = T.topY, bot = T.H - T.safeBot;
    return { cx: T.W / 2, cy: top + (bot - top) / 2, r: Math.min(T.W / 2 - 44, (bot - top) / 2 - 44) };
  }

  // ---------- рисование: строгая гравюра, как Sol Niger ----------
  // край пластины — двойная линия с засечками через 6°
  function drawPlate() {
    const g = T.g, { cx, cy, r } = plateGeo();
    T.ring(cx, cy, r, 0.55, 1);
    T.ring(cx, cy, r + 3, 0.25, 1);
    g.strokeStyle = T.ink(0.3); g.lineWidth = 1;
    g.beginPath();
    for (let d = 0; d < 360; d += 6) {
      const a = (d * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
      g.moveTo(cx + c * (r + 3), cy + s * (r + 3)); g.lineTo(cx + c * (r + 7), cy + s * (r + 7));
    }
    g.stroke();
  }

  // резонатор Гельмгольца: латунный шар с горлышком, выступает из правого нижнего угла на четверть;
  // как солнце, дышит громкостью: линии ярче, у горлышка дрожит воздух
  function drawResonator() {
    const g = T.g, x = T.W, y = T.H - T.safeBot, L = T.level, a = 0.45 + 0.4 * L;
    g.fillStyle = T.BG; g.beginPath(); g.arc(x, y, 36, 0, Math.PI * 2); g.fill();
    T.ring(x, y, 34, a, 1);
    T.ring(x, y, 30, a * 0.5, 0.8);
    g.strokeStyle = T.ink(a * 0.35); g.lineWidth = 0.8;   // штриховка дугами — объём шара
    for (let k = 1; k <= 5; k++) { g.beginPath(); g.arc(x + k * 2, y + k * 2, 30 - k * 4, Math.PI, Math.PI * 1.5); g.stroke(); }
    // горлышко — к центру экрана (вверх-влево)
    const dx = -Math.SQRT1_2, dy = -Math.SQRT1_2, px = Math.SQRT1_2, py = -Math.SQRT1_2, w = 5, n0 = 33, n1 = 50;
    g.strokeStyle = T.ink(a); g.lineWidth = 1;
    g.beginPath();
    for (const s of [-1, 1]) { g.moveTo(x + dx * n0 + px * w * s, y + dy * n0 + py * w * s); g.lineTo(x + dx * n1 + px * w * s, y + dy * n1 + py * w * s); }
    g.stroke();
    g.beginPath(); g.ellipse(x + dx * n1, y + dy * n1, w, w * 0.45, Math.atan2(py, px), 0, Math.PI * 2); g.stroke();
    for (let k = 1; k <= 2; k++) {                     // воздух в горлышке — дуги у устья, видны, пока звучит
      if (L < 0.03) break;
      g.strokeStyle = T.ink(L * (0.5 - 0.2 * k)); g.beginPath();
      g.arc(x + dx * n1, y + dy * n1, w + 4 * k, Math.PI * 0.95, Math.PI * 1.55); g.stroke();
    }
  }

  // ---------- мир ----------
  const cymatica = {
    n: 'II', title: 'Cymatica', sub: 'figurae sonorae',
    corner: { hit: (f) => Math.hypot(f.x - T.W, f.y - (T.H - T.safeBot)) < 46, draw: drawResonator },
    fx: null,                                         // веер пластины — в подпроекте 2
    draw() {
      const g = T.g;
      g.fillStyle = T.BG; g.fillRect(0, 0, T.W, T.H);
      drawPlate();
      drawResonator();
    },
    down() {}, move() {}, up() {},
    dice() {}, clear() {},
    snapshot: () => '{}', restore() {},
    sounding: () => false,
  };
  T.registerWorld(2, cymatica);
})();
