import CoreGraphics
import Foundation

// геометрия Horologium: циферблат сверху, под ним отношение и шкала tempus, ниже маятник (view.js:11-24)
struct HoroGeo {
  var W, H, top, bot, cx, cy, R, r0, dr, Ws, ty, L: CGFloat
  var strip: (x0: CGFloat, x1: CGFloat, y: CGFloat)
  var piv: CGPoint
  var bob: CGFloat = 13
  var sun: (x: CGFloat, y: CGFloat, r: CGFloat)

  init(W: CGFloat, H: CGFloat, topY: CGFloat, safeBot: CGFloat) {
    self.W = W; self.H = H
    top = topY + 6; bot = H - safeBot - 8
    Ws = min(W, (H - safeBot) * 0.62); cx = W / 2
    R = min(Ws * 0.44, (bot - top) * 0.23); cy = top + 26 + R
    r0 = R * 0.17; dr = (R - 22 - r0) / CGFloat(Horo.nr - 1)
    ty = cy + R + 46
    let sy = ty + 56
    L = max(50, min(100, (bot - sy - 40) / 2 - 12))
    let py = max(sy + 30 + L, bot - L - 26)   // маятнику есть место перекинуться через верх, не задевая шкалу
    strip = (cx - Ws * 0.4, cx + Ws * 0.4, sy)
    piv = CGPoint(x: cx, y: py)
    sun = (W, topY + 2, min(42, W * 0.11))
  }

  func ringR(_ i: Int) -> CGFloat { r0 + CGFloat(i) * dr }
  func ringAt(_ x: CGFloat, _ y: CGFloat) -> Int? {
    let d = hypot(x - cx, y - cy), i = Int(((d - r0) / dr + 0.5).rounded(.down))
    return i >= 0 && i < Horo.nr && abs(d - ringR(i)) < dr * 0.62 ? i : nil
  }
  func bobXY(_ th: Double) -> CGPoint { CGPoint(x: piv.x + CGFloat(sin(th)) * L, y: piv.y + CGFloat(cos(th)) * L) }
  func stripX(_ F: Double) -> CGFloat {
    strip.x0 + (strip.x1 - strip.x0) * CGFloat(Horo.clamp(log(F / Horo.flo) / log(Horo.fhi / Horo.flo)))
  }
  // шкала tempus: место → скорость, в октавах относительно темпа Ft
  func uOfX(_ x: CGFloat, Ft: Double) -> Double {
    let t = Horo.clamp(Double((x - strip.x0) / (strip.x1 - strip.x0)))
    return log2(Horo.flo * pow(Horo.fhi / Horo.flo, t) / Ft)
  }
}
