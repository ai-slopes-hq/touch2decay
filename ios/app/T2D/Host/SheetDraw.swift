import UIKit

// рисование плашки и панели LFO: порт drawFxSheet0 и drawSlPanel0 (host/sheet.js:94-170). Только набор форм random (classic — вне 2b-2).
// held — что под пальцем: подсвечивает строку, off, полосу форм или пад; sample — выборка формы ядра (shape, morph, u, seed)
enum SheetDraw {
  static func draw(_ d: Draw, _ s: Sheet, _ g: SheetGeo, lfos: [LfoSnap], held: SheetHit?, sample: (Int, Double, Double, Int) -> Double) {
    d.reading {
      let c = d.g, X = s.spec
      c.setFillColor(d.paper(0.97)); c.fill(CGRect(x: 0, y: g.top, width: d.W, height: d.H - g.top))
      c.setStrokeColor(d.ink(0.35)); c.setLineWidth(1)
      c.beginPath(); c.move(to: CGPoint(x: 0, y: g.top + 0.5)); c.addLine(to: CGPoint(x: d.W, y: g.top + 0.5)); c.strokePath()
      c.setFillColor(d.ink(0.3)); c.fill(CGRect(x: d.W / 2 - 18, y: g.top + 5, width: 36, height: 2))
      d.mapText(X.title, g.x, g.top + 26, 17, 0.95)
      d.mapText(X.hint.isEmpty ? "tap outside to close" : X.hint, g.x + g.w, g.top + 26, 12, 0.5, align: .right)
      for r in g.rows {
        let cy = r.y + r.h / 2, on = held == .row(r.k)
        func T(_ t: Double) -> CGFloat { g.tx0 + CGFloat(min(1, max(0, t))) * (g.tx1 - g.tx0) }
        let code = X.rows.first { $0.key == r.k }?.code
        let e = X.lfo.flatMap { l in lfos.first { $0.slot == s.slot && $0.obj == l.obj && $0.key == code } }
        let sel = X.lfo != nil && s.lfoKey == r.k
        d.text(r.label, g.x, cy, 14, on || sel ? 1 : 0.75)
        c.setStrokeColor(d.ink(0.45)); c.setLineWidth(1)
        c.beginPath(); c.move(to: CGPoint(x: g.tx0, y: cy + 0.5)); c.addLine(to: CGPoint(x: g.tx1, y: cy + 0.5)); c.strokePath()
        let t = X.get(r.k), b = e?.base ?? t
        if let e {   // размах LFO
          let lo = min(1, max(0, e.base - e.depth * 0.5)), hi = min(1, max(0, e.base + e.depth * 0.5))
          c.setFillColor(d.ink(0.16)); c.fill(CGRect(x: T(lo), y: cy - 3, width: T(hi) - T(lo), height: 6))
        } else {
          c.setFillColor(d.ink(0.2)); c.fill(CGRect(x: g.tx0, y: cy - 2, width: T(t) - g.tx0, height: 4))
        }
        d.dot(T(b), cy, on ? 8 : 6.5, 1)
        if e != nil { d.dot(T(t), cy, 2.2, 0.7) }
        d.text(X.text(r.k), g.tx1 + 12, cy, 13, 0.9)
        if let l = X.lfo, l.keys.contains(r.k) {   // «~» — есть LFO: залито, открыта панель: двойная рамка
          let lx = g.lfoX
          if e != nil { c.setFillColor(d.ink(0.14)); c.fill(CGRect(x: lx - 15, y: cy - 12, width: 30, height: 24)) }
          d.hairBox(lx - 15, cy - 12, 30, 24, sel ? 0.95 : e != nil ? 0.7 : 0.45)
          if sel { d.hairBox(lx - 18, cy - 15, 36, 30, 0.4) }
          c.setStrokeColor(d.ink(e != nil ? 1 : 0.7)); c.setLineWidth(e != nil ? 1.4 : 1.1)
          c.beginPath()
          for i in 0...12 {
            let p = CGPoint(x: lx - 9 + CGFloat(i) / 12 * 18, y: cy + CGFloat(sin(Double(i) / 12 * .pi * 2)) * 4)
            if i > 0 { c.addLine(to: p) } else { c.move(to: p) }
          }
          c.strokePath()
        }
      }
      if X.lfo != nil, let k = s.lfoKey { panel(d, s, g, lfos, held, sample, label: X.rows.first { $0.key == k }?.label ?? "", key: k) }
    }
  }

  private static func panel(_ d: Draw, _ s: Sheet, _ g: SheetGeo, _ lfos: [LfoSnap], _ held: SheetHit?,
                            _ sample: (Int, Double, Double, Int) -> Double, label: String, key: String) {
    guard let l = s.spec.lfo else { return }
    let c = d.g, p = g.panel, pd = p.pad, sh = p.shape
    let code = s.spec.rows.first { $0.key == key }?.code
    let e = lfos.first { $0.slot == s.slot && $0.obj == l.obj && $0.key == code }
    c.setFillColor(d.paper(0.97)); c.fill(CGRect(x: 0, y: p.top - 10, width: d.W, height: p.bottom - p.top + 18))
    c.setStrokeColor(d.ink(0.2)); c.setLineWidth(1)
    c.beginPath(); c.move(to: CGPoint(x: 0, y: p.top - 9.5)); c.addLine(to: CGPoint(x: d.W, y: p.top - 9.5)); c.strokePath()
    d.text("LFO → \(label)", p.x, p.top + 6, 13, 1)
    if let e {
      let r = e.rate, hz = String(format: r < 10 ? "%.2f" : "%.1f", r)
      d.text("\(hz) Hz · \(Int((e.depth * 100).rounded()))%", p.x + p.w - 58, p.top + 6, 15, 1, align: .right)
      let o = g.off, on = held == .off
      d.hairBox(o.minX, o.minY, o.width, o.height, on ? 0.9 : 0.45)
      d.text("off", o.midX, o.midY, 12, on ? 1 : 0.75, align: .center)
    } else { d.text("drag the pad", p.x + p.w, p.top + 6, 12, 0.5, align: .right) }
    d.hairBox(p.x, sh.y, p.w, sh.h, held == .strip ? 0.8 : 0.3)
    func icon(_ m: Double, _ cx: CGFloat, _ w: CGFloat, _ h: CGFloat, _ a: CGFloat, _ lw: CGFloat) {
      c.setStrokeColor(d.ink(a)); c.setLineWidth(lw); c.setLineJoin(.round)
      c.beginPath()
      for i in 0...96 {
        let t = Double(i) / 96, y = sh.y + sh.h / 2 - CGFloat(sample(l.shape, m, t * 2.5, 5)) * h / 2, x = cx - w / 2 + CGFloat(t) * w
        if i > 0 { c.addLine(to: CGPoint(x: x, y: y)) } else { c.move(to: CGPoint(x: x, y: y)) }
      }
      c.strokePath()
    }
    if l.shape == 1 {                                      // random: 4 значка
      for i in 0..<4 { icon((Double(i) + 0.5) / 4, p.x + 22 + CGFloat((Double(i) + 0.5) / 4) * (p.w - 44), 34, 16, 0.3, 1.1) }
      if let e {
        let m = e.morph.isFinite ? e.morph : 0                 // NaN из снимка — не роняем Int(floor)
        let i = max(0, min(3, Int(floor(m * 4)))), cx = p.x + 22 + CGFloat((Double(i) + 0.5) / 4) * (p.w - 44)
        d.hairBox(cx - 26, sh.y + 4, 52, sh.h - 8, 0.9); icon(m, cx, 40, 22, 1, 1.6)
      }
    } else {                                               // classic: 9 форм вдоль полосы (host/sheet.js:148)
      for i in 0..<9 {
        let k = Double(i) / 8
        d.drawCurve({ u in sample(0, k, u, 0) }, p.x + 22 + CGFloat(k) * (p.w - 44), sh.y + sh.h / 2, 24, 16, 0.3, cycles: 1, lw: 1.1)
      }
      if let e {
        let m = e.morph.isFinite ? e.morph : 0
        let mx = p.x + 22 + CGFloat(m) * (p.w - 44)
        d.hairBox(mx - 24, sh.y + 4, 48, sh.h - 8, 0.9)
        d.drawCurve({ u in sample(0, m, u, 0) }, mx, sh.y + sh.h / 2, 38, 22, 1, cycles: 1.5, lw: 1.6)
      }
    }
    let on = held == .pad, by = pd.y + pd.h - 0.5
    d.hairBox(p.x, pd.y, p.w, pd.h, on ? 0.8 : 0.3)
    c.setStrokeColor(d.ink(0.1)); c.setLineWidth(1)
    c.beginPath()
    for hz in [0.1, 1, 10] {
      let x = Pad.rateX(p, hz).rounded() + 0.5
      c.move(to: CGPoint(x: x, y: pd.y + 1)); c.addLine(to: CGPoint(x: x, y: by))
    }
    c.strokePath()
    for (hz, t) in [(0.1, "0.1"), (1, "1"), (10, "10 Hz")] { d.text(t, Pad.rateX(p, hz) + 4, by - 12, 10, 0.45) }
    d.text("depth", p.x + 10, pd.y + 12, 10, 0.45)
    guard let e else { return }
    let cx = Pad.rateX(p, e.rate), cy = Pad.depthY(p, e.depth), mid = pd.y + pd.h / 2
    let amp = CGFloat(e.depth) * (pd.h / 2 - PAD_IN), span = 2 * e.rate
    func fn(_ u: Double) -> Double { sample(e.shape, e.morph, u, e.seed) }
    c.saveGState()
    c.clip(to: CGRect(x: p.x + 1, y: pd.y + 1, width: p.w - 2, height: pd.h - 2))
    c.setStrokeColor(d.ink(on ? 0.5 : 0.32)); c.setLineWidth(1.2); c.setLineJoin(.round)
    c.beginPath()
    let N = min(600, max(120, Int((span * 24).rounded())))
    for i in 0...N {
      let t = Double(i) / Double(N), u = e.u - (1 - t) * span
      let pt = CGPoint(x: p.x + PAD_IN + CGFloat(t) * (p.w - 2 * PAD_IN), y: mid - CGFloat(fn(u)) * amp)
      if i > 0 { c.addLine(to: pt) } else { c.move(to: pt) }
    }
    c.strokePath()
    c.setLineDash(phase: 0, lengths: [2, 4]); c.setStrokeColor(d.ink(0.35)); c.setLineWidth(1)
    c.beginPath()
    c.move(to: CGPoint(x: cx.rounded() + 0.5, y: pd.y + 1)); c.addLine(to: CGPoint(x: cx.rounded() + 0.5, y: by))
    c.move(to: CGPoint(x: p.x + 1, y: cy.rounded() + 0.5)); c.addLine(to: CGPoint(x: p.x + p.w - 1, y: cy.rounded() + 0.5))
    c.strokePath()
    c.restoreGState()
    d.dot(p.x + p.w - PAD_IN, mid - CGFloat(fn(e.u)) * amp, 2.5, 0.9)
    d.ring(cx, cy, on ? 11 : 8, 1, on ? 2 : 1.4); d.dot(cx, cy, 2.5, 1)
  }
}
