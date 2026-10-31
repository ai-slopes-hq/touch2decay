import Foundation

// Чистое состояние Arcadia (без Core; время — параметром): слоты, ожидающие ADD/DROP, свои значения, след.
// Зачем: зеркало ядра приходит ~60/с, а действия Swift применяются позже — спека, решение 7.
struct ArcState {
  static let ttl = 0.25, trailEvery = 0.12, trailMax = 40
  private static let eps = 1e-9, vmax = Arc.vmax, nkeys = 8

  private(set) var order: [Int] = []                     // порядок добавления (живые логически)
  private var addAt = [Double?](repeating: nil, count: vmax)     // метка ожидающего ADD
  private var addU = [Double](repeating: 0, count: vmax)         // цель ожидающего ADD
  private var addV = [Double](repeating: 0, count: vmax)
  private var dropAt = [Double?](repeating: nil, count: vmax)    // метка ожидающего DROP
  private var own = [Double](repeating: 0, count: vmax * nkeys)  // свои значения слотов
  private var ownAt = [Double?](repeating: nil, count: vmax * nkeys)
  private var fxOwn = [Double](repeating: 0, count: ArcMirror.nfx)
  private var fxOwnAt = [Double?](repeating: nil, count: ArcMirror.nfx)
  // след: кольцо на слот
  private var tu = [Double](repeating: 0, count: vmax * trailMax)
  private var tv = [Double](repeating: 0, count: vmax * trailMax)
  private var tHead = [Int](repeating: 0, count: vmax)
  private var tCount = [Int](repeating: 0, count: vmax)
  private var time = 0.0, trailAt = 0.0

  init() {}

  func isAlive(_ s: Int) -> Bool { order.contains(s) }

  mutating func add(u: Double, v: Double, mirror: ArcMirror, now: Double) -> Int? {
    for s in 0..<ArcState.vmax where !isAlive(s) && addAt[s] == nil && (!mirror.slots[s].on || dropAt[s] != nil) {
      addAt[s] = now; addU[s] = u; addV[s] = v
      clearOwn(s)
      setOwn(s, key: 0, u, now: now); setOwn(s, key: 1, v, now: now)
      order.append(s)
      clearTrail(s)
      return s
    }
    return nil
  }

  mutating func addFailed(_ s: Int) {
    guard (0..<ArcState.vmax).contains(s) else { return }
    addAt[s] = nil
    order.removeAll { $0 == s }
    clearOwn(s); clearTrail(s)
  }

  mutating func drop(_ s: Int, now: Double) {
    guard (0..<ArcState.vmax).contains(s) else { return }
    dropAt[s] = now
    addAt[s] = nil
    order.removeAll { $0 == s }
    clearOwn(s); clearTrail(s)
  }

  mutating func dropAll(now: Double) -> [Int] {
    let all = order
    for s in all { drop(s, now: now) }
    return all
  }

  mutating func setOwn(_ s: Int, key: Int, _ v: Double, now: Double) {
    guard (0..<ArcState.vmax).contains(s), (0..<ArcState.nkeys).contains(key) else { return }
    own[s * ArcState.nkeys + key] = v
    ownAt[s * ArcState.nkeys + key] = now
    if addAt[s] != nil {
      if key == 0 { addU[s] = v } else if key == 1 { addV[s] = v }
    }
  }

  mutating func setOwnFx(_ i: Int, _ v: Double, now: Double) {
    guard (0..<ArcMirror.nfx).contains(i) else { return }
    fxOwn[i] = v; fxOwnAt[i] = now
  }

  func value(_ s: Int, key: Int, mirror: ArcMirror) -> Double {
    guard (0..<ArcState.vmax).contains(s), (0..<ArcState.nkeys).contains(key) else { return 0 }
    if ownAt[s * ArcState.nkeys + key] != nil { return own[s * ArcState.nkeys + key] }
    return ArcState.mirrorValue(mirror.slots[s], key)
  }

  func fx(_ i: Int, mirror: ArcMirror) -> Double {
    guard (0..<ArcMirror.nfx).contains(i) else { return 0 }
    return fxOwnAt[i] != nil ? fxOwn[i] : mirror.fx[i]
  }

  private static func mirrorValue(_ sl: ArcSlot, _ key: Int) -> Double {
    switch key {
    case 0: return sl.u
    case 1: return sl.v
    case 2: return sl.oct
    case 3: return sl.r
    case 4: return sl.fig
    case 5: return sl.mode
    case 6: return sl.sp
    default: return sl.lvl
    }
  }

  private mutating func clearOwn(_ s: Int) {
    for k in 0..<ArcState.nkeys { ownAt[s * ArcState.nkeys + k] = nil }
  }

  // Разбор очередного зеркала; возвращает слоты, пропавшие без нашего DROP (по возрастанию).
  mutating func sync(_ m: ArcMirror, now: Double) -> [Int] {
    var gone: [Int] = []
    for s in 0..<ArcState.vmax {
      let sl = m.slots[s]
      if let t = addAt[s] {
        if sl.on && abs(sl.u - addU[s]) < ArcState.eps && abs(sl.v - addV[s]) < ArcState.eps {
          addAt[s] = nil; dropAt[s] = nil                // ADD дошёл (прежний DROP — тем более)
        } else if now - t >= ArcState.ttl {
          addAt[s] = nil
          if !sl.on { order.removeAll { $0 == s }; gone.append(s); clearOwn(s); clearTrail(s) }
        }
      }
      if let t = dropAt[s], !sl.on || now - t >= ArcState.ttl { dropAt[s] = nil }
    }
    for s in 0..<ArcState.vmax where addAt[s] == nil && !gone.contains(s) {
      let sl = m.slots[s], known = order.contains(s)
      if sl.on && !known && dropAt[s] == nil {
        order.append(s)                                  // отмена / restore ядра: по возрастанию слота
      } else if !sl.on && known {
        order.removeAll { $0 == s }; gone.append(s); clearOwn(s); clearTrail(s)
      }
    }
    for s in 0..<ArcState.vmax {
      for k in 0..<ArcState.nkeys {
        let i = s * ArcState.nkeys + k
        if let t = ownAt[i], now - t >= ArcState.ttl || abs(own[i] - ArcState.mirrorValue(m.slots[s], k)) < ArcState.eps { ownAt[i] = nil }
      }
    }
    for i in 0..<ArcMirror.nfx {
      if let t = fxOwnAt[i], now - t >= ArcState.ttl || abs(fxOwn[i] - m.fx[i]) < ArcState.eps { fxOwnAt[i] = nil }
    }
    return gone.sorted()
  }

  // restored(): всё забыто, зеркало разберётся заново
  mutating func reset() {
    order = []
    for s in 0..<ArcState.vmax { addAt[s] = nil; dropAt[s] = nil; clearOwn(s); clearTrail(s) }
    for i in 0..<ArcMirror.nfx { fxOwnAt[i] = nil }
  }

  // след блуждания (model.js:200-205): отметка раз в 0.12 с, до 40 точек
  mutating func tickTrail(dt: Double, mirror: ArcMirror) {
    time += min(dt, 0.1)
    if time - trailAt <= ArcState.trailEvery { return }
    trailAt = time
    for s in 0..<ArcState.vmax {
      let sl = mirror.slots[s]
      guard isAlive(s), sl.on, value(s, key: 5, mirror: mirror) == 2 else { clearTrail(s); continue }
      let mx = ArcState.trailMax
      let idx: Int
      if tCount[s] < mx { idx = s * mx + (tHead[s] + tCount[s]) % mx; tCount[s] += 1 }
      else { idx = s * mx + tHead[s]; tHead[s] = (tHead[s] + 1) % mx }
      tu[idx] = sl.cx; tv[idx] = sl.cy
    }
  }

  func trailCount(_ s: Int) -> Int { (0..<ArcState.vmax).contains(s) ? tCount[s] : 0 }

  func trailPoint(_ s: Int, _ k: Int) -> (u: Double, v: Double) {
    let i = s * ArcState.trailMax + (tHead[s] + k) % ArcState.trailMax
    return (tu[i], tv[i])
  }

  mutating func clearTrail(_ s: Int) {
    guard (0..<ArcState.vmax).contains(s) else { return }
    tHead[s] = 0; tCount[s] = 0
  }
}
