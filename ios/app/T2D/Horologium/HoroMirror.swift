import Foundation

// зеркало (47 чисел): fx[5] (aequalis, materia, concursus, chance, hall), run, u, uT, bpm, strip, held, P, F, strikes, locked,
// затем 8 колец по 4 числа (on, under, phi, lvl) — core/worlds/horologium/world.hpp
struct HoroMirror {
  static let nfx = 5, ringN = 4, head = nfx + 10, size = head + Horo.nr * ringN   // 15, 47
  var fx = [Double](repeating: 0, count: nfx)
  var run = false, strip = false, held = false, locked = false
  var u = 0.0, uT = 0.0, bpm = 0.0, P = 0.0, F = 0.0, strikes = 0.0
  var rings: [HoroRing] = (0..<Horo.nr).map { HoroRing(n: $0 + 2) }

  init() {}
  init?(_ b: [Double], n len: Int) {
    guard len >= HoroMirror.size, b.count >= len else { return nil }
    for k in 0..<HoroMirror.nfx { fx[k] = b[k] }
    var o = HoroMirror.nfx
    run = b[o] != 0; u = b[o + 1]; uT = b[o + 2]; bpm = b[o + 3]; strip = b[o + 4] != 0; held = b[o + 5] != 0
    P = b[o + 6]; F = b[o + 7]; strikes = b[o + 8]; locked = b[o + 9] != 0
    o = HoroMirror.head
    for i in 0..<Horo.nr {
      let s = o + i * HoroMirror.ringN
      rings[i].on = b[s] != 0; rings[i].under = b[s + 1] != 0; rings[i].phi = b[s + 2]; rings[i].lvl = b[s + 3]
    }
  }
}
