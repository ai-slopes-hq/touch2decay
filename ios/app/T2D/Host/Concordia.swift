import UIKit

// общие настройки (тап по солнцу на карте): порт host/concordia.js — коробка, попадания, рисование.
// Состояние (link, stable, restartAt) держит Host; здесь только геометрия и картинка.
enum Settings: Equatable { case off, concordia, mixer }

enum Concordia {
  enum Key { case clock, scale, stable, restart, mixer }
  struct Box {
    var x: CGFloat, y: CGFloat, w: CGFloat, h: CGFloat
    var rows: [(key: Key, label: String, sub: String, y: CGFloat)]
  }

  // settingsBox: под солнцем, но не ниже низа экрана; строки с шагом 44
  static func box(W: CGFloat, H: CGFloat, safeBot: CGFloat, sunY: CGFloat) -> Box {
    let w = min(260, W - 40), h: CGFloat = 252, x = W / 2 - w / 2, y = min(H - safeBot - h - 10, sunY + 30)
    let rows: [(Key, String, String)] = [
      (.clock, "shared tempo", "one bpm in every sequencer"), (.scale, "shared scale", "one scale in every world"),
      (.stable, "stable audio", "larger buffer — for USB interfaces"), (.restart, "restart audio", "after plugging an interface"),
      (.mixer, "mixer", "every world · low-pass, compressor, ceiling")]
    return Box(x: x, y: y, w: w, h: h, rows: rows.enumerated().map { (key: $1.0, label: $1.1, sub: $1.2, y: y + 46 + 44 * CGFloat($0)) })
  }

  static func inside(_ b: Box, x: CGFloat, y: CGFloat) -> Bool { x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h }

  // строка под пальцем (по x — внутри коробки, по y — в 20 pt от центра строки); nil — не строка
  static func hit(_ b: Box, x: CGFloat, y: CGFloat) -> Key? {
    guard x > b.x && x < b.x + b.w else { return nil }
    return b.rows.first { abs(y - $0.y) < 20 }?.key
  }

  // restartK — 1 сразу после перезапуска, до 0 за 0.9 с
  static func draw(_ d: Draw, _ b: Box, link: Link, stable: Bool, restartK: CGFloat) {
    d.reading {
      let g = d.g
      g.setFillColor(d.paper(0.94)); g.fill(CGRect(x: b.x, y: b.y, width: b.w, height: b.h))
      d.hairBox(b.x, b.y, b.w, b.h, 0.6); d.hairBox(b.x + 3, b.y + 3, b.w - 6, b.h - 6, 0.25)
      d.mapText("concordia", b.x + b.w / 2, b.y + 18, 15, 0.85, align: .center)
      for r in b.rows {
        let bx = b.x + b.w - 28
        switch r.key {
        case .mixer:                                         // страница микшера: три фейдера в рамке
          d.mapText(r.label, b.x + 16, r.y - 6, 15, 0.9); d.mapText(r.sub, b.x + 16, r.y + 10, 11, 0.45)
          g.setStrokeColor(d.ink(0.7)); g.setLineWidth(1); g.beginPath()
          for (k, v) in [(CGFloat(-6), CGFloat(0.3)), (0, 0.7), (6, 0.5)] {
            g.move(to: CGPoint(x: bx + k, y: r.y - 8)); g.addLine(to: CGPoint(x: bx + k, y: r.y + 8))
            g.move(to: CGPoint(x: bx + k - 2.5, y: r.y + 8 - 16 * v)); g.addLine(to: CGPoint(x: bx + k + 2.5, y: r.y + 8 - 16 * v))
          }
          g.strokePath()
        case .restart:                                       // действие, не переключатель: круговая стрелка; только что — ярко
          let k = restartK
          d.mapText(k > 0 ? "audio restarted" : r.label, b.x + 16, r.y - 6, 15, 0.6 + 0.35 * k); d.mapText(r.sub, b.x + 16, r.y + 10, 11, 0.45)
          g.setStrokeColor(d.ink(0.5 + 0.5 * k)); g.setLineWidth(1.1); g.beginPath()
          g.addArc(center: CGPoint(x: bx, y: r.y), radius: 8, startAngle: -0.3, endAngle: .pi * 1.6, clockwise: false); g.strokePath()
          let tx = bx + 8 * cos(-0.3), ty = r.y + 8 * sin(-0.3)
          g.beginPath(); g.move(to: CGPoint(x: tx - 4, y: ty - 1)); g.addLine(to: CGPoint(x: tx, y: ty)); g.addLine(to: CGPoint(x: tx + 1, y: ty - 4.5)); g.strokePath()
        default:
          let on = r.key == .stable ? stable : (r.key == .clock ? link.clock : link.scale)
          d.mapText(r.label, b.x + 16, r.y - 6, 15, on ? 0.95 : 0.6); d.mapText(r.sub, b.x + 16, r.y + 10, 11, 0.45)
          d.ring(bx, r.y, 9, on ? 0.9 : 0.45, 1.1)
          if on { d.dot(bx, r.y, 4.5, 0.9) }
        }
      }
    }
  }
}
