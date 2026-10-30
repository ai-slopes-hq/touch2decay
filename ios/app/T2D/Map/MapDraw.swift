import UIKit

// кадр карты Universum: порт host/map.js drawNav (:284-333) и drawMapChrome (:336-359).
enum MapDraw {
  private static let T2 = CGFloat.pi * 2
  private static var cW: CGFloat?                          // ширина подписи concordia: шрифт один — считаем раз
  private static func concordiaW(_ d: Draw) -> CGFloat {
    if let w = cW { return w }
    let w = d.mapTextWidth("concordia", 12) + 14; cW = w; return w
  }

  // now — секунды; в формулах веба — мс. snap — снимок мира, участвующего в переходе (nil — рисуем только карточки)
  static func draw(_ d: Draw, nav: Nav, field F: Field, lv: [Float], snap: CGImage?, settings: Bool = false, now: Double) {
    let g = d.g, ms = now * 1000
    d.setTheme(.base)                                   // карта — чёрная, как Tenebrae
    g.setAlpha(1)
    g.setFillColor(Theme.base.bg.cgColor); g.fill(CGRect(x: 0, y: 0, width: d.W, height: d.H))
    let out = CGFloat(nav.out(now)), focus = nav.anim?.slot
    let pk = nav.peek.flatMap { now - $0.t0 < Nav.peekDur ? $0 : nil }
    // рубашки — неоткрытые миры; тронутая вздрагивает: сжатие по x и «nondum»
    for (c, r) in Worlds.backs {
      let p = F.rect(col: c, row: r)
      card(d, Emblems.back(w: p.width, h: p.height), p, out: out, peek: pk.flatMap { $0.col == c && $0.row == r ? q(pk!, now) : nil })
    }
    // лицом вверх — открытые миры; мир, в который летим или из которого вышли, — его снимок, тает
    for w in Worlds.all {
      let p = F.rect(col: w.col, row: w.row)
      card(d, Emblems.face(w.slot, w: p.width, h: p.height), p, out: out, peek: pk.flatMap { $0.col == w.col && $0.row == w.row ? q(pk!, now) : nil })
      let l = lv.indices.contains(w.slot) ? lv[w.slot] : 0
      if l > 0.0025 && out > 0.5 { rays(d, p, CGFloat(l), out: out, ms: ms) }
      if w.slot == focus, let shot = snap, out < 1 {   // прямоугольник перехода: от клетки до экрана
        let r = CGRect(x: p.minX * out, y: p.minY * out, width: d.W + (p.width - d.W) * out, height: d.H + (p.height - d.H) * out)
        g.setAlpha(1 - out); image(g, shot, r); g.setAlpha(1)
      }
    }
    if out > 0.02 { chrome(d, F, al: out, settings: settings, ms: ms) }
  }

  private static func q(_ pk: (t0: Double, col: Int, row: Int), _ now: Double) -> CGFloat { CGFloat(sin(Double.pi * (now - pk.t0) / Nav.peekDur)) }

  // CGImage лежит сверху вниз, контекст — тоже: переворачиваем локально
  private static func image(_ g: CGContext, _ im: CGImage, _ r: CGRect) {
    g.saveGState(); g.translateBy(x: r.minX, y: r.maxY); g.scaleBy(x: 1, y: -1)
    g.draw(im, in: CGRect(x: 0, y: 0, width: r.width, height: r.height))
    g.restoreGState()
  }

  private static func card(_ d: Draw, _ im: CGImage?, _ p: CGRect, out: CGFloat, peek q: CGFloat?) {
    guard let im = im else { return }
    let g = d.g
    g.setAlpha(out)
    if let q = q {
      let cx = p.midX
      g.saveGState(); g.translateBy(x: cx, y: 0); g.scaleBy(x: 1 - 0.3 * q, y: 1)
      image(g, im, CGRect(x: -p.width / 2, y: p.minY, width: p.width, height: p.height))
      g.restoreGState()
      d.mapText("nondum", cx, p.midY, 11, 0.8 * q, align: .center)
    } else { image(g, im, p) }
    g.setAlpha(1)
  }

  // звучит: вокруг карточки лучи, как у солнца, — дышат уровнем этого слота
  private static func rays(_ d: Draw, _ p: CGRect, _ lv: CGFloat, out: CGFloat, ms: Double) {
    let g = d.g, k = min(1, max(0, CGFloat(Double(lv).squareRoot()) * 2.2)), cx = p.midX, cy = p.midY, n = 28
    g.setAlpha(out); g.setStrokeColor(d.ink(0.25 + 0.6 * k)); g.setLineWidth(1); g.beginPath()
    for i in 0..<n {
      let a = Double(i) / Double(n) * Double.pi * 2 + ms * 0.0002, c = CGFloat(cos(a)), sn = CGFloat(sin(a))
      let tt = min(abs((p.width / 2) / (c == 0 ? 1e-6 : c)), abs((p.height / 2) / (sn == 0 ? 1e-6 : sn)))
      let l = (i % 2 == 1 ? 2 : 4) + 7 * k * (0.6 + 0.4 * CGFloat(sin(ms * 0.006 + Double(i))))
      g.move(to: CGPoint(x: cx + c * (tt + 2), y: cy + sn * (tt + 2))); g.addLine(to: CGPoint(x: cx + c * (tt + 2 + l), y: cy + sn * (tt + 2 + l)))
    }
    g.strokePath()
    d.hairBox(p.minX - 2, p.minY - 2, p.width + 4, p.height + 4, 0.3 + 0.5 * k)
    g.setAlpha(1)
  }

  // эклиптика с делениями, солнце в центре расклада, concordia, имя карты
  private static func chrome(_ d: Draw, _ F: Field, al: CGFloat, settings: Bool, ms: Double) {
    let g = d.g, cx = F.x0 + F.fw / 2, cy = F.sy, bg = Theme.base.bg.cgColor
    g.setAlpha(al); g.setLineWidth(1)
    g.setStrokeColor(d.ink(0.45)); g.beginPath()
    g.move(to: CGPoint(x: F.x0, y: cy + 0.5)); g.addLine(to: CGPoint(x: F.x0 + F.fw, y: cy + 0.5)); g.strokePath()
    g.setStrokeColor(d.ink(0.28)); g.beginPath()
    var dd: CGFloat = 12
    while dd < F.fw / 2 {
      let l: CGFloat = Int((dd / 12).rounded()) % 5 != 0 ? 2.5 : 5
      g.move(to: CGPoint(x: cx + dd, y: cy - l)); g.addLine(to: CGPoint(x: cx + dd, y: cy + l))
      g.move(to: CGPoint(x: cx - dd, y: cy - l)); g.addLine(to: CGPoint(x: cx - dd, y: cy + l))
      dd += 12
    }
    g.strokePath()
    g.setFillColor(bg); g.fillEllipse(in: CGRect(x: cx - 20, y: cy - 20, width: 40, height: 40))   // солнце в середине расклада
    d.sunGlyph(cx, cy, 0, T2, scale: 0.6, now: ms)
    if !settings {                                           // подпись солнца — что за ним: общие настройки
      g.setFillColor(bg); g.fill(CGRect(x: cx + 34, y: cy - 9, width: concordiaW(d), height: 18))
      d.mapText("concordia", cx + 41, cy, 12, 0.65)
    }
    let tw: CGFloat = 184, sy = F.top
    g.setFillColor(d.paper(0.7)); g.fill(CGRect(x: d.W / 2 - tw / 2, y: sy - 6, width: tw, height: 34))   // имя всей карты
    d.mapText("U N I V E R S U M", d.W / 2, sy + 11, 20, 0.95, align: .center, italic: false)
    g.setAlpha(1)
  }
}
