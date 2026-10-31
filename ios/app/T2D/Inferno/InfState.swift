import Foundation

// Чистое состояние Inferno (без Core; время — параметром): свои значения до догона зеркала, удары, тление,
// вращение кругов и угольки. Всё предвыделено. Перенос worlds/inferno/{view,model}.js
struct InfState {
  static let ttl = 0.25, strikeTau = 0.4
  private static let eps = 1e-9, nkeys = 5

  private var ownV = [Double](repeating: 0, count: Inf.nc * nkeys)     // Key ядра: pos, width, drive, level, color
  private var ownAt = [Double?](repeating: nil, count: Inf.nc * nkeys)
  private var sinV = [Bool](repeating: false, count: Inf.nc)
  private var sinAt = [Double?](repeating: nil, count: Inf.nc)
  private var fxV = [Double](repeating: 0, count: 5)
  private var fxAt = [Double?](repeating: nil, count: 5)
  private var strikeAt = [Double?](repeating: nil, count: Inf.nc)
  private var heldN = [Int](repeating: 0, count: Inf.nc)
  private(set) var rot = [Double](repeating: 0, count: Inf.nc)
  // угольки
  private var sx = [Double](repeating: 0, count: Inf.sparkMax)
  private var sy = [Double](repeating: 0, count: Inf.sparkMax)
  private var svx = [Double](repeating: 0, count: Inf.sparkMax)
  private var svy = [Double](repeating: 0, count: Inf.sparkMax)
  private var slife = [Double](repeating: 0, count: Inf.sparkMax)
  private(set) var sparkCount = 0

  init() {}

  // MARK: поля круга
  private static func mirrorValue(_ c: InfCirc, _ key: Int) -> Double {
    switch key {
    case 0: return c.pos
    case 1: return c.width
    case 2: return c.drive
    case 3: return c.level
    default: return Double(c.color)
    }
  }

  mutating func own(_ k: Int, key: Int, _ v: Double, now: Double) {
    guard (0..<Inf.nc).contains(k), (0..<InfState.nkeys).contains(key) else { return }
    ownV[k * InfState.nkeys + key] = v; ownAt[k * InfState.nkeys + key] = now
  }

  func value(_ k: Int, key: Int, mirror: InfMirror, now: Double) -> Double {
    guard (0..<Inf.nc).contains(k), (0..<InfState.nkeys).contains(key) else { return 0 }
    let i = k * InfState.nkeys + key, mv = InfState.mirrorValue(mirror.circ[k], key)
    if let t = ownAt[i], now - t < InfState.ttl, abs(ownV[i] - mv) >= InfState.eps { return ownV[i] }
    return mv
  }

  private func sinner(_ k: Int, mirror: InfMirror, now: Double) -> Bool {
    let mv = mirror.circ[k].sinner
    if let t = sinAt[k], now - t < InfState.ttl, sinV[k] != mv { return sinV[k] }
    return mv
  }

  private func lvl(_ k: Int, mirror: InfMirror, now: Double) -> Double {
    let m = mirror.circ[k].lvl
    guard let t = strikeAt[k] else { return m }
    return max(m, exp(-max(0, now - t) / InfState.strikeTau))
  }

  // круг для картинки и плашки
  func circ(_ k: Int, mirror: InfMirror, now: Double) -> InfCirc {
    guard (0..<Inf.nc).contains(k) else { return InfCirc() }
    return InfCirc(pos: value(k, key: 0, mirror: mirror, now: now),
                   sinner: sinner(k, mirror: mirror, now: now),
                   held: heldN[k],
                   color: Int(value(k, key: 4, mirror: mirror, now: now)),
                   width: value(k, key: 1, mirror: mirror, now: now),
                   drive: value(k, key: 2, mirror: mirror, now: now),
                   level: value(k, key: 3, mirror: mirror, now: now),
                   lvl: lvl(k, mirror: mirror, now: now))
  }

  // сошедшееся своё значение отпускается (защёлка): дальше — только зеркало; звать после каждой загрузки зеркала
  mutating func sync(_ mirror: InfMirror) {
    for k in 0..<Inf.nc {
      for key in 0..<InfState.nkeys {
        let i = k * InfState.nkeys + key
        if ownAt[i] != nil, abs(ownV[i] - InfState.mirrorValue(mirror.circ[k], key)) < InfState.eps { ownAt[i] = nil }
      }
      if sinAt[k] != nil, sinV[k] == mirror.circ[k].sinner { sinAt[k] = nil }
    }
    for i in 0..<5 where fxAt[i] != nil && abs(fxV[i] - mirror.fx[i]) < InfState.eps { fxAt[i] = nil }
  }

  // MARK: грешник
  func pinResult(_ k: Int, mirror: InfMirror, now: Double) -> Bool {
    guard (0..<Inf.nc).contains(k) else { return false }
    if sinner(k, mirror: mirror, now: now) { return false }
    var n = 0
    for j in 0..<Inf.nc where sinner(j, mirror: mirror, now: now) { n += 1 }
    return n < Inf.pinMax
  }

  mutating func ownSinner(_ k: Int, _ on: Bool, now: Double) {
    guard (0..<Inf.nc).contains(k) else { return }
    sinV[k] = on; sinAt[k] = now
  }

  mutating func clearSinners(now: Double) {
    for k in 0..<Inf.nc { sinV[k] = false; sinAt[k] = now }
  }

  // MARK: веер
  mutating func ownFx(_ i: Int, _ v: Double, now: Double) {
    guard (0..<5).contains(i) else { return }
    fxV[i] = v; fxAt[i] = now
  }

  func fx(_ i: Int, mirror: InfMirror, now: Double) -> Double {
    guard (0..<5).contains(i) else { return 0 }
    if let t = fxAt[i], now - t < InfState.ttl, abs(fxV[i] - mirror.fx[i]) >= InfState.eps { return fxV[i] }
    return mirror.fx[i]
  }

  // MARK: удар и тление
  mutating func strike(_ k: Int, now: Double) {
    guard (0..<Inf.nc).contains(k) else { return }
    strikeAt[k] = now
  }

  mutating func heldAdd(_ k: Int, _ d: Int) {
    guard (0..<Inf.nc).contains(k) else { return }
    heldN[k] += d
  }
  func held(_ k: Int) -> Int { (0..<Inf.nc).contains(k) ? heldN[k] : 0 }

  func burning(_ k: Int, mirror: InfMirror, now: Double) -> Bool {
    guard (0..<Inf.nc).contains(k) else { return false }
    return sinner(k, mirror: mirror, now: now) || heldN[k] > 0
  }

  // MARK: картинка
  // круги вращаются: горящие быстрее, соседние навстречу (view.js:96)
  mutating func spin(dt: Double, mirror: InfMirror, now: Double) {
    let s = min(max(dt, 0), 0.1)
    for k in 0..<Inf.nc {
      rot[k] += s * (0.04 + 0.7 * lvl(k, mirror: mirror, now: now)) * (k % 2 == 1 ? 1 : -1)
    }
  }

  // угольки с круга: летят вверх и гаснут (view.js:35-41); порядок R: a, vx, vy
  mutating func spark(_ k: Int, _ n: Int, geo: InfGeo, R: () -> Double) {
    guard (0..<Inf.nc).contains(k) else { return }
    let r = geo.rings[k]
    var i = 0
    while i < n && sparkCount < Inf.sparkMax {
      let a = Double.pi * (0.1 + 0.8 * R())
      let vx = (R() - 0.5) * 14, vy = -28 - R() * 40
      sx[sparkCount] = geo.cx - cos(a) * r.rx; sy[sparkCount] = r.cy + sin(a) * r.ry
      svx[sparkCount] = vx; svy[sparkCount] = vy; slife[sparkCount] = 1
      sparkCount += 1; i += 1
    }
  }

  // новые угольки по уровню, движение, гашение (view.js:97-103)
  mutating func sparkTick(dt: Double, nowMs: Double, mirror: InfMirror, now: Double, geo: InfGeo, R: () -> Double) {
    let s = min(max(dt, 0), 0.1)
    for k in 0..<Inf.nc {
      let l = lvl(k, mirror: mirror, now: now)
      if l > 0.05 && R() < s * 30 * l { spark(k, 1, geo: geo, R: R) }
    }
    var i = sparkCount - 1
    while i >= 0 {
      sx[i] += (svx[i] + sin(nowMs * 0.003 + Double(i)) * 8) * s
      sy[i] += svy[i] * s
      svy[i] *= 1 - s * 0.6
      slife[i] -= s * 0.7
      if slife[i] <= 0 {                                // удалить перестановкой с последним
        let last = sparkCount - 1
        sx[i] = sx[last]; sy[i] = sy[last]; svx[i] = svx[last]; svy[i] = svy[last]; slife[i] = slife[last]
        sparkCount = last
      }
      i -= 1
    }
  }

  func sparkAt(_ i: Int) -> (x: Double, y: Double, life: Double) {
    guard (0..<sparkCount).contains(i) else { return (0, 0, 0) }
    return (sx[i], sy[i], slife[i])
  }

  // свои значения, грешники, веер, удары, тление — в ноль; вращение и угольки остаются
  mutating func reset() {
    for i in 0..<ownAt.count { ownAt[i] = nil }
    for k in 0..<Inf.nc { sinAt[k] = nil; strikeAt[k] = nil; heldN[k] = 0 }
    for i in 0..<5 { fxAt[i] = nil }
  }
}
