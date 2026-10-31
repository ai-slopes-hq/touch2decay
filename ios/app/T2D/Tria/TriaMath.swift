import CoreGraphics
import Foundation

// Tria corpora (XI): константы, геометрия, плашки и кости — worlds/tria/view.js, model.js; ядро — core/worlds/tria/world.hpp
enum Tria {
  static let slot = 11, nb = 3
  static let names = ["Sal", "Sulphur", "Mercurius"]
  static let tint: [RGB] = [(240, 234, 222), (236, 192, 84), (196, 210, 224)]   // соль — белая, сера — жёлтая, ртуть — серебро
  static let gold: RGB = (236, 204, 120)                                          // Fiat lux
  static let fxKeys = ["gravitas", "flux", "nexus", "aspectus", "decay", "hall"]  // индекс = Fx ядра
  static let trail = 180, flashMax = 30
  static let mirrorN = 47, bodyM = 12, head = 11

  enum Act { static let grab = 0, drop = 1, drag = 2, release = 3, anchor = 4, set = 5, fx = 6, lux = 7, plumb = 8, dice = 9, clear = 10 }

  // тела на окружности 0.5, первое — наверху
  static func rest(_ i: Int) -> (x: Double, y: Double) {
    let a = -Double.pi / 2 + Double(i) * 2 * Double.pi / 3
    return (cos(a) * 0.5, sin(a) * 0.5)
  }
}

// геометрия блюда (view.js:13-19); внизу — аватары трёх тел и отвес
struct TriaGeo {
  let W: Double, H: Double, top: Double, bot: Double, cx: Double, cy: Double, R: Double, Ws: Double
  let av: [(x: Double, y: Double, r: Double)]
  let plumb: (x: Double, y: Double, r: Double)
  let sun: (x: Double, y: Double, r: Double)

  init(W: Double, H: Double, topY: Double, safeBot: Double) {
    self.W = W; self.H = H
    top = topY + 6; bot = H - safeBot - 8
    Ws = min(W, (H - safeBot) * 0.62); cx = W / 2
    let cx0 = cx
    let ay = bot - 30
    cy = (top + ay - 40) / 2 + 8
    R = min(Ws / 2 - 16, (ay - 40 - top) / 2 - 18)
    let step = min(70, Ws / 4.6)
    av = [-1.5, -0.5, 0.5].map { (x: cx0 + $0 * step, y: ay, r: 19.0) }
    plumb = (cx + 1.5 * step, ay, 19)
    sun = (0, topY + 2, min(56, Ws * 0.15))
  }

  func px(_ x: Double, _ y: Double) -> CGPoint { CGPoint(x: cx + x * R, y: cy + y * R) }
  func unit(_ p: CGPoint) -> (x: Double, y: Double) { ((Double(p.x) - cx) / R, (Double(p.y) - cy) / R) }
}

// имя ноты по частоте от A1 = 55 Гц (view.js:10)
func triaNote(_ f: Double) -> String {
  let names = ["A", "A#", "B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#"]
  guard f.isFinite, f > 0 else { return "" }
  let m = Int((12 * log2(f / 55)).rounded())
  return "\(names[((m % 12) + 12) % 12])\(Int(floor(Double(m + 9) / 12)) + 1)"
}

// плашка тела и веера FX (view.js:68-77, 177-182)
enum TriaSheet {
  static func get(_ k: String, m: Double, semi: Double, level: Double, fixed: Bool) -> Double {
    switch k {
    case "m": return (m - 0.3) / 2.7
    case "semi": return (semi + 12) / 36
    case "fixed": return fixed ? 1 : 0
    default: return level
    }
  }

  // ключ SET ядра (m 0, semi 1, fixed 2, level 3) и значение в единицах тела; v — 0…1
  static func set(_ k: String, _ v: Double) -> (key: Int, value: Double) {
    switch k {
    case "m": return (0, 0.3 + 2.7 * v)
    case "semi": return (1, (36 * v).rounded() - 12)
    case "fixed": return (2, v >= 0.5 ? 1 : 0)
    default: return (3, v)
    }
  }

  static func text(_ k: String, m: Double, semi: Double, level: Double, fixed: Bool, tonic: Int) -> String {
    switch k {
    case "m": return String(format: "%.1f", m)
    case "semi": return triaNote(110 * pow(2, (semi + Double(tonic)) / 12))
    case "fixed": return fixed ? "anchored" : "free"
    default: return "\(Int((level * 100).rounded()))%"
    }
  }

  static func fanText(_ k: String, _ v: Double) -> String {
    if k == "decay" && v <= 0.005 { return "off" }
    if k == "aspectus" { return v < 0.01 ? "rim only" : v < 0.34 ? "one circle" : v < 0.67 ? "circles · 4 rays" : "circles · 8 rays" }
    return "\(Int((v * 100).rounded()))%"
  }
}

// кости (model.js:97-99): аккорд, затем на тело a, r, vx, vy, m; на выходе [x, y, vx, vy, m, semi] × 3
func triaDice(_ R: () -> Double) -> [Double] {
  let chords: [[Double]] = [[0, 7, 12], [0, 3, 7], [0, 5, 10], [-5, 0, 7], [0, 4, 11]]
  let ch = chords[min(chords.count - 1, Int(floor(R() * Double(chords.count))))]
  var o: [Double] = []
  o.reserveCapacity(18)
  for i in 0..<Tria.nb {
    let a = R() * 2 * Double.pi, r = 0.25 + R() * 0.55
    let vx = (R() - 0.5) * 1.6, vy = (R() - 0.5) * 1.6, m = 0.6 + R() * 1.2
    o += [cos(a) * r, sin(a) * r, vx, vy, m, ch[i]]
  }
  return o
}
