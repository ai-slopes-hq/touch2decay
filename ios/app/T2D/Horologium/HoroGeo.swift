import CoreGraphics
import Foundation

// геометрия Horologium: циферблат сверху, под ним отношение; ниже свободная зона под пэды
struct HoroGeo {
  var W, H, top, bot, cx, cy, R, r0, dr, Ws, ty: CGFloat
  var padStep, padY, padR: CGFloat                           // ряд пэдов: шаг (зона ≥ 44 pt), центр кружков по y, радиус кружка
  var sun: (x: CGFloat, y: CGFloat, r: CGFloat)

  init(W: CGFloat, H: CGFloat, topY: CGFloat, safeBot: CGFloat) {
    self.W = W; self.H = H
    top = topY + 6; bot = H - safeBot - 8
    Ws = min(W, (H - safeBot) * 0.62); cx = W / 2
    R = min(Ws * 0.45, (bot - top - 165) / 2); cy = top + 26 + R
    r0 = R * 0.17; dr = (R - 22 - r0) / CGFloat(Horo.nr - 1)
    ty = cy + R + 46
    padStep = min(max(Ws * 0.8 / 8, 44), W / 8); padR = min(16, padStep * 0.36); padY = bot - 40
    sun = (W, topY + 2, min(42, W * 0.11))
  }

  func ringR(_ i: Int) -> CGFloat { r0 + CGFloat(i) * dr }
  func ringAt(_ x: CGFloat, _ y: CGFloat) -> Int? {
    let d = hypot(x - cx, y - cy), i = Int(((d - r0) / dr + 0.5).rounded(.down))
    return i >= 0 && i < Horo.nr && abs(d - ringR(i)) < dr * 0.62 ? i : nil
  }

  // пэды II…IX — по одному на кольцо; зона — прямоугольник шага на всю высоту от верха кружка до низа подписи
  func padX(_ i: Int) -> CGFloat { cx + (CGFloat(i) - CGFloat(Horo.nr - 1) / 2) * padStep }
  func padAt(_ p: CGPoint) -> Int? {
    guard p.y >= padY - 22, p.y <= bot else { return nil }
    let k = ((p.x - cx) / padStep + CGFloat(Horo.nr) / 2).rounded(.down)
    return k >= 0 && k < CGFloat(Horo.nr) ? Int(k) : nil
  }
}
