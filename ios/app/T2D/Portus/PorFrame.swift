import UIKit

private let noDash: [CGFloat] = []

// кадр Portus (view.js:325-348): порядок слоёв — как у веба; ничего не меняет — всё состояние в tick и касаниях.
// Время кадра now — секунды, в картинке — миллисекунды (nowMs = now·1000), как `now` веба.
extension PortusView {
  // view.js:329-331 — падающая звезда: 900 мс, хвост гаснет, ореол на голове
  func drawStar(_ p: NatPen, _ d: Draw, nowMs: Double) {
    let age = nowMs - state.killAt * 1000
    guard age >= 0, age < 900 else { return }
    let k = age / 900, x0 = state.killXY.x, y0 = state.killXY.y, x1 = x0 - 90 * k, y1 = y0 + 60 * k
    p.stroke(Por.light, 0.8 * (1 - k)); p.g.setLineWidth(1.2); p.dash(noDash); p.begin()
    p.move(x1 + 50 * (1 - k * 0.5), y1 - 33 * (1 - k * 0.5)); p.to(x1, y1); p.stroke()
    d.glowAt(CGFloat(x1), CGFloat(y1), 10, CGFloat(0.5 * (1 - k)))
  }

  // view.js:333-347 — подписи, пока палец держит предмет
  func drawCaptions(_ d: Draw) {
    let G = geo
    for t in fingers.values {
      switch t.kind {
      case .isle:
        guard t.j >= 0, t.j < Por.nstep, isle(t.j).on else { continue }
        let p = G.slotPt(t.j, isle(t.j).p)
        d.mapText("\(nameOf(t.j)) · \(Int(hzOf(t.j).rounded())) Hz", CGFloat(p.x), CGFloat(p.y - 30 - 22 * p.s), 14, 0.95, align: .center)
        d.mapText("step \(t.j + 1)", CGFloat(p.x), CGFloat(p.y - 16 - 22 * p.s), 11, 0.6, align: .center)
      case .moon:
        guard t.moved else { continue }
        d.mapText("\(Int(porFc(luna(0)).rounded())) Hz · res \(Int((luna(1) * 100).rounded()))%", CGFloat(G.moon.x + G.moon.r + 14), CGFloat(G.moon.y + G.moon.r * 0.5 + 18), 13, 0.9, align: .left)
      case .buoy:
        let bu = buoy, B = G.P(bu.u, bu.d), fb = porFb(bu.d), ti = min(max(0, Int(echo(0))), Por.dtName.count - 1)
        d.mapText("echo \(Por.dtName[ti]) · \(fb > 0.95 ? "endless" : "\(Int((fb * 100).rounded()))%")", CGFloat(B.x), CGFloat(B.y - 36), 13, 0.9, align: .center)
      case .fog:
        d.mapText("reverb \(Int((fog(0) * 100).rounded()))%", CGFloat(G.cx), CGFloat(G.fogTop - 14), 13, 0.9, align: .center)
      case .ph:
        d.mapText("\(Int(bpm.rounded())) bpm", CGFloat(G.ph.x - 34), CGFloat(G.ph.y - 112), 13, 0.9, align: .center)
      case .none: break
      }
    }
  }

  // view.js:325-348. sun == false — снимок для карты: путь дорожки есть, диска луны нет
  func drawFrame(_ d: Draw, now: Double, sun: Bool = true) {
    let nowMs = now * 1000, th = theme
    let p = NatPen(g: d.g, inkC: th.ink, papC: th.paper)
    wall.update(geo, size: CGSize(width: d.W, height: d.H), dpr: Draw.scale, scl: scl, ink: th.ink, bg: th.paper)
    d.blit(wall.img)
    drawMoon(p, d, nowMs: nowMs, sun: sun)
    let cs = step
    drawStar(p, d, nowMs: nowMs)
    drawQuay(p, d, nowMs: nowMs, cs: cs)
    for j in stride(from: Por.nstep - 1, through: 0, by: -1) where isle(j).on {   // от дальних к ближним: шаг и есть место
      drawIsle(p, d, nowMs: nowMs, j: j, cur: cs >= 0 && j == cs % Por.nstep)
    }
    drawBuoy(p, d, nowMs: nowMs)
    drawFog(p, d, nowMs: nowMs)
    drawPharos(p, d, nowMs: nowMs, cs: cs)
    drawCaptions(d)
  }
}
