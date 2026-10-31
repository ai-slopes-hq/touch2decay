import Foundation

// Чистое состояние Tria (без Core; время — параметром): рука, свои значения до догона зеркала, следы, вспышки.
// Зеркало ядра приходит ~60/с, действия применяются позже — спека, решение 7. Всё предвыделено.
struct TriaState {
  static let ttl = 0.25, trailEvery = 1.0 / 60
  private static let eps = 1e-9, nkeys = 4

  private var handOn = [Bool](repeating: false, count: Tria.nb)
  private var handX = [Double](repeating: 0, count: Tria.nb)
  private var handY = [Double](repeating: 0, count: Tria.nb)
  private var ownV = [Double](repeating: 0, count: Tria.nb * nkeys)      // свои строки тела (SET 0…3)
  private var ownAt = [Double?](repeating: nil, count: Tria.nb * nkeys)
  private var fxV = [Double](repeating: 0, count: 6)
  private var fxAt = [Double?](repeating: nil, count: 6)
  private var flS = false, flL = false, flC = false
  private var flAt: Double? = nil
  // следы: кольцо на тело
  private var tx = [Double](repeating: 0, count: Tria.nb * Tria.trail)
  private var ty = [Double](repeating: 0, count: Tria.nb * Tria.trail)
  private var tHead = [Int](repeating: 0, count: Tria.nb)
  private var tCount = [Int](repeating: 0, count: Tria.nb)
  private var acc = 0.0
  // вспышки: кольцо
  private var fRec = [TriaFlashRec](repeating: TriaFlashRec(), count: Tria.flashMax)
  private var fT = [Double](repeating: 0, count: Tria.flashMax)
  private var fHead = 0
  private(set) var flashCount = 0

  init() {}

  // MARK: рука
  mutating func hold(_ i: Int, x: Double, y: Double) {
    guard (0..<Tria.nb).contains(i) else { return }
    handOn[i] = true; handX[i] = x; handY[i] = y
  }
  mutating func letGo(_ i: Int) { if (0..<Tria.nb).contains(i) { handOn[i] = false } }
  func inHand(_ i: Int) -> Bool { (0..<Tria.nb).contains(i) && handOn[i] }
  func pos(_ i: Int, mirror: TriaMirror) -> (x: Double, y: Double) {
    guard (0..<Tria.nb).contains(i) else { return (0, 0) }
    return handOn[i] ? (handX[i], handY[i]) : (mirror.bodies[i].x, mirror.bodies[i].y)
  }

  // MARK: строки тела
  private static func mirrorValue(_ b: TriaBody, _ key: Int) -> Double {
    switch key {
    case 0: return b.m
    case 1: return b.semi
    case 2: return b.fixed ? 1 : 0
    default: return b.level
    }
  }

  mutating func own(_ i: Int, key: Int, _ v: Double, now: Double) {
    guard (0..<Tria.nb).contains(i), (0..<TriaState.nkeys).contains(key) else { return }
    ownV[i * TriaState.nkeys + key] = v; ownAt[i * TriaState.nkeys + key] = now
  }

  func body(_ i: Int, key: Int, mirror: TriaMirror, now: Double) -> Double {
    guard (0..<Tria.nb).contains(i), (0..<TriaState.nkeys).contains(key) else { return 0 }
    let k = i * TriaState.nkeys + key, mv = TriaState.mirrorValue(mirror.bodies[i], key)
    if let t = ownAt[k], now - t < TriaState.ttl, abs(ownV[k] - mv) >= TriaState.eps { return ownV[k] }
    return mv
  }

  // MARK: веер
  mutating func ownFx(_ k: Int, _ v: Double, now: Double) {
    guard (0..<6).contains(k) else { return }
    fxV[k] = v; fxAt[k] = now
  }

  func fx(_ k: Int, mirror: TriaMirror, now: Double) -> Double {
    guard (0..<6).contains(k) else { return 0 }
    if let t = fxAt[k], now - t < TriaState.ttl, abs(fxV[k] - mirror.fx[k]) >= TriaState.eps { return fxV[k] }
    return mirror.fx[k]
  }

  // MARK: флаги
  mutating func ownFlags(still: Bool, lux: Bool, cadit: Bool, now: Double) {
    flS = still; flL = lux; flC = cadit; flAt = now
  }

  func flags(mirror: TriaMirror, now: Double) -> (still: Bool, lux: Bool, cadit: Bool) {
    if let t = flAt, now - t < TriaState.ttl, !(flS == mirror.still && flL == mirror.lux && flC == mirror.cadit) {
      return (flS, flL, flC)
    }
    return (mirror.still, mirror.lux, mirror.cadit)
  }

  // Защёлка догона: свои значения, которые сошлись с зеркалом или протухли, забываются (позже зеркало вправе измениться).
  mutating func sync(_ m: TriaMirror, now: Double) {
    for i in 0..<Tria.nb {
      for key in 0..<TriaState.nkeys {
        let k = i * TriaState.nkeys + key
        if let t = ownAt[k], now - t >= TriaState.ttl || abs(ownV[k] - TriaState.mirrorValue(m.bodies[i], key)) < TriaState.eps { ownAt[k] = nil }
      }
    }
    for k in 0..<6 {
      if let t = fxAt[k], now - t >= TriaState.ttl || abs(fxV[k] - m.fx[k]) < TriaState.eps { fxAt[k] = nil }
    }
    if let t = flAt, now - t >= TriaState.ttl || (flS == m.still && flL == m.lux && flC == m.cadit) { flAt = nil }
  }

  // MARK: следы (model.js:114-117): точка раз в 1/60 с, пока не still
  mutating func trailTick(dt: Double, mirror: TriaMirror, now: Double) {
    if flags(mirror: mirror, now: now).still { acc = 0; return }
    acc += min(dt, 0.1)
    guard acc >= TriaState.trailEvery else { return }
    acc -= TriaState.trailEvery
    let mx = Tria.trail
    for i in 0..<Tria.nb {
      let idx: Int
      if tCount[i] < mx { idx = i * mx + (tHead[i] + tCount[i]) % mx; tCount[i] += 1 }
      else { idx = i * mx + tHead[i]; tHead[i] = (tHead[i] + 1) % mx }
      let p = pos(i, mirror: mirror)
      tx[idx] = p.x; ty[idx] = p.y
    }
  }

  func trailCount(_ i: Int) -> Int { (0..<Tria.nb).contains(i) ? tCount[i] : 0 }

  func trailPoint(_ i: Int, _ k: Int) -> (x: Double, y: Double) {
    guard (0..<Tria.nb).contains(i), (0..<tCount[i]).contains(k) else { return (0, 0) }
    let j = i * Tria.trail + (tHead[i] + k) % Tria.trail
    return (tx[j], ty[j])
  }

  mutating func clearTrails() {
    for i in 0..<Tria.nb { tHead[i] = 0; tCount[i] = 0 }
    acc = 0
  }

  // MARK: вспышки
  mutating func flash(_ r: TriaFlashRec, t: Double) {
    let mx = Tria.flashMax
    let idx: Int
    if flashCount < mx { idx = (fHead + flashCount) % mx; flashCount += 1 }
    else { idx = fHead; fHead = (fHead + 1) % mx }
    fRec[idx] = r; fT[idx] = t
  }

  func flashAt(_ k: Int) -> (rec: TriaFlashRec, t: Double) {
    guard (0..<flashCount).contains(k) else { return (TriaFlashRec(), 0) }
    let j = (fHead + k) % Tria.flashMax
    return (fRec[j], fT[j])
  }

  mutating func reset() {
    for i in 0..<Tria.nb { handOn[i] = false }
    for k in 0..<ownAt.count { ownAt[k] = nil }
    for k in 0..<6 { fxAt[k] = nil }
    flAt = nil
    clearTrails()
    fHead = 0; flashCount = 0
  }
}
