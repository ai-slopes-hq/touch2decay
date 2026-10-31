import Foundation

struct NatPad: Equatable {
  var on = false
  var note = 0, wave = 0
  var glide = false
  var chance = -1.0                                   // −1 — не задан (= 1)
  var lock = SIMD4<Double>(repeating: -1)             // cutoff, res, att, rel; −1 — замка нет
  var chanceV: Double { chance < 0 ? 1 : chance }
}

// зеркало ядра (160 чисел): 0 фаза (−1 — стоит), 1 playing, 2 голоса, 3 челноки, 4 bpm, 5 len, 6 shake, 7…15 fx,
// место i с 16 + 9i: on, note, wave, glide, chance, cutoff, res, att, rel — core/worlds/natura/world.hpp
struct NatMirror {
  var phase = -1.0
  var playing = false
  var voices = 0, skiffs = 0
  var bpm = Nat.bpm0
  var len = Nat.len0
  var shake = 0.0
  var fx = Nat.fxDef
  var pads: [NatPad] = {
    var p = [NatPad](repeating: NatPad(), count: Nat.npad)
    for d in Nat.demo { p[d.i] = NatPad(on: true, note: d.note, wave: d.wave) }
    return p
  }()

  // n < 160 — зеркало ещё не готово: прежнее остаётся; не конечное число — поле не меняется
  mutating func load(_ b: [Double], n: Int) -> Bool {
    guard n >= Nat.mirrorN, b.count >= Nat.mirrorN else { return false }
    func num(_ v: Double, _ f: inout Double) { if v.isFinite { f = v } }
    func int(_ v: Double, _ f: inout Int) { if v.isFinite, abs(v) < 1e6 { f = Int(v) } }
    num(b[0], &phase)
    if b[1].isFinite { playing = b[1] > 0.5 }
    int(b[2], &voices); int(b[3], &skiffs)
    num(b[4], &bpm); int(b[5], &len); num(b[6], &shake)
    for k in 0..<Nat.fxDef.count { num(b[7 + k], &fx[k]) }
    for i in 0..<Nat.npad {
      let o = Nat.head + i * Nat.padN
      if b[o].isFinite { pads[i].on = b[o] > 0.5 }
      int(b[o + 1], &pads[i].note); int(b[o + 2], &pads[i].wave)
      if b[o + 3].isFinite { pads[i].glide = b[o + 3] > 0.5 }
      num(b[o + 4], &pads[i].chance)
      for k in 0..<4 where b[o + 5 + k].isFinite { pads[i].lock[k] = b[o + 5 + k] }
    }
    return true
  }
}

// heard — пары [kind, место] подряд: 2 — нота прозвучала, 1 — шаг сыгран; плохая пара пропущена, хвост без пары отброшен
func natHeard(_ b: [Double], n: Int, into out: inout [(kind: Int, i: Int)]) -> Int {
  let n = min(n, b.count)
  var added = 0, o = 0
  while o + 1 < n {
    let k = b[o], v = b[o + 1]
    o += 2
    guard k.isFinite, v.isFinite, abs(k) < 1e6, abs(v) < 1e6 else { continue }
    let kind = Int(k), i = Int(v)
    guard kind == 1 || kind == 2, (0..<Nat.npad).contains(i) else { continue }
    out.append((kind, i)); added += 1
  }
  return added
}
