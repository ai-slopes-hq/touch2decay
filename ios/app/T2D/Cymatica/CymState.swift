import Foundation

// II · Cymatica: свои значения (правило фасада — worlds/cymatica/model.js:84-205), вспышки рождения (model.js:66-80),
// услышанное и созвездия (view.js:24-58). Своё действие видно сразу и держится, пока не придёт зеркало: 0.25 с или сходимость
// (зеркало стало равно своему — своё снято). Время — секунды, аргумент. Метки времени лежат в ссылочных ячейках:
// чтение само снимает сошедшееся и не требует mutating.
struct CymState {
  static let ttl = 0.25, starLife = 5.0, maxStars = 24
  private static let none = -1e9
  private static let sl = Cym.slots

  private final class Cell<T: Equatable> {
    var v: T
    var t = CymState.none
    init(_ v: T) { self.v = v }
    func put(_ v: T, _ now: Double) { self.v = v; t = now }
    func live(_ mirror: T, _ now: Double) -> T {
      guard now - t < CymState.ttl else { return mirror }
      if v == mirror { t = CymState.none; return mirror }
      return v
    }
    func clear() { t = CymState.none }
  }
  private struct XY: Equatable { var x: Double, y: Double }
  private struct SR: Equatable { var on: Bool, r: Int, m: Int }

  private let cF0 = Cell(Cym.fDef), cBpm = Cell(96.0)
  private let cFx = (0..<7).map { _ in Cell(0.0) }
  private let cPlay = Cell(false), cRec = Cell(false)
  private let cRlen = Cell(16), cMlen = Cell(7)
  private let cChance = (0..<Cym.slots).map { _ in Cell(1.0) }
  private let cMark = (0..<Cym.slots).map { _ in Cell(XY(x: 0, y: 0)) }
  private let cDriftOn = Cell(false)
  private let cDrift = (0..<3).map { _ in Cell(0.0) }
  private let cGrid = Cell(1), cCursor = Cell(-1)
  private let cStep = Cell(SR(on: false, r: 0, m: 0))
  private var cells: [() -> Void] { [cF0.clear, cBpm.clear, cPlay.clear, cRec.clear, cRlen.clear, cMlen.clear, cDriftOn.clear, cGrid.clear, cCursor.clear, cStep.clear]
      + cFx.map { $0.clear } + cChance.map { $0.clear } + cMark.map { $0.clear } + cDrift.map { $0.clear } }

  // вспышки рождения: что отправлено в прошлый раз (удар — сила или −1 выкл; место — смещение клетки или −1)
  private var sentR = [Double](repeating: -1, count: Cym.slots)
  private var sentO = [Int](repeating: -1, count: Cym.slots)
  private var primed = false
  var born = (r: [Double](repeating: CymState.none, count: Cym.slots), m: [Double](repeating: CymState.none, count: Cym.slots))
  var pulse = (r: [Double](repeating: CymState.none, count: Cym.slots), m: [Double](repeating: CymState.none, count: Cym.slots))
  var lastStep: (r: Int, m: Int, t: Double)?
  var answerAt = CymState.none, answerNote = ""
  var stars: [(x: Double, y: Double, t: Double)] = []

  init() { stars.reserveCapacity(Self.maxStars + 1) }

  private static func clampI(_ v: Int, _ a: Int, _ b: Int) -> Int { min(b, max(a, v)) }

  // ---------- чтение: своё, пока ≠ зеркала и свежее ----------
  func f0(mirror: CymMirror, now: Double) -> Double { cF0.live(mirror.f0, now) }
  func fx(_ k: Int, mirror: CymMirror, now: Double) -> Double {
    guard (0..<cFx.count).contains(k), k < mirror.fx.count else { return 0 }
    return cFx[k].live(mirror.fx[k], now)
  }
  func bpm(mirror: CymMirror, now: Double) -> Double { cBpm.live(mirror.bpm, now) }
  func playing(mirror: CymMirror, now: Double) -> Bool { cPlay.live(mirror.playing, now) }
  func rec(mirror: CymMirror, now: Double) -> Bool { cRec.live(mirror.rec, now) }
  func rlen(mirror: CymMirror, now: Double) -> Int { Self.clampI(cRlen.live(mirror.rlen, now), 1, Cym.slots) }
  func mlen(mirror: CymMirror, now: Double) -> Int { Self.clampI(cMlen.live(mirror.mlen, now), 1, Cym.slots) }
  func chance(_ i: Int, mirror: CymMirror, now: Double) -> Double {
    guard (0..<Self.sl).contains(i) else { return 1 }
    return cChance[i].live(mirror.rhythm[i].chance, now)
  }
  // место: x, y — своё, on — зеркала
  func mark(_ i: Int, mirror: CymMirror, now: Double) -> CymMark {
    guard (0..<Self.sl).contains(i) else { return CymMark() }
    let m = mirror.melody[i], p = cMark[i].live(XY(x: m.x, y: m.y), now)
    return CymMark(on: m.on, x: p.x, y: p.y)
  }
  // луна: k — всегда зеркала
  func drift(mirror: CymMirror, now: Double) -> (on: Bool, depth: Double, rate: Double, shape: Double, k: Int) {
    let d = mirror.drift
    return (cDriftOn.live(d.on, now), cDrift[0].live(d.depth, now), cDrift[1].live(d.rate, now), cDrift[2].live(d.shape, now), d.k)
  }
  func grid(mirror: CymMirror, now: Double) -> Int { Self.clampI(cGrid.live(mirror.grid, now), 1, Cym.slots) }
  func cursor(mirror: CymMirror, now: Double) -> Int { Self.clampI(cCursor.live(mirror.cursor, now), -1, Cym.slots - 1) }
  func stepRec(mirror: CymMirror, now: Double) -> (on: Bool, r: Int, m: Int) {
    let s = cStep.live(SR(on: mirror.stepRec.on, r: mirror.stepRec.r, m: mirror.stepRec.m), now)
    return (s.on, s.r, s.m)
  }

  // ---------- действия ----------
  mutating func own(_ kind: Int, _ i: Int, _ a: [Double], mirror: CymMirror, scale: CymScale, now: Double) {
    typealias A = Cym.Act
    func arg(_ k: Int, _ d: Double = 0) -> Double { k < a.count && a[k].isFinite ? a[k] : d }
    func clampD(_ x: Double, _ lo: Double, _ hi: Double) -> Double { min(hi, max(lo, x)) }
    func iarg(_ k: Int, _ d: Int = 0) -> Int { Int(clampD(Horo.jsRound(arg(k, Double(d))), -1e6, 1e6)) }
    let slot = (0..<Self.sl).contains(i)
    // как play() фасада: стоп гасит запись, пуск — запись по шагам
    func play(_ on: Bool) {
      cPlay.put(on, now)
      if !on { cRec.put(false, now) } else { cStep.put(SR(on: false, r: 0, m: 0), now) }
    }
    // высота: щипок и ступень лада — привязка к ладу, 55…880
    func applyF0(_ hz: Double) {
      let s = scale.snap(12 * log2(clampD(hz, Cym.fMin, Cym.fMax) / Cym.fMin))
      cF0.put(clampD(Cym.fMin * pow(2, s / 12), Cym.fMin, Cym.fMax), now)
    }
    switch kind {
    case A.play: play(arg(0) != 0)
    case A.rec:
      let on = arg(0) != 0
      cRec.put(on, now)
      if on && !playing(mirror: mirror, now: now) { play(true) }
    case A.stepRec:
      let on = arg(0) != 0
      cStep.put(SR(on: on, r: on ? iarg(1) : 0, m: on ? iarg(2) : 0), now)
      cCursor.put(-1, now)
    case A.cursor: cCursor.put(Self.clampI(iarg(0, -1), -1, Cym.slots - 1), now)
    case A.grid: cGrid.put(Self.clampI(iarg(0, 1), 1, Cym.slots), now)
    case A.bpm: cBpm.put(arg(0, 96), now)
    case A.len:
      if i == 0 { cRlen.put(Self.clampI(iarg(0, 16), 1, Cym.slots), now) }
      else if i == 1 { cMlen.put(Self.clampI(iarg(0, 7), 1, Cym.slots), now) }
    case A.chanceAt: if slot { cChance[i].put(arg(0, 1), now) }
    case A.moveMark: if slot { cMark[i].put(XY(x: arg(0), y: arg(1)), now) }
    case A.driftToggle: cDriftOn.put(!drift(mirror: mirror, now: now).on, now)
    case A.driftSet:
      if (0..<3).contains(i) { cDrift[i].put(arg(0), now); cDriftOn.put(true, now) }
    case A.setF0: applyF0(arg(0, Cym.fDef))
    case A.stepScale:
      let list = scale.semis()
      guard !list.isEmpty else { break }
      let j = Self.clampI(cymNearestIdx(list, arg(0)) + iarg(1), 0, list.count - 1)
      applyF0(Cym.fMin * pow(2, Double(list[j]) / 12))
    case A.setFx: if (0..<cFx.count).contains(i) { cFx[i].put(arg(0), now) }
    default: break                                              // STRIKE*, SKIP, BEAT, NUDGE, DROP_MARK, COMB, TURN, DICE, CLEAR — ядро, сразу зеркало
    }
  }

  // свои значения пусты; вспышки, пульсы, звёзды и отзыв остаются — это только картинка; следующее зеркало — новая база
  mutating func reset() {
    cells.forEach { $0() }
    rebase()
  }

  // ---------- что изменилось в узоре: вспышка рождения ----------
  mutating func rebase() { primed = false }

  // b, n, list — ступень пластины, ступеней в октаве и список нот лада (как у вида); первый вызов после rebase — только база
  mutating func diff(_ m: CymMirror, b: Int, n: Int, list: [Int], now: Double) {
    let n = max(1, n)
    for i in 0..<Self.sl {
      let r = m.rhythm[i], k = m.melody[i]
      let rv = r.on ? r.vel : -1
      let note = k.on ? cymNoteAt(k.x, k.y, b: b, n: n, list: list) : nil
      let off = k.on ? (cymCellIdx(k.x, k.y, b: 0, n: n) ?? -1) : -1
      if primed {
        if r.on && rv != sentR[i] { born.r[i] = now }
        if note != nil && off != sentO[i] { born.m[i] = now }
      }
      sentR[i] = rv; sentO[i] = off
    }
    primed = true
  }

  // ---------- услышанное ядром ----------
  mutating func heard(_ e: CymHeard, mirror: CymMirror, list: [Int], now: Double) {
    switch e {
    case .step(let r, let m, let hit):
      guard (0..<Self.sl).contains(r), (0..<Self.sl).contains(m) else { return }
      lastStep = (r, m, now)
      if mirror.rhythm[r].on && hit {
        pulse.r[r] = now
        let k = mirror.melody[m]
        if k.on { pulse.m[m] = now; starPush(k.x, k.y, now) }
      }
    case .answer(let semi):
      answerAt = now
      answerNote = Cym.noteName(Cym.fMin * pow(2, Double(semi) / 12))
    }
  }

  // ---------- созвездия: сыгранные места, фигура медленно гаснет ----------
  mutating func starPush(_ x: Double, _ y: Double, _ now: Double) {
    stars.append((x, y, now))
    if stars.count > Self.maxStars { stars.removeFirst(stars.count - Self.maxStars) }
  }
  mutating func starsAge(now: Double) {
    var k = 0
    while k < stars.count && now - stars[k].t > Self.starLife { k += 1 }
    if k > 0 { stars.removeFirst(k) }
  }
}
