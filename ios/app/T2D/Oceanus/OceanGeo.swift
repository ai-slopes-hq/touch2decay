import CoreGraphics

// геометрия Oceanus: портрет по центру; земля — круг Rd, океан до Ro, рамка ветров Rf (view.js:16-24)
struct OceanGeo {
  static let n = 64
  var W, H, top, bot, cx, cy, Ws, Ro, Rd, Rr, amp, Rf: CGFloat
  var sun: (x: CGFloat, y: CGFloat, r: CGFloat)

  init(W: CGFloat, H: CGFloat, topY: CGFloat, safeBot: CGFloat) {
    self.W = W; self.H = H
    top = topY + 6; bot = H - safeBot - 8
    let h = bot - top
    Ws = min(W, (H - safeBot) * 0.62); cx = W / 2; cy = top + h * 0.5
    Ro = min(Ws / 2 - 42, h * 0.34); Rd = Ro * 0.62
    Rr = (Rd + Ro) / 2 + Ro * 0.04; amp = (Ro - Rd) * 0.42; Rf = Ro + 16
    sun = (0, topY + 2, min(56, Ws * 0.15))
  }

  // угол от верха по часовой, 0…2π
  func polar(_ x: CGFloat, _ y: CGFloat) -> (d: CGFloat, a: CGFloat) {
    let a = (atan2(x - cx, -(y - cy)) + 2 * .pi).truncatingRemainder(dividingBy: 2 * .pi)
    return (hypot(x - cx, y - cy), a)
  }
  func at(_ a: Double, _ r: CGFloat) -> CGPoint { CGPoint(x: cx + CGFloat(sin(a)) * r, y: cy - CGFloat(cos(a)) * r) }
  // радиус поверхности кольца в угле a: форма — 64 точки, линейно между ними
  func surf(_ shape: [Double], _ a: Double) -> CGFloat {
    let n = OceanGeo.n, p = a / (2 * .pi) * Double(n), i = Int(p.rounded(.down)), u = p - Double(i)
    guard shape.count >= n else { return Rr }
    let s0 = shape[((i % n) + n) % n], s1 = shape[(((i + 1) % n) + n) % n]
    return Rr + amp * CGFloat(s0 * (1 - u) + s1 * u)
  }
  func moonPos(_ moon: Double) -> CGPoint { at(moon * 2 * .pi, Rf + 22) }
}
