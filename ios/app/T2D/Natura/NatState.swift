import Foundation

// IV · Natura: свои значения (правило фасада — model.js:83-121), фаза, утки, лягушка (view.js:15-19, 351-389).
// Своё действие видно сразу и держится, пока не придёт зеркало: 0.25 с или сходимость (зеркало стало равно своему — своё снято).
// Время — секунды, аргумент. Метки времени лежат в ссылочной коробке: чтение само снимает сошедшееся и не требует mutating.
struct NatState {
  static let ttl = 0.25
  private static let none = -1e9

  private final class Stamps {
    var pad = [Double](repeating: NatState.none, count: Nat.npad)
    var fx = [Double](repeating: NatState.none, count: Nat.fxDef.count)
    var len = NatState.none, bpm = NatState.none, play = NatState.none
    func clear() {
      for i in pad.indices { pad[i] = NatState.none }
      for i in fx.indices { fx[i] = NatState.none }
      len = NatState.none; bpm = NatState.none; play = NatState.none
    }
  }
  private let st = Stamps()
  private var ownPad = [NatPad](repeating: NatPad(), count: Nat.npad)
  private var ownFx = [Double](repeating: 0, count: Nat.fxDef.count)
  private var ownLen = 0, ownBpm = 0.0, ownPlay = false
  private var shakeV = 0.0, shakeT = NatState.none

  var lastWave = 0
  var goneAt: Double?
  var birdsAt = -1e9
  var noteAt = [Double](repeating: -1e9, count: Nat.npad)
  var playedAt = [Double](repeating: -1e9, count: Nat.npad)
  // лягушка: frogSat — когда села (прыжок не раньше чем через 8 с), frogSeen — когда смотрели в прошлый раз
  var frogI = -1, croakAt = -1e9
  private var frogFrom: (x: Double, y: Double)?
  private var frogT0 = 0.0, frogSeen = 0.0, frogSat = 0.0

  // ---------- чтение: своё, пока ≠ зеркала и свежее ----------
  private func live<T: Equatable>(_ own: T, _ mirror: T, _ t: inout Double, _ now: Double) -> T {
    guard now - t < Self.ttl else { return mirror }
    if own == mirror { t = Self.none; return mirror }
    return own
  }
  func pad(_ i: Int, mirror: NatMirror, now: Double) -> NatPad {
    guard (0..<Nat.npad).contains(i) else { return NatPad() }
    return live(ownPad[i], mirror.pads[i], &st.pad[i], now)
  }
  func len(mirror: NatMirror, now: Double) -> Int { live(ownLen, mirror.len, &st.len, now) }
  func bpm(mirror: NatMirror, now: Double) -> Double { live(ownBpm, mirror.bpm, &st.bpm, now) }
  func playing(mirror: NatMirror, now: Double) -> Bool { live(ownPlay, mirror.playing, &st.play, now) }
  func fx(_ k: Int, mirror: NatMirror, now: Double) -> Double {
    guard (0..<Nat.fxDef.count).contains(k) else { return 0 }
    return live(ownFx[k], mirror.fx[k], &st.fx[k], now)
  }
  func shake(mirror: NatMirror, now: Double) -> Double {
    now - shakeT < Self.ttl ? shakeV * exp(-(now - shakeT) / 1.4) : mirror.shake
  }
  // 0…len+: фаза зеркала плюс доля шага с прихода кадра зеркала (mAt); nil — стоит
  func phase(mirror: NatMirror, mAt: Double, now: Double) -> Double? {
    guard playing(mirror: mirror, now: now), mirror.phase >= 0 else { return nil }
    let stepSec = 60 / bpm(mirror: mirror, now: now) / 4
    return mirror.phase + min(1, (now - mAt) / stepSec)
  }
  func envOpen(now: Double) -> Bool { goneAt.map { now - $0 < Nat.goneS } ?? false }

  // ---------- действия ----------
  private mutating func put(_ i: Int, _ p: NatPad, _ now: Double) { ownPad[i] = p; st.pad[i] = now }

  mutating func own(_ kind: Int, _ i: Int, _ a: [Double], mirror: NatMirror, now: Double) {
    typealias A = Nat.Act
    func arg(_ k: Int) -> Double { k < a.count && a[k].isFinite ? a[k] : 0 }
    let placed = (0..<Nat.npad).contains(i)
    var cur = placed ? pad(i, mirror: mirror, now: now) : NatPad()
    switch kind {
    case A.plant:
      if placed && !cur.on { put(i, NatPad(on: true, note: Int(arg(0)), wave: Int(arg(1))), now) }
    case A.remove:
      if placed && cur.on { put(i, NatPad(), now) }
    case A.move:
      let j = Int(arg(0))
      if placed, cur.on, j != i, (0..<Nat.npad).contains(j), !pad(j, mirror: mirror, now: now).on {
        put(j, cur, now); put(i, NatPad(), now)
      }
    case A.note: if placed && cur.on { cur.note = Int(arg(0)); put(i, cur, now) }
    case A.pglide: if placed && cur.on { cur.glide = arg(0) > 0.5; put(i, cur, now) }
    case A.pwave:
      if placed && cur.on { cur.wave = Int(arg(0)); lastWave = cur.wave; put(i, cur, now) }
    case A.pchance: if placed && cur.on { cur.chance = arg(0); put(i, cur, now) }
    case A.plock:
      let k = Int(arg(0))
      if placed && cur.on && (0..<4).contains(k) { cur.lock[k] = arg(1); put(i, cur, now) }
    case A.punlock:
      let k = Int(arg(0))
      if placed && cur.on {
        if k == 4 { cur.chance = -1; put(i, cur, now) } else if (0..<4).contains(k) { cur.lock[k] = -1; put(i, cur, now) }
      }
    case A.clear: for p in 0..<Nat.npad { put(p, NatPad(), now) }
    case A.len: ownLen = Int(arg(0)); st.len = now
    case A.setbpm: ownBpm = arg(0); st.bpm = now
    case A.play: ownPlay = arg(0) > 0.5; st.play = now
    case A.setfx:
      if (0..<Nat.fxDef.count).contains(i) { ownFx[i] = arg(0); st.fx[i] = now }
    case A.shakeby:
      shakeV = min(1, shake(mirror: mirror, now: now) + arg(0)); shakeT = now
    case A.scare: goneAt = now
    case A.wave: lastWave = Int(arg(0))
    case A.laser: birdsAt = now
    default: break
    }
  }

  // свои значения пусты; goneAt, lastWave, noteAt / playedAt и лягушка остаются
  mutating func reset() { st.clear(); shakeT = Self.none }

  // услышанное ядром: 2 — нота прозвучала, 1 — шаг сыгран
  mutating func heard(_ kind: Int, _ i: Int, now: Double) {
    guard (0..<Nat.npad).contains(i) else { return }
    if kind == 2 { noteAt[i] = now } else if kind == 1 { playedAt[i] = now }
  }

  // ---------- лягушка: сидит на давно молчащей кувшинке; заиграла её — изредка прыгает на самую молчаливую ----------
  // Звать ровно раз за тик (из касаний): R — случайность, расходуется только при возможном прыжке.
  mutating func frog(geo: NatGeo, pads: [NatPad], len: Int, now: Double, R: () -> Double)
    -> (x: Double, y: Double, s: Double, air: Bool, i: Int)? {
    let n = min(len, pads.count, Nat.npad)
    var count = 0
    for i in 0..<max(0, n) where pads[i].on { count += 1 }
    if count == 0 { frogI = -1; return nil }
    // самое молчаливое место, кроме ex; при равенстве — меньший индекс
    func quiet(_ ex: Int) -> Int {
      var best = -1
      for i in 0..<n where pads[i].on && i != ex && (best < 0 || playedAt[i] < playedAt[best]) { best = i }
      return best
    }
    if frogI < 0 || frogI >= n || !pads[frogI].on { frogI = quiet(-1); frogFrom = nil }
    if playedAt[frogI] > frogSeen, playedAt[frogI] <= now, count > 1, now - frogSat > 8, R() < 0.35 {
      let p0 = geo.padXY(frogI, pads[frogI].note)
      frogFrom = (p0.x, p0.y); frogT0 = now; frogSat = now + 0.7; frogI = quiet(frogI)
    }
    frogSeen = now
    let p = geo.padXY(frogI, pads[frogI].note)
    let to = (x: p.x + 4 * p.s, y: p.y - 3 * p.s, s: 0.7 + 0.5 * p.s)
    guard let from = frogFrom else { return (to.x, to.y, to.s, false, frogI) }
    let k = Nat.clamp((now - frogT0) / 0.7)
    if k >= 1 { frogFrom = nil; return (to.x, to.y, to.s, false, frogI) }
    let e = k * k * (3 - 2 * k)
    return (from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e - sin(Double.pi * e) * 20, to.s, true, frogI)
  }
}
