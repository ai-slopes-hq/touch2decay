import UIKit

private let dashFair: [CGFloat] = [3, 4], dashFifth: [CGFloat] = [1, 5], noDash: [CGFloat] = []

// кеш неподвижного: звёзды, вода, фарватер, мысы, набережная — view.js:142-198
final class PorWall {
  private(set) var builds = 0
  private(set) var img: CGImage?
  // ключ веба `W×H×DPR|hor|qy|Ws|pcs|root` — поля, без String в кадре
  private var built = false
  private var kW = 0.0, kH = 0.0, kD = 0.0, kHor = 0.0, kQy = 0.0, kWs = 0.0, kRoot = 0
  private var kPcs: [Int]?

  func update(_ G: PorGeo, size: CGSize, dpr: CGFloat, scl: PorScale, ink: RGB, bg: RGB) {
    let d = Double(dpr)
    if built && G.W == kW && G.H == kH && d == kD && G.hor == kHor && G.qy == kQy && G.Ws == kWs && scl.pcs == kPcs && scl.root == kRoot { return }
    built = true; kW = G.W; kH = G.H; kD = d; kHor = G.hor; kQy = G.qy; kWs = G.Ws; kPcs = scl.pcs; kRoot = scl.root
    builds += 1
    img = Draw.layer(size, dpr) { PorScene.paint(NatPen(g: $0, inkC: ink, papC: bg), G, scl: scl) }
  }
}

enum PorScene {
  private static let N = 120

  // view.js:145-197 — рисует стену строка в строку; каждый rnd() на своём месте (в том числе в пропущенных итерациях)
  static func paint(_ p: NatPen, _ G: PorGeo, scl: PorScale) {
    let g = p.g, W = G.W, H = G.H
    p.fillPap(1); p.fillRect(0, 0, W, H)
    var rnd = NatLCG(seed: 13)
    for _ in 0..<110 {                                                                    // звёзды
      let sx = G.fx0 + rnd.next() * G.Ws, sy = G.top + pow(rnd.next(), 1.3) * (G.hor - G.top - 6)
      p.fillInk(0.15 + 0.5 * pow(rnd.next(), 2))
      let w = rnd.next() < 0.12 ? 1.6 : 1, h = rnd.next() < 0.12 ? 1.6 : 1
      p.fillRect(sx, sy, w, h)
    }
    func shore(_ side: Double, _ d: Double) -> (x: Double, y: Double, s: Double, wb: Double) { G.P(Por.edge(side, d), d) }
    func inWater(_ u: Double, _ d: Double) -> Bool { u > Por.edge(-1, d) + 0.01 && u < Por.edge(1, d) - 0.01 }
    p.strokeInk(0.14); g.setLineWidth(0.7); p.begin()                                     // вода: короткие гравированные волны
    for _ in 0..<700 {
      let d = 1 - pow(rnd.next(), 1.5), u = rnd.next() * 2 - 1
      if !inWater(u, d) { continue }
      let q = G.P(u, d), l = 2 + 10 * q.s
      p.move(q.x - l, q.y + 1); p.quad(q.x, q.y - 1.4 * q.s, q.x + l, q.y + 1)
    }
    p.stroke()
    g.setLineWidth(0.8)                                                                   // фарватер: края пунктиром, квинта — бледнее
    let edges: [(a: Double, al: Double, dash: [CGFloat])] = [(-0.5, 0.3, dashFair), (0.5, 0.3, dashFair), (-0.5 + 7.0 / 12, 0.1, dashFifth)]
    for e in edges {
      p.strokeInk(e.al); p.dash(e.dash); p.begin()
      for k in 0...60 {
        let f = 0.04 + 0.88 * Double(k) / 60, pt = G.laneAt(f, e.a)
        if k > 0 { p.to(pt.x, pt.y) } else { p.move(pt.x, pt.y) }
      }
      p.stroke()
    }
    p.dash(noDash)
    for i in 0..<Por.nstep {                                                              // поперёк — места, такт ярче
      let a = G.laneAt(PorGeo.fOf(i), -0.5), b = G.laneAt(PorGeo.fOf(i), 0.5)
      p.strokeInk(i % 4 != 0 ? 0.1 : 0.22); p.begin(); p.move(a.x, a.y); p.to(b.x, b.y); p.stroke()
    }
    g.setLineWidth(0.8)
    for k in 0...Por.pspan {                                                              // полутоны — засечки, ступени лада длиннее
      let pc = (((scl.root + k) % 12) + 12) % 12, on = scl.pcs?.contains(pc) ?? true
      let pt = G.laneAt(0.04, Double(k) / Double(Por.pspan) - 0.5)
      p.strokeInk(on ? 0.5 : 0.2); p.begin(); p.move(pt.x, pt.y); p.to(pt.x, pt.y + (on ? 7 : 3)); p.stroke()
    }
    for side in [-1.0, 1.0] { cape(p, G, side, &rnd) }
    p.strokeInk(0.75); g.setLineWidth(1); p.begin()                                       // горизонт в устье бухты
    do { let a = shore(-1, 1), b = shore(1, 1); p.move(a.x, G.hor + 0.5); p.to(b.x, G.hor + 0.5) }
    p.stroke()
    let qy = G.qy                                                                         // набережная: камень кладкой
    p.fillPap(1); p.fillRect(G.fx0, qy, G.Ws, G.bot - qy + 8)
    p.strokeInk(0.8); g.setLineWidth(1.2); p.begin(); p.move(G.fx0, qy + 0.5); p.to(G.fx1, qy + 0.5); p.stroke()
    p.strokeInk(0.15); g.setLineWidth(0.7); p.begin()
    for r in 0..<4 {
      let y = qy + 8 + Double(r) * 12
      p.move(G.fx0, y); p.to(G.fx1, y)
      var X = G.fx0 + Double(r % 2) * 14
      while X < G.fx1 { p.move(X, y - 12 + (r != 0 ? 0 : 4)); p.to(X, y); X += 28 }
    }
    p.stroke()
  }

  // view.js:172-192 — мыс: скала над водой, штрихи, сверху трава и кипарисы
  private static func cape(_ p: NatPen, _ G: PorGeo, _ side: Double, _ rnd: inout NatLCG) {
    let g = p.g, N = Double(PorScene.N)
    func shore(_ d: Double) -> (x: Double, y: Double, s: Double, wb: Double) { G.P(Por.edge(side, d), d) }
    func top(_ d: Double) -> (x: Double, y: Double, s: Double, w: Double) {
      let q = shore(d); return (q.x, q.y - PorGeo.cliffH(side, d) * q.s, q.s, q.y)
    }
    let outer = side < 0 ? G.fx0 - 2 : G.fx1 + 2
    p.fillPap(1); p.begin(); p.move(outer, G.qy + 2)
    for i in 0...PorScene.N { let t = top(Double(i) / N); p.to(t.x, t.y) }
    p.to(outer, G.hor - 1); p.close()
    let land = g.path
    p.fill()
    g.saveGState()                                                                        // земля мыса: косая штриховка, к горизонту гуще
    if let land { g.addPath(land); g.clip() }
    p.strokeInk(0.07); g.setLineWidth(0.6); p.begin()
    var X = G.fx0 - G.H
    while X < G.fx1 + G.H { p.move(X, G.hor); p.to(X + side * (G.qy - G.hor) * 0.5, G.qy); X += 5 }
    p.stroke(); g.restoreGState()
    p.strokeInk(0.3); g.setLineWidth(0.6); p.begin()                                      // скальная стена: вертикальные штрихи от кромки вверх
    for _ in 0..<260 {
      let d = pow(rnd.next(), 1.25), q = shore(d), t = top(d), dx = -side * rnd.next() * 2
      if t.w - t.y < 3 { continue }
      p.move(q.x + dx, t.y + 1.5); p.to(q.x + dx + side * 0.6, q.y - 0.5 - rnd.next() * (t.w - t.y) * 0.3)
    }
    p.stroke()
    p.strokeInk(0.85); g.setLineWidth(1); p.begin()                                       // кромка скалы
    for i in 0...PorScene.N { let t = top(Double(i) / N); if i > 0 { p.to(t.x, t.y) } else { p.move(t.x, t.y) } }
    p.stroke()
    p.strokeInk(0.6); p.begin()                                                           // урез воды
    for i in 0...PorScene.N { let q = shore(Double(i) / N); if i > 0 { p.to(q.x, q.y) } else { p.move(q.x, q.y) } }
    p.stroke()
    p.strokeInk(0.18); p.begin()                                                          // прибой у скал
    for _ in 0..<70 {
      let d = rnd.next(), q = shore(d), l = 3 + 6 * q.s
      let x0 = q.x - side * (3 + rnd.next() * 8) * q.s, y0 = q.y + 2 + rnd.next() * 4 * q.s
      p.move(x0, y0)
      let x1 = q.x - side * (3 + rnd.next() * 8) * q.s - side * l, y1 = q.y + 2 + rnd.next() * 4 * q.s
      p.to(x1, y1)
    }
    p.stroke()
    for _ in 0..<14 {                                                                     // кипарисы на мысах — тёмные свечи
      let d = 0.04 + rnd.next() * 0.9, t = top(d), xx = t.x + side * (6 + rnd.next() * 40) * t.s
      let h = (14 + rnd.next() * 16) * t.s, w = h * 0.2
      if side < 0 ? xx < G.fx0 + 6 : xx > G.fx1 - 6 { continue }
      p.fillPap(1); p.strokeInk(0.7); g.setLineWidth(0.8); p.begin()
      p.move(xx, t.y + 2 - h); p.quad(xx + w, t.y + 2 - h * 0.5, xx + w * 0.5, t.y + 2); p.to(xx - w * 0.5, t.y + 2)
      p.quad(xx - w, t.y + 2 - h * 0.5, xx, t.y + 2 - h)
      g.drawPath(using: .fillStroke)                                                       // canvas fill() и stroke() по одному пути
      p.strokeInk(0.35); p.begin(); p.move(xx + w * 0.3, t.y - h * 0.7); p.to(xx + w * 0.15, t.y); p.stroke()
    }
  }
}
