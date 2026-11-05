import UIKit

// микшер (вкладка mix плашки): порядок строк и рисование фейдера. Значения держит Host (Mix).
enum Mixer {
  enum Key: Hashable { case world(Int), volume, master(MixM) }   // volume — мастер-громкость, строка под текущим миром
  static let visibleRows = 6, rowH: CGFloat = 40         // вкладка mix плашки: шесть строк в окне, остальные — прокруткой

  // строки вкладки mix: текущий мир первым, остальные по порядку слота, затем мастер
  static func rows(current: Int?) -> [Key] {
    let ws = Worlds.all.map(\.slot).sorted()
    let order = current.map { c in [c] + ws.filter { $0 != c } } ?? ws
    let worlds = order.map { Key.world($0) }, tail = MixM.allCases.map { Key.master($0) }
    return current == nil ? [.volume] + worlds + tail : [worlds[0], .volume] + worlds.dropFirst() + tail
  }

  // положение ручки — база на касании + сдвиг пальца по дорожке, зажато в 0…1
  static func slide(_ v0: Double, _ dx: CGFloat, span: CGFloat) -> Double { min(max(v0 + Double(dx / span), 0), 1) }

  // уровень канала → доля полосы: −48…+6 дБ
  static func levelK(_ lvl: Float) -> CGFloat { min(max((20 * CGFloat(log10(lvl)) + 48) / 54, 0), 1) }

  // дорожка: двойная линия, засечка нуля, уровень — светлая полоса, ручка — черта
  static func fader(_ d: Draw, _ tx0: CGFloat, _ tx1: CGFloat, _ y: CGFloat, _ t: Double, _ lvl: Float, _ on: Bool) {
    let g = d.g, L = tx1 - tx0
    g.setStrokeColor(d.ink(0.3)); g.setLineWidth(1); g.beginPath()
    g.move(to: CGPoint(x: tx0, y: y - 1.5)); g.addLine(to: CGPoint(x: tx1, y: y - 1.5))
    g.move(to: CGPoint(x: tx0, y: y + 1.5)); g.addLine(to: CGPoint(x: tx1, y: y + 1.5)); g.strokePath()
    if lvl > 0.001 { let k = levelK(lvl); g.setFillColor(d.ink(0.28 + 0.4 * k)); g.fill(CGRect(x: tx0, y: y - 1, width: L * k, height: 2)) }
    let z = tx0 + L * CGFloat(Mix.faderDef)
    g.setStrokeColor(d.ink(0.35)); g.beginPath()
    g.move(to: CGPoint(x: z, y: y - 6)); g.addLine(to: CGPoint(x: z, y: y - 3)); g.move(to: CGPoint(x: z, y: y + 3)); g.addLine(to: CGPoint(x: z, y: y + 6)); g.strokePath()
    let hx = tx0 + L * CGFloat(t)
    g.setStrokeColor(d.ink(on ? 0.95 : 0.35)); g.setLineWidth(2); g.beginPath()
    g.move(to: CGPoint(x: hx, y: y - 8)); g.addLine(to: CGPoint(x: hx, y: y + 8)); g.strokePath(); g.setLineWidth(1)
  }
}
