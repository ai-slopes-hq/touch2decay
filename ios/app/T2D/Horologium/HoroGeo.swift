import CoreGraphics
import Foundation

// геометрия Horologium: циферблат сверху, под ним отношение; ниже свободная зона под пэды
struct HoroGeo {
  var W, H, top, bot, cx, cy, R, r0, dr, Ws, ty: CGFloat
  var padStep, padY0, padY1, padR: CGFloat                   // пэды в два ряда по 4: шаг по x (зона ≥ 44 pt), центр кружков верхнего и нижнего ряда по y, радиус кружка
  static let padCols = 4, padRow: CGFloat = 72               // колонок в ряду; шаг рядов по y
  var sun: (x: CGFloat, y: CGFloat, r: CGFloat)

  init(W: CGFloat, H: CGFloat, topY: CGFloat, safeBot: CGFloat) {
    self.W = W; self.H = H
    top = topY + 6; bot = H - safeBot - 8
    Ws = min(W, (H - safeBot) * 0.62); cx = W / 2
    R = min(Ws * 0.45, (bot - top - 165 - HoroGeo.padRow) / 2); cy = top + 26 + R
    r0 = R * 0.17; dr = (R - 22 - r0) / CGFloat(Horo.nr - 1)
    ty = cy + R + 46
    padStep = min(max(Ws * 0.9 / 4, 44), W / 4); padR = min(20, padStep * 0.3); padY1 = bot - 40; padY0 = padY1 - HoroGeo.padRow
    sun = (W, topY + 2, min(42, W * 0.11))
  }

  func ringR(_ i: Int) -> CGFloat { r0 + CGFloat(i) * dr }
  func ringAt(_ x: CGFloat, _ y: CGFloat) -> Int? {
    let d = hypot(x - cx, y - cy), i = Int(((d - r0) / dr + 0.5).rounded(.down))
    return i >= 0 && i < Horo.nr && abs(d - ringR(i)) < dr * 0.62 ? i : nil
  }

  // пэды II…IX — по одному на кольцо, два ряда по 4 (II…V сверху, VI…IX снизу); зона — прямоугольник шага от верха кружка до низа подписи
  func padX(_ i: Int) -> CGFloat { cx + (CGFloat(i % HoroGeo.padCols) - CGFloat(HoroGeo.padCols - 1) / 2) * padStep }
  func padY(_ i: Int) -> CGFloat { i < HoroGeo.padCols ? padY0 : padY1 }
  func padAt(_ p: CGPoint) -> Int? {
    guard p.y >= padY0 - 22, p.y <= bot else { return nil }
    let k = ((p.x - cx) / padStep + CGFloat(HoroGeo.padCols) / 2).rounded(.down)
    guard k >= 0 && k < CGFloat(HoroGeo.padCols) else { return nil }
    return Int(k) + (p.y < (padY0 + padY1) / 2 ? 0 : HoroGeo.padCols)
  }
}
