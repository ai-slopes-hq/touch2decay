import UIKit

private let tau = Double.pi * 2
private let dashLily: [CGFloat] = [4, 2.5]
private let noDash: [CGFloat] = []
private let lilyVeins: [Double] = [1.2, 2.1, 3.0, 3.9, 4.8]   // жилки листа: углы
// scene.js:196-197 — клубы облака: (dx, dy, r) в долях ширины
private let lobes: [(dx: Double, dy: Double, r: Double)] = [
  (-0.3, -0.02, 0.19), (-0.1, -0.2, 0.25), (0.15, -0.16, 0.23), (0.34, -0.02, 0.17),
  (0.22, 0.11, 0.15), (0.0, 0.13, 0.17), (-0.22, 0.12, 0.15), (-0.42, 0.05, 0.12),
]

// формы Natura, не зависящие от состояния мира: цветок, кувшинка, лодка, утки, облако, дождь (scene.js:165-371).
// Время — миллисекунды (nowMs), как `now` веба.
enum NatArt {
  static let LILY = 18.0   // scene.js:264 — полуширина листа (× перспектива)

  // canvas fill() + stroke() по одному пути: fillPath() в CG путь сбрасывает
  private static func fillStroke(_ p: NatPen) { p.g.drawPath(using: .fillStroke) }

  // scene.js:165 — листок
  static func leafPath(_ p: NatPen, _ x: Double, _ y: Double, _ ang: Double, _ s: Double) {
    p.g.saveGState(); p.g.translateBy(x: CGFloat(x), y: CGFloat(y)); p.g.rotate(by: CGFloat(ang))
    p.begin(); p.move(0, 0); p.quad(4 * s, -6 * s, 0, -12 * s); p.quad(-4 * s, -6 * s, 0, 0); p.stroke()
    p.g.restoreGState()
  }

  // scene.js:182-193 — миндалевидный лист с жилкой
  static func leaf(_ p: NatPen, _ x: Double, _ y: Double, _ ang: Double, _ s: Double, _ a: Double, fill: Bool = true) {
    p.g.saveGState(); p.g.translateBy(x: CGFloat(x), y: CGFloat(y)); p.g.rotate(by: CGFloat(ang))
    p.begin(); p.move(0, 0); p.quad(4.5 * s, -6 * s, 0, -13 * s); p.quad(-4.5 * s, -6 * s, 0, 0)
    if fill { p.fillPap(1) }
    p.line(a, 1.1)
    if fill { fillStroke(p) } else { p.stroke() }
    p.g.setLineWidth(0.6); p.begin(); p.move(0, -1); p.to(0, -11 * s); p.stroke()
    p.g.restoreGState()
  }

  // scene.js:198-211 — облако: контур — объединение кругов (сперва обводка, потом заливка бумагой), внутри завитки и тень снизу
  static func cloud(_ p: NatPen, _ x: Double, _ y: Double, _ s: Double, _ a: Double, heavy: Double = 0) {
    let w = 64 * s
    p.g.saveGState(); p.g.translateBy(x: CGFloat(x), y: CGFloat(y))
    p.line(a, 2.6)
    for l in lobes { p.begin(); p.arc(l.dx * w, l.dy * w, l.r * w, 0, tau); p.stroke() }
    p.fillPap(1)
    for l in lobes { p.begin(); p.arc(l.dx * w, l.dy * w, l.r * w, 0, tau); p.fill() }
    p.begin()
    for l in lobes { p.move(l.dx * w + l.r * w, l.dy * w); p.arc(l.dx * w, l.dy * w, l.r * w, 0, tau) }
    p.g.clip()
    p.line(a * 0.3, 0.7); p.begin()                  // тень снизу — короткие дуги-штрихи
    var yy = (0.11 - 0.3 * heavy) * w
    while yy < 0.32 * w { p.move(-0.6 * w, yy); p.quad(0, yy + 0.04 * w, 0.6 * w, yy); yy += 3 - heavy }
    p.stroke()
    p.line(a * 0.75, 1)                              // завитки у верхних клубов
    for i in 0..<4 {
      let l = lobes[i]
      let cx = l.dx * w, cy = l.dy * w + l.r * w * 0.25, rr = l.r * w * 0.55
      p.begin(); p.arc(cx, cy, rr, Double.pi * 1.05, Double.pi * (i % 2 == 1 ? 1.75 : 1.85)); p.stroke()
      p.begin(); p.arc(cx + rr * 0.15, cy, rr * 0.45, Double.pi * 1.2, Double.pi * 1.9); p.stroke()
    }
    p.g.restoreGState()
  }

  // scene.js:212-221 — косые штрихи, падают вечно; детерминированно по времени
  static func rain(_ p: NatPen, _ x: Double, _ y: Double, _ w: Double, _ toY: Double, _ a: Double, _ nowMs: Double, _ dens: Double) {
    p.line(a, 0.8); p.begin()
    let n = Int(Horo.jsRound(w / 7 * dens)), fall = toY - y, per = Int(max(2, Horo.jsRound(fall / 70)))
    for i in 0..<max(0, n) { for q in 0..<per {
      let h = Double((i * 7919 + q * 3301) % 1000) / 1000
      let yy = y + (nowMs * 0.3 + h * fall + Double(q) * fall / Double(per)).truncatingRemainder(dividingBy: fall)
      let xx = x - w / 2 + (Double(i) + 0.5) * (w / Double(n)) - (yy - y) * 0.05
      p.move(xx, yy); p.to(xx - 0.8, yy + 8)
    } }
    p.stroke()
  }

  // scene.js:222-252 — цветок-голос; wave — индекс в WAVES (0 синус … 4 шарп)
  static func flower(_ p: NatPen, _ x: Double, _ y: Double, wave w: Int, _ s: Double, _ a: Double) {
    p.g.saveGState(); p.g.translateBy(x: CGFloat(x), y: CGFloat(y))
    p.line(a, 1.1); p.fillPap(1)
    if w == 0 {
      for k in 0..<8 {
        p.g.saveGState(); p.g.rotate(by: CGFloat(Double(k) / 8 * tau)); p.begin()
        p.ellipse(0, -s * 0.62, s * 0.24, s * 0.5, rot: 0, 0, tau); fillStroke(p); p.g.restoreGState()
      }
      p.begin(); p.arc(0, 0, s * 0.26, 0, tau); p.fillInk(a * 0.85); p.fill()
    } else if w == 1 {
      let hw = s * 0.62, h = s * 1.1
      p.begin(); p.move(-hw, -h); p.to(-hw, 0); p.quad(0, h * 0.5, hw, 0); p.to(hw, -h)
      p.to(hw * 0.5, -h * 0.62); p.to(0, -h); p.to(-hw * 0.5, -h * 0.62); p.close(); fillStroke(p)
      p.begin(); p.move(0, -h * 0.9); p.to(0, h * 0.2); p.stroke()
    } else if w == 3 {                               // пила — вертушка: лепестки-зубья, все в одну сторону
      for k in 0..<5 {
        p.g.saveGState(); p.g.rotate(by: CGFloat(Double(k) / 5 * tau)); p.begin()
        p.move(0, 0); p.to(0, -s * 1.08); p.quad(s * 0.62, -s * 0.5, s * 0.5, -s * 0.12); p.close(); fillStroke(p); p.g.restoreGState()
      }
      p.begin(); p.arc(0, 0, s * 0.18, 0, tau); p.fillInk(a); p.fill()
    } else if w == 4 {                               // шарп — чертополох: чашечка в сетку и колючий венец
      p.begin()
      for k in 0...8 {
        let an = Double.pi * (1.1 + Double(k) / 8 * 0.8), r = k % 2 == 1 ? s * 0.7 : s * 1.15
        let px = cos(an) * r, py = sin(an) * r - s * 0.15
        if k == 0 { p.move(px, py) } else { p.to(px, py) }   // lineTo на пустом пути в canvas = moveTo
      }
      p.stroke()
      p.begin(); p.ellipse(0, s * 0.05, s * 0.48, s * 0.42, rot: 0, 0, tau); fillStroke(p)
      p.g.setLineWidth(0.6); p.begin()
      p.move(-s * 0.3, -s * 0.2); p.to(s * 0.3, s * 0.3); p.move(s * 0.3, -s * 0.2); p.to(-s * 0.3, s * 0.3)
      p.move(-s * 0.45, s * 0.05); p.to(s * 0.45, s * 0.05); p.stroke()
    } else {
      p.begin()
      for k in 0..<10 {
        let r = k % 2 == 1 ? s * 0.32 : s * 1.05, an = Double(k) / 10 * tau - Double.pi / 2
        if k > 0 { p.to(cos(an) * r, sin(an) * r) } else { p.move(cos(an) * r, sin(an) * r) }
      }
      p.close(); fillStroke(p)
      p.begin(); p.arc(0, 0, s * 0.16, 0, tau); p.fillInk(a); p.fill()
    }
    p.g.restoreGState()
  }

  // scene.js:265-275 — кувшинка: лист с вырезом, сверху цветок-голос. s — перспектива точки
  static func lily(_ p: NatPen, _ x: Double, _ y: Double, _ s: Double, wave: Int, open: Double, _ a0: Double, locked: Bool, chance: Double = 1) {
    var a = a0
    let rx = LILY * s, ry = rx * 0.48
    if locked {                                      // своё значение — двойной обвод, как рамка гравюры
      p.line(a * 0.55, 0.7); p.begin(); p.ellipse(x, y, rx + 3.5, ry + 2.2, rot: 0, 0.35, tau - 0.05); p.stroke()
    }
    p.fillPap(1); p.line(a, 1.1)
    if chance < 1 { a *= 0.45 + 0.55 * chance; p.strokeInk(a); p.dash(dashLily) }   // шанс < 100 % — бледнее, лист пунктиром
    p.begin(); p.ellipse(x, y, rx, ry, rot: 0, 0.35, tau - 0.05); p.to(x, y); p.close(); fillStroke(p); p.dash(noDash)
    p.line(a * 0.5, 0.6); p.begin()
    for q in lilyVeins { p.move(x, y); p.to(x + cos(q) * rx * 0.8, y + sin(q) * ry * 0.8) }
    p.stroke()
    flower(p, x - rx * 0.15, y - ry * 0.4, wave: wave, (5 + 5.5 * s) * (0.75 + 0.45 * open), a)
  }

  // scene.js:276-287 — лодка с парусом из листа; paused — знак паузы над парусом
  static func boatShape(_ p: NatPen, _ bx: Double, _ by: Double, _ s: Double, _ tilt: Double, paused: Bool) {
    p.g.saveGState(); p.g.translateBy(x: CGFloat(bx), y: CGFloat(by)); p.g.rotate(by: CGFloat(tilt))
    p.fillPap(1); p.line(0.95, 1.1)
    p.begin(); p.move(-11 * s, 0); p.quad(0, 6 * s, 11 * s, 0); p.quad(0, -3 * s, -11 * s, 0); p.close(); fillStroke(p)
    p.begin(); p.move(-9 * s, 0.5); p.to(9 * s, 0.5); p.stroke()
    p.begin(); p.move(0, 0); p.to(0, -9 * s); p.to(6 * s, -2 * s); p.close(); fillStroke(p)   // парус из листа
    if paused { p.g.setLineWidth(1); p.strokeRect(-3 * s, -14 * s, 1.6 * s, 4 * s); p.strokeRect(0.6 * s, -14 * s, 1.6 * s, 4 * s) }
    p.g.restoreGState()
  }

  // scene.js:296-318 — утка в профиль; nod — наклон головы (ныряет вперёд)
  static func duck(_ p: NatPen, _ d: NatDuck, nod: Double) {
    let s = d.s
    p.g.saveGState(); p.g.translateBy(x: CGFloat(d.x), y: CGFloat(d.y)); p.g.scaleBy(x: CGFloat(d.dir * s), y: CGFloat(s))
    p.line(0.9, 1.15 / s); p.fillPap(1)
    p.begin()                                        // тело: хвост торчком, круглая грудь
    p.move(-1.15, -0.55); p.quad(-1.05, 0.05, -0.75, 0.1); p.quad(-0.1, 0.3, 0.55, 0.12)
    p.quad(0.9, -0.05, 0.72, -0.38); p.quad(0.2, -0.62, -0.55, -0.42); p.close(); fillStroke(p)
    p.begin(); p.move(-0.7, -0.3); p.quad(-0.15, -0.02, 0.4, -0.22)   // крыло и перья
    p.move(-0.55, -0.2); p.to(-0.85, -0.12); p.move(-0.35, -0.13); p.to(-0.7, -0.02); p.stroke()
    p.line(0.5, 0.7 / s); p.begin()                  // штрих по низу — тень на воде
    for k in 0..<4 { let u = -0.6 + Double(k) * 0.32; p.move(u, 0.02 + Double(k) * 0.01); p.to(u + 0.22, 0.12) }
    p.stroke()
    p.g.saveGState(); p.g.translateBy(x: 0.55, y: -0.4); p.g.rotate(by: CGFloat(nod * 1.5))   // голова — на шее, ныряет вперёд
    p.line(0.9, 1.15 / s)
    p.begin(); p.move(-0.08, 0.02); p.quad(-0.05, -0.35, 0.02, -0.5); p.move(0.18, 0.02); p.quad(0.14, -0.3, 0.2, -0.45); p.stroke()
    p.begin(); p.arc(0.1, -0.62, 0.24, 0, tau); fillStroke(p)
    p.begin(); p.move(0.3, -0.66); p.quad(0.52, -0.66, 0.6, -0.56); p.quad(0.45, -0.5, 0.3, -0.54); fillStroke(p)
    p.fillInk(0.9); p.begin(); p.arc(0.16, -0.68, 0.04, 0, tau); p.fill()
    p.g.restoreGState()
    p.line(0.55, 0.8 / s); p.begin()                 // вода у бортов
    p.move(-1.45, 0.16); p.to(-1.0, 0.16); p.move(0.75, 0.16); p.to(1.15, 0.16); p.stroke()
    p.g.restoreGState()
  }

  // scene.js:336-360 — утка в полёте, профиль: шея вытянута, крылья машут (дальнее бледнее)
  static func flyer(_ p: NatPen, _ x: Double, _ y: Double, _ s: Double, _ dir: Double, _ flap: Double) {
    p.g.saveGState(); p.g.translateBy(x: CGFloat(x), y: CGFloat(y)); p.g.scaleBy(x: CGFloat(dir * s), y: CGFloat(s))
    p.g.setLineWidth(CGFloat(1.1 / s)); p.g.setLineJoin(.round); p.fillPap(1)
    func wing(_ f: Double, _ a: Double) {            // крыло от плеча: f — взмах (1 вверх, −1 вниз)
      let tipX = -0.45, tipY = -0.1 - 1.15 * f
      p.strokeInk(a); p.begin(); p.move(0.35, -0.12)
      p.bez(0.5, -0.12 - 0.7 * f, 0.1, tipY + 0.15 * f, tipX, tipY)
      p.bez(-0.2, -0.1 - 0.55 * f, -0.15, -0.12 - 0.15 * f, -0.2, -0.08); p.close(); fillStroke(p)
      p.begin()                                      // маховые перья у кончика
      for k in 1...3 {
        let u = Double(k) / 4
        p.move(tipX + 0.18 * u, tipY + (0.25 + 0.2 * u) * f); p.to(tipX + 0.05 + 0.3 * u, tipY + (0.55 + 0.1 * u) * f)
      }
      p.strokeInk(a * 0.5); p.stroke()
    }
    wing(flap * 0.85, 0.5)
    p.strokeInk(0.9)
    p.begin(); p.move(0.95, -0.06); p.bez(0.55, 0.3, -0.55, 0.28, -0.95, 0.04); p.bez(-0.6, -0.2, 0.45, -0.26, 0.95, -0.06); fillStroke(p)   // тело
    p.begin(); p.move(-0.92, 0.0); p.to(-1.2, -0.08); p.to(-1.14, 0.1); p.close(); fillStroke(p)   // хвост
    p.begin(); p.move(0.85, -0.12); p.quad(1.15, -0.2, 1.36, -0.2); p.move(0.92, 0.04); p.quad(1.18, -0.02, 1.38, -0.06); p.stroke()   // шея
    p.begin(); p.ellipse(1.47, -0.14, 0.15, 0.12, rot: -0.2, 0, tau); fillStroke(p)
    p.begin(); p.move(1.58, -0.17); p.quad(1.75, -0.16, 1.84, -0.09); p.quad(1.72, -0.07, 1.6, -0.08); fillStroke(p)   // клюв
    p.fillInk(0.9); p.begin(); p.arc(1.5, -0.17, 0.025, 0, tau); p.fill(); p.fillPap(1)
    p.strokeInk(0.5); p.begin(); p.move(0.88, -0.1); p.to(0.94, 0.03); p.stroke()   // белый ошейник
    wing(flap, 0.9)
    p.g.restoreGState()
  }

  // scene.js:361-371 — утята за правой уткой: больше release (fx.rel) — больше утят (до 4)
  static func ducklingCount(rel: Double) -> Int { Int(Horo.jsRound(rel * 4)) }
  static func duckling(_ k: Int, _ G: NatGeo, _ nowMs: Double) -> NatDuck {
    let P = G.pond(), kk = Double(k)
    let a = 0.45 + kk * 0.5 + sin(nowMs * 0.0007 + kk) * 0.05   // вереницей по ближнему краю заводи, за мамой
    return NatDuck(x: P.x + P.rx * 0.8 * cos(a), y: P.y + 3 + P.ry * 0.62 * sin(a) + sin(nowMs * 0.002 + kk * 1.3) * 0.8, s: 7, dir: -1)
  }
  // отрисовка как в view.js:84 — `duck(c, d, 0)` для каждого
  static func ducklings(_ p: NatPen, _ G: NatGeo, _ nowMs: Double, rel: Double) {
    for k in 0..<max(0, ducklingCount(rel: rel)) { duck(p, duckling(k, G, nowMs), nod: 0) }
  }
}
