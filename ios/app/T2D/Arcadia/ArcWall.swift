import UIKit
import CoreText

// ключ стены (view.js:137): размеры — числа веба; смена любого поля пересобирает образ
struct ArcWallKey: Equatable {
  var W: Double, H: Double, dpr: Double, hor: Double, gb: Double, Wh: Double
  var seed: Int, pcs: [Int]?, root: Int
}

// ГСЧ стены и хребтов (view.js:137, 144): s = s·16807 % 2147483647 в Int64
struct ArcLcg {
  private var s: Int64
  init(seed: Int) { s = Int64(seed) }
  mutating func next() -> Double { s = s * 16807 % 2147483647; return Double(s) / 2147483647 }
}

// стена: кеш CGImage, строится в фоне; старый образ остаётся, пока новый не готов
final class ArcWall {
  private(set) var builds = 0
  private(set) var image: CGImage?
  private var lastKey: ArcWallKey?
  private var generation = 0

  static let ink: RGB = (40, 46, 32), paper: RGB = (224, 221, 198)   // Worlds.info(12), view.js:6
  static let water: RGB = (46, 86, 104)

  // build == nil — синхронно (тесты); результат подставляется в главном потоке, устаревший — отбрасывается
  func request(_ key: ArcWallKey, geo: ArcGeo, pic: ArcPic, build: DispatchQueue? = DispatchQueue.global(qos: .userInitiated)) {
    if key == lastKey { return }
    lastKey = key; builds += 1; generation += 1
    let gen = generation
    guard let q = build else { image = ArcWall.render(key, geo, pic); return }
    q.async { [weak self] in
      let img = ArcWall.render(key, geo, pic)
      DispatchQueue.main.async { if let s = self, s.generation == gen { s.image = img } }
    }
  }

  // ---------- рисование (view.js:98-233) ----------
  private static func clamp(_ x: Double, _ a: Double = 0, _ b: Double = 1) -> Double { min(b, max(a, x)) }
  private static func jsRound(_ x: Double) -> Int { Int(floor(x + 0.5)) }

  private static func mountain(_ g: CGContext, _ d: Draw, _ X: Double, _ Y: Double, _ h: Double, _ w: Double, _ s: Double, _ lean: Double, _ snow: Bool) {
    let px = X + lean * w * 0.15, py = Y - h
    g.setFillColor(d.paper(1)); g.setStrokeColor(d.ink(0.85)); g.setLineWidth(0.7 + 0.5 * s)
    g.beginPath(); g.move(to: CGPoint(x: X - w / 2, y: Y))
    g.addQuadCurve(to: CGPoint(x: px, y: py), control: CGPoint(x: X - w * 0.2, y: Y - h * 0.45))
    g.addQuadCurve(to: CGPoint(x: X + w / 2, y: Y), control: CGPoint(x: X + w * 0.18, y: Y - h * 0.5))
    g.drawPath(using: .fillStroke)
    g.setLineWidth(0.5 + 0.3 * s); g.setStrokeColor(d.ink(0.55)); g.beginPath()
    let n = 2 + jsRound(5 * s)
    for k in 1...n {
      let f = Double(k) / Double(n + 1), ex = px + (X + w / 2 - px) * f, ey = py + (Y - py) * f
      g.move(to: CGPoint(x: ex - 0.8, y: ey + 0.5)); g.addLine(to: CGPoint(x: ex - w * 0.12 * (1 - f * 0.4), y: Y - 0.5))
    }
    g.strokePath()
    if snow {
      g.setStrokeColor(d.ink(0.7)); g.beginPath()
      g.move(to: CGPoint(x: px - h * 0.18, y: py + h * 0.24)); g.addLine(to: CGPoint(x: px - h * 0.07, y: py + h * 0.16))
      g.addLine(to: CGPoint(x: px, y: py + h * 0.26)); g.addLine(to: CGPoint(x: px + h * 0.08, y: py + h * 0.17))
      g.addLine(to: CGPoint(x: px + h * 0.17, y: py + h * 0.25)); g.strokePath()
    }
  }

  private static func hill(_ g: CGContext, _ d: Draw, _ X: Double, _ Y: Double, _ h: Double, _ w: Double, _ s: Double) {
    g.setFillColor(d.paper(1)); g.setStrokeColor(d.ink(0.72)); g.setLineWidth(0.6 + 0.4 * s)
    g.beginPath(); g.move(to: CGPoint(x: X - w / 2, y: Y))
    g.addQuadCurve(to: CGPoint(x: X + w / 2, y: Y), control: CGPoint(x: X - w * 0.05, y: Y - h * 2))
    g.drawPath(using: .fillStroke)
    g.setStrokeColor(d.ink(0.4)); g.setLineWidth(0.5); g.beginPath()
    for f in [0.55, 0.78] {
      g.move(to: CGPoint(x: X + w * (f - 0.5) * 0.9, y: Y - h * (1 - f) * 1.5))
      g.addQuadCurve(to: CGPoint(x: X + w * (f - 0.42), y: Y - 0.3), control: CGPoint(x: X + w * (f - 0.45), y: Y - h * (1 - f) * 0.6))
    }
    g.strokePath()
  }

  private static func tree(_ g: CGContext, _ d: Draw, _ X: Double, _ Y: Double, _ s: Double, _ fir: Bool) {
    let h = 4 + 9 * s
    g.setStrokeColor(d.ink(0.75)); g.setLineWidth(0.5 + 0.4 * s); g.setFillColor(d.paper(1))
    if fir {
      g.beginPath(); g.move(to: CGPoint(x: X, y: Y - h)); g.addLine(to: CGPoint(x: X + h * 0.32, y: Y - h * 0.15))
      g.addLine(to: CGPoint(x: X - h * 0.32, y: Y - h * 0.15)); g.closePath(); g.drawPath(using: .fillStroke)
      g.beginPath(); g.move(to: CGPoint(x: X, y: Y - h * 0.15)); g.addLine(to: CGPoint(x: X, y: Y)); g.strokePath()
      return
    }
    g.beginPath(); g.move(to: CGPoint(x: X, y: Y)); g.addLine(to: CGPoint(x: X, y: Y - h * 0.45)); g.strokePath()
    let cy = Y - h * 0.62, r = h * 0.32
    g.fillEllipse(in: CGRect(x: X - r, y: cy - r, width: 2 * r, height: 2 * r))
    g.strokeEllipse(in: CGRect(x: X - r, y: cy - r, width: 2 * r, height: 2 * r))
    g.setStrokeColor(d.ink(0.4)); g.beginPath()                                // дуга -0.6…0.9 по возрастанию угла — ломаной, без путаницы clockwise
    let r2 = h * 0.2
    for i in 0...12 {
      let a = -0.6 + 1.5 * Double(i) / 12, p = CGPoint(x: X + cos(a) * r2, y: cy + sin(a) * r2)
      i == 0 ? g.move(to: p) : g.addLine(to: p)
    }
    g.strokePath()
  }

  private static func tuft(_ g: CGContext, _ d: Draw, _ X: Double, _ Y: Double, _ s: Double) {
    g.setStrokeColor(d.ink(0.32)); g.setLineWidth(0.5); g.beginPath()
    for dd in [-1.0, 0, 1] {
      g.move(to: CGPoint(x: X + dd * 0.6, y: Y))
      g.addQuadCurve(to: CGPoint(x: X + dd * 2.6 * s, y: Y - (5 - abs(dd)) * s), control: CGPoint(x: X + dd * 1.2 * s, y: Y - 3 * s))
    }
    g.strokePath()
  }

  private static func forest(_ u: Double, _ v: Double, _ sd: Double) -> Double {
    0.6 * sin(3.1 * u + sd) * sin(2.7 * v * Arc.asp + sd * 1.3) + 0.4 * sin(7.3 * u - 1 + sd) * sin(6.1 * v * Arc.asp + 2)
  }

  static func render(_ key: ArcWallKey, _ G: ArcGeo, _ pic: ArcPic) -> CGImage? {
    let sc = CGFloat(key.dpr)
    guard let g = CGContext(data: nil, width: Int((G.W * key.dpr).rounded()), height: Int((G.H * key.dpr).rounded()), bitsPerComponent: 8, bytesPerRow: 0,
                            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue) else { return nil }
    g.translateBy(x: 0, y: CGFloat(g.height)); g.scaleBy(x: sc, y: -sc)   // начало слева сверху
    let th = Theme(ink: ink, paper: paper, bg: UIColor(red: paper.r / 255, green: paper.g / 255, blue: paper.b / 255, alpha: 1))
    let d = Draw(g: g, W: G.W, H: G.H); d.setTheme(th)
    let dw = Draw(g: g, W: G.W, H: G.H); dw.setTheme(Theme(ink: water, paper: paper, bg: th.bg))   // подписи цветом воды
    func wc(_ a: CGFloat) -> CGColor { Draw.color(water, a) }
    func P(_ u: Double, _ v: Double) -> (x: Double, y: Double, s: Double) { let p = G.proj(u, v); return (Double(p.x), Double(p.y), Double(p.s)) }
    let zAt = pic.zAt, lakeAt = pic.lakeAt
    let W = G.W, H = G.H, fx0 = G.fx0, fx1 = G.fx1, hor = G.hor, gb = G.gb, b = G.bot, top = G.top

    g.setFillColor(d.paper(1)); g.fill(CGRect(x: 0, y: 0, width: W, height: H))
    var lcg = ArcLcg(seed: key.seed % 2147483646 + 1)
    g.setFillColor(d.ink(0.05))                                                   // крап старой бумаги
    for _ in 0..<260 {
      let cx = lcg.next() * W, cy = lcg.next() * H, r = lcg.next() * 1.1
      g.fillEllipse(in: CGRect(x: cx - r, y: cy - r, width: 2 * r, height: 2 * r))
    }
    g.saveGState(); g.clip(to: CGRect(x: fx0 + 6, y: top - 4, width: fx1 - fx0 - 12, height: b - top - 2))
    g.setStrokeColor(d.ink(0.14)); g.setLineWidth(0.7); g.beginPath()             // облака
    for (cx0, cy0, w) in [(0.28, 0.42, 0.22), (0.66, 0.66, 0.3), (0.45, 0.85, 0.16)] {
      let X = fx0 + (fx1 - fx0) * cx0, Y = top + (hor - top) * cy0, L = (fx1 - fx0) * w
      for k in 0..<3 {
        let kk = Double(k)
        g.move(to: CGPoint(x: X - L / 2 + kk * 6, y: Y + kk * 3.5))
        g.addCurve(to: CGPoint(x: X + L / 2 - kk * 7, y: Y + kk * 3.5), control1: CGPoint(x: X - L / 4, y: Y + kk * 3.5 - 4), control2: CGPoint(x: X + L / 4, y: Y + kk * 3.5 + 3))
      }
    }
    g.strokePath()
    var rr = ArcLcg(seed: 5)                                                      // дальние хребты
    for (a, hk) in [(0.18, 0.75), (0.36, 1.0)] {
      g.setFillColor(d.paper(1)); g.setStrokeColor(d.ink(CGFloat(a))); g.setLineWidth(0.8); g.beginPath(); g.move(to: CGPoint(x: fx0, y: hor))
      var X = fx0 - rr.next() * 30
      while X < fx1 {
        let w = 22 + rr.next() * 46, h = (4 + rr.next() * 16) * hk * (a > 0.2 ? 1 : 1.4)
        g.addQuadCurve(to: CGPoint(x: X + w * 0.5, y: hor - h), control: CGPoint(x: X + w * 0.3, y: hor - h * 0.4))
        g.addQuadCurve(to: CGPoint(x: X + w, y: hor - rr.next() * 3), control: CGPoint(x: X + w * 0.75, y: hor - h * 0.35))
        X += w
      }
      g.addLine(to: CGPoint(x: fx1, y: hor)); g.drawPath(using: .fillStroke)
    }
    g.setStrokeColor(d.ink(0.07)); g.beginPath()                                  // борозды (ширина 0.8 от хребта)
    for k in 0..<26 { let y = P(0, 1 - Double(k) / 26 * 2).y; g.move(to: CGPoint(x: fx0, y: y)); g.addLine(to: CGPoint(x: fx1, y: y)) }
    g.strokePath()
    g.setStrokeColor(wc(0.45)); g.setLineWidth(0.7); g.beginPath()                // озёра — штриховка
    var y = hor + 1
    while y < gb {
      let v = G.unproj(0, CGFloat(y)).v
      var inside = false, x0 = 0.0, px = fx0
      while px <= fx1 + 1 {
        let m = px <= fx1 && lakeAt((px - G.cx) / G.Wh, v) > 0.5
        if m && !inside { inside = true; x0 = px }
        else if !m && inside { inside = false; g.move(to: CGPoint(x: x0 + 1, y: y)); g.addLine(to: CGPoint(x: px - 1, y: y)) }
        px += 1
      }
      y += 2.2
    }
    g.strokePath()
    let SC = 3.0, sw = Int(ceil((fx1 - fx0) / SC)) + 1, sh = Int(ceil((gb - hor) / SC)) + 1
    var LM = [Float](repeating: 0, count: sw * sh)                                // берег — изолиния по экрану
    for j in 0..<sh {
      let v = G.unproj(0, CGFloat(hor + Double(j) * SC)).v
      for i in 0..<sw { LM[j * sw + i] = Float(lakeAt((fx0 + Double(i) * SC - G.cx) / G.Wh, v)) }
    }
    func shore(_ lvl: Double) {
      if sh < 2 || sw < 2 { return }
      for j in 0..<(sh - 1) {
        for i in 0..<(sw - 1) {
          let q = j * sw + i, a = Double(LM[q]), b2 = Double(LM[q + 1]), c = Double(LM[q + sw + 1]), dd = Double(LM[q + sw])
          let X0 = fx0 + Double(i) * SC, Y0 = hor + Double(j) * SC
          if (a > lvl) == (b2 > lvl) && (b2 > lvl) == (c > lvl) && (c > lvl) == (dd > lvl) { continue }
          var pts: [CGPoint] = []
          if (a > lvl) != (b2 > lvl) { pts.append(CGPoint(x: X0 + SC * (lvl - a) / (b2 - a), y: Y0)) }
          if (b2 > lvl) != (c > lvl) { pts.append(CGPoint(x: X0 + SC, y: Y0 + SC * (lvl - b2) / (c - b2))) }
          if (c > lvl) != (dd > lvl) { pts.append(CGPoint(x: X0 + SC * (1 - (lvl - c) / (dd - c)), y: Y0 + SC)) }
          if (dd > lvl) != (a > lvl) { pts.append(CGPoint(x: X0, y: Y0 + SC * (1 - (lvl - dd) / (a - dd)))) }
          var k = 0
          while k + 1 < pts.count { g.move(to: pts[k]); g.addLine(to: pts[k + 1]); k += 2 }
        }
      }
    }
    g.setLineWidth(1.1); g.setStrokeColor(wc(0.9)); g.beginPath(); shore(0.5); g.strokePath()   // берег и тень
    g.setLineWidth(0.7); g.setStrokeColor(wc(0.3)); g.beginPath(); shore(0.15); g.strokePath()
    for rv in pic.rivers {                                                        // реки
      let n = rv.pts.count
      g.setStrokeColor(wc(0.9))
      if n < 2 { continue }
      for k in 1..<n {
        let a = P(rv.pts[k - 1].0, rv.pts[k - 1].1), c = P(rv.pts[k].0, rv.pts[k].1)
        g.setLineWidth(CGFloat((0.5 + 1.8 * (Double(k) / Double(n))) * (0.3 + 0.7 * c.s)))
        g.beginPath(); g.move(to: CGPoint(x: a.x, y: a.y)); g.addLine(to: CGPoint(x: c.x, y: c.y)); g.strokePath()
      }
    }
    let fsd = Double(key.seed % 97) * 0.13                                        // рельеф: ряды значков
    var v = 1.0
    while v > -1.03 {
      let p = P(0, v), s = p.s, step = (4.5 + 9.5 * s) / G.Wh
      var u = -1.04 + lcg.next() * step
      while u < 1.04 {
        let uu = clamp(u, -1, 1), vv = clamp(v + (lcg.next() - 0.5) * 0.012, -1, 1), z = zAt(uu, vv), q = P(uu, vv)
        if !(lakeAt(uu, vv) > 0.25 || q.x < fx0 + 8 || q.x > fx1 - 8) {
          if z > 0.48 {
            if lcg.next() < 0.3 {
              let h = z * G.EL * s * 1.05 + 2, w = h * (1.6 + 0.6 * lcg.next())
              mountain(g, d, q.x, q.y, h, w, s, lcg.next() - 0.5, z > 0.8)
            }
          } else if z > 0.2 {
            if lcg.next() < 0.45 { let h = z * G.EL * s * 0.9 + 1, w = h * 1.9 + 4 * s; hill(g, d, q.x, q.y, h, w, s) }
          } else if z > -0.2 && forest(uu, vv, fsd) > 0.38 && lcg.next() < 0.8 {
            tree(g, d, q.x, q.y, s, z > 0.05 || lcg.next() < 0.3)
          } else if lcg.next() < 0.012 + 0.02 * s { tuft(g, d, q.x, q.y, 0.6 + 0.6 * s) }
        }
        u += step * (0.8 + 0.4 * lcg.next())
      }
      let p2 = P(0, v - 0.01), dydv = (p2.y - p.y) / 0.01
      v -= (2.2 + 6 * s) / dydv
    }
    // имена, как на старых картах (курсив 10.5), без наложений
    var placed: [(x: Double, y: Double, w: Double)] = []
    func free(_ X: Double, _ Y: Double, _ w: Double) -> Bool { placed.allSatisfy { abs($0.x - X) > ($0.w + w) / 2 + 4 || abs($0.y - Y) > 13 } }
    func label(_ s2: String, _ X: Double, _ Y: Double, _ dr: Draw, _ a: CGFloat) {
      let w = Double(d.mapTextWidth(s2, 10.5))
      if !free(X, Y, w) { return }
      placed.append((X, Y, w)); g.setFillColor(d.paper(0.85)); g.fill(CGRect(x: X - w / 2 - 2, y: Y - 6, width: w + 4, height: 12))
      dr.mapText(s2, CGFloat(X), CGFloat(Y), 10.5, a, align: .center)
    }
    for p in pic.peaks { if let nm = p.name, !nm.isEmpty { let q = P(p.u, p.v); label(nm, q.x, q.y + 8, d, 0.7) } }
    for l in pic.lakes { if let nm = l.name, !nm.isEmpty { let q = P(l.u, l.v); label(nm, q.x, q.y, dw, 0.95) } }
    for rv in pic.rivers {
      guard let nm = rv.name, !nm.isEmpty, rv.pts.count > 2 else { continue }
      let k = Int(floor(Double(rv.pts.count) * 0.7))
      let a = P(rv.pts[max(0, k - 2)].0, rv.pts[max(0, k - 2)].1)
      let ci = min(rv.pts.count - 1, k + 2), c = P(rv.pts[ci].0, rv.pts[ci].1), q = P(rv.pts[k].0, rv.pts[k].1)
      var ang = atan2(c.y - a.y, c.x - a.x)
      if ang > .pi / 2 { ang -= .pi }
      if ang < -.pi / 2 { ang += .pi }
      let w = Double(d.mapTextWidth(nm, 10.5))
      if !free(q.x, q.y - 7, w) { continue }
      placed.append((q.x, q.y - 7, w))
      g.saveGState(); g.translateBy(x: CGFloat(q.x), y: CGFloat(q.y)); g.rotate(by: CGFloat(ang))
      dw.mapText(nm, 0, -7, 10.5, 0.85, align: .center)
      g.restoreGState()
    }
    g.restoreGState()
    g.setStrokeColor(d.ink(0.9)); g.setLineWidth(1.6); g.stroke(CGRect(x: fx0, y: top - 4, width: fx1 - fx0, height: b - top + 2))   // рамка Таро
    g.setStrokeColor(d.ink(0.55)); g.setLineWidth(0.9); g.stroke(CGRect(x: fx0 + 5.5, y: top + 1.5, width: fx1 - fx0 - 11, height: b - top - 9))
    g.setStrokeColor(d.ink(0.6)); g.setLineWidth(0.8); g.beginPath()              // горизонт
    g.move(to: CGPoint(x: fx0 + 6, y: hor + 0.5)); g.addLine(to: CGPoint(x: fx1 - 6, y: hor + 0.5)); g.strokePath()
    let ny = b - 22                                                               // подпись внизу
    g.setFillColor(d.paper(1)); g.fill(CGRect(x: fx0 + 6, y: ny - 9, width: fx1 - fx0 - 12, height: 18))
    g.setStrokeColor(d.ink(0.8)); g.setLineWidth(1); g.beginPath()
    g.move(to: CGPoint(x: fx0 + 6, y: ny - 9.5)); g.addLine(to: CGPoint(x: fx1 - 6, y: ny - 9.5)); g.strokePath()
    d.mapText("A R C A D I A", CGFloat(G.cx), CGFloat(ny + 1), 15, 0.95, align: .center, italic: false)
    let semis = Int(Arc.semis)
    for k in 0...semis {                                                          // деления лада по левой рамке
      let pc = (k + key.root) % 12, on = key.pcs == nil || key.pcs!.contains(pc)
      let yy = gb - Double(k) / Arc.semis * (gb - hor), l = on ? 6.0 : 3.0
      g.setStrokeColor(d.ink(on ? 0.6 : 0.25)); g.setLineWidth(0.8); g.beginPath()
      g.move(to: CGPoint(x: fx0 + 5.5, y: yy)); g.addLine(to: CGPoint(x: fx0 + 5.5 + l, y: yy)); g.strokePath()
    }
    return g.makeImage()
  }
}
