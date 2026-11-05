import UIKit
import CoreText

// верхняя строка хоста — порт host/ui-top.js: раскладка, попадания, список ладов, рисование.
// top — safeAreaInsets.top (scopeY веба), W — ширина экрана в пунктах. Без теней, жирного и градиентов.

enum Btn: CaseIterable { case back, play, transport, vol, fx }
enum Hit: Equatable { case btn(Btn), title }

struct TopBar {
  var W: CGFloat
  var top: CGFloat
  var H: CGFloat = 0
  var safeBot: CGFloat = 0

  static let btnR: CGFloat = 20, clrR: CGFloat = 17
  static let titleX: CGFloat = 46
  static let barH: CGFloat = 52          // нижний бар; мирам и плашке хост отдаёт safeBot + barH

  struct State {
    var title: String
    var held: Set<Btn> = []             // палец на кнопке: кольцо и знак ярче
    var playing = false                 // часы идут: на кнопке пауза, иначе треугольник
    var enabled = Set(Btn.allCases)     // неактивные кнопки притушены и не ловят касания
  }

  // пять кнопок на нижней строке: back слева; fx, vol, transport, play справа налево, шаг 38 у малых
  func pos(_ b: Btn) -> (x: CGFloat, y: CGFloat, r: CGFloat) {
    let y = H - safeBot - TopBar.barH / 2
    switch b {
    case .back: return (26, y, TopBar.clrR)
    case .fx: return (W - 27, y, TopBar.btnR)
    case .vol: return (W - 68, y, TopBar.clrR)
    case .transport: return (W - 106, y, TopBar.clrR)
    case .play: return (W - 144, y, TopBar.clrR)
    }
  }

  // правый край заголовка сверху: до правого поля
  var titleMax: CGFloat { W - TopBar.titleX - 16 }

  // нижний бар и заголовок: побеждает ближайший центр (зоны соседей перекрываются на 4 пт).
  // Неактивные кнопки не ловят касание. Заголовок — вход в легенду. Угол 44×44 знает Stage, левую полосу — Host.route
  func hit(_ x: CGFloat, _ y: CGFloat, titleW: CGFloat, enabled: Set<Btn> = Set(Btn.allCases)) -> Hit? {
    let B = pos(.back)
    if enabled.contains(.back) && hypot(x - B.x, y - B.y) < B.r + 10 { return .btn(.back) }
    if y < top + 38 && x > TopBar.titleX - 4 && x < TopBar.titleX + titleW + 10 { return .title }
    var best: (Btn, CGFloat)?
    for k in [Btn.fx, .vol, .transport, .play] where enabled.contains(k) {
      let b = pos(k), dd = hypot(x - b.x, y - b.y)
      if dd < (k == .fx ? TopBar.btnR + 6 : TopBar.clrR + 4) && dd < (best?.1 ?? .infinity) { best = (k, dd) }
    }
    return best.map { .btn($0.0) }
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

  // подбор кегля 21…14 под ширину max; не влез — обрезка с «…»; max ≤ 0 — пусто
  static func fit(_ t: String, max m: CGFloat) -> (width: CGFloat, size: CGFloat, text: String) {
    if m <= 0 { return (0, 14, "") }
    var sz: CGFloat = 21, w = titleWidth(t, sz)
    while sz > 14 && w > m { sz -= 0.5; w = titleWidth(t, sz) }
    if w <= m { return (w, sz, t) }
    var cut = t
    while !cut.isEmpty && titleWidth(cut + "…", sz) > m { cut.removeLast() }
    return (cut.isEmpty ? 0 : titleWidth(cut + "…", sz), sz, cut.isEmpty ? "" : cut + "…")
  }

  // нижняя строка и заголовок сверху; возвращает ширину заголовка — её отдают в hit(titleW:)
  @discardableResult
  func draw(_ d: Draw, _ s: State, now: Double) -> CGFloat {
    let g = d.g
    // заголовок — имя мира, лёгкая подпись без подложки; тонкая черта: заголовок — легенда
    let (tw, tsz, ttext) = TopBar.fit(s.title, max: titleMax)
    d.mapText(ttext, TopBar.titleX, top + 20, tsz, 0.85)
    g.setStrokeColor(d.ink(0.18)); g.setLineWidth(1)
    g.beginPath(); g.move(to: CGPoint(x: TopBar.titleX, y: top + 33.5)); g.addLine(to: CGPoint(x: TopBar.titleX + tw, y: top + 33.5)); g.strokePath()

    // нижняя строка: ровная подложка с тонкой чертой сверху
    let y0 = H - safeBot - TopBar.barH
    g.setFillColor(d.paper(0.9)); g.fill(CGRect(x: 0, y: y0, width: W, height: H - y0))
    g.setStrokeColor(d.ink(0.22)); g.setLineWidth(1)
    g.beginPath(); g.move(to: CGPoint(x: 0, y: y0 + 0.5)); g.addLine(to: CGPoint(x: W, y: y0 + 0.5)); g.strokePath()

    func dim(_ b: Btn) -> CGFloat { s.enabled.contains(b) ? 1 : 0.35 }
    func ringOf(_ b: Btn) { let p = pos(b); d.ring(p.x, p.y, p.r, (s.held.contains(b) ? 1 : 0.45) * dim(b), 1.2) }

    // стрелка назад — на карту
    let B = pos(.back), bk = dim(.back), hb: CGFloat = s.held.contains(.back) ? 1 : 0.8
    ringOf(.back)
    g.setStrokeColor(d.ink(hb * bk)); g.setLineWidth(1.4); g.setLineCap(.round)
    g.beginPath(); g.move(to: CGPoint(x: B.x + 2.5, y: B.y - 5.5)); g.addLine(to: CGPoint(x: B.x - 3, y: B.y)); g.addLine(to: CGPoint(x: B.x + 2.5, y: B.y + 5.5)); g.strokePath()
    g.setLineCap(.butt)

    // FX: три кольца, статичные
    let r = pos(.fx), dimFx = dim(.fx), hf: CGFloat = s.held.contains(.fx) ? 1 : 0.8
    ringOf(.fx)
    for (rr, a) in [(CGFloat(6), CGFloat(0.9)), (11, 0.55), (16, 0.3)] { d.ring(r.x, r.y, rr, a * hf * dimFx, 1) }

    // vol: две вертикальные черты разной высоты — «фейдер»
    let v = pos(.vol), dv = dim(.vol), hv: CGFloat = s.held.contains(.vol) ? 1 : 0.8
    ringOf(.vol)
    g.setStrokeColor(d.ink(0.8 * hv * dv)); g.setLineWidth(1.2)
    g.beginPath()
    g.move(to: CGPoint(x: v.x - 3, y: v.y - 7)); g.addLine(to: CGPoint(x: v.x - 3, y: v.y + 7))
    g.move(to: CGPoint(x: v.x + 3, y: v.y - 7)); g.addLine(to: CGPoint(x: v.x + 3, y: v.y + 7))
    g.strokePath()
    g.setLineWidth(1.8)
    g.beginPath()
    g.move(to: CGPoint(x: v.x - 6, y: v.y - 2)); g.addLine(to: CGPoint(x: v.x, y: v.y - 2))
    g.move(to: CGPoint(x: v.x, y: v.y + 3)); g.addLine(to: CGPoint(x: v.x + 6, y: v.y + 3))
    g.strokePath()

    // transport: три черты с точкой
    let t = pos(.transport), dt = dim(.transport), ht: CGFloat = s.held.contains(.transport) ? 1 : 0.8
    ringOf(.transport)
    g.setStrokeColor(d.ink(0.8 * ht * dt)); g.setLineWidth(1.2)
    g.beginPath()
    for (i, dx) in [(-1, CGFloat(-2)), (0, 2), (1, -2)] as [(Int, CGFloat)] {
      let yy = t.y + CGFloat(i) * 5
      g.move(to: CGPoint(x: t.x - 6, y: yy)); g.addLine(to: CGPoint(x: t.x + 6, y: yy))
      d.dot(t.x + dx, yy, 1.8, 0.9 * ht * dt)
    }
    g.strokePath()

    // play / pause: треугольник или две палочки в кружке
    let pl = pos(.play), pa = dim(.play)
    ringOf(.play)
    g.setStrokeColor(d.ink(0.85 * pa)); g.setFillColor(d.ink(0.85 * pa)); g.setLineWidth(1.2); g.setLineJoin(.round)
    if s.playing {
      g.fill(CGRect(x: pl.x - 5, y: pl.y - 6, width: 3.5, height: 12)); g.fill(CGRect(x: pl.x + 1.5, y: pl.y - 6, width: 3.5, height: 12))
    } else {
      g.beginPath(); g.move(to: CGPoint(x: pl.x - 4, y: pl.y - 7)); g.addLine(to: CGPoint(x: pl.x + 6, y: pl.y)); g.addLine(to: CGPoint(x: pl.x - 4, y: pl.y + 7)); g.closePath(); g.fillPath()
    }
    return tw
  }
}
