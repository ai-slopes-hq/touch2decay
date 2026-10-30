import CoreGraphics

// геометрия Monochordum: ящик монохорда по центру, струны сверху вниз; слева — сферы и роза ветров, справа — дуги и рука Бога (view.js:14-30)
struct MonoGeo {
  static let n = 4
  var W, H, Ws, top, bot, cx, y0, y1, sp, ye: CGFloat
  var xs: [CGFloat]
  var box: (x0: CGFloat, x1: CGFloat)
  var hand: (x: CGFloat, y: CGFloat, r: CGFloat)
  var aeolus: (x: CGFloat, y: CGFloat, r: CGFloat)
  var earth: (x: CGFloat, y: CGFloat, r: CGFloat)

  init(W: CGFloat, H: CGFloat, topY: CGFloat, safeBot: CGFloat) {
    self.W = W; self.H = H
    top = topY + 6; bot = H - safeBot - 8
    Ws = min(W, (H - safeBot) * 0.62); cx = W / 2
    let y0 = top + 40, y1 = bot - 64, sp = min(44, Ws * 0.11), cx = self.cx   // y0 — колки (рука Бога), y1 — нижний порожек (Земля)
    self.y0 = y0; self.y1 = y1; self.sp = sp
    let xs = (0..<MonoGeo.n).map { cx + (CGFloat($0) - CGFloat(MonoGeo.n - 1) / 2) * sp }
    self.xs = xs
    let box = (x0: xs[0] - sp * 0.7, x1: xs[MonoGeo.n - 1] + sp * 0.7), ye = y0 + 0.25 * (y1 - y0)   // ye — Эмпирей, верхний лад
    self.box = box; self.ye = ye
    let r = max(28, min(60, (W - box.x1) * 0.36)), hx = min(box.x1 + (W - box.x1) / 2, box.x1 + r * 1.7)
    hand = (hx, y0 + (ye - y0) * 0.45, r)                            // облако справа над дугами интервалов
    let ar = max(16, min(28, box.x0 * 0.3))
    aeolus = (max(ar * 1.3, box.x0 - ar * 2.4), y0 + (ye - y0) * 0.55, ar)   // роза ветров — слева над Эмпиреем
    earth = (cx, y1 + 96, min(70, Ws * 0.2))                         // Земля внизу: верх шара с горами
  }

  func yOfR(_ r: Double) -> CGFloat { y0 + CGFloat(r) * (y1 - y0) }  // подставка: звучит от колков (y0) до неё
  func rOfY(_ y: CGFloat) -> Double { min(1, max(0.25, Double((y - y0) / (y1 - y0)))) }
  func stringAt(_ x: CGFloat, _ y: CGFloat) -> Int? {
    if y < y0 - 10 || y > y1 + 14 { return nil }
    var best: Int?, bd = sp / 2 + 4
    for (i, sx) in xs.enumerated() { let d = abs(x - sx); if d < bd { bd = d; best = i } }
    return best
  }
}
