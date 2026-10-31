import Foundation

// Inferno (мир V): константы, геометрия воронки, лад, плашка — перенос worlds/inferno/{model,view}.js
enum Inf {
  static let slot = 5, nc = 9
  static let names = ["Limbus", "Luxuria", "Gula", "Avaritia", "Ira", "Haeresis", "Violentia", "Fraus", "Proditio"]
  static let roman = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"]
  static let colors = ["white", "pink", "brown", "crackle", "grain"]
  static let pinMax = 4
  static let span = 60.0 / 9                                      // зона круга ~⅔ октавы
  static let fxKeys = ["structure", "fire", "smoke", "ice", "storm"]   // индекс = Fx ядра
  static let fxDef: [Double] = [0, 0.2, 0.35, 0, 0.6]
  static let ember: RGB = (226, 99, 42), ember2: RGB = (242, 160, 74), ice: RGB = (185, 210, 223)
  static let sparkMax = 160
  static let mirrorN = 81, head = 9, circN = 8                    // зеркало: 9 + 8·k — core/worlds/inferno/world.hpp

  enum Act { static let strike = 0, pos = 1, hold = 2, pin = 3, circ = 4, fx = 5, clear = 6, dice = 7 }

  // начальные круги (как createModel)
  static func color0(_ k: Int) -> Int { k < 3 ? 0 : k < 6 ? 1 : k < 8 ? 2 : 3 }
  static func drive0(_ k: Int) -> Double { 0.15 + Double(k) * 0.08 }
}

struct InfRing { var cy: Double, rx: Double, ry: Double }

struct InfGeo {
  var W, H, top, bot, cx, Ws, y0, yC, dy: Double
  var rings: [InfRing]
  var coc: InfRing
  var dark: (x: Double, y: Double, r: Double)

  init(W: Double, H: Double, topY: Double, safeBot: Double) {
    self.W = W; self.H = H
    top = topY + 6; bot = H - safeBot - 8; cx = W / 2
    Ws = min(W, (H - safeBot) * 0.62)                             // воронка портретная: на широком экране по центру
    y0 = top + 96; yC = bot - 54; dy = (yC - y0) / 9.3
    let rx0 = Ws * 0.46, rx8 = Ws * 0.13
    var rs: [InfRing] = []
    for k in 0..<Inf.nc {
      let rx = rx0 - (rx0 - rx8) * Double(k) / 8
      rs.append(InfRing(cy: y0 + Double(k) * dy, rx: rx, ry: rx * 0.13 + 3))
    }
    rings = rs
    coc = InfRing(cy: yC, rx: Ws * 0.11, ry: 9)
    dark = (0, H - safeBot, min(110, Ws * 0.28))
  }

  // −1 — мимо; loose — без проверки по x (для move)
  func circleAt(_ x: Double, _ y: Double, loose: Bool = false) -> Int {
    let k = Int(Horo.jsRound((y - y0) / dy))
    if k < 0 || k > 8 { return -1 }
    let r = rings[k]
    if abs(y - r.cy) > dy / 2 { return -1 }
    if !loose && abs(x - cx) > r.rx + 18 { return -1 }
    return k
  }

  func posAt(_ k: Int, _ x: Double) -> Double {
    let r = rings[k]
    return min(1, max(0, (x - (cx - r.rx)) / (2 * r.rx)))
  }

  // точка круга k при высоте pos (для тестов и сцен, как t2d.inf.at)
  func at(_ k: Int, _ pos: Double) -> (x: Double, y: Double) {
    let r = rings[k]
    return (cx - r.rx + 2 * r.rx * pos, r.cy)
  }
}

// ближайшая нота лада (host/scale.js): строгое <, при равенстве — нижняя
func infSnap(_ s: Double, pcs: [Int]) -> Double {
  var best = s, bd = 99.0
  var n = Int(s.rounded(.down)) - 7
  let hi = Int(s.rounded(.up)) + 7
  while n <= hi {
    defer { n += 1 }
    if n < 0 || !pcs.contains(((n % 12) + 12) % 12) { continue }
    let d = abs(Double(n) - s)
    if d < bd { bd = d; best = Double(n) }
  }
  return best
}

// высота круга в полутонах от 55 Гц (model.js semiOf)
func infSemi(_ k: Int, _ pos: Double, pcs: [Int]?) -> Double {
  var s = Double(8 - k) * Inf.span + pos * Inf.span
  if let p = pcs { s = infSnap(Horo.jsRound(s), pcs: p) }
  return s
}

private let infNotes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
func infNote(_ semi: Double) -> String {
  let m = Int(Horo.jsRound(semi)) + 33
  return "\(infNotes[((m % 12) + 12) % 12])\(Int((Double(m) / 12).rounded(.down)) - 1)"
}

struct InfCirc {
  var pos = 0.5
  var sinner = false
  var held = 0, color = 0
  var width = 0.5, drive = 0.15, level = 0.7, lvl = 0.0
}

// строки плашки круга и подписи веера (view.js)
enum InfSheet {
  static let rowKeys = ["pos", "color", "width", "drive", "level"]
  static let rowLabels = ["pitch", "noise", "width", "drive", "level"]
  static let rowCodes = [0, -1, 1, 2, 3]                          // ключ LFO ядра; color — не модулируется

  static func get(_ key: String, _ c: InfCirc) -> Double {
    switch key {
    case "pos": return c.pos
    case "color": return Double(c.color) / 4
    case "width": return c.width
    case "drive": return c.drive
    default: return c.level
    }
  }

  // Key ядра и значение: color — номер шума min(4, ⌊5v⌋)
  static func set(_ key: String, _ v: Double) -> (key: Int, value: Double) {
    switch key {
    case "pos": return (0, v)
    case "width": return (1, v)
    case "drive": return (2, v)
    case "level": return (3, v)
    default: return (4, Double(min(4, Int((v * 5).rounded(.down)))))
    }
  }

  private static func pct(_ v: Double) -> String { "\(Int(Horo.jsRound(v * 100)))%" }

  static func text(_ key: String, _ c: InfCirc, k: Int, pcs: [Int]?) -> String {
    switch key {
    case "color": return Inf.colors[max(0, min(4, c.color))]
    case "pos": return infNote(infSemi(k, c.pos, pcs: pcs))
    default: return pct(get(key, c))
    }
  }

  static func fanText(_ key: String, _ v: Double) -> String {
    if key == "structure" { return v < 1.0 / 3 ? "harmonic" : v < 2.0 / 3 ? "scale" : "metal" }
    if key == "storm" && v <= 0.01 { return "off" }
    return pct(v)
  }
}
