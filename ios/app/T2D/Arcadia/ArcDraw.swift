import UIKit

// рисование Arcadia (view.js:234-268, drawT / draw): стена-образ, потом странники от дальних к ближним, солнце-угол последним
extension ArcadiaView {
  private static let dashPath: [CGFloat] = [1.5, 3.5], dashLead: [CGFloat] = [2, 4]   // путь блуждания / привязь
  private static let waterRoute = Draw.color(ArcWall.water, 0.7)
  private func clamp01(_ x: Double) -> Double { min(1, max(0, x)) }

  // путь странника для mode ≥ 3 — из кеша; пересчёт через router только при смене ключа (seed, u, v, mode)
  private func routeFor(_ s: Int, u: Double, v: Double, mode: Int) -> [Double] {
    guard let p = pic else { return [] }
    let k = RouteKey(seed: p.seed, u: u, v: v, mode: mode)
    if routeKeys[s] != k { routeKeys[s] = k; routes[s] = router(p, u, v, mode); countRoute() }
    return routes[s]
  }

  func drawFrame(_ d: Draw, now: Double, shot: Bool) {
    let g = d.g, G = geo, ms = now * 1000
    g.setFillColor(theme.bg.cgColor); g.fill(CGRect(x: 0, y: 0, width: G.W, height: G.H))
    if let p = pic {
      let key = ArcWallKey(W: G.W, H: G.H, dpr: Double(Draw.scale), hor: G.hor, gb: G.gb, Wh: G.Wh, seed: Int(p.seed), pcs: pcs, root: root)
      wall.request(key, geo: G, pic: p, build: wallQueue)
      if let img = wall.image {
        g.saveGState(); g.translateBy(x: 0, y: CGFloat(G.H)); g.scaleBy(x: 1, y: -1)   // образ лежит «вверх ногами» к нашему перевёрнутому контексту
        g.draw(img, in: CGRect(x: 0, y: 0, width: G.W, height: G.H)); g.restoreGState()
      }
    }
    drawn.removeAll(keepingCapacity: true)                 // дальние (большой v) — раньше; вставка без замыканий
    for s in state.order {
      let v = value(s, key: 1)
      var i = drawn.count
      drawn.append(s)
      while i > 0, value(drawn[i - 1], key: 1) < v { drawn[i] = drawn[i - 1]; i -= 1 }
      drawn[i] = s
    }
    for s in drawn { drawT(d, s, ms: ms) }
    if !shot { d.quarterSun(CGFloat(G.sun.x), CGFloat(G.sun.y), CGFloat(G.sun.r), side: -1, now: ms) }
  }

  private func drawT(_ d: Draw, _ s: Int, ms: Double) {
    let g = d.g, G = geo, z = zAt
    let u = value(s, key: 0), v = value(s, key: 1), r = value(s, key: 3)
    let fig = Int(value(s, key: 4)), mode = Int(value(s, key: 5)), sp = value(s, key: 6)
    let sl = mirror.slots[s], c = loop(s)
    let home = G.at(z, u, v), cen = G.at(z, c.u, c.v), gn = clamp01(sl.gain * 1.3)
    // путь: куда бродит петля
    g.setLineWidth(0.9); g.setLineDash(phase: 0, lengths: Self.dashPath); g.setStrokeColor(d.ink(0.4))
    if mode == 1 {
      for k in 0...48 { let a = Double(k) / 48 * 2 * .pi; pathBuf[k] = G.at(z, u + sp * cos(a), v + sp * sin(a) / Arc.asp) }
      g.beginPath(); g.move(to: pathBuf[0]); for k in 1...48 { g.addLine(to: pathBuf[k]) }; g.strokePath()
    } else if mode >= 3 {
      let rt = routeFor(s, u: u, v: v, mode: mode)
      if rt.count >= 4 {
        g.setStrokeColor(mode == 3 ? Self.waterRoute : d.ink(0.5))
        g.beginPath()
        for k in 0..<(rt.count / 2) { let p = G.at(z, rt[2 * k], rt[2 * k + 1]); if k == 0 { g.move(to: p) } else { g.addLine(to: p) } }
        g.strokePath()
      }
    } else if mode == 2, state.trailCount(s) > 2 {
      g.beginPath()
      for k in 0..<state.trailCount(s) { let q = state.trailPoint(s, k), p = G.at(z, q.u, q.v); if k == 0 { g.move(to: p) } else { g.addLine(to: p) } }
      g.strokePath()
    }
    g.setLineDash(phase: 0, lengths: Self.dashLead); g.setStrokeColor(d.ink(0.3))        // привязь: флажок — центр петли
    g.beginPath(); g.move(to: home); g.addLine(to: cen); g.strokePath(); g.setLineDash(phase: 0, lengths: [])
    // петля, поднятая холмами: её горбы — то, что слышно
    let n = G.loopPts(z, fig: fig, u: c.u, v: c.v, r: c.r, n: 120, into: &loopBuf)
    g.setStrokeColor(d.ink(0.5 + 0.45 * CGFloat(gn))); g.setLineWidth(1 + 0.6 * CGFloat(gn))
    g.beginPath(); g.move(to: loopBuf[0]); for k in 1..<n { g.addLine(to: loopBuf[k]) }; g.strokePath()
    // тень петли — ровная, без холмов
    g.setStrokeColor(d.ink(0.16)); g.setLineWidth(0.7)
    for k in 0...60 {
      let (du, dv) = Arc.figPt(fig, Double(k) / 60 * 2 * .pi), p = G.proj(c.u + c.r * du, c.v + c.r * dv / Arc.asp)
      shadowBuf[k] = CGPoint(x: p.x, y: p.y)
    }
    g.beginPath(); g.move(to: shadowBuf[0]); for k in 1...60 { g.addLine(to: shadowBuf[k]) }; g.strokePath()
    // сканер бежит по петле
    let f = sl.f > 0 ? sl.f : 110 * pow(2, value(s, key: 2))
    let ph = (ms * 0.00022 * sqrt(f / 55)).truncatingRemainder(dividingBy: 1), sp0 = loopBuf[min(120, Int(ph * 120))]
    d.dot(sp0.x, sp0.y, 2.3, 0.95)
    // флажок на древке
    let sc = CGFloat(G.proj(u, v).s), ph2 = ms * 0.004 + Double(s), fh = 15 + 8 * sc, hx = home.x, hy = home.y
    g.setStrokeColor(d.ink(0.95)); g.setLineWidth(1)
    g.beginPath(); g.move(to: CGPoint(x: hx, y: hy)); g.addLine(to: CGPoint(x: hx, y: hy - fh)); g.strokePath()
    g.setFillColor(d.paper(1))
    g.beginPath(); g.move(to: CGPoint(x: hx, y: hy - fh))
    g.addQuadCurve(to: CGPoint(x: hx + 11, y: hy - fh + 3.5), control: CGPoint(x: hx + 6, y: hy - fh + 1 + CGFloat(sin(ph2)) * 1.5))
    g.addLine(to: CGPoint(x: hx, y: hy - fh + 7)); g.closePath(); g.drawPath(using: .fillStroke)
    g.setFillColor(d.ink(0.95)); g.fillEllipse(in: CGRect(x: hx - 3, y: hy - 1.4, width: 6, height: 2.8))
    if let rim = heldRim(s) {                              // подпись при касании + своя нота на шкале слева
      let hz = JSRound(f)
      d.mapText("\(Arc.noteName(f)) · \(hz) Hz", hx, hy - fh - 22, 14, 0.95, align: .center)
      d.mapText(rim ? "orbit \(JSRound(r * 100))%" : "\(Arc.paths[min(max(mode, 0), 4)]) · \(Arc.figs[min(max(fig, 0), 2)])", hx, hy - fh - 8, 11, 0.65, align: .center)
      let y = G.proj(-1, v).y
      g.setStrokeColor(d.ink(0.95)); g.setLineWidth(1.6)
      g.beginPath(); g.move(to: CGPoint(x: G.fx0 + 5.5, y: y)); g.addLine(to: CGPoint(x: G.fx0 + 18, y: y)); g.strokePath(); g.setLineWidth(1)
    }
  }

  private func JSRound(_ x: Double) -> Int { Int(floor(x + 0.5)) }   // Math.round: .5 вверх
}
