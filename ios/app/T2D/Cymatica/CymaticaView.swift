import UIKit
import T2DCore

// Cymatica (мир II) — связка ядра и Swift: единственный путь действий send, тик, чтение значений, легенда
// (порт worlds/cymatica/view.js; модель и звук — в ядре, веер и плашка луны — CymSheets.swift; касания — CymTouch.swift, картинка — план (б))
final class CymaticaView: World {
  static let slotN = 2

  let slot = CymaticaView.slotN
  let theme = Worlds.info(CymaticaView.slotN)?.theme ?? .base

  let title = "Cymatica", sub = "figurae sonorae"
  private(set) lazy var fx: SheetSpec? = fanSpec              // веер собран раз: замыкания читают состояние вживую
  var openSheet: ((SheetSpec) -> Void)?
  var objGone: ((Int) -> Void)?
  var rowLfoOff: ((Int) -> Void)?
  var goMap: (() -> Void)?
  var lfoBase: ((Int, Int) -> Double?)?
  // host/legend.js:15-19
  let legend: [LegendRow] = [
    LegendRow(glyph: .tap, gesture: "tap the plate", does: "a strike · each cell is a note"),
    LegendRow(glyph: .pinch, gesture: "pinch", does: "plate size — pitch of everything"),
    LegendRow(glyph: .tap, gesture: "tap a ring slot", does: "outer — hits · inner — places"),
    LegendRow(glyph: .drag, gesture: "drag a hit in · out", does: "its chance"),
    LegendRow(glyph: .drag, gesture: "drag a bead out · in", does: "its note up · down"),
    LegendRow(glyph: .drag, gesture: "drag a ring's end", does: "its length — polyrhythm"),
    LegendRow(glyph: .twist, gesture: "twist with two fingers", does: "turn a ring · transpose the plate"),
    LegendRow(glyph: .hold, gesture: "hold the moon", does: "plate drift: depth, rate, shape"),
    LegendRow(glyph: .tap, gesture: "tap the resonator", does: "map of worlds"),
  ]

  typealias Reader = (inout [Double]) -> Int
  let core: Core
  var geo: CymGeo
  private(set) var mirror = CymMirror()
  var state = CymState()                                     // единственный экземпляр; касания зовут его мутирующие методы
  var scl = CymScale(pcs: nil, root: 0)
  private(set) var noteList: [Int]                           // кеш списка нот лада; пересчёт в scale()
  let readMirror: Reader, readHeard: Reader
  let seed: () -> UInt32
  private var mbuf = [Double](repeating: 0, count: 192)
  private var hbuf = [Double](repeating: 0, count: 96)
  private var evs: [CymHeard] = []
  var area: (W: Double, H: Double, topY: Double, safeBot: Double) = (390, 844, 59, 34)
  private(set) var now = 0.0
  var fingers: [ObjectIdentifier: CymFinger] = [:]           // пальцы мира; touchReset (undo) забывает их все
  var pair: CymPair?                                         // два пальца: поворот или щипок
  var ringTurn = [0.0, 0.0], ringOrn = [0.0, 0.0]            // для картинки: остаток поворота кольца (°) и накопленный поворот узора; 0 ритм, 1 мелодия
  var twistLabel: (text: String, x: Double, y: Double, until: Double)?
  var labelUntil = 0.0                                       // подпись высоты после щипка живёт секунду
  // подписи для картинки (план (б)): живут секунду после правки; markHot — удар по метке, горячая 160 мс
  var bpmUntil = 0.0
  var chanceEdit: (i: Int, until: Double)?
  var noteEdit: (i: Int, until: Double)?
  var markHot: (i: Int, at: Double)?

  init(core: Core, readMirror: Reader? = nil, readHeard: Reader? = nil, seed: (() -> UInt32)? = nil) {
    self.core = core
    geo = CymGeo(W: 390, H: 844, topY: 59, safeBot: 34, shownF0: Cym.fDef)
    noteList = CymScale(pcs: nil, root: 0).noteList()
    self.readMirror = readMirror ?? { b in Int(t2d_app_mirror(Int32(CymaticaView.slotN), &b, Int32(b.count))) }
    self.readHeard = readHeard ?? { b in Int(t2d_app_heard(Int32(CymaticaView.slotN), &b, Int32(b.count))) }
    self.seed = seed ?? { var g = SystemRandomNumberGenerator(); return UInt32.random(in: 0...UInt32.max, using: &g) }
    evs.reserveCapacity(24)
  }

  func layout(W: CGFloat, H: CGFloat, topY: CGFloat, safeBot: CGFloat) {
    area = (Double(W), Double(H), Double(topY), Double(safeBot))
    rebuildGeo()
  }
  // в плане (а) показанная высота = действующая; плавность — план (б)
  private func rebuildGeo() {
    geo = CymGeo(W: area.W, H: area.H, topY: area.topY, safeBot: area.safeBot, shownF0: effF0())
  }
  func cornerHit(_ x: CGFloat, _ y: CGFloat) -> Bool { cymResonatorHit(Double(x), Double(y), W: area.W, H: area.H, safeBot: area.safeBot) }
  var objs: Int { (0..<Cym.slots).reduce(0) { $0 + (mark($1).on ? 1 : 0) } }

  // ---------- значения для картинки, касаний и тестов: свои, пока зеркало не догнало ----------
  var f0: Double { state.f0(mirror: mirror, now: now) }
  func fx(_ k: Int) -> Double { state.fx(k, mirror: mirror, now: now) }
  var bpm: Double { state.bpm(mirror: mirror, now: now) }
  var playing: Bool { state.playing(mirror: mirror, now: now) }
  var rec: Bool { state.rec(mirror: mirror, now: now) }
  var rlen: Int { state.rlen(mirror: mirror, now: now) }
  var mlen: Int { state.mlen(mirror: mirror, now: now) }
  func chance(_ i: Int) -> Double { state.chance(i, mirror: mirror, now: now) }
  func mark(_ i: Int) -> CymMark { state.mark(i, mirror: mirror, now: now) }
  var drift: (on: Bool, depth: Double, rate: Double, shape: Double, k: Int) { state.drift(mirror: mirror, now: now) }
  var grid: Int { state.grid(mirror: mirror, now: now) }
  var cursor: Int { state.cursor(mirror: mirror, now: now) }
  // r, m — индексы слотов: из ядра не обрезаны, здесь — в 0..<16
  var stepRec: (on: Bool, r: Int, m: Int) {
    let s = state.stepRec(mirror: mirror, now: now)
    return (s.on, min(max(s.r, 0), Cym.slots - 1), min(max(s.m, 0), Cym.slots - 1))
  }
  func step(_ i: Int) -> CymStep {
    guard (0..<Cym.slots).contains(i) else { return CymStep() }
    var s = mirror.rhythm[i]
    s.chance = chance(i)
    return s
  }
  // высота с луной (cymEffF0) и ступень пластины в списке нот
  func effF0() -> Double { let d = drift; return cymEffF0(f0: f0, driftOn: d.on, k: d.k, scale: scl) }
  func base() -> Int { cymBase(cymFs(effF0()), scale: scl) }
  func noteOf(_ x: Double, _ y: Double) -> Int? { cymNoteAt(x, y, b: base(), n: scl.degPerOct, list: noteList) }

  // ---------- действия: единственный путь — ядро и свои значения получают одно и то же ----------
  func send(_ kind: Int, _ i: Int = 0, _ a: [Double] = [], touchTime: Double = 0) {
    core.action(kind, i, a, touchTime: touchTime)
    state.own(kind, i, a, mirror: mirror, scale: scl, now: now)
  }

  func dice() { send(Cym.Act.dice, 0, [Double(seed())]) }
  func clear() { send(Cym.Act.clear) }

  func scale(pcs: [Int]?, root: Int) {
    scl = CymScale(pcs: pcs, root: root)
    noteList = scl.noteList()
    state.rebase()                                           // другая сетка клеток — не вспышка
  }
  func enter() { state.rebase() }

  func restored() {                                          // undo: пальцы и своё сброшены
    touchReset()
    state.reset()
  }

  func idle() { for _ in 0..<64 { if readHeard(&hbuf) <= 0 { break } } }   // слить heard без событий: вход в мир не отыграет прошлое

  // ---------- тик ----------
  func tick(now: Double, dt: Double) {
    self.now = now
    let n = min(max(0, readMirror(&mbuf)), mbuf.count)
    _ = mirror.load(mbuf, n: n)
    state.diff(mirror, b: base(), n: scl.degPerOct, list: noteList, now: now)
    for _ in 0..<4 {                                         // записей может быть больше буфера — читаем, пока он полный, но не бесконечно
      let hn = min(max(0, readHeard(&hbuf)), hbuf.count)
      if hn == 0 { break }
      evs.removeAll(keepingCapacity: true)
      cymHeard(hbuf, n: hn, into: &evs)
      for e in evs { state.heard(e, mirror: mirror, list: noteList, now: now) }
      if hn + 5 > hbuf.count { continue }                    // буфер полон — читаем ещё
      break
    }
    state.starsAge(now: now)
    rebuildGeo()
    touchTick(now: now)
  }

  // касания (down / move / up / cancel) — CymTouch.swift

  func draw(_ d: Draw, now: Double) {}                       // картинка — план (б)
  func drawShot(_ d: Draw, now: Double) {}
}
