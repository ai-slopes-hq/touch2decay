import UIKit

private let tau = 2 * Double.pi
private let rings = [1, (2.0 / 3).squareRoot(), (1.0 / 3).squareRoot(), 0]   // границы колец: край, 0|1, 1|2, центр (view.js:398)
private let life = 5.0                                                          // жизнь звезды-созвездия, с (view.js:48)

// порт worlds/cymatica/view.js:47-58, 366-431, 455-458 — пластина, клетки ханга, названия нот, созвездия, вспышка.
// Время now — секунды. Кадр ничего не меняет в state, fingers, pair.
extension CymaticaView {
  // view.js:47-58 — сыгранные места соединены тонкими линиями, фигура гаснет за 5 с; старше — не рисуем (чистит тик)
  func drawStars(_ p: NatPen, _ d: Draw, now: Double) {
    let st = state.stars, g = geo
    p.g.setLineWidth(0.8)
    if st.count > 1 {
      for i in 1..<st.count {
        let a = st[i - 1], b = st[i], k = 1 - (now - a.t) / life
        if k <= 0 || (a.x == b.x && a.y == b.y) { continue }
        let s = g.fromPlate(a.x, a.y), e = g.fromPlate(b.x, b.y)
        p.strokeInk(0.3 * k); p.begin(); p.move(s.x, s.y); p.to(e.x, e.y); p.stroke()
      }
    }
    for s in st {
      let k = 1 - (now - s.t) / life
      if k <= 0 { continue }
      let q = g.fromPlate(s.x, s.y)
      d.dot(CGFloat(q.x), CGFloat(q.y), 1.4, CGFloat(0.55 * k))
    }
  }

  // view.js:366-378 — стол едва виден, край, второе кольцо и засечки через 6°
  func drawPlate(_ p: NatPen, _ d: Draw, now: Double) {
    let g = geo
    d.ring(CGFloat(g.cx), CGFloat(g.cy), CGFloat(g.rMax), 0.08, 1)
    d.ring(CGFloat(g.cx), CGFloat(g.cy), CGFloat(g.r), 0.55, 1)
    d.ring(CGFloat(g.cx), CGFloat(g.cy), CGFloat(g.r + 3), 0.25, 1)
    p.line(0.3, 1); p.begin()
    var deg = 0.0
    while deg < 360 {
      let a = deg * Double.pi / 180, x = cos(a), y = sin(a)
      p.move(g.cx + x * (g.r + 3), g.cy + y * (g.r + 3)); p.to(g.cx + x * (g.r + 7), g.cy + y * (g.r + 7))
      deg += 6
    }
    p.stroke()
  }

  // view.js:381 — уровень голоса −50…−10 дБ в 0…1
  func glowOf(_ lv: Double) -> Double { min(1, max(0, (10 * log10(lv + 1e-20) + 50) / 40)) }

  // view.js:382-393 — яркость клеток по голосам; буфер lit, без выделений; плохие голоса и ноты не из раскладки пропущены
  func litCells() {
    for k in 0..<lit.count { lit[k] = 0 }
    let n = scl.degPerOct, b = base()
    guard n > 0, n <= 12 else { return }
    for v in mirror.voices {
      let gl = glowOf(v.level)
      guard gl >= 0.02, v.hz.isFinite, v.hz > 0 else { continue }       // и NaN-уровень: сравнение с NaN ложно
      let s = 12 * log2(v.hz / Cym.fMin)
      guard let idx = noteList.firstIndex(where: { abs(Double($0) - s) < 0.05 }),
            let cl = cymCellOf(idx, b: b, n: n) else { continue }        // нота не из раскладки — не горит
      let k = cl.ring * 12 + cl.sector
      lit[k] = max(lit[k], gl)
    }
  }

  // view.js:394-396 — названия нот видны, пока играешь: два пальца, секунда после щипка, палец на пластине, метке, бусине
  func showNotes(now: Double) -> Bool {
    if pair != nil || now < labelUntil { return true }
    for f in fingers.values where f.kind == .live || f.kind == .mark || f.kind == .mtick { return true }
    return false
  }

  // view.js:397-404 — контур клетки: дуга снаружи, дуга внутри, два луча
  private func cellPath(_ p: NatPen, _ ring: Int, _ sector: Int, _ n: Int) {
    let g = geo
    let a0 = Double(sector) / Double(n) * tau - Double.pi / 2, a1 = Double(sector + 1) / Double(n) * tau - Double.pi / 2
    let ro = rings[ring] * g.r, ri = rings[ring + 1] * g.r
    p.begin(); p.arc(g.cx, g.cy, ro, a0, a1)
    if ri > 0 { p.arc(g.cx, g.cy, ri, a1, a0, ccw: true) } else { p.to(g.cx, g.cy) }
    p.close()
  }

  // view.js:397-431 — сетка ханга, горящие клетки (по lit), названия нот. Вызывать после litCells
  func drawCells(_ p: NatPen, _ d: Draw, now: Double) {
    let g = geo, n = scl.degPerOct
    guard n > 0, n <= 12 else { return }
    p.line(0.25, 1); p.begin()
    for k in 0..<n {
      let a = Double(k) / Double(n) * tau - Double.pi / 2
      p.move(g.cx, g.cy); p.to(g.cx + cos(a) * g.r, g.cy + sin(a) * g.r)
    }
    p.move(g.cx + rings[1] * g.r, g.cy); p.arc(g.cx, g.cy, rings[1] * g.r, 0, tau)
    p.move(g.cx + rings[2] * g.r, g.cy); p.arc(g.cx, g.cy, rings[2] * g.r, 0, tau)
    p.stroke()
    for ring in 0..<3 {
      for s in 0..<n {
        let gl = lit[ring * 12 + s]
        if gl <= 0 { continue }
        cellPath(p, ring, s, n)                                            // звучит — клетка светится и гаснет вместе с нотой
        p.fillInk(0.12 * gl); p.fill()
        p.line(0.3 + 0.6 * gl, 1 + 0.6 * gl)
        cellPath(p, ring, s, n); p.stroke()
      }
    }
    if !showNotes(now: now) { return }
    let b = base()
    for ring in 0..<3 {
      for s in 0..<n {
        let i = b + ring * n + s
        guard i < noteList.count else { continue }                         // за 1760 Гц — без подписи
        let c = cymCellCenter(ring: ring, sector: s, n: n), x = g.cx + c.x * g.r, y = g.cy + c.y * g.r
        p.fillPap(0.6); p.begin(); p.arc(x, y, 9, 0, tau); p.fill()
        d.mapText(Cym.noteName(Cym.fMin * pow(2, Double(noteList[i]) / 12)), CGFloat(x), CGFloat(y), 10, 0.5, align: .center)
      }
    }
  }

  // view.js:455-458 — запись в гнездо: расходящийся круг, полсекунды
  func flash(_ d: Draw, _ x: Double, _ y: Double, _ t: Double, now: Double) {
    let k = (now - t) / 0.5
    if k >= 0 && k < 1 { d.ring(CGFloat(x), CGFloat(y), CGFloat(5 + 16 * k), CGFloat(0.9 * (1 - k)), 1.4) }
  }
}
