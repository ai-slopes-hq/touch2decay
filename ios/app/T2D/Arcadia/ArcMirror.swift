import Foundation

// зеркало (65 чисел): fx[7], seed, pending, 4 слота по 14 — core/worlds/arcadia/world.hpp
struct ArcSlot {
  var on = false
  var u = 0.0, v = 0.0, oct = 0.0, r = 0.0, fig = 0.0, mode = 0.0, sp = 0.0, lvl = 0.0
  var f = 0.0, cx = 0.0, cy = 0.0, rs = 0.0, gain = 0.0
}

struct ArcMirror {
  static let nfx = 7, head = 9, slotN = 14, size = head + Arc.vmax * slotN   // 65
  static let fxDef: [Double] = [0.3, 0.35, 0, 0.35, 0, 0.6, 0.4]            // relief pace wind chorus phaser spread hall
  var fx = ArcMirror.fxDef.map { _ in 0.0 }
  var seed: UInt32 = 0
  var pending = false
  var slots = [ArcSlot](repeating: ArcSlot(), count: Arc.vmax)

  init() { fx = ArcMirror.fxDef }
  init?(_ b: [Double], n len: Int) {
    guard len >= ArcMirror.size, b.count >= len else { return nil }
    for k in 0..<ArcMirror.nfx { fx[k] = b[k] }
    seed = UInt32(max(0, b[7])); pending = b[8] != 0
    for s in 0..<Arc.vmax {
      let o = ArcMirror.head + s * ArcMirror.slotN
      slots[s] = ArcSlot(on: b[o] != 0, u: b[o + 1], v: b[o + 2], oct: b[o + 3], r: b[o + 4], fig: b[o + 5], mode: b[o + 6],
                         sp: b[o + 7], lvl: b[o + 8], f: b[o + 9], cx: b[o + 10], cy: b[o + 11], rs: b[o + 12], gain: b[o + 13])
    }
  }
}
