import Foundation

// звезда зеркала: slot, id, h, u, cyc, win, mask, lvl, dr, cm, fp, ff, gain, count (core/worlds/firmamentum/world.hpp)
struct Star {
  var slot = 0, id = 0
  var h = 0.0, u = 0.0, cyc = 0.0, win = 0.0, mask = 0.0, lvl = 0.0, dr = 0.0, cm = 0.0, fp = 0.0, ff = 0.0, gain = 0.0
  var count = 0
}

// зеркало: time, comets, comet [on, a.h, a.u, b.h, b.u, t0, dur], fx [7], число звёзд, затем по 14 чисел на звезду
struct FirmMirror {
  typealias P = (h: Double, u: Double)
  static let head = 17, starN = 14, nfx = 7
  var time = 0.0
  var comets = 0
  var comet: (a: P, b: P, t0: Double, dur: Double)?
  var fx = [Double](repeating: 0, count: nfx)
  var stars: [Star] = []

  static func parse(_ b: [Double]) -> FirmMirror {
    var m = FirmMirror()
    guard b.count >= head else { return m }
    m.time = b[0]; m.comets = Int(b[1])
    if b[2] != 0 { m.comet = ((b[3], b[4]), (b[5], b[6]), b[7], b[8]) }
    m.fx = Array(b[9..<(9 + nfx)])
    let n = min(Int(b[16]), (b.count - head) / starN)
    for k in 0..<n {
      let o = head + k * starN
      m.stars.append(Star(slot: Int(b[o]), id: Int(b[o + 1]), h: b[o + 2], u: b[o + 3], cyc: b[o + 4], win: b[o + 5], mask: b[o + 6],
                          lvl: b[o + 7], dr: b[o + 8], cm: b[o + 9], fp: b[o + 10], ff: b[o + 11], gain: b[o + 12], count: Int(b[o + 13])))
    }
    return m
  }
}

// услышанное: слоты звёзд с новым пульсаретом, щелчки треска (pan, a), слоты вспышек (engine.js parseHeard)
struct Heard {
  var pulsed: [Int] = []
  var dust: [(pan: Double, a: Double)] = []
  var bolts: [Int] = []

  // записи идут подряд: np, слоты, nd, пары, nb, слоты
  static func parse(_ b: [Double]) -> [Heard] {
    var out: [Heard] = [], p = 0
    func next() -> Double? { guard p < b.count else { return nil }; p += 1; return b[p - 1] }
    while p < b.count {
      var h = Heard()
      guard let np = next() else { break }
      for _ in 0..<Int(np) { guard let v = next() else { return out }; h.pulsed.append(Int(v)) }
      guard let nd = next() else { return out }
      for _ in 0..<Int(nd) { guard let a = next(), let c = next() else { return out }; h.dust.append((a, c)) }
      guard let nb = next() else { return out }
      for _ in 0..<Int(nb) { guard let v = next() else { return out }; h.bolts.append(Int(v)) }
      out.append(h)
    }
    return out
  }
}
