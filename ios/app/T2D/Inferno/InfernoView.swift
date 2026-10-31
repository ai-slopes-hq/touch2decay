import UIKit
import T2DCore

// Inferno (мир V) — касания, тление, плашки, веер, кубик (порт worlds/inferno/view.js; модель и звук — в ядре, картинка — InfDraw.swift)
final class InfernoView: World {
  static let slotN = 5

  let slot = InfernoView.slotN
  let theme = Worlds.info(InfernoView.slotN)?.theme ?? .base

  let title = "Inferno", sub = "circuli novem"
  private(set) lazy var fx: SheetSpec? = fxSpec              // веер собран раз: замыкания читают состояние вживую
  var openSheet: ((SheetSpec) -> Void)?
  var objGone: ((Int) -> Void)?
  var rowLfoOff: ((Int) -> Void)?
  // view.js:263-265
  let legend: [LegendRow] = [
    LegendRow(glyph: .tap, gesture: "tap a circle", does: "a strike rings in its resonator"),
    LegendRow(glyph: .hold, gesture: "hold a circle", does: "it smoulders while held"),
    LegendRow(glyph: .drag, gesture: "drag along a circle", does: "pitch within its zone"),
    LegendRow(glyph: .double, gesture: "double tap a circle", does: "a sinner stays, the circle burns"),
    LegendRow(glyph: .draw, gesture: "swipe down through circles", does: "a cascade into the pit"),
    LegendRow(glyph: .hold, gesture: "hold a burning circle", does: "its sheet: pitch, noise, width, drive, level · ~ — LFO"),
    LegendRow(glyph: .tap, gesture: "tap the darkness", does: "map of worlds"),
  ]

  typealias Reader = (inout [Double]) -> Int
  let core: Core
  private(set) var geo: InfGeo
  private(set) var mirror = InfMirror()
  private(set) var state = InfState()
  private let readMirror: Reader, readHeard: Reader
  private let rng: () -> Double
  private var mbuf = [Double](repeating: 0, count: 96)
  private var hbuf = [Double](repeating: 0, count: 256)
  private var hks: [Int] = []
  private(set) var now = 0.0
  let wall = InfWall()                                     // кеш стены (InfDraw.swift)
  private(set) var shot: (k: Int, pos: Double)?              // тестовый хук holdShot: круг тлеет без пальца

  // палец: ничего (none) или круг k; smoulder — тление идёт (HOLD +1 отправлен), harp — арфа, sheet — плашка открыта
  private struct Touchy {
    var circle = false
    var k = 0
    var t0 = 0.0                                           // часы тика: тление и удержание
    var x0: CGFloat = 0, y0: CGFloat = 0, x: CGFloat = 0, y: CGFloat = 0
    var smoulder = false, harp = false, sheet = false
  }
  private var holds: [ObjectIdentifier: Touchy] = [:]
  private var lastTap: (k: Int, t: Double)?

  init(core: Core, readMirror: Reader? = nil, readHeard: Reader? = nil, rng: (() -> Double)? = nil) {
    self.core = core; geo = InfGeo(W: 390, H: 844, topY: 59, safeBot: 34)
    self.readMirror = readMirror ?? { b in Int(t2d_app_mirror(Int32(InfernoView.slotN), &b, Int32(b.count))) }
    self.readHeard = readHeard ?? { b in Int(t2d_app_heard(Int32(InfernoView.slotN), &b, Int32(b.count))) }
    self.rng = rng ?? { var g = SystemRandomNumberGenerator(); return Double.random(in: 0..<1, using: &g) }
    hks.reserveCapacity(64)
  }

  func layout(W: CGFloat, H: CGFloat, topY: CGFloat, safeBot: CGFloat) { geo = InfGeo(W: Double(W), H: Double(H), topY: Double(topY), safeBot: Double(safeBot)) }
  func cornerHit(_ x: CGFloat, _ y: CGFloat) -> Bool {     // view.js:262 — вечная тьма слева внизу ведёт на карту
    hypot(Double(x) - geo.dark.x, Double(y) - geo.dark.y) < geo.dark.r
  }
  var objs: Int { Inf.nc }

  // значения для картинки и плашек: свои, пока зеркало не догнало
  func circ(_ k: Int) -> InfCirc { state.circ(k, mirror: mirror, now: now) }
  func fxValue(_ i: Int) -> Double { state.fx(i, mirror: mirror, now: now) }
  func isHeld(_ k: Int) -> Bool { shot?.k == k || holds.values.contains { $0.circle && $0.k == k } }

  // тестовый хук сцены: как палец, тлеющий на круге k в pos (без пальца)
  func holdShot(_ k: Int, pos: Double) {
    guard (0..<Inf.nc).contains(k) else { return }
    shot = (k, pos)
    core.action(Act.pos, k, [pos], touchTime: 0)
    state.own(k, key: 0, pos, now: now)
    core.action(Act.hold, k, [1], touchTime: 0)
    state.heldAdd(k, 1)
  }

  // ---------- плашки ----------
  var fxSpec: SheetSpec {
    SheetSpec(
      title: "aether", hint: "FX — tap outside to close",
      rows: Inf.fxKeys.enumerated().map { SheetRow(key: $1, label: $1, code: $0) },
      get: { [unowned self] k in fxValue(idx(k)) },
      set: { [unowned self] k, v in
        core.action(Act.fx, idx(k), [v], touchTime: 0)
        state.ownFx(idx(k), v, now: now)
      },
      text: { [unowned self] k in InfSheet.fanText(k, fxValue(idx(k))) },
      lfo: SheetLfo(obj: -1, keys: Set(Inf.fxKeys), shape: 0),
      reset: nil,
      arc: { [unowned self] in fxValue(2) })
  }
  private func idx(_ k: String) -> Int { Inf.fxKeys.firstIndex(of: k) ?? 0 }

  func circleSpec(_ k: Int) -> SheetSpec {
    SheetSpec(
      title: "\(Inf.roman[k]) · \(Inf.names[k])", hint: "circle — tap outside to close",
      rows: InfSheet.rowKeys.indices.map { SheetRow(key: InfSheet.rowKeys[$0], label: InfSheet.rowLabels[$0], code: InfSheet.rowCodes[$0]) },
      get: { [unowned self] key in InfSheet.get(key, circ(k)) },
      set: { [unowned self] key, v in
        let s = InfSheet.set(key, v)
        if key == "color" && Int(s.value) == circ(k).color { return }   // номер шума не сменился — действия нет
        core.action(Act.circ, k, [Double(s.key), s.value], touchTime: 0)
        state.own(k, key: s.key, s.value, now: now)
      },
      text: { [unowned self] key in InfSheet.text(key, circ(k), k: k, pcs: pcs) },
      lfo: SheetLfo(obj: k, keys: ["pos", "width", "drive", "level"], shape: 0),
      reset: nil, arc: nil)
  }
  private typealias Act = Inf.Act
  private(set) var pcs: [Int]?

  func scale(pcs: [Int]?, root: Int) { self.pcs = pcs }

  // ---------- действия ----------
  func dice() {
    core.action(Act.dice, 0, [], touchTime: 0)
    state.clearSinners(now: now)
  }

  func clear() {
    core.action(Act.clear, 0, [], touchTime: 0)
    state.clearSinners(now: now)
  }

  func restored() {                                        // undo: пальцы, тление, своё сброшены
    for t in holds.values where t.circle && t.smoulder { core.action(Act.hold, t.k, [-1], touchTime: 0) }
    holds.removeAll(); lastTap = nil; shot = nil
    state.reset()
  }

  func idle() { for _ in 0..<64 { if readHeard(&hbuf) <= 0 { break } } }   // слить heard без угольков: вход в мир не отыграет прошлое

  // ---------- тик ----------
  func tick(now: Double, dt: Double) {
    self.now = now
    let len = min(max(0, readMirror(&mbuf)), mbuf.count)
    if mirror.load(mbuf, n: len) { state.sync(mirror) }
    for _ in 0..<4 {                                       // записей может быть больше буфера — читаем до пустого, но не бесконечно
      let hn = min(max(0, readHeard(&hbuf)), hbuf.count)
      if hn == 0 { break }
      hks.removeAll(keepingCapacity: true)
      _ = infHeard(hbuf, n: hn, into: &hks)
      for k in hks { state.spark(k, 10, geo: geo, R: rng) }   // удар прозвучал — десять угольков
    }
    for (id, var t) in holds where t.circle {
      var ch = false
      if !t.harp && !t.smoulder && now - t.t0 > 0.16 { t.smoulder = true; hold(t.k, 1); ch = true }   // держишь — круг тлеет
      if !t.sheet && !t.harp && now - t.t0 > Touch.holdMs / 1000 && circ(t.k).sinner
          && hypot(Double(t.x - t.x0), Double(t.y - t.y0)) < Double(Touch.holdMove) {   // держишь круг с грешником — его плашка
        t.sheet = true; ch = true
        openSheet?(circleSpec(t.k))
      }
      if ch { holds[id] = t }
    }
    state.spin(dt: dt, mirror: mirror, now: now)
    state.sparkTick(dt: dt, nowMs: now * 1000, mirror: mirror, now: now, geo: geo, R: rng)
  }

  // ---------- касания (view.js:44-92) ----------
  private func stamp(_ f: Finger) -> Double { f.touchTime > 0 ? f.touchTime : now }
  private func hold(_ k: Int, _ d: Int) {
    core.action(Act.hold, k, [Double(d)], touchTime: 0)
    state.heldAdd(k, d)
  }
  private func setPos(_ k: Int, _ x: CGFloat) {
    let p = geo.posAt(k, Double(x))
    core.action(Act.pos, k, [p], touchTime: 0)
    state.own(k, key: 0, p, now: now)
  }
  private func strike(_ k: Int, _ v: Double, _ f: Finger) {
    core.action(Act.strike, k, [v], touchTime: f.touchTime)
    state.strike(k, now: now)
  }

  func down(_ f: Finger) {
    let k = geo.circleAt(Double(f.x), Double(f.y)), id = f.id
    if k < 0 { holds[id] = Touchy(); return }
    let ts = stamp(f)
    if let l = lastTap, l.k == k, (ts - l.t) * 1000 < Touch.dtapMs {   // двойной тап — грешник: круг горит сам; ещё раз — отпустить
      lastTap = nil
      let p = geo.posAt(k, Double(f.x)), on = state.pinResult(k, mirror: mirror, now: now)
      core.action(Act.pin, k, [p], touchTime: f.touchTime)
      state.ownSinner(k, on, now: now)
      if on { state.own(k, key: 0, p, now: now) }
      holds[id] = Touchy(); return
    }
    lastTap = (k, ts)
    if !circ(k).sinner { setPos(k, f.x) }
    strike(k, 1, f)
    holds[id] = Touchy(circle: true, k: k, t0: now, x0: f.x, y0: f.y, x: f.x, y: f.y)
  }

  func move(_ f: Finger) {
    guard var t = holds[f.id], t.circle else { return }
    defer { holds[f.id] = t }
    t.x = f.x; t.y = f.y
    if t.sheet { return }
    let kk = geo.circleAt(Double(f.x), Double(f.y), loose: true)
    if kk >= 0 && kk != t.k {                              // провёл сквозь круги — арфа: каждый пересечённый бьёт
      if t.smoulder { hold(t.k, -1); t.smoulder = false }
      t.harp = true; t.k = kk
      if !circ(kk).sinner { setPos(kk, f.x) }
      strike(kk, 0.8, f)
      return
    }
    if t.harp { return }
    if abs(f.x - t.x0) > 6 || t.smoulder {                 // вдоль круга — высота внутри его зоны
      if !t.smoulder { t.smoulder = true; hold(t.k, 1) }
      setPos(t.k, f.x)
    }
  }

  func up(_ f: Finger) {
    guard let t = holds.removeValue(forKey: f.id), t.circle, t.smoulder else { return }
    hold(t.k, -1)
  }

  func cancel(_ f: Finger) { up(f) }                       // система отняла палец: тление снимаем

  func draw(_ d: Draw, now: Double) { drawFrame(d, now: now) }   // рисование — InfDraw.swift
  func drawShot(_ d: Draw, now: Double) { drawFrame(d, now: now) }
}
