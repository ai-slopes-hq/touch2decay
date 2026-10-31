import CoreGraphics
import Foundation

// геометрия картины (view.js:12-31): u — поперёк, v — вглубь (−1 у нижней рамки, 1 на горизонте)
struct ArcGeo {
  let W: Double, H: Double, top: Double, bot: Double, Ws: Double, cx: Double
  let fx0: Double, fx1: Double, Wh: Double, hor: Double, gb: Double, EL: Double
  let sun: (x: Double, y: Double, r: Double)

  init(W: Double, H: Double, topY: Double, safeBot: Double) {
    self.W = W; self.H = H
    top = topY + 6; bot = H - safeBot - 8
    Ws = min(W, (H - safeBot) * 0.62); cx = W / 2
    fx0 = cx - Ws / 2 + 7; fx1 = cx + Ws / 2 - 7; Wh = (fx1 - fx0) / 2 - 10
    hor = top + max(64, (bot - top) * 0.17); gb = bot - 40
    EL = (gb - hor) * 0.14
    sun = (W, topY + 2, min(42, W * 0.11))
  }
  init(_ W: Double, _ H: Double, _ topY: Double, _ safeBot: Double) { self.init(W: W, H: H, topY: topY, safeBot: safeBot) }

  func proj(_ u: Double, _ v: Double) -> (x: CGFloat, y: CGFloat, s: CGFloat) {
    let t = (v + 1) / 2, q = 1 / (1 + Arc.k * t)
    return (CGFloat(cx + u * Wh), CGFloat(hor + (gb - hor) * (q - Arc.q1) / (1 - Arc.q1)), CGFloat(q))
  }

  func unproj(_ x: CGFloat, _ y: CGFloat) -> (u: Double, v: Double) {
    let q = Arc.q1 + min(1, max(0, (Double(y) - hor) / (gb - hor))) * (1 - Arc.q1)
    return ((Double(x) - cx) / Wh, 2 * ((1 / q - 1) / Arc.k) - 1)
  }

  func at(_ zAt: (Double, Double) -> Double, _ u: Double, _ v: Double) -> CGPoint {
    let p = proj(u, v)
    return CGPoint(x: p.x, y: p.y - CGFloat(max(0, zAt(u, v)) * EL * Double(p.s)))
  }

  // луч от нас вглубь до первой земли выше точки; nil — небо
  func pick(_ zAt: (Double, Double) -> Double, _ x: CGFloat, _ y: CGFloat) -> (u: Double, v: Double)? {
    let u = min(1, max(-1, (Double(x) - cx) / Wh))
    for k in 0...300 {
      let v = -1 + 2 * Double(k) / 300
      if at(zAt, u, v).y <= y { return (u, v) }
    }
    return nil
  }

  // петля на земле; пишет в предвыделенный буфер, возвращает n + 1
  func loopPts(_ zAt: (Double, Double) -> Double, fig: Int, u: Double, v: Double, r: Double, n: Int, into buf: inout [CGPoint]) -> Int {
    for k in 0...n {
      let (du, dv) = Arc.figPt(fig, Double(k) / Double(n) * 2 * .pi)
      let p = at(zAt, u + r * du, v + r * dv / Arc.asp)
      if k < buf.count { buf[k] = p } else { buf.append(p) }
    }
    return n + 1
  }
}
