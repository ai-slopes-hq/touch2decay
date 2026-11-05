import UIKit
import T2DCore

// Horologium — касания и состояние: астрономические часы (порт worlds/horologium/view.js; модель и звук — в ядре, картинка — Horo*.swift)
final class HorologiumView: World {
  static let slotN = 9
  // действия ядра (core/worlds/horologium/world.hpp)
  // 3, 4, 6 (HELD, STEP, SPEED) выведены из оборота — ядро их игнорирует
  enum Act { static let ring = 0, fx = 1, run = 2, bpm = 5, clear = 7, dice = 8 }

  let slot = HorologiumView.slotN
  let theme = Worlds.info(HorologiumView.slotN)?.theme ?? .base

  let title = "Horologium", sub = "numeri · horae"
  private(set) lazy var fx: SheetSpec? = fxSpec            // веер собран раз: замыкания читают зеркало вживую
  var openSheet: ((SheetSpec) -> Void)?
  var objGone: ((Int) -> Void)?                            // не используются: объектов нет, строки LFO — по кодам
  var rowLfoOff: ((Int) -> Void)?
  // view.js:257-260
  let legend: [LegendRow] = [
    LegendRow(glyph: .tap, gesture: "tap a ring", does: "it sounds: n of its steps, the n-th harmonic"),
    LegendRow(glyph: .double, gesture: "double tap a ring", does: "undertone 1/n"),
    LegendRow(glyph: .drag, gesture: "drag along a ring", does: "its length"),
    LegendRow(glyph: .hold, gesture: "hold a ring", does: "its sheet"),
    LegendRow(glyph: .tap, gesture: "tap a pad", does: "its ring sounds on / off · hold — its sheet"),
    LegendRow(glyph: .tap, gesture: "tap the hub", does: "run / stop · hold — tempo"),
    LegendRow(glyph: .tap, gesture: "tap the sun", does: "map of worlds"),
  ]

  var geo: HoroGeo
  private(set) var mirror = HoroMirror()
  let core: Core
  typealias Reader = (inout [Double]) -> Int
  private let readMirror: Reader
  private let readHeard: Reader
  private var mbuf = [Double](repeating: 0, count: 72), hbuf = [Double](repeating: 0, count: 64)   // буферы кадра — выделены раз
  private(set) var ringHit = [Double](repeating: -1e9, count: Horo.nr)   // когда ударило кольцо (вспышка метки)
  private(set) var concAt = -1e9, concA = 0.0                // concursus: когда кольца совпали и где — луч
  private var mirrorAt = 0.0                                 // когда прочитано зеркало — для pVis
  private var now = 0.0
  let dr = HoroDrawState()                                 // кеш стены и буферы кадра (HoroDraw.swift)

  enum Kind { case hub, ring, pad, none }
  struct Hold {
    var kind: Kind
    var i = 0
    var x0: CGFloat = 0, y0: CGFloat = 0
    var t0 = 0.0, ts = 0.0                                 // t0 — часы тика (удержание); ts — метка касания
    var moved = false, sheet = false, ph = false
    var a0 = 0.0, len0 = 16, turn = 0.0, sent = 16          // кольцо: угол пальца, длина в начале жеста, накопленный поворот, последняя отправленная длина
  }
  private(set) var holds: [ObjectIdentifier: Hold] = [:]
  private var lastRingTap: (i: Int, t: Double)?              // двойной тап по кольцу

  init(core: Core, readMirror: Reader? = nil, readHeard: Reader? = nil) {
    self.core = core; geo = HoroGeo(W: 390, H: 844, topY: 59, safeBot: 34)
    self.readMirror = readMirror ?? { b in Int(t2d_app_mirror(Int32(HorologiumView.slotN), &b, Int32(b.count))) }
    self.readHeard = readHeard ?? { b in Int(t2d_app_heard(Int32(HorologiumView.slotN), &b, Int32(b.count))) }
  }

  func layout(W: CGFloat, H: CGFloat, topY: CGFloat, safeBot: CGFloat) { geo = HoroGeo(W: W, H: H, topY: topY, safeBot: safeBot) }
  func cornerHit(_ x: CGFloat, _ y: CGFloat) -> Bool {     // view.js:262 — солнце четвертью справа сверху ведёт на карту
    y > geo.sun.y && hypot(x - geo.sun.x, y - geo.sun.y) < geo.sun.r + 6
  }
  func dice() { core.action(Act.dice, 0, [], touchTime: 0) }
  func clear() { core.action(Act.clear, 0, [], touchTime: 0) }   // гасит кольца и ход; LFO не снимает, как веб
  func restored() {                                        // undo: пальцы снимаем явно
    holds.removeAll(); lastRingTap = nil
    for i in ringHit.indices { ringHit[i] = -1e9 }
    concAt = -1e9
  }
  func idle() { while readHeard(&hbuf) > 0 {} }            // слить кольцо heard без вспышки: вход в мир не отыграет прошлое

  // стрелка и колесо между кадрами зеркала: P + F·Δt, как Pvis в вебе
  func pVis(now: Double) -> Double { mirror.P + mirror.F * min(0.1, now - mirrorAt) }
  func lenHeld() -> Int? {                                 // кольцо, вдоль которого тянут: подпись длины
    for t in holds.values where t.kind == .ring && t.ph { return t.i }
    return nil
  }

  func ringHeld() -> Int? {                                // кольцо любого удержания: подпись инструмента
    for t in holds.values where t.kind == .ring { return t.i }
    return nil
  }

  func tick(now: Double, dt: Double) {
    self.now = now
    pullMirror()
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
      case .pad: t.sheet = true; holds[k] = t; openSheet?(ringSpec(t.i))
      case .hub: t.sheet = true; holds[k] = t; openSheet?(hubSpec())
      default: break
      }
    }
  }

  // ---------- касания (view.js:37-96) ----------
  private func inCorner(_ f: Finger) -> Bool { f.x0 > geo.W - Touch.cornerPt && f.y0 > geo.H - Touch.cornerPt }
  private func stamp(_ f: Finger) -> Double { f.touchTime > 0 ? f.touchTime : now }
  private func angle(_ f: Finger) -> Double { atan2(Double(f.x - geo.cx), -Double(f.y - geo.cy)) }

  private func ringOn(_ i: Int, _ on: Bool, _ f: Finger) { core.action(Act.ring, i, [0, on ? 1 : 0], touchTime: f.touchTime) }

  func down(_ f: Finger) {
    if inCorner(f) { return }
    let G = geo, tt = stamp(f)
    if hypot(f.x - G.cx, f.y - G.cy) < G.r0 - 6 { holds[f.id] = Hold(kind: .hub, x0: f.x, y0: f.y, t0: now, ts: tt); return }
    guard let i = G.ringAt(f.x, f.y) else {
      if let p = G.padAt(CGPoint(x: f.x, y: f.y)) { holds[f.id] = Hold(kind: .pad, i: p, x0: f.x, y0: f.y, t0: now, ts: tt) }
      else { holds[f.id] = Hold(kind: .none) }
      return
    }
    if let l = lastRingTap, l.i == i, tt - l.t < Touch.dtapMs / 1000 {   // двойной тап — унтертон (и включает)
      lastRingTap = nil
      core.action(Act.ring, i, [1, mirror.rings[i].under ? 0 : 1], touchTime: f.touchTime)
      ringOn(i, true, f)
      holds[f.id] = Hold(kind: .none); return
    }
    holds[f.id] = Hold(kind: .ring, i: i, x0: f.x, y0: f.y, t0: now, ts: tt, a0: angle(f), len0: mirror.rings[i].len, turn: 0, sent: mirror.rings[i].len)
  }

  func move(_ f: Finger) {
    guard var t = holds[f.id], t.kind != .none, !t.sheet else { return }
    defer { holds[f.id] = t }
    if hypot(f.x - t.x0, f.y - t.y0) > 8 { t.moved = true }
    switch t.kind {
    case .ring where t.moved:                              // вдоль кольца — длина
      let a = angle(f)
      var d = a - t.a0
      if d > .pi { d -= 2 * .pi }; if d < -.pi { d += 2 * .pi }
      t.turn += d; t.a0 = a; t.ph = true
      let g = Horo.lenGesture(len0: t.len0, turn: t.turn)
      let L = g.len; t.len0 = g.len0; t.turn = g.turn      // за пределом 1…16 база сдвигается — разворот отзывается сразу
      if L != t.sent { t.sent = L; core.action(Act.ring, t.i, [5, Double(L)], touchTime: f.touchTime) }
    default: break
    }
  }

  func up(_ f: Finger) {
    guard let t = holds.removeValue(forKey: f.id) else { return }
    let ts = stamp(f)
    switch t.kind {
    case .hub where !t.moved && !t.sheet:
      core.action(Act.run, 0, [mirror.run ? 0 : 1], touchTime: f.touchTime)   // тап — пуск / стоп
    case .pad where !t.moved && !t.sheet:
      ringOn(t.i, !mirror.rings[t.i].on, f)                // тап по пэду — on кольца, без плашки и без двойного тапа
    case .ring where !t.moved && !t.sheet:
      lastRingTap = (t.i, ts); ringOn(t.i, !mirror.rings[t.i].on, f)
    default: break
    }
  }

  func cancel(_ f: Finger) { holds.removeValue(forKey: f.id) }   // система отняла палец: ничего не шлём

  func draw(_ d: Draw, now: Double) { frame(d, now, sun: true) }          // рисование — HoroDraw.swift
  func drawShot(_ d: Draw, now: Double) { frame(d, now, sun: false) }
}

extension HorologiumView: WorldTempo {
  var tempo: WorldTempo? { self }
  // то же, что кадр делает с зеркалом (mirrorAt — по now, который выставил вызывающий)
  func pullMirror() {
    let len = min(max(0, readMirror(&mbuf)), mbuf.count)
    if mirror.load(mbuf, n: len) { mirrorAt = now }
  }
  func refresh(now: Double) { self.now = now; pullMirror() }
  var bpm: Double { mirror.bpm }
  func setBpm(_ bpm: Double) { core.action(Act.bpm, 0, [bpm], touchTime: 0) }
  func play(_ on: Bool) { core.action(Act.run, 0, [on ? 1 : 0], touchTime: 0) }
  var playing: Bool { mirror.run }
  var armed: Bool { mirror.rings.contains { $0.on } }
}
