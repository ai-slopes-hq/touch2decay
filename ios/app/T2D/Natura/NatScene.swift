import UIKit

private let tau = Double.pi * 2
private let riverDash: [CGFloat] = [2, 5]
private let noDash: [CGFloat] = []

// кеши картинки: бумага (под небом) и земля с рамкой (поверх неба) — scene.js:51-67
final class NatLayers {
  private(set) var skyBuilds = 0, landBuilds = 0
  private(set) var sky: CGImage?, land: CGImage?
  private var skyKey: [Double]?, landKey: [Double]?

  // key веба: `W×H×DPR|top|bot|round(res·24)`. W, H бумаги — по size всего вида, как canvas() веба
  func update(_ G: NatGeo, size: CGSize, dpr: CGFloat, res: Double, ink: RGB, pap: RGB) {
    let sk = [Double(size.width), Double(size.height), Double(dpr)]
    let lk = sk + [G.top, G.bot, Horo.jsRound(res * 24)]
    if sk == skyKey && lk == landKey { return }
    var rnd = NatLCG()
    if sk != skyKey {
      skyKey = sk; skyBuilds += 1
      sky = NatLayers.canvas(size, dpr) { NatScene.paintSky(NatPen(g: $0, inkC: ink, papC: pap), w: G.W, h: G.H, rnd: &rnd) }
    } else {
      for _ in 0..<(260 * 3) { _ = rnd.next() }   // счёт крапа — без рисования, земля продолжает с того же места
    }
    landKey = lk; landBuilds += 1
    land = NatLayers.canvas(size, dpr) { NatScene.paintLand(NatPen(g: $0, inkC: ink, papC: pap), G, res: res, rnd: &rnd) }
  }

  // начало слева сверху, масштаб DPR; фон прозрачный (как canvas веба)
  private static func canvas(_ size: CGSize, _ dpr: CGFloat, _ draw: (CGContext) -> Void) -> CGImage? {
    guard let g = CGContext(data: nil, width: Int((size.width * dpr).rounded()), height: Int((size.height * dpr).rounded()), bitsPerComponent: 8,
                            bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue) else { return nil }
    g.translateBy(x: 0, y: CGFloat(g.height)); g.scaleBy(x: dpr, y: -dpr)
    draw(g)
    return g.makeImage()
  }
}

enum NatScene {
  // scene.js:59-63 — бумага и крап старой бумаги
  static func paintSky(_ p: NatPen, w: Double, h: Double, rnd: inout NatLCG) {
    p.fillPap(1); p.fillRect(0, 0, w, h)
    p.fillInk(0.05)
    for _ in 0..<260 {
      p.begin()
      let x = rnd.next() * w, y = rnd.next() * h, r = rnd.next() * 1.1
      p.arc(x, y, r, 0, tau); p.fill()
    }
  }

  // scene.js:70-74 — пучок травы
  private static func tuft(_ p: NatPen, _ X: Double, _ Y: Double, _ s: Double = 1) {
    p.begin()
    for d in [-2.0, -1, 0, 1, 2] {
      p.move(X + d * 0.7, Y)
      p.quad(X + d * 1.2 * s, Y - 4 * s, X + d * 3.4 * s, Y - (7 - abs(d) * 1.4) * s)
    }
    p.stroke()
  }

  // scene.js:75-85 — штриховка под клипом; сцена задаёт ширину и высоту холста T.W × T.H
  private static func hatchIn(_ p: NatPen, _ G: NatGeo, _ clip: () -> Void, _ ang: Double, _ step: Double, _ a: Double, _ w: Double = 0.7) {
    p.g.saveGState(); p.begin(); clip(); p.g.clip()
    p.line(a, w); p.begin()
    let L = hypot(G.W, G.H), c = cos(ang), s = sin(ang)
    var d = -L
    while d < L {
      let mx = G.W / 2 - s * d, my = G.H / 2 + c * d
      p.move(mx - c * L, my - s * L); p.to(mx + c * L, my + s * L)
      d += step
    }
    p.stroke(); p.g.restoreGState()
  }

  // scene.js:86-107 — хребет: свой LCG от seed
  private static func ridge(_ p: NatPen, _ G: NatGeo, _ base: Double, _ peaks: Int, _ hMin: Double, _ hMax: Double, _ a: Double, _ seed: Int64) {
    var rr = NatLCG(seed: seed)
    var pts: [(x: Double, y: Double)] = [(0, base)]
    for k in 0..<peaks {
      let px = (Double(k) + 0.5) / Double(peaks) * G.W + (rr.next() - 0.5) * 24
      let ph = hMin + rr.next() * (hMax - hMin)
      pts.append((px - ph * 0.75, base - ph * 0.15)); pts.append((px, base - ph)); pts.append((px + ph * 0.8, base - ph * 0.1))
    }
    pts.append((G.W, base))
    p.fillPap(1)
    p.begin(); p.move(0, G.H); for q in pts { p.to(q.x, q.y) }; p.to(G.W, G.H); p.close(); p.fill()
    p.line(a, 1.2)
    p.begin(); for (i, q) in pts.enumerated() { i > 0 ? p.to(q.x, q.y) : p.move(q.x, q.y) }; p.stroke()
    var k = 1
    while k + 2 < pts.count {    // тень на правом склоне и снег на вершине
      let (ax, ay) = pts[k + 1], (bx, by) = pts[k + 2], ph = base - ay
      hatchIn(p, G, { p.move(ax, ay); p.to(bx, by); p.to(bx, base); p.to(ax, base); p.close() }, 1.1, 3.2, a * 0.5)
      p.line(a * 0.8, 0.9)
      p.begin(); p.move(ax - ph * 0.2, ay + ph * 0.22); p.to(ax - ph * 0.08, ay + ph * 0.16); p.to(ax, ay + ph * 0.25)
      p.to(ax + ph * 0.1, ay + ph * 0.17); p.to(ax + ph * 0.2, ay + ph * 0.24); p.stroke()
      k += 3
    }
  }

  // scene.js:108-139 — горы, луг, берега; рамка. Холст прозрачный
  static func paintLand(_ p: NatPen, _ G: NatGeo, res: Double, rnd: inout NatLCG) {
    let W = G.W, safeBot = G.H - G.bot - 40
    p.g.saveGState(); p.begin(); p.rect(13, 13, W - 26, G.H - safeBot - 26); p.g.clip()
    let mh = 0.45 + 1.3 * (Horo.jsRound(res * 24) / 24)    // резонанс — выше горы
    ridge(p, G, G.hor, 4, 0.08 * G.h * mh, 0.14 * G.h * mh, 0.45, 5)
    ridge(p, G, G.hor + 0.02 * G.h, 6, 0.03 * G.h * mh, 0.06 * G.h * mh, 0.8, 9)
    // река: заливка бумагой, берега, пунктир по течению
    let N = 80
    func edge(_ s: Double) { for k in 0...N { let q = G.river(Double(k) / Double(N)).across(s / 2); k > 0 ? p.to(q.x, q.y) : p.move(q.x, q.y) } }
    p.fillPap(1); p.begin(); edge(-1)
    for k in stride(from: N, through: 0, by: -1) { let q = G.river(Double(k) / Double(N)).across(0.5); p.to(q.x, q.y) }
    p.close(); p.fill()
    p.line(0.85, 1.4); p.begin(); edge(-1); p.stroke(); p.begin(); edge(1); p.stroke()
    p.dash(riverDash); p.line(0.22, 0.8)
    for q in [0.0, 0.5, 1] {
      p.begin()
      for k in 4...N { let c = G.river(Double(k) / Double(N)).across((q - 0.5) * 0.78); k > 4 ? p.to(c.x, c.y) : p.move(c.x, c.y) }
      p.stroke()
    }
    p.dash(noDash)
    p.line(0.35, 0.8); p.begin()               // волны по воде — короткие штрихи, к нам крупнее
    for _ in 0..<70 {
      let t = pow(rnd.next(), 0.8)
      let c = G.river(t).across((rnd.next() - 0.5) * 0.9), l = 3 + 8 * t
      p.move(c.x - l, c.y + 2); p.quad(c.x, c.y, c.x + l, c.y + 2)
    }
    p.stroke()
    // засечки мест по левому берегу
    p.line(0.45, 1); p.begin()
    for i in 0..<16 {
      let r = G.river(NatGeo.slotT(i)), a = r.across(-0.5), l = 4 + 4 * NatGeo.slotT(i)
      p.move(a.x - r.nx * l, a.y - r.ny * l); p.to(a.x - r.nx, a.y - r.ny)
    }
    p.stroke()
    // луг: пучки травы по берегам (три вызова rnd на кочку, даже если она отброшена)
    p.line(0.55, 0.9)
    for _ in 0..<22 {
      let t = 0.15 + rnd.next() * 0.85, r = G.river(t), sd = rnd.next() < 0.5 ? -1.0 : 1.0
      let c = r.across(sd * (0.5 + (10 + rnd.next() * 60) / r.w))
      if c.x < 18 || c.x > W - 18 || c.y > G.bot - 6 || (c.x < 100 && c.y > G.bot - 110) { continue }
      tuft(p, c.x, c.y, 0.6 + 0.6 * t)
    }
    p.g.restoreGState()
    drawCard(p, G, safeBot)
  }

  // scene.js:140-164 — рамка карты Таро: двойная, сверху номер, снизу плашка с именем
  private static func drawCard(_ p: NatPen, _ G: NatGeo, _ safeBot: Double) {
    let W = G.W, H = G.H, b = H - safeBot
    p.line(0.9, 1.8); p.strokeRect(7, 7, W - 14, b - 14)
    p.line(0.6, 0.9); p.strokeRect(12.5, 12.5, W - 25, b - 25)
    p.fillInk(0.5)                                   // точечный орнамент между линиями рамки
    var X = 16.0
    while X < W - 12 { p.begin(); p.arc(X, 9.8, 0.8, 0, tau); p.arc(X, b - 9.8, 0.8, 0, tau); p.fill(); X += 9 }
    var Y = 16.0
    while Y < b - 12 { p.begin(); p.arc(9.8, Y, 0.8, 0, tau); p.arc(W - 9.8, Y, 0.8, 0, tau); p.fill(); Y += 9 }
    func fleur(_ X: Double, _ Y: Double, _ sx: Double) {   // завиток-лист в углу рамки
      p.line(0.7, 1); p.begin()
      p.move(X, Y); p.bez(X + sx * 16, Y - 2, X + sx * 20, Y - 16, X + sx * 8, Y - 18)
      p.quad(X + sx * 2, Y - 14, X + sx * 8, Y - 10); p.stroke()
      NatArt.leafPath(p, X + sx * 4, Y - 1, sx * 1.1, 0.7)
    }
    fleur(16, b - 36, 1); fleur(W - 16, b - 36, -1)
    let ny = G.top - 12
    p.fillPap(1); p.fillRect(W / 2 - 22, ny - 10, 44, 20)
    p.line(0.85, 1.1); p.strokeRect(W / 2 - 22 + 0.5, ny - 10 + 0.5, 44, 20)
    let d = Draw(g: p.g, W: CGFloat(W), H: CGFloat(H))
    d.setTheme(Theme(ink: p.inkC, paper: p.papC, bg: .clear))
    d.mapText("IV", CGFloat(W / 2), CGFloat(ny + 1), 16, 0.95, align: .center, italic: false)
    let by = b - 32
    p.fillPap(1); p.fillRect(12.5, by, W - 25, 19.5)
    p.line(0.85, 1.1); p.begin(); p.move(12.5, by + 0.5); p.to(W - 12.5, by + 0.5); p.stroke()
    d.mapText("N A T V R A", CGFloat(W / 2 + 28), CGFloat(by + 11), 15, 0.95, align: .center, italic: false)   // чуть вправо — слева надгробие
  }
}
