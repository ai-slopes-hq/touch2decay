import Foundation

// струна зеркала: r — доля звучащей длины (1…¼), sus — поёт сама, bright / decay / level, bow — сила смычка,
// en / eh — энергия струны и флажолета, hn — номер узла флажолета (core/worlds/monochord/world.hpp)
struct MonoString {
  var r = 1.0, sus = false, bright = 0.55, decay = 0.55, level = 0.8, bow = 0.0, en = 0.0, eh = 0.0, hn = 2.0
}

// зеркало (52 числа): fx[7] (decay, bright, body, sympathy, chorus, chance, hall), wind, lastWind,
// auto[6] (on, bpm, div, pattern, strength, swing), step, затем 4 × 9 чисел струны
struct MonoMirror {
  static let n = 4, nfx = 7, nauto = 6, strN = 9, head = nfx + 2 + nauto + 1, size = head + n * strN   // 16, 52
  var fx: [Double] = [0.55, 0.55, 0.4, 0.4, 0, 1, 0.35]            // FX_DEF
  var wind = 0.0, lastWind = 0.5
  var auto: [Double] = [0, 90, 1, 1, 0.6, 0]
  var step = 0.0
  var str: [MonoString] = [1, 2.0 / 3, 0.5, 1.0 / 3].map { MonoString(r: $0) }

  init() {}
  // короче 52 — nil (мир ещё не отдал снимок)
  init?(_ b: [Double], n len: Int) {
    guard len >= MonoMirror.size, b.count >= len else { return nil }
    fx = Array(b[0..<MonoMirror.nfx])
    var o = MonoMirror.nfx
    wind = b[o]; lastWind = b[o + 1]; o += 2
    auto = Array(b[o..<(o + MonoMirror.nauto)]); o += MonoMirror.nauto
    step = b[o]; o += 1
    for i in 0..<MonoMirror.n {
      let s = o + i * MonoMirror.strN
      str[i] = MonoString(r: b[s], sus: b[s + 1] != 0, bright: b[s + 2], decay: b[s + 3], level: b[s + 4], bow: b[s + 5], en: b[s + 6], eh: b[s + 7], hn: b[s + 8])
    }
  }
}
