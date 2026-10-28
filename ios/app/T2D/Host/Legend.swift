import UIKit
import CoreText

// легенда — порт host/legend.js:31-87: оверлей «глиф · жест · что делает». Закрытие по тапу — в роутере.
// top — safeAreaInsets.top (scopeY веба). Без теней, жирного и градиентов; шрифт — EB Garamond (reading).
enum Legend {
  // legGeo (legend.js:31-36); top результата — уже ниже верхней строки (scopeY + 50)
  static func geo(W: CGFloat, H: CGFloat, top: CGFloat, safeBot: CGFloat, rows: Int)
    -> (x: CGFloat, w: CGFloat, top: CGFloat, rh: CGFloat, h: CGFloat) {
    let t = top + 50, x: CGFloat = 14, w = W - 28, avail = H - safeBot - t - 12
    let rh = min(max((avail - 112) / CGFloat(max(1, rows)), 34), 50)
    return (x, w, t, rh, 82 + CGFloat(rows) * rh + 30)
  }

  // legGlyph (legend.js:37-65)
  static func glyph(_ d: Draw, _ kind: Glyph, _ x: CGFloat, _ y: CGFloat) {
    let g = d.g
    func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x, y: y) }
    func arrow(_ x0: CGFloat, _ y0: CGFloat, _ x1: CGFloat, _ y1: CGFloat) {
      let a = atan2(y1 - y0, x1 - x0)
      g.beginPath(); g.move(to: pt(x0, y0)); g.addLine(to: pt(x1, y1))
      g.move(to: pt(x1 - cos(a - 0.5) * 5, y1 - sin(a - 0.5) * 5)); g.addLine(to: pt(x1, y1))
      g.addLine(to: pt(x1 - cos(a + 0.5) * 5, y1 - sin(a + 0.5) * 5)); g.strokePath()
    }
    func pen() { g.setStrokeColor(d.ink(0.85)); g.setLineWidth(1.2) }
    func dashed(_ on: [CGFloat], _ fn: () -> Void) { g.setLineDash(phase: 0, lengths: on); fn(); g.setLineDash(phase: 0, lengths: []) }
    func arc(_ a0: CGFloat, _ a1: CGFloat) { g.beginPath(); g.addArc(center: pt(x, y), radius: 11, startAngle: a0, endAngle: a1, clockwise: false); g.strokePath() }
    func onCircle(_ a: CGFloat) -> CGPoint { pt(x + cos(a) * 11, y + sin(a) * 11) }
    pen()
    switch kind {
    case .tap: d.dot(x, y, 3.5, 0.9); d.ring(x, y, 9, 0.45, 1)
    case .double: d.dot(x, y, 3.5, 0.9); d.ring(x, y, 8, 0.7, 1); d.ring(x, y, 12, 0.4, 1)
    case .hold:
      d.dot(x, y, 3.5, 0.9)
      dashed([2.5, 2.5]) { d.ring(x, y, 8, 0.75, 1); d.ring(x, y, 13, 0.4, 1) }
    case .drag: d.dot(x - 9, y, 3.2, 0.9); pen(); arrow(x - 4, y, x + 12, y)
    case .up: d.dot(x, y + 10, 3.2, 0.9); pen(); arrow(x, y + 5, x, y - 12)
    case .draw:
      dashed([3, 2.5]) {
        g.beginPath(); g.move(to: pt(x - 14, y + 7))
        g.addQuadCurve(to: pt(x, y), control: pt(x - 6, y - 12))
        g.addQuadCurve(to: pt(x + 12, y - 6), control: pt(x + 6, y + 10)); g.strokePath()
      }
      d.dot(x + 12, y - 6, 3, 0.9)
    case .throw:
      g.beginPath(); g.move(to: pt(x - 13, y + 10)); g.addQuadCurve(to: pt(x + 13, y - 3), control: pt(x - 4, y - 16)); g.strokePath()
      arrow(x + 7, y - 7, x + 13, y - 3); d.dot(x - 13, y + 10, 3, 0.9)
    case .shake: arrow(x, y, x + 13, y); arrow(x, y, x - 13, y); d.dot(x, y, 3.2, 0.9)
    case .two:
      d.dot(x - 9, y + 4, 3.2, 0.9); d.dot(x + 9, y - 4, 3.2, 0.9); pen()
      dashed([2, 3]) { g.beginPath(); g.move(to: pt(x - 9, y + 4)); g.addLine(to: pt(x + 9, y - 4)); g.strokePath() }
    case .pinch:
      d.dot(x - 4, y + 4, 3, 0.9); d.dot(x + 4, y - 4, 3, 0.9); pen()
      arrow(x - 6, y + 6, x - 13, y + 13); arrow(x + 6, y - 6, x + 13, y - 13)
    case .twist:
      arc(-2.6, -0.6); arc(0.55, 2.55)
      let a = onCircle(-0.9), b = onCircle(-0.6), c = onCircle(2.25), e = onCircle(2.55)
      arrow(a.x, a.y, b.x, b.y); arrow(c.x, c.y, e.x, e.y)
      let p = onCircle(-2.6), q = onCircle(0.55)
      d.dot(p.x, p.y, 2.8, 0.9); d.dot(q.x, q.y, 2.8, 0.9)
    }
  }

  // fitText (legend.js:66-70): курсив ужимается, чтобы влезть в строку; шрифты — в кеше, в кадре не создаём
  private static var fonts: [CGFloat: CTFont] = [:]
  static func width(_ s: String, _ size: CGFloat) -> CGFloat {
    let f = fonts[size] ?? CTFontCreateWithName("EBGaramond-Italic" as CFString, size, nil)
    fonts[size] = f
    let line = CTLineCreateWithAttributedString(CFAttributedStringCreate(nil, s as CFString, [kCTFontAttributeName: f] as CFDictionary))
    return CGFloat(CTLineGetTypographicBounds(line, nil, nil, nil))
  }
  static func fitSize(_ s: String, _ size: CGFloat, maxW: CGFloat) -> CGFloat {
    var sz = size
    while sz > 9 && width(s, sz) > maxW { sz -= 0.5 }
    return sz
  }

  // drawLegenda0 (legend.js:72-87); title — заголовок оверлея («L E G E N D A»)
  static func draw(_ d: Draw, title: String, rows: [LegendRow], W: CGFloat, H: CGFloat, top: CGFloat, safeBot: CGFloat) {
    d.reading {
      let g = d.g, L = geo(W: W, H: H, top: top, safeBot: safeBot, rows: rows.count)
      let x = L.x, w = L.w, t = L.top, rh = L.rh, h = L.h
      g.setFillColor(d.paper(0.97)); g.fill(CGRect(x: x, y: t, width: w, height: h))
      d.hairBox(x, t, w, h, 0.75); d.hairBox(x + 4, t + 4, w - 8, h - 8, 0.3)
      g.setFillColor(d.ink(0.7))
      for (qx, qy) in [(x, t), (x + w, t), (x, t + h), (x + w, t + h)] {
        g.fillEllipse(in: CGRect(x: qx - 1.8, y: qy - 1.8, width: 3.6, height: 3.6))
      }
      d.mapText(title, x + w / 2, t + 30, 20, 0.95, align: .center, italic: false)
      d.mapText("what the hand does here", x + w / 2, t + 54, 13, 0.6, align: .center)
      g.setStrokeColor(d.ink(0.3)); g.setLineWidth(1)
      g.beginPath(); g.move(to: CGPoint(x: x + w / 2 - 50, y: t + 68.5)); g.addLine(to: CGPoint(x: x + w / 2 + 50, y: t + 68.5)); g.strokePath()
      for (i, r) in rows.enumerated() {
        let cy = t + 82 + rh * (CGFloat(i) + 0.5), tx = x + 58, maxW = x + w - 16 - tx
        glyph(d, r.glyph, x + 32, cy)
        d.mapText(r.gesture, tx, cy - 8, fitSize(r.gesture, 15, maxW: maxW), 0.95)
        d.mapText(r.does, tx, cy + 10, fitSize(r.does, 12.5, maxW: maxW), 0.62)
      }
      d.mapText("tap anywhere — close", x + w / 2, t + h - 18, 12, 0.5, align: .center)
    }
  }
}
