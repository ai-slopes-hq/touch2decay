import UIKit

// ключ стены (view.js:84): `W×H×DPR | cy | R`; смена любого поля пересобирает образ
private struct TriaWallKey: Equatable { var W: Double, H: Double, dpr: Double, cy: Double, R: Double }

// стена: CGImage-кеш, строится синхронно (блюдо дёшево — без фонового потока, как у ArcWall)
final class TriaWall {
  private(set) var builds = 0
  private var key: TriaWallKey?
  private var img: CGImage?

  // draw получает контекст с началом слева сверху и масштабом DPR — как у кадра
  func image(_ G: TriaGeo, dpr: CGFloat, draw: (CGContext) -> Void) -> CGImage? {
    let k = TriaWallKey(W: G.W, H: G.H, dpr: Double(dpr), cy: G.cy, R: G.R)
    if k == key { return img }
    key = k; builds += 1
    guard let g = CGContext(data: nil, width: Int((G.W * Double(dpr)).rounded()), height: Int((G.H * Double(dpr)).rounded()), bitsPerComponent: 8,
                            bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue) else { img = nil; return nil }
    g.translateBy(x: 0, y: CGFloat(g.height)); g.scaleBy(x: dpr, y: -dpr)
    draw(g)
    img = g.makeImage()
    return img
  }
}

private let tau = CGFloat.pi * 2
private let dashRay: [CGFloat] = [1, 6], dashCircle: [CGFloat] = [2, 5], dashThread: [CGFloat] = [2, 4], dashNone: [CGFloat] = []

private extension CGContext {
  func circle(_ x: CGFloat, _ y: CGFloat, _ r: CGFloat) { addArc(center: CGPoint(x: x, y: y), radius: r, startAngle: 0, endAngle: tau, clockwise: false) }
  func line(_ x0: CGFloat, _ y0: CGFloat, _ x1: CGFloat, _ y1: CGFloat) { move(to: CGPoint(x: x0, y: y0)); addLine(to: CGPoint(x: x1, y: y1)) }
  func arc(_ x: CGFloat, _ y: CGFloat, _ r: CGFloat, _ a0: CGFloat, _ a1: CGFloat, back: Bool = false) {   // как canvas arc: back — против возрастания угла
    addArc(center: CGPoint(x: x, y: y), radius: r, startAngle: a0, endAngle: a1, clockwise: back)
  }
  // стихия: треугольник (up — вершиной вверх), bar — перекладина (view.js:82)
  func elem(_ cx: CGFloat, _ cy: CGFloat, _ s: CGFloat, up: Bool, bar: Bool) {
    beginPath()
    move(to: CGPoint(x: cx, y: cy + (up ? -s : s)))
    addLine(to: CGPoint(x: cx + s * 0.9, y: cy + (up ? s * 0.6 : -s * 0.6)))
    addLine(to: CGPoint(x: cx - s * 0.9, y: cy + (up ? s * 0.6 : -s * 0.6)))
    closePath()
    if bar { line(cx - s * 0.7, cy, cx + s * 0.7, cy) }
    strokePath()
  }
  // знаки трёх начал: соль ⊖, сера — треугольник над крестом, ртуть — круг с рогами и крестом (view.js:107-113)
  func glyph(_ i: Int, _ x: CGFloat, _ y: CGFloat, _ r: CGFloat) {
    beginPath()
    if i == 0 { circle(x, y, r); line(x - r, y, x + r, y) }
    else if i == 1 {
      move(to: CGPoint(x: x, y: y - r)); addLine(to: CGPoint(x: x + r * 0.8, y: y + r * 0.2)); addLine(to: CGPoint(x: x - r * 0.8, y: y + r * 0.2)); closePath()
      line(x, y + r * 0.2, x, y + r * 1.2); line(x - r * 0.45, y + r * 0.7, x + r * 0.45, y + r * 0.7)
    } else {
      move(to: CGPoint(x: x + r * 0.55, y: y)); circle(x, y, r * 0.55)
      move(to: CGPoint(x: x - r * 0.55, y: y - r * 1.05)); arc(x, y - r * 1.05, r * 0.55, .pi, 0, back: true)
      line(x, y + r * 0.55, x, y + r * 1.3); line(x - r * 0.4, y + r * 0.95, x + r * 0.4, y + r * 0.95)
    }
    strokePath()
  }
}

extension TriaView {
  // блюдо: двойной обод с делениями, круги, четыре стихии (view.js:83-106)
  static func paintWall(_ g: CGContext, _ G: TriaGeo, theme: Theme) {
    let d = Draw(g: g, W: CGFloat(G.W), H: CGFloat(G.H)); d.setTheme(theme)
    let W = CGFloat(G.W), H = CGFloat(G.H), cx = CGFloat(G.cx), cy = CGFloat(G.cy), R = CGFloat(G.R)
    g.setFillColor(theme.bg.cgColor); g.fill(CGRect(x: 0, y: 0, width: W, height: H))
    g.setLineWidth(1)
    g.setStrokeColor(d.ink(0.05)); g.beginPath()                                   // камень — косая штриховка
    var k = -H
    while k < W { g.line(k, 0, k + H, H); k += 12 }
    g.strokePath()
    g.setFillColor(theme.bg.cgColor); g.beginPath(); g.circle(cx, cy, R + 8); g.fillPath()
    g.setStrokeColor(d.ink(0.75)); g.beginPath(); g.circle(cx, cy, R + 8); g.strokePath()
    g.setStrokeColor(d.ink(0.3)); g.beginPath(); g.circle(cx, cy, R + 3); g.strokePath()
    g.setStrokeColor(d.ink(0.4)); g.beginPath()
    for i in 0..<72 {
      let a = CGFloat(i) / 72 * tau, l: CGFloat = i % 6 != 0 ? 3 : 6
      g.line(cx + cos(a) * (R + 8), cy + sin(a) * (R + 8), cx + cos(a) * (R + 8 + l), cy + sin(a) * (R + 8 + l))
    }
    g.strokePath()
    g.setStrokeColor(d.ink(0.1)); g.setLineDash(phase: 0, lengths: dashCircle)     // круги — ближе к середине выше
    for f in [0.25, 0.5, 0.75] as [CGFloat] { g.beginPath(); g.circle(cx, cy, R * f); g.strokePath() }
    g.setLineDash(phase: 0, lengths: dashNone)
    g.setStrokeColor(d.ink(0.5))                                                    // стихии по диагоналям: огонь и воздух — над блюдом, вода и земля — под
    let S: CGFloat = 7, o = (R + 26) * CGFloat(0.5).squareRoot()
    g.elem(cx - o, cy - o, S, up: true, bar: false); g.elem(cx + o, cy - o, S, up: true, bar: true)
    g.elem(cx - o, cy + o, S, up: false, bar: false); g.elem(cx + o, cy + o, S, up: false, bar: true)
    d.mapText("ignis", cx - o, cy - o - 16, 10, 0.35, align: .center); d.mapText("aer", cx + o, cy - o - 16, 10, 0.35, align: .center)
    d.mapText("aqua", cx - o, cy + o + 16, 10, 0.35, align: .center); d.mapText("terra", cx + o, cy + o + 16, 10, 0.35, align: .center)
  }

  // кадр (view.js:115-173); sun == false — для снимков без угла
  func drawFrame(_ d: Draw, now: Double, sun: Bool) {
    let g = d.g, G = geo, t = self.now, fl = flags(), th = theme
    let W = CGFloat(G.W), H = CGFloat(G.H), cx = CGFloat(G.cx), cy = CGFloat(G.cy), R = CGFloat(G.R)
    let bg = th.bg.cgColor
    if let img = wall.image(G, dpr: Draw.scale, draw: { TriaView.paintWall($0, G, theme: th) }) {
      g.saveGState(); g.translateBy(x: 0, y: H); g.scaleBy(x: 1, y: -1)           // образ лежит «вверх ногами» к нашему перевёрнутому контексту
      g.draw(img, in: CGRect(x: 0, y: 0, width: W, height: H)); g.restoreGState()
    } else { g.setFillColor(bg); g.fill(CGRect(x: 0, y: 0, width: W, height: H)) }
    let L = fl.lux ? CGFloat(min(1, max(0, (t - luxAt) / 0.6))) : 0                 // знак земли в середине — Fiat lux; на восьмёрке — золото
    g.setStrokeColor(fl.lux ? Draw.color(Tria.gold, 0.6 + 0.4 * L) : d.ink(0.6)); g.setLineWidth(1.1)
    g.elem(cx, cy, 9, up: false, bar: true)
    if fl.lux {
      g.setStrokeColor(Draw.color(Tria.gold, 0.25 * L)); g.beginPath()
      for k in 0..<12 { let a = CGFloat(k) / 12 * tau; g.line(cx + cos(a) * 14, cy + sin(a) * 14, cx + cos(a) * 24, cy + sin(a) * 24) }
      g.strokePath()
    }
    let asp = fxValue(3), nr = asp < 0.34 ? 0 : asp < 0.67 ? 4 : 8                  // лучи аспектов — бледно, вспыхивают, когда тело их пересекает
    if nr > 0 {
      g.setStrokeColor(d.ink(0.07)); g.setLineDash(phase: 0, lengths: dashRay); g.beginPath()
      for k in 0..<nr { let a = CGFloat(k) * tau / CGFloat(nr) - .pi / 4; g.line(cx + cos(a) * R * 0.12, cy + sin(a) * R * 0.12, cx + cos(a) * R, cy + sin(a) * R) }
      g.strokePath(); g.setLineDash(phase: 0, lengths: dashNone)
    }
    g.setLineWidth(1)
    for n in 0..<state.flashCount {
      let (f, ft) = state.flashAt(n)
      let k = CGFloat((t - ft) / (f.kind == 3 ? 0.7 : 0.45)); if k > 1 || k < 0 { continue }
      let al = (1 - k) * (1 - k), X = cx + CGFloat(f.x) * R, Y = cy + CGFloat(f.y) * R
      g.setStrokeColor(Draw.color(Tria.tint[f.i], 0.55 * al)); g.beginPath()
      if f.kind == 0 { let a = CGFloat(atan2(f.y, f.x)); g.arc(cx, cy, CGFloat(f.q) * R, a - 0.35, a + 0.35) }
      else if f.kind == 1 { let q = CGFloat(f.q); g.line(cx + cos(q) * R * 0.12, cy + sin(q) * R * 0.12, cx + cos(q) * R, cy + sin(q) * R) }
      else if f.kind == 2 { let a = CGFloat(atan2(f.y, f.x)); g.arc(cx, cy, R + 3, a - 0.25, a + 0.25) }
      else { g.circle(X, Y, 8 + 30 * k) }
      g.strokePath()
      if f.kind != 3 { g.beginPath(); g.circle(X, Y, 3 + 14 * k); g.strokePath() }
    }
    for i in 0..<Tria.nb {                                                          // следы — аттрактор, который они рисуют: 4 сегмента, старые бледнее
      let n = state.trailCount(i)
      if n < 2 { continue }
      for seg in 0..<4 {
        let a0 = n * seg / 4, a1 = n * (seg + 1) / 4
        g.setStrokeColor(Draw.color(Tria.tint[i], 0.08 + 0.14 * CGFloat(seg))); g.beginPath()
        for k in a0...min(n - 1, a1) {
          let p = state.trailPoint(i, k), X = cx + CGFloat(p.x) * R, Y = cy + CGFloat(p.y) * R
          k == a0 ? g.move(to: CGPoint(x: X, y: Y)) : g.addLine(to: CGPoint(x: X, y: Y))
        }
        g.strokePath()
      }
    }
    let nexus = fxValue(2)
    for i in 0..<Tria.nb {                                                          // нити тяги — ярче, когда тела близко (сильнее модулируют)
      let j = (i + 1) % Tria.nb, qa = state.pos(i, mirror: mirror), qb = state.pos(j, mirror: mirror)
      let a = geo.px(qa.x, qa.y), b = geo.px(qb.x, qb.y), dd = hypot(qa.x - qb.x, qa.y - qb.y)
      let al = min(0.6, max(0, 0.04 + 0.08 / max(0.05, dd) * nexus * 0.6))
      g.setStrokeColor(d.ink(CGFloat(al))); g.setLineDash(phase: 0, lengths: dashThread); g.beginPath(); g.line(a.x, a.y, b.x, b.y); g.strokePath()
      g.setLineDash(phase: 0, lengths: dashNone)
    }
    for i in 0..<Tria.nb {
      let q = state.pos(i, mirror: mirror), p = geo.px(q.x, q.y), b = mirror.bodies[i]
      let m = bodyValue(i, key: 0), fixed = bodyValue(i, key: 2) >= 0.5
      let r = CGFloat(8 + 4 * m.squareRoot()), amp = CGFloat(b.amp), col = Tria.tint[i]
      if amp > 0.05 { d.glowAt(p.x, p.y, r * 2.4, amp * 0.35 * CGFloat(1 - 0.6 * b.pairK * (0.5 + 0.5 * sin(b.trem)))) }   // в паре — пульсирует с её оборотом
      g.setFillColor(bg); g.beginPath(); g.circle(p.x, p.y, r + 4); g.fillPath()
      g.setStrokeColor(Draw.color(col, 0.5 + 0.5 * min(1, max(0, amp * 1.5)))); g.setLineWidth(1); g.beginPath(); g.circle(p.x, p.y, r + 4); g.strokePath()
      if fixed { g.beginPath(); g.circle(p.x, p.y, r + 7.5); g.strokePath() }      // на якоре — двойной обвод
      g.setLineWidth(1.2); g.glyph(i, p.x, p.y - (i == 2 ? 2 : 0), r * 0.55)
      if isHeld(i) {
        d.mapText(Tria.names[i], p.x, p.y - r - 26, 14, 0.95, align: .center)
        d.mapText("\(triaNote(b.hz)) · \(Int((b.hz).rounded())) Hz", p.x, p.y - r - 11, 11, 0.65, align: .center)
      }
    }
    for i in 0..<Tria.nb {                                                          // аватары внизу: знак тела, яркость — громкость, двойной обвод — на якоре
      let a = G.av[i], x = CGFloat(a.x), y = CGFloat(a.y), r = CGFloat(a.r), b = mirror.bodies[i], amp = CGFloat(b.amp)
      if amp > 0.05 { d.glowAt(x, y, 30, amp * 0.3) }
      g.setFillColor(bg); g.beginPath(); g.circle(x, y, r); g.fillPath()
      g.setStrokeColor(Draw.color(Tria.tint[i], 0.45 + 0.55 * min(1, max(0, amp * 1.5)))); g.setLineWidth(1); g.beginPath(); g.circle(x, y, r); g.strokePath()
      if bodyValue(i, key: 2) >= 0.5 { g.beginPath(); g.circle(x, y, r + 3.5); g.strokePath() }
      g.setLineWidth(1.2); g.glyph(i, x, y - (i == 2 ? 2 : 0), 7)
    }
    let P = G.plumb, px = CGFloat(P.x), py = CGFloat(P.y), pr = CGFloat(P.r)       // отвес: тяга выключена — грузик внизу, светится
    g.setLineWidth(1); g.setFillColor(bg); g.setStrokeColor(d.ink(fl.cadit ? 0.95 : 0.55)); g.beginPath(); g.circle(px, py, pr); g.drawPath(using: .fillStroke)
    if fl.cadit { g.beginPath(); g.circle(px, py, pr + 3.5); g.strokePath() }
    g.beginPath(); g.line(px, py - 12, px, py + 1); g.strokePath()
    g.setFillColor(d.ink(fl.cadit ? 0.95 : 0.6)); g.beginPath()
    g.move(to: CGPoint(x: px - 5, y: py + 1)); g.addLine(to: CGPoint(x: px + 5, y: py + 1)); g.addLine(to: CGPoint(x: px, y: py + 11)); g.closePath(); g.fillPath()
    if sun { d.quarterSun(CGFloat(G.sun.x), CGFloat(G.sun.y), CGFloat(G.sun.r), now: now * 1000, col: th.ink, disc: th.bg) }
  }
}
