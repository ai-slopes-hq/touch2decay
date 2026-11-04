import UIKit

// Tenebrae: кольцо связи как прибор, булавка, призрак, чип close (app.js:1262-1343, 1364-1404)

private func clamp(_ x: Double, _ a: Double = 0, _ b: Double = 1) -> Double { x.isNaN ? a : min(max(b, a), max(a, x)) }
private let ringLabels = Ten.linkTypes + ["cut"]

extension TenebraeView {
  // булавка (:1262): включённая — залитый диск с иглой цвета фона; выключенная — бумажный диск с кольцом
  func drawPin(_ p: NatPen, _ d: Draw, _ x: Double, _ y: Double, on: Bool) {
    let g = p.g, R = Ten.pinR
    if on { p.fillInk(0.95) } else { p.fillPap(0.9) }
    g.fillEllipse(in: CGRect(x: x - R, y: y - R, width: 2 * R, height: 2 * R))
    if !on { d.ring(x, y, R, 0.8, 1.2) }
    g.saveGState()
    g.translateBy(x: x, y: y); g.rotate(by: .pi / 4)
    if on { g.setFillColor(theme.bg.cgColor); g.setStrokeColor(theme.bg.cgColor) } else { p.fillInk(0.9); p.strokeInk(0.9) }
    g.setLineWidth(1.4); g.setLineCap(.round)
    g.fillEllipse(in: CGRect(x: -3.2, y: -6 - 3.2, width: 6.4, height: 6.4))
    p.begin(); p.move(-5, -1.5); p.to(5, -1.5); p.move(0, -1.5); p.to(0, 9); p.stroke()
    g.restoreGState()
  }

  // нить от сдвинутого кольца к тому, что оно правит (tether, :1331)
  private func tether(_ p: NatPen, _ cx: Double, _ cy: Double, _ x: Double, _ y: Double) {
    if hypot(x - cx, y - cy) <= 12 { return }
    p.g.saveGState(); p.g.setLineDash(phase: 0, lengths: [2, 4])
    p.line(0.5, 1); p.begin(); p.move(cx, cy); p.to(x, y); p.stroke()
    p.g.restoreGState()
  }

  private func readoutAt(_ cx: Double, _ cy: Double) -> (x: Double, y: Double) {
    (clamp(cx, 90, area.W - 90), max(geo.top + 12 + 56, cy - Ten.menuDead - geo.menuSpan - 48))   // scopeY веба — geo.top + 12 (решение 8)
  }

  // луч k, значение: cut — флаг «режем»; остальные — глубина связи, если тип совпал
  private func ringVal(_ r: TenRing, _ m: TenMod, _ k: Int) -> Double {
    k == 4 ? (r.cutting ? 1 : 0) : (m.type == k ? clamp(m.depth) : 0)
  }

  // кольцо как прибор (:1273): тонкие лучи со шкалой, значение — поперечная риска, подпись на конце луча
  func drawRing(_ p: NatPen, _ d: Draw, _ r: TenRing, pointer: (x: Double, y: Double)?) {
    guard let m = linkMod(r.dst, r.src), (0..<Ten.linkTypes.count).contains(m.type) else { return }
    let g = p.g, cx = r.cx, cy = r.cy, span = geo.menuSpan, R1 = Ten.menuDead, R2 = R1 + span
    let W = area.W, H = area.H
    let sel: Int = r.pinned ? (r.cutting ? 4 : m.type) : (r.key ?? m.type)
    p.fillPap(0.74)
    g.fillEllipse(in: CGRect(x: cx - (R2 + 40), y: cy - (R2 + 40), width: 2 * (R2 + 40), height: 2 * (R2 + 40)))
    g.saveGState(); g.setLineDash(phase: 0, lengths: [2, 5]); d.ring(cx, cy, R1, 0.4, 1); g.restoreGState()
    d.ring(cx, cy, R2, 0.08, 1)
    for sc in sectors {
      let on = sel == sc.key
      let al = on ? 1.0 : 0.4                                    // у связи луч всегда выбран (sel не nil)
      let c = cos(sc.ang), s = sin(sc.ang), px = -s, py = c
      p.line(al * 0.4, 1)
      p.begin(); p.move(cx + c * R1, cy + s * R1); p.to(cx + c * R2, cy + s * R2); p.stroke()
      p.begin()                                                  // шкала: риски каждые 10%, середина длиннее
      for k in 1..<10 {
        let rr = R1 + Double(k) / 10 * span, l = k == 5 ? 5.0 : 2.5
        p.move(cx + c * rr - px * l, cy + s * rr - py * l); p.to(cx + c * rr + px * l, cy + s * rr + py * l)
      }
      p.strokeInk(al * 0.35); p.stroke()
      let val = ringVal(r, m, sc.key)
      if val > 0 {                                               // значение — яркая поперечная риска
        let rr = R1 + val * span, l = on ? 10.0 : 7.0
        p.line(al, on ? 2.5 : 1.6)
        p.begin(); p.move(cx + c * rr - px * l, cy + s * rr - py * l); p.to(cx + c * rr + px * l, cy + s * rr + py * l); p.stroke()
      }
      let lx = clamp(cx + c * (R2 + 22), 30, W - 30), ly = clamp(cy + s * (R2 + 22), 14, H - 14)
      d.text(ringLabels[sc.key], lx, ly, 12, al, align: .center)
    }
    if let q = pointer {
      p.line(0.5, 1); p.begin(); p.move(cx, cy); p.to(q.x, q.y); p.stroke()
      d.dot(q.x, q.y, 3, 1)
    }
    let readout: String
    if r.pinned { readout = r.cutting ? "release to cut" : "\(Ten.linkTypes[m.type]) · \(tenInt(Horo.jsRound(clamp(m.depth) * 100)))%" }
    else if let k = r.key {
      let t = k == 4 ? (r.cutting ? "release to cut" : "pull further") : "\(tenInt(Horo.jsRound(clamp(m.depth) * 100)))%"
      readout = ringLabels[k] + " · " + t
    } else { readout = "\(Ten.linkTypes[m.type]) · \(tenInt(Horo.jsRound(clamp(m.depth) * 100)))%" }
    let at = readoutAt(cx, cy)
    d.text(readout, at.x, at.y, 15, 1, align: .center)
  }

  // закреплённое кольцо связи (:1364): привязь к середине нити, ромб в центре; булавки нет
  func drawRingPinned(_ p: NatPen, _ d: Draw, _ r: TenRing) {
    guard linkMod(r.dst, r.src) != nil else { return }
    let mid = linkMid(dst: r.dst, src: r.src)
    tether(p, r.cx, r.cy, mid.x, mid.y)
    drawRing(p, d, r, pointer: nil)
    d.diamond(r.cx, r.cy, 6, 1, true)
  }

  // кольцо на весу (:1392): указатель — движение пальца, перенесённое в кольцо; булавка — закрепить. Призрак — тот же вид без пальца
  func drawRingHung(_ p: NatPen, _ d: Draw, _ r: TenRing) {
    guard linkMod(r.dst, r.src) != nil else { return }
    let mid = linkMid(dst: r.dst, src: r.src)
    var ptr: (x: Double, y: Double)?
    if let id = r.finger, let f = fingers[id] { ptr = (r.cx + (f.x - r.gx), r.cy + (f.y - r.gy)) }
    tether(p, r.cx, r.cy, mid.x, mid.y)
    drawRing(p, d, r, pointer: r.key != nil ? ptr : nil)
    d.diamond(r.cx, r.cy, 6, 1, true)
    if let q = ptr, r.key == nil {                               // путь пальца, пока луч не выбран (например, к булавке)
      p.line(0.4, 1); p.begin(); p.move(r.cx, r.cy); p.to(q.x, q.y); p.stroke()
      d.dot(q.x, q.y, 3, 0.8)
    }
    if r.overPin { d.ring(r.cx, r.cy, Ten.pinR + 5, 0.35, 3); drawPin(p, d, r.cx, r.cy, on: true) }
    else { drawPin(p, d, r.cx, r.cy, on: false) }
  }

  // чип close под закреплённым кольцом (:1338); «палец на пустоте» не рисуем: касание вне кольца закрывает его сразу
  func drawCloseChip(_ d: Draw) {
    let c = closeChip
    d.g.setFillColor(d.paper(0.9)); d.g.fill(CGRect(x: c.x, y: c.y, width: c.w, height: c.h))
    d.hairBox(c.x, c.y, c.w, c.h, 0.5)
    d.text("close", c.x + c.w / 2, c.y + c.h / 2, 12, 0.8, align: .center)
  }
}
