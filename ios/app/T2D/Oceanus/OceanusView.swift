import UIKit
import T2DCore

// рябь на воде: точка касания, сила (1 — тап, 0.5 — конец протяжки), время рождения (view.js:164)
struct Ripple { var x, y: CGFloat; var k: Double; var t0: Double }
// что нужно рисованию помимо зеркала: рябь, палец на поле (подписи), удерживаемый город
struct OceanUI { var ripples: [Ripple]; var touching: Bool; var heldCity: Int? }

// Oceanus — касания и состояние: карта T-O и Мировой океан (порт worlds/oceanus/view.js; модель и звук — в ядре)
final class OceanusView: World {
  static let slotN = 8, vmax = 6, pinMax = 4
  let slot = OceanusView.slotN
  let theme = Worlds.info(OceanusView.slotN)?.theme ?? .base

  let title = "Oceanus", sub = "orbis terrarum"
  private(set) lazy var fx: SheetSpec? = fxSpec            // плашка собрана раз: замыкания читают зеркало вживую
  var openSheet: ((SheetSpec) -> Void)?
  var objGone: ((Int) -> Void)?
  // view.js:259-262
  let legend: [LegendRow] = [
    LegendRow(glyph: .tap, gesture: "touch the land", does: "a city sings while you hold it"),
    LegendRow(glyph: .double, gesture: "double tap the land", does: "the city stays (up to four)"),
    LegendRow(glyph: .drag, gesture: "drag a city", does: "pitch · clockwise — semitones, inland — octave up"),
    LegendRow(glyph: .hold, gesture: "hold a staying city", does: "its sheet: level, octave"),
    LegendRow(glyph: .drag, gesture: "touch the ocean", does: "pull the water · waves run round — the timbre lives"),
    LegendRow(glyph: .tap, gesture: "quick tap on the water", does: "splash"),
    LegendRow(glyph: .hold, gesture: "hold the moon", does: "its sheet: orbit, shape, pull, sway — the moon as an LFO"),
    LegendRow(glyph: .tap, gesture: "tap the sun", does: "map of worlds"),
  ]

  var geo: OceanGeo
  private(set) var mirror = OceanMirror()                   // зеркало ядра, но с городами как их видит рука: правленные — по-своему, убранные скрыты
  private var raw = OceanMirror()
  let core: Core
  typealias Reader = (inout [Double]) -> Int
  private let readMirror: Reader
  private var mbuf = [Double](repeating: 0, count: 256), mprev = [Double](repeating: 0, count: 256)   // буферы кадра — выделены раз
  private var mlen = 0, mprevLen = -1                      // -1: разбирать всегда (первый кадр)
  private var prevIds: Set<Int> = []                       // id всех городов прошлого разбора
  private var prevPinned: Set<Int>?                        // id оставленных (nil — первый разбор)
  private var local: [Int: City] = [:]                     // города, добавленные или правленные здесь: зеркало их ещё не догнало (model.js dirty)
  private var gone: Set<Int> = []                          // убранные здесь, зеркало ещё со старым (model.js gone)
  private var issued = 0                                   // наибольший выданный Swift id
  private var fingerSeq = 0                                // номер пальца в воде для PUSH / RELEASE
  private var now = 0.0
  private(set) var ripples: [Ripple] = []

  private enum Kind { case moon, city, water, none }
  private struct Hold { var kind: Kind; var id = 0; var temp = false; var x0: CGFloat = 0, y0: CGFloat = 0, moved = false, sheet = false; var t0 = 0.0, fid = 0 }
  private var holds: [ObjectIdentifier: Hold] = [:]
  private var lastTap: (id: Int?, x: CGFloat, y: CGFloat, t: Double)?

  init(core: Core, geo: OceanGeo, readMirror: @escaping Reader) {
    self.core = core; self.geo = geo; self.readMirror = readMirror
  }

  var ui: OceanUI {
    let cs = holds.values.filter { $0.kind == .city }
    return OceanUI(ripples: ripples, touching: holds.values.contains { $0.kind == .water || $0.kind == .city }, heldCity: cs.first?.id)
  }
  var objs: Int { mirror.cities.count }

  func layout(W: CGFloat, H: CGFloat, topY: CGFloat, safeBot: CGFloat) { geo = OceanGeo(W: W, H: H, topY: topY, safeBot: safeBot) }
  func cornerHit(_ x: CGFloat, _ y: CGFloat) -> Bool {     // view.js:261 — солнце вверху слева
    y > geo.sun.y && hypot(x - geo.sun.x, y - geo.sun.y) < geo.sun.r + 6
  }
  func enter() { core.action(11, 0, [], touchTime: 0) }    // WAKE: без него кольцо спит до первого города или касания
  func dice() {
    gone.formUnion(mirror.cities.map(\.id)); local.removeAll(); rebuild()   // кубик заменяет города: старые скрыты, пока зеркало не обновится
    core.action(10, 0, [], touchTime: 0)
  }
  func clear() {
    gone.formUnion(mirror.cities.map(\.id)); local.removeAll(); rebuild()
    core.action(9, 0, [], touchTime: 0)
  }
  // prevIds остаётся: города, снятые откатом, дадут objGone на следующем разборе
  func restored() { holds.removeAll(); ripples.removeAll(); local.removeAll(); gone.removeAll(); lastTap = nil; rebuild() }

  func tick(now: Double, dt: Double) {
    self.now = now
    mlen = min(max(0, readMirror(&mbuf)), mbuf.count)
    if mlen != mprevLen || !mbuf[0..<mlen].elementsEqual(mprev[0..<mlen]) {   // снимок не изменился — разбор не нужен
      raw = OceanMirror.parse(mbuf[0..<mlen])
      swap(&mbuf, &mprev); mprevLen = mlen
      absorb()
    }
    ripples.removeAll { now - $0.t0 > 1.3 }
    for (k, var t) in holds where !t.sheet {
      if t.kind == .moon && now - t.t0 > Touch.holdMs * 0.6 / 1000 {          // держишь Луну — её плашка
        t.sheet = true; holds[k] = t; openSheet?(lunaSpec())
      } else if t.kind == .city && !t.temp && !t.moved && now - t.t0 > Touch.holdMs / 1000 && city(t.id) != nil {   // оставленный город — его плашка
        t.sheet = true; holds[k] = t; openSheet?(citySpec(t.id))
      }
    }
  }

  // новое зеркало: снять то, что оно догнало, сказать о пропавших оставленных, пересобрать видимое
  private func absorb() {
    let ids = Set(raw.cities.map(\.id)), pinned = Set(raw.cities.filter(\.pinned).map(\.id))
    for (id, l) in local {
      if let c = raw.cities.first(where: { $0.id == id }) { if same(c, l) { local[id] = nil } }
      else if prevIds.contains(id) { local[id] = nil }       // город был и пропал — ядро убрало
    }
    gone = gone.filter { ids.contains($0) || !prevIds.contains($0) }   // зеркало без него (после того как оно было) — запись не нужна
    if let p = prevPinned { for id in p.subtracting(pinned).sorted() { objGone?(id) } }   // оставленный город пропал — его плашку закрыть
    prevIds = ids; prevPinned = pinned
    rebuild()
  }
  private func same(_ a: City, _ b: City) -> Bool {
    abs(a.ang - b.ang) < 1e-9 && abs(a.rn - b.rn) < 1e-9 && abs(a.lvl - b.lvl) < 1e-9 && a.oct == b.oct && a.path == b.path
  }
  private func rebuild() {
    var out: [City] = []
    for c in raw.cities where !gone.contains(c.id) {
      var m = c
      if let l = local[c.id] { m.ang = l.ang; m.rn = l.rn; m.lvl = l.lvl; m.oct = l.oct; m.path = l.path }
      out.append(m)
    }
    let ids = Set(raw.cities.map(\.id))
    for id in local.keys.sorted() where !ids.contains(id) && !gone.contains(id) { out.append(local[id]!) }
    mirror = raw; mirror.cities = out
  }
  func city(_ id: Int) -> City? { mirror.cities.first { $0.id == id } }
  func edit(_ id: Int, _ f: (inout City) -> Void) {
    guard var c = city(id) else { return }
    f(&c); local[id] = c; rebuild()
  }
  private func remove(_ id: Int) { local[id] = nil; gone.insert(id); rebuild() }

  // ---------- касания (view.js:30-87) ----------
  private func cityAt(_ x: CGFloat, _ y: CGFloat) -> City? {
    var best: City?, bd: CGFloat = 26
    for c in mirror.cities {
      let p = geo.at(c.ang, CGFloat(c.rn) * geo.Rd), d = hypot(x - p.x, y - p.y)
      if d < bd { bd = d; best = c }
    }
    return best
  }
  private func inCorner(_ f: Finger) -> Bool { f.x0 > geo.W - Touch.cornerPt && f.y0 > geo.H - Touch.cornerPt }
  private func freeSlot() -> Int? {
    let used = Set(mirror.cities.map(\.slot))
    return (0..<OceanusView.vmax).first { !used.contains($0) }
  }
  private func clamp(_ x: Double, _ a: Double, _ b: Double) -> Double { min(b, max(a, x)) }
  private func pushTo(_ fid: Int, _ P: (d: CGFloat, a: CGFloat), _ t: Double) {
    core.action(6, 0, [Double(fid), Double(P.a) / (2 * .pi), clamp(Double((P.d - geo.Rr) / geo.amp), -2.5, 2.5)], touchTime: t)
  }
  private func ripple(_ x: CGFloat, _ y: CGFloat, _ k: Double) {
    ripples.append(Ripple(x: x, y: y, k: k, t0: now))
    if ripples.count > 12 { ripples.removeFirst(ripples.count - 12) }
  }
  // новый город здесь: первый свободный слот, id больше всех виденных; кольцо полно или слотов нет — nil
  @discardableResult private func addCity(_ ang: Double, _ rn: Double, pinned: Bool, t: Double) -> Int? {
    guard let slot = freeSlot() else { return nil }
    let id = max(raw.cities.map(\.id).max() ?? 0, issued) + 1
    guard core.action(0, 0, [ang, rn, pinned ? 1 : 0, Double(slot), Double(id)], touchTime: t) else { return nil }
    issued = id
    local[id] = City(slot: slot, id: id, ang: ang, rn: rn, pinned: pinned)
    rebuild()
    return id
  }

  func down(_ f: Finger) {
    if inCorner(f) { return }
    let G = geo, P = G.polar(f.x, f.y), tt = f.touchTime > 0 ? f.touchTime : now, mp = G.moonPos(mirror.moon)
    if hypot(f.x - mp.x, f.y - mp.y) < 26 { holds[f.id] = Hold(kind: .moon, t0: now); return }   // Луна: держишь — её плашка
    if P.d < G.Rd - 2 {                                     // земля: города
      let near = cityAt(f.x, f.y)
      if let n = near, n.pinned {
        if let l = lastTap, l.id == n.id, tt - l.t < Touch.dtapMs / 1000 {   // двойной тап по оставленному — отпустить
          lastTap = nil; core.action(1, n.id, [], touchTime: f.touchTime); remove(n.id)
          holds[f.id] = Hold(kind: .none); return
        }
        lastTap = (n.id, f.x, f.y, tt)
        holds[f.id] = Hold(kind: .city, id: n.id, x0: f.x, y0: f.y, t0: now); return
      }
      let rn = clamp(Double(P.d / G.Rd), 0, 0.98), a = Double(P.a)
      if let l = lastTap, l.id == nil, tt - l.t < Touch.dtapMs / 1000, hypot(f.x - l.x, f.y - l.y) < 34,
         mirror.cities.filter(\.pinned).count < OceanusView.pinMax {   // двойной тап по пустой суше — город остаётся и звучит
        lastTap = nil; addCity(a, rn, pinned: true, t: f.touchTime)
        holds[f.id] = Hold(kind: .none); return
      }
      lastTap = (nil, f.x, f.y, tt)
      if let id = addCity(a, rn, pinned: false, t: f.touchTime) { holds[f.id] = Hold(kind: .city, id: id, temp: true, x0: f.x, y0: f.y, t0: now) }
      else { holds[f.id] = Hold(kind: .none) }
      return
    }
    if P.d < G.Rf + 8 {                                     // вода: тянешь к пальцу; быстрый тап — всплеск
      fingerSeq += 1
      holds[f.id] = Hold(kind: .water, x0: f.x, y0: f.y, t0: now, fid: fingerSeq)
      pushTo(fingerSeq, P, f.touchTime)
      return
    }
    holds[f.id] = Hold(kind: .none)
  }

  func move(_ f: Finger) {
    guard var t = holds[f.id], t.kind != .none, !t.sheet else { return }
    if hypot(f.x - t.x0, f.y - t.y0) > 8 { t.moved = true }
    holds[f.id] = t
    let P = geo.polar(f.x, f.y)
    if t.kind == .water { pushTo(t.fid, P, f.touchTime); return }
    if t.kind == .city && t.moved && city(t.id) != nil {    // ведёшь город — нота
      let a = Double(P.a), rn = clamp(Double(P.d / geo.Rd), 0, 0.98)
      edit(t.id) { $0.ang = a; $0.rn = rn }
      core.action(2, t.id, [a, rn], touchTime: f.touchTime)
    }
  }

  func cancel(_ f: Finger) {                                // система отняла палец: вода отпускается, город остаётся
    guard let t = holds.removeValue(forKey: f.id) else { return }
    if t.kind == .water { core.action(7, 0, [Double(t.fid)], touchTime: f.touchTime) }
    if t.kind == .city && t.temp && city(t.id) != nil { core.action(1, t.id, [], touchTime: f.touchTime); remove(t.id) }
  }

  func up(_ f: Finger) {
    guard let t = holds.removeValue(forKey: f.id) else { return }
    if t.kind == .water {
      core.action(7, 0, [Double(t.fid)], touchTime: f.touchTime)
      if !t.moved && (f.touchTime - f.t0) * 1000 < Touch.tapMs {
        let P = geo.polar(t.x0, t.y0)
        core.action(8, 0, [Double(P.a) / (2 * .pi), P.d > geo.Rr ? 0.35 : -0.35], touchTime: f.touchTime)
        ripple(t.x0, t.y0, 1)
      } else if t.moved { ripple(f.x, f.y, 0.5) }
    }
    if t.kind == .city && t.temp && city(t.id) != nil { core.action(1, t.id, [], touchTime: f.touchTime); remove(t.id) }   // временный — отпущен
  }

  // кадр — задача 5 (view.js:111-257)
  func draw(_ d: Draw, now: Double) {}
}
