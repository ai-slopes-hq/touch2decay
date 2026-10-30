import UIKit

// рисование Monochordum (view.js:136-232): стена в кеше, струны, Земля, рука Бога, роза ветров.
// Состояние кадра — в MonoDrawState (расширения не хранят поля)
final class MonoDrawState {
  struct WallKey: Equatable { var W, H, sc, y0, y1: CGFloat }
  var wall: CGImage?, wallKey: WallKey?, wallBuilds = 0
  var wave = [CGPoint](repeating: .zero, count: 41)           // стоячая волна струны: 40 отрезков — выделено раз
}

extension MonochordView {
  private static let tau = CGFloat.pi * 2
  // model.js:13 — лады Фладда: доля длины и название сферы
  static let marks: [(r: Double, name: String)] = [
    (1, "Terra"), (8.0 / 9, "Aqua"), (64.0 / 81, "Aer"), (3.0 / 4, "Ignis"), (2.0 / 3, "Luna"), (16.0 / 27, "Mercurius"), (128.0 / 243, "Venus"), (1.0 / 2, "Sol"),
    (4.0 / 9, "Mars"), (32.0 / 81, "Iuppiter"), (3.0 / 8, "Saturnus"), (1.0 / 3, "Stellae"), (8.0 / 27, "Crystallinum"), (1.0 / 4, "Empyreum"),
  ]
  private static let majors: [Double] = [1, 3.0 / 4, 2.0 / 3, 1.0 / 2, 1.0 / 3, 1.0 / 4]
  private static let intervals: [(a: Double, b: Double, name: String)] = [
    (1, 1.0 / 2, "diapason"), (1, 2.0 / 3, "diapente"), (2.0 / 3, 1.0 / 2, "diatessaron"), (1.0 / 2, 1.0 / 4, "diapason"), (1.0 / 2, 1.0 / 3, "diapente"),
  ]
  private static let ratioNames: [(r: Double, name: String)] = [
    (1, "1 : 1"), (8.0 / 9, "9 : 8 · tonus"), (3.0 / 4, "4 : 3 · diatessaron"), (2.0 / 3, "3 : 2 · diapente"), (1.0 / 2, "2 : 1 · diapason"), (1.0 / 3, "3 : 1"), (1.0 / 4, "4 : 1 · disdiapason"),
  ]

  var wallBuilds: Int { dr.wallBuilds }
  var waveCount: Int { dr.wave.count }
  var waveBase: UnsafeRawPointer? { dr.wave.withUnsafeBufferPointer { UnsafeRawPointer($0.baseAddress) } }

  private func arc(_ g: CGContext, _ x: CGFloat, _ y: CGFloat, _ r: CGFloat) { g.strokeEllipse(in: CGRect(x: x - r, y: y - r, width: 2 * r, height: 2 * r)) }
  private func disc(_ g: CGContext, _ x: CGFloat, _ y: CGFloat, _ r: CGFloat) { g.fillEllipse(in: CGRect(x: x - r, y: y - r, width: 2 * r, height: 2 * r)) }
  private func arcPath(_ g: CGContext, _ x: CGFloat, _ y: CGFloat, _ r: CGFloat, _ a0: CGFloat, _ a1: CGFloat) {
    g.addArc(center: CGPoint(x: x, y: y), radius: r, startAngle: a0, endAngle: a1, clockwise: false)   // a0 < a1: по возрастанию угла
  }

  // стена: ящик монохорда, розетка, лады со сферами слева, дуги интервалов справа; ключ — W×H×масштаб|y0|y1 (view.js:136-172)
  func wallImage() -> CGImage? {
    let sc = Draw.scale, G = geo
    let key = MonoDrawState.WallKey(W: G.W, H: G.H, sc: sc, y0: G.y0, y1: G.y1)
    if let w = dr.wall, key == dr.wallKey { return w }
    dr.wallKey = key; dr.wallBuilds += 1
    guard let g = CGContext(data: nil, width: Int((G.W * sc).rounded()), height: Int((G.H * sc).rounded()), bitsPerComponent: 8, bytesPerRow: 0,
                            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue) else { dr.wall = nil; return nil }
    g.translateBy(x: 0, y: CGFloat(g.height)); g.scaleBy(x: sc, y: -sc)   // начало слева сверху
    let d = Draw(g: g, W: G.W, H: G.H); d.setTheme(theme)
    let tau = MonochordView.tau, B = G.box
    g.setFillColor(theme.bg.cgColor); g.fill(CGRect(x: 0, y: 0, width: G.W, height: G.H))
    g.setLineWidth(1)
    g.setStrokeColor(d.ink(0.6)); g.stroke(CGRect(x: B.x0 + 0.5, y: G.y0 - 18.5, width: B.x1 - B.x0, height: G.y1 - G.y0 + 40))   // двойная рамка ящика
    g.setStrokeColor(d.ink(0.2)); g.stroke(CGRect(x: B.x0 + 4.5, y: G.y0 - 14.5, width: B.x1 - B.x0 - 8, height: G.y1 - G.y0 + 32))
    let ry = G.y1 - (G.y1 - G.y0) * 0.12, rr = (B.x1 - B.x0) * 0.22          // розетка — голосник деки
    g.setStrokeColor(d.ink(0.35)); arc(g, G.cx, ry, rr); arc(g, G.cx, ry, rr * 0.7)
    for k in 0..<8 { let a = CGFloat(k) / 8 * tau; arc(g, G.cx + cos(a) * rr * 0.45, ry + sin(a) * rr * 0.45, rr * 0.25) }
    for (j, m) in MonochordView.marks.enumerated() {                          // лады: засечки поперёк ящика, слева — сферы
      let y = G.yOfR(m.r), major = MonochordView.majors.contains(m.r)
      g.setStrokeColor(d.ink(major ? 0.45 : 0.2)); g.beginPath()
      let l: CGFloat = major ? 10 : 5
      g.move(to: CGPoint(x: B.x0, y: y + 0.5)); g.addLine(to: CGPoint(x: B.x0 - l, y: y + 0.5))
      g.move(to: CGPoint(x: B.x1, y: y + 0.5)); g.addLine(to: CGPoint(x: B.x1 + l, y: y + 0.5)); g.strokePath()
      d.mapText(m.name, B.x0 - 14, y, 11, m.r == 0.5 || m.r == 1 || m.r == 0.25 ? 0.7 : 0.42, align: .right)
      if j == 7 {                                                             // Солнце — середина: граница двух октав
        g.setStrokeColor(d.ink(0.3)); g.setLineDash(phase: 0, lengths: [2, 4]); g.beginPath()
        g.move(to: CGPoint(x: B.x0, y: y + 0.5)); g.addLine(to: CGPoint(x: B.x1, y: y + 0.5)); g.strokePath(); g.setLineDash(phase: 0, lengths: [])
      }
    }
    for (k, iv) in MonochordView.intervals.enumerated() {                    // дуги интервалов справа, как у Фладда
      let ya = G.yOfR(iv.a), yb = G.yOfR(iv.b), xr = B.x1 + 16 + CGFloat(k % 3) * 14
      g.setStrokeColor(d.ink(0.35)); g.beginPath()
      g.move(to: CGPoint(x: B.x1 + 4, y: ya)); g.addQuadCurve(to: CGPoint(x: B.x1 + 4, y: yb), control: CGPoint(x: xr + 18, y: (ya + yb) / 2)); g.strokePath()
      d.mapText(iv.name, xr + 8, (ya + yb) / 2, 10, 0.45, align: .center, angle: -.pi / 2)
    }
    dr.wall = g.makeImage()
    return dr.wall
  }

  // порядок кадра — view.js:177-231: стена → струны → сферы → подписи → Земля → рука → роза ветров
  func draw(_ d: Draw, now: Double) {
    let g = d.g, G = geo, m = mirror, tau = MonochordView.tau
    if let w = wallImage() {
      g.saveGState(); g.translateBy(x: 0, y: G.H); g.scaleBy(x: 1, y: -1)               // контекст — началом сверху, картинка — снизу
      g.draw(w, in: CGRect(x: 0, y: 0, width: G.W, height: G.H)); g.restoreGState()
    }
    if m.fx[2] > 0.05 { d.glowAt(G.cx, G.y1 - (G.y1 - G.y0) * 0.12, 40, CGFloat(m.fx[2]) * 0.12) }   // дека отзывается — розетка светится
    for i in 0..<MonochordView.n {
      let s = m.str[i], x = G.xs[i], yb = G.yOfR(s.r), amp = min(9, s.en * 60), h = held(i) != nil
      g.setFillColor(d.ink(0.85)); disc(g, x, G.y0 - 8, 3)                              // колок
      g.setStrokeColor(d.ink(0.3)); g.setLineWidth(1); g.beginPath()                    // заглушённая часть — ниже подставки
      g.move(to: CGPoint(x: x, y: yb)); g.addLine(to: CGPoint(x: x, y: G.y1 + 6)); g.strokePath()
      g.setStrokeColor(d.ink(s.sus ? 1 : 0.85)); g.setLineWidth(s.sus ? 1.6 : 1.2)     // звучащая часть: стоячая волна — размах по энергии
      let n = 40, ph = now * 90 + Double(i), ah = min(7, s.eh * 60)                     // флажолет: стоячая волна с узлами
      for k in 0...n {
        let u = Double(k) / Double(n)
        let dx = amp * (sin(Double.pi * u) * sin(ph) * 0.7 + sin(Double(tau) * u) * sin(ph * 1.7 + Double(i)) * 0.3) + ah * sin(s.hn * Double.pi * u) * sin(ph * s.hn * 0.7)
        dr.wave[k] = CGPoint(x: x + CGFloat(dx), y: G.y0 + CGFloat(u) * (yb - G.y0))
      }
      g.beginPath(); g.addLines(between: dr.wave); g.strokePath()
      g.setFillColor(d.ink(h || ah > 0.5 ? 0.6 : 0.22))                                 // узлы флажолетов — точки на звучащей части
      for nd in MonochordView.nodes {
        let on = ah > 0.5 && abs(nd.u * s.hn - (nd.u * s.hn).rounded()) < 1e-6
        disc(g, x, G.y0 + CGFloat(nd.u) * (yb - G.y0), on ? 2.6 : 1.6)
      }
      if s.sus { g.setStrokeColor(d.ink(0.25)); g.setLineWidth(6); g.beginPath(); g.move(to: CGPoint(x: x, y: G.y0)); g.addLine(to: CGPoint(x: x, y: yb)); g.strokePath() }
      g.setFillColor(theme.bg.cgColor); g.setStrokeColor(d.ink(h ? 1 : 0.85)); g.setLineWidth(1.2)   // подставка — треугольник
      g.beginPath(); g.move(to: CGPoint(x: x - 9, y: yb + 7)); g.addLine(to: CGPoint(x: x, y: yb - 4)); g.addLine(to: CGPoint(x: x + 9, y: yb + 7)); g.closePath(); g.drawPath(using: .fillStroke)
      g.setFillColor(d.ink(0.85)); disc(g, x, G.y1 + 6, 2.2)                            // нижний порожек
    }
    for i in 0..<MonochordView.n { sphere(d, i) }
    for i in 0..<MonochordView.n where bridgeHeld(i) { bridgeLabel(d, i) }
    earth(d, now); hand(d)
    aeolus(d, now)
  }

  // сфера Фладда под подставкой загорается, пока струна звучит (view.js:205-217)
  private func sphere(_ d: Draw, _ i: Int) {
    let g = d.g, G = geo, s = mirror.str[i], e = CGFloat(min(1, (s.en + s.eh) * 25))
    if e < 0.05 { return }
    var best = -1, bd = 0.02
    for (j, mk) in MonochordView.marks.enumerated() { let dd = abs(log2(mk.r / s.r)); if dd < bd { bd = dd; best = j } }
    if best < 0 { return }
    let mk = MonochordView.marks[best], y = G.yOfR(mk.r), x = G.box.x0 - 14, sx = x + 8   // звёздочка между подписью и ящиком — лучи по силе звука
    g.setStrokeColor(d.ink(0.3 + 0.6 * e)); g.setLineWidth(1); g.beginPath()
    for k in 0..<8 {
      let a = CGFloat(k) / 8 * MonochordView.tau, l: CGFloat = k % 2 == 1 ? 2.5 : 4 + 2 * e
      g.move(to: CGPoint(x: sx + cos(a) * 1.5, y: y + sin(a) * 1.5)); g.addLine(to: CGPoint(x: sx + cos(a) * l, y: y + sin(a) * l))
    }
    g.strokePath()
    d.mapText(mk.name, x, y, 11, 0.45 + 0.55 * e, align: .right)
  }

  // подпись «нота · Гц» и интервал — пока тянут кобылку; пустое место над Эмпиреем слева: палец закрывает подставку (view.js:218-223)
  private func bridgeLabel(_ d: Draw, _ i: Int) {
    let G = geo, r = mirror.str[i].r, f = hzOf(i), rx = G.box.x0 - 14, ry = G.y0 + 30
    d.mapText("\(MonochordView.noteOf(f)) · \(Int(f.rounded())) Hz", rx, ry, 15, 0.95, align: .right)
    let nm = MonochordView.ratioNames.first { abs($0.r - r) < 1e-9 }?.name ?? MonochordView.marks.first { abs($0.r - r) < 1e-9 }?.name ?? ""
    if !nm.isEmpty { d.mapText(nm, rx, ry + 18, 11, 0.6, align: .right) }
  }

  // Земля: автострам вкл — горы бегут по шару; удар — вспыхивает горизонт (view.js:119-135 drawEarth)
  private func earth(_ d: Draw, _ now: Double) {
    let g = d.g, E = geo.earth, on = mirror.auto[0] != 0, pi = CGFloat.pi
    let hit = CGFloat(min(1, max(0, 1 - (now - hitAt) * 1000 / 220)))
    g.setLineWidth(1); g.setStrokeColor(d.ink(on ? 0.75 + 0.25 * hit : 0.5)); g.beginPath(); arcPath(g, E.x, E.y, E.r, pi * 1.08, pi * 1.92); g.strokePath()
    if on { g.setStrokeColor(d.ink(0.25)); g.beginPath(); arcPath(g, E.x, E.y, E.r + 4, pi * 1.08, pi * 1.92); g.strokePath() }
    g.setStrokeColor(d.ink(on ? 0.6 : 0.3)); g.beginPath()
    for k in 0..<14 {                                                                 // горы на шаре: при вращении ползут слева направо
      let f = (Double(k) / 14 + rot * 0.15).truncatingRemainder(dividingBy: 1), a = pi * 1.1 + CGFloat((f + 1).truncatingRemainder(dividingBy: 1)) * pi * 0.8
      let px = E.x + cos(a) * E.r, py = E.y + sin(a) * E.r, h = CGFloat(5 + (k % 3) * 2), nx = cos(a), ny = sin(a), tx = -ny, ty = nx
      g.move(to: CGPoint(x: px - tx * 5, y: py - ty * 5)); g.addLine(to: CGPoint(x: px + nx * h, y: py + ny * h)); g.addLine(to: CGPoint(x: px + tx * 5, y: py + ty * 5))
    }
    g.strokePath()
    if hit > 0 { d.glowAt(E.x, E.y - E.r, 30, hit * 0.25) }
  }

  // облако справа от колков, из него — рука Бога, держит колок крайней струны (view.js:173-197 drawHand)
  private func hand(_ d: Draw) {
    let g = d.g, G = geo, H = G.hand, hx = H.x, hy = H.y, r = H.r, K = 11, tau = MonochordView.tau
    let px = G.xs[MonochordView.n - 1], py = G.y0 - 8, sx = hx - r * 0.75, sy = hy - r * 0.05   // рука: рукав из облака к колку, манжета, кисть
    let ax = px + 22, ay = py + 2, nx = -(ay - sy), ny = ax - sx, nl = hypot(nx, ny), ux = nx / nl, uy = ny / nl, wv: CGFloat = 6
    let mx = (sx + ax) / 2 + 10, my = (sy + ay) / 2 + 4
    g.setLineWidth(1); g.setStrokeColor(d.ink(0.8)); g.setFillColor(theme.bg.cgColor)
    g.beginPath(); g.move(to: CGPoint(x: sx + ux * wv, y: sy + uy * wv))
    g.addQuadCurve(to: CGPoint(x: ax + ux * wv * 0.7, y: ay + uy * wv * 0.7), control: CGPoint(x: mx + ux * wv, y: my + uy * wv))
    g.addLine(to: CGPoint(x: ax - ux * wv * 0.7, y: ay - uy * wv * 0.7))
    g.addQuadCurve(to: CGPoint(x: sx - ux * wv, y: sy - uy * wv), control: CGPoint(x: mx - ux * wv, y: my - uy * wv))
    g.closePath(); g.drawPath(using: .fillStroke)
    g.beginPath(); g.move(to: CGPoint(x: ax + ux * wv * 0.9, y: ay + uy * wv * 0.9)); g.addLine(to: CGPoint(x: ax - ux * wv * 0.9, y: ay - uy * wv * 0.9)); g.strokePath()   // манжета
    g.saveGState(); g.translateBy(x: px + 13, y: py + 2); g.rotate(by: 0.3)                    // кисть — эллипс под 0.3
    g.addEllipse(in: CGRect(x: -8, y: -6, width: 16, height: 12)); g.drawPath(using: .fillStroke); g.restoreGState()
    g.setStrokeColor(d.ink(0.85)); g.beginPath()                                                // пальцы на колке
    for k in 0..<3 {
      let y = py - 2 + CGFloat(k) * 3
      g.move(to: CGPoint(x: px + 8, y: y)); g.addQuadCurve(to: CGPoint(x: px - 3, y: y + 1), control: CGPoint(x: px + 1, y: y - 2.5))
    }
    g.strokePath()
    // облако: 11 точек на эллипсе с «дыханием» радиуса; контур — дуги-«фестоны» к точке, выдвинутой от центра (push)
    func pt(_ k: Int, _ sc: CGFloat, _ dy: CGFloat) -> CGPoint {
      let a = CGFloat(k) / CGFloat(K) * tau, q = 1 + 0.12 * sin(CGFloat(k) * 2.7)
      return CGPoint(x: hx + (cos(a) * r * q) * sc, y: hy + (sin(a) * r * 0.62 * q) * sc + dy)
    }
    func scallop(_ sc: CGFloat, _ dy: CGFloat, _ push: CGFloat) {
      g.beginPath(); g.move(to: pt(0, sc, dy))
      for k in 0..<K {
        let p0 = pt(k, sc, dy), p1 = pt((k + 1) % K, sc, dy), mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2
        g.addQuadCurve(to: p1, control: CGPoint(x: hx + (mx - hx) * push, y: hy + (my - hy) * push))
      }
      g.closePath()
    }
    g.setStrokeColor(d.ink(0.8)); g.setFillColor(theme.bg.cgColor); scallop(1, 0, 1.55); g.drawPath(using: .fillStroke)
    g.setStrokeColor(d.ink(0.18)); scallop(0.6, r * 0.1, 1.4); g.strokePath()
  }

  // роза ветров, как на старых картах: с ветром крутится и дует струями на струны (view.js:198-242 drawAeolus)
  private func aeolus(_ d: Draw, _ now: Double) {
    let g = d.g, G = geo, A = G.aeolus, x = A.x, y = A.y, r = A.r, w = CGFloat(mirror.wind), tau = MonochordView.tau, ra = CGFloat(roseA), held = windHeld
    g.setLineWidth(1); g.setFillColor(theme.bg.cgColor); disc(g, x, y, r)
    g.setStrokeColor(d.ink(held ? 0.95 : 0.7)); arc(g, x, y, r)
    g.setStrokeColor(d.ink(0.3)); arc(g, x, y, r - 3)
    g.setStrokeColor(d.ink(0.45)); g.beginPath()                                         // деления по кругу — 32 румба
    for k in 0..<32 {
      let a = CGFloat(k) / 32 * tau + ra, l: CGFloat = k % 4 != 0 ? 2 : 4
      g.move(to: CGPoint(x: x + cos(a) * (r - 3), y: y + sin(a) * (r - 3))); g.addLine(to: CGPoint(x: x + cos(a) * (r - 3 - l), y: y + sin(a) * (r - 3 - l)))
    }
    g.strokePath()
    func ray(_ a: CGFloat, _ len: CGFloat, _ wd: CGFloat, _ al: CGFloat) {                // луч розы: ромб, одна половина залита, другая — контур
      let tp = CGPoint(x: x + cos(a) * len, y: y + sin(a) * len), l1 = a - .pi / 2, l2 = a + .pi / 2
      let pa = CGPoint(x: x + cos(l1) * wd, y: y + sin(l1) * wd), pb = CGPoint(x: x + cos(l2) * wd, y: y + sin(l2) * wd), c = CGPoint(x: x, y: y)
      g.setFillColor(d.ink(al)); g.beginPath(); g.move(to: c); g.addLine(to: pa); g.addLine(to: tp); g.closePath(); g.fillPath()
      g.setFillColor(theme.bg.cgColor); g.beginPath(); g.move(to: c); g.addLine(to: pb); g.addLine(to: tp); g.closePath(); g.fillPath()
      g.setStrokeColor(d.ink(al)); g.beginPath(); g.move(to: pa); g.addLine(to: tp); g.addLine(to: pb); g.strokePath()
    }
    for k in 0..<4 { ray(ra + .pi / 4 + CGFloat(k) * .pi / 2, r * 0.55, r * 0.13, 0.55) }   // короткие — между сторонами света
    for k in 0..<4 { ray(ra + CGFloat(k) * .pi / 2, r * 0.86, r * 0.17, 0.85) }              // длинные — стороны света
    g.setFillColor(theme.bg.cgColor); disc(g, x, y, r * 0.09); g.setStrokeColor(d.ink(0.85)); arc(g, x, y, r * 0.09)
    if w > 0.01 {                                                                        // струи ветра от розы к струнам: длиннее, ярче и быстрее с силой
      let mx = x + r + 4, len = (G.box.x1 - mx) * (0.35 + 0.65 * w), sp = CGFloat(now) * 0.4 * (1 + w * 3)
      g.setStrokeColor(d.ink(0.12 + 0.45 * w)); g.setLineWidth(1); g.beginPath()
      for k in -2...2 {
        let ph = (sp + CGFloat(k + 2) * 0.23).truncatingRemainder(dividingBy: 1), sl = CGFloat(k) * 0.09, x0 = mx + ph * len * 0.6, y0 = y + CGFloat(k) * 6 + tan(sl) * (x0 - mx)
        g.move(to: CGPoint(x: x0, y: y0))
        g.addCurve(to: CGPoint(x: x0 + 30 + 20 * w, y: y0 + tan(sl) * 30), control1: CGPoint(x: x0 + 14, y: y0 - 4), control2: CGPoint(x: x0 + 22, y: y0 + 4))
      }
      g.strokePath()
    }
    if held { d.mapText("ventus · \(Int((w * 100).rounded()))%", x, y + r + 14, 12, 0.8, align: .center) }
  }
}
