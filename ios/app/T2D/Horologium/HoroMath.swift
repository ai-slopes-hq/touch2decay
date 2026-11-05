import Foundation

// кольцо зеркала: n — номер (II…IX), on / under — звучит / унтертон, phi — фаза (доля оборота), lvl — громкость (core/worlds/horologium/world.hpp)
struct HoroRing {
  var n = 2, on = false, under = 0, phi = 0.0, lvl = 0.0, inst = 0, len = 16, flt = 0.5   // len — длина кольца в шагах 1…16; flt — фильтр 0…1, 0.5 = байпас
}

// константы и чистая математика Horologium (worlds/horologium/model.js, view.js): имена нот, отношение колец
enum Horo {
  static let instNames = ["kick", "blip", "click", "static", "ultra", "zap", "bit", "stutter"]   // inst 0…7, порядок Inst в ядре
  static let nr = 8                                // кольца II…IX
  static let roman = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"]
  static let notes = ["A", "A#", "B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#"]
  static let names: [([Double], String)] = [([1, 2], "diapason"), ([2, 3], "diapente"), ([3, 4], "diatessaron"), ([4, 5], "ditonus"),
    ([5, 6], "semiditonus"), ([8, 9], "tonus"), ([4, 5, 6], "trias harmonica"), ([10, 12, 15], "trias mollis"),
    ([4, 5, 6, 7], "septima naturalis"), ([3, 4, 5], "trias harmonica"), ([2, 3, 4], "diapente · diapason")]

  static func clamp(_ x: Double, _ a: Double = 0, _ b: Double = 1) -> Double { min(b, max(a, x)) }
  // Math.round в JS — половина вверх
  static func jsRound(_ x: Double) -> Double { (x + 0.5).rounded(.down) }

  // --- гнёзда: Эвклид на L шагах (model.js: euclid, rotOf, stepsOf, slotOf) ---
  static func euclid(_ j: Int, _ k: Int, _ L: Int) -> Bool { (j * k) % L < k }   // гнездо j бьёт? (k ≤ L, L ≥ 1)
  // фаза → сдвиг в шагах 0…L−1; нечисло → 0. Считаем в Double, к Int — только уже зажатое
  static func rot(_ phi: Double, _ L: Int) -> Int {
    guard phi.isFinite, L > 0 else { return 0 }
    let l = Double(L), v = fmod(fmod((phi * l + 0.5).rounded(.down), l) + l, l)
    return v.isFinite ? Int(min(l - 1, max(0, v))) : 0
  }
  static func steps(_ r: HoroRing) -> Int { r.under == 1 ? 8 : r.under == 2 ? 32 : 16 }   // шагов на оборот: шестнадцатая; унтертон ÷2 — восьмая; ×2 — тридцать вторая
  static func label(_ r: HoroRing) -> String { r.under == 1 ? "1/\(roman[r.n])" : r.under == 2 ? "\(roman[r.n])×2" : roman[r.n] }   // подпись кольца
  static func slot(_ r: HoroRing, P: Double) -> Int {
    let L = min(16, max(1, r.len)), l = Double(L)
    guard P.isFinite else { return 0 }
    let v = fmod(fmod((P * Double(steps(r))).rounded(.down), l) + Double(rot(r.phi, L)), l)
    let w = fmod(v + l, l)
    return w.isFinite ? Int(min(l - 1, max(0, w))) : 0
  }
  // длина после поворота жеста на d рад по часовой: один шаг = 2π/16
  static func lenAfter(_ len0: Int, turned d: Double) -> Int {
    let base = min(16, max(1, len0))
    guard d.isFinite else { return base }
    let dn = (d / (2 * Double.pi / 16) + 0.5).rounded(.down)
    return Int(min(16, max(1, Double(base) + min(32, max(-32, dn)))))
  }

  // жест длины: длина и, если палец ушёл за предел 1…16, новая база (len0, turn = 0) — разворот отзывается сразу
  static func lenGesture(len0: Int, turn d: Double) -> (len: Int, len0: Int, turn: Double) {
    let base = min(16, max(1, len0))
    let L = lenAfter(base, turned: d)
    guard d.isFinite else { return (L, base, 0) }
    let dn = min(32, max(-32, (d / (2 * Double.pi / 16) + 0.5).rounded(.down)))
    let raw = Double(base) + dn
    if (L == 16 && raw > 16) || (L == 1 && raw < 1) { return (L, L, 0) }
    return (L, len0, d)
  }

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

  // подпись фильтра кольца: мёртвая зона 0.47…0.53 — off; ниже lowpass 20 кГц→200 Гц, выше highpass 20 Гц→8 кГц (как в ядре)
  static func filterText(_ flt: Double) -> String {
    guard flt.isFinite, flt < 0.47 || flt > 0.53 else { return "off" }
    let f = flt < 0.5 ? 20000 * pow(0.01, (0.47 - max(0, flt)) / 0.47) : 20 * pow(400, (min(1, flt) - 0.53) / 0.47)
    let hz = Int(f.rounded())
    return "\(flt < 0.5 ? "low" : "high") \(hz >= 1000 ? String(format: "%.1f k", f / 1000) : String(hz))"
  }

  // множитель кольца: номер или 12/n под унтертоном, подтянутый к равномерной темперации на aequalis (model.js:43)
  static func mOf(_ r: HoroRing, aequalis: Double) -> Double {
    let m = r.under == 1 ? 12 / Double(r.n) : Double(r.n)
    if aequalis <= 0 { return m }
    let e = pow(2, jsRound(12 * log2(m)) / 12)
    return m * pow(e / m, aequalis)
  }

  // что звучит: отношение (a) и его имя (b); F — скорость колеса (model.js:92-103)
  static func ratio(_ rings: [HoroRing], F: Double) -> (a: String, b: String) {
    let on = rings.filter { $0.on }
    if on.isEmpty { return ("quies", "tap a ring") }
    let a = on.map { label($0) }.joined(separator: " : ")
    let ms = on.map { $0.under == 1 ? 12 / Double($0.n) : Double($0.n) }.sorted()
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
