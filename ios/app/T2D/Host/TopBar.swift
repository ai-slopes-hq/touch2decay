import UIKit
import CoreText

// верхняя строка хоста — порт host/ui-top.js: раскладка, попадания, список ладов, рисование.
// top — safeAreaInsets.top (scopeY веба), W — ширина экрана в пунктах. Без теней, жирного и градиентов.

enum Btn: CaseIterable { case back, vol, scl, rev, dice, undo, clr }
enum Hit: Equatable { case btn(Btn), title }
enum SclPick: Equatable { case off, scale(Int), root(Int), outside }

struct TopBar {
  var W: CGFloat
  var top: CGFloat

  // ui-top.js:11-12
  static let btnR: CGFloat = 20, itemH: CGFloat = 46, clrR: CGFloat = 17
  static let titleX: CGFloat = 46
  private static let listW: CGFloat = 150, tonW: CGFloat = 40

  struct State {
    var title: String
    var vol: Double                 // позиция фейдера 0…1
    var volHeld: Bool
    var scl: Scl
    var sclOpen: Bool               // открыт список ладов (тап по кнопке, тап по строке)
    var canUndo: Bool
    var fxArc: Double?              // дуга на кнопке FX; nil — у мира нет веера
    var fxHeld: Bool
    var diceAt: Double              // мс, момент броска; кость крутится 400 мс
  }

  // ui-top.js:13-23 — центры и радиусы кружков; r — радиус кольца
  func pos(_ b: Btn) -> (x: CGFloat, y: CGFloat, r: CGFloat) {
    let y = top + 20
    switch b {
    case .back: return (26, y, 13)
    case .clr: return (W - 27, y, TopBar.clrR)
    case .undo: return (W - 66, y, TopBar.clrR)
    case .dice: return (W - 105, y, TopBar.clrR)
    case .rev: return (W - 150, y, TopBar.btnR)
    case .vol: return (W - 238, y, TopBar.clrR)
    case .scl: return (W - 196, y, TopBar.btnR)
    }
  }

  // ui-top.js:24-30
  struct SclList { var b: (x: CGFloat, y: CGFloat), rows: Int, top: CGFloat, bx: CGFloat, rx: CGFloat, cw: CGFloat, ch: CGFloat }
  var sclList: SclList {
    let b = pos(.scl), rows = Scales.labels.count + 1, t = b.y + 40
    let cw = TopBar.tonW, bx = W - 12 - (2 * cw + 8) - TopBar.listW, rx = bx + TopBar.listW + 8
    return SclList(b: (b.x, b.y), rows: rows, top: t, bx: bx, rx: rx, cw: cw, ch: CGFloat(rows) * TopBar.itemH / 6)
  }

  // ui-top.js:35-38 — -1 мимо; иначе номер тоники: колонка * 6 + ряд
  private func rootAt(_ L: SclList, _ x: CGFloat, _ y: CGFloat) -> Int {
    if x < L.rx || x > L.rx + 2 * L.cw || y < L.top || y > L.top + CGFloat(L.rows) * TopBar.itemH { return -1 }
    let col = min(max(Int(floor((x - L.rx) / L.cw)), 0), 1), row = min(max(Int(floor((y - L.top) / L.ch)), 0), 5)
    return col * 6 + row
  }

  // ui-top.js:41-57 (headHit без угла и края: угол 44×44 замеров знает Stage, левую полосу — Host.route; затем btnHit). dice и rev попадаются всегда:
  // есть ли у мира кубик и FX, решает роутер
  func hit(_ x: CGFloat, _ y: CGFloat, titleW: CGFloat) -> Hit? {
    let B = pos(.back)
    if hypot(x - B.x, y - B.y) < B.r + 10 { return .btn(.back) }
    if y < top + 38 && x > TopBar.titleX - 4 && x < TopBar.titleX + titleW + 10 { return .title }
    let v = pos(.vol)
    if hypot(x - v.x, y - v.y) < TopBar.clrR + 4 { return .btn(.vol) }
    for k in [Btn.rev, .scl, .clr, .undo, .dice] {
      let b = pos(k), small = k == .clr || k == .undo || k == .dice
      if hypot(x - b.x, y - b.y) < (small ? TopBar.clrR + 4 : TopBar.btnR + 6) { return .btn(k) }
    }
    return nil
  }

  // app.js:897-909 — что под пальцем у открытого списка (без задержки на смену строки: её держит роутер)
  func sclPick(_ x: CGFloat, _ y: CGFloat) -> SclPick {
    let L = sclList
    if y < L.b.y + 40 { return .outside }
    let r = rootAt(L, x, y)
    if r >= 0 { return .root(r) }
    guard x > L.bx - 12 && x < L.rx - 2 else { return .outside }
    let row = min(max(Int(floor((y - L.top) / TopBar.itemH)), 0), Scales.labels.count)
    return row == 0 ? .off : .scale(row - 1)
  }

  // ---------- рисование ----------
  // ширина заголовка нужна и рисованию (подбор кегля), и попаданиям; шрифты — в кеше, в кадре не создаём
  private static var titleFonts: [CGFloat: CTFont] = [:]
  private static func titleWidth(_ s: String, _ size: CGFloat) -> CGFloat {
    let f = titleFonts[size] ?? CTFontCreateWithName("IM_FELL_English_Italic" as CFString, size, nil)
    titleFonts[size] = f
    let line = CTLineCreateWithAttributedString(CFAttributedStringCreate(nil, s as CFString, [kCTFontAttributeName: f] as CFDictionary))
    return CGFloat(CTLineGetTypographicBounds(line, nil, nil, nil))
  }

  // ui-top.js:59-85
  private func drawVol(_ d: Draw, _ s: State) {
    let g = d.g, b = pos(.vol), h: CGFloat = 18, y0 = b.y - h / 2
    func ly(_ t: Double) -> CGFloat { y0 + CGFloat(1 - t) * h }
    let held = s.volHeld, a: CGFloat = s.sclOpen ? 0.15 : 1
    g.setFillColor(d.paper(0.88)); g.fillEllipse(in: CGRect(x: b.x - TopBar.clrR - 1, y: b.y - TopBar.clrR - 1, width: 2 * TopBar.clrR + 2, height: 2 * TopBar.clrR + 2))
    d.ring(b.x, b.y, TopBar.clrR, (held ? 1 : 0.45) * a, 1.2)
    let z = ly(Vol.def)
    g.setStrokeColor(d.ink(0.35 * a)); g.setLineWidth(1)
    g.beginPath()
    g.move(to: CGPoint(x: b.x - 1.5, y: y0)); g.addLine(to: CGPoint(x: b.x - 1.5, y: y0 + h))
    g.move(to: CGPoint(x: b.x + 1.5, y: y0)); g.addLine(to: CGPoint(x: b.x + 1.5, y: y0 + h))
    g.strokePath()
    g.beginPath()
    g.move(to: CGPoint(x: b.x - 5, y: z)); g.addLine(to: CGPoint(x: b.x - 2.5, y: z))
    g.move(to: CGPoint(x: b.x + 2.5, y: z)); g.addLine(to: CGPoint(x: b.x + 5, y: z))
    g.strokePath()
    g.setStrokeColor(d.ink((held ? 1 : 0.8) * a)); g.setLineWidth(1.6)
    g.beginPath(); g.move(to: CGPoint(x: b.x - 5.5, y: ly(s.vol))); g.addLine(to: CGPoint(x: b.x + 5.5, y: ly(s.vol))); g.strokePath()
    if !held { return }
    // зажат — длинная шкала вниз с подписью
    let t0 = b.y + 34, L = Vol.travel
    func sy(_ t: Double) -> CGFloat { t0 + CGFloat(1 - t) * L }
    g.setFillColor(d.paper(0.9)); g.fill(CGRect(x: b.x - 22, y: t0 - 14, width: 92, height: L + 28))
    d.hairBox(b.x - 22, t0 - 14, 92, L + 28, 0.3)
    g.setStrokeColor(d.ink(0.4)); g.setLineWidth(1)
    g.beginPath()
    g.move(to: CGPoint(x: b.x - 1.5, y: t0)); g.addLine(to: CGPoint(x: b.x - 1.5, y: t0 + L))
    g.move(to: CGPoint(x: b.x + 1.5, y: t0)); g.addLine(to: CGPoint(x: b.x + 1.5, y: t0 + L))
    g.strokePath()
    g.beginPath()
    var db = Vol.lo
    while db <= Vol.hi {   // засечки через 6 дБ, у нуля длиннее
      let y = sy((db - Vol.lo) / (Vol.hi - Vol.lo)), l: CGFloat = db == 0 ? 9 : 5
      g.move(to: CGPoint(x: b.x - 2.5 - l, y: y)); g.addLine(to: CGPoint(x: b.x - 2.5, y: y))
      db += 6
    }
    g.strokePath()
    g.setStrokeColor(d.ink(1)); g.setLineWidth(2)
    g.beginPath(); g.move(to: CGPoint(x: b.x - 9, y: sy(s.vol))); g.addLine(to: CGPoint(x: b.x + 9, y: sy(s.vol))); g.strokePath()
    d.text(Vol.text(s.vol), b.x + 14, sy(s.vol), 14, 0.95)
  }

  // ui-top.js:92-191; возвращает ширину заголовка — её отдают в hit(titleW:)
  @discardableResult
  func draw(_ d: Draw, _ s: State, now: Double) -> CGFloat {
    let g = d.g, dimT = s.sclOpen
    // верхняя строка: тёмная подложка (в вебе градиент — в кадре без градиентов, ровная)
    g.setFillColor(d.paper(0.55)); g.fill(CGRect(x: 0, y: 0, width: W, height: top + 44))
    // заголовок — имя мира; не влез — мельче
    var tsz: CGFloat = 21
    let tmax = pos(.vol).x - TopBar.clrR - 30 - TopBar.titleX
    var tw = TopBar.titleWidth(s.title, tsz)
    while tsz > 14 && tw > tmax { tsz -= 0.5; tw = TopBar.titleWidth(s.title, tsz) }
    d.mapText(s.title, TopBar.titleX, top + 20, tsz, dimT ? 0.12 : 0.85)
    if !dimT {   // тонкая черта: заголовок — легенда
      g.setStrokeColor(d.ink(0.18)); g.setLineWidth(1)
      g.beginPath(); g.move(to: CGPoint(x: TopBar.titleX, y: top + 33.5)); g.addLine(to: CGPoint(x: TopBar.titleX + tw, y: top + 33.5)); g.strokePath()
    }
    // стрелка назад — приглушена, пока карты нет
    let B = pos(.back)
    g.setFillColor(d.paper(0.88)); g.fillEllipse(in: CGRect(x: B.x - B.r - 1, y: B.y - B.r - 1, width: 2 * B.r + 2, height: 2 * B.r + 2))
    d.ring(B.x, B.y, B.r, 0.45 * 0.3, 1.1)
    g.setStrokeColor(d.ink(0.8 * 0.3)); g.setLineWidth(1.4); g.setLineCap(.round)
    g.beginPath(); g.move(to: CGPoint(x: B.x + 2.5, y: B.y - 5.5)); g.addLine(to: CGPoint(x: B.x - 3, y: B.y)); g.addLine(to: CGPoint(x: B.x + 2.5, y: B.y + 5.5)); g.strokePath()
    g.setLineCap(.butt)

    drawVol(d, s)
    // кнопки лежат поверх карты — у каждой тёмная подложка
    for k in [Btn.rev, .scl, .undo, .clr, .dice] {
      let p = pos(k), rr = p.r + 1
      g.setFillColor(d.paper(0.88)); g.fillEllipse(in: CGRect(x: p.x - rr, y: p.y - rr, width: 2 * rr, height: 2 * rr))
    }
    // FX: три кольца; у мира нет веера — кнопка тусклая; с веером — дуга по кольцу (ui-top.js:116-123)
    let r = pos(.rev), dimFx: CGFloat = s.fxArc != nil ? 1 : 0.35
    d.ring(r.x, r.y, TopBar.btnR, (s.fxHeld ? 1 : 0.45) * dimFx, 1.2)
    for (rr, a) in [(CGFloat(6), CGFloat(0.9)), (11, 0.55), (16, 0.3)] { d.ring(r.x, r.y, rr, a * (s.fxHeld ? 1 : 0.8) * dimFx, 1) }
    if let arc = s.fxArc {
      g.setStrokeColor(d.ink(0.9)); g.setLineWidth(2)
      g.beginPath(); g.addArc(center: CGPoint(x: r.x, y: r.y), radius: TopBar.btnR + 5, startAngle: -.pi / 2, endAngle: -.pi / 2 + CGFloat(arc) * .pi * 2, clockwise: false); g.strokePath()
    }

    // кубик: кружок с костью; после броска кость крутится
    let dq = pos(.dice), since = now - s.diceAt
    d.ring(dq.x, dq.y, TopBar.clrR, 0.45, 1.2)
    g.saveGState(); g.translateBy(x: dq.x, y: dq.y); g.rotate(by: 0.18 + (since < 400 ? CGFloat(since / 60) : 0))
    g.setStrokeColor(d.ink(0.8)); g.setLineWidth(1.2)
    g.addPath(CGPath(roundedRect: CGRect(x: -7, y: -7, width: 14, height: 14), cornerWidth: 2.5, cornerHeight: 2.5, transform: nil)); g.strokePath()
    for (px, py) in [(-3.2, -3.2), (3.2, -3.2), (0, 0), (-3.2, 3.2), (3.2, 3.2)] as [(CGFloat, CGFloat)] { d.dot(px, py, 1.1, 0.85) }
    g.restoreGState()

    // отмена: стрелка по дуге; пустая история — тусклая
    let u = pos(.undo), can = s.canUndo
    d.ring(u.x, u.y, TopBar.clrR, can ? 0.45 : 0.18, 1.2)
    g.setStrokeColor(d.ink(can ? 0.8 : 0.25)); g.setLineWidth(1.4); g.setLineCap(.round)
    g.beginPath(); g.addArc(center: CGPoint(x: u.x + 1, y: u.y + 1), radius: 6, startAngle: .pi * 1.05, endAngle: .pi * 2.35, clockwise: false); g.strokePath()
    g.beginPath(); g.move(to: CGPoint(x: u.x - 8.5, y: u.y - 3.5)); g.addLine(to: CGPoint(x: u.x - 5, y: u.y + 1.5)); g.addLine(to: CGPoint(x: u.x - 1, y: u.y - 2)); g.strokePath()
    g.setLineCap(.butt)

    // убрать всё: корзина (не крестик — его легко принять за «закрыть»)
    let c = pos(.clr)
    d.ring(c.x, c.y, TopBar.clrR, 0.45, 1.2)
    g.setStrokeColor(d.ink(0.75)); g.setLineWidth(1.2)
    g.beginPath()
    g.move(to: CGPoint(x: c.x - 7, y: c.y - 4.5)); g.addLine(to: CGPoint(x: c.x + 7, y: c.y - 4.5))      // крышка
    g.move(to: CGPoint(x: c.x - 2.5, y: c.y - 7)); g.addLine(to: CGPoint(x: c.x + 2.5, y: c.y - 7))      // ручка
    g.move(to: CGPoint(x: c.x - 5.5, y: c.y - 4.5)); g.addLine(to: CGPoint(x: c.x - 4.3, y: c.y + 7))
    g.addLine(to: CGPoint(x: c.x + 4.3, y: c.y + 7)); g.addLine(to: CGPoint(x: c.x + 5.5, y: c.y - 4.5))
    g.move(to: CGPoint(x: c.x - 1.6, y: c.y - 1.5)); g.addLine(to: CGPoint(x: c.x - 1.4, y: c.y + 4.5))
    g.move(to: CGPoint(x: c.x + 1.6, y: c.y - 1.5)); g.addLine(to: CGPoint(x: c.x + 1.4, y: c.y + 4.5))
    g.strokePath()

    // лад: лесенка; зажата — список ладов и тоники
    let L = sclList, b = L.b, scl = s.scl
    if s.sclOpen {
      d.reading {
        let rows = ["off"] + Scales.labels, h = CGFloat(L.rows) * TopBar.itemH + 16
        g.setFillColor(d.paper(0.9)); g.fill(CGRect(x: L.bx, y: L.top - 8, width: TopBar.listW, height: h))
        d.hairBox(L.bx, L.top - 8, TopBar.listW, h, 0.3)
        for (i, label) in rows.enumerated() {
          let y = L.top + TopBar.itemH * (CGFloat(i) + 0.5), on = i == 0 ? !scl.on : scl.on && i - 1 == scl.idx
          d.text(label, L.bx + 22, y, 15, on ? 1 : 0.45)   // выбранная — ярче, не жирнее
          if on { d.dot(L.bx + 12, y, 3, 1) }
          if i > 0 {
            let ly = (y + TopBar.itemH / 2 + 0.5).rounded(.down) + 0.5
            g.setStrokeColor(d.ink(0.1)); g.setLineWidth(1)
            g.beginPath(); g.move(to: CGPoint(x: L.bx + 8, y: ly)); g.addLine(to: CGPoint(x: L.bx + TopBar.listW - 8, y: ly)); g.strokePath()
          }
        }
        // тоники: две колонки по шесть справа от списка
        g.setFillColor(d.paper(0.9)); g.fill(CGRect(x: L.rx - 4, y: L.top - 8, width: 2 * L.cw + 8, height: h))
        d.hairBox(L.rx - 4, L.top - 8, 2 * L.cw + 8, h, 0.3)
        for (i, nm) in Scales.notes.enumerated() {
          let col = CGFloat(i / 6), row = CGFloat(i % 6), on = i == scl.root
          let x = L.rx + L.cw * (col + 0.5), y = L.top + L.ch * (row + 0.5)
          if on { d.hairBox(L.rx + L.cw * col + 4, L.top + L.ch * row + 4, L.cw - 8, L.ch - 8, 0.9) }
          d.text(nm, x, y, 13, on ? 1 : 0.5, align: .center)
        }
      }
    } else if scl.on {   // лад включён — его имя под заголовком
      d.text("\(Scales.notes[scl.root]) \(Scales.labels[scl.idx])", 18, top + 46, 11, 0.5)
    }
    if scl.on {
      g.setFillColor(d.ink(0.9)); g.fillEllipse(in: CGRect(x: b.x - TopBar.btnR, y: b.y - TopBar.btnR, width: 2 * TopBar.btnR, height: 2 * TopBar.btnR))
    } else { d.ring(b.x, b.y, TopBar.btnR, 0.45, 1.2) }
    if scl.on { g.setStrokeColor(d.paper(1)) } else { g.setStrokeColor(d.ink(0.8)) }   // на залитой кнопке — цветом фона (BG веба)
    g.setLineWidth(1.6); g.setLineJoin(.round)
    g.beginPath(); g.move(to: CGPoint(x: b.x - 11, y: b.y + 8))
    for i in 0..<4 {
      let x = b.x - 11 + CGFloat(i) * 6, y = b.y + 8 - CGFloat(i) * 5
      g.addLine(to: CGPoint(x: x, y: y - 5)); g.addLine(to: CGPoint(x: x + 6, y: y - 5))
    }
    g.strokePath()
    return tw
  }
}
