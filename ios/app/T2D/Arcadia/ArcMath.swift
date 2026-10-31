import Foundation

// Arcadia — константы и чистая математика страны (worlds/arcadia/model.js, view.js:10)
enum Arc {
  static let gx = 80, gy = 160, asp = 3.2, vmax = 4, semis = 24.0
  static let k = 2.4, q1 = 1 / (1 + k)
  static let seed0: UInt32 = 20261021
  static let tKeys = ["u", "v", "oct", "r", "fig", "mode", "sp", "lvl"]
  static let figs = ["circle", "eight", "knot"]
  static let paths = ["still", "circuit", "wander", "river", "summit"]
  static let waterRGB: (Int, Int, Int) = (46, 86, 104)
  static let notes = ["A", "A#", "B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#"]

  private static func clamp(_ x: Double, _ a: Double, _ b: Double) -> Double { min(b, max(a, x)) }

  // билинейная выборка сетки высот (model.js:21-24), прижим gx − 1.001
  static func bil(_ a: [Float], _ u: Double, _ v: Double) -> Double {
    let fx0 = clamp((u + 1) * 0.5 * Double(gx - 1), 0, Double(gx) - 1.001)
    let fy0 = clamp((v + 1) * 0.5 * Double(gy - 1), 0, Double(gy) - 1.001)
    let i = Int(fx0), j = Int(fy0), fx = fx0 - Double(i), fy = fy0 - Double(j)
    func g(_ jj: Int, _ ii: Int) -> Double { Double(a[jj * gx + ii]) }
    return (g(j, i) * (1 - fx) + g(j, i + 1) * fx) * (1 - fy) + (g(j + 1, i) * (1 - fx) + g(j + 1, i + 1) * fx) * fy
  }

  static func dist(_ u0: Double, _ v0: Double, _ u1: Double, _ v1: Double) -> Double { hypot(u1 - u0, (v1 - v0) * asp) }

  // петля: круг, восьмёрка, узел 2 : 3
  static func figPt(_ fig: Int, _ a: Double) -> (Double, Double) {
    fig == 1 ? (sin(a), 0.55 * sin(2 * a)) : fig == 2 ? (sin(2 * a), 0.8 * sin(3 * a + 0.7)) : (cos(a), sin(a))
  }

  // 0 у нижней рамки … 1 на горизонте
  static func depthOf(_ v: Double) -> Double { let q = 1 / (1 + k * (v + 1) / 2); return 1 - (q - q1) / (1 - q1) }

  // JS-round — половина вверх
  static func noteName(_ f: Double) -> String {
    let m = Int(floor(12 * log2(f / 55) + 0.5))
    return "\(notes[((m % 12) + 12) % 12])\(Int(floor(Double(m + 9) / 12.0)) + 1)"
  }
}
