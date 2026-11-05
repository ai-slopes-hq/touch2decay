import Foundation

// зеркало (67 чисел): fx[5] (aequalis, materia, concursus, chance, hall), run, bpm, P, F, strikes, locked,
// затем 8 колец по 7 чисел (on, under, phi, lvl, inst, len, flt) — core/worlds/horologium/world.hpp
struct HoroMirror {
  static let nfx = 5, ringN = 7, head = nfx + 6, size = head + Horo.nr * ringN   // 11, 67
  var fx = [Double](repeating: 0, count: nfx)
  var run = false, locked = false
  var bpm = 0.0, P = 0.0, F = 0.0, strikes = 0.0
  var rings: [HoroRing] = (0..<Horo.nr).map { HoroRing(n: $0 + 2) }

  init() {}
  init?(_ b: [Double], n len: Int) { if !load(b, n: len) { return nil } }
  @discardableResult mutating func load(_ b: [Double], n len: Int) -> Bool {   // пишет в готовые fx / rings — без выделений в кадре
    guard len >= HoroMirror.size, b.count >= len else { return false }
    for k in 0..<HoroMirror.nfx { fx[k] = b[k] }
    var o = HoroMirror.nfx
    run = b[o] != 0; bpm = b[o + 1]; P = b[o + 2]; F = b[o + 3]; strikes = b[o + 4]; locked = b[o + 5] != 0
    o = HoroMirror.head
    for i in 0..<Horo.nr {
      let s = o + i * HoroMirror.ringN
      rings[i].on = b[s] != 0; rings[i].under = b[s + 1] != 0; rings[i].phi = b[s + 2]; rings[i].lvl = b[s + 3]
      rings[i].inst = b[s + 4].isFinite ? min(7, max(0, Int(b[s + 4]))) : 0
      rings[i].len = b[s + 5].isNaN ? 16 : Int(min(16, max(1, b[s + 5].rounded())))   // нечисло → 16, иначе зажим 1…16
      rings[i].flt = b[s + 6].isFinite ? min(1, max(0, b[s + 6])) : 0.5               // нечисло → 0.5 (байпас), иначе зажим 0…1
    }
    return true
  }
}
