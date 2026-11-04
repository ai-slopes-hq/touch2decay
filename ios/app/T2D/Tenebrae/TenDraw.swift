import UIKit

// Tenebrae: солнце, чёрная дыра, планеты (app.js:1066-1176, 1555-1655). Кадр состояния не меняет:
// pk, bph и угол удара считает tick; случайность картинки — tenHash от времени кадра

private func clamp(_ x: Double, _ a: Double = 0, _ b: Double = 1) -> Double { x.isNaN ? a : min(b, max(a, x)) }
private func invLog(_ lo: Double, _ hi: Double, _ v: Double) -> Double { log(max(v, lo) / lo) / log(hi / lo) }

extension TenebraeView {
  // ---------- солнце (:1607) ----------
  func drawSun(_ p: NatPen, _ d: Draw, nowMs: Double) {
    let ox = geo.ox, oy = geo.oy, L = clamp(sunLevel), D = clamp(fxValues[4])
    let rot = nowMs * 0.00004
    d.glowAt(ox, oy, 90 + 50 * L + 60 * D, 0.16 + 0.2 * L + 0.2 * D)
    let N = 28
    p.g.setLineWidth(0.9)
    for k in 0..<N {
      let a = Double(k) / Double(N) * 2 * .pi + rot
      let c = cos(a), s = sin(a)
      if s > 0.05 || c < -0.05 { continue }                    // видна только четверть
      let px = -s, py = c
      let jag = D > 0.2 ? (tenHash(Double(k), nowMs) - 0.3) * 14 * (D - 0.2) : 0   // drive — лучи рвутся
      if k % 2 == 1 {                                          // прямой луч — узкий клин
        let l = 50 + 22 * L + 34 * D + jag, w = 2.6
        p.strokeInk(0.42 + 0.3 * L)
        p.begin()
        p.move(ox + c * 17 + px * w, oy + s * 17 + py * w); p.to(ox + c * l, oy + s * l)
        p.to(ox + c * 17 - px * w, oy + s * 17 - py * w); p.stroke()
      } else {                                                 // волнистый — пламя
        let l = 38 + 16 * L + 26 * D + jag
        p.strokeInk(0.3 + 0.3 * L)
        p.begin()
        for i in 0...14 {
          let t = Double(i) / 14, r = 17 + t * (l - 17)
          let wv = sin(t * .pi * (3 + 3 * D) + rot * 40) * 2.2 * (1 + 2 * D) * (1 - t * 0.5)
          let X = ox + c * r + px * wv, Y = oy + s * r + py * wv
          if i > 0 { p.to(X, Y) } else { p.move(X, Y) }
        }
        p.stroke()
      }
    }
    // молния живёт ~0.1 с после удара и мерцает
    for i in 0..<Ten.voices {
      guard let st = strikes.last(where: { $0.i == i }), voice(i).active else { continue }
      let age = nowMs - st.t0 * 1000
      if !(age <= 110) || tenHash(Double(100 + i), nowMs) < 0.25 { continue }
      let pos = screenPos(i), kk = kick(i)
      let px = pos.x + kk.x, py = pos.y + kk.y, dist = hypot(px - ox, py - oy)
      if dist < 1 { continue }
      let R = tenPlanetR(voice(i).amp), t = clamp(st.p)
      let n = 1 + tenInt((2 * t).rounded())
      for b in 0..<n {
        let a = st.a + (tenHash(Double(200 + 10 * i + b), nowMs) - 0.5) * R / dist
        let end = dist - R * 0.85, c = cos(a), s2 = sin(a)
        p.line(0.4 + 0.5 * t, 0.8 + 0.8 * t)
        p.begin()
        for q in 0...8 {
          let r = 17 + (end - 17) * Double(q) / 8
          let j = q > 0 && q < 8 ? (tenHash(Double(300 + 10 * b + q), nowMs + Double(i)) - 0.5) * (6 + 8 * t) : 0
          let X = ox + c * r - s2 * j, Y = oy + s2 * r + c * j
          if q > 0 { p.to(X, Y) } else { p.move(X, Y) }
        }
        p.stroke()
        d.glowAt(ox + c * end, oy + s2 * end, 10 + 14 * t, 0.2 + 0.4 * t)
      }
    }
    p.fill(RGB(r: 0, g: 0, b: 0), 1)
    p.g.fillEllipse(in: CGRect(x: ox - 14, y: oy - 14, width: 28, height: 28))
    d.ring(ox, oy, 14, 0.7, 1); d.ring(ox, oy, 10.5, 0.35, 0.8)
  }

  // ---------- чёрная дыра (:1555) ----------
  func drawHole(_ p: NatPen, nowMs: Double) {
    let c = geo.holeAt, R = Ten.holeR
    p.g.saveGState()
    p.g.clip(to: CGRect(x: c.x, y: c.y, width: geo.W + 2 * R, height: area.H))   // видна четверть
    var feed = 0.0, near = 0.0
    for i in 0..<Ten.voices where voice(i).active { feed = max(feed, vw[i].hole * voice(i).env) }
    feed = clamp(feed)
    for f in fingers.values {
      guard let i = f.v, f.moved, !f.wasBridge, (0..<Ten.voices).contains(i) else { continue }
      near = max(near, clamp((R * 1.7 - hypot(f.x + f.ox - c.x, f.y + f.oy - c.y)) / (R * 0.7)))
    }
    let spin = nowMs * (0.004 + 0.02 * feed), tilt = -0.5, S = R * 0.46
    func disk(_ front: Bool) {
      for i in 0..<4 {
        let rx = R * (0.62 + 0.22 * Double(i)), ry = rx * 0.3
        let pat: [CGFloat] = [CGFloat(2 + i), CGFloat(4 + 2 * i)]
        let per = Double(pat[0] + pat[1])
        p.line((0.1 + 0.3 * feed) * (1 - Double(i) * 0.2), 0.8)
        p.g.setLineDash(phase: CGFloat((-spin * Double(5 - i)).truncatingRemainder(dividingBy: per)), lengths: pat)
        p.begin()
        p.ellipse(c.x, c.y, rx, ry, rot: tilt, front ? 0 : .pi, front ? .pi : 2 * .pi)
        p.stroke()
      }
      p.dash([])
    }
    disk(false)
    p.fill(RGB(r: 0, g: 0, b: 0), 1)
    p.g.fillEllipse(in: CGRect(x: c.x - S, y: c.y - S, width: 2 * S, height: 2 * S))
    ringPen(p, c.x, c.y, S + 1.5, 0.45 + 0.35 * feed, 1)
    ringPen(p, c.x, c.y, S + 4, 0.12 + 0.15 * feed, 0.8)
    disk(true)
    p.dash([1, 6]); ringPen(p, c.x, c.y, R, 0.1 + 0.35 * near, 1); p.dash([])
    p.g.restoreGState()
  }

  func ringPen(_ p: NatPen, _ x: Double, _ y: Double, _ r: Double, _ a: Double, _ w: Double) {
    p.line(a, w)
    p.g.strokeEllipse(in: CGRect(x: x - r, y: y - r, width: 2 * r, height: 2 * r))
  }

  // ---------- планета над дырой (:1102) ----------
  func drawVoice(_ p: NatPen, _ d: Draw, _ i: Int, nowMs: Double) {
    let h = clamp(vw[i].hole)
    let pos = screenPos(i)
    if h < 0.005 { drawPlanet(p, d, i, x: pos.x, y: pos.y, m: 1, nowMs: nowMs); return }
    let c = geo.holeAt, x = pos.x, y = pos.y, a = atan2(y - c.y, x - c.x)
    let e = pow(clamp((h - 0.3) / 0.7), 1.5), s = 1 - 0.8 * e         // e — насколько уже съедена
    let px = x + (c.x - x) * e, py = y + (c.y - y) * e
    p.g.saveGState()
    p.g.translateBy(x: px, y: py); p.g.rotate(by: a)
    p.g.scaleBy(x: (1 + 0.6 * h) * s, y: (1 - 0.35 * h) * s)
    p.g.rotate(by: -a); p.g.translateBy(x: -x, y: -y)
    drawPlanet(p, d, i, x: x, y: y, m: max(0.07, 1 - 0.8 * h - 0.2 * e), nowMs: nowMs)
    p.g.restoreGState()
  }

  // ---------- контур — звук планеты (:1066) ----------
  func contour(_ p: NatPen, _ i: Int, x: Double, y: Double, R: Double, a: Double, lw: Double, glow: Bool) {
    let v = voice(i)
    p.g.setLineJoin(.round)
    var halo = glow ? 1.0 : 0
    let dirt = clamp(fxValues[4])
    if !glow && dirt > 0.25 { halo = (dirt - 0.25) * 1.6 }
    let sc: [Float]? = (mirror.scopeLive.indices.contains(i) && mirror.scopeLive[i]) ? mirror.scope?[i] : nil
    let k = (10 / max(vw[i].pk, 0.02)) * min(1, clamp(v.env, 0, 10) * 1.4)
    func path() {
      p.begin()
      if let b = sc, !b.isEmpty {
        let N = b.count
        for j in 0..<N {
          let th = Double(j) / Double(N) * 2 * .pi - .pi / 2
          let rr = R + clamp(Double(b[j]) * k, -12, 12)
          let X = x + cos(th) * rr, Y = y + sin(th) * rr
          if j > 0 { p.to(X, Y) } else { p.move(X, Y) }
        }
        p.close()
      } else {
        p.arc(x, y, R, 0, 2 * .pi)
      }
    }
    if halo > 0 {
      p.line(0.07 * halo * a, lw + 7); path(); p.stroke()
      p.line(0.12 * halo * a, lw + 3); path(); p.stroke()
    }
    p.line(a, lw); path(); p.stroke()
  }

  // ---------- планета (:1114) ----------
  func drawPlanet(_ p: NatPen, _ d: Draw, _ i: Int, x x0: Double, y y0: Double, m: Double, nowMs: Double) {
    let v = voice(i), kk = kick(i)
    let x = x0 + kk.x, y = y0 + kk.y
    let held = v.held || holders(i) > 0
    let editing = sheetVoice == i || ring.map { $0.dst == i || $0.src == i } ?? false
    let R = tenPlanetR(v.amp)
    let far = vw[i].dx + vw[i].wob > zoom * 1.0001                    // за горизонтом зума — у края, бледно
    let env = clamp(v.env, 0, 10)
    let a = min(1, 1.3 * env) * (far ? 0.4 : 1)
    let f = fxValues
    if !v.pinned { drawTail(p, x, y, R: R, a: a * m, fade: v.envT == 0 ? 1 - env : 0) }
    if f[0] > 0.03 {                                                  // hall: туманность вокруг планеты, decay — её размер
      d.glowAt(x, y, 48 + 80 * invLog(0.6, 14, f[1]), 0.12 * f[0] * a * m)
    }
    p.fillPap(0.82 * m)                                               // планета закрывает орбиты за собой
    p.g.fillEllipse(in: CGRect(x: x - (R - 3), y: y - (R - 3), width: 2 * (R - 3), height: 2 * (R - 3)))
    if v.pinned { saturn(p, x, y, R, a * 0.22 * m, 1, back: true) }
    let mute = v.amp > 0 ? 1.0 : 0.4                                  // amp off: планета молчит — контур бледный
    contour(p, i, x: x, y: y, R: R, a: (held || editing ? a : a * 0.85) * mute * m, lw: held ? 2 : 1.4, glow: held || editing)
    if v.pinned { saturn(p, x, y, R, a * 0.55 * m, 1.1, back: false) }
    // двойная звезда: быстрые биения сливаются в кольцо
    if v.beat > 7 { d.ring(x, y, 5, a * 0.6 * m, 1.2) }
    else {
      let t = vw[i].bph * 2 * .pi
      d.dot(x + cos(t) * 5, y + sin(t) * 5, 1.9, a * m)
      d.dot(x - cos(t) * 5, y - sin(t) * 5, 1.9, a * 0.75 * m)
    }
    drawMoons(p, d, i, x, y, a * m)
  }

  // кольцо Сатурна: задняя половина — до контура, передняя — после
  private func saturn(_ p: NatPen, _ x: Double, _ y: Double, _ R: Double, _ a: Double, _ w: Double, back: Bool) {
    p.line(a, w)
    p.begin()
    p.ellipse(x, y, R + 16, 12 * R / 34, rot: -0.42, back ? .pi : 0, back ? 2 * .pi : .pi)
    p.stroke()
  }
}
