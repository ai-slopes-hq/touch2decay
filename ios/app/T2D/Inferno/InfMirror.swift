import Foundation

// зеркало ядра (81 число): time 0, iceE 1, stormSemi 2, stormPh 3, fx 4…8, круг k с 9 + 8·k:
// pos, sinner, held, color, width, drive, level, lvl — core/worlds/inferno/world.hpp
struct InfMirror {
  var time = 0.0, iceE = 0.0, stormSemi = 0.0, stormPh = 0.0
  var fx = Inf.fxDef
  var circ: [InfCirc] = (0..<Inf.nc).map { k in
    InfCirc(pos: 0.5, sinner: false, held: 0, color: Inf.color0(k), width: 0.5, drive: Inf.drive0(k), level: 0.7, lvl: 0)
  }

  // n < 81 — зеркало ещё не готово: прежнее остаётся
  mutating func load(_ b: [Double], n: Int) -> Bool {
    guard n >= Inf.mirrorN, b.count >= n else { return false }
    time = b[0]; iceE = b[1]; stormSemi = b[2]; stormPh = b[3]
    for i in 0..<5 { fx[i] = b[4 + i] }
    for k in 0..<Inf.nc {
      let o = Inf.head + k * Inf.circN
      circ[k] = InfCirc(pos: b[o], sinner: b[o + 1] > 0.5, held: Self.int(b[o + 2]), color: Self.int(b[o + 3]),
                        width: b[o + 4], drive: b[o + 5], level: b[o + 6], lvl: b[o + 7])
    }
    return true
  }

  // Int из числа зеркала; не конечное или огромное — 0 (без падения)
  private static func int(_ v: Double) -> Int { v.isFinite && abs(v) < 1e6 ? Int(v) : 0 }
}

// heard — записи [n, k × n] подряд; n ≤ 0 или выход за длину — стоп, плохой номер круга — пропуск
func infHeard(_ b: [Double], n: Int, into out: inout [Int]) -> Int {
  let n = min(n, b.count)
  var o = 0, added = 0
  while o < n {
    guard b[o].isFinite, abs(b[o]) < 1e6 else { break }
    let c = Int(b[o])
    if c <= 0 || o + 1 + c > n { break }
    for j in 0..<c {
      let v = b[o + 1 + j]
      guard v.isFinite, abs(v) < 1e6 else { continue }
      let k = Int(v)
      if k < 0 || k >= Inf.nc { continue }
      out.append(k); added += 1
    }
    o += 1 + c
  }
  return added
}
