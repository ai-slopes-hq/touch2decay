import UIKit
import CoreText

// примитивы гравюры: порт host/draw.js на CoreGraphics. g — контекст с началом слева сверху (как UIKit и canvas 2D);
// W, H — в пунктах. Без теней и градиентов в кадре: свечение — один раз собранный спрайт.

enum Align { case left, center, right }
enum Face { case map, read }   // host/fonts.js: .map — IM Fell English (поле, карта), .read — EB Garamond (где читают)

final class Draw {
  var g: CGContext
  var W: CGFloat, H: CGFloat
  var face: Face = .map                       // host/fonts.js:7
  private var theme = Theme.base
  private var bgColor = UIColor.black.cgColor

  // плотность рисования не больше 2× (draw.js:27: 3× на iPhone в 2.25 раза больше пикселей)
  static let scale: CGFloat = min(UIScreen.main.scale, 2)

  init(g: CGContext, W: CGFloat, H: CGFloat) { self.g = g; self.W = W; self.H = H }

  // draw.js:11-13 — тема мира; nil в вебе значит «по умолчанию»
  func setTheme(_ t: Theme) { theme = t; bgColor = t.bg.cgColor }

  // draw.js:14 и :34 — rgba чернил и бумаги
  func ink(_ a: CGFloat) -> CGColor { Draw.color(theme.ink, a) }
  func paper(_ a: CGFloat) -> CGColor { Draw.color(theme.paper, a) }
  static func color(_ c: RGB, _ a: CGFloat) -> CGColor { CGColor(red: c.r / 255, green: c.g / 255, blue: c.b / 255, alpha: a) }

  private func fill(_ c: RGB, _ a: CGFloat) { g.setFillColor(red: c.r / 255, green: c.g / 255, blue: c.b / 255, alpha: a) }
  private func stroke(_ c: RGB, _ a: CGFloat) { g.setStrokeColor(red: c.r / 255, green: c.g / 255, blue: c.b / 255, alpha: a) }

  // ---------- свечение ----------
  // draw.js:35-41 — спрайт 128 px из INK0 (не следует теме, как в вебе); строится один раз
  static let glowSprite: CGImage = {
    let c = CGContext(data: nil, width: 128, height: 128, bitsPerComponent: 8, bytesPerRow: 0,
                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    let k: CGFloat = 237 / 255
    let gr = CGGradient(colorSpace: CGColorSpaceCreateDeviceRGB(),
                        colorComponents: [k, k, k, 1, k, k, k, 0.45, k, k, k, 0], locations: [0, 0.35, 1], count: 3)!
    c.drawRadialGradient(gr, startCenter: CGPoint(x: 64, y: 64), startRadius: 0, endCenter: CGPoint(x: 64, y: 64), endRadius: 64, options: [])
    return c.makeImage()!
  }()

  // draw.js:42-46 — штамп спрайта; globalAlpha контекста считаем равным 1 (в кадре его не меняем)
  func glowAt(_ x: CGFloat, _ y: CGFloat, _ r: CGFloat, _ a: CGFloat) {
    if a <= 0.003 { return }
    g.saveGState()
    g.setAlpha(min(1, a))
    g.draw(Draw.glowSprite, in: CGRect(x: x - r, y: y - r, width: 2 * r, height: 2 * r))   // спрайт симметричен — переворот незаметен
    g.restoreGState()
  }

  // ---------- подписи ----------
  private struct FontKey: Hashable { var face: Face; var italic: Bool; var size: CGFloat }
  private var fonts: [FontKey: CTFont] = [:]   // кеш: в кадре шрифты не создаём

  private func font(_ italic: Bool, _ size: CGFloat) -> CTFont {
    let k = FontKey(face: face, italic: italic, size: size)
    if let f = fonts[k] { return f }
    let name: String
    switch face {
    case .map: name = italic ? "IM_FELL_English_Italic" : "IM_FELL_English_Roman"
    case .read: name = italic ? "EBGaramond-Italic" : "EBGaramond-Regular"
    }
    let f = CTFontCreateWithName(name as CFString, size, nil)
    assert(CTFontCopyPostScriptName(f) as String == name, "шрифт \(name) не найден, подставлен другой")
    fonts[k] = f
    return f
  }

  // textBaseline 'middle' канваса: середина em-квадрата — базовая линия сдвинута на (ascent − descent) / 2
  private func drawString(_ s: String, _ x: CGFloat, _ y: CGFloat, _ f: CTFont, _ a: CGFloat, _ align: Align, _ col: RGB? = nil) {
    let attrs: [CFString: Any] = [kCTFontAttributeName: f, kCTForegroundColorFromContextAttributeName: true]
    let line = CTLineCreateWithAttributedString(CFAttributedStringCreate(nil, s as CFString, attrs as CFDictionary))
    let w = CGFloat(CTLineGetTypographicBounds(line, nil, nil, nil))
    let ox: CGFloat = align == .left ? x : align == .center ? x - w / 2 : x - w
    fill(col ?? theme.ink, a)
    g.saveGState()
    g.translateBy(x: ox, y: y + (CTFontGetAscent(f) - CTFontGetDescent(f)) / 2)
    g.scaleBy(x: 1, y: -1)                   // глифы CoreText — в системе с осью вверх
    g.textPosition = .zero
    CTLineDraw(line, g)
    g.restoreGState()
  }

  // ширина строки в пунктах (measureText); italic как у mapText
  func mapTextWidth(_ s: String, _ size: CGFloat, italic: Bool = true) -> CGFloat {
    let attrs: [CFString: Any] = [kCTFontAttributeName: font(italic, size)]
    return CGFloat(CTLineGetTypographicBounds(CTLineCreateWithAttributedString(CFAttributedStringCreate(nil, s as CFString, attrs as CFDictionary)), nil, nil, nil))
  }

  // draw.js:47-50
  func mapText(_ s: String, _ x: CGFloat, _ y: CGFloat, _ size: CGFloat, _ a: CGFloat, align: Align = .left, italic: Bool = true, angle: CGFloat = 0, col: RGB? = nil) {
    if angle == 0 { drawString(s, x, y, font(italic, size), a, align, col); return }
    // поворот вокруг (x, y), радианы, по часовой (как ctx.rotate в вебе; ось y вниз)
    g.saveGState()
    g.translateBy(x: x, y: y); g.rotate(by: angle)
    drawString(s, 0, 0, font(italic, size), a, align, col)
    g.restoreGState()
  }
  // draw.js:79-83 — в интерфейсе прямой, кегль +2 (у Fell мельче очко); жирного нет — акцент яркостью
  func text(_ s: String, _ x: CGFloat, _ y: CGFloat, _ size: CGFloat, _ a: CGFloat, align: Align = .left) {
    drawString(s, x, y, font(false, size + 2), a, align)
  }
  // host/fonts.js:8 — fn рисует шрифтом для чтения
  func reading(_ fn: () -> Void) { let was = face; face = .read; defer { face = was }; fn() }

  // ---------- фигуры ----------
  // draw.js:51-54
  func ring(_ x: CGFloat, _ y: CGFloat, _ r: CGFloat, _ a: CGFloat, _ w: CGFloat) {
    g.setLineWidth(w); stroke(theme.ink, a)
    g.strokeEllipse(in: CGRect(x: x - r, y: y - r, width: 2 * r, height: 2 * r))
  }
  // draw.js:55-58
  func dot(_ x: CGFloat, _ y: CGFloat, _ r: CGFloat, _ a: CGFloat) {
    fill(theme.ink, a)
    g.fillEllipse(in: CGRect(x: x - r, y: y - r, width: 2 * r, height: 2 * r))
  }
  // draw.js:59-64 — ромб: квадрат, повёрнутый на 45°; пустой закрашен фоном, чтобы скрыть то, что под ним
  func diamond(_ x: CGFloat, _ y: CGFloat, _ s: CGFloat, _ a: CGFloat, _ filled: Bool) {
    g.saveGState()
    g.translateBy(x: x, y: y); g.rotate(by: .pi / 4)
    let r = CGRect(x: -s, y: -s, width: 2 * s, height: 2 * s)
    if filled { fill(theme.ink, a) } else { g.setFillColor(bgColor) }
    g.fill(r)
    stroke(theme.ink, a); g.setLineWidth(1.3); g.stroke(r)
    g.restoreGState()
  }
  // draw.js:65-68 — тонкая рамка на полупикселе, чтобы линия в 1 pt была чёткой
  func hairBox(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ a: CGFloat) {
    stroke(theme.ink, a); g.setLineWidth(1)
    g.stroke(CGRect(x: Draw.round(x) + 0.5, y: Draw.round(y) + 0.5, width: Draw.round(w), height: Draw.round(h)))
  }
  private static func round(_ v: CGFloat) -> CGFloat { (v + 0.5).rounded(.down) }   // Math.round: .5 вверх

  // draw.js:85-99 — кривая по функции одного цикла: формы таблиц и LFO
  func drawCurve(_ fn: (Double) -> Double, _ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ a: CGFloat, cycles: Double = 2, lw: CGFloat = 1.6) {
    g.saveGState()
    stroke(theme.ink, a); g.setLineWidth(lw); g.setLineJoin(.round)
    let N = 96
    g.beginPath()
    for i in 0...N {
      let t = Double(i) / Double(N)
      let v = min(max(fn((t * cycles).truncatingRemainder(dividingBy: 1)), -1.2), 1.2)
      let p = CGPoint(x: x - w / 2 + CGFloat(t) * w, y: y - CGFloat(v) * h / 2)
      if i > 0 { g.addLine(to: p) } else { g.move(to: p) }
    }
    g.strokePath()
    g.restoreGState()
  }

  // draw.js:101-121 — гравированное солнце: двойной диск, лучи прямые и волнистые через один (в секторе a0..a1).
  // now — мс, как в вебе; col — цвет линий (по умолчанию чернила темы), disc — заливка диска (по умолчанию фон темы)
  func sunGlyph(_ ox: CGFloat, _ oy: CGFloat, _ a0: CGFloat, _ a1: CGFloat, scale: CGFloat = 1, now: Double = 0, col: RGB? = nil, disc: UIColor? = nil) {
    let col = col ?? theme.ink
    let rot = now * 0.00004, N = 28, tau = Double.pi * 2
    g.setLineWidth(0.9)
    for k in 0..<N {
      let a = Double(k) / Double(N) * tau + rot
      let aa = (fmod(a - Double(a0), tau) + tau).truncatingRemainder(dividingBy: tau)
      if aa > Double(a1 - a0) + 0.05 { continue }
      let c = CGFloat(cos(a)), s = CGFloat(sin(a)), px = -s, py = c
      if k % 2 == 1 {
        let l = 50 * scale, w: CGFloat = 2.6
        stroke(col, 0.7)
        g.beginPath()
        g.move(to: CGPoint(x: ox + c * 17 + px * w, y: oy + s * 17 + py * w))
        g.addLine(to: CGPoint(x: ox + c * l, y: oy + s * l))
        g.addLine(to: CGPoint(x: ox + c * 17 - px * w, y: oy + s * 17 - py * w))
        g.strokePath()
      } else {
        let l = 38 * scale
        stroke(col, 0.5)
        g.beginPath()
        for i in 0...14 {
          let t = CGFloat(i) / 14, r = 17 + t * (l - 17), wv = sin(t * .pi * 3) * 2.2 * (1 - t * 0.5)
          let p = CGPoint(x: ox + c * r + px * wv, y: oy + s * r + py * wv)
          if i > 0 { g.addLine(to: p) } else { g.move(to: p) }
        }
        g.strokePath()
      }
    }
    g.setFillColor((disc ?? theme.bg).cgColor)
    g.fillEllipse(in: CGRect(x: ox - 14, y: oy - 14, width: 28, height: 28))
    stroke(col, 0.85); g.setLineWidth(1)
    g.strokeEllipse(in: CGRect(x: ox - 14, y: oy - 14, width: 28, height: 28))
    stroke(col, 0.45); g.setLineWidth(0.8)
    g.strokeEllipse(in: CGRect(x: ox - 10.5, y: oy - 10.5, width: 21, height: 21))
  }

  // draw.js:121-160 — угловое солнце: четверть (side = 1 — вниз и вправо) с лицом и кромкой; top < oy — верхняя половина.
  // now — мс, как в вебе; col и disc — по умолчанию чернила и фон темы
  func quarterSun(_ ox: CGFloat, _ oy: CGFloat, _ r: CGFloat, side: CGFloat = 1, now: Double = 0, col: RGB? = nil, disc: UIColor? = nil, top: CGFloat? = nil) {
    let top = top ?? oy, col = col ?? theme.ink, disc = disc ?? theme.bg
    let N = 28, tau = Double.pi * 2, rot = now * 0.00003, half = top < oy - 1
    g.saveGState()
    g.clip(to: CGRect(x: side > 0 ? ox : 0, y: top, width: side > 0 ? W : ox, height: H))
    g.translateBy(x: ox, y: oy); g.scaleBy(x: side, y: 1)
    func c(_ a: CGFloat) -> CGColor { Draw.color(col, a) }
    for k in 0..<N {
      let a = Double(k) / Double(N) * tau + rot, aa = (fmod(a, tau) + tau).truncatingRemainder(dividingBy: tau)
      if aa > Double.pi / 2 + 0.1 && !(half && aa > Double.pi * 1.5 - 0.1) { continue }
      let cs = CGFloat(cos(a)), sn = CGFloat(sin(a)), px = -sn, py = cs
      g.beginPath()
      if k % 2 == 1 {
        let l = r * 2.05, w: CGFloat = 5
        g.move(to: CGPoint(x: cs * r + px * w, y: sn * r + py * w)); g.addLine(to: CGPoint(x: cs * l, y: sn * l))
        g.addLine(to: CGPoint(x: cs * r - px * w, y: sn * r - py * w))
        g.setFillColor(disc.cgColor); g.setStrokeColor(c(0.75)); g.setLineWidth(1.1); g.drawPath(using: .fillStroke)
      } else {
        let l = r * 1.65
        for i in 0...18 {
          let t = CGFloat(i) / 18, rr = r + t * (l - r), wv = sin(t * .pi * 3) * 3.5 * (1 - t * 0.5)
          let p = CGPoint(x: cs * rr + px * wv, y: sn * rr + py * wv)
          i > 0 ? g.addLine(to: p) : g.move(to: p)
        }
        g.setStrokeColor(c(0.55)); g.setLineWidth(1); g.strokePath()
      }
    }
    g.setFillColor(disc.cgColor); g.fillEllipse(in: CGRect(x: -r, y: -r, width: 2 * r, height: 2 * r))
    g.setStrokeColor(c(0.9)); g.setLineWidth(1.6); g.strokeEllipse(in: CGRect(x: -r, y: -r, width: 2 * r, height: 2 * r))
    g.setStrokeColor(c(0.45)); g.setLineWidth(0.9); g.strokeEllipse(in: CGRect(x: -r + 5, y: -r + 5, width: 2 * r - 10, height: 2 * r - 10))
    let f0 = r * 0.46, k = r / 46                                                          // лицо — в видимой четверти
    func P(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x, y: y) }
    g.setLineWidth(1.1); g.setStrokeColor(c(0.85)); g.beginPath()
    g.move(to: P(f0 - 11 * k, f0 - 2 * k)); g.addQuadCurve(to: P(f0 - 5 * k, f0 - 2 * k), control: P(f0 - 8 * k, f0 + 1 * k))
    g.move(to: P(f0 + 5 * k, f0 - 2 * k)); g.addQuadCurve(to: P(f0 + 11 * k, f0 - 2 * k), control: P(f0 + 8 * k, f0 + 1 * k))
    g.move(to: P(f0 - 12 * k, f0 - 7 * k)); g.addQuadCurve(to: P(f0 - 4 * k, f0 - 7 * k), control: P(f0 - 8 * k, f0 - 10 * k))
    g.move(to: P(f0 + 4 * k, f0 - 7 * k)); g.addQuadCurve(to: P(f0 + 12 * k, f0 - 7 * k), control: P(f0 + 8 * k, f0 - 10 * k))
    g.move(to: P(f0, f0 - 4 * k)); g.addLine(to: P(f0 - 2 * k * side, f0 + 5 * k)); g.addLine(to: P(f0 + 1.5 * k * side, f0 + 5.5 * k))
    g.move(to: P(f0 - 7 * k, f0 + 11 * k)); g.addQuadCurve(to: P(f0 + 7 * k, f0 + 11 * k), control: P(f0, f0 + 15 * k))
    g.strokePath()
    if !half { g.setStrokeColor(c(0.8)); g.setLineWidth(1.2); g.beginPath(); g.move(to: P(0, 0.5)); g.addLine(to: P(r * 2.1, 0.5)); g.strokePath() }   // кромка
    g.restoreGState()
  }
}
