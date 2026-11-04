import UIKit

// Tenebrae: хвост кометы и спутники-LFO планеты (app.js:1121-1130, 1161-1175)


extension TenebraeView {
  // временная планета — комета: хвост от солнца, длиннее, пока гаснет; тает двумя ступенями
  func drawTail(_ p: NatPen, _ x: Double, _ y: Double, R: Double, a: Double, fade: Double) {
    let ang = atan2(y - geo.oy, x - geo.ox), len = 26 + 70 * tenClamp(fade)
    for k in [-0.12, 0, 0.12] {
      let x0 = x + cos(ang + k) * (R - 4), y0 = y + sin(ang + k) * (R - 4)
      let ex = cos(ang + k * 1.6) * len, ey = sin(ang + k * 1.6) * len
      p.line(a * (k != 0 ? 0.18 : 0.3), k != 0 ? 1 : 1.4)
      p.begin(); p.move(x0, y0); p.to(x0 + ex * 0.5, y0 + ey * 0.5); p.stroke()
      p.strokeInk(a * (k != 0 ? 0.07 : 0.12))
      p.begin(); p.move(x0 + ex * 0.5, y0 + ey * 0.5); p.to(x0 + ex, y0 + ey); p.stroke()
    }
  }

  // спутники: орбита по параметру, размер — глубина, след за спутником — форма LFO
  func drawMoons(_ p: NatPen, _ d: Draw, _ i: Int, _ x: Double, _ y: Double, _ a: Double) {
    let v = voice(i)
    for key in 0..<8 {
      guard let l = v.lfo[key] else { continue }
      let r = Ten.moonR[key], ph = vw[i].vph[key], depth = tenClamp(l.depth, 0, 1)
      p.line(a * 0.07, 1)
      p.begin(); p.arc(x, y, r, 0, 2 * .pi); p.stroke()
      p.line(a * 0.3, 1); p.g.setLineJoin(.round)
      p.begin()
      for n in 0...40 {
        let q = ph - Double(n) / 40 * 0.4, th = q * 2 * .pi
        let rr = r + Waves.morph(l.morph, q - floor(q)) * 4 * depth
        let X = x + cos(th) * rr, Y = y + sin(th) * rr
        if n > 0 { p.to(X, Y) } else { p.move(X, Y) }
      }
      p.stroke()
      let th = ph * 2 * .pi, rr = r + Waves.morph(l.morph, ph - floor(ph)) * 4 * depth
      d.dot(x + cos(th) * rr, y + sin(th) * rr, 1.3 + 2 * depth, a)
    }
  }
}
