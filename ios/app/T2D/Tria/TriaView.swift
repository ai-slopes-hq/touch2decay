import UIKit
import T2DCore

// Tria corpora — касания, плашки, веер, кубик (порт worlds/tria/view.js; физика и звук — в ядре, картинка — TriaDraw.swift)
final class TriaView: World {
  static let slotN = 11

  let slot = TriaView.slotN
  let theme = Worlds.info(TriaView.slotN)?.theme ?? .base

  let title = "Tria corpora", sub = "sal · sulphur · mercurius"
  private(set) lazy var fx: SheetSpec? = fxSpec              // веер собран раз: замыкания читают состояние вживую
  var openSheet: ((SheetSpec) -> Void)?
  var objGone: ((Int) -> Void)?
  var rowLfoOff: ((Int) -> Void)?
  // view.js:183-186
  let legend: [LegendRow] = [
    LegendRow(glyph: .throw, gesture: "grab a body and throw it", does: "the three pull each other — chaos"),
    LegendRow(glyph: .double, gesture: "double tap a body", does: "anchor it · again — let go"),
    LegendRow(glyph: .hold, gesture: "hold a body or tap its medallion below", does: "its sheet: mass, note, level, anchor"),
    LegendRow(glyph: .tap, gesture: "tap the sign of earth", does: "Fiat lux: the figure eight"),
    LegendRow(glyph: .tap, gesture: "tap the plumb line", does: "gravity off — all falls to the bottom · again — on"),
    LegendRow(glyph: .tap, gesture: "tap the sun", does: "map of worlds"),
  ]

  typealias Reader = (inout [Double]) -> Int
  let core: Core
  private(set) var geo: TriaGeo
  private(set) var mirror = TriaMirror()
  private(set) var state = TriaState()
  private(set) var luxAt = -1e9                              // метка Fiat lux (часы тика) — для картинки
  private(set) var tonic = 0                                 // тоника лада: ноты на плашке тела
  private let readMirror: Reader, readHeard: Reader
  private let rng: () -> Double
  private var mbuf = [Double](repeating: 0, count: 64)
  private var hbuf = [Double](repeating: 0, count: 256)
  private var recs: [TriaFlashRec] = []
  private(set) var now = 0.0
  let wall = TriaWall()                                    // кеш блюда (TriaDraw.swift)

  // палец: тело под ним (i ≥ 0) или ничего (i = −1); история ≤ 6 точек (время, x, y) для броска
  struct Hold {
    var i = -1
    var x0: CGFloat = 0, y0: CGFloat = 0
    var t0 = 0.0                                           // часы тика: удержание
    var moved = false, sheet = false
    var hist: [(t: Double, x: Double, y: Double)] = []     // метки касания: бросок
  }
  private(set) var holds: [ObjectIdentifier: Hold] = [:]
  private var lastTap: (i: Int, t: Double)?
  private var shotBody: Int?                                 // тестовый хук holdShot

  init(core: Core, readMirror: Reader? = nil, readHeard: Reader? = nil, rng: (() -> Double)? = nil) {
    self.core = core; geo = TriaGeo(W: 390, H: 844, topY: 59, safeBot: 34)
    self.readMirror = readMirror ?? { b in Int(t2d_app_mirror(Int32(TriaView.slotN), &b, Int32(b.count))) }
    self.readHeard = readHeard ?? { b in Int(t2d_app_heard(Int32(TriaView.slotN), &b, Int32(b.count))) }
    self.rng = rng ?? { var g = SystemRandomNumberGenerator(); return Double.random(in: 0..<1, using: &g) }
    recs.reserveCapacity(16)
  }

  func layout(W: CGFloat, H: CGFloat, topY: CGFloat, safeBot: CGFloat) { geo = TriaGeo(W: Double(W), H: Double(H), topY: Double(topY), safeBot: Double(safeBot)) }
  func cornerHit(_ x: CGFloat, _ y: CGFloat) -> Bool {     // view.js:187 — солнце четвертью слева сверху ведёт на карту
    Double(y) > geo.sun.y && hypot(Double(x) - geo.sun.x, Double(y) - geo.sun.y) < geo.sun.r + 6
  }
  func scale(pcs: [Int]?, root: Int) { tonic = root }
  var objs: Int { Tria.nb }

  // значения для картинки и плашек: свои, пока зеркало не догнало (спека, решение 7)
  func flags() -> (still: Bool, lux: Bool, cadit: Bool) { state.flags(mirror: mirror, now: now) }
  func bodyValue(_ i: Int, key: Int) -> Double { state.body(i, key: key, mirror: mirror, now: now) }
  func fxValue(_ k: Int) -> Double { state.fx(k, mirror: mirror, now: now) }
  func isHeld(_ i: Int) -> Bool { state.inHand(i) || shotBody == i }
  func holdShot(_ i: Int) { shotBody = i }                 // тестовый хук: подпись тела без пальца (как host.shotSheet)

  // ---------- плашки ----------
  var fxSpec: SheetSpec {
    SheetSpec(
      title: "aether", hint: "FX — tap outside to close",
      rows: Tria.fxKeys.enumerated().map { SheetRow(key: $1, label: $1, code: $0) },
      get: { [unowned self] k in fxValue(idx(k)) },
      set: { [unowned self] k, v in
        core.action(Act.fx, idx(k), [v], touchTime: 0)
        state.ownFx(idx(k), v, now: now)
      },
      text: { [unowned self] k in TriaSheet.fanText(k, fxValue(idx(k))) },
      lfo: SheetLfo(obj: -1, keys: Set(Tria.fxKeys), shape: 1),
      reset: nil,
      arc: { [unowned self] in fxValue(5) })
  }
  private func idx(_ k: String) -> Int { Tria.fxKeys.firstIndex(of: k) ?? 0 }

  func bodySpec(_ i: Int) -> SheetSpec {
    func vals() -> (m: Double, semi: Double, level: Double, fixed: Bool) {
      (bodyValue(i, key: 0), bodyValue(i, key: 1), bodyValue(i, key: 3), bodyValue(i, key: 2) >= 0.5)
    }
    return SheetSpec(
      title: Tria.names[i], hint: "body — tap outside to close",
      rows: [SheetRow(key: "m", label: "mass", code: -1), SheetRow(key: "semi", label: "note", code: -1),
             SheetRow(key: "level", label: "level", code: -1), SheetRow(key: "fixed", label: "anchor", code: -1)],
      get: { k in let b = vals(); return TriaSheet.get(k, m: b.m, semi: b.semi, level: b.level, fixed: b.fixed) },
      set: { [unowned self] k, v in
        let s = TriaSheet.set(k, v)
        core.action(Act.set, i, [Double(s.key), v], touchTime: 0)   // ядро берёт 0…1 само; свои значения — в единицах тела
        state.own(i, key: s.key, s.value, now: now)
      },
      text: { [unowned self] k in let b = vals(); return TriaSheet.text(k, m: b.m, semi: b.semi, level: b.level, fixed: b.fixed, tonic: tonic) },
      lfo: nil, reset: nil, arc: nil)
  }
  private typealias Act = Tria.Act

  // ---------- действия ----------
  // флаги — свои до зеркала (model.js:68-89)
  private func ownFlags(still: Bool? = nil, lux: Bool? = nil, cadit: Bool? = nil) {
    let f = flags()
    state.ownFlags(still: still ?? f.still, lux: lux ?? f.lux, cadit: cadit ?? f.cadit, now: now)
  }

  func lux() {                                             // восьмёрка: три равных тела по одной кривой
    core.action(Act.lux, 0, [], touchTime: 0)
    ownFlags(still: false, lux: true, cadit: false)
    luxAt = now
    state.clearTrails()
  }

  func plumb() {                                           // отвес: тяга выкл — всё падает на дно; ещё раз — тяга снова
    core.action(Act.plumb, 0, [], touchTime: 0)
    ownFlags(still: false, lux: false, cadit: !flags().cadit)
  }

  func dice() {
    core.action(Act.dice, 0, triaDice(rng), touchTime: 0)
    ownFlags(still: false, lux: false, cadit: false)
    state.clearTrails()
  }

  func clear() {
    core.action(Act.clear, 0, [], touchTime: 0)
    ownFlags(still: true, lux: false, cadit: false)
    state.clearTrails()
  }

  func restored() {                                        // undo: пальцы, следы, вспышки, свои значения сброшены; плашка тела остаётся
    for t in holds.values where t.i >= 0 && !t.sheet { core.action(Act.release, t.i, [], touchTime: 0) }   // ядро не хранит «в руке» — снимаем явно (после restore тело иначе замёрзло бы)
    holds.removeAll(); lastTap = nil; shotBody = nil
    state.reset()
  }

  func idle() { for _ in 0..<64 { if readHeard(&hbuf) <= 0 { break } } }   // слить heard без вспышек: вход в мир не отыграет прошлое

  // ---------- тик ----------
  func tick(now: Double, dt: Double) {
    self.now = now
    let len = min(max(0, readMirror(&mbuf)), mbuf.count)
    _ = mirror.load(mbuf, n: len)
    state.sync(mirror, now: now)
    for _ in 0..<4 {                                       // записей может быть больше буфера — читаем до пустого, но не бесконечно
      let hn = min(max(0, readHeard(&hbuf)), hbuf.count)
      if hn == 0 { break }
      recs.removeAll(keepingCapacity: true)
      _ = triaHeard(hbuf, n: hn, into: &recs)
      for r in recs { state.flash(r, t: now) }
    }
    state.trailTick(dt: dt, mirror: mirror, now: now)
    for (k, var t) in holds where t.i >= 0 && !t.sheet && !t.moved && now - t.t0 > Touch.holdMs / 1000 {   // держишь тело — его плашка
      t.sheet = true; holds[k] = t
      core.action(Act.drop, t.i, [], touchTime: 0)
      state.letGo(t.i)
      openSheet?(bodySpec(t.i))
    }
  }

  // ---------- касания (view.js:26-67) ----------
  private func stamp(_ f: Finger) -> Double { f.touchTime > 0 ? f.touchTime : now }
  private func bodyAt(_ x: CGFloat, _ y: CGFloat) -> Int {
    var best = -1, bd = 30.0
    for i in 0..<Tria.nb {
      let q = state.pos(i, mirror: mirror), p = geo.px(q.x, q.y)
      let d = hypot(Double(x - p.x), Double(y - p.y))
      if d < bd { bd = d; best = i }
    }
    return best
  }
  private func clamp(_ x: Double, _ a: Double, _ b: Double) -> Double { min(b, max(a, x)) }

  func down(_ f: Finger) {
    let id = f.id, fx = Double(f.x), fy = Double(f.y)
    if let a = geo.av.firstIndex(where: { hypot(fx - $0.x, fy - $0.y) < $0.r + 10 }) {   // аватар — плашка тела
      openSheet?(bodySpec(a)); holds[id] = Hold(); return
    }
    if hypot(fx - geo.plumb.x, fy - geo.plumb.y) < geo.plumb.r + 10 { plumb(); holds[id] = Hold(); return }
    let i = bodyAt(f.x, f.y), ts = stamp(f)
    if i >= 0 {
      if let l = lastTap, l.i == i, (ts - l.t) * 1000 < Touch.dtapMs {   // двойной тап — якорь
        lastTap = nil
        core.action(Act.anchor, i, [], touchTime: f.touchTime)
        state.own(i, key: 2, bodyValue(i, key: 2) >= 0.5 ? 0 : 1, now: now)
        holds[id] = Hold(); return
      }
      lastTap = (i, ts)
      core.action(Act.grab, i, [], touchTime: f.touchTime)
      ownFlags(lux: false)
      let q = state.pos(i, mirror: mirror)
      state.hold(i, x: q.x, y: q.y)
      holds[id] = Hold(i: i, x0: f.x, y0: f.y, t0: now, hist: [(ts, fx, fy)])
      return
    }
    if hypot(fx - geo.cx, fy - geo.cy) < 26 { lux() }      // знак земли — Fiat lux
    holds[id] = Hold()
  }

  func move(_ f: Finger) {
    guard var t = holds[f.id], t.i >= 0, !t.sheet else { return }
    defer { holds[f.id] = t }
    if hypot(f.x - t.x0, f.y - t.y0) > 8 { t.moved = true }
    guard t.moved else { return }
    let x = (Double(f.x) - geo.cx) / geo.R, y = (Double(f.y) - geo.cy) / geo.R
    let r = hypot(x, y), k = r > 0.95 ? 0.95 / r : 1
    t.hist.append((stamp(f), Double(f.x), Double(f.y)))
    if t.hist.count > 6 { t.hist.removeFirst() }
    core.action(Act.drag, t.i, [x * k, y * k], touchTime: f.touchTime)
    state.hold(t.i, x: x * k, y: y * k)
    ownFlags(still: false)
  }

  func up(_ f: Finger) {
    guard let t = holds.removeValue(forKey: f.id), t.i >= 0 else { return }
    var v: [Double] = []
    if t.moved, let a = t.hist.first, let z = t.hist.last {  // бросок: скорость пальца по истории (последний сдвиг, не подъём — как веб)
      let dtm = max(16, (z.t - a.t) * 1000), R = geo.R
      v = [clamp((z.x - a.x) / R / dtm * 1000 * 0.5, -3, 3), clamp((z.y - a.y) / R / dtm * 1000 * 0.5, -3, 3)]
    }
    core.action(Act.release, t.i, v, touchTime: f.touchTime)
    state.letGo(t.i)
    if !v.isEmpty { ownFlags(still: false) }
  }

  func cancel(_ f: Finger) {                               // система отняла палец: тело отпускаем без броска, тап и плашку не отыгрываем
    guard let t = holds.removeValue(forKey: f.id), t.i >= 0 else { return }
    core.action(Act.release, t.i, [], touchTime: f.touchTime)
    state.letGo(t.i)
    if lastTap?.i == t.i { lastTap = nil }                 // тап сразу после отмены — не двойной
  }

  func draw(_ d: Draw, now: Double) { drawFrame(d, now: now, sun: true) }   // рисование — TriaDraw.swift
  func drawShot(_ d: Draw, now: Double) { drawFrame(d, now: now, sun: false) }
}
