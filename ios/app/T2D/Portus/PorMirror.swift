import Foundation

// зеркало ядра (104 числа): 0 шаг (−1 — стоит), 1 playing, 2 голоса, 3 bpm, 4…6 luna, 7…9 echo (time, tone, mix),
// 10 buoy.u, 11 buoy.d, 12…13 fog, 14…18 pharos, 19…23 fx; с 24 + 5j место j: on, p, oct, lvl, sd — core/worlds/portus/world.hpp
struct PorMirror {
  var step = -1
  var playing = false
  var voices = 0
  var bpm = 120.0
  var luna = [0.42, 0.35, 0.45]
  var echo = [1, 0.45, 0.6]
  var buoy = (u: 0.35, d: 0.45)
  var fog = [0.45, 0.7]
  var pharos = [2, 0, 0.25, 0.8, 0]
  var fx = [0.25, 0, 0.25, 0.6, 1]
  var isles = [PorIsle](repeating: PorIsle(), count: Por.nstep)

  // n < 104 — зеркало ещё не готово: прежнее остаётся; не конечное число — поле не меняется
  mutating func load(_ b: [Double], n: Int) -> Bool {
    guard n >= Por.mirrorN, b.count >= Por.mirrorN else { return false }
    func num(_ v: Double, _ f: inout Double) { if v.isFinite { f = v } }
    func int(_ v: Double, _ f: inout Int) { if v.isFinite, abs(v) < 1e6 { f = Int(v) } }
    int(b[0], &step)
    if b[1].isFinite { playing = b[1] > 0.5 }
    int(b[2], &voices); num(b[3], &bpm)
    for k in 0..<3 { num(b[4 + k], &luna[k]); num(b[7 + k], &echo[k]) }
    num(b[10], &buoy.u); num(b[11], &buoy.d)
    for k in 0..<2 { num(b[12 + k], &fog[k]) }
    for k in 0..<5 { num(b[14 + k], &pharos[k]); num(b[19 + k], &fx[k]) }
    for j in 0..<Por.nstep {
      let o = Por.head + j * Por.isleN
      if b[o].isFinite { isles[j].on = b[o] > 0.5 }
      num(b[o + 1], &isles[j].p); num(b[o + 2], &isles[j].oct); num(b[o + 3], &isles[j].lvl); num(b[o + 4], &isles[j].sd)
    }
    return true
  }
}

// heard — пары [kind, шаг] подряд: kind > 0 — кораблик прозвучал; плохая пара пропущена, хвост без пары отброшен
func porHeard(_ b: [Double], n: Int, into out: inout [Int]) -> Int {
  let n = min(n, b.count)
  var added = 0, o = 0
  while o + 1 < n {
    let k = b[o], v = b[o + 1]
    o += 2
    guard k.isFinite, v.isFinite, k > 0, v >= 0, v < Double(Por.nstep) else { continue }
    out.append(Int(v)); added += 1
  }
  return added
}
