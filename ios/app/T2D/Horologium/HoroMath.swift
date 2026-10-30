import Foundation

// кольцо зеркала: n — номер (II…IX), on / under — звучит / унтертон, phi — фаза (доля оборота), lvl — громкость (core/worlds/horologium/world.hpp)
struct HoroRing {
  var n = 2, on = false, under = false, phi = 0.0, lvl = 0.0
}

// константы и чистая математика Horologium (worlds/horologium/model.js, view.js): шкала скорости, имена нот, отношение колец
enum Horo {
  static let nr = 8, z = 4.0                       // кольца II…IX; спуск: четыре прохода маятника за оборот
  static let et = 0.0447, om0 = 2 * Double.pi * 0.8   // энергия маятника на темпе (размах 0.3 рад); его собственная частота
  static let flo = 0.05, fhi = 120.0               // шкала tempus: обороты в секунду, логарифмически
  static let roman = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"]
  static let notes = ["A", "A#", "B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#"]
  static let names: [([Double], String)] = [([1, 2], "diapason"), ([2, 3], "diapente"), ([3, 4], "diatessaron"), ([4, 5], "ditonus"),
    ([5, 6], "semiditonus"), ([8, 9], "tonus"), ([4, 5, 6], "trias harmonica"), ([10, 12, 15], "trias mollis"),
    ([4, 5, 6, 7], "septima naturalis"), ([3, 4, 5], "trias harmonica"), ([2, 3, 4], "diapente · diapason")]

  static func clamp(_ x: Double, _ a: Double = 0, _ b: Double = 1) -> Double { min(b, max(a, x)) }
  // Math.round в JS — половина вверх
  static func jsRound(_ x: Double) -> Double { (x + 0.5).rounded(.down) }

  static func uOfE(_ e: Double) -> Double { clamp(0.9 * log2(e / et), -3, 8) }
  static func eOfU(_ u: Double) -> Double { et * pow(2, u / 0.9) }

  static func noteName(_ f: Double) -> String {
    let m = Int(jsRound(12 * log2(f / 55)))
    let o = Int(((Double(m + 9)) / 12).rounded(.down)) + 1
    return "\(notes[((m % 12) + 12) % 12])\(o)"
  }

  // как +x.toFixed(2): 2.4, 1.71, 4
  static func num2(_ x: Double) -> String {
    let v = Double(String(format: "%.2f", x)) ?? x
    return v == v.rounded() ? String(Int(v)) : "\(v)"
  }

  // множитель кольца: номер или 12/n под унтертоном, подтянутый к равномерной темперации на aequalis (model.js:43)
  static func mOf(_ r: HoroRing, aequalis: Double) -> Double {
    let m = r.under ? 12 / Double(r.n) : Double(r.n)
    if aequalis <= 0 { return m }
    let e = pow(2, jsRound(12 * log2(m)) / 12)
    return m * pow(e / m, aequalis)
  }

  // что звучит: отношение (a) и его имя (b); F — скорость колеса (model.js:92-103)
  static func ratio(_ rings: [HoroRing], F: Double) -> (a: String, b: String) {
    let on = rings.filter { $0.on }
    if on.isEmpty { return ("quies", "tap a ring") }
    let a = on.map { $0.under ? "1/\(roman[$0.n])" : roman[$0.n] }.joined(separator: " : ")
    let ms = on.map { $0.under ? 12 / Double($0.n) : Double($0.n) }.sorted()
    var name = ""
    for (set, nm) in names where set.count == ms.count && set.indices.allSatisfy({ abs(set[$0] / set[0] - ms[$0] / ms[0]) < 1e-6 }) { name = nm; break }
    let tail = name.isEmpty ? "" : " — \(name)"
    if F * ms[0] >= 20 {
      return (a, "tonus\(tail) · \(ms.map { noteName($0 * F) }.joined(separator: " "))")
    }
    let dot = name.isEmpty ? "" : " · \(name)"
    return (a, "rhythmus · \(ms.map { num2($0) }.joined(separator: " · ")) ictus in circuitu\(dot)")
  }
}
