import UIKit

// ключ стены (view.js:120): `W×H×DPR | y0 | yC`; смена любого поля пересобирает образ
private struct InfWallKey: Equatable { var W: Double, H: Double, dpr: Double, y0: Double, yC: Double }

// стена: CGImage-кеш, строится синхронно (штриховка и воронка — один раз, без фонового потока, как у TriaWall)
final class InfWall {
  private(set) var builds = 0
  private var key: InfWallKey?
  private var img: CGImage?

  // draw получает контекст с началом слева сверху и масштабом DPR — как у кадра
  func image(_ G: InfGeo, dpr: CGFloat, draw: (CGContext) -> Void) -> CGImage? {
    let k = InfWallKey(W: G.W, H: G.H, dpr: Double(dpr), y0: G.y0, yC: G.yC)
    if k == key { return img }
    key = k; builds += 1
    guard let g = CGContext(data: nil, width: Int((G.W * Double(dpr)).rounded()), height: Int((G.H * Double(dpr)).rounded()), bitsPerComponent: 8,
                            bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue) else { img = nil; return nil }
    g.translateBy(x: 0, y: CGFloat(g.height)); g.scaleBy(x: dpr, y: -dpr)
    draw(g)
    img = g.makeImage()
    return img
  }
}

private let tau = CGFloat.pi * 2
private let inscription: [String] = "LASCIATE OGNE SPERANZA".map { String($0) }   // буквы — раз, не в кадре

private extension CGContext {
  func line(_ x0: CGFloat, _ y0: CGFloat, _ x1: CGFloat, _ y1: CGFloat) { move(to: CGPoint(x: x0, y: y0)); addLine(to: CGPoint(x: x1, y: y1)) }
  func arc(_ x: CGFloat, _ y: CGFloat, _ r: CGFloat, _ a0: CGFloat, _ a1: CGFloat) {   // как canvas arc: по возрастанию угла
    addArc(center: CGPoint(x: x, y: y), radius: r, startAngle: a0, endAngle: a1, clockwise: false)
  }
  func oval(_ x: CGFloat, _ y: CGFloat, _ rx: CGFloat, _ ry: CGFloat) { addEllipse(in: CGRect(x: x - rx, y: y - ry, width: 2 * rx, height: 2 * ry)) }
  // цвет без аллокации CGColor
  func strokeRGB(_ c: RGB, _ a: CGFloat) { setStrokeColor(red: c.r / 255, green: c.g / 255, blue: c.b / 255, alpha: a) }
  func fillRGB(_ c: RGB, _ a: CGFloat) { setFillColor(red: c.r / 255, green: c.g / 255, blue: c.b / 255, alpha: a) }
}

extension InfernoView {
  // фон: штриховка (в угол тьмы не заходит), стенки воронки со штрихами (view.js:119-150)
  static func paintWall(_ g: CGContext, _ G: InfGeo, theme: Theme) {
    let W = CGFloat(G.W), H = CGFloat(G.H), cx = CGFloat(G.cx), ink = theme.ink, D = G.dark
    let dx = CGFloat(D.x), dy = CGFloat(D.y), dr = CGFloat(D.r)
    g.setFillColor(theme.bg.cgColor); g.fill(CGRect(x: 0, y: 0, width: W, height: H))
    g.setLineWidth(1)
    g.saveGState()
    g.beginPath(); g.addRect(CGRect(x: 0, y: 0, width: W, height: H)); g.oval(dx, dy, dr + 8, dr + 8); g.clip(using: .evenOdd)
    g.strokeRGB(ink, 0.045); g.beginPath()
    var k = -H
    while k < W { g.line(k, 0, k + H, H); k += 14 }
    g.strokePath(); g.restoreGState()
    g.strokeRGB(ink, 0.35); g.beginPath(); g.arc(dx, dy, dr, -.pi / 2, 0); g.strokePath()
    g.strokeRGB(ink, 0.12); g.beginPath(); g.arc(dx, dy, dr + 6, -.pi / 2, 0); g.strokePath()
    let R = G.rings, lastRx = CGFloat(G.coc.rx * 0.9), lastCy = CGFloat(G.coc.cy)
    g.strokeRGB(ink, 0.45); g.beginPath()
    for s: CGFloat in [-1, 1] {
      for (i, r) in R.enumerated() {
        let p = CGPoint(x: cx + s * CGFloat(r.rx), y: CGFloat(r.cy))
        i > 0 ? g.addLine(to: p) : g.move(to: p)
      }
      g.addLine(to: CGPoint(x: cx + s * lastRx, y: lastCy))
    }
    g.strokePath()
    g.strokeRGB(ink, 0.09); g.beginPath()                  // внутренняя стенка — короткие штрихи между кругами
    for k in 0..<8 {
      let a = R[k], b = R[k + 1]
      for j in -9...9 {
        let q = (Double(j) / 10) * Double.pi / 2
        let xa = G.cx + sin(q) * a.rx * 0.96, ya = a.cy - cos(q) * a.ry * 0.96, xb = G.cx + sin(q) * b.rx * 0.96, yb = b.cy - cos(q) * b.ry * 0.96
        g.line(CGFloat(xa), CGFloat(ya + 3), CGFloat(xa + (xb - xa) * 0.45), CGFloat(ya + (yb - ya) * 0.45))
      }
    }
    g.strokePath()
  }

  private func lvlAll() -> Double {
    var s = 0.0
    for k in 0..<Inf.nc { s += circ(k).lvl }
    return min(1, s / 2.5)
  }

  // LASCIATE OGNE SPERANZA над входом — разгорается с общим уровнем (view.js:151-163)
  private func drawInscription(_ d: Draw, _ G: InfGeo) {
    let g = d.g, theme = self.theme
    let L = lvlAll(), R = G.Ws * 1.1, ox = G.cx, oy = G.top + 40 + R, span = (G.Ws * 0.62) / R
    g.setLineWidth(1)
    g.setStrokeColor(d.ink(0.3)); g.beginPath()
    g.arc(ox, oy, R - 14, -.pi / 2 - span * 0.6, -.pi / 2 + span * 0.6); g.strokePath()
    g.setStrokeColor(d.ink(0.12)); g.beginPath()
    g.arc(ox, oy, R - 20, -.pi / 2 - span * 0.62, -.pi / 2 + span * 0.62); g.strokePath()
    let n = inscription.count
    let col: RGB = L > 0.05 ? Inf.ember2 : theme.ink, al = CGFloat(L > 0.05 ? 0.35 + 0.6 * L : 0.4)
    for i in 0..<n {
      let a = -Double.pi / 2 + ((Double(i) - Double(n - 1) / 2) / Double(n - 1)) * span
      d.mapText(inscription[i], CGFloat(ox + cos(a) * R), CGFloat(oy + sin(a) * R), 12.5, al, align: .center, italic: false, angle: CGFloat(a + .pi / 2), col: col)
    }
  }

  // дым над воронкой — тёмный зал (view.js:164-174)
  private func drawSmoke(_ d: Draw, _ G: InfGeo, _ nowMs: Double) {
    let g = d.g, a = 0.06 + 0.3 * fxValue(2)
    g.setLineWidth(1)
    for i in 0..<3 {
      let y = G.y0 - 40 + Double(i) * 8, ph = nowMs * 0.0004 * (i % 2 == 1 ? 1 : -1)
      g.setStrokeColor(d.ink(CGFloat(a * (1 - Double(i) * 0.3)))); g.beginPath()
      let xa = G.cx - G.Ws / 2 + 30, xb = G.cx + G.Ws / 2 - 30
      var x = xa
      while x <= xb {
        let p = CGPoint(x: x, y: y + sin(x * 0.045 + ph * 6 + Double(i)) * 4)
        x == xa ? g.move(to: p) : g.addLine(to: p)
        x += 6
      }
      g.strokePath()
    }
  }

  // пламя по верхней дуге круга (view.js:175-184)
  private func flames(_ g: CGContext, _ G: InfGeo, _ k: Int, _ level: Double, _ col: RGB, _ nowMs: Double) {
    let r = G.rings[k], n = max(6, Int(Horo.jsRound(r.rx / 7)))
    g.strokeRGB(col, 0.9); g.setLineWidth(1); g.beginPath()
    for j in 0..<n {
      let u = (Double(j) + 0.5) / Double(n), a = Double.pi * (1 - u), x = G.cx - cos(a) * r.rx, y = r.cy + sin(a) * r.ry
      let h = (4 + 12 * level) * (0.6 + 0.4 * sin(nowMs * 0.011 + Double(j) * 1.7 + Double(k))), w = 2.4
      g.move(to: CGPoint(x: x - w, y: y))
      g.addQuadCurve(to: CGPoint(x: x + sin(nowMs * 0.007 + Double(j)) * 1.5, y: y - h), control: CGPoint(x: x - w * 0.4, y: y - h * 0.55))
      g.addQuadCurve(to: CGPoint(x: x + w, y: y), control: CGPoint(x: x + w * 0.5, y: y - h * 0.45))
    }
    g.strokePath()
  }

  // крошечный грешник: голова, тело, руки; огненный нимб — закреплён (view.js:185-190)
  private func sinner(_ d: Draw, _ x: Double, _ y: Double) {
    let g = d.g
    g.setStrokeColor(d.ink(0.9)); g.setLineWidth(1); g.beginPath()
    g.move(to: CGPoint(x: x, y: y - 9)); g.addLine(to: CGPoint(x: x, y: y - 3)); g.addLine(to: CGPoint(x: x - 2.5, y: y + 1.5))
    g.move(to: CGPoint(x: x, y: y - 3)); g.addLine(to: CGPoint(x: x + 2.5, y: y + 1.5))
    g.move(to: CGPoint(x: x - 3, y: y - 7)); g.addLine(to: CGPoint(x: x + 3, y: y - 6))
    g.strokePath()
    d.dot(CGFloat(x), CGFloat(y - 11), 2.1, 0.9)
    g.strokeRGB(Inf.ember2, 0.8); g.beginPath(); g.oval(CGFloat(x), CGFloat(y - 11), 4.6, 4.6); g.strokePath()
  }

  // кадр (view.js:191-244); угол-тьма нарисован стеной. Плашка круга открывается в tick
  func drawFrame(_ d: Draw, now: Double) {
    let g = d.g, G = geo, t = self.now, nowMs = now * 1000, th = theme
    let W = CGFloat(G.W), H = CGFloat(G.H), cx = CGFloat(G.cx)
    let iceE = mirror.iceE, stormSemi = mirror.stormSemi, stormPh = mirror.stormPh
    if let img = wall.image(G, dpr: Draw.scale, draw: { InfernoView.paintWall($0, G, theme: th) }) {
      g.saveGState(); g.translateBy(x: 0, y: H); g.scaleBy(x: 1, y: -1)           // образ лежит «вверх ногами» к нашему перевёрнутому контексту
      g.draw(img, in: CGRect(x: 0, y: 0, width: W, height: H)); g.restoreGState()
    } else { g.setFillColor(th.bg.cgColor); g.fill(CGRect(x: 0, y: 0, width: W, height: H)) }
    drawInscription(d, G)
    drawSmoke(d, G, nowMs)
    for k in 0..<Inf.nc {
      let r = G.rings[k], q = circ(k), burning = state.burning(k, mirror: mirror, now: t), hot = q.lvl > 0.04 || burning, h = isHeld(k)
      let ry = CGFloat(r.cy), rrx = CGFloat(r.rx), rry = CGFloat(r.ry)
      if h { g.strokeRGB(Inf.ember, 0.18); g.setLineWidth(10); g.beginPath(); g.oval(cx, ry, rrx, rry); g.strokePath() }
      if hot { g.strokeRGB(Inf.ember, CGFloat(0.35 + 0.6 * min(1, q.lvl + (burning ? 0.4 : 0)))) } else { g.setStrokeColor(d.ink(CGFloat(0.7 - 0.03 * Double(k)))) }
      g.setLineWidth(hot ? 1.3 : 1)
      g.beginPath(); g.oval(cx, ry, rrx, rry); g.strokePath()
      g.setStrokeColor(d.ink(0.12)); g.setLineWidth(1); g.beginPath(); g.oval(cx, ry + 3, rrx - 3, rry - 1.5); g.strokePath()
      if hot { g.strokeRGB(Inf.ember, 0.35) } else { g.setStrokeColor(d.ink(0.22)) }   // засечки на круге — видно, как он вращается
      g.setLineWidth(1); g.beginPath()
      for j in 0..<16 {
        let a = state.rot[k] + (Double(j) / 16) * Double(tau), sn = sin(a)
        if sn < 0.05 { continue }
        let x = G.cx + cos(a) * r.rx, y = r.cy + sn * r.ry
        g.line(CGFloat(x), CGFloat(y - 2), CGFloat(x), CGFloat(y + 2.5))
      }
      g.strokePath()
      if k == 1 && abs(stormSemi) > 0.05 && q.lvl > 0.04 {   // буря второго круга: порывы носятся по кругу
        g.setStrokeColor(d.ink(CGFloat(0.15 + 0.4 * q.lvl))); g.setLineWidth(1); g.beginPath()
        for j in 0..<5 {
          let a0 = stormPh * Double(tau) * 1.5 + (Double(j) / 5) * Double(tau), rr = 1 + 0.12 * sin(Double(j) * 2.3 + stormPh * 9)
          for u in 0...10 {
            let a = a0 + Double(u) * 0.09, x = G.cx + cos(a) * r.rx * rr, y = r.cy + sin(a) * r.ry * rr * 2.2 - 6 - Double(u) * 0.4
            u > 0 ? g.addLine(to: CGPoint(x: x, y: y)) : g.move(to: CGPoint(x: x, y: y))
          }
        }
        g.strokePath()
      }
      if q.lvl > 0.04 { flames(g, G, k, q.lvl * (0.4 + 0.6 * q.level / 0.7), h ? Inf.ember2 : Inf.ember, nowMs) }
      if iceE > 0.02 && Double(k) >= 9 - iceE * 9 {          // иней ползёт снизу вверх — растёт со временем
        g.strokeRGB(Inf.ice, 0.45); g.setLineWidth(1); g.beginPath()
        for j in 0..<14 {
          let a = Double.pi * (0.08 + (0.84 * Double(j)) / 13), x = G.cx - cos(a) * r.rx, y = r.cy + sin(a) * r.ry + 5
          g.move(to: CGPoint(x: x - 2, y: y)); g.addLine(to: CGPoint(x: x, y: y - 3)); g.addLine(to: CGPoint(x: x + 2, y: y))
        }
        g.strokePath()
      }
      if q.sinner {                                          // грешник стоит там, где круг звучит, и чуть переминается
        let x = G.cx - r.rx + 2 * r.rx * q.pos + sin(nowMs * 0.0016 + Double(k)) * 2.5, u = min(1, max(-1, (x - G.cx) / r.rx))
        sinner(d, x, r.cy + (1 - u * u).squareRoot() * r.ry)
      }
    }
    // Коцит — ледяное озеро на дне
    let K = G.coc, kcy = CGFloat(K.cy), krx = CGFloat(K.rx), kry = CGFloat(K.ry)
    g.strokeRGB(Inf.ice, 0.85); g.setLineWidth(1); g.beginPath(); g.oval(cx, kcy, krx, kry); g.strokePath()
    g.strokeRGB(Inf.ice, 0.3); g.beginPath(); g.oval(cx, kcy, krx - 6, kry - 3); g.strokePath()
    g.strokeRGB(Inf.ice, CGFloat(0.35 + 0.4 * iceE)); g.beginPath()
    for j in 0..<9 {
      let x = G.cx - K.rx * 0.7 + (Double(j) / 8) * K.rx * 1.4, y = K.cy + sin(Double(j) * 2.1) * 3
      g.line(CGFloat(x - 2.5), CGFloat(y), CGFloat(x + 2.5), CGFloat(y)); g.line(CGFloat(x), CGFloat(y - 2), CGFloat(x), CGFloat(y + 2))
    }
    g.strokePath()
    if iceE > 0.03 {                                         // лёд трескается и растёт: трещины от середины, длиннее с инеем
      g.strokeRGB(Inf.ice, CGFloat(0.25 + 0.5 * iceE)); g.beginPath()
      for j in 0..<7 {
        let a = (Double(j) / 7) * Double(tau) + 0.4, L = (0.3 + 0.9 * iceE) * K.rx * (0.7 + 0.3 * sin(Double(j) * 3.1))
        g.move(to: CGPoint(x: G.cx, y: K.cy))
        g.addLine(to: CGPoint(x: G.cx + cos(a) * L * 0.5, y: K.cy + sin(a) * L * 0.12 + sin(Double(j)) * 2))
        g.addLine(to: CGPoint(x: G.cx + cos(a) * L, y: K.cy + sin(a) * L * 0.22))
      }
      g.strokePath()
    }
    for i in 0..<state.sparkCount {                          // угольки
      let p = state.sparkAt(i)
      g.fillRGB(p.life > 0.5 ? Inf.ember2 : Inf.ember, CGFloat(min(1, p.life * 1.2)))
      g.fill(CGRect(x: p.x - 0.8, y: p.y - 0.8, width: 1.6 + p.life, height: 1.6 + p.life))
    }
    for k in 0..<Inf.nc where isHeld(k) {                    // подписи — только пока трогаешь
      let r = G.rings[k], s = infSemi(k, circ(k).pos, pcs: pcs)
      d.mapText("\(Inf.roman[k]) · \(Inf.names[k])", CGFloat(G.cx + r.rx), CGFloat(r.cy - r.ry - 22), 15, 0.95, align: .right)
      d.mapText("\(infNote(s)) · \(Int(Horo.jsRound(55 * pow(2, s / 12)))) Hz", CGFloat(G.cx + r.rx), CGFloat(r.cy - r.ry - 6), 12, 0.7, align: .right)
    }
  }
}
