import UIKit

// кадр Cymatica (view.js:139-145, 581-589, 601-661): курсор, подписи, резонатор и порядок слоёв.
// Кадр ничего не меняет (state, fingers, pair, shownF0) — shownF0 двигает tick. Время now — секунды.
extension CymaticaView {
  // view.js:139-145 — курсор пошагового ввода: кольцо у гнезда мелодии и «step i / len»
  func drawCursor(_ d: Draw) {
    let c = cursor
    if c < 0 || playing { return }
    let A = geo, len = min(max(1, mlen), Cym.slots), i = c % len, p = A.slotXY(i, A.R1)
    d.ring(CGFloat(p.x), CGFloat(p.y), 15, 0.9, 1.6)
    d.mapText("step \(i + 1) / \(len)", CGFloat(A.playX - 62), CGFloat(A.ty), 13, 0.7, align: .center)
  }

  // view.js:585-589 — текст подписи высоты: f0 — базовая, не с луной; nil — подпись погасла
  func drawLabelText(now: Double) -> String? {
    if now >= labelUntil { return nil }
    let f = f0
    return "\(Cym.noteName(f)) · \(Int(Horo.jsRound(f))) Hz"
  }

  func drawLabel(_ d: Draw, now: Double) {
    guard let s = drawLabelText(now: now) else { return }
    let g = geo, a = min(1, (labelUntil - now) / 0.4)
    d.mapText(s, CGFloat(g.cx), CGFloat(g.cy - g.rMax - 50), 15, CGFloat(0.85 * a), align: .center)
  }

  // view.js:581-584 — подпись поворота у пальцев
  func drawTwist(_ d: Draw, now: Double) {
    guard let t = twistLabel, now <= t.until else { return }
    d.mapText(t.text, CGFloat(t.x), CGFloat(t.y - 44), 16, CGFloat(0.9 * min(1, (t.until - now) / 0.4)), align: .center)
  }

  // view.js:601-622 — резонатор Гельмгольца в правом нижнем углу; звучит мода (0,1) — линии ярче, у горлышка дрожит воздух
  func drawResonator(_ p: NatPen, _ d: Draw, now: Double) {
    let x = area.W, y = area.H - area.safeBot
    let L = min(1, sqrt(max(0, mirror.energy[0])) * 2), a = 0.45 + 0.4 * L
    p.fillPap(1); p.begin(); p.arc(x, y, 36, 0, 2 * Double.pi); p.fill()
    d.ring(CGFloat(x), CGFloat(y), 34, CGFloat(a), 1)
    d.ring(CGFloat(x), CGFloat(y), 30, CGFloat(a * 0.5), 0.8)
    p.line(a * 0.35, 0.8)                                     // штриховка дугами — объём шара
    for k in 1...5 {
      let kk = Double(k)
      p.begin(); p.arc(x + kk * 2, y + kk * 2, 30 - kk * 4, Double.pi, Double.pi * 1.5); p.stroke()
    }
    // горлышко — к центру экрана (вверх-влево)
    let s2 = 0.5.squareRoot(), dx = -s2, dy = -s2, px = s2, py = -s2, w = 5.0, n0 = 33.0, n1 = 50.0
    p.line(a, 1)
    p.begin()
    for s in [-1.0, 1.0] {
      p.move(x + dx * n0 + px * w * s, y + dy * n0 + py * w * s); p.to(x + dx * n1 + px * w * s, y + dy * n1 + py * w * s)
    }
    p.stroke()
    p.begin(); p.ellipse(x + dx * n1, y + dy * n1, w, w * 0.45, rot: atan2(py, px), 0, 2 * Double.pi); p.stroke()
    let ak = (now - state.answerAt) / 1.4                     // отозвался своей нотой — подпись проступает на шаре
    if ak >= 0 && ak < 1 {
      d.ring(CGFloat(x), CGFloat(y), CGFloat(38 + 8 * ak), CGFloat(0.5 * (1 - ak)), 1)
      d.mapText(state.answerNote, CGFloat(x - 18), CGFloat(y - 16), 15, CGFloat(0.95 * (1 - ak)), align: .center)
    }
    if L >= 0.03 {                                            // воздух в горлышке — дуги у устья, видны, пока звучит
      for k in 1...2 {
        p.line(L * (0.5 - 0.2 * Double(k)), 1)
        p.begin(); p.arc(x + dx * n1, y + dy * n1, w + 4 * Double(k), Double.pi * 0.95, Double.pi * 1.55); p.stroke()
      }
    }
  }

  // view.js:647-661. Волны — по действующей высоте с луной (effF0), геометрия — по shownF0 (ключ — в CymWaves)
  func drawFrame(_ d: Draw, now: Double) {
    let th = theme
    let p = NatPen(g: d.g, inkC: th.ink, papC: th.paper)
    waves.update(W: d.W, H: d.H, dpr: Draw.scale, fs: cymFs(effF0()), topY: area.topY, safeBot: area.safeBot, ink: th.ink, bg: th.paper)
    d.blit(waves.img)
    drawPlate(p, d, now: now)
    litCells()
    drawCells(p, d, now: now)
    drawStars(p, d, now: now)
    drawAstro(p, d, now: now)
    drawCursor(d)
    drawLabel(d, now: now)
    drawTwist(d, now: now)
    drawResonator(p, d, now: now)
  }
}
