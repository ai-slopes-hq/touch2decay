import UIKit

// панель «audio» в мире (тап по кнопке громкости; тянуть — по-прежнему громкость): порт host/audio-panel.js без строки midi.
// Состояние (открыта ли, stable, restartAt) держит Host; здесь только геометрия, попадания и картинка.
enum AudioPanel {
  enum Key { case tempo, stop, restart, stable }
  struct Geo {
    var x: CGFloat, w: CGFloat, top: CGFloat, h: CGFloat
    var rows: [(key: Key, label: String, y: CGFloat)]
    var tx0: CGFloat, tx1: CGFloat                           // дорожка tempo
  }
  enum Hit: Equatable { case row(Key), close, none, vol }

  static let rowH: CGFloat = 44
  private static let labels: [(Key, String)] = [(.tempo, "tempo"), (.stop, "stop"), (.restart, "restart audio"), (.stable, "stable audio")]

  // panelGeo: под кнопкой громкости, строки с шагом 44
  static func geo(bar: TopBar, W: CGFloat) -> Geo {
    let b = bar.pos(.vol), w: CGFloat = 230
    let x = min(max(b.x - 34, 12), W - w - 12), top = b.y + TopBar.clrR + 12
    let rows = labels.enumerated().map { (key: $1.0, label: $1.1, y: top + 34 + rowH * CGFloat($0) + rowH / 2) }
    return Geo(x: x, w: w, top: top, h: 34 + CGFloat(rows.count) * rowH + 8, rows: rows, tx0: x + 88, tx1: x + w - 82)
  }

  // panelHit: кнопка громкости — как всегда; мимо панели — закрыть; иначе строка
  static func hit(_ g: Geo, bar: TopBar, x: CGFloat, y: CGFloat) -> Hit {
    let b = bar.pos(.vol)
    if hypot(x - b.x, y - b.y) < TopBar.clrR + 4 { return .vol }
    if x < g.x || x > g.x + g.w || y < g.top || y > g.top + g.h { return .close }
    if let r = g.rows.first(where: { abs(y - $0.y) < rowH / 2 }) { return .row(r.key) }
    return .none
  }

  // sounding — мир звучит (stop живой); held — строка под пальцем; restartK — 1 сразу после перезапуска, до 0 за 0.9 с.
  // Часов у миров в iOS нет: tempo приглушён с «—», stop — «заглушить мир»
  static func draw(_ d: Draw, _ p: Geo, stable: Bool, sounding: Bool, held: Key?, restartK: CGFloat) {
    d.reading {
      let g = d.g
      g.setFillColor(d.paper(0.95)); g.fill(CGRect(x: p.x, y: p.top, width: p.w, height: p.h))
      d.hairBox(p.x, p.top, p.w, p.h, 0.6); d.hairBox(p.x + 3, p.top + 3, p.w - 6, p.h - 6, 0.25)
      d.mapText("audio", p.x + p.w / 2, p.top + 18, 14, 0.8, align: .center)
      let bx = p.x + p.w - 26
      for r in p.rows {
        switch r.key {
        case .tempo:
          d.text(r.label, p.x + 16, r.y, 14, 0.3)
          g.setStrokeColor(d.ink(0.12)); g.setLineWidth(1); g.beginPath()
          g.move(to: CGPoint(x: p.tx0, y: r.y - 1.5)); g.addLine(to: CGPoint(x: p.tx1, y: r.y - 1.5))
          g.move(to: CGPoint(x: p.tx0, y: r.y + 1.5)); g.addLine(to: CGPoint(x: p.tx1, y: r.y + 1.5)); g.strokePath()
          d.text("—", p.x + p.w - 16, r.y, 13, 0.3, align: .right)
        case .stop:                                          // нет часов — заглушить мир: квадрат
          let on = held == .stop
          d.text(r.label, p.x + 16, r.y, 14, sounding ? (on ? 1 : 0.8) : 0.3)
          d.mapText("silence this world", p.tx0, r.y, 11, 0.45)
          g.setStrokeColor(d.ink(sounding ? 0.85 : 0.3)); g.setLineWidth(1.2)
          g.stroke(CGRect(x: bx - 5, y: r.y - 5, width: 10, height: 10))
        case .restart:
          d.text(restartK > 0 ? "audio restarted" : r.label, p.x + 16, r.y, 14, 0.75 + 0.25 * restartK)
          Concordia.restartArrow(d, bx, r.y, restartK)
        case .stable:
          d.text(r.label, p.x + 16, r.y, 14, stable ? 0.95 : 0.75)
          d.ring(bx, r.y, 9, stable ? 0.9 : 0.45, 1.1)
          if stable { d.dot(bx, r.y, 4.5, 0.9) }
        }
      }
    }
  }
}
