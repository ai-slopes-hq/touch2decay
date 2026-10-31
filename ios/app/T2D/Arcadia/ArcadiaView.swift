import UIKit
import T2DCore

// Arcadia — касания и состояние: гравированная страна, странники с петлями (порт worlds/arcadia/view.js; звук и страна — в ядре)
final class ArcadiaView: World {
  static let slotN = 12
  // действия ядра (core/worlds/arcadia/world.hpp:22)
  enum Act { static let add = 0, drop = 1, move = 2, set = 3, fx = 4, land = 5, clear = 6 }

  let slot = ArcadiaView.slotN
  let theme = Worlds.info(ArcadiaView.slotN)?.theme ?? .base

  let title = "Arcadia", sub = "montes · lacus · flumina"
  private(set) lazy var fx: SheetSpec? = fxSpec            // веер собран раз: замыкания читают состояние вживую
  var openSheet: ((SheetSpec) -> Void)?
  var objGone: ((Int) -> Void)?
  var rowLfoOff: ((Int) -> Void)?
  // view.js:279-281
  let legend: [LegendRow] = [
    LegendRow(glyph: .tap, gesture: "tap the land", does: "a wanderer · its orbit scans the hills — the sound"),
    LegendRow(glyph: .up, gesture: "drag a wanderer", does: "north — higher, south — lower · the land under it — timbre"),
    LegendRow(glyph: .drag, gesture: "drag the rim of an orbit", does: "wide — rich, small — almost a sine"),
    LegendRow(glyph: .tap, gesture: "tap a wanderer", does: "it leaves"),
    LegendRow(glyph: .hold, gesture: "hold a wanderer", does: "its sheet: octave, orbit, figure, path, range, level"),
    LegendRow(glyph: .tap, gesture: "the dice", does: "a new land and new paths"),
    LegendRow(glyph: .tap, gesture: "tap the sun", does: "map of worlds"),
  ]

  typealias Reader = (inout [Double]) -> Int
  let core: Core
  var geo: ArcGeo
  private(set) var mirror = ArcMirror()
  private(set) var state = ArcState()
  private(set) var pic: ArcPic?
  private(set) var zAt: (Double, Double) -> Double = { _, _ in 0 }   // рельеф страны; до готовой ArcPic — плоский (решено без автора)
  let router: ArcPic.Router
  private(set) var pcs: [Int]?, root = 0                     // лад — для стены
  private let readMirror: Reader
  private let rng: () -> Double
  private let loader: ArcPicLoader
  private var mbuf = [Double](repeating: 0, count: 80)       // буферы кадра — выделены раз
  private var lbuf = [CGPoint](repeating: .zero, count: 49)
  private var now = 0.0
  private var haveMirror = false

  // кадр (ArcDraw.swift): стена-кеш, пути по слотам с ключом, предвыделенные буферы
  let wall = ArcWall()
  var wallQueue: DispatchQueue? = DispatchQueue.global(qos: .userInitiated)   // nil — синхронно (тесты)
  struct RouteKey: Equatable { var seed: UInt32, u: Double, v: Double, mode: Int }
  var routeKeys = [RouteKey?](repeating: nil, count: Arc.vmax)
  var routes = [[Double]](repeating: [], count: Arc.vmax)
  private(set) var routeCalls = 0
  var loopBuf = [CGPoint](repeating: .zero, count: 121)      // петля 120 точек, поднятая холмами
  var shadowBuf = [CGPoint](repeating: .zero, count: 61)     // тень на земле
  var pathBuf = [CGPoint](repeating: .zero, count: 49)       // эллипс mode 1
  var drawn: [Int] = { var a = [Int](); a.reserveCapacity(Arc.vmax); return a }()   // порядок рисования слотов (дальние первыми)
  func countRoute() { routeCalls += 1 }

  // страна: счётчики поколений отбрасывают устаревший результат
  private var loadGen = 0, diceGen = 0
  private var requested: UInt32?                             // зерно, по которому уже просили страну (без повторов)
  private var expectLand: UInt32?, expectAt = 0.0            // своё LAND послано, зеркало ещё не показало зерно

  enum Kind { case home, rim, none }
  struct Hold {
    var kind: Kind
    var slot = 0
    var x0: CGFloat = 0, y0: CGFloat = 0
    var t0 = 0.0, ts = 0.0                                 // t0 — часы тика (удержание); ts — метка касания (тап)
    var moved = false, sheet = false, fresh = false
    var seq = 0
  }
  private(set) var holds: [ObjectIdentifier: Hold] = [:]
  private var holdSeq = 0
  private let shotKey = NSObject()                           // «палец» для тестового хука holdShot

  init(core: Core, readMirror: Reader? = nil, rng: (() -> Double)? = nil, loader: ArcPicLoader? = nil, router: ArcPic.Router? = nil) {
    self.core = core; geo = ArcGeo(390, 844, 59, 34)
    self.readMirror = readMirror ?? { b in Int(t2d_app_mirror(Int32(ArcadiaView.slotN), &b, Int32(b.count))) }
    self.rng = rng ?? { var g = SystemRandomNumberGenerator(); return Double.random(in: 0..<1, using: &g) }
    self.loader = loader ?? ArcPicLoader()
    self.router = router ?? ArcPic.coreRoute
    zAt = { [unowned self] u, v in self.pic?.zAt(u, v) ?? 0 }
  }

  func layout(W: CGFloat, H: CGFloat, topY: CGFloat, safeBot: CGFloat) { geo = ArcGeo(W: Double(W), H: Double(H), topY: Double(topY), safeBot: Double(safeBot)) }
  func cornerHit(_ x: CGFloat, _ y: CGFloat) -> Bool {     // view.js:282 — солнце четвертью справа сверху ведёт на карту
    Double(y) > geo.sun.y && hypot(Double(x) - geo.sun.x, Double(y) - geo.sun.y) < geo.sun.r + 12
  }
  func scale(pcs: [Int]?, root: Int) { self.pcs = pcs; self.root = root }
  var objs: Int { state.order.count }

  // значения для картинки и плашек: свои, пока зеркало не догнало (спека, решение 7)
  func value(_ slot: Int, key: Int) -> Double { state.value(slot, key: key, mirror: mirror) }
  func fxValue(_ i: Int) -> Double { state.fx(i, mirror: mirror) }
  // запись плашек: свои значения (без отставания на кадр) + действие ядра; мёртвый слот — ничего
  func sheetSet(_ slot: Int, key: Int, _ v: Double, route: Bool) {
    guard state.isAlive(slot) else { return }
    core.action(Act.set, slot, [Double(key), v, route ? 1 : 0], touchTime: 0)
    state.setOwn(slot, key: key, v, now: now)
  }
  func sheetSetFx(_ i: Int, _ v: Double) {
    core.action(Act.fx, i, [v], touchTime: 0)
    state.setOwnFx(i, v, now: now)
  }

  // странник под пальцем: nil — не держат; true — тянут край, false — флажок. Последний палец побеждает (как held веба)
  func heldRim(_ slot: Int) -> Bool? {
    var best: Hold?
    for t in holds.values where t.kind != .none && t.slot == slot { if best == nil || t.seq > best!.seq { best = t } }
    return best.map { $0.kind == .rim }
  }
  func holdShot(_ slot: Int, rim: Bool) {                  // тестовый хук: подпись ноты / края без пальца (как host.shotSheet)
    holdSeq += 1
    holds[ObjectIdentifier(shotKey)] = Hold(kind: rim ? .rim : .home, slot: slot, seq: holdSeq)
  }

  // ---------- кубик, корзина, отмена (спека, решения 10, 11) ----------
  func dice() {
    let seed = UInt32(min(max(0, rng() * 2147483646), 2147483646))
    let n = 2 + Int(rng() * 2)
    diceGen += 1
    let g = diceGen
    loader.load(seed: seed) { [weak self] p in
      guard let self, g == self.diceGen else { return }    // повторный кубик — прежний результат отброшен
      self.applyDice(p, seed: seed, n: n)
    }
  }

  private func applyDice(_ p: ArcPic, seed: UInt32, n: Int) {
    loadGen += 1                                           // старые загрузки страны по зеркалу больше не нужны
    pic = p; requested = seed; expectLand = seed; expectAt = now
    core.action(Act.clear, 0, [], touchTime: 0)
    core.action(Act.land, 0, [Double(seed)], touchTime: 0)
    for s in state.dropAll(now: now) { objGone?(s) }
    holds.removeAll()
    for _ in 0..<n {
      var u = 0.0, v = 0.0
      for _ in 0..<20 { u = rng() * 1.6 - 0.8; v = rng() * 1.5 - 0.75; if p.lakeAt(u, v) < 0.2 { break } }
      let r = 0.08 + rng() * 0.3
      let fig = rng() < 0.6 ? 0.0 : 1 + Double(Int(rng() * 2))
      let mode = 1 + Double(Int(rng() * 4))
      let sp = 0.12 + rng() * 0.3
      let oct = rng() < 0.25 ? -1.0 : 0.0
      guard let s = state.add(u: u, v: v, mirror: mirror, now: now) else { break }
      if !core.action(Act.add, s, [u, v, oct, r, fig, mode, sp, 0.8], touchTime: 0) { state.addFailed(s); continue }
      state.setOwn(s, key: 2, oct, now: now); state.setOwn(s, key: 3, r, now: now); state.setOwn(s, key: 4, fig, now: now)
      state.setOwn(s, key: 5, mode, now: now); state.setOwn(s, key: 6, sp, now: now); state.setOwn(s, key: 7, 0.8, now: now)
    }
  }

  func clear() {
    for s in state.dropAll(now: now) { core.action(Act.drop, s, [], touchTime: 0); objGone?(s) }
    holds.removeAll()
  }

  func restored() {                                        // undo: слот ≠ прежний странник — LFO по слотам чужие, пальцы и следы сброшены
    for s in 0..<Arc.vmax { objGone?(s) }
    holds.removeAll()
    state.reset()
    diceGen += 1; loadGen += 1                             // кубик в полёте и прежняя загрузка — устарели
    requested = nil; expectLand = nil                      // страна заново по зерну зеркала, если оно сменилось
  }

  func idle() {}

  // ---------- тик ----------
  func tick(now: Double, dt: Double) {
    self.now = now
    let len = min(max(0, readMirror(&mbuf)), mbuf.count)
    if len >= ArcMirror.size, let m = ArcMirror(mbuf, n: len) { mirror = m; haveMirror = true }
    for s in state.sync(mirror, now: now) { objGone?(s) }  // пропавшие без нашего DROP (отмена): плашку закроет хост
    state.tickTrail(dt: dt, mirror: mirror)
    for (k, var t) in holds where t.kind == .home && !t.sheet && !t.moved && !t.fresh && now - t.t0 > Touch.holdMs / 1000 {
      guard state.isAlive(t.slot) else { continue }
      t.sheet = true; holds[k] = t; openSheet?(viatorSpec(t.slot))
    }
    if let e = expectLand, mirror.seed == e || now - expectAt > 1 { expectLand = nil }
    if haveMirror, expectLand == nil, pic?.seed != mirror.seed, requested != mirror.seed {
      let seed = mirror.seed
      requested = seed; loadGen += 1
      let g = loadGen
      loader.load(seed: seed) { [weak self] p in
        guard let self, g == self.loadGen else { return }
        self.pic = p
      }
    }
  }

  // ---------- касания (view.js:41-96) ----------
  private func clamp(_ x: Double, _ a: Double, _ b: Double) -> Double { min(b, max(a, x)) }
  private func stamp(_ f: Finger) -> Double { f.touchTime > 0 ? f.touchTime : now }
  private func inCorner(_ f: Finger) -> Bool { f.x0 > CGFloat(geo.W) - Touch.cornerPt && f.y0 > CGFloat(geo.H) - Touch.cornerPt }
  private func flag(_ s: Int) -> CGPoint { geo.at(zAt, value(s, key: 0), value(s, key: 1)) }
  // центр и радиус петли: из зеркала (ядро), пока нет — дом
  func loop(_ s: Int) -> (u: Double, v: Double, r: Double) {
    let m = mirror.slots[s]
    return m.on && m.rs > 0 ? (m.cx, m.cy, m.rs) : (value(s, key: 0), value(s, key: 1), value(s, key: 3))
  }

  private func homeAt(_ x: CGFloat, _ y: CGFloat) -> Int? {  // флажок: древко над точкой — две точки опроса
    var best: Int?, bd = 24.0
    for s in state.order {
      let p = flag(s)
      let d = min(hypot(Double(x - p.x), Double(y - p.y)), hypot(Double(x - p.x - 4), Double(y - p.y + 14)))
      if d < bd { bd = d; best = s }
    }
    return best
  }

  private func rimAt(_ x: CGFloat, _ y: CGFloat) -> Int? {   // край петли: тянешь — шире или уже
    for s in state.order where value(s, key: 3) >= 0.06 {
      let c = loop(s)
      let n = geo.loopPts(zAt, fig: Int(value(s, key: 4)), u: c.u, v: c.v, r: c.r, n: 48, into: &lbuf)
      for k in 0..<n where hypot(Double(x - lbuf[k].x), Double(y - lbuf[k].y)) < 12 { return s }
    }
    return nil
  }

  private func dropSlot(_ s: Int, _ f: Finger) {
    core.action(Act.drop, s, [], touchTime: f.touchTime)
    state.drop(s, now: now)
    objGone?(s)
  }

  func down(_ f: Finger) {
    if inCorner(f) { return }
    holdSeq += 1
    let seq = holdSeq, h = homeAt(f.x, f.y), rim = rimAt(f.x, f.y)
    let hd = h.map { s -> Double in let p = flag(s); return hypot(Double(f.x - p.x), Double(f.y - p.y)) } ?? 99
    if let r = rim, hd > 12 {                              // край важнее флажка, если не прямо во флажок
      holds[f.id] = Hold(kind: .rim, slot: r, x0: f.x, y0: f.y, t0: now, ts: stamp(f), seq: seq); return
    }
    if let s = h {
      holds[f.id] = Hold(kind: .home, slot: s, x0: f.x, y0: f.y, t0: now, ts: stamp(f), seq: seq); return
    }
    guard Double(f.x) > geo.fx0, Double(f.x) < geo.fx1, Double(f.y) < geo.bot, let q = geo.pick(zAt, f.x, f.y) else {
      holds[f.id] = Hold(kind: .none); return              // небо и вне поля
    }
    let u = q.u, v = clamp(q.v, -0.98, 0.98)
    guard let s = state.add(u: u, v: v, mirror: mirror, now: now) else { holds[f.id] = Hold(kind: .none); return }   // мест нет
    if !core.action(Act.add, s, [u, v, 0, 0.16, 0, 2, 0.22, 0.8], touchTime: f.touchTime) {
      state.addFailed(s); holds[f.id] = Hold(kind: .none); return
    }
    for (k, x) in [(2, 0.0), (3, 0.16), (4, 0.0), (5, 2.0), (6, 0.22), (7, 0.8)] { state.setOwn(s, key: k, x, now: now) }
    holds[f.id] = Hold(kind: .home, slot: s, x0: f.x, y0: f.y, t0: now, ts: stamp(f), fresh: true, seq: seq)   // подъём странника не убирает
  }

  func move(_ f: Finger) {
    guard var t = holds[f.id], t.kind != .none, !t.sheet, state.isAlive(t.slot) else { return }
    defer { holds[f.id] = t }
    if t.kind == .rim {
      let q = geo.unproj(f.x, f.y), c = loop(t.slot)
      let r = clamp(Arc.dist(c.u, c.v, q.u, q.v), 0.03, 0.6)
      core.action(Act.set, t.slot, [3, r, 0], touchTime: f.touchTime)
      state.setOwn(t.slot, key: 3, r, now: now)
      return
    }
    if hypot(f.x - t.x0, f.y - t.y0) > 8 { t.moved = true }
    guard t.moved else { return }
    let q = geo.pick(zAt, min(max(f.x, CGFloat(geo.fx0)), CGFloat(geo.fx1)), max(f.y, CGFloat(geo.hor) - 30)) ?? geo.unproj(f.x, CGFloat(geo.hor))
    let u = clamp(q.u, -0.98, 0.98), v = clamp(q.v, -0.98, 0.98)
    core.action(Act.move, t.slot, [u, v], touchTime: f.touchTime)
    state.setOwn(t.slot, key: 0, u, now: now); state.setOwn(t.slot, key: 1, v, now: now)
    state.clearTrail(t.slot)
  }

  func up(_ f: Finger) {
    guard let t = holds.removeValue(forKey: f.id) else { return }
    if t.kind == .home, !t.moved, !t.fresh, !t.sheet, stamp(f) - t.ts < 0.3, state.isAlive(t.slot) { dropSlot(t.slot, f) }   // тап по страннику — уходит
  }

  func cancel(_ f: Finger) { holds.removeValue(forKey: f.id) }   // система отняла палец: тап и удержание не отыгрываем

  func draw(_ d: Draw, now: Double) { drawFrame(d, now: now, shot: false) }   // рисование — ArcDraw.swift
  func drawShot(_ d: Draw, now: Double) { drawFrame(d, now: now, shot: true) }
}
