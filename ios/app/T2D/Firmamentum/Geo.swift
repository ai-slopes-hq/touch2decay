import CoreGraphics

// геометрия Firmamentum: земля внизу, купол над ней (view.js geo / toSky / fromSky)
struct Geo {
  var W, H, top, bot, cx, Ws, hy, RX, RY: CGFloat
  var sun: (x: CGFloat, y: CGFloat, r: CGFloat)

  init(W: CGFloat, H: CGFloat, topY: CGFloat, safeBot: CGFloat) {
    self.W = W; self.H = H
    top = topY + 6; bot = H - safeBot - 8
    Ws = min(W, (H - safeBot) * 0.62); cx = W / 2
    hy = bot - min(90, (bot - top) * 0.13)
    RX = Ws / 2 - 8
    RY = min(hy - top - 150, RX * 1.75)                 // свод — высокий купол; над ним — Эмпирей
    sun = (0, bot + 8, 58)                              // под землёй, в левом нижнем углу
  }

  func fromSky(h: Double, u: Double) -> CGPoint {
    let half = RX * CGFloat(max(0.001, 1 - h * h).squareRoot())
    return CGPoint(x: cx + CGFloat(u) * half * 0.94, y: hy - CGFloat(h) * RY)
  }

  // точка → (h, u): высота над горизонтом и место по своду; вне купола — nil
  func toSky(_ p: CGPoint) -> (h: Double, u: Double)? {
    let dy = hy - p.y, h = dy / RY, e = hypot((p.x - cx) / RX, h)
    if dy < 4 || e > 0.97 { return nil }
    let half = RX * max(0.001, 1 - h * h).squareRoot()
    return (min(max(Double(h), 0.02), 0.97), min(max(Double((p.x - cx) / (half * 0.94)), -1), 1))
  }
}
