import UIKit

private let dashRing: [CGFloat] = [1.5, 3.5], dashFog: [CGFloat] = [3, 5], noDash: [CGFloat] = []
private let tau = 2 * Double.pi
private func cl01(_ x: Double) -> Double { min(1, max(0, x)) }

// порт worlds/portus/view.js:199-324 — луна, вехи, кораблики, буй, туман, маяк. Время nowMs — миллисекунды (как в вебе);
// метки PorState лежат в секундах — переводятся ·1000. Ничего не меняют: кадр без состояния.
extension PortusView {
  // view.js:199-226 — луна в углу: дорожка света всегда, диск, ореол и кольца — только без `sun == false` (карта)
  func drawMoon(_ p: NatPen, _ d: Draw, nowMs: Double, sun: Bool) {
    let G = geo, M = G.moon, cut = luna(0), res = luna(1), R = M.r, g = p.g, L = Por.light
    let a = 0.25 + 0.75 * cut
    let w0 = 3 + 22 * res, rows = 36
    let x0 = max(M.x + R * 0.8, G.P(Por.edge(-1, 1), 1).x + 12)
    g.setLineWidth(1)
    for k in 0..<rows {
      let dd = 1 - pow(Double(k) / Double(rows), 1.3), pt = G.P(0, dd), f = 1 - dd, xm = x0 + (G.cx - G.Wh * 0.15 - x0) * pow(f, 0.8)
      if pt.y > G.qy - 4 { break }
      let wob = sin(nowMs * 0.002 + Double(k) * 1.7) * 3 * pt.s
      let w = (w0 + 12 * f) * pt.s * (0.45 + 0.55 * pow(sin(Double(k) * 2.3 + nowMs * 0.0015), 2))
      p.stroke(L, (0.06 + 0.42 * cut) * (0.4 + 0.6 * f)); p.begin(); p.move(xm - w + wob, pt.y); p.to(xm + w + wob, pt.y); p.stroke()
    }
    if !sun { return }                                                                   // на карте луна не двоит солнце
    g.saveGState(); g.clip(to: CGRect(x: M.x, y: G.top - 40, width: G.Ws, height: G.hor - G.top + 40))
    d.glowAt(CGFloat(M.x), CGFloat(M.y), CGFloat(R * 2.6), CGFloat(0.08 + 0.22 * cut))
    if res > 0.04 {
      for k in 1...3 {
        p.dash(dashRing); p.stroke(L, (0.15 + 0.45 * res) / Double(k)); g.setLineWidth(1); p.begin()
        p.arc(M.x, M.y, R + 5 + Double(k) * (3 + 7 * res), 0, tau); p.stroke()
      }
    }
    p.dash(noDash)
    let bl = M.lfo < 0 ? 0 : M.lfo                                                       // бледная … blood moon
    let mc: RGB = (Horo.jsRound(L.r - 70 * bl), Horo.jsRound(L.g - 165 * bl), Horo.jsRound(L.b - 105 * bl))
    p.fill(mc, 0.2 + 0.7 * (M.lfo < 0 ? a : 0.75)); p.stroke(L, 0.95); g.setLineWidth(1.4)
    p.begin(); p.arc(M.x, M.y, R, 0, tau); g.drawPath(using: .fillStroke)
    p.stroke(L, 0.5); g.setLineWidth(0.8); p.begin(); p.arc(M.x, M.y, R + 4, -Double.pi / 2, Double.pi / 2); p.stroke()
    p.stroke(p.papC, 0.45); g.setLineWidth(0.8)                                               // моря и кратеры
    for c in PortusView.craters { p.begin(); p.arc(M.x + c.dx * R, M.y + c.dy * R, c.r * R, 0, tau); p.stroke() }
    let fx = M.x + R * 0.5, fy = M.y, k = R / 46                                         // спящее лицо в видимой половине
    p.stroke(p.papC, 0.85); g.setLineWidth(1.1); p.begin()
    p.move(fx - 7 * k, fy - 6 * k); p.quad(fx - 2 * k, fy - 2 * k, fx + 3 * k, fy - 6 * k)
    p.move(fx - 2 * k, fy - 2 * k); p.to(fx + 1 * k, fy + 6 * k); p.to(fx - 3 * k, fy + 7 * k)
    p.move(fx - 6 * k, fy + 13 * k); p.quad(fx - 1 * k, fy + 15 * k, fx + 4 * k, fy + 12 * k)
    p.stroke()
    g.restoreGState()
  }
  private static let craters: [(dx: Double, dy: Double, r: Double)] = [(0.25, -0.5, 0.16), (0.55, 0.42, 0.11), (0.18, 0.6, 0.08), (0.7, -0.15, 0.07)]

  // view.js:310-324 — вехи фарватера: шест с фонарём на каждом месте; горит — кораблик; бегущий огонёк — шаг
  func drawQuay(_ p: NatPen, _ d: Draw, nowMs: Double, cs: Int) {
    let G = geo, g = p.g, L = Por.light, N = Por.nstep
    if cs >= 0 && playing {                                                              // свет шага поперёк фарватера
      let i = cs % N, a = G.laneAt(PorGeo.fOf(i), -0.5), b = G.laneAt(PorGeo.fOf(i), 0.5), m = G.laneAt(PorGeo.fOf(i), 0)
      p.stroke(L, isle(i).on ? 0.45 : 0.2); g.setLineWidth(1.2); p.begin(); p.move(a.x, a.y); p.to(b.x, b.y); p.stroke()
      d.glowAt(CGFloat(m.x), CGFloat(m.y), CGFloat(16 * (0.5 + m.s)), 0.18)
    }
    for i in stride(from: N - 1, through: 0, by: -1) {
      let m = G.markPt(i), s = m.s, on = isle(i).on, here = cs >= 0 && cs % N == i
      let h = (10 + 14 * s) * (i % 4 == 0 ? 1.25 : 1), lw = 2 + 2.5 * s
      p.strokeInk(0.7); g.setLineWidth(0.6 + 0.5 * s); p.begin(); p.move(m.x, m.y); p.to(m.x, m.y - h); p.stroke()
      if on { d.glowAt(CGFloat(m.x), CGFloat(m.y - h - lw), CGFloat(here ? 18 * (0.5 + s) : 10 * (0.5 + s)), here ? 0.6 : 0.22) }
      if on { p.fill(L, here ? 1 : 0.75); p.stroke(L, 0.9) } else { p.fillPap(1); p.strokeInk(here ? 0.95 : 0.55) }
      g.setLineWidth(0.8); p.begin()
      p.move(m.x - lw * 0.6, m.y - h); p.to(m.x + lw * 0.6, m.y - h); p.to(m.x + lw * 0.45, m.y - h - lw * 1.4); p.to(m.x - lw * 0.45, m.y - h - lw * 1.4); p.close()
      g.drawPath(using: .fillStroke)
      p.strokeInk(0.25); p.begin(); p.move(m.x - 2 * s - 1, m.y + 1.5); p.to(m.x + 2 * s + 1, m.y + 1.5); p.stroke()
    }
  }

  // view.js:227-248 — бумажный кораблик: корпус-трапеция, парус-треугольник, сгибы; качается; звучащий — золотом
  func drawIsle(_ p: NatPen, _ d: Draw, nowMs: Double, j: Int, cur: Bool) {
    let G = geo, g = p.g, L = Por.light, si = isle(j)
    let pt = G.slotPt(j, si.p), s = pt.s, w = 20 * s + 4
    let hit = cl01(1 - (nowMs - state.hitT[j] * 1000) / 500), lit = cur && playing
    let rock = sin(nowMs * 0.0017 + si.sd) * 0.07 + hit * 0.12 * sin(nowMs * 0.03), bob = sin(nowMs * 0.0021 + si.sd * 1.3) * 1.2 * s
    if lit { d.glowAt(CGFloat(pt.x), CGFloat(pt.y - w * 0.5), CGFloat(w * 1.6), CGFloat(0.12 + 0.35 * hit)) }
    if lit { p.stroke(L, 0.3 + 0.3 * hit) } else { p.strokeInk(0.22) }                   // отражение: штрихи под корабликом
    g.setLineWidth(0.7); p.begin()
    for k in 0..<3 {
      let yy = pt.y + 3 + Double(k) * 2.6 * s, ww = w * (0.8 - Double(k) * 0.2), ox = sin(nowMs * 0.002 + Double(k) + si.sd) * 1.5 * s
      p.move(pt.x - ww + ox, yy); p.to(pt.x + ww + ox, yy)
    }
    p.stroke()
    g.saveGState(); g.translateBy(x: CGFloat(pt.x), y: CGFloat(pt.y - 1 + bob)); g.rotate(by: CGFloat(rock)); g.scaleBy(x: CGFloat(w), y: CGFloat(w))
    if lit { p.fill(L, 0.18 + 0.2 * hit); p.stroke(L, 0.7 + 0.3 * hit) } else { p.fillInk(0.13); p.strokeInk(0.9) }
    p.begin(); p.move(-1, -0.32); p.to(-0.48, -0.32); p.to(0, -1.2); p.to(0.48, -0.32); p.to(1, -0.32); p.to(0.72, 0.16); p.to(-0.72, 0.16); p.close()
    g.setLineWidth(CGFloat(1 / w)); g.drawPath(using: .fillStroke)
    g.setLineWidth(CGFloat(0.7 / w)); if lit { p.stroke(L, 0.5) } else { p.strokeInk(0.45) }   // сгибы бумаги
    p.begin(); p.move(0, -1.2); p.to(0, -0.32); p.move(-0.48, -0.32); p.to(-0.2, 0.16); p.move(0.48, -0.32); p.to(0.2, 0.16); p.move(-1, -0.32); p.to(1, -0.32)
    p.stroke()
    if lit { p.stroke(L, 0.35) } else { p.strokeInk(0.28) }                              // тень на правой половине паруса
    p.begin()
    for k in 1...4 { let f = Double(k) / 5; p.move(0.05, -1.2 + 0.88 * f); p.to(0.48 * f + 0.02, -0.34) }
    p.stroke()
    g.restoreGState()
  }

  // view.js:249-269 — колокол-буй: качается; от него круги — повторы эха
  func drawBuoy(_ p: NatPen, _ d: Draw, nowMs: Double) {
    let G = geo, g = p.g, bu = buoy, B = G.P(bu.u, bu.d)
    let s = 0.6 + 0.6 * B.s, rock = sin(nowMs * 0.0021) * (0.12 + 0.25 * fx(0))
    g.setLineWidth(1)
    for h in state.hits {                                                                // повторы: каждый — круг, слабее с каждым разом
      let age = nowMs - h.t * 1000
      for k in 1...14 {
        let t0 = Double(k) * h.dt * 1000, a = pow(h.fb, Double(k))
        if a < 0.04 || age < t0 { break }
        let e = (age - t0) / 1400
        if e > 1 { continue }
        p.strokeInk(0.5 * a * (1 - e)); p.begin()
        p.ellipse(B.x, B.y, (6 + 70 * e) * B.s * 1.4, (2 + 22 * e) * B.s * 1.4, rot: 0, 0, tau); p.stroke()
      }
    }
    g.saveGState(); g.translateBy(x: CGFloat(B.x), y: CGFloat(B.y)); g.rotate(by: CGFloat(rock)); g.scaleBy(x: CGFloat(s), y: CGFloat(s))
    p.fillPap(1); p.strokeInk(0.9)
    p.begin(); p.move(-9, 0); p.to(9, 0); p.to(6, -6); p.to(-6, -6); p.close(); g.drawPath(using: .fillStroke)   // поплавок
    p.begin(); p.move(-5, -6); p.to(-3, -20); p.to(3, -20); p.to(5, -6); p.stroke()                              // клетка
    p.begin(); p.move(-3, -20); p.to(0, -24); p.to(3, -20); p.stroke()
    p.begin(); p.move(-3, -9); p.quad(-3, -16, 0, -16); p.quad(3, -16, 3, -9); p.close(); p.stroke()           // колокол
    g.restoreGState()
  }

  // view.js:270-290 — туман над горизонтом: три пелены и рваные горизонтальные штрихи; гуще — больше зала
  func drawFog(_ p: NatPen, _ d: Draw, nowMs: Double) {
    let G = geo, g = p.g, amt = fog(0)
    let top = G.fogTop, bot = G.hor + 18 + 40 * amt, dr = nowMs * 0.000012
    for k in 0..<3 {                                                                     // пелена: три слоя, каждый чуть прячет то, что за ним
      let y0 = top + (bot - top) * Double(k) / 4
      p.fillPap(0.2 + 0.12 * amt); p.begin(); p.move(G.fx0, bot)
      var X = G.fx0
      while X <= G.fx1 + 10 { p.to(X, y0 - 5 * sin(X * 0.025 + Double(k) * 2.1 + dr * 60 * Double(k + 1))); X += 10 }
      p.to(G.fx1, bot); p.close(); p.fill()
    }
    g.setLineWidth(0.8)
    let rows = max(2, Int(Horo.jsRound(10 + 22 * amt)))             // при amt < -0.48 не падает 0..<rows
    for j in 0..<rows {                                                                  // штрихи плывут вбок, к краям пелены бледнее
      let f = Double(j) / Double(rows - 1), y = top + 4 + (bot - top - 8) * f
      let a = (0.05 + 0.16 * sin(Double.pi * f)) * (0.6 + 0.6 * amt)
      p.strokeInk(a); p.begin()
      var r = NatLCG(seed: Int64(j * 97 + 5))
      let sh = (nowMs * 0.004 * (0.5 + r.next())).truncatingRemainder(dividingBy: G.Ws)
      for _ in 0..<7 {
        let l = 14 + r.next() * 50
        let X = G.fx0 + ((r.next() * G.Ws + sh * (j % 2 != 0 ? 1 : -1)).truncatingRemainder(dividingBy: G.Ws) + G.Ws).truncatingRemainder(dividingBy: G.Ws)
        p.move(X, y); p.to(min(G.fx1, X + l), y + (r.next() - 0.5))
      }
      p.stroke()
    }
    p.strokeInk(0.16 + 0.12 * amt); p.dash(dashFog); p.begin()                           // верх тумана — за него тянут
    var X = G.fx0
    while X <= G.fx1 { let y = top - 4 * sin(X * 0.025 + dr * 60); if X == G.fx0 { p.move(X, y) } else { p.to(X, y) }; X += 6 }
    p.stroke(); p.dash(noDash)
  }

  // view.js:291-309 — маяк: башня со штриховкой, фонарь; в такт — вспышка, луч к нынешнему кораблику
  func drawPharos(_ p: NatPen, _ d: Draw, nowMs: Double, cs: Int) {
    let G = geo, g = p.g, L = Por.light, x = G.ph.x, y = G.ph.y, hgt = 74.0, st = state
    let cur = st.lastHit >= 0 && nowMs - st.lastAt * 1000 < 600 ? st.lastHit : -1
    let hit = cur >= 0 ? cl01(1 - (nowMs - st.hitT[cur] * 1000) / 260) : 0
    if playing && cur >= 0 && isle(cur).on {
      let q = G.slotPt(cur, isle(cur).p)
      p.fill(L, 0.05 + 0.12 * hit); p.begin(); p.move(x, y - hgt - 6); p.to(q.x - 26 * q.s, q.y - 8 * q.s); p.to(q.x + 26 * q.s, q.y - 2); p.close(); p.fill()
    }
    p.fillPap(1); p.strokeInk(0.9); g.setLineWidth(1)
    p.begin(); p.move(x - 13, y); p.to(x - 8, y - hgt); p.to(x + 8, y - hgt); p.to(x + 13, y); p.close(); g.drawPath(using: .fillStroke)
    p.strokeInk(0.4); p.begin()
    for k in 1..<5 { let yy = y - hgt * Double(k) / 5, ww = 13 - 5 * Double(k) / 5; p.move(x - ww, yy); p.to(x + ww, yy) }
    for k in 0..<6 { p.move(x + 3 + Double(k) * 1.6, y - 2); p.to(x + 3 + Double(k) * 1.1, y - hgt + 2) }
    p.stroke()
    p.strokeInk(0.9); p.begin(); p.move(x - 11, y - hgt); p.to(x + 11, y - hgt); p.stroke()
    if playing { d.glowAt(CGFloat(x), CGFloat(y - hgt - 9), CGFloat(26 + 16 * hit), CGFloat(0.25 + 0.5 * hit)) }
    if playing { p.fill(L, 0.5 + 0.5 * hit) } else { p.fillPap(1) }
    p.strokeInk(0.9); p.begin(); p.rect(x - 6, y - hgt - 15, 12, 13); g.drawPath(using: .fillStroke)
    p.fillPap(1); p.begin(); p.move(x - 8, y - hgt - 15); p.to(x, y - hgt - 23); p.to(x + 8, y - hgt - 15); p.close(); g.drawPath(using: .fillStroke)
    if !playing { p.fillInk(0.85); p.begin(); p.move(x - 3, y - 40); p.to(x + 5, y - 35); p.to(x - 3, y - 30); p.close(); p.fill() }   // стоит — знак пуска
  }
}
