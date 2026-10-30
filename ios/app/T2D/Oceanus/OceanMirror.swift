import Foundation

// город зеркала: slot, id, ang (доля круга в радианах от верха), rn (доля радиуса земли), pinned, lvl, oct, path, hz, gain (core/worlds/oceanus/world.hpp)
struct City {
  var slot = 0, id = 0
  var ang = 0.0, rn = 0.0
  var pinned = false
  var lvl = 0.8, oct = 0.0, path = 0.0, hz = 0.0, gain = 0.0
}

// зеркало: fx [5] (порядок ядра: tension, damping, wind, tide, hall), luna [4] (orbit, storm, sway, to), moon (доля круга),
// форма кольца [64], число городов, затем по 10 чисел на город
struct OceanMirror {
  static let head = 75, cityN = 10, nfx = 5, nluna = 4, n = 64
  var fx = [Double](repeating: 0, count: nfx)
  var luna = [Double](repeating: 0, count: nluna)
  var moon = 0.0
  var shape = [Double](repeating: 0, count: n)
  var cities: [City] = []

  // короче шапки — пустое зеркало (мир ещё не отдал снимок)
  static func parse(_ s: ArraySlice<Double>) -> OceanMirror {
    var m = OceanMirror()
    let b = Array(s)
    guard b.count >= head else { return m }
    m.fx = Array(b[0..<nfx])
    m.luna = Array(b[nfx..<(nfx + nluna)])
    m.moon = b[nfx + nluna]
    m.shape = Array(b[(nfx + nluna + 1)..<(head - 1)])
    let cnt = min(Int(b[head - 1]), (b.count - head) / cityN)
    for k in 0..<max(0, cnt) {
      let o = head + k * cityN
      m.cities.append(City(slot: Int(b[o]), id: Int(b[o + 1]), ang: b[o + 2], rn: b[o + 3], pinned: b[o + 4] != 0,
                           lvl: b[o + 5], oct: b[o + 6], path: b[o + 7], hz: b[o + 8], gain: b[o + 9]))
    }
    return m
  }
}
