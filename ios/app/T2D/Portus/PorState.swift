import Foundation

// XIII · Portus: свои значения (правило фасада — model.js:59-91, ядро — world.cpp:80-112), удары, эхо-кольца, звезда, аудиция.
// Своё действие видно сразу и держится, пока не придёт зеркало: 0.25 с или сходимость (зеркало стало равно своему — своё снято).
// Время — секунды, аргумент. Метки времени лежат в ссылочной коробке: чтение само снимает сошедшееся и не требует mutating.
struct PorState {
  static let ttl = 0.25, auditionGap = 0.14, maxHits = 6
  private static let none = -1e9

  private struct Pair: Equatable { var u: Double, d: Double }

  private final class Stamps {
    var isle = [Double](repeating: PorState.none, count: Por.nstep)
    var luna = [Double](repeating: PorState.none, count: 3)
    var echo = [Double](repeating: PorState.none, count: 3)
    var fog = [Double](repeating: PorState.none, count: 2)
    var pharos = [Double](repeating: PorState.none, count: 5)
    var fx = [Double](repeating: PorState.none, count: 5)
    var buoy = PorState.none, bpm = PorState.none, play = PorState.none
    func clear() {
      for k in isle.indices { isle[k] = PorState.none }
      for k in luna.indices { luna[k] = PorState.none }
      for k in echo.indices { echo[k] = PorState.none }
      for k in fog.indices { fog[k] = PorState.none }
      for k in pharos.indices { pharos[k] = PorState.none }
      for k in fx.indices { fx[k] = PorState.none }
      buoy = PorState.none; bpm = PorState.none; play = PorState.none
    }
  }
  private let st = Stamps()
  private var ownIsle = [PorIsle](repeating: PorIsle(), count: Por.nstep)
  private var ownLuna = [Double](repeating: 0, count: 3)
  private var ownEcho = [Double](repeating: 0, count: 3)
  private var ownFog = [Double](repeating: 0, count: 2)
  private var ownPharos = [Double](repeating: 0, count: 5)
  private var ownFx = [Double](repeating: 0, count: 5)
  private var ownBuoy = Pair(u: 0, d: 0)
  private var ownBpm = 0.0, ownPlay = false

  // удары: время последнего по шагу, кольцо эхо-колец (до 6, старейший уходит), последний шаг
  var hitT = [Double](repeating: PorState.none, count: Por.nstep)
  var hits: [(t: Double, dt: Double, fb: Double)] = []
  var lastHit = -1, lastAt = PorState.none
  // падающая звезда
  var killAt = PorState.none, killXY = (x: 0.0, y: 0.0)
  private var auditionAt = PorState.none

  // ---------- чтение: своё, пока ≠ зеркала и свежее ----------
  private func live<T: Equatable>(_ own: T, _ mirror: T, _ t: inout Double, _ now: Double) -> T {
    guard now - t < Self.ttl else { return mirror }
    if own == mirror { t = Self.none; return mirror }
    return own
  }
  func isle(_ j: Int, mirror: PorMirror, now: Double) -> PorIsle {
    guard (0..<Por.nstep).contains(j) else { return PorIsle() }
    return live(ownIsle[j], mirror.isles[j], &st.isle[j], now)
  }
  func luna(_ k: Int, mirror: PorMirror, now: Double) -> Double {
    guard (0..<3).contains(k) else { return 0 }
    return live(ownLuna[k], mirror.luna[k], &st.luna[k], now)
  }
  func echo(_ k: Int, mirror: PorMirror, now: Double) -> Double {
    guard (0..<3).contains(k) else { return 0 }
    return live(ownEcho[k], mirror.echo[k], &st.echo[k], now)
  }
  func buoy(mirror: PorMirror, now: Double) -> (u: Double, d: Double) {
    let b = live(ownBuoy, Pair(u: mirror.buoy.u, d: mirror.buoy.d), &st.buoy, now)
    return (b.u, b.d)
  }
  func fog(_ k: Int, mirror: PorMirror, now: Double) -> Double {
    guard (0..<2).contains(k) else { return 0 }
    return live(ownFog[k], mirror.fog[k], &st.fog[k], now)
  }
  func pharos(_ k: Int, mirror: PorMirror, now: Double) -> Double {
    guard (0..<5).contains(k) else { return 0 }
    return live(ownPharos[k], mirror.pharos[k], &st.pharos[k], now)
  }
  func fx(_ k: Int, mirror: PorMirror, now: Double) -> Double {
    guard (0..<5).contains(k) else { return 0 }
    return live(ownFx[k], mirror.fx[k], &st.fx[k], now)
  }
  func bpm(mirror: PorMirror, now: Double) -> Double { live(ownBpm, mirror.bpm, &st.bpm, now) }
  func playing(mirror: PorMirror, now: Double) -> Bool { live(ownPlay, mirror.playing, &st.play, now) }

  // ---------- действия ----------
  private mutating func put(_ j: Int, _ v: PorIsle, _ now: Double) { ownIsle[j] = v; st.isle[j] = now }
  private mutating func putBuoy(_ u: Double, _ d: Double, _ now: Double) { ownBuoy = Pair(u: u, d: d); st.buoy = now }

  mutating func own(_ kind: Int, _ i: Int, _ a: [Double], mirror: PorMirror, now: Double) {
    typealias A = Por.Act
    func arg(_ k: Int, _ d: Double = 0) -> Double { k < a.count && a[k].isFinite ? a[k] : d }
    let placed = (0..<Por.nstep).contains(i)
    var cur = placed ? isle(i, mirror: mirror, now: now) : PorIsle()
    switch kind {
    case A.place:
      if placed && !cur.on { put(i, PorIsle(on: true, p: arg(0), oct: 0, lvl: 1, sd: arg(1)), now) }
    case A.sink:
      if placed && cur.on { put(i, PorIsle(), now) }
    case A.move:
      let j = Int(arg(0, Double(i)))
      if placed, cur.on, j != i, (0..<Por.nstep).contains(j), !isle(j, mirror: mirror, now: now).on {
        put(j, cur, now); put(i, PorIsle(), now)
        hitT[j] = hitT[i]; hitT[i] = Self.none
        if lastHit == i { lastHit = j }                          // луч маяка идёт за лодкой
      }
    case A.note: if placed && cur.on { cur.p = arg(0); put(i, cur, now) }
    case A.isle:
      if placed && cur.on { if Int(arg(0, 1)) == 0 { cur.oct = arg(1, 1) } else { cur.lvl = arg(1, 1) }; put(i, cur, now) }
    case A.luna: if (0..<3).contains(i) { ownLuna[i] = arg(0); st.luna[i] = now }
    case A.buoy:
      let b = porBuoy(u: arg(0, 0.5), d: arg(1, 0.45))
      putBuoy(b.u, b.d, now)
      ownEcho[0] = b.time; st.echo[0] = now
    case A.echo:
      guard (0..<4).contains(i) else { break }
      let v = arg(0)
      if i == 3 {                                               // fb: буй уходит вдаль
        let d = 0.03 + 0.92 * v
        putBuoy(porBuoyU(time: echo(0, mirror: mirror, now: now), d: d), d, now)
      } else {
        ownEcho[i] = v; st.echo[i] = now
        if i == 0 { putBuoy(porBuoyU(time: v, d: buoy(mirror: mirror, now: now).d), buoy(mirror: mirror, now: now).d, now) }
      }
    case A.fog: if (0..<2).contains(i) { ownFog[i] = arg(0); st.fog[i] = now }
    case A.pharos: if (0..<5).contains(i) { ownPharos[i] = arg(0); st.pharos[i] = now }
    case A.bpm: ownBpm = arg(0, 120); st.bpm = now
    case A.fx: if (0..<5).contains(i) { ownFx[i] = arg(0); st.fx[i] = now }
    case A.play: ownPlay = arg(0) != 0; st.play = now
    case A.clear: for j in 0..<Por.nstep { put(j, PorIsle(), now) }
    case A.dice: st.clear()                                     // ядро перебирает всё — сразу зеркало
    default: break                                              // KILL, AUDITION — только звук
    }
  }

  // свои значения пусты и звезда погасла; удары (hitT, hits, lastHit) остаются — это только картинка
  mutating func reset() { st.clear(); killAt = Self.none }

  // ---------- услышанное ядром ----------
  mutating func heard(_ step: Int, isleOn: Bool, dt: Double, fb: Double, now: Double) {
    guard isleOn, (0..<Por.nstep).contains(step) else { return }
    hitT[step] = now; lastHit = step; lastAt = now
    hits.append((t: now, dt: dt, fb: fb))
    if hits.count > Self.maxHits { hits.removeFirst(hits.count - Self.maxHits) }
  }

  // падающая звезда: эхо гаснет, кольца пропадают
  mutating func kill(x: Double, y: Double, now: Double) { killAt = now; killXY = (x, y); hits.removeAll() }

  // аудиция: часы стоят — аккорд, но не чаще раза в 0.14 с
  mutating func audition(playing: Bool, now: Double) -> Bool {
    guard !playing, now - auditionAt >= Self.auditionGap else { return false }
    auditionAt = now
    return true
  }
}
