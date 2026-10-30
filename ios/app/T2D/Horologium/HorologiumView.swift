import UIKit
import T2DCore

// Horologium — касания и состояние: астрономические часы (порт worlds/horologium/view.js; модель и звук — в ядре, маятник — Horo*.swift)
final class HorologiumView: World {
  static let slotN = 9
  // действия ядра (core/worlds/horologium/world.hpp)
  enum Act { static let ring = 0, fx = 1, run = 2, held = 3, step = 4, bpm = 5, speed = 6, clear = 7, dice = 8 }

  let slot = HorologiumView.slotN
  let theme = Worlds.info(HorologiumView.slotN)?.theme ?? .base

  let title = "Horologium", sub = "numeri · horae"
  private(set) lazy var fx: SheetSpec? = fxSpec            // веер собран раз: замыкания читают зеркало вживую
  var openSheet: ((SheetSpec) -> Void)?
  var objGone: ((Int) -> Void)?                            // не используются: объектов нет, строки LFO — по кодам
  var rowLfoOff: ((Int) -> Void)?
  // view.js:257-260
  let legend: [LegendRow] = [
    LegendRow(glyph: .tap, gesture: "tap a ring", does: "it sounds: n strikes a turn, the n-th harmonic"),
    LegendRow(glyph: .double, gesture: "double tap a ring", does: "undertone 1/n"),
    LegendRow(glyph: .drag, gesture: "drag along a ring", does: "its phase"),
    LegendRow(glyph: .hold, gesture: "hold a ring", does: "its sheet"),
    LegendRow(glyph: .throw, gesture: "swing the pendulum", does: "by hand — it ticks · throw — faster · over the top — a chord · catch — stop"),
    LegendRow(glyph: .drag, gesture: "drag along the tempus scale", does: "speed: rhythm … tone · double tap — back to tempo"),
    LegendRow(glyph: .tap, gesture: "tap the hub", does: "run / stop · hold — tempo"),
    LegendRow(glyph: .tap, gesture: "tap the sun", does: "map of worlds"),
  ]

  var geo: HoroGeo
  private(set) var mirror = HoroMirror()
  var pend = HoroPendulum()
  let core: Core
  typealias Reader = (inout [Double]) -> Int
  private let readMirror: Reader
  private let readHeard: Reader
  private var mbuf = [Double](repeating: 0, count: 64), hbuf = [Double](repeating: 0, count: 64)   // буферы кадра — выделены раз
  private(set) var ringHit = [Double](repeating: -1e9, count: Horo.nr)   // когда ударило кольцо (вспышка метки)
  private(set) var concAt = -1e9, concA = 0.0                // concursus: когда кольца совпали и где — луч
  private var mirrorAt = 0.0                                 // когда прочитано зеркало — для pVis
  private var now = 0.0
  let dr = HoroDrawState()                                 // кеш стены и буферы кадра (HoroDraw.swift)

  enum Kind { case pend, strip, hub, ring, none }
  struct Hold {
    var kind: Kind
    var i = 0
    var x0: CGFloat = 0, y0: CGFloat = 0
    var t0 = 0.0, ts = 0.0                                 // t0 — часы тика (удержание); ts — метка касания (тап маятника, скорость броска)
    var moved = false, sheet = false, ph = false
    var a0 = 0.0, phi0 = 0.0                               // кольцо: угол пальца и фаза в его руке
    var th = 0.0, om = 0.0, tt = 0.0, was = false          // маятник: угол, скорость броска, метка, шёл ли ход при касании
    var u = 0.0                                            // шкала: последняя скорость пальца
  }
  private(set) var holds: [ObjectIdentifier: Hold] = [:]
  private var lastRingTap: (i: Int, t: Double)?              // два отдельных трекера двойного тапа, как в вебе: кольцо и шкала
  private var lastStrip: Double?

  init(core: Core, readMirror: Reader? = nil, readHeard: Reader? = nil) {
    self.core = core; geo = HoroGeo(W: 390, H: 844, topY: 59, safeBot: 34)
    self.readMirror = readMirror ?? { b in Int(t2d_app_mirror(Int32(HorologiumView.slotN), &b, Int32(b.count))) }
    self.readHeard = readHeard ?? { b in Int(t2d_app_heard(Int32(HorologiumView.slotN), &b, Int32(b.count))) }
  }

  func layout(W: CGFloat, H: CGFloat, topY: CGFloat, safeBot: CGFloat) { geo = HoroGeo(W: W, H: H, topY: topY, safeBot: safeBot) }
  func cornerHit(_ x: CGFloat, _ y: CGFloat) -> Bool {     // view.js:262 — солнце четвертью справа сверху ведёт на карту
    y > geo.sun.y && hypot(x - geo.sun.x, y - geo.sun.y) < geo.sun.r + 6
  }
  func dice() {                                            // фаза маятника — под новый ход (u = 0), как веб model.dice()
    core.action(Act.dice, 0, [], touchTime: 0)
    pend.start(u: 0)
  }
  func clear() { core.action(Act.clear, 0, [], touchTime: 0) }   // гасит кольца и ход; LFO не снимает, как веб
  func restored() {                                        // undo: «в руке» и шкалу снимок ядра не хранит — палец на них снимаем явно
    var pendHeld = false, strip = false
    for t in holds.values { if t.kind == .pend { pendHeld = true } else if t.kind == .strip { strip = true } }
    if pendHeld { pend.held = false; core.action(Act.held, 0, [0], touchTime: 0) }
    if strip { core.action(Act.speed, 0, [mirror.u, mirror.uT, 0], touchTime: 0) }
    holds.removeAll(); lastRingTap = nil; lastStrip = nil
    for i in ringHit.indices { ringHit[i] = -1e9 }
    concAt = -1e9
  }
  func idle() { while readHeard(&hbuf) > 0 {} }            // слить кольцо heard без вспышки: вход в мир не отыграет прошлое

  // стрелка и колесо между кадрами зеркала: P + F·Δt, как Pvis в вебе
  func pVis(now: Double) -> Double { mirror.P + mirror.F * min(0.1, now - mirrorAt) }
  func phaseHeld() -> Int? {                               // кольцо, вдоль которого тянут: подпись фазы
    for t in holds.values where t.kind == .ring && t.ph { return t.i }
    return nil
  }

  func tick(now: Double, dt: Double) {
    self.now = now
    let len = min(max(0, readMirror(&mbuf)), mbuf.count)
    if mirror.load(mbuf, n: len) { mirrorAt = now }
    for _ in 0..<4 {                                       // на большой скорости записей больше буфера — читаем до пустого, но не бесконечно
      let hn = min(max(0, readHeard(&hbuf)), hbuf.count)
      if hn == 0 { break }
      var o = 0                                            // heard: записи [удары, P, кольца…] подряд, без разделителя — по каждой свои вспышки и луч
      while o + 2 < hn {
        let c = Int(hbuf[o])
        if c <= 0 || o + 2 + c > hn { break }
        var mask = 0                                       // кольца записи битами: без Set в кадре
        for j in 0..<c { let i = Int(hbuf[o + 2 + j]); if i >= 0 && i < Horo.nr { ringHit[i] = now; mask |= 1 << i } }
        if mask.nonzeroBitCount > 1 && mirror.fx[2] > 0.05 { concAt = now; concA = (hbuf[o + 1] - hbuf[o + 1].rounded(.down)) * 2 * .pi }
        o += 2 + c
      }
    }
    for (k, var t) in holds where !t.sheet && !t.moved && now - t.t0 > Touch.holdMs / 1000 {
      switch t.kind {
      case .ring: t.sheet = true; holds[k] = t; openSheet?(ringSpec(t.i))
      case .hub: t.sheet = true; holds[k] = t; openSheet?(hubSpec())
      default: break
      }
    }
    pend.tick(dt: min(dt, 0.1), run: mirror.run && !pend.held, u: mirror.u, F: mirror.F)
  }

  // ---------- касания (view.js:37-96) ----------
  private func inCorner(_ f: Finger) -> Bool { f.x0 > geo.W - Touch.cornerPt && f.y0 > geo.H - Touch.cornerPt }
  private func stamp(_ f: Finger) -> Double { f.touchTime > 0 ? f.touchTime : now }
  private var ft: Double { (mirror.bpm > 0 ? mirror.bpm : 100) / 240 }
  private func uAt(_ x: CGFloat) -> Double { Horo.clamp(geo.uOfX(x, Ft: ft), -8, 8.5) }
  private func angle(_ f: Finger) -> Double { atan2(Double(f.x - geo.cx), -Double(f.y - geo.cy)) }

  // итоги маятника → действия ядра
  private func apply(_ outs: [HoroPendulum.Out], _ f: Finger) {
    for o in outs {
      switch o {
      case .held(let on): core.action(Act.held, 0, [on ? 1 : 0], touchTime: f.touchTime)
      case .step(let d): core.action(Act.step, 0, [d], touchTime: f.touchTime)
      case .run(let u): core.action(Act.run, 0, [1, u], touchTime: f.touchTime)
      case .stop: core.action(Act.run, 0, [0, mirror.u], touchTime: f.touchTime)
      }
    }
  }
  private func setRun(_ on: Bool, u: Double, _ f: Finger) {
    if on { pend.start(u: u) }
    core.action(Act.run, 0, [on ? 1 : 0, u], touchTime: f.touchTime)
  }
  private func ringOn(_ i: Int, _ on: Bool, _ f: Finger) { core.action(Act.ring, i, [0, on ? 1 : 0], touchTime: f.touchTime) }

  func down(_ f: Finger) {
    if inCorner(f) { return }
    let G = geo, tt = stamp(f), b = G.bobXY(pend.th)
    if hypot(f.x - b.x, f.y - b.y) < G.bob + 24 || (pend.spin && abs(hypot(f.x - G.piv.x, f.y - G.piv.y) - G.L) < 30) {   // маятник: схватить
      let th = atan2(Double(f.x - G.piv.x), Double(f.y - G.piv.y))
      holds[f.id] = Hold(kind: .pend, x0: f.x, y0: f.y, t0: now, ts: tt, th: th, tt: tt, was: mirror.run)
      apply(pend.grab(th), f)
      return
    }
    let S = G.strip
    if abs(f.y - S.y) < 24 && f.x > S.x0 - 14 && f.x < S.x1 + 14 {   // шкала tempus: ведёшь пальцем — скорость; двойной тап — назад к темпу
      if let l = lastStrip, tt - l < Touch.dtapMs / 1000 {
        lastStrip = nil
        core.action(Act.speed, 0, [0, 0, 0], touchTime: f.touchTime)
        holds[f.id] = Hold(kind: .none); return
      }
      lastStrip = tt
      let u = uAt(f.x)
      if !mirror.run { setRun(true, u: u, f) }
      core.action(Act.speed, 0, [u, u, 1], touchTime: f.touchTime)
      holds[f.id] = Hold(kind: .strip, x0: f.x, y0: f.y, t0: now, ts: tt, u: u); return
    }
    if hypot(f.x - G.cx, f.y - G.cy) < G.r0 - 6 { holds[f.id] = Hold(kind: .hub, x0: f.x, y0: f.y, t0: now, ts: tt); return }
    guard let i = G.ringAt(f.x, f.y) else { holds[f.id] = Hold(kind: .none); return }
    if let l = lastRingTap, l.i == i, tt - l.t < Touch.dtapMs / 1000 {   // двойной тап — унтертон (и включает)
      lastRingTap = nil
      core.action(Act.ring, i, [1, mirror.rings[i].under ? 0 : 1], touchTime: f.touchTime)
      ringOn(i, true, f)
      holds[f.id] = Hold(kind: .none); return
    }
    holds[f.id] = Hold(kind: .ring, i: i, x0: f.x, y0: f.y, t0: now, ts: tt, a0: angle(f), phi0: mirror.rings[i].phi)
  }

  func move(_ f: Finger) {
    guard var t = holds[f.id], t.kind != .none, !t.sheet else { return }
    defer { holds[f.id] = t }
    if hypot(f.x - t.x0, f.y - t.y0) > 8 { t.moved = true }
    switch t.kind {
    case .strip:
      t.u = uAt(f.x)
      core.action(Act.speed, 0, [t.u, t.u, 1], touchTime: f.touchTime)
    case .pend:                                            // ведёшь маятник: каждый проход через низ — спуск
      let th = atan2(Double(f.x - geo.piv.x), Double(f.y - geo.piv.y)), ts = stamp(f), dt = max(0.001, ts - t.tt)
      var d = th - t.th
      if d > .pi { d -= 2 * .pi }; if d < -.pi { d += 2 * .pi }
      apply(pend.swing(from: t.th, to: th), f)
      t.om = 0.6 * t.om + 0.4 * (d / dt); t.th = th; t.tt = ts
    case .ring where t.moved:                              // вдоль кольца — фаза
      let a = angle(f)
      var d = a - t.a0
      if d > .pi { d -= 2 * .pi }; if d < -.pi { d += 2 * .pi }
      let m = Horo.mOf(mirror.rings[t.i], aequalis: mirror.fx[0])
      let phi = ((t.phi0 - d / (2 * .pi) * m).truncatingRemainder(dividingBy: 1) + 1).truncatingRemainder(dividingBy: 1)
      core.action(Act.ring, t.i, [2, phi], touchTime: f.touchTime)
      t.a0 = a; t.phi0 = phi; t.ph = true
    default: break
    }
  }

  func up(_ f: Finger) {
    guard let t = holds.removeValue(forKey: f.id) else { return }
    let ts = stamp(f)
    switch t.kind {
    case .strip: core.action(Act.speed, 0, [t.u, t.u, 0], touchTime: f.touchTime)
    case .pend:
      if !t.moved && ts - t.ts < 0.3 { apply(pend.tap(running: t.was, uT: mirror.uT), f); return }   // тап — пуск / стоп
      apply(pend.release(th: t.th, om: ts - t.tt > 0.12 ? 0 : t.om), f)   // держал неподвижно — поймал
    case .hub where !t.moved && !t.sheet:
      if mirror.run { core.action(Act.run, 0, [0, mirror.u], touchTime: f.touchTime) } else { setRun(true, u: mirror.uT, f) }
    case .ring where !t.moved && !t.sheet:
      lastRingTap = (t.i, ts); ringOn(t.i, !mirror.rings[t.i].on, f)
    default: break
    }
  }

  func cancel(_ f: Finger) {                               // система отняла палец: маятник и шкалу отпускаем, остального не делаем
    guard let t = holds.removeValue(forKey: f.id) else { return }
    if t.kind == .pend { pend.held = false; core.action(Act.held, 0, [0], touchTime: f.touchTime) }
    if t.kind == .strip { core.action(Act.speed, 0, [t.u, t.u, 0], touchTime: f.touchTime) }   // как up: значение пальца, зеркало может отстать на кадр
  }

  func draw(_ d: Draw, now: Double) { frame(d, now, sun: true) }          // рисование — HoroDraw.swift
  func drawShot(_ d: Draw, now: Double) { frame(d, now, sun: false) }
}
