import CoreGraphics
import Foundation

// раскладка карты, попадания, состояние перехода и уровни слотов — без UIKit (формулы host/deck.js, host/map.js)

let mapGrid = 4, mapEcl: CGFloat = 40   // GRID и ECL: эклиптика между верхней и нижней половиной

struct Field {
  let x0, y0, cw, ch, gap, sy, fw: CGFloat
  var top: CGFloat = 0   // scopeY веба: верх строки кнопок, нужен плашке UNIVERSUM
  // клетка [столбец, ряд]; ряды от 2-го сдвинуты на эклиптику
  func rect(col: Int, row: Int) -> CGRect {
    CGRect(x: x0 + CGFloat(col) * (cw + gap), y: y0 + CGFloat(row) * (ch + gap) + (row >= mapGrid / 2 ? mapEcl - gap : 0), width: cw, height: ch)
  }
}

enum MapHit: Equatable {
  case world(Int)                 // мир с нативным видом — войти
  case peek(col: Int, row: Int)   // лицо без вида или рубашка — вздрогнуть
  case eat                        // солнце, concordia, мимо
}

enum MapGeo {
  // top — низ верхней панели (аналог scopeY веба)
  static func field(W: CGFloat, H: CGFloat, top: CGFloat, safeBot: CGFloat) -> Field {
    let g = CGFloat(mapGrid), t = top + 40, bot = H - safeBot - 10
    let gap = min(9, max(4, W * 0.014))
    var cw = (W - 12 - (g - 1) * gap) / g
    var ch = (bot - t - (g - 2) * gap - mapEcl) / g
    ch = min(ch, cw / 0.52); cw = min(cw, ch * 0.72)   // карта не уже 0.52 и не шире 0.72 высоты
    let fw = g * cw + (g - 1) * gap, fh = g * ch + (g - 2) * gap + mapEcl
    let x0 = (W - fw) / 2, y0 = t + max(0, (bot - t - fh) / 2)
    return Field(x0: x0, y0: y0, cw: cw, ch: ch, gap: gap, sy: y0 + g / 2 * ch + (g / 2 - 1) * gap + mapEcl / 2, fw: fw, top: top)
  }

  // как navDown: солнце и concordia съедаются; клетка — с зазором вправо и вниз
  static func hit(_ f: Field, W: CGFloat, x: CGFloat, y: CGFloat) -> MapHit {
    let dx = x - W / 2, dy = y - f.sy   // центр эклиптики по x — середина экрана (sx = x0 + fw/2)
    if hypot(dx, dy) < 34 || (dx > 26 && dx < 120 && abs(dy) < mapEcl / 2) { return .eat }
    for c in 0..<mapGrid {
      for r in 0..<mapGrid {
        let p = f.rect(col: c, row: r)
        if x < p.minX || x >= p.maxX + f.gap || y < p.minY || y >= p.maxY + f.gap { continue }
        if let w = Worlds.at(col: c, row: r), w.view { return .world(w.slot) }
        return .peek(col: c, row: r)
      }
    }
    return .eat
  }
}

struct Nav {
  enum View: Equatable { case map, world(Int) }
  var view: View = .map
  var anim: (t0: Double, out: Bool, slot: Int)?
  var peek: (t0: Double, col: Int, row: Int)?
  var freeze: Double?   // только -shot: фиксирует k
  static let dur = 0.52, peekDur = 0.42

  private static func ease(_ t: Double) -> Double { t < 0.5 ? 4 * t * t * t : 1 - pow(-2 * t + 2, 3) / 2 }   // easeIO из map.js:77

  // прогресс перехода 0…1
  func k(_ now: Double) -> Double {
    if let f = freeze { return f }
    guard let a = anim else { return 1 }
    return min(1, max(0, (now - a.t0) / Nav.dur))
  }
  // доля «отъезда» камеры: 0 — мир во весь экран, 1 — карта
  func out(_ now: Double) -> Double {
    guard let a = anim else { return view == .map ? 1 : 0 }
    let e = Nav.ease(k(now))
    return a.out ? e : 1 - e
  }
  func busy(_ now: Double) -> Bool { anim != nil }

  // закрывает кончившиеся переход и peek; слот — если вход в мир завершён
  mutating func step(_ now: Double) -> Int? {
    if let p = peek, now - p.t0 >= Nav.peekDur { peek = nil }
    guard let a = anim, now - a.t0 >= Nav.dur else { return nil }
    anim = nil
    if a.out { view = .map; return nil }
    view = .world(a.slot)
    return a.slot
  }
}

// RMS слотов до фейдера: опрос не чаще 60 мс, спад 0.82 за опрос
struct Levels {
  private(set) var lv = [Float](repeating: 0, count: 16)
  private var raw = [Float](repeating: 0, count: 16)
  private var last = -Double.infinity

  mutating func poll(now: Double, read: (inout [Float]) -> Void) {
    if now - last < 0.06 - 1e-9 { return }
    last = now
    read(&raw)
    for i in 0..<16 {
      let r = raw[i].isFinite && raw[i] > 0 ? raw[i] : 0
      lv[i] = max(r, lv[i] * 0.82)
    }
  }
}
