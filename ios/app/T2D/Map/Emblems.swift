import UIKit
import CoreText

// лица карточек мира и рубашка на карте Universum: порт host/map.js emblemFor (:82-257) и cardBack (:259-282).
// Рисуется один раз на размер и плотность (кеш). Начало контекста — слева сверху, как у canvas 2D.
// EMB_LINE (латинская строка под названием) только при pw > 100 — на телефоне карточка уже, не рисуем.
// В реестре iOS нет слотов 3, 6, 17, 18 (выключены, в архиве, DLC закрыт) — их лица не портируем.
enum Emblems {
  private static var faces: [String: CGImage] = [:]
  private static var backs: [String: CGImage] = [:]

  static func face(_ slot: Int, w: CGFloat, h: CGFloat) -> CGImage? {
    guard let info = Worlds.info(slot) else { return nil }
    let key = "\(slot)|\(w)x\(h)|\(Draw.scale)"
    if let c = faces[key] { return c }
    guard let img = render(w: w, h: h, theme: info.theme, { g, d in paintFace(g, d, info, w, h) }) else { return nil }
    faces[key] = img
    return img
  }

  static func back(w: CGFloat, h: CGFloat) -> CGImage? {
    let key = "\(w)x\(h)|\(Draw.scale)"
    if let c = backs[key] { return c }
    guard let img = render(w: w, h: h, theme: .base, { g, d in paintBack(g, d, w, h) }) else { return nil }
    backs[key] = img
    return img
  }

  // offscreen как в FirmamentumView.wall: Draw.scale, начало слева сверху
  private static func render(w: CGFloat, h: CGFloat, theme: Theme, _ paint: (CGContext, Draw) -> Void) -> CGImage? {
    let sc = Draw.scale
    guard let g = CGContext(data: nil, width: Int((w * sc).rounded(.up)), height: Int((h * sc).rounded(.up)), bitsPerComponent: 8, bytesPerRow: 0,
                            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue) else { return nil }
    g.translateBy(x: 0, y: CGFloat(g.height)); g.scaleBy(x: sc, y: -sc)
    let d = Draw(g: g, W: w, H: h); d.setTheme(theme)
    paint(g, d)
    return g.makeImage()
  }

  private static let T2 = CGFloat.pi * 2
  private static let roman = [1: "I", 2: "II", 4: "IV", 5: "V", 7: "VII", 8: "VIII", 9: "IX", 10: "X", 11: "XI", 12: "XII", 13: "XIII", 15: "XV"]   // worlds/*/index.js: n

  // map.js:250 fit — кегль уменьшается по 0.5, пока строка не влезет (мин. 7)
  private static func fit(_ s: String, _ size: CGFloat, _ maxW: CGFloat) -> CGFloat {
    var sz = size
    func width(_ k: CGFloat) -> CGFloat {
      let f = CTFontCreateWithName("IM_FELL_English_Italic" as CFString, k, nil)
      let line = CTLineCreateWithAttributedString(CFAttributedStringCreate(nil, s as CFString, [kCTFontAttributeName: f] as CFDictionary))
      return CGFloat(CTLineGetTypographicBounds(line, nil, nil, nil))
    }
    while sz > 7 && width(sz) > maxW { sz -= 0.5 }
    return sz
  }

  // canvas ellipse(): тот же угол и направление (по возрастанию), путь строится в текущей матрице
  private static func ell(_ g: CGContext, _ cx: CGFloat, _ cy: CGFloat, _ rx: CGFloat, _ ry: CGFloat, rot: CGFloat = 0, _ a0: CGFloat = 0, _ a1: CGFloat = T2) {
    g.saveGState(); g.translateBy(x: cx, y: cy); g.rotate(by: rot); g.scaleBy(x: rx, y: ry)
    g.addArc(center: .zero, radius: 1, startAngle: a0, endAngle: a1, clockwise: false)
    g.restoreGState()
  }
  private static func arc(_ g: CGContext, _ cx: CGFloat, _ cy: CGFloat, _ r: CGFloat, _ a0: CGFloat = 0, _ a1: CGFloat = T2) { ell(g, cx, cy, r, r, a0, a1) }

  // ---------- лицо ----------
  private static func paintFace(_ g: CGContext, _ d: Draw, _ info: WorldInfo, _ pw: CGFloat, _ ph: CGFloat) {
    let w = info.slot, th = info.theme, T2 = Emblems.T2
    func line(_ pts: [CGPoint]) { for (i, p) in pts.enumerated() { i == 0 ? g.move(to: p) : g.addLine(to: p) } }
    func S(_ a: CGFloat) { g.setStrokeColor(d.ink(a)) }
    func F(_ a: CGFloat) { g.setFillColor(d.ink(a)) }
    func bgF() { g.setFillColor(th.bg.cgColor) }
    func rgb(_ r: CGFloat, _ gg: CGFloat, _ b: CGFloat, _ a: CGFloat) -> CGColor { Draw.color((r, gg, b), a) }
    func P(_ pts: [CGPoint]) { g.beginPath(); line(pts); g.strokePath() }
    func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x, y: y) }

    bgF(); g.fill(CGRect(x: 0, y: 0, width: pw, height: ph))
    g.setLineWidth(1); S(0.7); g.stroke(CGRect(x: 1.5, y: 1.5, width: pw - 3, height: ph - 3))
    S(0.25); g.stroke(CGRect(x: 4.5, y: 4.5, width: pw - 9, height: ph - 9))
    let big = pw > 100, mc = ph * (big ? 0.46 : 0.5), M0 = min(pw * 0.4, ph * 0.26), R = M0 / 1.78, cx = pw / 2
    let cy = w == 4 ? mc - R * 0.12 : mc
    g.setLineWidth(1); S(0.85)

    switch w {
    case 1:                                               // планета: контур — осциллограмма по кругу, двойная звезда, спутник
      g.beginPath()
      for i in 0...240 {
        let a = CGFloat(i) / 240 * T2, wv = ((a * 5 / T2).truncatingRemainder(dividingBy: 1)) * 2 - 1, r = R + R * 0.1 * wv
        let p = pt(cx + cos(a) * r, cy + sin(a) * r); i > 0 ? g.addLine(to: p) : g.move(to: p)
      }
      g.strokePath()
      S(0.4); g.beginPath(); arc(g, cx, cy, R * 0.72); g.strokePath()
      for s: CGFloat in [-1, 1] { F(0.9); g.beginPath(); arc(g, cx + s * R * 0.16, cy, 2.2); g.fillPath() }
      g.setLineDash(phase: 0, lengths: [2, 4]); S(0.45); g.beginPath(); ell(g, cx, cy, R * 1.55, R * 0.5, rot: -0.35); g.strokePath(); g.setLineDash(phase: 0, lengths: [])
      F(0.9); g.beginPath()
      arc(g, cx + cos(0.6) * R * 1.55 * cos(-0.35) - sin(0.6) * R * 0.5 * sin(-0.35), cy + cos(0.6) * R * 1.55 * sin(-0.35) + sin(0.6) * R * 0.5 * cos(-0.35), 3); g.fillPath()
    case 2:                                               // пластина Хладни: клетки ханга бледно, узловые линии ярко
      S(0.3)
      for k in [1, (2.0 / 3).squareRoot(), (1.0 / 3).squareRoot()] { g.beginPath(); arc(g, cx, cy, R * 1.2 * CGFloat(k)); g.strokePath() }
      g.beginPath()
      for i in 0..<5 { let a = -CGFloat.pi / 2 + CGFloat(i) / 5 * T2; g.move(to: pt(cx, cy)); g.addLine(to: pt(cx + cos(a) * R * 1.2, cy + sin(a) * R * 1.2)) }
      g.strokePath()
      S(0.9); g.setLineWidth(1.4); g.beginPath()
      for i in 0...200 {
        let a = CGFloat(i) / 200 * T2, r = R * 1.2 * (0.62 + 0.25 * cos(3 * a)), p = pt(cx + cos(a) * r, cy + sin(a) * r)
        i > 0 ? g.addLine(to: p) : g.move(to: p)
      }
      g.strokePath(); g.setLineWidth(1)
      S(0.9); g.beginPath(); arc(g, cx, cy, R * 1.2); g.strokePath()
      S(0.35); g.beginPath(); arc(g, cx, cy, R * 1.2 + 3); g.strokePath()
    case 4:                                               // кувшинка с цветком; под ней три волны: sine, square, triangle
      let rx = R * 1.1, ry = rx * 0.45, ly = cy - R * 0.1
      g.setFillColor(d.paper(1)); g.setLineWidth(1.2); S(0.85)
      g.beginPath(); ell(g, cx, ly, rx, ry, 0.35, T2 - 0.05); g.addLine(to: pt(cx, ly)); g.closePath(); g.drawPath(using: .fillStroke)
      g.setLineWidth(0.7); S(0.45); g.beginPath()
      for q: CGFloat in [1.2, 2.1, 3.0, 3.9, 4.8] { g.move(to: pt(cx, ly)); g.addLine(to: pt(cx + cos(q) * rx * 0.8, ly + sin(q) * ry * 0.8)) }
      g.strokePath()
      S(0.9); g.setLineWidth(1.1); g.setFillColor(d.paper(1))
      let fx0 = cx - rx * 0.15, fy0 = ly - ry * 0.45, s = R * 0.36
      for k in 0..<8 {
        g.saveGState(); g.translateBy(x: fx0, y: fy0); g.rotate(by: CGFloat(k) / 8 * T2)
        g.beginPath(); ell(g, 0, -s * 0.62, s * 0.24, s * 0.5); g.drawPath(using: .fillStroke); g.restoreGState()
      }
      F(0.85); g.beginPath(); arc(g, fx0, fy0, s * 0.26); g.fillPath()
      let wy = cy + R * 0.95, ww = R * 0.55
      S(0.8); g.setLineWidth(1.1)
      let waves: [(CGFloat, (CGFloat) -> CGFloat)] = [(-1, { sin($0 * T2) }), (0, { $0 < 0.5 ? 1 : -1 }), (1, { 1 - 4 * abs($0 - 0.5) })]
      for (k, fn) in waves {
        let ox = cx + k * ww * 1.35 - ww / 2; g.beginPath()
        for i in 0...30 { let u = CGFloat(i) / 30, p = pt(ox + u * ww, wy - fn(u) * ww * 0.3); i > 0 ? g.addLine(to: p) : g.move(to: p) }
        g.strokePath()
      }
    case 5:                                               // воронка ада: круги сужаются вниз, на двух — пламя
      for k in 0..<6 {
        let rx = R * (1.25 - CGFloat(k) * 0.17), ry = rx * 0.16 + 1.5, y = cy - R * 0.75 + CGFloat(k) * R * 0.3, fl = k == 2 || k == 4
        g.setStrokeColor(fl ? rgb(226, 99, 42, 0.9) : d.ink(0.85 - CGFloat(k) * 0.08)); g.beginPath(); ell(g, cx, y, rx, ry); g.strokePath()
        if fl {
          g.setStrokeColor(rgb(226, 99, 42, 0.8)); g.beginPath()
          for j in 0..<7 {
            let a = CGFloat.pi * (1 - (CGFloat(j) + 0.5) / 7), px = cx - cos(a) * rx, py = y + sin(a) * ry
            g.move(to: pt(px - 1.6, py)); g.addQuadCurve(to: pt(px + 1.6, py), control: pt(px, py - 7))
          }
          g.strokePath()
        }
      }
      g.setStrokeColor(rgb(185, 210, 223, 0.8)); g.beginPath(); ell(g, cx, cy + R * 1.05, R * 0.25, 3.5); g.strokePath()
    case 7:                                               // монохорд: ящик, три струны, подставка, дуги интервалов справа
      let bw = R * 0.62, bh = R * 2.3, y0 = cy - bh / 2
      S(0.8); g.stroke(CGRect(x: cx - bw / 2, y: y0, width: bw, height: bh))
      S(0.9); g.beginPath()
      for k in -1...1 { let x = cx + CGFloat(k) * bw * 0.28; g.move(to: pt(x, y0 + 3)); g.addLine(to: pt(x, y0 + bh - 3)) }
      g.strokePath()
      let yb = y0 + bh * 0.62; F(0.9); g.beginPath(); line([pt(cx - bw * 0.42, yb + 3), pt(cx, yb - 3), pt(cx + bw * 0.42, yb + 3)]); g.closePath(); g.fillPath()
      S(0.5); g.beginPath(); g.move(to: pt(cx + bw / 2 + 2, y0 + 3))
      g.addQuadCurve(to: pt(cx + bw / 2 + 2, y0 + bh / 2), control: pt(cx + bw / 2 + R * 0.6, y0 + bh * 0.3))
      g.addQuadCurve(to: pt(cx + bw / 2 + 2, y0 + bh - 3), control: pt(cx + bw / 2 + R * 0.6, y0 + bh * 0.75))
      g.strokePath()
    case 8:                                               // карта T-O: земля с буквой T, вокруг океан — волнистое кольцо
      let rd = R * 0.62
      S(0.85); g.beginPath(); arc(g, cx, cy, rd); g.strokePath()
      S(0.6); g.beginPath(); g.move(to: pt(cx - rd, cy)); g.addLine(to: pt(cx + rd, cy)); g.move(to: pt(cx, cy)); g.addLine(to: pt(cx, cy + rd)); g.strokePath()
      S(0.9); g.beginPath()
      for i in 0...120 {
        let a = CGFloat(i) / 120 * T2, r = R * (1.02 + 0.1 * sin(3 * a) + 0.05 * sin(7 * a + 1)), p = pt(cx + cos(a) * r, cy + sin(a) * r)
        i > 0 ? g.addLine(to: p) : g.move(to: p)
      }
      g.strokePath()
      F(0.85); g.beginPath(); arc(g, cx + R * 1.3, cy - R * 0.55, R * 0.16); g.fillPath()
      bgF(); g.beginPath(); arc(g, cx + R * 1.36, cy - R * 0.58, R * 0.14); g.fillPath()
    case 9:                                               // волшебные числа: кольца IV, V, VI с метками, стрелка-солнце
      for (n, k) in [(4, CGFloat(0.42)), (5, 0.66), (6, 0.9)] {
        let rr = R * k; S(0.75); g.beginPath(); arc(g, cx, cy, rr); g.strokePath()
        F(0.9)
        for j in 0..<n { let a = CGFloat(j) / CGFloat(n) * T2; g.beginPath(); arc(g, cx + sin(a) * rr, cy - cos(a) * rr, R * 0.06); g.fillPath() }
      }
      S(0.9); g.beginPath(); g.move(to: pt(cx, cy)); g.addLine(to: pt(cx + sin(2.4) * R * 1.02, cy - cos(2.4) * R * 1.02)); g.strokePath()
      g.beginPath(); arc(g, cx + sin(2.4) * R * 1.1, cy - cos(2.4) * R * 1.1, R * 0.1); g.strokePath()
      F(0.9); g.beginPath(); arc(g, cx, cy, R * 0.07); g.fillPath()
    case 10:                                              // твердь: купол над землёй, звёзды-проколы, под ними — пульсареты
      let by = cy + R * 0.55, rr = R * 1.05
      S(0.85); g.beginPath(); arc(g, cx, by, rr, .pi, T2); g.strokePath()
      g.beginPath(); g.move(to: pt(cx - rr * 1.15, by)); g.addLine(to: pt(cx + rr * 1.15, by)); g.strokePath()
      S(0.9)
      for (sx, sy) in [(-0.45, -0.55), (0.3, -0.75), (0.55, -0.3), (-0.1, -0.25)] as [(CGFloat, CGFloat)] {
        let px = cx + sx * rr, py = by + sy * rr; g.beginPath()
        for k in 0..<8 { let a = CGFloat(k) / 8 * T2, l: CGFloat = k % 2 == 1 ? 2 : 4; g.move(to: pt(px, py)); g.addLine(to: pt(px + cos(a) * l, py + sin(a) * l)) }
        g.strokePath()
      }
      S(0.7); g.beginPath(); let py = by + R * 0.42
      for i in 0...80 {
        let u = CGFloat(i) / 80, k = (u * 4).truncatingRemainder(dividingBy: 1)
        let env: CGFloat = k < 0.35 ? pow(sin(.pi * k / 0.35), 2) : 0
        let p = pt(cx - R * 0.9 + u * R * 1.8, py - sin(k * 40) * env * R * 0.18); i > 0 ? g.addLine(to: p) : g.move(to: p)
      }
      g.strokePath()
    case 11:                                              // три тела на восьмёрке
      S(0.6); g.beginPath()
      for i in 0...120 { let t = CGFloat(i) / 120 * T2, p = pt(cx + sin(t) * R * 1.05, cy + sin(2 * t) * R * 0.42); i > 0 ? g.addLine(to: p) : g.move(to: p) }
      g.strokePath()
      S(0.9); bgF()
      for t: CGFloat in [0.4, 0.4 + T2 / 3, 0.4 + 2 * T2 / 3] {
        g.beginPath(); arc(g, cx + sin(t) * R * 1.05, cy + sin(2 * t) * R * 0.42, R * 0.16); g.drawPath(using: .fillStroke)
      }
    case 12:                                              // пейзаж в перспективе: горизонт, горы со штриховкой, холм, деревце, петля сканера с флажком
      let hy = cy - R * 0.35
      S(0.6); P([pt(cx - R * 1.15, hy), pt(cx + R * 1.15, hy)])
      func mt(_ mx: CGFloat, _ my: CGFloat, _ h: CGFloat, _ wd: CGFloat) {
        bgF(); S(0.9); g.beginPath(); g.move(to: pt(mx - wd / 2, my))
        g.addQuadCurve(to: pt(mx, my - h), control: pt(mx - wd * 0.2, my - h * 0.45))
        g.addQuadCurve(to: pt(mx + wd / 2, my), control: pt(mx + wd * 0.18, my - h * 0.5)); g.drawPath(using: .fillStroke)
        S(0.5); g.beginPath()
        for k in 1...3 { let f = CGFloat(k) / 4; g.move(to: pt(mx + wd * 0.5 * f, my - h * (1 - f))); g.addLine(to: pt(mx + wd * 0.5 * f - wd * 0.1, my)) }
        g.strokePath()
      }
      mt(cx - R * 0.35, hy + R * 0.1, R * 0.75, R * 0.9); mt(cx + R * 0.25, hy + R * 0.15, R * 0.55, R * 0.8)
      S(0.85); g.beginPath(); ell(g, cx + R * 0.1, cy + R * 0.55, R * 0.62, R * 0.2); g.strokePath()
      F(0.95); g.beginPath(); arc(g, cx + R * 0.72, cy + R * 0.55, 2); g.fillPath()
      S(0.95); P([pt(cx + R * 0.1, cy + R * 0.55), pt(cx + R * 0.1, cy + R * 0.12), pt(cx + R * 0.36, cy + R * 0.2), pt(cx + R * 0.1, cy + R * 0.28)])
      g.setStrokeColor(rgb(46, 86, 104, 0.85)); g.beginPath(); g.move(to: pt(cx - R * 0.9, cy + R * 0.2))
      g.addQuadCurve(to: pt(cx - R * 0.7, cy + R * 0.8), control: pt(cx - R * 0.5, cy + R * 0.35)); g.strokePath()
    case 13:                                              // бухта: маяк на мысу, луна, круги эха на воде
      let hy = cy + R * 0.05, moon = rgb(238, 198, 126, 1)
      S(0.6); P([pt(cx - R * 1.15, hy), pt(cx + R * 1.15, hy)])
      g.setFillColor(rgb(238, 198, 126, 0.85)); g.beginPath(); arc(g, cx - R * 0.45, cy - R * 0.45, R * 0.22); g.fillPath()
      bgF(); g.beginPath(); arc(g, cx - R * 0.36, cy - R * 0.5, R * 0.2); g.fillPath()
      let tx = cx + R * 0.55, ty = cy + R * 0.75
      bgF(); S(0.9); g.beginPath(); line([pt(tx - R * 0.16, ty), pt(tx - R * 0.1, ty - R * 0.9), pt(tx + R * 0.1, ty - R * 0.9), pt(tx + R * 0.16, ty)]); g.closePath(); g.drawPath(using: .fillStroke)
      g.setFillColor(moon.copy(alpha: 0.9)!); g.fill(CGRect(x: tx - R * 0.07, y: ty - R * 1.08, width: R * 0.14, height: R * 0.16))
      g.setFillColor(moon.copy(alpha: 0.12)!); g.beginPath(); line([pt(tx, ty - R), pt(cx - R * 1.1, hy - R * 0.1), pt(cx - R * 1.1, hy + R * 0.25)]); g.closePath(); g.fillPath()
      for k in 1...3 { S(0.75 * (1 - CGFloat(k) * 0.25)); g.beginPath(); ell(g, cx - R * 0.25, cy + R * 0.55, R * 0.22 * CGFloat(k), R * 0.07 * CGFloat(k)); g.strokePath() }   // globalAlpha × alpha цвета
    case 15:                                              // круг заклинателя: двойное кольцо, восемь знаков, красная печать с кружком и чертой
      S(0.85); g.beginPath(); arc(g, cx, cy, R * 1.05); g.strokePath()
      S(0.35); g.beginPath(); arc(g, cx, cy, R * 0.9); g.strokePath()
      func Pk(_ k: Int) -> CGPoint { pt(cx + sin(CGFloat(k) / 8 * T2) * R * 0.66, cy - cos(CGFloat(k) / 8 * T2) * R * 0.66) }
      F(0.8); for k in 0..<8 { let p = Pk(k); g.beginPath(); arc(g, p.x, p.y, R * 0.06); g.fillPath() }
      let seal = [7, 3, 0, 5, 2].map(Pk)
      g.setStrokeColor(rgb(206, 66, 48, 0.95)); g.setLineWidth(1.2); g.beginPath(); line(seal); g.strokePath()
      g.beginPath(); arc(g, seal[0].x, seal[0].y, R * 0.11); g.strokePath()
      let a = seal[3], b = seal[4], dd = hypot(b.x - a.x, b.y - a.y), ux = (b.x - a.x) / dd, uy = (b.y - a.y) / dd
      g.beginPath(); g.move(to: pt(b.x - uy * R * 0.16, b.y + ux * R * 0.16)); g.addLine(to: pt(b.x + uy * R * 0.16, b.y - ux * R * 0.16)); g.strokePath(); g.setLineWidth(1)
    default: break
    }

    // гравированный медальон: двойной круг, засечки по сторонам света, ромбики на диагоналях
    let M = M0, my = mc
    g.setLineWidth(1); S(0.8); g.beginPath(); arc(g, cx, my, M); g.strokePath()
    S(0.3); g.beginPath(); arc(g, cx, my, M - 5); g.strokePath()
    S(0.55); g.beginPath()
    for k in 0..<4 { let a = CGFloat(k) / 4 * T2; g.move(to: pt(cx + cos(a) * (M + 2), my + sin(a) * (M + 2))); g.addLine(to: pt(cx + cos(a) * (M + 8), my + sin(a) * (M + 8))) }
    g.strokePath()
    F(0.5)
    for k in 0..<4 {
      let a = CGFloat.pi / 4 + CGFloat(k) / 4 * T2, px = cx + cos(a) * (M - 2.5), py = my + sin(a) * (M - 2.5)
      g.beginPath(); line([pt(px, py - 2.4), pt(px + 1.6, py), pt(px, py + 2.4), pt(px - 1.6, py)]); g.closePath(); g.fillPath()
    }
    let n = roman[w] ?? "", title = info.title
    d.mapText(n, cx, 15, fit(n, big ? 15 : 12, pw - 12), 0.75, align: .center)
    d.mapText(title, cx, ph - (big ? 34 : 14), fit(title, big ? 16 : 12, pw - 10), 0.95, align: .center)
  }

  // ---------- рубашка ----------
  // база темы — всегда: map.js:263 (INK0, BG0)
  private static func paintBack(_ g: CGContext, _ d: Draw, _ pw: CGFloat, _ ph: CGFloat) {
    let T2 = Emblems.T2
    func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x, y: y) }
    g.setFillColor(UIColor.black.cgColor); g.fill(CGRect(x: 0, y: 0, width: pw, height: ph))
    g.setLineWidth(1); g.setStrokeColor(d.ink(0.5)); g.stroke(CGRect(x: 1.5, y: 1.5, width: pw - 3, height: ph - 3))
    g.setStrokeColor(d.ink(0.22)); g.stroke(CGRect(x: 4.5, y: 4.5, width: pw - 9, height: ph - 9))
    g.saveGState(); g.clip(to: CGRect(x: 7, y: 7, width: pw - 14, height: ph - 14))
    g.setStrokeColor(d.ink(0.09)); g.setLineWidth(0.8); g.beginPath()
    var x = -ph
    while x < pw + ph {
      g.move(to: pt(x, 0)); g.addLine(to: pt(x + ph * 0.6, ph)); g.move(to: pt(x, ph)); g.addLine(to: pt(x + ph * 0.6, 0)); x += 8
    }
    g.strokePath(); g.restoreGState()
    let cx = pw / 2, cy = ph / 2, r = min(pw * 0.3, ph * 0.2)
    g.setFillColor(UIColor.black.cgColor); g.beginPath(); arc(g, cx, cy, r + 3); g.fillPath()
    g.setLineWidth(1); g.setStrokeColor(d.ink(0.45)); g.beginPath(); arc(g, cx, cy, r); g.strokePath()
    g.setStrokeColor(d.ink(0.2)); g.beginPath(); arc(g, cx, cy, r - 3); g.strokePath()
    g.setStrokeColor(d.ink(0.5)); g.beginPath()
    for k in 0..<8 {
      let a = CGFloat(k) / 8 * T2 - .pi / 2, b = a + T2 / 16, p = pt(cx + cos(a) * r * 0.78, cy + sin(a) * r * 0.78)
      k > 0 ? g.addLine(to: p) : g.move(to: p)
      g.addLine(to: pt(cx + cos(b) * r * 0.3, cy + sin(b) * r * 0.3))
    }
    g.closePath(); g.strokePath()
    g.setFillColor(d.ink(0.5)); g.beginPath(); arc(g, cx, cy, 1.6); g.fillPath()
    for y in [12, ph - 12] {
      g.beginPath(); g.move(to: pt(cx, y - 3.5)); g.addLine(to: pt(cx + 1.4, y)); g.addLine(to: pt(cx, y + 3.5)); g.addLine(to: pt(cx - 1.4, y)); g.closePath(); g.fillPath()
    }
  }
}
