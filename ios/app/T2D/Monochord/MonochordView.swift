import UIKit
import T2DCore

// Monochordum — касания и состояние: монохорд мира Роберта Фладда (порт worlds/monochord/view.js; модель и звук — в ядре)
final class MonochordView: World {
  static let slotN = 7, n = 4
  static let fOpen: [Double] = [55, 82.5, 110, 165]                          // открытые струны: A1, E2, A2, E3
  static let nodes: [(u: Double, n: Double)] = [(1.0 / 2, 2), (1.0 / 3, 3), (2.0 / 3, 3), (1.0 / 4, 4), (3.0 / 4, 4)]   // узлы флажолетов
  static let divs: [(Int, String)] = [(1, "1/4"), (2, "1/8"), (3, "1/8T"), (4, "1/16")]
  static let patterns = ["down", "down-up", "arpeggio", "random"]
  // действия ядра (core/worlds/monochord/world.hpp)
  enum Act { static let pluck = 0, harm = 1, bow = 2, sus = 3, bridge = 4, string = 5, wind = 6, fx = 7, auto = 8, autopar = 9, clear = 10, dice = 11 }

  let slot = MonochordView.slotN
  let theme = Worlds.info(MonochordView.slotN)?.theme ?? .base

  let title = "Monochordum", sub = "chorda mundi"
  private(set) lazy var fx: SheetSpec? = fxSpec            // плашка собрана раз: замыкания читают зеркало вживую
  var openSheet: ((SheetSpec) -> Void)?
  var objGone: ((Int) -> Void)?
  var rowLfoOff: ((Int) -> Void)?
  // view.js:304-306
  let legend: [LegendRow] = [
    LegendRow(glyph: .tap, gesture: "tap a string above its bridge", does: "pluck · near the end — bright"),
    LegendRow(glyph: .drag, gesture: "stroke back and forth on a string", does: "bow it · speed — pressure"),
    LegendRow(glyph: .draw, gesture: "sweep across the strings", does: "strum · speed — strength"),
    LegendRow(glyph: .up, gesture: "drag a bridge", does: "pitch · sticks to Pythagorean frets"),
    LegendRow(glyph: .tap, gesture: "tap a dot on a string", does: "harmonic (flageolet) · 1/2, 1/3, 1/4"),
    LegendRow(glyph: .double, gesture: "double tap a string", does: "it sings by itself, like an Aeolian harp"),
    LegendRow(glyph: .hold, gesture: "hold a string", does: "its sheet: pitch, brightness, decay, level · ~ — LFO, vibrato"),
    LegendRow(glyph: .up, gesture: "drag the wind rose up", does: "wind · every string sings · tap — on / off · hold — gusts"),
    LegendRow(glyph: .tap, gesture: "tap the earth", does: "it strums by itself in tempo · hold — rate, pattern"),
    LegendRow(glyph: .tap, gesture: "tap the cloud", does: "map of worlds"),
  ]

  var geo: MonoGeo
  private(set) var mirror = MonoMirror()
  let core: Core
  typealias Reader = (inout [Double]) -> Int
  private let readMirror: Reader
  private let readHeard: Reader
  private var mbuf = [Double](repeating: 0, count: 128), hbuf = [Double](repeating: 0, count: 256)   // буферы кадра — выделены раз
  private(set) var hitAt = -1e9                              // когда ударил автострам (вспышка земли)
  private(set) var rot = 0.0, roseA = 0.0                    // поворот Земли и розы ветров — свои часы для картинки
  private(set) var root = 0                                  // тоника лада (0, когда лада нет) — для подписи ноты
  private var now = 0.0
  let dr = MonoDrawState()                                 // кеш стены и буфер волны (MonoDraw.swift)

  enum Kind { case wind, earth, bridge, string, strum, none }
  struct Hold {
    var kind: Kind
    var i = 0
    var x0: CGFloat = 0, y0: CGFloat = 0, px: CGFloat = 0, lx: CGFloat = 0
    var w0 = 0.0
    var t0 = 0.0, s0 = 0.0, lt = 0.0, st: Double?, mv = 0.0   // t0, mv — часы тика (удержание, затухание); s0, lt, st — метки касаний (скорость, ожидание смычка)
    var moved = false, sheet = false, strum = false, bowing = false
    var dir = 0
  }
  private(set) var holds: [ObjectIdentifier: Hold] = [:]
  private var lastTap: (i: Int, t: Double)?

  init(core: Core, readMirror: Reader? = nil, readHeard: Reader? = nil) {
    self.core = core; geo = MonoGeo(W: 390, H: 844, topY: 59, safeBot: 34)
    self.readMirror = readMirror ?? { b in Int(t2d_app_mirror(Int32(MonochordView.slotN), &b, Int32(b.count))) }
    self.readHeard = readHeard ?? { b in Int(t2d_app_heard(Int32(MonochordView.slotN), &b, Int32(b.count))) }
  }

  func layout(W: CGFloat, H: CGFloat, topY: CGFloat, safeBot: CGFloat) { geo = MonoGeo(W: W, H: H, topY: topY, safeBot: safeBot) }
  func cornerHit(_ x: CGFloat, _ y: CGFloat) -> Bool {     // view.js:307 — рука Бога в облаке ведёт на карту
    hypot(x - geo.hand.x, y - geo.hand.y) < geo.hand.r * 1.1
  }
  func dice() { core.action(Act.dice, 0, [], touchTime: 0) }
  func clear() {                                           // view index.js:24: порывы ветра снимаются раньше CLEAR (одно кольцо действий)
    rowLfoOff?(7)
    core.action(Act.clear, 0, [], touchTime: 0)
  }
  func restored() { holds.removeAll(); lastTap = nil }
  func scale(pcs: [Int]?, root: Int) { self.root = root }
  func idle() { while readHeard(&hbuf) > 0 {} }            // слить кольцо heard без вспышки: вход в мир не отыграет прошлое

  func tick(now: Double, dt: Double) {
    self.now = now
    let len = min(max(0, readMirror(&mbuf)), mbuf.count)
    mirror.load(mbuf, n: len)
    let hn = min(max(0, readHeard(&hbuf)), hbuf.count)
    if hn > 0 && hbuf[0] > 0 { hitAt = now }
    for (k, var t) in holds where !t.sheet {
      switch t.kind {
      case .earth where now - t.t0 > Touch.holdMs / 1000: t.sheet = true; holds[k] = t; openSheet?(earthSpec())
      case .wind where !t.moved && now - t.t0 > Touch.holdMs / 1000: t.sheet = true; holds[k] = t; openSheet?(windSpec())
      case .string where !t.moved && now - t.t0 > Touch.holdMs / 1000: t.sheet = true; holds[k] = t; openSheet?(stringSpec(t.i))
      case .string where !t.moved && mirror.str[t.i].bow > 0 && now - t.mv > 0.12:   // как в вебе (view.js:129-133): гаснет только у не двигавшегося пальца; двигавшийся и остановившийся — тянет
        let b = mirror.str[t.i].bow * 0.8
        core.action(Act.bow, t.i, [b < 0.01 ? 0 : b], touchTime: 0)
      default: break
      }
    }
    let w = mirror.wind
    roseA += dt * w * 1.6                                  // роза ветров крутится от ветра
    if mirror.auto[0] != 0 { rot += dt * (mirror.auto[1] / 60) * 0.6 }   // Земля вращается при автопереборе
  }

  func held(_ i: Int) -> Hold? {                            // струна под пальцем (кобылка или щипок): подсветка; без выделений
    for t in holds.values where (t.kind == .bridge || t.kind == .string) && t.i == i { return t }
    return nil
  }
  func bridgeHeld(_ i: Int) -> Bool {                       // тянут кобылку — подпись «нота · Гц»
    for t in holds.values where t.kind == .bridge && t.i == i { return true }
    return false
  }
  var windHeld: Bool { holds.values.contains { $0.kind == .wind } }

  // ---------- касания (view.js:51-118) ----------
  private func clamp(_ x: Double, _ a: Double = 0, _ b: Double = 1) -> Double { min(b, max(a, x)) }
  private func inCorner(_ f: Finger) -> Bool { f.x0 > geo.W - Touch.cornerPt && f.y0 > geo.H - Touch.cornerPt }
  private func stamp(_ f: Finger) -> Double { f.touchTime > 0 ? f.touchTime : now }
  private func pos(_ y: CGFloat, _ yb: CGFloat) -> Double { Double((y - geo.y0) / max(10, yb - geo.y0)) }

  func down(_ f: Finger) {
    if inCorner(f) { return }
    let G = geo, A = G.aeolus, tt = stamp(f)
    if hypot(f.x - A.x, f.y - A.y) < A.r * 1.5 {            // голова ветра: вверх — сильнее, тап — вкл / выкл
      holds[f.id] = Hold(kind: .wind, y0: f.y, w0: mirror.wind, t0: now); return
    }
    let E = G.earth
    if f.y > G.y1 + 16 && abs(f.x - E.x) < E.r + 10 && f.y > E.y - E.r - 16 {   // Земля: тап — автострам, держишь — плашка
      holds[f.id] = Hold(kind: .earth, t0: now); return
    }
    func free() {                                           // мимо струн — можно начать страм
      holds[f.id] = f.y > G.y0 - 10 && f.y < G.y1 + 14 ? Hold(kind: .strum, px: f.x, lt: tt) : Hold(kind: .none)
    }
    guard let i = G.stringAt(f.x, f.y) else { free(); return }
    let yb = G.yOfR(mirror.str[i].r)
    if abs(f.y - yb) < 20 { holds[f.id] = Hold(kind: .bridge, i: i, x0: f.x, y0: f.y); return }   // подставка — высота
    if f.y > yb { free(); return }                          // ниже подставки струна заглушена
    if let l = lastTap, l.i == i, tt - l.t < Touch.dtapMs / 1000 {   // двойной тап по той же струне — поёт сама
      lastTap = nil
      core.action(Act.sus, i, [mirror.str[i].sus ? 0 : 1], touchTime: f.touchTime)
      holds[f.id] = Hold(kind: .none); return
    }
    lastTap = (i, tt)
    if let nd = MonochordView.nodes.first(where: { abs(Double(f.y) - (Double(G.y0) + $0.u * Double(yb - G.y0))) < 7 }) {
      core.action(Act.harm, i, [nd.n, 0.9], touchTime: f.touchTime)     // тап на узле — флажолет
    } else {
      core.action(Act.pluck, i, [pos(f.y, yb), 0.9], touchTime: f.touchTime)
    }
    holds[f.id] = Hold(kind: .string, i: i, x0: f.x, y0: f.y, px: f.x, lx: f.x, t0: now, s0: tt, lt: tt, mv: now)
  }

  // страм: каждая струна, которую палец пересёк выше её подставки, — щипок; сила — скорость (view.js:75-86)
  private func strum(_ t: inout Hold, _ f: Finger) -> Bool {
    let ms = stamp(f) * 1000, a = min(t.px, f.x), b = max(t.px, f.x)
    let v = Double(b - a) / max(8, ms - (t.st ?? t.lt * 1000))
    var hit = false
    for (i, sx) in geo.xs.enumerated() {
      if sx <= a || sx > b || (t.kind == .string && i == t.i && !t.strum) { continue }
      let yb = geo.yOfR(mirror.str[i].r)
      if f.y > yb - 4 || f.y < geo.y0 - 10 { continue }
      core.action(Act.pluck, i, [pos(f.y, yb), clamp(0.35 + v * 0.6, 0.3, 1)], touchTime: f.touchTime); hit = true
    }
    t.px = f.x; t.st = ms
    return hit
  }

  func move(_ f: Finger) {
    guard var t = holds[f.id], t.kind != .none, !t.sheet else { return }
    defer { holds[f.id] = t }
    switch t.kind {
    case .wind:
      if abs(f.y - t.y0) > 6 { t.moved = true }                // мёртвая зона 6 px
      if t.moved { core.action(Act.wind, 0, [clamp(t.w0 + Double(t.y0 - f.y) / 140)], touchTime: f.touchTime) }
    case .bridge:
      core.action(Act.bridge, t.i, [geo.rOfY(f.y)], touchTime: f.touchTime)
    case .strum:
      _ = strum(&t, f)
    case .string:
      if strum(&t, f) || t.strum {                             // ушёл на соседнюю струну — это страм, смычок снят
        if !t.strum { t.strum = true; if t.bowing || mirror.str[t.i].bow > 0 { core.action(Act.bow, t.i, [0], touchTime: f.touchTime); t.bowing = false } }
        t.moved = true; return
      }
      if !t.moved && hypot(f.x - t.x0, f.y - t.y0) > 8 { t.moved = true }
      guard t.moved else { return }                            // поперёк струны — смычок: сила — скорость пальца
      let ms = stamp(f) * 1000, dx = Double(f.x - t.lx), v = abs(dx) / max(8, ms - t.lt * 1000)
      t.lx = f.x; t.lt = ms / 1000; t.mv = now
      if !t.bowing {                                           // смычок — только если задержался у струны или повёл назад
        let turn = t.dir != 0 && dx != 0 && (dx > 0 ? 1 : -1) != t.dir
        if t.dir == 0 && abs(dx) > 1 { t.dir = dx > 0 ? 1 : -1 }
        if !turn && (stamp(f) - t.s0) * 1000 < 150 { return }
        t.bowing = true
      }
      core.action(Act.bow, t.i, [clamp(v * 1.4)], touchTime: f.touchTime)
    case .earth, .none: break
    }
  }

  func up(_ f: Finger) {
    guard let t = holds.removeValue(forKey: f.id) else { return }
    switch t.kind {
    case .wind where !t.moved && !t.sheet:
      core.action(Act.wind, 0, [mirror.wind > 0.01 ? 0 : mirror.lastWind], touchTime: f.touchTime)
    case .earth where !t.sheet:
      core.action(Act.auto, 0, [mirror.auto[0] != 0 ? 0 : 1], touchTime: f.touchTime)
    case .string where t.bowing || mirror.str[t.i].bow > 0:
      core.action(Act.bow, t.i, [0], touchTime: f.touchTime)
    default: break
    }
  }

  func cancel(_ f: Finger) {                                 // система отняла палец: смычок снимаем, остального не делаем
    guard let t = holds.removeValue(forKey: f.id) else { return }
    if t.kind == .string && (t.bowing || mirror.str[t.i].bow > 0) { core.action(Act.bow, t.i, [0], touchTime: f.touchTime) }
  }
}
